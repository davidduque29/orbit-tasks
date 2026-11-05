export type RepeatFrequency = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';

export interface RecurrenceRule {
  frequency: RepeatFrequency;
  interval: number;
  days?: number[];
  until?: string;
}

export interface ReminderSchedule {
  at: string | null;
  rule: RecurrenceRule | null;
}

export const NO_REMINDER: ReminderSchedule = { at: null, rule: null };

export const WEEKDAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const;

export function toLocalDateTime(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function toIsoWeekday(date: Date): number {
  return (date.getDay() + 6) % 7 + 1;
}

export function reminderSummary(schedule: ReminderSchedule): string {
  if (!schedule.at) return 'Sin recordatorio';
  const first = new Date(schedule.at);
  if (!Number.isFinite(first.getTime())) return 'Fecha inválida';
  const dateText = first.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
  if (!schedule.rule) return `Una vez · ${dateText}`;
  const names: Record<RepeatFrequency, string> = {
    daily: 'Diario',
    weekdays: 'Lunes a viernes',
    weekly: 'Semanal',
    monthly: 'Mensual',
    yearly: 'Anual',
  };
  return `${names[schedule.rule.frequency]} · ${dateText}`;
}

/** ISO 8601 dates and local datetime-local input strings are validated separately. */
export function validateReminder(
  schedule: ReminderSchedule,
  now: Date = new Date(),
): string | null {
  if (!schedule.at) {
    return schedule.rule ? 'Selecciona una fecha y una hora para repetir.' : null;
  }
  const date = new Date(schedule.at);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= now.getTime()) {
    return 'Elige una fecha y hora futuras.';
  }
  if (!schedule.rule) return null;
  const { frequency, interval, days, until } = schedule.rule;
  if (!['daily','weekdays','weekly','monthly','yearly'].includes(frequency)) {
    return 'Selecciona una frecuencia válida.';
  }
  if (!Number.isInteger(interval) || interval < 1 || interval > 12) {
    return 'El intervalo debe estar entre 1 y 12.';
  }
  if (frequency === 'weekly' && (!days?.length ||
    days.some(day => !Number.isInteger(day) || day < 1 || day > 7))) {
    return 'Elige al menos un día válido de la semana.';
  }
  if (until !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || !Number.isFinite(new Date(`${until}T12:00:00`).getTime())) {
      return 'La fecha final no es válida.';
    }
    const localStart = toLocalDateTime(date).slice(0, 10);
    if (until < localStart) return 'La repetición debe terminar después del primer aviso.';
  }
  return null;
}
