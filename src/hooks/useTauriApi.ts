import { useEffect } from 'react';

// 检测是否在 Tauri WebView 客户端环境中
export const isTauriEnvironment = () => {
  return typeof window !== 'undefined' && !!(window as any).__TAURI__;
};

// 全局 Mock 状态，使得浏览器中模拟交互能实现“设置 -> 获取”的闭环
const MOCK_STATE = {
  autostart: false,
  fanRunning: false,
  activeMode: 'office',
  constantMode: false,
  constantSpeed: 50,
  cpuTdp: { pl1: 45, pl2: 65 },
  gpuTdp: { pl1: 60, pl2: 80 },
  displayRefresh: 60,
  vendorDisplayMode: {
    index: 0,
    type: 'Standard',
    brightnessAc: 72,
    brightnessDc: 58,
    colorTemp: 6500,
    contrast: 1,
    red: 100,
    green: 100,
    blue: 100,
  },
  customDisplay: {
    index: 4,
    type: 'Custom',
    brightnessAc: 50,
    brightnessDc: 50,
    colorTemp: 6500,
    contrast: 50,
    red: 128,
    green: 128,
    blue: 128,
  },
  vendorBatteryMode: 'BestBattery',
  vendorBatteryLevel: 60,
  authorPowerPreset: 'balanced',
  authorPowerPlan: 'balanced',
  authorBenchmarkEnabled: false,
  authorProfileIndex: 2,
  keyboardEnabled: true,
  keyboardR: 255,
  keyboardG: 255,
  keyboardB: 255,
  keyboardBrightness: 30,
  lightbarR: 0,
  lightbarG: 255,
  lightbarB: 120,
  lightbarBrightness: 0,
  lightbarBreathing: false,
  lightbarAc: { r: 49, g: 0, b: 0 },
  lightbarDc: { r: 49, g: 0, b: 0 },
  keyStates: { WinKey: true, FnKey: true, NumPad: true, DisableTouchPadToggle: false } as Record<string, boolean>,
  whisperMode: 'Off',
  whisperFps: 0,
  fanConfig: null as any,
  diagnostics: {
    totalLines: 12,
    warningCount: 0,
    errorCount: 0,
    watchdogReloadCount: 0,
    actorHungCount: 0,
  }
};

function mockVendorServiceData() {
  return {
    connected: true,
    packageFound: true,
    processRunning: true,
    endpoint: 'ws://localhost:58594/UniwillService',
    features: ['KeyboardLedIndividualKeyControl', 'LightbarSingleColor', 'KeyWinLock', 'KeyFnLock', 'KeyNumPad', 'KeyOSD', 'BatteryChargeLimit', 'WhisperMode'],
    keyStates: Object.entries(MOCK_STATE.keyStates).map(([type, state]) => ({ type, state })),
    battery: { mode: MOCK_STATE.vendorBatteryMode, chargingLevel: MOCK_STATE.vendorBatteryLevel },
    whisper: { type: MOCK_STATE.whisperMode, fps: MOCK_STATE.whisperFps },
    savedDisplayModes: [MOCK_STATE.customDisplay],
    lighting: {
      keyboard: { effect: 'Monocolor', colors: [{ r: MOCK_STATE.keyboardR, g: MOCK_STATE.keyboardG, b: MOCK_STATE.keyboardB }], brightnessAc: MOCK_STATE.keyboardBrightness, brightnessDc: MOCK_STATE.keyboardBrightness },
      lightbar: { breathing: MOCK_STATE.lightbarBreathing, ac: { effect: 'Monocolor', ...MOCK_STATE.lightbarAc }, dc: { effect: 'Monocolor', ...MOCK_STATE.lightbarDc } },
    },
    errors: [],
  };
}

// 后端 API 调用抽象
export async function invokeBackend(command: string, args?: any): Promise<any> {
  if (isTauriEnvironment()) {
    const core = (window as any).__TAURI__?.core;
    if (core) {
      return core.invoke(command, args);
    }
  }

  // ------------------ MOCK 浏览器模式数据提供程序 ------------------
  // 模拟网络微弱延时，带来真实交互品质感
  await new Promise((resolve) => setTimeout(resolve, Math.random() * 80 + 30));

  console.log(`[Mock IPC] invoke: ${command}`, args);

  switch (command) {
    case 'get_fan_control_snapshot': {
      // 模拟负载及风扇转速随正弦时间波动
      const sec = Date.now() / 1000;
      const baseTemp = MOCK_STATE.activeMode === 'gaming' ? 62 : 44;
      const wave = Math.sin(sec / 10) * 5;
      const cpuTemp = Math.round(baseTemp + wave + (MOCK_STATE.fanRunning ? -4 : 8));
      const gpuTemp = Math.round(baseTemp - 3 + Math.cos(sec / 8) * 3);
      
      const fanSpeed = MOCK_STATE.constantMode 
        ? MOCK_STATE.constantSpeed 
        : Math.max(20, Math.min(100, Math.round((cpuTemp - 40) * 1.8)));

      return {
        running: MOCK_STATE.fanRunning,
        active_mode: MOCK_STATE.activeMode,
        constant_mode: MOCK_STATE.constantMode,
        constant_speed: MOCK_STATE.constantSpeed,
        cpu_power_limit_w: MOCK_STATE.cpuTdp.pl1,
        cpu_power_short_w: MOCK_STATE.cpuTdp.pl2,
        gpu_power_limit_w: MOCK_STATE.gpuTdp.pl1,
        gpu_power_short_w: MOCK_STATE.gpuTdp.pl2,
        dropped_samples: 0,
        sampled_at_ms: Date.now(),
        // 扩展模拟温度与转速
        mock_cpu_temp: cpuTemp,
        mock_gpu_temp: gpuTemp,
        mock_cpu_fan: Math.round(fanSpeed * 48), // 转换百分比为实际转速 RPM
        mock_gpu_fan: Math.round(fanSpeed * 44),
      };
    }

    case 'get_hot_processes': {
      const sec = Date.now() / 1000;
      const names = ['Code', 'chrome', 'NUCtool', 'powershell', 'explorer', 'Discord', 'Photoshop', 'GameClient'];
      const items = names
        .map((name, idx) => {
          const cpu = Math.max(0, Math.sin(sec / (idx + 2)) * 18 + (idx === 0 ? 32 : idx === 1 ? 24 : 8) - idx * 2);
          const memory = 160 + idx * 145 + Math.cos(sec / 5 + idx) * 40;
          return {
            pid: 2400 + idx * 137,
            name,
            cpu_percent: Math.round(cpu * 10) / 10,
            memory_mb: Math.round(memory * 10) / 10,
            heat_score: Math.round((cpu + memory / 512) * 10) / 10,
          };
        })
        .filter((item) => item.heat_score > 0)
        .sort((a, b) => b.heat_score - a.heat_score)
        .slice(0, Number(args?.limit ?? 10));

      return {
        sampled_at_ms: Date.now(),
        sample_ms: 800,
        logical_cores: 16,
        note: 'Mock: CPU is a short-window equivalent load; 100% equals one fully loaded logical core.',
        items,
      };
    }

    case 'autostart_status':
      return MOCK_STATE.autostart;

    case 'autostart_set':
      if (args && typeof args.enable === 'boolean') {
        MOCK_STATE.autostart = args.enable;
      } else if (args && typeof args.active === 'boolean') {
        MOCK_STATE.autostart = args.active;
      }
      return MOCK_STATE.autostart;

    case 'get_current_fan_mode':
      return MOCK_STATE.activeMode;

    case 'get_tdp':
      return [
        MOCK_STATE.cpuTdp.pl1,
        MOCK_STATE.cpuTdp.pl2,
        MOCK_STATE.gpuTdp.pl1,
        MOCK_STATE.gpuTdp.pl2,
        0, // TCC Offset
      ];

    case 'get_power_source':
      return { source: 'ac', battery_percent: 100 };

    case 'get_system_power_parameters': {
      return {
        scheme_guid: '381b4222-f694-41f0-9685-ff5bb260df2e',
        scheme_alias: 'SCHEME_BALANCED',
        ac_processor_max: 100,
        dc_processor_max: 80,
        ac_boost_mode: 4,
        dc_boost_mode: 4,
        ac_energy_preference: 33,
        dc_energy_preference: 50,
      };
    }

    case 'get_display_refresh_status':
      return {
        current_hz: MOCK_STATE.displayRefresh,
        supported_hz: [40, 60, 90, 120, 144, 165],
        device_count: 1,
        detail: 'EDID - BOE09FA (15.6" UHD 165Hz)',
      devices: [`Internal display 2560x1440 ${MOCK_STATE.displayRefresh}Hz supported=[40,60,90,120,144,165]`],
      };

    case 'set_display_refresh_rate':
      if (args && args.hz) {
        MOCK_STATE.displayRefresh = Number(args.hz);
      }
      return {
        current_hz: MOCK_STATE.displayRefresh,
        supported_hz: [40, 60, 90, 120, 144, 165],
        device_count: 1,
        detail: 'EDID updated successfully',
        devices: [`Internal display 2560x1440 ${MOCK_STATE.displayRefresh}Hz`],
      };

    case 'get_vendor_service_status':
      return {
        ok: true,
        detail: 'UniwillService connected',
        data: mockVendorServiceData(),
      };

    case 'get_author_bridge_status':
      return {
        available: true,
        detail: 'NUCtool.dll file integrity verified (browser preview)',
        hash: '8F7B8338EAF242372FBF096CC9364CA0F60145281ACA17E4E97955945A920875',
      };

    case 'apply_vendor_display_mode': {
      const mode = String(args?.mode || 'standard').toLowerCase();
      const profiles: Record<string, typeof MOCK_STATE.vendorDisplayMode> = {
        standard: { index: 0, type: 'Standard', brightnessAc: 72, brightnessDc: 58, colorTemp: 6500, contrast: 1, red: 100, green: 100, blue: 100 },
        gaming: { index: 1, type: 'Gaming', brightnessAc: 85, brightnessDc: 70, colorTemp: 7000, contrast: 1.08, red: 104, green: 101, blue: 98 },
        video: { index: 2, type: 'Video', brightnessAc: 78, brightnessDc: 62, colorTemp: 6700, contrast: 1.12, red: 106, green: 102, blue: 96 },
        reading: { index: 3, type: 'Reading', brightnessAc: 55, brightnessDc: 45, colorTemp: 4800, contrast: 0.96, red: 100, green: 94, blue: 82 },
      };
      MOCK_STATE.vendorDisplayMode = profiles[mode] || profiles.standard;
      return {
        mode: MOCK_STATE.vendorDisplayMode.type,
        display_mode: null,
        verified: false,
        transport: 'author-nuctool-bridge',
        status: { ok: true, detail: 'Author-compatible display request dispatched; hardware readback is unavailable', data: {} },
      };
    }

    case 'apply_vendor_custom_display':
      MOCK_STATE.customDisplay = { index: 4, type: 'Custom',
        brightnessAc: Number(args?.brightnessAc ?? 50), brightnessDc: Number(args?.brightnessDc ?? 50),
        colorTemp: Number(args?.colorTemp ?? 6500), contrast: Number(args?.contrast ?? 50),
        red: Number(args?.red ?? 128), green: Number(args?.green ?? 128), blue: Number(args?.blue ?? 128) };
      MOCK_STATE.vendorDisplayMode = { ...MOCK_STATE.customDisplay };
      return { profile_index: 4, saved_profile_verified: true, activation_requested: true,
        status: { ok: true, detail: 'Custom profile saved; activation requested', data: mockVendorServiceData() } };

    case 'apply_vendor_battery':
      if (args && args.mode) {
        MOCK_STATE.vendorBatteryMode = args.mode === 'Standard' ? 'Custom' : args.mode === 'FullCharge' ? 'AcMode' : args.mode;
        MOCK_STATE.vendorBatteryLevel = args.level || 80;
      }
      return {
        mode: MOCK_STATE.vendorBatteryMode,
        level: MOCK_STATE.vendorBatteryLevel,
        status: { ok: true, detail: 'Battery mode applied', data: mockVendorServiceData() }
      };

    case 'apply_vendor_key': {
      const key = String(args?.key || '');
      if (!(key in MOCK_STATE.keyStates)) throw new Error('Unknown key');
      MOCK_STATE.keyStates[key] = Boolean(args?.enabled);
      return { key, enabled: MOCK_STATE.keyStates[key], verified: true, status: { ok: true, detail: 'Key state confirmed', data: mockVendorServiceData() } };
    }

    case 'apply_vendor_osd':
      return { enabled: Boolean(args?.enabled), status: { ok: true, detail: 'OSD request sent without readback', data: mockVendorServiceData() } };

    case 'apply_vendor_keyboard_color':
      MOCK_STATE.keyboardR = Number(args?.r ?? 255);
      MOCK_STATE.keyboardG = Number(args?.g ?? 255);
      MOCK_STATE.keyboardB = Number(args?.b ?? 255);
      return { r: MOCK_STATE.keyboardR, g: MOCK_STATE.keyboardG, b: MOCK_STATE.keyboardB, verified: true, status: { ok: true, detail: 'Keyboard color confirmed', data: mockVendorServiceData() } };

    case 'apply_vendor_lightbar': {
      const source = args?.source === 'battery' ? 'battery' : 'ac';
      const color = { r: Number(args?.r ?? 0), g: Number(args?.g ?? 0), b: Number(args?.b ?? 0) };
      if (source === 'ac') MOCK_STATE.lightbarAc = color;
      else MOCK_STATE.lightbarDc = color;
      MOCK_STATE.lightbarBreathing = Boolean(args?.breathing);
      return { source, ...color, breathing: MOCK_STATE.lightbarBreathing, verified: true, status: { ok: true, detail: 'Lightbar confirmed', data: mockVendorServiceData() } };
    }

    case 'apply_vendor_whisper':
      MOCK_STATE.whisperMode = String(args?.mode || 'Off');
      MOCK_STATE.whisperFps = Number(args?.fps || 0);
      return { mode: MOCK_STATE.whisperMode, fps: MOCK_STATE.whisperFps, status: { ok: true, detail: 'Whisper confirmed', data: mockVendorServiceData() } };

    case 'apply_author_power_profile': {
      const mode = String(args?.mode || 'powersave').toLowerCase();
      const profile = ['powersave', 'balanced', 'performance'].includes(mode) ? mode : 'powersave';
      MOCK_STATE.authorPowerPreset = profile;
      MOCK_STATE.authorProfileIndex = profile === 'powersave' ? 3 : profile === 'balanced' ? 2 : 1;
      MOCK_STATE.authorBenchmarkEnabled = false;
      return {
        mode: profile,
        profile_index: profile === 'powersave' ? 3 : profile === 'balanced' ? 2 : 1,
        benchmark_enabled: false,
        dispatched: true,
        verified: true,
        current_profile_index: MOCK_STATE.authorProfileIndex,
        status: { ok: true, detail: 'NUCtool profile readback confirmed; vendor plan was not changed', data: { powerPlanChanged: false, verified: true } },
      };
    }

    case 'apply_author_benchmark_mode': {
      const enabled = Boolean(args?.enabled);
      MOCK_STATE.authorBenchmarkEnabled = enabled;
      if (enabled) MOCK_STATE.authorPowerPlan = 'benchmark';
      return {
        enabled,
        dispatched: true,
        power_plan_index: enabled ? 4 : null,
        status: { ok: true, detail: 'NUCtool benchmark request dispatched; no readback is available', data: { verified: false } },
      };
    }

    case 'read_author_hardware_state':
      return {
        battery_charging_level: MOCK_STATE.vendorBatteryLevel,
        keyboard_leds_power: MOCK_STATE.keyboardEnabled ? 1 : 0,
        keyboard_enabled: MOCK_STATE.keyboardEnabled,
        current_profile_index: MOCK_STATE.authorProfileIndex,
        supported_features_count: 0,
        lightbar_indicators_power: null,
        lightbar_supported: false,
        aurora_installed: false,
        status: { ok: true, detail: 'Simulated hardware readback', data: {} },
      };

    case 'apply_author_power_plan': {
      const mode = String(args?.mode || 'balanced').toLowerCase();
      const plan = ['off', 'performance', 'balanced', 'powersave', 'benchmark'].includes(mode) ? mode : 'balanced';
      MOCK_STATE.authorPowerPlan = plan;
      return {
        mode: plan,
        power_plan_index: plan === 'off' ? 0 : plan === 'performance' ? 1 : plan === 'balanced' ? 2 : plan === 'powersave' ? 3 : 4,
        status: { ok: true, detail: 'NUCtool bridge power plan dispatched', data: {} },
      };
    }

    case 'apply_author_battery_limit':
      MOCK_STATE.vendorBatteryMode = 'Custom';
      MOCK_STATE.vendorBatteryLevel = Math.max(50, Math.min(100, Number(args?.level ?? 60)));
      return {
        level: MOCK_STATE.vendorBatteryLevel,
        status: { ok: true, detail: 'NUCtool bridge battery limit dispatched', data: {} },
      };

    case 'apply_author_keyboard_basic':
      MOCK_STATE.keyboardEnabled = Boolean(args?.enabled);
      MOCK_STATE.keyboardBrightness = Math.max(0, Math.min(100, Number(args?.brightness ?? 30)));
      return {
        enabled: MOCK_STATE.keyboardEnabled,
        brightness: MOCK_STATE.keyboardBrightness,
        status: { ok: true, detail: 'NUCtool bridge keyboard request dispatched', data: {} },
      };

    case 'apply_vendor_lighting':
      if (args) {
        if (args.r !== undefined) MOCK_STATE.keyboardR = args.r;
        if (args.g !== undefined) MOCK_STATE.keyboardG = args.g;
        if (args.b !== undefined) MOCK_STATE.keyboardB = args.b;
        if (args.keyboardBrightness !== undefined) MOCK_STATE.keyboardBrightness = args.keyboardBrightness;
        if (args.keyboard_brightness !== undefined) MOCK_STATE.keyboardBrightness = args.keyboard_brightness;
        if (args.lightbarBrightness !== undefined) MOCK_STATE.lightbarBrightness = args.lightbarBrightness;
        if (args.lightbar_brightness !== undefined) MOCK_STATE.lightbarBrightness = args.lightbar_brightness;
        if (args.lightbarBreathing !== undefined) MOCK_STATE.lightbarBreathing = args.lightbarBreathing;
        if (args.lightbar_breathing !== undefined) MOCK_STATE.lightbarBreathing = args.lightbar_breathing;
      }
      return {
        r: MOCK_STATE.keyboardR,
        g: MOCK_STATE.keyboardG,
        b: MOCK_STATE.keyboardB,
        keyboard_brightness: MOCK_STATE.keyboardBrightness,
        lightbar_brightness: MOCK_STATE.lightbarBrightness,
        lightbar_breathing: MOCK_STATE.lightbarBreathing,
        status: { ok: true, detail: 'Backlight and lighting parameters applied', data: {} }
      };

    case 'get_diagnostic_summary':
      return {
        path: 'C:\\Users\\Developer\\.gemini\\antigravity\\diagnostic.log',
        size_bytes: 42048,
        modified_ms: Date.now() - 3000,
        total_lines: MOCK_STATE.diagnostics.totalLines,
        scanned_lines: MOCK_STATE.diagnostics.totalLines,
        health: 'ok',
        summary: `Thermal core and recovery subprocess are connected. Parsed ${MOCK_STATE.diagnostics.totalLines} diagnostic events.`,
        warning_count: MOCK_STATE.diagnostics.warningCount,
        error_count: MOCK_STATE.diagnostics.errorCount,
        invoke_failure_count: 0,
        invoke_timeout_count: 0,
        ui_drift_count: 0,
        watchdog_reload_count: MOCK_STATE.diagnostics.watchdogReloadCount,
        watchdog_event_count: 0,
        sentinel_event_count: 0,
        tdp_drift_count: 0,
        tdp_reapply_failed_count: 0,
        actor_hung_count: MOCK_STATE.diagnostics.actorHungCount,
        vendor_failure_count: 0,
        hardware_busy_count: 0,
        recent_watchdog_events: [],
        recent_issues: [],
      };

    case 'force_fan_sentinel_restart':
      MOCK_STATE.diagnostics.watchdogReloadCount += 1;
      MOCK_STATE.diagnostics.totalLines += 2;
      return 'Recovery watchdog restart succeeded (local simulation).';

    case 'save_fan_config':
      MOCK_STATE.fanConfig = args?.fanData ?? null;
      return true;

    case 'load_fan_config':
      return MOCK_STATE.fanConfig;

    default:
      return null;
  }
}

// 订阅事件的自定义 Hook（支持 Tauri 广播机制与 Mock 定时事件）
export function useTauriEvent(eventName: string, handler: (payload: any) => void) {
  useEffect(() => {
    let unlistenFn: (() => void) | null = null;
    let mockInterval: any = null;

    async function setupListener() {
      if (isTauriEnvironment()) {
        const listen = (window as any).__TAURI__?.event?.listen;
        if (listen) {
          unlistenFn = await listen(eventName, (event: any) => {
            handler(event.payload);
          });
        }
      } else {
        // Mock 环境下的定时广播，例如每 3 秒触发一次诊断刷新或微弱状态飘移
        if (eventName === 'diagnostic_log' || eventName === 'diag') {
          mockInterval = setInterval(() => {
            const logs = [
              { level: 'info', event: 'ipc.invoke', msg: 'get_fan_control_snapshot completed' },
              { level: 'info', event: 'temp.poll', msg: `Current sensor temperature: CPU=${MOCK_STATE.keyboardBrightness + 25}°C` },
              { level: 'warn', event: 'tdp.check', msg: 'Power profile drift detected; synchronizing correction' }
            ];
            const chosen = logs[Math.floor(Math.random() * logs.length)];
            handler(chosen);
            MOCK_STATE.diagnostics.totalLines += 1;
          }, 3500);
        }
      }
    }

    setupListener();

    return () => {
      if (unlistenFn) {
        unlistenFn();
      }
      if (mockInterval) {
        clearInterval(mockInterval);
      }
    };
  }, [eventName, handler]);
}
