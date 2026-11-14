/** Parses comma-separated pending items without changing persisted notes. */
export function parsePendingItems(value: string): string[] {
  if (!value.includes(',')) return [];
  const items = value.split(',').map(item => item.trim()).filter(Boolean);
  return items.length >= 2 ? items : [];
}

/** The preview must never create empty checklist entries. */
export function hasPendingChecklist(value: string): boolean {
  return parsePendingItems(value).length >= 2;
}
