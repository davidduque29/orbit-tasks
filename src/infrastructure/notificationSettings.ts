import { supabase } from './supabaseClient';

export interface NotificationSettings {
  task_lead_minutes: number[];
  overdue_enabled: boolean;
  overdue_repeat_minutes: number;
  event_lead_minutes: number[];
  quiet_hours_enabled: boolean;
  quiet_start: string;
  quiet_end: string;
  timezone: string;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  task_lead_minutes: [1440, 30],
  overdue_enabled: true,
  overdue_repeat_minutes: 1440,
  event_lead_minutes: [60, 0],
  quiet_hours_enabled: false,
  quiet_start: '22:00',
  quiet_end: '07:00',
  timezone: 'America/Bogota',
};

export const REMINDER_OPTIONS = [
  { value: 0, label: 'Al momento programado' },
  { value: 5, label: '5 minutos antes' },
  { value: 15, label: '15 minutos antes' },
  { value: 30, label: '30 minutos antes' },
  { value: 60, label: '1 hora antes' },
  { value: 1440, label: '1 día antes' },
  { value: 2880, label: '2 días antes' },
  { value: 10080, label: '1 semana antes' },
];

export function normalizeIntervals(values: number[]): number[] {
  return [...new Set(values)].filter((value) =>
    Number.isSafeInteger(value) && value >= 0 && value <= 525600)
    .sort((a, b) => b - a).slice(0, 12);
}

export function validateNotificationSettings(settings: NotificationSettings): void {
  for (const intervals of [settings.task_lead_minutes, settings.event_lead_minutes]) {
    if (intervals.length > 12 || intervals.some((value) =>
      !Number.isSafeInteger(value) || value < 0 || value > 525600)) {
      throw new Error('Cada grupo admite máximo 12 intervalos de hasta un año.');
    }
  }
  if (![0, 60, 1440, 10080].includes(settings.overdue_repeat_minutes)) {
    throw new Error('Frecuencia de avisos vencidos inválida.');
  }
}

export async function loadNotificationSettings(userId: string): Promise<NotificationSettings> {
  const { data, error } = await supabase.from('notification_preferences')
    .select('task_lead_minutes,overdue_enabled,overdue_repeat_minutes,event_lead_minutes,quiet_hours_enabled,quiet_start,quiet_end,timezone')
    .eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!data) return { ...DEFAULT_NOTIFICATION_SETTINGS };
  return { ...DEFAULT_NOTIFICATION_SETTINGS, ...data } as NotificationSettings;
}

export async function saveNotificationSettings(userId: string, settings: NotificationSettings) {
  validateNotificationSettings(settings);
  const { error } = await supabase.from('notification_preferences').upsert({
    user_id: userId,
    ...settings,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) throw error;
}

export async function saveReminderOverride(
  table: 'tasks' | 'events',
  ownerId: string,
  itemId: string,
  minutes: number[] | null,
): Promise<void> {
  if (minutes) {
    if (minutes.length > 12 || minutes.some((v) => !Number.isSafeInteger(v) || v < 0 || v > 525600)) {
      throw new Error('Intervalo fuera del rango permitido.');
    }
  }
  const { data, error } = await supabase.from(table)
    .update({ reminder_override_minutes: minutes })
    .eq('id', itemId).eq('owner_id', ownerId).select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('No se encontró el registro o no tienes permiso.');
}
