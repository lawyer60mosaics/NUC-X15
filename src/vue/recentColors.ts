import type { Rgb } from './useHardware';

const storageKey = 'studio-recent-colors-v1';
export type RecentColorKind = 'keyboard' | 'lightbar';
export type RecentColors = Record<RecentColorKind, Rgb[]>;

function validColor(value: unknown, max: number): value is Rgb {
  if (!value || typeof value !== 'object') return false;
  return (['r', 'g', 'b'] as const).every((channel) => {
    const number = (value as Record<string, unknown>)[channel];
    return typeof number === 'number' && Number.isInteger(number) && number >= 0 && number <= max;
  });
}

export function readRecentColors(): RecentColors {
  const empty: RecentColors = { keyboard: [], lightbar: [] };
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as Record<string, unknown>;
    for (const kind of ['keyboard', 'lightbar'] as const) {
      const max = kind === 'keyboard' ? 255 : 100;
      if (Array.isArray(stored[kind])) empty[kind] = stored[kind].filter((color) => validColor(color, max)).slice(0, 8);
    }
  } catch { /* A missing or damaged local palette must not disable hardware controls. */ }
  return empty;
}

export function rememberColor(current: RecentColors, kind: RecentColorKind, color: Rgb): RecentColors {
  const max = kind === 'keyboard' ? 255 : 100;
  if (!validColor(color, max)) return current;
  const next = {
    ...current,
    [kind]: [color, ...current[kind].filter((entry) => entry.r !== color.r || entry.g !== color.g || entry.b !== color.b)].slice(0, 8),
  };
  try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* In-memory history is still usable. */ }
  return next;
}
