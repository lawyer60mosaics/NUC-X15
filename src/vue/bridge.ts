import { invoke, isTauri } from '@tauri-apps/api/core';

const defaultProfiles = {
  Performance: { ac: { cpu: '1', dgpu: '1', fan: '1' }, dc: { cpu: '1', dgpu: '1', fan: '1' } },
  Balanced: { ac: { cpu: '2', dgpu: '2', fan: '2' }, dc: { cpu: '2', dgpu: '2', fan: '2' } },
  BatterySaver: { ac: { cpu: '3', dgpu: '3', fan: '3' }, dc: { cpu: '3', dgpu: '3', fan: '3' } },
};
const presetDisplayModes = [
  { index: 0, type: 'Standard', brightnessAc: 50, brightnessDc: 50, contrast: 50, colorTemp: 6500, red: 128, green: 128, blue: 128 },
  { index: 1, type: 'Gaming', brightnessAc: 50, brightnessDc: 50, contrast: 60, colorTemp: 6500, red: 100, green: 90, blue: 110 },
  { index: 2, type: 'Video', brightnessAc: 50, brightnessDc: 57, contrast: 50, colorTemp: 6500, red: 111, green: 120, blue: 115 },
  { index: 3, type: 'Reading', brightnessAc: 50, brightnessDc: 50, contrast: 50, colorTemp: 5000, red: 128, green: 128, blue: 128 },
];

// The desktop always uses Tauri. This small in-memory adapter keeps the same
// command/response contract testable in a browser without pretending to read
// physical hardware there.
const mock = {
  fanRunning: false,
  fanConfig: null as unknown,
  profile: 2,
  benchmark: false,
  passiveCooling: false,
  vendorProfiles: structuredClone(defaultProfiles),
  batteryMode: 'Custom',
  batteryLimit: 60,
  vendorBatteryLevel: 60,
  keyboardOn: true,
  keyboardBrightness: 30,
  keyboardBrightnessAc: 30,
  keyboardBrightnessDc: 30,
  keyboardIdleAc: 3,
  keyboardIdleDc: 2,
  lightbarIdleAc: 300,
  lightbarIdleDc: 120,
  keyboardColor: { r: 255, g: 255, b: 255 },
  keyColors: Array.from({ length: 126 }, () => ({ r: 0, g: 0, b: 0 })),
  keyboardEffect: 'Monocolor',
  keyboardDirection: 'None',
  keyboardSpeed: 0,
  lightbarAc: { r: 49, g: 0, b: 0 },
  lightbarDc: { r: 49, g: 0, b: 0 },
  lightbarAcEffect: 'Monocolor',
  lightbarDcEffect: 'Monocolor',
  breathing: false,
  whisperMode: 'Off',
  whisperFps: 0,
  keys: { NumPad: true, WinKey: true, FnKey: true, DisableTouchPadToggle: false } as Record<string, boolean>,
  custom: { index: 4, type: 'Custom', brightnessAc: 50, brightnessDc: 50, colorTemp: 6500, contrast: 50, red: 128, green: 128, blue: 128 },
};

function vendorData() {
  return {
    connected: true,
    processRunning: true,
    features: ['KeyboardLedIndividualKeyControl', 'LightbarSingleColor', 'CpuPowerMode', 'FanPowerMode', 'SystemMonitor', 'DisplaySettings', 'KeyWinLock', 'KeyFnLock', 'KeyNumPad', 'KeyOSD', 'BatteryChargeLimit', 'WhisperMode'],
    currentState: { selectedProfile: mock.profile === 1 ? 'Performance' : mock.profile === 2 ? 'Balanced' : 'BatterySaver', benchmarkMode: mock.benchmark, passiveCooling: mock.passiveCooling },
    currentProfiles: mock.vendorProfiles,
    defaultProfiles,
    keyStates: Object.entries(mock.keys).map(([type, state]) => ({ type, state })),
    battery: { mode: mock.batteryMode, chargingLevel: mock.vendorBatteryLevel },
    whisper: { type: mock.whisperMode, fps: mock.whisperFps },
    keyboardBrightness: { ac: mock.keyboardBrightnessAc, dc: mock.keyboardBrightnessDc },
    keyboardIdleTimer: { ac: mock.keyboardIdleAc, dc: mock.keyboardIdleDc },
    lightbarIdleTimer: { ac: mock.lightbarIdleAc, dc: mock.lightbarIdleDc },
    savedDisplayModes: [...presetDisplayModes, mock.custom],
    lighting: {
      keyboard: { effect: mock.keyboardEffect, direction: mock.keyboardDirection, speed: mock.keyboardSpeed, brightnessAc: mock.keyboardBrightness, brightnessDc: mock.keyboardBrightness, colors: [mock.keyboardColor], keyColorCount: mock.keyColors.length, keyColors: mock.keyColors },
      lightbar: { breathing: mock.breathing, ac: { effect: mock.lightbarAcEffect, ...mock.lightbarAc }, dc: { effect: mock.lightbarDcEffect, ...mock.lightbarDc } },
    },
    errors: [] as string[],
  };
}

function authorData() {
  return {
    battery_charging_level: mock.batteryLimit,
    keyboard_leds_power: Number(mock.keyboardOn),
    keyboard_enabled: mock.keyboardOn,
    current_profile_index: mock.profile,
    supported_features_count: 12,
    status: { ok: true, detail: 'Browser simulator', data: {} },
  };
}

function result(data = vendorData()) { return { status: { ok: true, detail: 'Browser simulator', data }, verified: true }; }

export async function call<T = any>(command: string, args: Record<string, any> = {}): Promise<T> {
  if (isTauri()) return invoke<T>(command, args);
  await new Promise((resolve) => window.setTimeout(resolve, 25));
  const output: any = (() => {
    switch (command) {
      case 'get_vendor_service_status': return { ok: true, detail: 'Browser simulator', data: vendorData() };
      case 'get_author_bridge_status': return { available: true, detail: 'Browser simulator — no physical NUCtool.dll' };
      case 'read_author_hardware_state': return authorData();
      case 'get_power_source': return { source: 'ac', battery_percent: 97 };
      case 'get_studio_monitor_snapshot': return {
        sampledAt: Date.now(),
        cpu: { name: '浏览器模拟 CPU', usage: 18, currentMhz: 2800, maxMhz: 4600, l2Kb: 10240, l3Kb: 24576 },
        memory: { totalKb: 32 * 1024 * 1024, freeKb: 18 * 1024 * 1024, speedMhz: 3200 },
        igpu: { name: '浏览器模拟 iGPU', usage: null, currentMhz: null, memoryMb: null },
        dgpu: { name: '浏览器模拟 dGPU', usage: 8, temperature: 36, currentMhz: 1425, memoryUsedMb: 1200, memoryTotalMb: 6144 },
        system: { bios: 'SIMULATED', manufacturer: '浏览器模拟', model: '模拟设备', sku: 'DEMO' },
        errors: [],
      };
      case 'get_tdp': return [55, 80, 80, 105, 0];
      case 'get_fan_control_snapshot': {
        const seconds = Date.now() / 1000;
        return { running: mock.fanRunning, cpu_temp: Math.round(53 + Math.sin(seconds / 9) * 3), gpu_temp: 36, cpu_fan_rpm: 3150, gpu_fan_rpm: 1790, dropped_samples: 0, sampled_at_ms: Date.now() };
      }
      case 'start_fan_control': if (mock.passiveCooling) throw new Error('厂商被动散热仍在开启'); mock.fanRunning = true; return true;
      case 'stop_fan_control': mock.fanRunning = false; return true;
      case 'update_fan_policy': return true;
      case 'save_fan_config': mock.fanConfig = args.fanData; return true;
      case 'load_fan_config': return mock.fanConfig;
      case 'apply_author_power_profile': {
        mock.profile = args.mode === 'performance' ? 1 : args.mode === 'balanced' ? 2 : 3;
        mock.benchmark = false;
        return { dispatched: true, verified: true, current_profile_index: mock.profile, status: { ok: true } };
      }
      case 'apply_author_benchmark_mode': mock.benchmark = !!args.enabled; return { dispatched: true, status: { ok: true } };
      case 'apply_author_battery_limit': mock.batteryLimit = Number(args.level); return { level: mock.batteryLimit, status: { ok: true } };
      case 'apply_vendor_battery': mock.batteryMode = String(args.mode); if (mock.batteryMode === 'Custom') mock.vendorBatteryLevel = Number(args.level); return { ...result(), mode: mock.batteryMode };
      case 'apply_author_keyboard_basic': mock.keyboardOn = !!args.enabled; mock.keyboardBrightness = Number(args.brightness); return { enabled: mock.keyboardOn, brightness: mock.keyboardBrightness, status: { ok: true } };
      case 'apply_vendor_key': mock.keys[String(args.key)] = !!args.enabled; return { ...result(), key: args.key };
      case 'apply_vendor_osd': return { status: { ok: true } };
      case 'apply_vendor_keyboard_color': mock.keyboardColor = { r: Number(args.r), g: Number(args.g), b: Number(args.b) }; mock.keyboardEffect = 'Monocolor'; mock.keyboardDirection = 'None'; mock.keyboardSpeed = 0; return result();
      case 'apply_vendor_keyboard_effect': mock.keyboardEffect = String(args.effect); mock.keyboardDirection = String(args.direction); mock.keyboardSpeed = Number(args.speed); return result();
      case 'apply_vendor_key_colors': {
        if (mock.keyboardEffect !== 'UserMode' && mock.keyColors.every((color) => color.r + color.g + color.b === 0)) {
          mock.keyColors = mock.keyColors.map(() => ({ ...mock.keyboardColor }));
        }
        for (const index of args.indices as number[]) mock.keyColors[index] = { r: Number(args.r), g: Number(args.g), b: Number(args.b) };
        mock.keyboardEffect = 'UserMode';
        return { ok: true, detail: 'Browser simulator per-key readback', data: vendorData() };
      }
      case 'apply_vendor_key_palette': {
        const colors = args.colors;
        if (!Array.isArray(colors) || colors.length !== 126 || colors.some((color) =>
          !color || !['r', 'g', 'b'].every((channel) => Number.isInteger(color[channel]) && color[channel] >= 0 && color[channel] <= 255))) {
          throw new Error('逐键配置必须包含 126 个有效 RGB 灯位');
        }
        mock.keyColors = colors.map((color) => ({ r: color.r, g: color.g, b: color.b }));
        mock.keyboardEffect = 'UserMode';
        return { ok: true, data: vendorData() };
      }
      case 'apply_vendor_lightbar': {
        const color = { r: Number(args.r), g: Number(args.g), b: Number(args.b) };
        if (args.source === 'battery') mock.lightbarDc = color; else mock.lightbarAc = color;
        mock.breathing = !!args.breathing;
        return result();
      }
      case 'apply_vendor_lightbar_profile': {
        const profile = args.profile;
        if (!profile || !['ac', 'dc'].every((source) => {
          const setting = profile[source];
          return setting && ['Monocolor', 'Rainbow'].includes(setting.effect)
            && ['r', 'g', 'b'].every((channel) => Number.isInteger(setting[channel]) && setting[channel] >= 0 && setting[channel] <= 100);
        }) || typeof profile.breathing !== 'boolean') throw new Error('光条配置无效');
        mock.lightbarAc = { r: profile.ac.r, g: profile.ac.g, b: profile.ac.b };
        mock.lightbarDc = { r: profile.dc.r, g: profile.dc.g, b: profile.dc.b };
        mock.lightbarAcEffect = profile.ac.effect;
        mock.lightbarDcEffect = profile.dc.effect;
        mock.breathing = profile.breathing;
        return { ok: true, data: vendorData() };
      }
      case 'apply_vendor_lightbar_effect': {
        if (args.source === 'battery') mock.lightbarDcEffect = String(args.effect); else mock.lightbarAcEffect = String(args.effect);
        return result();
      }
      case 'apply_vendor_aux_setting': {
        const source = args.source === 'ac' ? 'ac' : 'dc';
        const value = Number(args.value);
        if (args.kind === 'keyboardBrightness') source === 'ac' ? (mock.keyboardBrightnessAc = value) : (mock.keyboardBrightnessDc = value);
        else if (args.kind === 'keyboardIdleTimer') source === 'ac' ? (mock.keyboardIdleAc = value) : (mock.keyboardIdleDc = value);
        else if (args.kind === 'lightbarIdleTimer') source === 'ac' ? (mock.lightbarIdleAc = value) : (mock.lightbarIdleDc = value);
        else throw new Error(`Unknown auxiliary setting ${args.kind}`);
        return { source: args.source, value, verified: true, status: { ok: true, data: vendorData() } };
      }
      case 'apply_vendor_whisper': mock.whisperMode = String(args.mode); mock.whisperFps = Number(args.fps); return result();
      case 'apply_vendor_passive_cooling': if (mock.fanRunning) throw new Error('EC 风扇正在接管'); mock.passiveCooling = !!args.enabled; return { ok: true, data: vendorData() };
      case 'restore_vendor_performance_defaults': if (mock.fanRunning) throw new Error('EC 风扇正在接管'); mock.vendorProfiles = structuredClone(defaultProfiles); return { ok: true, data: vendorData() };
      case 'update_vendor_performance_profile': {
        if (mock.fanRunning) throw new Error('EC 风扇正在接管');
        const key = ({ 1: 'Performance', 2: 'Balanced', 3: 'BatterySaver' } as Record<number, keyof typeof defaultProfiles>)[Number(args.index)];
        const source = args.source as 'ac' | 'dc';
        const cpu = Number(args.cpu);
        const dgpu = Number(args.dgpu);
        if (!key || !['ac', 'dc'].includes(source) || ![1, 2, 3].includes(cpu) || ![1, 2, 3].includes(dgpu)) throw new Error('厂商性能配置参数无效');
        const before = structuredClone(mock.vendorProfiles[key]);
        mock.vendorProfiles[key][source] = { ...before[source], cpu: String(cpu), dgpu: String(dgpu) };
        return { ok: true, data: { ...vendorData(), profileWrite: { before, applied: mock.profile === Number(args.index) } } };
      }
      case 'apply_vendor_display_mode': return { mode: args.mode, verified: false, status: { ok: true, detail: 'Browser simulator: request only' } };
      case 'reset_vendor_display_mode': return { ok: true, detail: 'Browser simulator: saved preset returned; active mode unconfirmed', data: vendorData() };
      case 'apply_vendor_preset_display': {
        const name = ({ gaming: 'Gaming', video: 'Video', reading: 'Reading' } as Record<string, string>)[String(args.mode)];
        const editable = ({ Gaming: ['brightnessAc', 'brightnessDc', 'colorTemp', 'contrast', 'red', 'green', 'blue'], Video: ['brightnessAc', 'brightnessDc', 'colorTemp'], Reading: ['brightnessAc', 'brightnessDc', 'colorTemp', 'blue'] } as Record<string, string[]>)[name];
        const target = presetDisplayModes.find((item) => item.type === name);
        if (!target || !editable) throw new Error('此预设参数不可编辑');
        for (const key of editable) (target as unknown as Record<string, unknown>)[key] = Number(args[key]);
        return { saved_profile_verified: true, activation_requested: true, status: { ok: true, data: vendorData() } };
      }
      case 'apply_vendor_custom_display': {
        mock.custom = { ...mock.custom, ...args };
        return { saved_profile_verified: true, activation_requested: true, status: { ok: true, data: vendorData() } };
      }
      default: throw new Error(`Browser simulator has no ${command} implementation`);
    }
  })();
  return output as T;
}
