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
        await invokeBackend('set_tdp', { payload: [pl1, pl2, gpl1, gpl2, 0] });
        await invokeBackend('lock_tdp', { payload: [pl1, pl2, gpl1, gpl2, 0] });
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
        await invokeBackend('set_tdp', { payload: [profile.cpu1, profile.cpu2, profile.gpu1, profile.gpu2, 0] });
        await invokeBackend('lock_tdp', { payload: [profile.cpu1, profile.cpu2, profile.gpu1, profile.gpu2, 0] });
        
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
    busy,
    applyTdpLimits,
    applyPowerMode,
    applyDisplayHz,
    refreshTdp,
    refreshDisplayHz,
  };
}
