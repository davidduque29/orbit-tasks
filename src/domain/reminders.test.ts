import { describe, expect, it } from 'vitest';
import { reminderSummary, toIsoWeekday, validateReminder, type ReminderSchedule } from './reminders';

const future = new Date('2030-05-20T15:30:00.000Z');
const now = new Date('2030-05-19T12:00:00.000Z');

describe('recurrence reminder validation', () => {
  it('accepts a reminder without recurrence', () => {
    expect(validateReminder({ at: future.toISOString(), rule: null }, now)).toBeNull();
  });

  it('rejects repeated reminders without a date', () => {
    expect(validateReminder({ at: null, rule: { frequency: 'daily', interval: 1 } }, now)).toBeTruthy();
  });

  it('rejects previous dates', () => {
    expect(validateReminder({ at: '2030-05-18T12:00:00.000Z', rule: null }, now)).toBeTruthy();
  });

  it('requires at least one valid weekday for weekly recurrence', () => {
    const schedule: ReminderSchedule = { at: future.toISOString(), rule: { frequency: 'weekly', interval: 1, days: [] } };
    expect(validateReminder(schedule, now)).toBeTruthy();
    expect(validateReminder({ ...schedule, rule: { frequency: 'weekly', interval: 1, days: [1, 3] } }, now)).toBeNull();
  });

  it('rejects intervals outside 1 through 12', () => {
    expect(validateReminder({ at: future.toISOString(), rule: { frequency: 'monthly', interval: 13 } }, now)).toBeTruthy();
  });

  it('rejects an end date earlier than the first recurrence', () => {
    expect(validateReminder({ at: future.toISOString(), rule: { frequency: 'daily', interval: 1, until: '2030-05-18' } }, now)).toBeTruthy();
  });

  it('summarizes repeated reminders with the selected time', () => {
    expect(reminderSummary({ at: future.toISOString(), rule: { frequency: 'daily', interval: 1 } })).toContain('Diario');
  });

  it('converts weekdays to ISO Monday=1 and Sunday=7', () => {
    expect(toIsoWeekday(new Date(2026, 10, 2))).toBe(1);
    expect(toIsoWeekday(new Date(2026, 10, 1))).toBe(7);
  });
});
