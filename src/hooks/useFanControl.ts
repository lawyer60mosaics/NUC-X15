import { useState, useEffect, useRef, useCallback } from 'react';
import { invokeBackend } from './useTauriApi';

export interface CurvePoint {
  temperature: number;
  speed: number;
}

export type TimeThemeMode = 'auto' | 'day' | 'night';

export const CURVE_TEMPS = [35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85];

export const SCENARIOS: Record<string, {
  mode: string;
  label: string;
  tags: string[];
  ramp: number;
  hysteresis: number;
  cpuCap: number;
  gpuCap: number;
  cpuCurve: number[];
  gpuCurve: number[];
}> = {
  silent: {
    mode: 'silent',
    label: 'SILENT',
    tags: ['NOISE: LOW', 'THERMALS: MEDIUM'],
    ramp: 2,
    hysteresis: 8,
    cpuCap: 45,
    gpuCap: 40,
    cpuCurve: [20, 20, 24, 28, 33, 38, 42, 45, 45, 45, 45],
    gpuCurve: [20, 20, 23, 27, 32, 36, 39, 40, 40, 40, 40],
  },
  balanced: {
    mode: 'office',
    label: 'BALANCED',
    tags: ['NOISE: MEDIUM-LOW', 'THERMALS: MEDIUM-HIGH'],
    ramp: 3,
    hysteresis: 5,
    cpuCap: 70,
    gpuCap: 65,
    cpuCurve: [20, 24, 29, 36, 44, 52, 60, 66, 70, 70, 70],
    gpuCurve: [20, 22, 27, 34, 42, 49, 56, 61, 65, 65, 65],
  },
  performance: {
    mode: 'performance',
    label: 'PERFORMANCE',
    tags: ['NOISE: HIGH', 'THERMALS: EXTREME'],
    ramp: 8,
    hysteresis: 2,
    cpuCap: 100,
    gpuCap: 100,
    cpuCurve: [35, 40, 48, 58, 68, 76, 84, 90, 95, 98, 100],
    gpuCurve: [35, 42, 52, 62, 72, 82, 90, 95, 98, 100, 100],
  },
};

const FAN_ZERO_RECOVERY_TEMP = 60;
const FAN_ZERO_RECOVERY_STRIKES = 2;

export function useFanControl(showToast: (msg: string) => void, getAppSettings?: () => unknown) {
  const [running, setRunning] = useState(false);
  const [selectedScenario, setSelectedScenario] = useState('balanced');
  
  // 曲线数据采用独立的 state 存储，允许进行拖拽微调
  const [cpuCurve, setCpuCurve] = useState<CurvePoint[]>([]);
  const [gpuCurve, setGpuCurve] = useState<CurvePoint[]>([]);

  // 恒速设置
  const [constantSpeedEnabled, setConstantSpeedEnabled] = useState(false);
  const [constantSpeed, setConstantSpeed] = useState(50);
  const [startupTakeoverEnabled, setStartupTakeoverEnabled] = useState(false);
  const [timeThemeMode, setTimeThemeMode] = useState<TimeThemeMode>('auto');

  // 实时传感器数值
  const [cpuTemp, setCpuTemp] = useState<number | '--'>('--');
  const [gpuTemp, setGpuTemp] = useState<number | '--'>('--');
  const [cpuFanRpm, setCpuFanRpm] = useState<number | '--'>('--');
  const [gpuFanRpm, setGpuFanRpm] = useState<number | '--'>('--');

  // 控制核心健康状态
  const [actorState, setActorState] = useState<'idle' | 'active' | 'warn' | 'danger'>('idle');
  const [actorStateText, setActorStateText] = useState('IDLE');
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('WAITING FOR EC BACKEND');
  const [droppedSamples, setDroppedSamples] = useState(0);
  const [lastSampledTime, setLastSampledTime] = useState('--');

  const cpuZeroStrikes = useRef(0);
  const gpuZeroStrikes = useRef(0);
  const scenarioRuntimeInFlight = useRef(false);
  const scenarioRuntimeQueued = useRef(false);

  // 初始化风扇曲线为预设场景数据
  const resetCurveToScenario = useCallback((scenarioName: string) => {
    const sc = SCENARIOS[scenarioName] || SCENARIOS.balanced;
    setCpuCurve(CURVE_TEMPS.map((t, idx) => ({ temperature: t, speed: sc.cpuCurve[idx] })));
    setGpuCurve(CURVE_TEMPS.map((t, idx) => ({ temperature: t, speed: sc.gpuCurve[idx] })));
  }, []);

  // 当选择场景更改时，初始化对应的曲线
  useEffect(() => {
    resetCurveToScenario(selectedScenario);
  }, [selectedScenario, resetCurveToScenario]);

  // 生成传递给底层的 Payload
  const buildPayload = useCallback((overrides?: { timeThemeMode?: TimeThemeMode; startupTakeoverEnabled?: boolean }) => {
    const sc = SCENARIOS[selectedScenario] || SCENARIOS.balanced;
    const resolvedThemeMode = overrides?.timeThemeMode ?? timeThemeMode;
    const resolvedStartupTakeover = overrides?.startupTakeoverEnabled ?? startupTakeoverEnabled;
    return {
      left_fan: cpuCurve,
      right_fan: gpuCurve,
      control: {
        mode: sc.mode,
        strategy: 'independent',
        preset: sc.mode,
        control_mode: constantSpeedEnabled ? 'constant' : 'curve',
        ramp_up_step: sc.ramp,
        ramp_down_step: sc.ramp,
        min_speed: 20,
        zero_rpm_enabled: false,
        zero_rpm_threshold: 45,
        constant_speed_enabled: constantSpeedEnabled,
        constant_speed: constantSpeed,
        startup_takeover_enabled: resolvedStartupTakeover,
        cpu_hysteresis_bandwidth: sc.hysteresis,
        gpu_hysteresis_bandwidth: sc.hysteresis,
        cpu_fan_max_percent: sc.cpuCap,
        gpu_fan_max_percent: sc.gpuCap,
        gpu_linkage_enabled: true,
        gpu_linkage_threshold: 83,
        gpu_linkage_boost: 10,
      },
      alerts: {
        cpu: { threshold: 90, actions: { popup: true, sound: false, log: true, force_shutdown: false, confirm_times: 2 } },
        gpu: { threshold: 90, actions: { popup: true, sound: false, log: true, force_shutdown: false, confirm_times: 2 } },
        recover_delta: 3,
      },
      monitor: {
        sample_interval_ms: 1000,
        log_enabled: true,
      },
      appearance: {
        time_theme_mode: resolvedThemeMode,
      },
      app_settings: getAppSettings?.() ?? undefined,
    };
  }, [selectedScenario, cpuCurve, gpuCurve, constantSpeedEnabled, constantSpeed, startupTakeoverEnabled, timeThemeMode, getAppSettings]);

  // 风扇卡转保护看门狗逻辑
  const assessFanSafety = useCallback(async (tempC: number, fanRpm: number, isCpu: boolean) => {
    if (!running) {
      if (isCpu) cpuZeroStrikes.current = 0;
      else gpuZeroStrikes.current = 0;
      return;
    }

    if (tempC >= FAN_ZERO_RECOVERY_TEMP && fanRpm <= 0) {
      if (isCpu) {
        cpuZeroStrikes.current += 1;
        if (cpuZeroStrikes.current >= FAN_ZERO_RECOVERY_STRIKES) {
          showToast('Warning: CPU fan stall detected. Restarting the recovery watchdog...');
          await invokeBackend('force_fan_sentinel_restart', { fanData: buildPayload() });
          cpuZeroStrikes.current = 0;
        }
      } else {
        gpuZeroStrikes.current += 1;
        if (gpuZeroStrikes.current >= FAN_ZERO_RECOVERY_STRIKES) {
          showToast('Warning: GPU fan stall detected. Restarting the recovery watchdog...');
          await invokeBackend('force_fan_sentinel_restart', { fanData: buildPayload() });
          gpuZeroStrikes.current = 0;
        }
      }
    } else {
      if (isCpu) cpuZeroStrikes.current = 0;
      else gpuZeroStrikes.current = 0;
    }
  }, [buildPayload, running, showToast]);

  // 热更新风扇策略逻辑
  const applyScenarioRuntime = useCallback(async () => {
    if (scenarioRuntimeInFlight.current) {
      scenarioRuntimeQueued.current = true;
      setActorState('warn');
      return;
    }

    scenarioRuntimeInFlight.current = true;
    setActorState('warn');
    setBusy(true);
    setBusyLabel('SYNCING FAN SCENE POLICY');

    let nextRunning = running;
    try {
      do {
        scenarioRuntimeQueued.current = false;
        const payload = buildPayload();
        if (!running) {
          // 未运行：自启动
          await invokeBackend('start_fan_control', { fanData: payload });
          setRunning(true);
          nextRunning = true;
        } else {
          // 运行中：在线策略热更新
          await invokeBackend('update_fan_policy', { fanData: payload });
          nextRunning = true;
        }
      } while (scenarioRuntimeQueued.current);
    } catch (e: any) {
      showToast(`Failed to sync fan policy: ${e.message || e}`);
    } finally {
      scenarioRuntimeInFlight.current = false;
      setBusy(false);
      setActorState(nextRunning ? 'active' : 'idle');
    }
  }, [buildPayload, running, showToast]);

  // 一键开关风扇控制
  const toggleControl = useCallback(async () => {
    setBusy(true);
    setBusyLabel(running ? 'RELEASING EC CONTROL' : 'STARTING EC CONTROL');
    try {
      if (running) {
        await invokeBackend('stop_fan_control');
        setRunning(false);
        setActorState('idle');
        setActorStateText('IDLE');
        setCpuTemp('--');
        setGpuTemp('--');
        setCpuFanRpm('--');
        setGpuFanRpm('--');
      } else {
        const payload = buildPayload();
        await invokeBackend('start_fan_control', { fanData: payload });
        setRunning(true);
        setActorState('active');
        setActorStateText('NORMAL');
      }
    } catch (e: any) {
      showToast(`Failed to switch fan control: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  }, [running, buildPayload, showToast]);

  // 定时轮询风扇运行状态快照
  const pollSnapshot = useCallback(async () => {
    try {
      const snap = await invokeBackend('get_fan_control_snapshot');
      if (!snap) return;

      setRunning(snap.running);
      
      // 读取当前的传感器数据（优先提取 Mock 系统或实际物理状态的属性）
      const tempLeft = snap.mock_cpu_temp ?? snap.cpu_temp ?? 0;
      const tempRight = snap.mock_gpu_temp ?? snap.gpu_temp ?? 0;
      const fanLeft = snap.mock_cpu_fan ?? snap.cpu_fan_rpm ?? 0;
      const fanRight = snap.mock_gpu_fan ?? snap.gpu_fan_rpm ?? 0;

      setCpuTemp(tempLeft > 0 ? tempLeft : '--');
      setGpuTemp(tempRight > 0 ? tempRight : '--');
      setCpuFanRpm(fanLeft > 0 ? fanLeft : '--');
      setGpuFanRpm(fanRight > 0 ? fanRight : '--');

      setDroppedSamples(Number(snap.dropped_samples || 0));
      setLastSampledTime(snap.sampled_at_ms ? new Date(Number(snap.sampled_at_ms)).toLocaleTimeString() : '--');

      if (!snap.running) {
        setActorState('idle');
        setActorStateText('IDLE');
        return;
      }

      // 执行防卡死看门狗评估
      if (tempLeft > 0) assessFanSafety(tempLeft, fanLeft, true);
      if (tempRight > 0) assessFanSafety(tempRight, fanRight, false);

      if (snap.dropped_samples > 0) {
        setActorState('warn');
        setActorStateText('DROPPED SAMPLES');
      } else {
        setActorState('active');
        setActorStateText('NORMAL');
      }
    } catch (e) {
      setActorState('danger');
      setActorStateText('CORE UNAVAILABLE');
    }
  }, [assessFanSafety]);

  // 配置加载与保存
  const saveConfig = useCallback(async () => {
    setBusy(true);
    setBusyLabel('SAVING CURRENT SCENE');
    try {
      const payload = buildPayload();
      await invokeBackend('save_fan_config', { fanData: payload });
      if (running) {
        await invokeBackend('update_fan_policy', { fanData: payload });
      }
      showToast('Current scene policy saved.');
    } catch (e: any) {
      showToast(`Failed to save policy: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  }, [buildPayload, running, showToast]);

  const setTimeThemeModeAndSave = useCallback(async (mode: TimeThemeMode) => {
    setTimeThemeMode(mode);
    setBusy(true);
    setBusyLabel('SAVING DAY/NIGHT SCENE');
    try {
      const payload = buildPayload({ timeThemeMode: mode });
      await invokeBackend('save_fan_config', { fanData: payload });
      showToast(
        mode === 'auto'
          ? 'Day/night scene saved as automatic.'
          : mode === 'day'
            ? 'Day/night scene saved as day mode.'
            : 'Day/night scene saved as night mode.'
      );
    } catch (e: any) {
      showToast(`Failed to save day/night scene: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  }, [buildPayload, showToast]);

  const setStartupTakeoverEnabledAndSave = useCallback(async (enabled: boolean) => {
    setStartupTakeoverEnabled(enabled);
    setBusy(true);
    setBusyLabel('SAVING STARTUP TAKEOVER POLICY');
    try {
      const payload = buildPayload({ startupTakeoverEnabled: enabled });
      await invokeBackend('save_fan_config', { fanData: payload });
      if (running) {
        await invokeBackend('update_fan_policy', { fanData: payload });
      }
      showToast(enabled ? 'Startup fan takeover saved.' : 'Startup fan takeover disabled and saved.');
    } catch (e: any) {
      showToast(`Failed to save startup takeover policy: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  }, [buildPayload, running, showToast]);

  const loadConfig = useCallback(async () => {
    setBusy(true);
    setBusyLabel('LOADING LAST SAVED CONFIGURATION');
    try {
      const fanData = await invokeBackend('load_fan_config');
      if (fanData && fanData.control) {
        const configuredDefaultScenario = String(fanData.app_settings?.default_scenario || '').trim();
        const configuredMode = configuredDefaultScenario || String(fanData.control.mode || fanData.control.preset || 'balanced');
        const mode = configuredMode === 'office' || configuredMode === 'standard' ? 'balanced'
          : configuredMode === 'gaming' ? 'performance' : configuredMode;
        if (SCENARIOS[mode]) {
          setSelectedScenario(mode);
        }
        setConstantSpeedEnabled(!!fanData.control.constant_speed_enabled);
        setConstantSpeed(Number(fanData.control.constant_speed ?? 50));
        setStartupTakeoverEnabled(!!fanData.control.startup_takeover_enabled);
        const loadedTheme = String(fanData.appearance?.time_theme_mode || 'auto').toLowerCase();
        setTimeThemeMode(loadedTheme === 'day' || loadedTheme === 'night' ? loadedTheme : 'auto');
        showToast('Last saved configuration loaded.');
      }
    } catch (e: any) {
      showToast(`Failed to load policy: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  }, [showToast]);

  // 定时执行轮询监控
  useEffect(() => {
    const refreshVisibleSnapshot = () => {
      if (!document.hidden) pollSnapshot();
    };
    refreshVisibleSnapshot();
    const timer = setInterval(refreshVisibleSnapshot, 5000);
    document.addEventListener('visibilitychange', refreshVisibleSnapshot);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshVisibleSnapshot);
    };
  }, [pollSnapshot]);

  // 当外部配置改变时，自动将配置应用到底层（做适当防抖）
  const initialMount = useRef(true);
  useEffect(() => {
    if (initialMount.current) {
      initialMount.current = false;
      loadConfig();
      return;
    }
    // 改变参数触发热重载
    if (running) {
      const delayApply = setTimeout(applyScenarioRuntime, 300);
      return () => clearTimeout(delayApply);
    }
  }, [constantSpeedEnabled, constantSpeed, startupTakeoverEnabled, running, applyScenarioRuntime]);

  return {
    running,
    selectedScenario,
    setSelectedScenario,
    cpuCurve,
    setCpuCurve,
    gpuCurve,
    setGpuCurve,
    constantSpeedEnabled,
    setConstantSpeedEnabled,
    constantSpeed,
    setConstantSpeed,
    startupTakeoverEnabled,
    setStartupTakeoverEnabled: setStartupTakeoverEnabledAndSave,
    timeThemeMode,
    setTimeThemeMode: setTimeThemeModeAndSave,
    cpuTemp,
    gpuTemp,
    cpuFanRpm,
    gpuFanRpm,
    actorState,
    actorStateText,
    busy,
    busyLabel,
    droppedSamples,
    lastSampledTime,
    toggleControl,
    applyScenarioRuntime,
    saveConfig,
    loadConfig,
    buildPayload,
    resetCurveToScenario,
  };
}
