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
  displayScene: 'standard',
  vendorWhisper: 'Off',
  vendorBatteryMode: 'BestBattery',
  vendorBatteryLevel: 60,
  keyboardR: 255,
  keyboardG: 255,
  keyboardB: 255,
  keyboardBrightness: 30,
  lightbarR: 0,
  lightbarG: 255,
  lightbarB: 120,
  lightbarBrightness: 0,
  lightbarBreathing: false,
  fanConfig: null as any,
  diagnostics: {
    totalLines: 12,
    warningCount: 0,
    errorCount: 0,
    watchdogReloadCount: 0,
    actorHungCount: 0,
  }
};

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

    case 'set_tdp':
    case 'lock_tdp':
      if (args?.t) {
        MOCK_STATE.cpuTdp = { pl1: args.t.cpu1, pl2: args.t.cpu2 };
        MOCK_STATE.gpuTdp = { pl1: args.t.gpu1, pl2: args.t.gpu2 };
      } else if (args && args.payload) {
        const [pl1, pl2, gpl1, gpl2] = args.payload;
        MOCK_STATE.cpuTdp = { pl1, pl2 };
        MOCK_STATE.gpuTdp = { pl1: gpl1, pl2: gpl2 };
      }
      return true;

    case 'set_cpu_tdp':
    case 'lock_cpu_tdp':
      if (args?.cpu1 !== undefined && args?.cpu2 !== undefined) {
        MOCK_STATE.cpuTdp = { pl1: args.cpu1, pl2: args.cpu2 };
      } else if (args && args.payload) {
        const [pl1, pl2] = args.payload;
        MOCK_STATE.cpuTdp = { pl1, pl2 };
      }
      return true;

    case 'apply_system_power_profile':
      if (args && args.mode) {
        MOCK_STATE.activeMode = args.mode;
        // 模拟各模式下的默认 TDP
        if (args.mode === 'silent' || args.mode === 'powersave') { MOCK_STATE.cpuTdp = { pl1: 25, pl2: 38 }; }
        else if (args.mode === 'office' || args.mode === 'balanced') { MOCK_STATE.cpuTdp = { pl1: 45, pl2: 65 }; }
        else if (args.mode === 'gaming') { MOCK_STATE.cpuTdp = { pl1: 45, pl2: 65 }; }
        else if (args.mode === 'performance') { MOCK_STATE.cpuTdp = { pl1: 55, pl2: 80 }; }
        else if (args.mode === 'benchmark') { MOCK_STATE.cpuTdp = { pl1: 135, pl2: 145 }; }
      }
      return true;

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

    case 'apply_display_scene_profile': {
      const mode = String(args?.mode || 'standard');
      MOCK_STATE.displayScene = mode;
      const sceneHz: Record<string, number> = {
        reading: 60,
        video: 60,
        gaming: 165,
        office: 90,
        standard: 90,
      };
      MOCK_STATE.displayRefresh = sceneHz[mode] || 90;
      const labels: Record<string, string> = {
        reading: 'READING',
        video: 'VIDEO',
        gaming: 'GAMING',
        office: 'OFFICE',
        standard: 'STANDARD',
      };
      return {
        mode,
        label: labels[mode] || 'STANDARD',
        current_hz: MOCK_STATE.displayRefresh,
        supported_hz: [40, 60, 90, 120, 144, 165],
        detail: `Mock display scene ${mode} -> ${MOCK_STATE.displayRefresh}Hz`,
        notes: ['Browser preview mode simulates refresh-rate switching only.'],
      };
    }

    case 'get_vendor_service_status':
      return {
        ok: true,
        detail: 'UniwillService connected',
        data: {
          connected: true,
          packageFound: true,
          packagePath: 'C:\\Program Files\\UniwillService\\UniwillService.exe',
          processRunning: true,
          endpoint: 'ws://localhost:58594/UniwillService',
          features: ['RGBKeyboard', 'Lightbar', 'WhisperMode', 'BatteryChargingLimit'],
          errors: [],
        },
      };

    case 'apply_vendor_whisper':
      if (args && args.mode) {
        MOCK_STATE.vendorWhisper = args.mode === 'On' ? 'Quiet' : args.mode;
      }
      return {
        mode: MOCK_STATE.vendorWhisper,
        fps: MOCK_STATE.vendorWhisper === 'Off' ? 0 : Number(args?.fps ?? 60),
        status: { ok: true, detail: 'Whisper mode applied', data: {} }
      };

    case 'apply_vendor_battery':
      if (args && args.mode) {
        MOCK_STATE.vendorBatteryMode = args.mode === 'Standard' ? 'Custom' : args.mode === 'FullCharge' ? 'AcMode' : args.mode;
        MOCK_STATE.vendorBatteryLevel = args.level || 80;
      }
      return {
        mode: MOCK_STATE.vendorBatteryMode,
        level: MOCK_STATE.vendorBatteryLevel,
        status: { ok: true, detail: 'Battery charge limit applied', data: {} }
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
