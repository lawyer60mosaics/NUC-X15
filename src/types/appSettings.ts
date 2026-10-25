export type AppTabId = 'power' | 'fan' | 'performance' | 'display' | 'monitor' | 'settings';
export type FanScenarioId = 'quiet' | 'balanced' | 'cooling';
export type HiddenModuleId = 'monitor';
export type SimpleGameStrategy = 'balanced' | 'powersave' | 'performance';
export type UiFontSize = 'compact' | 'standard' | 'comfortable' | 'custom';
export type StartupRunMode = 'silent' | 'full';
// 风扇是唯一直接写 EC 的控制面。旧版 nuc_service 设置会在读取时迁移到此模式。
export type FanControlBackend = 'direct_ec';
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

export const MODE_PACKS: ModePack[] = [
  {
    id: 'lol',
    label: 'LOL PROFILE',
    detail: 'Gaming scene + balanced power + high-refresh display + blue/green lighting',
    scenario: 'cooling',
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
    detail: 'Balanced fan curve + efficiency power + office display + white keyboard',
    scenario: 'quiet',
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
    scenario: 'quiet',
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
    detail: 'Media fan curve (~50% CPU/GPU fan output) + balanced power + video display + soft lighting',
    scenario: 'quiet',
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
    scenario: 'cooling',
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
  startup_run_mode: StartupRunMode;
  fan_control_backend: FanControlBackend;
  default_tab: AppTabId;
  ui_font_size: UiFontSize;
  ui_font_size_px: number;
  compact_mode: boolean;
  hidden_modules: HiddenModuleId[];
  game_process_hints: string[];
  default_scenario: FanScenarioId;
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
  startup_run_mode: 'silent',
  fan_control_backend: 'direct_ec',
  default_tab: 'power',
  ui_font_size: 'standard',
  ui_font_size_px: 15,
  compact_mode: true,
  hidden_modules: [],
  game_process_hints: [
    'League of Legends.exe',
    'LeagueClient.exe',
    'RiotClientServices.exe',
    'lol',
    'riot',
  ],
  default_scenario: 'quiet',
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

const tabIds: AppTabId[] = ['power', 'fan', 'performance', 'display', 'monitor', 'settings'];
const uiFontSizes: UiFontSize[] = ['compact', 'standard', 'comfortable', 'custom'];
const presetFontSizes: Record<Exclude<UiFontSize, 'custom'>, number> = {
  compact: 14,
  standard: 15,
  comfortable: 16,
};
const moduleIds: HiddenModuleId[] = ['monitor'];
const gameStrategies: SimpleGameStrategy[] = ['balanced', 'powersave', 'performance'];
const startupRunModes: StartupRunMode[] = ['silent', 'full'];

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

function normalizeScenarioPreference(value: unknown): FanScenarioId {
  switch (String(value || '').trim().toLowerCase()) {
    case 'quiet':
    case 'silent':
    case 'media':
      return 'quiet';
    case 'balanced':
      return 'balanced';
    case 'game':
    case 'gaming':
    case 'performance':
    case 'benchmark':
    case 'bench':
    case 'cooling':
      return 'cooling';
    default:
      return 'quiet';
  }
}

export function normalizeAppSettings(input: unknown): AppSettings {
  const raw = typeof input === 'object' && input !== null ? input as Partial<AppSettings> : {};
  const normalizedFontSize = uiFontSizes.includes(raw.ui_font_size as UiFontSize)
    ? raw.ui_font_size as UiFontSize
    : DEFAULT_APP_SETTINGS.ui_font_size;
  const hidden = Array.isArray(raw.hidden_modules)
    ? raw.hidden_modules.filter((item): item is HiddenModuleId => moduleIds.includes(item as HiddenModuleId))
    : DEFAULT_APP_SETTINGS.hidden_modules;
  const normalizedDefaultTab = tabIds.includes(raw.default_tab as AppTabId)
    ? raw.default_tab as AppTabId
    : DEFAULT_APP_SETTINGS.default_tab;

  return {
    startup_run_mode: startupRunModes.includes(raw.startup_run_mode as StartupRunMode)
      ? raw.startup_run_mode as StartupRunMode
      : DEFAULT_APP_SETTINGS.startup_run_mode,
    fan_control_backend: 'direct_ec',
    default_tab: normalizedDefaultTab === 'monitor' && hidden.includes('monitor') ? 'power' : normalizedDefaultTab,
    ui_font_size: normalizedFontSize,
    ui_font_size_px: clampNumber(
      raw.ui_font_size_px,
      normalizedFontSize === 'custom' ? DEFAULT_APP_SETTINGS.ui_font_size_px : presetFontSizes[normalizedFontSize],
      12,
      20,
    ),
    compact_mode: typeof raw.compact_mode === 'boolean' ? raw.compact_mode : DEFAULT_APP_SETTINGS.compact_mode,
    hidden_modules: Array.from(new Set(hidden)),
    game_process_hints: normalizeProcessHints(raw.game_process_hints),
    default_scenario: normalizeScenarioPreference(raw.default_scenario),
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
