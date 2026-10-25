import { keyboardUsRows } from './keymapUs.ts';

export type KeyboardGroup = { id: string; name: string; keyIds: string[] };
export const keyboardGroupStorageKey = 'nuctool.keyboard-groups.v1';
const knownIds = new Set(keyboardUsRows.flat().map((key) => key.id));

export function validKeyboardGroup(value: unknown): value is KeyboardGroup {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 100
    && typeof item.name === 'string' && item.name.trim().length > 0 && item.name.length <= 32
    && Array.isArray(item.keyIds) && item.keyIds.length > 0 && item.keyIds.length <= knownIds.size
    && item.keyIds.every((id) => typeof id === 'string' && knownIds.has(id))
    && new Set(item.keyIds).size === item.keyIds.length;
}

export function parseKeyboardGroups(text: string | null): KeyboardGroup[] {
  if (!text) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    const groups = parsed.slice(0, 20).filter(validKeyboardGroup);
    return groups.filter((group, index) => groups.findIndex((other) => other.id === group.id) === index);
  } catch { return []; }
}

export function readKeyboardGroups(): KeyboardGroup[] {
  try { return parseKeyboardGroups(localStorage.getItem(keyboardGroupStorageKey)); }
  catch { return []; }
}

export function writeKeyboardGroups(groups: KeyboardGroup[]): void {
  if (groups.length > 20 || groups.some((group) => !validKeyboardGroup(group)) ||
    new Set(groups.map((group) => group.id)).size !== groups.length) throw new Error('键组数据无效');
  localStorage.setItem(keyboardGroupStorageKey, JSON.stringify(groups));
}

export function keyboardGroupSlots(keyIds: string[]): number[] {
  const selected = new Set(keyIds);
  return [...new Set(keyboardUsRows.flat().filter((key) => selected.has(key.id)).flatMap((key) => key.indices))].sort((a, b) => a - b);
}
