import { useState, useEffect, useCallback, useRef } from 'react';
import { invokeBackend } from './useTauriApi';

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

export const DISPLAY_SCENE_PROFILES: Record<string, DisplaySceneProfile> = {
  reading: {
    label: '阅读',
    subtitle: '低扫描感',
    target: '60Hz',
    desc: '优先 60Hz，减少长文档滚动和白底页面的视觉刺激。',
  },
  video: {
    label: '视频',
    subtitle: '帧率整除',
    target: '60/120Hz',
    desc: '优先 60 或 120Hz，兼顾在线视频、电影播放和功耗。',
  },
  gaming: {
    label: '游戏',
    subtitle: '最低延迟',
    target: '最高 Hz',
    desc: '切换到面板支持的最高刷新率，适合游戏和高响应操作。',
  },
  office: {
    label: '办公',
    subtitle: '顺滑省电',
    target: '90/60Hz',
    desc: '优先 90Hz，找不到时回落 60Hz，适合日常办公。',
  },
  standard: {
    label: '标准',
    subtitle: '通用档位',
    target: '60/90/120Hz',
    desc: '恢复到通用刷新率档位，适合不确定场景时使用。',
  },
};

export const CPU_POWER_PROFILES: Record<string, PowerProfile> = {
  performance: {
    label: '最佳性能',
    cpu1: 55,
    cpu2: 80,
    gpu1: 80,
    gpu2: 105,
    gpuClock: '最高/恢复',
    refresh: '不自动切换刷新率',
    boost: 'Aggressive',
    scheme: '最佳性能',
    desc: '重负载：限制 CPU PL1=55W / PL2=80W，开启积极 Boost 散热，最大程度释放性能。',
  },
  balanced: {
    label: '平衡',
    cpu1: 45,
    cpu2: 65,
    gpu1: 60,
    gpu2: 80,
    gpuClock: '约 1200MHz',
    refresh: '不自动切换刷新率',
    boost: 'Efficient',
    scheme: '平衡',
    desc: '网页、视频、日常推荐，匹配官方 Balanced 档的 45W / 65W 功耗，稳定安静。',
  },
  powersave: {
    label: '最佳能效',
    cpu1: 25,
    cpu2: 38,
    gpu1: 40,
    gpu2: 55,
    gpuClock: '约 900MHz / 核显优先',
    refresh: '不自动切换刷新率',
    boost: 'Disabled',
    scheme: '最佳能效',
    desc: '强省电：限制 CPU 25W / 38W，关闭核心 Boost，提供最长电池续航与极低静音运行。',
  },
};

export function usePower(showToast: (msg: string) => void) {
  const [powerMode, setPowerMode] = useState<string>('balanced');
  
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
  const [displaySceneDetail, setDisplaySceneDetail] = useState<string>('等待屏幕场景调校');

  // 防冲突队列与繁忙状态
  const [busy, setBusy] = useState(false);
  const queueInFlight = useRef(false);
  const jobQueue = useRef<(() => Promise<void>)[]>([]);

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
      console.warn('获取 TDP 失败:', e);
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
      console.warn('获取屏幕刷新率失败:', e);
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
          await nextJob();
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
        await invokeBackend('set_tdp', { t });
        await invokeBackend('lock_tdp', { t });
        setCpuPl1(pl1);
        setCpuPl2(pl2);
        setGpuPl1(gpl1);
        setGpuPl2(gpl2);
      } catch (e: any) {
        showToast(`TDP 功耗限制写入失败: ${e.message || e}`);
      }
    };
    jobQueue.current.push(job);
    executeQueue();
  }, [executeQueue, showToast]);

  // 选择预设功耗模式
  const applyPowerMode = useCallback((mode: string) => {
    const profile = CPU_POWER_PROFILES[mode];
    if (!profile) return;

    const job = async () => {
      try {
        setPowerMode(mode);
        // 先调用系统 profile 写功耗，再执行 lock
        await invokeBackend('apply_system_power_profile', { mode });
        const t = { cpu1: profile.cpu1, cpu2: profile.cpu2, gpu1: profile.gpu1, gpu2: profile.gpu2, tcc: 0 };
        await invokeBackend('set_tdp', { t });
        await invokeBackend('lock_tdp', { t });
        
        setCpuPl1(profile.cpu1);
        setCpuPl2(profile.cpu2);
        setGpuPl1(profile.gpu1);
        setGpuPl2(profile.gpu2);
        showToast(`已成功切换至功耗模式: ${profile.label}`);
      } catch (e: any) {
        showToast(`模式切换写入失败: ${e.message || e}`);
      }
    };
    jobQueue.current.push(job);
    executeQueue();
  }, [executeQueue, showToast]);

  // 设置屏幕刷新率
  const applyDisplayHz = useCallback(async (hz: number) => {
    setBusy(true);
    try {
      const res = await invokeBackend('set_display_refresh_rate', { hz });
      if (res) {
        setCurrentHz(res.current_hz || hz);
        showToast(`屏幕刷新率已成功设置为 ${hz}Hz。`);
      }
    } catch (e: any) {
      showToast(`屏幕刷新率设置失败: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  }, [showToast]);

  const applyDisplayScene = useCallback(async (mode: string) => {
    const profile = DISPLAY_SCENE_PROFILES[mode];
    if (!profile) return;

    setBusy(true);
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
      showToast(`已切换屏幕场景: ${profile.label}`);
    } catch (e: any) {
      showToast(`屏幕场景切换失败: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  }, [currentHz, supportedHz, showToast]);

  // 初始化时轮询一次数据
  useEffect(() => {
    refreshTdp();
    refreshDisplayHz();
    // 后台功耗状态轮询，防飘移
    const timer = setInterval(refreshTdp, 8000);
    return () => clearInterval(timer);
  }, [refreshTdp, refreshDisplayHz]);

  return {
    powerMode,
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
    applyTdpLimits,
    applyPowerMode,
    applyDisplayHz,
    applyDisplayScene,
    refreshTdp,
    refreshDisplayHz,
  };
}
