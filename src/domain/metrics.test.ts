import { describe, expect, it } from 'vitest';
import {
  calculateAverageCycleDays,
  calculateCompletionRate,
  calculateCycleDays,
  countClosuresByDay,
} from './metrics';

describe('task productivity metrics', () => {
  it('calculates elapsed calendar days between creation and closure', () => {
    expect(calculateCycleDays({
      created_at: '2026-11-01T10:00:00Z',
      completed_at: '2026-11-03T10:00:00Z',
    })).toBe(2);
  });

  it('does not count unfinished tasks as completed cycles', () => {
    expect(calculateCycleDays({
      created_at: '2026-11-01T10:00:00Z',
      completed_at: null,
    })).toBeNull();
  });

  it('rejects invalid negative task duration', () => {
    expect(calculateCycleDays({
      created_at: '2026-11-03T10:00:00Z',
      completed_at: '2026-11-01T10:00:00Z',
    })).toBeNull();
  });

  it('calculates project completion percentage', () => {
    expect(calculateCompletionRate([
      { status: 'Por hacer' },
      { status: 'Finalizado' },
      { status: 'Finalizado' },
      { status: 'En progreso' },
    ])).toBe(50);
    expect(calculateCompletionRate([])).toBe(0);
  });

  it('averages only completed tasks', () => {
    expect(calculateAverageCycleDays([
      { created_at: '2026-11-01T00:00:00Z', completed_at: '2026-11-03T00:00:00Z' },
      { created_at: '2026-11-01T00:00:00Z', completed_at: '2026-11-05T00:00:00Z' },
      { created_at: '2026-11-01T00:00:00Z', completed_at: null },
    ])).toBe(3);
  });

  it('groups finished tasks by closure date', () => {
    expect(countClosuresByDay([
      { completed_at: '2026-11-01T19:00:00Z' },
      { completed_at: '2026-11-01T21:00:00Z' },
      { completed_at: '2026-11-02T08:00:00Z' },
    ], new Date('2026-11-01T00:00:00Z'), 2)).toEqual([
      { date: '2026-11-01', count: 2 },
      { date: '2026-11-02', count: 1 },
    ]);
  });
});
