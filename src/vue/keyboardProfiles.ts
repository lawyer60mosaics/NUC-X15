import type { Rgb } from './useHardware';

export type KeyboardProfile = {
  id: string;
  name: string;
  effect: string;
  direction: string;
  speed: number;
  color: Rgb;
  brightnessAc: number;
  brightnessDc: number;
  idleAc: number;
  idleDc: number;
  keyColors?: Rgb[];
};

export const keyboardProfileStorageKey = 'nuctool.keyboard-profiles.v1';
const effects = new Set(['Monocolor', 'Breathing', 'Wave', 'Reactive', 'Rainbow', 'Ripple', 'Raindrop', 'Marquee', 'Aurora', 'Spark', 'Music', 'UserMode', 'GamingMode']);
const directions = new Set(['None', 'Right', 'Left', 'Up', 'Down', 'Auto', 'PressAnyKey']);

function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

export function validKeyPalette(value: unknown): value is Rgb[] {
  return Array.isArray(value) && value.length === 126 && value.every((color) => color &&
    integer(color.r, 0, 255) && integer(color.g, 0, 255) && integer(color.b, 0, 255));
}

export function validKeyboardProfile(value: unknown): value is KeyboardProfile {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, any>;
  return typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 100
    && typeof item.name === 'string' && item.name.trim().length > 0 && item.name.length <= 32
    && effects.has(item.effect) && directions.has(item.direction)
    && integer(item.speed, 0, 9)
    && item.color && integer(item.color.r, 0, 255) && integer(item.color.g, 0, 255) && integer(item.color.b, 0, 255)
    && integer(item.brightnessAc, 0, 100) && integer(item.brightnessDc, 0, 100)
    && integer(item.idleAc, 0, 13) && integer(item.idleDc, 0, 13)
    && (item.effect === 'UserMode' ? validKeyPalette(item.keyColors) : item.keyColors == null);
}

export function parseKeyboardProfiles(text: string | null): KeyboardProfile[] {
  if (!text) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 20).filter(validKeyboardProfile);
  } catch { return []; }
}

export function readKeyboardProfiles(): KeyboardProfile[] {
  try { return parseKeyboardProfiles(window.localStorage.getItem(keyboardProfileStorageKey)); }
  catch { return []; }
}

export function writeKeyboardProfiles(profiles: KeyboardProfile[]): void {
  if (profiles.length > 20 || !profiles.every(validKeyboardProfile)) throw new Error('键盘配置不合法或数量超过 20');
  window.localStorage.setItem(keyboardProfileStorageKey, JSON.stringify(profiles));
}
