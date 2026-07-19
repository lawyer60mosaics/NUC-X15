export type AppTabId = 'power' | 'monitor' | 'settings';
export type HiddenModuleId = 'mode_packs' | 'lighting' | 'display_scene' | 'time_theme' | 'adaptive_scheduler' | 'monitor';
export type SimpleGameStrategy = 'balanced' | 'powersave' | 'performance';
export type UiFontSize = 'compact' | 'standard' | 'comfortable';
export type ModePackId = 'lol' | 'office' | 'download' | 'video' | 'performance';

export interface ModePack {
  id: ModePackId;
  label: string;
  detail: string;
  scenario: string;
  powerMode: 'powersave' | 'balanced' | 'performance';
  displayScene: string;
  lightingColor: string;
  keyboardBrightness: number;
  lightbarBrightness: number;
  lightbarBreathing: boolean;
  adaptiveEnabled: boolean;
}

export interface OperationLogEntry {
  id: string;
  timestamp: number;
  level: 'info' | 'success' | 'warn' | 'error';
  action: string;
  detail: string;
}

export const MODE_PACKS: ModePack[] = [
  {
    id: 'lol',
    label: 'LOL PROFILE',
    detail: 'Gaming scene + balanced power + high-refresh display + blue/green lighting',
    scenario: 'gaming',
    powerMode: 'balanced',
    displayScene: 'gaming',
    lightingColor: '#30d158',
    keyboardBrightness: 45,
    lightbarBrightness: 35,
    lightbarBreathing: true,
    adaptiveEnabled: true,
  },
  {
    id: 'office',
    label: 'OFFICE PROFILE',
    detail: 'Office fan curve + efficiency power + office display + white keyboard',
    scenario: 'office',
    powerMode: 'powersave',
    displayScene: 'office',
    lightingColor: '#ffffff',
    keyboardBrightness: 30,
    lightbarBrightness: 0,
    lightbarBreathing: false,
    adaptiveEnabled: false,
  },
  {
    id: 'download',
    label: 'IDLE PROFILE',
    detail: 'Silent fan curve + efficiency power + standard display + low lighting',
    scenario: 'silent',
    powerMode: 'powersave',
    displayScene: 'standard',
    lightingColor: '#64d2ff',
    keyboardBrightness: 12,
    lightbarBrightness: 0,
    lightbarBreathing: false,
    adaptiveEnabled: false,
  },
  {
    id: 'video',
    label: 'MEDIA PROFILE',
    detail: 'Office fan curve + balanced power + video display + soft lighting',
    scenario: 'office',
    powerMode: 'balanced',
    displayScene: 'video',
    lightingColor: '#0a84ff',
    keyboardBrightness: 20,
    lightbarBrightness: 15,
    lightbarBreathing: false,
    adaptiveEnabled: false,
  },
  {
    id: 'performance',
    label: 'MAX PROFILE',
    detail: 'Performance fan curve + performance power + gaming display + bright lighting',
    scenario: 'performance',
    powerMode: 'performance',
    displayScene: 'gaming',
    lightingColor: '#ff453a',
    keyboardBrightness: 70,
    lightbarBrightness: 60,
    lightbarBreathing: true,
    adaptiveEnabled: false,
  },
];

export interface AppSettings {
  default_tab: AppTabId;
  ui_font_size: UiFontSize;
  compact_mode: boolean;
  hidden_modules: HiddenModuleId[];
  game_process_hints: string[];
  operation_log_retention_minutes: number;
  default_scenario: string;
  confirm_scene_switch: boolean;
  adaptive_auto_start: boolean;
  simple_game_strategy: SimpleGameStrategy;
  adaptive_temp_limit: number;
  adaptive_cooldown_sec: number;
  restore_lighting_on_start: boolean;
  default_lighting_color: string;
  default_keyboard_brightness: number;
  default_lightbar_brightness: number;
  default_lightbar_breathing: boolean;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  default_tab: 'power',
  ui_font_size: 'standard',
  compact_mode: true,
  hidden_modules: [],
  game_process_hints: [
    'League of Legends.exe',
    'LeagueClient.exe',
    'RiotClientServices.exe',
    'lol',
    'riot',
  ],
  operation_log_retention_minutes: 60,
  default_scenario: 'balanced',
  confirm_scene_switch: true,
  adaptive_auto_start: false,
  simple_game_strategy: 'balanced',
  adaptive_temp_limit: 88,
  adaptive_cooldown_sec: 45,
  restore_lighting_on_start: false,
  default_lighting_color: '#ffffff',
  default_keyboard_brightness: 30,
  default_lightbar_brightness: 0,
  default_lightbar_breathing: false,
};

const tabIds: AppTabId[] = ['power', 'monitor', 'settings'];
const uiFontSizes: UiFontSize[] = ['compact', 'standard', 'comfortable'];
const moduleIds: HiddenModuleId[] = ['mode_packs', 'lighting', 'display_scene', 'time_theme', 'adaptive_scheduler', 'monitor'];
const gameStrategies: SimpleGameStrategy[] = ['balanced', 'powersave', 'performance'];

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function normalizeHex(value: unknown, fallback: string) {
  const text = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toLowerCase() : fallback;
}

function normalizeProcessHints(value: unknown) {
  const rawItems = Array.isArray(value) ? value : DEFAULT_APP_SETTINGS.game_process_hints;
  const normalized = rawItems
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 24);
  return Array.from(new Set(normalized));
}

export function normalizeAppSettings(input: unknown): AppSettings {
  const raw = typeof input === 'object' && input !== null ? input as Partial<AppSettings> : {};
  const hidden = Array.isArray(raw.hidden_modules)
    ? raw.hidden_modules.filter((item): item is HiddenModuleId => moduleIds.includes(item as HiddenModuleId))
    : DEFAULT_APP_SETTINGS.hidden_modules;

  return {
    default_tab: tabIds.includes(raw.default_tab as AppTabId) ? raw.default_tab as AppTabId : DEFAULT_APP_SETTINGS.default_tab,
    ui_font_size: uiFontSizes.includes(raw.ui_font_size as UiFontSize) ? raw.ui_font_size as UiFontSize : DEFAULT_APP_SETTINGS.ui_font_size,
    compact_mode: typeof raw.compact_mode === 'boolean' ? raw.compact_mode : DEFAULT_APP_SETTINGS.compact_mode,
    hidden_modules: Array.from(new Set(hidden)),
    game_process_hints: normalizeProcessHints(raw.game_process_hints),
    operation_log_retention_minutes: clampNumber(raw.operation_log_retention_minutes, DEFAULT_APP_SETTINGS.operation_log_retention_minutes, 5, 1440),
    default_scenario: typeof raw.default_scenario === 'string' && raw.default_scenario.trim() ? raw.default_scenario : DEFAULT_APP_SETTINGS.default_scenario,
    confirm_scene_switch: typeof raw.confirm_scene_switch === 'boolean' ? raw.confirm_scene_switch : DEFAULT_APP_SETTINGS.confirm_scene_switch,
    adaptive_auto_start: typeof raw.adaptive_auto_start === 'boolean' ? raw.adaptive_auto_start : DEFAULT_APP_SETTINGS.adaptive_auto_start,
    simple_game_strategy: gameStrategies.includes(raw.simple_game_strategy as SimpleGameStrategy)
      ? raw.simple_game_strategy as SimpleGameStrategy
      : DEFAULT_APP_SETTINGS.simple_game_strategy,
    adaptive_temp_limit: clampNumber(raw.adaptive_temp_limit, DEFAULT_APP_SETTINGS.adaptive_temp_limit, 70, 95),
    adaptive_cooldown_sec: clampNumber(raw.adaptive_cooldown_sec, DEFAULT_APP_SETTINGS.adaptive_cooldown_sec, 15, 180),
    restore_lighting_on_start: typeof raw.restore_lighting_on_start === 'boolean' ? raw.restore_lighting_on_start : DEFAULT_APP_SETTINGS.restore_lighting_on_start,
    default_lighting_color: normalizeHex(raw.default_lighting_color, DEFAULT_APP_SETTINGS.default_lighting_color),
    default_keyboard_brightness: clampNumber(raw.default_keyboard_brightness, DEFAULT_APP_SETTINGS.default_keyboard_brightness, 0, 100),
    default_lightbar_brightness: clampNumber(raw.default_lightbar_brightness, DEFAULT_APP_SETTINGS.default_lightbar_brightness, 0, 100),
    default_lightbar_breathing: typeof raw.default_lightbar_breathing === 'boolean' ? raw.default_lightbar_breathing : DEFAULT_APP_SETTINGS.default_lightbar_breathing,
  };
}
