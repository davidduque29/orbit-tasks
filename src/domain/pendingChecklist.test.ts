import { describe, expect, it } from 'vitest';
import { hasPendingChecklist, parsePendingItems } from './pendingChecklist';

describe('pending checklist parsing', () => {
  it('keeps regular pending titles unchanged', () => {
    expect(parsePendingItems('Visita claro')).toEqual([]);
    expect(hasPendingChecklist('Comprar azúcar')).toBe(false);
  });
  it('splits comma-separated items and trims spaces', () => {
    expect(parsePendingItems('azúcar, panela, papel Scott')).toEqual(['azúcar', 'panela', 'papel Scott']);
  });
  it('ignores empty items and requires at least two', () => {
    expect(parsePendingItems('azúcar, ,')).toEqual([]);
    expect(parsePendingItems('azúcar, , panela,')).toEqual(['azúcar', 'panela']);
  });
});
