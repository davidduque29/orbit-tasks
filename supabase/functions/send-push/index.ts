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
  const byOwner = new Map<string,Device[]>();
  for (const d of deviceResult.data as Device[]) byOwner.set(d.owner_id,[...(byOwner.get(d.owner_id) ?? []),d]);
  webpush.setVapidDetails('mailto:notifications@orbit-tasks.invalid',PUBLIC_KEY,PRIVATE_KEY);
  let sent = 0, failed = 0;
  for (const notice of candidates) for (const device of byOwner.get(notice.ownerId) ?? []) {
    const { error: reservationError } = await db.from('push_delivery_log').insert({
      owner_id: notice.ownerId, device_id: device.id, notification_key: notice.key,
    });
    if (reservationError) continue; // unique constraint: avoid duplicate sends
    try {
      await webpush.sendNotification(device.subscription_data, JSON.stringify({
        title: notice.title, body: notice.body, tag: notice.key,
      }), { TTL: 3600 });
      await db.from('push_delivery_log').update({ state: 'sent' })
        .eq('owner_id',notice.ownerId).eq('device_id',device.id).eq('notification_key',notice.key);
      sent++;
    } catch (cause) {
      failed++;
      if ((cause as { statusCode?: number }).statusCode === 404 || (cause as { statusCode?: number }).statusCode === 410) {
        await db.from('device_subscriptions').update({ enabled: false }).eq('id',device.id);
      }
      await db.from('push_delivery_log').delete().eq('owner_id',notice.ownerId)
        .eq('device_id',device.id).eq('notification_key',notice.key);
    }
  }
  return new Response(JSON.stringify({ checked: candidates.length, sent, failed }), { headers: { 'Content-Type': 'application/json' } });
});
