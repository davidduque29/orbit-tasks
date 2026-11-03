import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  normalizeIntervals,
  validateNotificationSettings,
} from '../infrastructure/notificationSettings';

describe('notification settings', () => {
  it('removes duplicate intervals and orders them by anticipation', () => {
    expect(normalizeIntervals([30, 1440, 30, 0, 60])).toEqual([1440, 60, 30, 0]);
  });

  it('rejects negative and noninteger intervals', () => {
    expect(normalizeIntervals([-5, 2.5, 525601, 5])).toEqual([5]);
  });

  it('permits a reminder at the beginning of an event', () => {
    expect(DEFAULT_NOTIFICATION_SETTINGS.event_lead_minutes).toContain(0);
  });

  it('rejects invalid overdue repeat frequency', () => {
    expect(() => validateNotificationSettings({
      ...DEFAULT_NOTIFICATION_SETTINGS,
      overdue_repeat_minutes: 7,
    })).toThrow();
  });

  it('rejects too many intervals', () => {
    expect(() => validateNotificationSettings({
      ...DEFAULT_NOTIFICATION_SETTINGS,
      task_lead_minutes: Array.from({ length: 13 }, (_, i) => i),
    })).toThrow();
  });
});
