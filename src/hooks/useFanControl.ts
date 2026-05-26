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
    label: '静音',
    tags: ['噪音倾向: 低', '散热倾向: 中'],
    ramp: 2,
    hysteresis: 8,
    cpuCap: 35,
    gpuCap: 30,
    cpuCurve: [20, 20, 22, 24, 27, 30, 32, 34, 35, 35, 35],
    gpuCurve: [18, 18, 20, 22, 24, 26, 28, 29, 30, 30, 30],
  },
  office: {
    mode: 'office',
    label: '办公',
    tags: ['噪音倾向: 中低', '散热倾向: 中高'],
    ramp: 3,
    hysteresis: 5,
    cpuCap: 55,
    gpuCap: 45,
    cpuCurve: [20, 22, 24, 28, 32, 38, 44, 49, 53, 55, 55],
    gpuCurve: [18, 20, 22, 26, 30, 34, 38, 41, 44, 45, 45],
  },
  gaming: {
    mode: 'gaming',
    label: '游戏',
    tags: ['噪音倾向: 中高', '散热倾向: 高'],
    ramp: 5,
    hysteresis: 3,
    cpuCap: 80,
    gpuCap: 90,
    cpuCurve: [25, 28, 33, 40, 48, 56, 64, 71, 76, 79, 80],
    gpuCurve: [28, 32, 40, 50, 60, 70, 78, 84, 88, 90, 90],
  },
  performance: {
    mode: 'performance',
    label: '性能',
    tags: ['噪音倾向: 高', '散热倾向: 极高'],
    ramp: 8,
    hysteresis: 2,
    cpuCap: 100,
    gpuCap: 100,
    cpuCurve: [35, 40, 48, 58, 68, 76, 84, 90, 95, 98, 100],
    gpuCurve: [35, 42, 52, 62, 72, 82, 90, 95, 98, 100, 100],
  },
  benchmark: {
    mode: 'benchmark',
    label: '基准',
    tags: ['噪音倾向: 极耗', '散热倾向: 压测'],
    ramp: 12,
    hysteresis: 1,
    cpuCap: 100,
    gpuCap: 100,
    cpuCurve: [45, 55, 65, 76, 86, 94, 100, 100, 100, 100, 100],
    gpuCurve: [45, 58, 70, 82, 92, 100, 100, 100, 100, 100, 100],
  },
};

const FAN_ZERO_RECOVERY_TEMP = 60;
const FAN_ZERO_RECOVERY_STRIKES = 2;

export function useFanControl(showToast: (msg: string) => void) {
  const [running, setRunning] = useState(false);
  const [selectedScenario, setSelectedScenario] = useState('office');
  
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
  const [actorStateText, setActorStateText] = useState('空闲');
  const [droppedSamples, setDroppedSamples] = useState(0);
  const [lastSampledTime, setLastSampledTime] = useState('--');

  const cpuZeroStrikes = useRef(0);
  const gpuZeroStrikes = useRef(0);
  const scenarioRuntimeInFlight = useRef(false);
  const scenarioRuntimeQueued = useRef(false);

  // 初始化风扇曲线为预设场景数据
  const resetCurveToScenario = useCallback((scenarioName: string) => {
    const sc = SCENARIOS[scenarioName] || SCENARIOS.office;
    setCpuCurve(CURVE_TEMPS.map((t, idx) => ({ temperature: t, speed: sc.cpuCurve[idx] })));
    setGpuCurve(CURVE_TEMPS.map((t, idx) => ({ temperature: t, speed: sc.gpuCurve[idx] })));
  }, []);

  // 当选择场景更改时，初始化对应的曲线
  useEffect(() => {
    resetCurveToScenario(selectedScenario);
  }, [selectedScenario, resetCurveToScenario]);

  // 生成传递给底层的 Payload
  const buildPayload = useCallback((overrides?: { timeThemeMode?: TimeThemeMode; startupTakeoverEnabled?: boolean }) => {
    const sc = SCENARIOS[selectedScenario] || SCENARIOS.office;
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
    };
  }, [selectedScenario, cpuCurve, gpuCurve, constantSpeedEnabled, constantSpeed, startupTakeoverEnabled, timeThemeMode]);

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
          showToast('警告: 检测到 CPU 风扇零转速阻塞，启动自愈看门狗强制重启...');
          await invokeBackend('force_fan_sentinel_restart', { fanData: buildPayload() });
          cpuZeroStrikes.current = 0;
        }
      } else {
        gpuZeroStrikes.current += 1;
        if (gpuZeroStrikes.current >= FAN_ZERO_RECOVERY_STRIKES) {
          showToast('警告: 检测到 GPU 风扇零转速阻塞，启动自愈看门狗强制重启...');
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

    try {
      do {
        scenarioRuntimeQueued.current = false;
        const payload = buildPayload();
        if (!running) {
          // 未运行：自启动
          await invokeBackend('start_fan_control', { fanData: payload });
          setRunning(true);
        } else {
          // 运行中：在线策略热更新
          await invokeBackend('update_fan_policy', { fanData: payload });
        }
      } while (scenarioRuntimeQueued.current);
    } catch (e: any) {
      showToast(`策略同步失败: ${e.message || e}`);
    } finally {
      scenarioRuntimeInFlight.current = false;
      setActorState(running ? 'active' : 'idle');
    }
  }, [buildPayload, running, showToast]);

  // 一键开关风扇控制
  const toggleControl = useCallback(async () => {
    try {
      if (running) {
        await invokeBackend('stop_fan_control');
        setRunning(false);
        setActorState('idle');
        setActorStateText('空闲');
        setCpuTemp('--');
        setGpuTemp('--');
        setCpuFanRpm('--');
        setGpuFanRpm('--');
      } else {
        const payload = buildPayload();
        await invokeBackend('start_fan_control', { fanData: payload });
        setRunning(true);
        setActorState('active');
        setActorStateText('正常');
      }
    } catch (e: any) {
      showToast(`切换风扇控制状态失败: ${e.message || e}`);
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
        setActorStateText('空闲');
        return;
      }

      // 执行防卡死看门狗评估
      if (tempLeft > 0) assessFanSafety(tempLeft, fanLeft, true);
      if (tempRight > 0) assessFanSafety(tempRight, fanRight, false);

      if (snap.dropped_samples > 0) {
        setActorState('warn');
        setActorStateText('背压丢样');
      } else {
        setActorState('active');
        setActorStateText('正常');
      }
    } catch (e) {
      setActorState('danger');
      setActorStateText('核心不可用');
    }
  }, [assessFanSafety]);

  // 配置加载与保存
  const saveConfig = useCallback(async () => {
    try {
      const payload = buildPayload();
      await invokeBackend('save_fan_config', { fanData: payload });
      if (running) {
        await invokeBackend('update_fan_policy', { fanData: payload });
      }
      showToast('当前场景策略已保存。');
    } catch (e: any) {
      showToast(`保存策略失败: ${e.message || e}`);
    }
  }, [buildPayload, running, showToast]);

  const setTimeThemeModeAndSave = useCallback(async (mode: TimeThemeMode) => {
    setTimeThemeMode(mode);
    try {
      const payload = buildPayload({ timeThemeMode: mode });
      await invokeBackend('save_fan_config', { fanData: payload });
      showToast(
        mode === 'auto'
          ? '日夜场景已保存为自动切换。'
          : mode === 'day'
            ? '日夜场景已保存为白天模式。'
            : '日夜场景已保存为夜晚模式。'
      );
    } catch (e: any) {
      showToast(`保存日夜场景失败: ${e.message || e}`);
    }
  }, [buildPayload, showToast]);

  const setStartupTakeoverEnabledAndSave = useCallback(async (enabled: boolean) => {
    setStartupTakeoverEnabled(enabled);
    try {
      const payload = buildPayload({ startupTakeoverEnabled: enabled });
      await invokeBackend('save_fan_config', { fanData: payload });
      if (running) {
        await invokeBackend('update_fan_policy', { fanData: payload });
      }
      showToast(enabled ? '启动后接管风扇已保存。' : '启动后接管风扇已关闭并保存。');
    } catch (e: any) {
      showToast(`保存启动接管策略失败: ${e.message || e}`);
    }
  }, [buildPayload, running, showToast]);

  const loadConfig = useCallback(async () => {
    try {
      const fanData = await invokeBackend('load_fan_config');
      if (fanData && fanData.control) {
        const mode = String(fanData.control.mode || fanData.control.preset || 'office');
        if (SCENARIOS[mode]) {
          setSelectedScenario(mode);
        }
        setConstantSpeedEnabled(!!fanData.control.constant_speed_enabled);
        setConstantSpeed(Number(fanData.control.constant_speed ?? 50));
        setStartupTakeoverEnabled(!!fanData.control.startup_takeover_enabled);
        const loadedTheme = String(fanData.appearance?.time_theme_mode || 'auto').toLowerCase();
        setTimeThemeMode(loadedTheme === 'day' || loadedTheme === 'night' ? loadedTheme : 'auto');
        showToast('已成功加载上次保存的配置。');
      }
    } catch (e: any) {
      showToast(`加载策略失败: ${e.message || e}`);
    }
  }, [showToast]);

  // 定时执行轮询监控
  useEffect(() => {
    pollSnapshot(); // 首次即刻触发
    const timer = setInterval(pollSnapshot, 1500);
    return () => clearInterval(timer);
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
