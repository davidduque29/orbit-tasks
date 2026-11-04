import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.57.0';

const PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY');
const PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY');
const SCHEDULER_TOKEN = Deno.env.get('PUSH_SCHEDULER_TOKEN');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

type Task = { id: string; owner_id: string; title: string; estimated_due_at: string | null; status: string; reminder_override_minutes: number[] | null };
type Event = { id: string; owner_id: string; title: string; starts_at: string; status: string; reminder_override_minutes: number[] | null };
type Settings = { user_id: string; task_lead_minutes: number[]; event_lead_minutes: number[]; overdue_enabled: boolean; overdue_repeat_minutes: number; quiet_hours_enabled: boolean; quiet_start: string; quiet_end: string; timezone: string };
type Device = { id: string; owner_id: string; subscription_data: { endpoint: string; keys?: { p256dh: string; auth: string } } };
type Notification = { ownerId: string; key: string; title: string; body: string };

function extractProviderReason(cause: unknown): string | null {
  try {
    const body = (cause as { body?: unknown }).body;
    if (typeof body !== 'string' || body.length > 1500) return null;
    const parsed = JSON.parse(body) as { reason?: unknown };
    return typeof parsed.reason === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(parsed.reason)
      ? parsed.reason : null;
  } catch { return null; }
}

function clockInTimezone(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: timezone }).format(now);
}
function quiet(now: Date, setting: Settings): boolean {
  if (!setting.quiet_hours_enabled) return false;
  let clock: string;
  try { clock = clockInTimezone(now, setting.timezone || 'America/Bogota'); }
  catch { clock = clockInTimezone(now, 'America/Bogota'); }
  const start = setting.quiet_start.slice(0, 5), end = setting.quiet_end.slice(0, 5);
  return start < end ? clock >= start && clock < end : clock >= start || clock < end;
}
function dueNotifications(now: Date, tasks: Task[], events: Event[], settings: Map<string,Settings>): Notification[] {
  const results: Notification[] = [];
  const timestamp = now.getTime(), minute = 60000;
  const defaults = { task_lead_minutes: [1440,30], event_lead_minutes: [60,0], overdue_enabled: true, overdue_repeat_minutes: 1440 } as const;
  for (const task of tasks) {
    if (!task.estimated_due_at || task.status === 'Finalizado') continue;
    const deadline = new Date(task.estimated_due_at).getTime();
    if (!Number.isFinite(deadline)) continue;
    const s = settings.get(task.owner_id);
    if (s && quiet(now, s)) continue;
    const intervals = task.reminder_override_minutes ?? s?.task_lead_minutes ?? defaults.task_lead_minutes;
    for (const offset of [...new Set(intervals)]) {
      const when = deadline - offset * minute;
      if (when <= timestamp && timestamp - when < 5 * minute && timestamp <= deadline) {
        results.push({ ownerId: task.owner_id, key: `task:${task.id}:before:${offset}:${deadline}`,
          title: 'Tarea próxima a vencer', body: `${task.title} · vence pronto` });
      }
    }
    if (s?.overdue_enabled ?? defaults.overdue_enabled) {
      const every = s?.overdue_repeat_minutes ?? defaults.overdue_repeat_minutes;
      if (timestamp >= deadline) {
        const slot = every === 0 ? 0 : Math.floor((timestamp - deadline) / (every * minute));
        const when = deadline + slot * every * minute;
        if (timestamp - when < 5 * minute) results.push({
          ownerId: task.owner_id, key: `task:${task.id}:overdue:${deadline}:${slot}`,
          title: 'Tarea vencida', body: task.title,
        });
      }
    }
  }
  for (const event of events) {
    if (event.status !== 'Programado') continue;
    const start = new Date(event.starts_at).getTime();
    if (!Number.isFinite(start)) continue;
    const s = settings.get(event.owner_id);
    if (s && quiet(now, s)) continue;
    const intervals = event.reminder_override_minutes ?? s?.event_lead_minutes ?? defaults.event_lead_minutes;
    for (const offset of [...new Set(intervals)]) {
      const when = start - offset * minute;
      if (when <= timestamp && timestamp - when < 5 * minute) results.push({
        ownerId: event.owner_id, key: `event:${event.id}:before:${offset}:${start}`,
        title: offset === 0 ? 'Tu evento está comenzando' : 'Evento próximo',
        body: event.title,
      });
    }
  }
  return results;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!SCHEDULER_TOKEN || !PRIVATE_KEY || !PUBLIC_KEY || !SUPABASE_URL || !SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'Push server is not yet configured' }), { status: 503 });
  }
  if (request.headers.get('x-orbit-scheduler-token') !== SCHEDULER_TOKEN) {
    return new Response('Unauthorized', { status: 401 });
  }
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const now = new Date();
  const [tasksResult, eventsResult, settingsResult, deviceResult] = await Promise.all([
    db.from('tasks').select('id,owner_id,title,status,estimated_due_at,reminder_override_minutes').neq('status','Finalizado').not('estimated_due_at','is',null),
    db.from('events').select('id,owner_id,title,status,starts_at,reminder_override_minutes').eq('status','Programado'),
    db.from('notification_preferences').select('*'),
    db.from('device_subscriptions').select('id,owner_id,subscription_data').eq('enabled',true),
  ]);
  const error = [tasksResult, eventsResult, settingsResult, deviceResult].find((r) => r.error)?.error;
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  const settings = new Map((settingsResult.data as Settings[]).map((s) => [s.user_id,s]));
  const candidates = dueNotifications(now, tasksResult.data as Task[], eventsResult.data as Event[],settings);
  // Diagnostic requests use the same protected scheduler endpoint.
  // Only an explicitly specified account receives a test notification.
  let diagnosticOwnerId: string | null = null;
  try {
    const input = await request.json() as { diagnostic?: boolean; ownerId?: string };
    if (input.diagnostic === true && typeof input.ownerId === 'string'
      && /^[a-f0-9-]{36}$/i.test(input.ownerId)) {
      diagnosticOwnerId = input.ownerId;
    }
  } catch { /* The standard scheduler request is an empty JSON object. */ }
  if (diagnosticOwnerId) candidates.push({
    ownerId: diagnosticOwnerId,
    key: `diagnostic:${diagnosticOwnerId}:${now.getTime()}`,
    title: 'Orbit Tasks · Prueba de notificaciones',
    body: 'Verificando el servicio de avisos en tu dispositivo.',
  });
  const byOwner = new Map<string,Device[]>();
  for (const d of deviceResult.data as Device[]) byOwner.set(d.owner_id,[...(byOwner.get(d.owner_id) ?? []),d]);
  webpush.setVapidDetails('https://davidduque29.github.io/orbit-tasks/',PUBLIC_KEY,PRIVATE_KEY);
  let sent = 0, failed = 0, skipped = 0;
  for (const notice of candidates) {
    for (const device of byOwner.get(notice.ownerId) ?? []) {
      const match = {
        owner_id: notice.ownerId,
        device_id: device.id,
        notification_key: notice.key,
      };
      const attemptTime = new Date().toISOString();
      const reservation = await db.from('push_delivery_log')
        .insert({ ...match, state: 'reserved', attempts: 1, last_attempt_at: attemptTime })
        .select('id').single();

      if (reservation.error) {
        // An existing unique key is expected when a previous cron invocation
        // already processed this reminder for the same device.
        if (reservation.error.code !== '23505') {
          console.error('push_log_reservation_failed', { code: reservation.error.code });
          failed++;
          continue;
        }
        const { data: existing, error: existingError } = await db.from('push_delivery_log')
          .select('id,state,attempts,next_retry_at').match(match).maybeSingle();
        if (existingError || !existing || existing.state !== 'failed'
            || existing.attempts >= 3
            || !existing.next_retry_at
            || Date.parse(existing.next_retry_at) > Date.now()) {
          skipped++;
          continue;
        }
        // Guarded update prevents concurrent cron invocations from retrying
        // the same failed delivery twice.
        const { data: retryRow, error: retryError } = await db.from('push_delivery_log')
          .update({
            state: 'reserved',
            attempts: existing.attempts + 1,
            last_attempt_at: attemptTime,
            next_retry_at: null,
            error_message: null,
            http_status: null,
          })
          .eq('id', existing.id)
          .eq('state', 'failed')
          .eq('attempts', existing.attempts)
          .select('id').maybeSingle();
        if (retryError || !retryRow) {
          skipped++;
          continue;
        }
      }

      try {
        await webpush.sendNotification(device.subscription_data, JSON.stringify({
          title: notice.title, body: notice.body, tag: notice.key,
        }), { TTL: 3600 });
        const { error: markSentError } = await db.from('push_delivery_log')
          .update({
            state: 'sent',
            sent_at: new Date().toISOString(),
            error_message: null,
            http_status: null,
            next_retry_at: null,
          }).match(match);
        if (markSentError) console.error('push_log_sent_update_failed', { code: markSentError.code });
        sent++;
      } catch (cause) {
        failed++;
        const info = cause as { statusCode?: number; code?: string; message?: string };
        const statusCode = typeof info.statusCode === 'number' ? info.statusCode : null;
        const errorType = typeof info.code === 'string' ? info.code.slice(0, 80) : 'WEB_PUSH_ERROR';
        const providerReason = extractProviderReason(cause);
        // Do not persist endpoint, auth key, p256dh, private key, or server response body.
        const message = typeof info.message === 'string'
          ? info.message.replace(/https?:\/\/\S+/g, '[url]').slice(0, 350)
          : 'Error no identificado al enviar Web Push';
        const { data: attemptRow } = await db.from('push_delivery_log')
          .select('attempts').match(match).maybeSingle();
        const currentAttempts = attemptRow?.attempts ?? 3;
        const errorCode = providerReason ?? (statusCode ? `HTTP_${statusCode}` : 'NETWORK_ERROR');
        const { data: rule, error: ruleError } = await db.from('push_error_rules')
          .select('retryable,requires_resubscription').eq('code', errorCode).eq('active', true).maybeSingle();
        if (ruleError) console.error('push_error_rule_lookup_failed', { code: ruleError.code });
        // Unrecognized 4xx rejections are non-retryable, while connection and
        // provider 5xx failures are eligible for bounded retries.
        const retryable = rule?.retryable ?? (statusCode === null || statusCode >= 500);
        const permanentlyRejected = rule?.requires_resubscription ?? (statusCode === 404 || statusCode === 410);
        const nextRetry = !retryable || permanentlyRejected || currentAttempts >= 3
          ? null
          : new Date(Date.now() + Math.min(currentAttempts * 60_000, 180_000)).toISOString();
        const { error: saveFailureError } = await db.from('push_delivery_log')
          .update({
            state: 'failed',
            error_message: `${providerReason ?? errorType}: ${message}`,
            http_status: statusCode,
            error_code: errorCode,
            next_retry_at: nextRetry,
            last_attempt_at: new Date().toISOString(),
          }).match(match);
        if (saveFailureError) console.error('push_log_failure_update_failed', { code: saveFailureError.code });
        console.error('web_push_delivery_failed', { code: errorType, status: statusCode, attempts: currentAttempts });
        if (permanentlyRejected) {
          await db.from('device_subscriptions').update({ enabled: false }).eq('id', device.id);
        }
      }
    }
  }
  return new Response(JSON.stringify({ checked: candidates.length, sent, failed, skipped }), { headers: { 'Content-Type': 'application/json' } });
});
