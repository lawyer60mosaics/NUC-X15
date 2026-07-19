import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { invokeBackend } from './useTauriApi';
import { SimpleGameStrategy } from '../types/appSettings';

export interface PowerProfile {
  label: string;
  cpu1: number;
  cpu2: number;
  gpu1: number;
  gpu2: number;
  gpuClock: string;
  refresh: string;
  boost: string;
  scheme: string;
  desc: string;
}

export interface DisplaySceneProfile {
  label: string;
  subtitle: string;
  target: string;
  desc: string;
}

interface HotProcessSnapshot {
  logical_cores?: number;
  items?: Array<{
    name: string;
    cpu_percent: number;
    heat_score: number;
  }>;
}

interface FanSnapshot {
  cpu_temp?: number;
  mock_cpu_temp?: number;
}

export interface AdaptiveSchedulerState {
  enabled: boolean;
  desiredMode: string;
  activeMode: string;
  status: string;
  reason: string;
  activeCoreEstimate: number;
  logicalCores: number;
  cpuLoadPercent: number;
  topProcess: string;
  lastDecisionAt: number | null;
}

const ADAPTIVE_SCAN_INTERVAL_MS = 12_000;
const GAME_PROCESS_HINTS = [
  'steam',
  'epic',
  'riot',
  'valorant',
  'league',
  'leagueclient',
  'league of legends',
  'lol',
  'dota',
  'cs2',
  'overwatch',
  'genshin',
  'mihoyo',
  'hoyoplay',
  'minecraft',
  'roblox',
  'riotclientservices',
  'game',
];

export const DISPLAY_SCENE_PROFILES: Record<string, DisplaySceneProfile> = {
  reading: {
    label: 'READING',
    subtitle: 'LOW SCAN',
    target: '60Hz',
    desc: 'Prefer 60Hz to reduce visual strain during long documents and bright pages.',
  },
  video: {
    label: 'VIDEO',
    subtitle: 'FRAME PACING',
    target: '60/120Hz',
    desc: 'Prefer 60 or 120Hz for streaming, movies, and efficient power use.',
  },
  gaming: {
    label: 'GAMING',
    subtitle: 'LOW LATENCY',
    target: 'MAX Hz',
    desc: 'Switch to the highest supported refresh rate for gaming and responsive control.',
  },
  office: {
    label: 'OFFICE',
    subtitle: 'SMOOTH + EFFICIENT',
    target: '90/60Hz',
    desc: 'Prefer 90Hz and fall back to 60Hz for everyday productivity.',
  },
  standard: {
    label: 'STANDARD',
    subtitle: 'GENERAL PROFILE',
    target: '60/90/120Hz',
    desc: 'Restore a general refresh profile when the workload is unknown.',
  },
};

export const CPU_POWER_PROFILES: Record<string, PowerProfile> = {
  performance: {
    label: 'MAX PERFORMANCE',
    cpu1: 55,
    cpu2: 80,
    gpu1: 80,
    gpu2: 105,
    gpuClock: 'MAX / RESTORE',
    refresh: 'NO AUTO REFRESH SWITCH',
    boost: 'Aggressive',
    scheme: 'MAX PERFORMANCE',
    desc: 'Heavy workloads: CPU PL1=55W / PL2=80W with aggressive boost cooling.',
  },
  balanced: {
    label: 'BALANCED',
    cpu1: 35,
    cpu2: 50,
    gpu1: 60,
    gpu2: 80,
    gpuClock: 'AROUND 1200MHz',
    refresh: 'NO AUTO REFRESH SWITCH',
    boost: 'Efficient',
    scheme: 'BALANCED',
    desc: 'Web, video, and daily use: lock CPU PL1=35W / PL2=50W to control temperature.',
  },
  powersave: {
    label: 'MAX EFFICIENCY',
    cpu1: 25,
    cpu2: 38,
    gpu1: 40,
    gpu2: 55,
    gpuClock: 'AROUND 900MHz / IGPU FIRST',
    refresh: 'NO AUTO REFRESH SWITCH',
    boost: 'Disabled',
    scheme: 'MAX EFFICIENCY',
    desc: 'Maximum efficiency: limit CPU to 25W / 38W, disable core boost, and extend battery life.',
  },
};

function assertBackendConfirmed(result: any, label: string) {
  if (result === false) {
    throw new Error(`${label} was not confirmed by hardware`);
  }
}

export interface AdaptiveSchedulerOptions {
  tempLimit: number;
  cooldownSec: number;
  simpleGameStrategy: SimpleGameStrategy;
  gameProcessHints: string[];
}

export function usePower(showToast: (msg: string) => void, options?: AdaptiveSchedulerOptions) {
  const [powerMode, setPowerMode] = useState<string>('balanced');
  const [adaptiveScheduler, setAdaptiveScheduler] = useState<AdaptiveSchedulerState>({
    enabled: false,
    desiredMode: 'balanced',
    activeMode: 'balanced',
    status: 'STANDBY',
    reason: 'When enabled, power profiles switch automatically by load, temperature, and game processes.',
    activeCoreEstimate: 0,
    logicalCores: 0,
    cpuLoadPercent: 0,
    topProcess: '--',
    lastDecisionAt: null,
  });
  
  // TDP 滑块的当前实时数值
  const [cpuPl1, setCpuPl1] = useState<number>(45);
  const [cpuPl2, setCpuPl2] = useState<number>(65);
  const [gpuPl1, setGpuPl1] = useState<number>(60);
  const [gpuPl2, setGpuPl2] = useState<number>(80);

  // 刷新率状态
  const [currentHz, setCurrentHz] = useState<number>(60);
  const [supportedHz, setSupportedHz] = useState<number[]>([60]);
  const [displayDevices, setDisplayDevices] = useState<string[]>([]);
  const [displayDetail, setDisplayDetail] = useState<string>('--');
  const [displaySceneMode, setDisplaySceneMode] = useState<string>('standard');
  const [displaySceneDetail, setDisplaySceneDetail] = useState<string>('WAITING FOR DISPLAY PROFILE');

  // 防冲突队列与繁忙状态
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('WAITING FOR BACKEND RESPONSE');
  const queueInFlight = useRef(false);
  const jobQueue = useRef<{ label: string; run: () => Promise<void> }[]>([]);
  const adaptiveEnabledRef = useRef(false);
  const adaptiveModeRef = useRef(powerMode);
  const adaptiveLastSwitchRef = useRef(0);
  const adaptiveCandidateRef = useRef<{ mode: string; count: number }>({ mode: powerMode, count: 0 });
  const adaptiveOptions = {
    tempLimit: options?.tempLimit ?? 88,
    cooldownSec: options?.cooldownSec ?? 45,
    simpleGameStrategy: options?.simpleGameStrategy ?? 'balanced',
    gameProcessHints: options?.gameProcessHints ?? GAME_PROCESS_HINTS,
  };
  const adaptiveGameHints = useMemo(() => Array.from(new Set([
    ...GAME_PROCESS_HINTS,
    ...adaptiveOptions.gameProcessHints,
  ].map((hint) => String(hint || '').trim().toLowerCase()).filter(Boolean))), [adaptiveOptions.gameProcessHints]);

  // 从后端轮询刷新当前 TDP 配置
  const refreshTdp = useCallback(async () => {
    try {
      const tdp = await invokeBackend('get_tdp');
      if (Array.isArray(tdp) && tdp.length >= 4) {
        setCpuPl1(tdp[0]);
        setCpuPl2(tdp[1]);
        setGpuPl1(tdp[2]);
        setGpuPl2(tdp[3]);

        // 判断当前属于哪种模式
        const matched = Object.keys(CPU_POWER_PROFILES).find((key) => {
          const prof = CPU_POWER_PROFILES[key];
          return Math.abs(prof.cpu1 - tdp[0]) <= 2 && Math.abs(prof.cpu2 - tdp[1]) <= 2;
        });
        if (matched) {
          setPowerMode(matched);
        }
      }
    } catch (e: any) {
      console.warn('Failed to read TDP:', e);
    }
  }, []);

  // 轮询屏幕刷新率状态
  const refreshDisplayHz = useCallback(async () => {
    try {
      const res = await invokeBackend('get_display_refresh_status');
      if (res) {
        setCurrentHz(res.current_hz || 60);
        setSupportedHz(res.supported_hz || [60]);
        setDisplayDevices(res.devices || []);
        setDisplayDetail(res.detail || '--');
      }
    } catch (e: any) {
      console.warn('Failed to read display refresh rate:', e);
    }
  }, []);

  // 排队执行 ACPI 功耗写操作，防止并发竞争死锁
  const executeQueue = useCallback(async () => {
    if (queueInFlight.current) return;
    queueInFlight.current = true;
    setBusy(true);

    try {
      while (jobQueue.current.length > 0) {
        const nextJob = jobQueue.current.shift();
        if (nextJob) {
          setBusyLabel(nextJob.label);
          await nextJob.run();
        }
      }
    } finally {
      queueInFlight.current = false;
      setBusy(false);
    }
  }, []);

  // 写入自定义的 TDP 配额
  const applyTdpLimits = useCallback((pl1: number, pl2: number, gpl1: number, gpl2: number) => {
    const job = async () => {
      try {
        const t = { cpu1: pl1, cpu2: pl2, gpu1: gpl1, gpu2: gpl2, tcc: 0 };
        assertBackendConfirmed(await invokeBackend('set_tdp', { t }), 'TDP write');
        assertBackendConfirmed(await invokeBackend('lock_tdp', { t }), 'TDP lock');
        setCpuPl1(pl1);
        setCpuPl2(pl2);
        setGpuPl1(gpl1);
        setGpuPl2(gpl2);
      } catch (e: any) {
        showToast(`Failed to write TDP limits: ${e.message || e}`);
      }
    };
    jobQueue.current.push({ label: 'WRITING TDP LIMITS', run: job });
    executeQueue();
  }, [executeQueue, showToast]);

  // CPU 温控锁定：限制在适合本机散热的范围，同时保留当前 GPU 配额。
  const applyCpuPowerLock = useCallback((pl1: number, pl2: number) => {
    const safePl1 = Math.min(35, Math.max(30, Math.round(pl1)));
    const safePl2 = Math.min(55, Math.max(45, Math.round(pl2)));
    applyTdpLimits(safePl1, safePl2, gpuPl1, gpuPl2);
  }, [applyTdpLimits, gpuPl1, gpuPl2]);

  // 选择预设功耗模式
  const applyPowerMode = useCallback((mode: string, options?: { quiet?: boolean; reason?: string; preserveFanControl?: boolean }) => {
    const profile = CPU_POWER_PROFILES[mode];
    if (!profile) return;

    const job = async () => {
      try {
        // 先调用系统 profile 写功耗，再执行 lock
        await invokeBackend('apply_system_power_profile', {
          mode,
          preserveFanControl: !!options?.preserveFanControl,
        });
        const t = { cpu1: profile.cpu1, cpu2: profile.cpu2, gpu1: profile.gpu1, gpu2: profile.gpu2, tcc: 0 };
        assertBackendConfirmed(await invokeBackend('set_tdp', { t }), 'Power profile write');
        assertBackendConfirmed(await invokeBackend('lock_tdp', { t }), 'Power profile lock');
        
        setPowerMode(mode);
        setCpuPl1(profile.cpu1);
        setCpuPl2(profile.cpu2);
        setGpuPl1(profile.gpu1);
        setGpuPl2(profile.gpu2);
        if (!options?.quiet) {
          showToast(`Power profile switched: ${profile.label}`);
        }
      } catch (e: any) {
        showToast(`Failed to switch power profile: ${e.message || e}`);
      }
    };
    jobQueue.current.push({ label: `SWITCHING TO ${profile.label}`, run: job });
    executeQueue();
  }, [executeQueue, showToast]);

  useEffect(() => {
    adaptiveModeRef.current = powerMode;
    setAdaptiveScheduler((prev) => ({ ...prev, activeMode: powerMode }));
  }, [powerMode]);

  const setAdaptiveSchedulerEnabled = useCallback((enabled: boolean) => {
    adaptiveEnabledRef.current = enabled;
    adaptiveCandidateRef.current = { mode: adaptiveModeRef.current, count: 0 };
    setAdaptiveScheduler((prev) => ({
      ...prev,
      enabled,
      status: enabled ? 'MONITORING' : 'STANDBY',
      reason: enabled ? 'Waiting for the next load sample.' : 'Adaptive scheduling is off; the current power profile is preserved.',
    }));
    showToast(enabled ? 'Adaptive core scheduling enabled' : 'Adaptive core scheduling disabled');
  }, [showToast]);

  const evaluateAdaptiveTarget = useCallback(async () => {
    if (!adaptiveEnabledRef.current || queueInFlight.current) return;

    try {
      const [heat, fan] = await Promise.all([
        invokeBackend('get_hot_processes', { limit: 8 }) as Promise<HotProcessSnapshot>,
        invokeBackend('get_fan_control_snapshot') as Promise<FanSnapshot>,
      ]);
      const items = Array.isArray(heat?.items) ? heat.items : [];
      const logicalCores = Math.max(1, Number(heat?.logical_cores || navigator.hardwareConcurrency || 1));
      const totalCorePercent = items.reduce((sum, item) => sum + Math.max(0, Number(item.cpu_percent || 0)), 0);
      const activeCoreEstimate = Math.min(logicalCores, totalCorePercent / 100);
      const cpuLoadPercent = Math.min(100, (activeCoreEstimate / logicalCores) * 100);
      const top = items[0];
      const topProcess = top ? `${top.name} ${Number(top.cpu_percent || 0).toFixed(0)}%` : '--';
      const cpuTemp = Number(fan?.cpu_temp ?? fan?.mock_cpu_temp ?? 0);
      const gameDetected = items.some((item) => {
        const name = String(item.name || '').toLowerCase();
        return adaptiveGameHints.some((hint) => name.includes(hint));
      });

      let desiredMode = 'powersave';
      let reason = 'Light idle load; switching to efficiency mode to reduce power.';

      if (cpuTemp >= adaptiveOptions.tempLimit) {
        desiredMode = 'powersave';
        reason = `CPU ${cpuTemp.toFixed(0)}°C triggered thermal protection; reducing power first.`;
      } else if (totalCorePercent >= 320 || Number(top?.cpu_percent || 0) >= 220) {
        desiredMode = 'performance';
        reason = `Sustained multi-core load around ${activeCoreEstimate.toFixed(1)} cores; switching to performance.`;
      } else if (gameDetected) {
        desiredMode = adaptiveOptions.simpleGameStrategy;
        reason = adaptiveOptions.simpleGameStrategy === 'performance'
          ? 'Game process detected; switching to performance by policy.'
          : adaptiveOptions.simpleGameStrategy === 'powersave'
          ? 'Game process detected; prioritizing lower power by policy.'
          : 'Game process detected; keeping balanced power to avoid unnecessary spikes.';
      } else if (totalCorePercent >= 90 || cpuTemp >= 62) {
        desiredMode = 'balanced';
        reason = `Medium load around ${activeCoreEstimate.toFixed(1)} cores; keeping balanced power.`;
      }

      const candidate = adaptiveCandidateRef.current;
      const nextCount = candidate.mode === desiredMode ? candidate.count + 1 : 1;
      adaptiveCandidateRef.current = { mode: desiredMode, count: nextCount };

      const currentMode = adaptiveModeRef.current;
      const now = Date.now();
      const isDownshift = currentMode === 'performance' && desiredMode !== 'performance';
      const requiredConfirmations = isDownshift ? 3 : 2;
      const cooldownReady = now - adaptiveLastSwitchRef.current >= adaptiveOptions.cooldownSec * 1000;
      const shouldSwitch = desiredMode !== currentMode && nextCount >= requiredConfirmations && cooldownReady;

      setAdaptiveScheduler((prev) => ({
        ...prev,
        enabled: adaptiveEnabledRef.current,
        desiredMode,
        activeMode: currentMode,
        status: shouldSwitch ? 'SWITCHING' : cooldownReady ? 'MONITORING' : 'COOLDOWN',
        reason,
        activeCoreEstimate: Math.round(activeCoreEstimate * 10) / 10,
        logicalCores,
        cpuLoadPercent: Math.round(cpuLoadPercent),
        topProcess,
        lastDecisionAt: now,
      }));

      if (shouldSwitch) {
        adaptiveLastSwitchRef.current = now;
        applyPowerMode(desiredMode, { quiet: true, reason, preserveFanControl: true });
        showToast(`Adaptive scheduling: ${CPU_POWER_PROFILES[desiredMode].label} · ${reason}`);
      }
    } catch (e: any) {
      setAdaptiveScheduler((prev) => ({
        ...prev,
        status: 'SAMPLE FAILED',
        reason: e?.message || String(e),
      }));
    }
  }, [adaptiveGameHints, adaptiveOptions.cooldownSec, adaptiveOptions.simpleGameStrategy, adaptiveOptions.tempLimit, applyPowerMode, showToast]);

  // 设置屏幕刷新率
  const applyDisplayHz = useCallback(async (hz: number) => {
    setBusy(true);
    setBusyLabel(`SWITCHING DISPLAY REFRESH RATE TO ${hz}Hz`);
    try {
      const res = await invokeBackend('set_display_refresh_rate', { hz });
      if (res) {
        setCurrentHz(res.current_hz || hz);
        showToast(`Display refresh rate set to ${hz}Hz.`);
      }
    } catch (e: any) {
      showToast(`Failed to set display refresh rate: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  }, [showToast]);

  const applyDisplayScene = useCallback(async (mode: string) => {
    const profile = DISPLAY_SCENE_PROFILES[mode];
    if (!profile) return;

    setBusy(true);
    setBusyLabel(`SYNCING DISPLAY PROFILE: ${profile.label}`);
    try {
      const res = await invokeBackend('apply_display_scene_profile', { mode });
      setDisplaySceneMode(mode);
      if (res) {
        setCurrentHz(res.current_hz || currentHz);
        setSupportedHz(res.supported_hz || supportedHz);
        const note = Array.isArray(res.notes) && res.notes.length > 0 ? ` · ${res.notes[0]}` : '';
        setDisplaySceneDetail(`${res.label || profile.label} ${res.current_hz || profile.target}${note}`);
      } else {
        setDisplaySceneDetail(profile.desc);
      }
      showToast(`Display profile switched: ${profile.label}`);
    } catch (e: any) {
      showToast(`Failed to switch display profile: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  }, [currentHz, supportedHz, showToast]);

  // 初始化时轮询一次数据
  useEffect(() => {
    const refreshVisibleTdp = () => {
      if (!document.hidden) refreshTdp();
    };
    refreshVisibleTdp();
    refreshDisplayHz();
    const timer = setInterval(refreshVisibleTdp, 30000);
    document.addEventListener('visibilitychange', refreshVisibleTdp);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshVisibleTdp);
    };
  }, [refreshTdp, refreshDisplayHz]);

  useEffect(() => {
    const evaluateWhenVisible = () => {
      if (!document.hidden) evaluateAdaptiveTarget();
    };
    const timer = window.setInterval(evaluateWhenVisible, ADAPTIVE_SCAN_INTERVAL_MS);
    document.addEventListener('visibilitychange', evaluateWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', evaluateWhenVisible);
    };
  }, [evaluateAdaptiveTarget]);

  useEffect(() => {
    if (adaptiveScheduler.enabled) {
      evaluateAdaptiveTarget();
    }
  }, [adaptiveScheduler.enabled, evaluateAdaptiveTarget]);

  return {
    powerMode,
    adaptiveScheduler,
    setAdaptiveSchedulerEnabled,
    cpuPl1,
    setCpuPl1,
    cpuPl2,
    setCpuPl2,
    gpuPl1,
    setGpuPl1,
    gpuPl2,
    setGpuPl2,
    currentHz,
    supportedHz,
    displayDevices,
    displayDetail,
    displaySceneMode,
    displaySceneDetail,
    busy,
    busyLabel,
    applyTdpLimits,
    applyCpuPowerLock,
    applyPowerMode,
    applyDisplayHz,
    applyDisplayScene,
    refreshTdp,
    refreshDisplayHz,
  };
}
