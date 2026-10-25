import { useState, useEffect, useRef, useCallback } from 'react';
import { invokeBackend } from './useTauriApi';
import type { FanScenarioId } from '../types/appSettings';

export interface CurvePoint {
  temperature: number;
  speed: number;
}

export type TimeThemeMode = 'auto' | 'day' | 'night';

export const CURVE_TEMPS = [35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85];

export const SCENARIOS: Record<FanScenarioId, {
  mode: string;
  label: string;
  detailZh: string;
  detailEn: string;
  tags: string[];
  ramp: number;
  hysteresis: number;
  cpuCap: number;
  gpuCap: number;
  cpuCurve: number[];
  gpuCurve: number[];
}> = {
  quiet: {
    mode: 'custom',
    label: 'QUIET',
    detailZh: '仅设置 EC 风扇曲线 · 低噪优先',
    detailEn: 'EC fan curve only · prioritize low noise',
    tags: ['NOISE: LOW', 'FAN LIMIT: 50%'],
    ramp: 2,
    hysteresis: 6,
    cpuCap: 50,
    gpuCap: 50,
    cpuCurve: [20, 20, 24, 29, 34, 39, 44, 48, 50, 50, 50],
    gpuCurve: [20, 20, 23, 28, 33, 39, 44, 48, 50, 50, 50],
  },
  balanced: {
    mode: 'custom',
    label: 'BALANCED',
    detailZh: '仅设置 EC 风扇曲线 · 噪音与散热平衡',
    detailEn: 'EC fan curve only · balance noise and cooling',
    tags: ['NOISE: MEDIUM', 'COOLING: BALANCED'],
    ramp: 5,
    hysteresis: 4,
    cpuCap: 80,
    gpuCap: 80,
    cpuCurve: [25, 28, 34, 42, 50, 58, 66, 72, 76, 79, 80],
    gpuCurve: [25, 29, 36, 44, 52, 60, 68, 74, 78, 80, 80],
  },
  cooling: {
    mode: 'custom',
    label: 'COOLING',
    detailZh: '仅设置 EC 风扇曲线 · 散热优先',
    detailEn: 'EC fan curve only · prioritize cooling',
    tags: ['NOISE: HIGH', 'COOLING: HIGH'],
    ramp: 10,
    hysteresis: 1,
    cpuCap: 100,
    gpuCap: 100,
    cpuCurve: [35, 40, 48, 58, 68, 76, 84, 90, 95, 98, 100],
    gpuCurve: [35, 42, 52, 62, 72, 82, 90, 95, 98, 100, 100],
  },
};

function normalizeFanScenario(scenarioName: string): FanScenarioId {
  switch (scenarioName.trim().toLowerCase()) {
    case 'balanced':
      return 'balanced';
    case 'cooling':
    case 'game':
    case 'gaming':
    case 'performance':
    case 'max':
    case 'benchmark':
    case 'bench':
      return 'cooling';
    default:
      return 'quiet';
  }
}

function curveForScenario(scenarioName: string, side: 'cpu' | 'gpu'): CurvePoint[] {
  const scenario = SCENARIOS[normalizeFanScenario(scenarioName)] || SCENARIOS.quiet;
  const speeds = side === 'cpu' ? scenario.cpuCurve : scenario.gpuCurve;
  return CURVE_TEMPS.map((temperature, index) => ({ temperature, speed: speeds[index] }));
}

function loadedCurve(value: unknown): CurvePoint[] | null {
  if (!Array.isArray(value)) return null;
  const points = value
    .map((point: any) => ({
      temperature: Number(point?.temperature),
      speed: Number(point?.speed),
    }))
    .filter((point) => Number.isFinite(point.temperature) && Number.isFinite(point.speed))
    .sort((left, right) => left.temperature - right.temperature);
  return points.length >= 2 ? points : null;
}

export function useFanControl(showToast: (msg: string) => void, getAppSettings?: () => unknown) {
  const [running, setRunning] = useState(false);
  const [selectedScenario, setSelectedScenarioState] = useState<FanScenarioId>('quiet');
  
  // 曲线数据采用独立的 state 存储，允许进行拖拽微调
  const [cpuCurve, setCpuCurve] = useState<CurvePoint[]>(() => curveForScenario('quiet', 'cpu'));
  const [gpuCurve, setGpuCurve] = useState<CurvePoint[]>(() => curveForScenario('quiet', 'gpu'));

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

  const fanStallNotice = useRef('');
  const scenarioRuntimeInFlight = useRef(false);
  const scenarioRuntimeQueued = useRef(false);

  // 初始化风扇曲线为预设场景数据
  const resetCurveToScenario = useCallback((scenarioName: string) => {
    setCpuCurve(curveForScenario(scenarioName, 'cpu'));
    setGpuCurve(curveForScenario(scenarioName, 'gpu'));
  }, []);

  const setSelectedScenario = useCallback((scenarioName: string) => {
    const scenario = normalizeFanScenario(scenarioName);
    setSelectedScenarioState(scenario);
    resetCurveToScenario(scenario);
  }, [resetCurveToScenario]);

  // 生成传递给底层的 Payload
  const buildPayload = useCallback((overrides?: { timeThemeMode?: TimeThemeMode; startupTakeoverEnabled?: boolean }) => {
    const sc = SCENARIOS[selectedScenario] || SCENARIOS.quiet;
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
        log_enabled: false,
      },
      appearance: {
        time_theme_mode: resolvedThemeMode,
      },
      app_settings: getAppSettings?.() ?? undefined,
    };
  }, [selectedScenario, cpuCurve, gpuCurve, constantSpeedEnabled, constantSpeed, startupTakeoverEnabled, timeThemeMode, getAppSettings]);

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

  const releaseControl = useCallback(async () => {
    if (!running) return;
    setBusy(true);
    setBusyLabel('RELEASING EC CONTROL');
    try {
      await invokeBackend('stop_fan_control');
      setRunning(false);
      setActorState('idle');
      setActorStateText('IDLE');
      setCpuTemp('--');
      setGpuTemp('--');
      setCpuFanRpm('--');
      setGpuFanRpm('--');
    } finally {
      setBusy(false);
    }
  }, [running]);

  // 一键开关风扇控制
  const toggleControl = useCallback(async () => {
    setBusy(true);
    setBusyLabel(running ? 'RELEASING EC CONTROL' : 'STARTING EC CONTROL');
    try {
      if (running) {
        await releaseControl();
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
  }, [running, buildPayload, releaseControl, showToast]);

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
        fanStallNotice.current = '';
        setActorState('idle');
        setActorStateText('IDLE');
        return;
      }

      // 卡转判断与满速保护由后端 EC Actor 执行；前端只显示后端状态，
      // 避免窗口隐藏或前端重复重启控制线程影响保护。
      const stalled = [
        snap.cpu_fan_stalled ? 'CPU' : '',
        snap.gpu_fan_stalled ? 'GPU' : '',
      ].filter(Boolean).join(' + ');
      if (stalled && stalled !== fanStallNotice.current) {
        showToast(`Warning: ${stalled} fan stall detected. EC is forcing both fans to full speed.`);
      }
      fanStallNotice.current = stalled;

      if (stalled) {
        setActorState('danger');
        setActorStateText('FAN STALL · FULL SPEED');
      } else if (snap.dropped_samples > 0) {
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
  }, [showToast]);

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
        const configuredMode = configuredDefaultScenario || String(fanData.control.mode || fanData.control.preset || 'quiet');
        setSelectedScenario(normalizeFanScenario(configuredMode));
        const savedCpuCurve = loadedCurve(fanData.left_fan);
        const savedGpuCurve = loadedCurve(fanData.right_fan);
        if (savedCpuCurve) setCpuCurve(savedCpuCurve);
        if (savedGpuCurve) setGpuCurve(savedGpuCurve);
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
  }, [setSelectedScenario, showToast]);

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
    releaseControl,
    applyScenarioRuntime,
    saveConfig,
    loadConfig,
    buildPayload,
    resetCurveToScenario,
  };
}
