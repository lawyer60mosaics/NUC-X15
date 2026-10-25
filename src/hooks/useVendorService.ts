import { useState, useEffect, useCallback, useRef } from 'react';
import { invokeBackend } from './useTauriApi';

export interface VendorServiceData {
  connected: boolean;
  packageFound: boolean;
  processRunning: boolean;
  endpoint: string;
  features: string[];
  errors: string[];
  keyStates?: { type: string; state: boolean }[];
  battery?: { mode?: string; chargingLevel?: number } | null;
  whisper?: { type?: string; fps?: number } | null;
  lighting?: {
    keyboard?: { effect?: string; brightnessAc?: number; brightnessDc?: number; colors?: { r: number; g: number; b: number }[] };
    lightbar?: {
      breathing?: boolean;
      ac?: { effect?: string; r: number; g: number; b: number };
      dc?: { effect?: string; r: number; g: number; b: number };
    };
  } | null;
  savedDisplayModes?: VendorDisplayMode[];
  displayMode?: VendorDisplayMode | null;
}

export interface VendorDisplayBridge {
  available: boolean;
  detail: string;
  hash?: string;
}

export interface VendorDisplayMode {
  index: number;
  type: 'Standard' | 'Gaming' | 'Video' | 'Reading' | 'Custom' | string;
  brightnessAc: number;
  brightnessDc: number;
  colorTemp: number;
  contrast: number;
  red: number;
  green: number;
  blue: number;
}

export type VendorDisplayModeId = 'standard' | 'gaming' | 'video' | 'reading';

export interface AuthorHardwareReadback {
  battery_charging_level: number | null;
  keyboard_leds_power: number | null;
  keyboard_enabled: boolean | null;
  current_profile_index: number | null;
  supported_features_count: number | null;
  lightbar_indicators_power: number | null;
  lightbar_supported: boolean | null;
  aurora_installed: boolean | null;
  status: { ok: boolean; detail: string; data: Record<string, unknown> };
}

// 颜色转换工具
export function useVendorService(showToast: (msg: string) => void) {
  // 服务运行状态
  const [serviceStatus, setServiceStatus] = useState<string>('DISCONNECTED');
  const [serviceConnected, setServiceConnected] = useState(false);
  const [serviceData, setServiceData] = useState<VendorServiceData | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<VendorDisplayBridge | null>(null);
  const [displayMode, setDisplayMode] = useState<VendorDisplayMode | null>(null);
  const [lastRequestedDisplayMode, setLastRequestedDisplayMode] = useState<VendorDisplayModeId | 'custom' | null>(null);
  const [lastDisplayModeVerified, setLastDisplayModeVerified] = useState(false);

  // 电池养护设置
  const [batteryMode, setBatteryMode] = useState<string>('BestBattery');
  const [batteryLevel, setBatteryLevelState] = useState<number>(60);
  const [authorReadback, setAuthorReadback] = useState<AuthorHardwareReadback | null>(null);
  const batteryLevelEdited = useRef(false);

  // DLL 读取的设备状态与最近请求分开保存；硬件状态只由 read_author_hardware_state 更新。
  const [authorPowerPreset, setAuthorPowerPreset] = useState<string | null>(null);
  const [authorPowerPlan, setAuthorPowerPlan] = useState<string | null>(null);
  const [authorBenchmarkEnabled, setAuthorBenchmarkEnabled] = useState<boolean | null>(null);
  const [keyboardEnabled, setKeyboardEnabled] = useState(true);

  // NUCtool.dll 支持键盘背光开关与基础亮度，不走旧 RGB / 灯条服务。
  const [keyboardBrightness, setKeyboardBrightness] = useState<number>(30);
  const [lastRequestedOsd, setLastRequestedOsd] = useState<boolean | null>(null);

  // 刷新状态
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('SYNCING VENDOR SERVICE');
  const [serviceStatusReady, setServiceStatusReady] = useState(false);

  const setBatteryLevel = useCallback((level: number) => {
    batteryLevelEdited.current = true;
    setBatteryLevelState(level);
  }, []);

  const refreshAuthorHardwareState = useCallback(async (): Promise<AuthorHardwareReadback | null> => {
    try {
      const state = await invokeBackend('read_author_hardware_state') as AuthorHardwareReadback | null;
      if (!state?.status?.ok) {
        setAuthorReadback(null);
        return null;
      }
      setAuthorReadback(state);
      if (state.battery_charging_level !== null && !batteryLevelEdited.current) {
        setBatteryLevelState(state.battery_charging_level);
      }
      if (state.keyboard_enabled !== null) setKeyboardEnabled(state.keyboard_enabled);
      return state;
    } catch {
      setAuthorReadback(null);
      return null;
    }
  }, []);

  // 轮询并同步服务状态
  const refreshStatus = useCallback(async () => {
    const [serviceResult, bridgeResult] = await Promise.allSettled([
      invokeBackend('get_vendor_service_status'),
      invokeBackend('get_author_bridge_status'),
    ]);
    if (serviceResult.status === 'fulfilled' && serviceResult.value) {
      const res = serviceResult.value;
      setServiceConnected(Boolean(res.ok));
      setServiceStatus(res.ok ? 'SERVICE ONLINE' : 'UNAVAILABLE');
      setServiceData(res.data || null);
      setDisplayMode(res.data?.displayMode || null);
    } else {
      setServiceConnected(false);
      setServiceStatus('COMMUNICATION ERROR');
      setServiceData(null);
      setDisplayMode(null);
    }
    setBridgeStatus(bridgeResult.status === 'fulfilled' && bridgeResult.value
      ? bridgeResult.value as VendorDisplayBridge
      : { available: false, detail: 'NUCtool.dll file status could not be read' });
    setServiceStatusReady(true);
    void refreshAuthorHardwareState();
  }, [refreshAuthorHardwareState]);

  // 非风扇硬件控制统一走作者 NUCtool.dll，不回退到旧 Vendor SDK，避免两套控制覆盖。
  const applyBattery = useCallback(async (levelVal: number): Promise<boolean> => {
    setBusy(true);
    setBusyLabel('APPLYING NUCTOOL BATTERY CHARGE LIMIT');
    try {
      if (!bridgeStatus?.available) {
        throw new Error('NUCtool.dll bridge is unavailable');
      }
      const res = await invokeBackend('apply_author_battery_limit', { level: Number(levelVal) });
      if (res) {
        if (res.status && res.status.ok === false) {
          throw new Error(res.status.detail || 'Battery controller did not accept the request');
        }
        setBatteryMode('Custom');
        setBatteryLevel(res.level ?? levelVal);
        const readback = await refreshAuthorHardwareState();
        const confirmed = readback?.battery_charging_level === (res.level ?? levelVal);
        batteryLevelEdited.current = false;
        showToast(confirmed
          ? 'Battery charge limit confirmed by hardware readback.'
          : 'Battery charge limit request sent, but hardware readback did not confirm the requested level.');
        return true;
      }
      throw new Error('Battery controller returned no confirmation');
    } catch (e: any) {
      showToast(`Failed to apply battery limit: ${e.message || e}`);
      return false;
    } finally {
      setBusy(false);
    }
  }, [bridgeStatus?.available, refreshAuthorHardwareState, showToast]);

  const applyBestBattery = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    setBusyLabel('APPLYING VENDOR BATTERY HEALTH MODE');
    try {
      const res = await invokeBackend('apply_vendor_battery', { mode: 'BestBattery', level: 100 });
      const confirmed = res?.status?.ok && res?.status?.data?.battery?.mode === 'BestBattery';
      if (!confirmed) throw new Error(res?.status?.detail || '官方服务没有确认电池健康模式');
      setServiceData(res.status.data);
      setBatteryMode('BestBattery');
      showToast('最佳电池健康模式已由官方服务读回确认。');
      return true;
    } catch (e: any) {
      showToast(`设置电池健康模式失败：${e.message || e}`);
      return false;
    } finally {
      setBusy(false);
    }
  }, [showToast]);

  const applyStudioKey = useCallback(async (key: string, enabled: boolean): Promise<boolean> => {
    setBusy(true);
    setBusyLabel(`SETTING ${key.toUpperCase()}`);
    try {
      const res = await invokeBackend('apply_vendor_key', { key, enabled });
      if (!res?.verified) throw new Error(res?.status?.detail || '官方服务未确认按键状态');
      setServiceData(res.status.data);
      showToast('按键设置已由官方服务读回确认。');
      return true;
    } catch (e: any) {
      showToast(`按键设置失败：${e.message || e}`);
      return false;
    } finally {
      setBusy(false);
    }
  }, [showToast]);

  const applyStudioOsd = useCallback(async (enabled: boolean): Promise<boolean> => {
    setBusy(true);
    try {
      const res = await invokeBackend('apply_vendor_osd', { enabled });
      if (!res?.status?.ok) throw new Error(res?.status?.detail || '官方服务未接受屏幕提示请求');
      setLastRequestedOsd(enabled);
      showToast(`已向官方服务发送${enabled ? '开启' : '关闭'}屏幕提示请求；此项无状态读回。`);
      return true;
    } catch (e: any) {
      showToast(`屏幕提示设置失败：${e.message || e}`);
      return false;
    } finally {
      setBusy(false);
    }
  }, [showToast]);

  const applyKeyboardColor = useCallback(async (color: { r: number; g: number; b: number }): Promise<boolean> => {
    setBusy(true);
    try {
      const res = await invokeBackend('apply_vendor_keyboard_color', color);
      if (!res?.verified) throw new Error(res?.status?.detail || '键盘颜色未获硬件服务读回确认');
      setServiceData(res.status.data);
      showToast('键盘颜色已由官方服务读回确认。');
      return true;
    } catch (e: any) {
      showToast(`键盘颜色设置失败：${e.message || e}`);
      return false;
    } finally {
      setBusy(false);
    }
  }, [showToast]);

  const applyLightbar = useCallback(async (source: 'ac' | 'battery', color: { r: number; g: number; b: number }, breathing: boolean): Promise<boolean> => {
    setBusy(true);
    try {
      const res = await invokeBackend('apply_vendor_lightbar', { source, ...color, breathing });
      if (!res?.verified) throw new Error(res?.status?.detail || '光条设置未获硬件服务读回确认');
      setServiceData(res.status.data);
      showToast('光条设置已由官方服务读回确认。');
      return true;
    } catch (e: any) {
      showToast(`光条设置失败：${e.message || e}`);
      return false;
    } finally {
      setBusy(false);
    }
  }, [showToast]);

  const applyWhisper = useCallback(async (enabled: boolean): Promise<boolean> => {
    setBusy(true);
    try {
      const res = await invokeBackend('apply_vendor_whisper', { mode: enabled ? 'Quiet' : 'Off', fps: enabled ? 60 : 0 });
      if (!res?.status?.ok) throw new Error(res?.status?.detail || 'WhisperMode 状态未获读回确认');
      setServiceData(res.status.data);
      showToast(`WhisperMode 已${enabled ? '开启' : '关闭'}，官方服务已读回确认。`);
      return true;
    } catch (e: any) {
      showToast(`WhisperMode 设置失败：${e.message || e}`);
      return false;
    } finally {
      setBusy(false);
    }
  }, [showToast]);

  const applyCustomDisplay = useCallback(async (settings: Omit<VendorDisplayMode, 'index' | 'type'>): Promise<boolean> => {
    setBusy(true);
    try {
      const res = await invokeBackend('apply_vendor_custom_display', settings);
      if (!res?.saved_profile_verified || !res?.activation_requested) {
        throw new Error(res?.status?.detail || '自定义画质配置未获服务读回确认');
      }
      setServiceData(res.status.data);
      setLastRequestedDisplayMode('custom');
      showToast('自定义画质已保存并读回；激活请求已发送，当前模式无法读回。');
      return true;
    } catch (e: any) {
      showToast(`自定义画质设置失败：${e.message || e}`);
      return false;
    } finally {
      setBusy(false);
    }
  }, [showToast]);

  const applyAuthorPowerProfile = useCallback(async (mode: string): Promise<boolean> => {
    setBusy(true);
    setBusyLabel(`APPLYING NUCTOOL PROFILE: ${mode.toUpperCase()}`);
    try {
      const res = await invokeBackend('apply_author_power_profile', { mode });
      if (!res?.dispatched) throw new Error(res?.status?.detail || 'NUCtool.dll profile request was not dispatched');
      const requestedProfile = res.mode || mode;
      setAuthorPowerPreset(requestedProfile);
      setAuthorBenchmarkEnabled(false);
      await refreshAuthorHardwareState();
      const confirmed = res.verified === true;
      showToast(confirmed
        ? `NUCtool.dll profile confirmed by hardware readback (index ${res.current_profile_index}). Benchmark disable was requested; vendor plan was left unchanged.`
        : `NUCtool.dll profile request sent, but readback did not confirm index ${res.profile_index}. Vendor plan was left unchanged.`);
      return confirmed;
    } catch (e: any) {
      showToast(`Failed to apply NUCtool profile: ${e.message || e}`);
      return false;
    } finally {
      setBusy(false);
    }
  }, [refreshAuthorHardwareState, showToast]);

  const applyAuthorBenchmarkMode = useCallback(async (enabled: boolean): Promise<boolean> => {
    setBusy(true);
    setBusyLabel(`${enabled ? 'ENABLING' : 'DISABLING'} NUCTOOL BENCHMARK MODE`);
    try {
      const res = await invokeBackend('apply_author_benchmark_mode', { enabled });
      if (!res?.dispatched || res.status?.ok === false) {
        throw new Error(res?.status?.detail || 'NUCtool.dll benchmark request was not dispatched');
      }
      setAuthorBenchmarkEnabled(enabled);
      if (enabled) setAuthorPowerPlan('benchmark');
      const resultData = res.status?.data || {};
      const planIndex = res.power_plan_index == null ? 'unchanged' : String(res.power_plan_index);
      showToast(enabled
        ? `NUCtool.dll benchmark calls returned (connect=${resultData.connectCode ?? 'unknown'}, benchmark=${resultData.benchmarkCode ?? 'unknown'}, plan[${planIndex}]=${resultData.planCode ?? 'unknown'}); hardware state cannot be read back, so acceptance and effect are unconfirmed.`
        : `NUCtool.dll benchmark-disable call returned (connect=${resultData.connectCode ?? 'unknown'}, benchmark=${resultData.benchmarkCode ?? 'unknown'}, plan unchanged); hardware state cannot be read back, so acceptance and effect are unconfirmed.`);
      return true;
    } catch (e: any) {
      showToast(`Failed to change NUCtool benchmark mode: ${e.message || e}`);
      return false;
    } finally {
      setBusy(false);
    }
  }, [showToast]);

  const applyAuthorPowerPlan = useCallback(async (mode: string): Promise<boolean> => {
    setBusy(true);
    setBusyLabel(`APPLYING NUCTOOL POWER PLAN: ${mode.toUpperCase()}`);
    try {
      const res = await invokeBackend('apply_author_power_plan', { mode });
      if (!res?.status?.ok) throw new Error(res?.status?.detail || 'NUCtool.dll did not accept the power-plan request');
      setAuthorPowerPlan(res.mode || mode);
      showToast('NUCtool.dll power-plan request sent; hardware readback is unavailable.');
      return true;
    } catch (e: any) {
      showToast(`Failed to apply NUCtool power plan: ${e.message || e}`);
      return false;
    } finally {
      setBusy(false);
    }
  }, [showToast]);

  const applyKeyboardBasic = useCallback(async (enabled: boolean, brightness: number): Promise<boolean> => {
    setBusy(true);
    setBusyLabel('APPLYING NUCTOOL KEYBOARD BACKLIGHT');
    try {
      const res = await invokeBackend('apply_author_keyboard_basic', { enabled, brightness: Number(brightness) });
      if (!res?.status?.ok) throw new Error(res?.status?.detail || 'NUCtool.dll did not accept the keyboard request');
      setKeyboardEnabled(res.enabled ?? enabled);
      setKeyboardBrightness(res.brightness ?? brightness);
      const readback = await refreshAuthorHardwareState();
      const switchConfirmed = readback?.keyboard_enabled === (res.enabled ?? enabled);
      showToast(switchConfirmed
        ? 'Keyboard switch state confirmed by hardware readback; brightness remains a request value.'
        : 'Keyboard request sent, but hardware readback did not confirm the switch state or brightness.');
      return true;
    } catch (e: any) {
      showToast(`Failed to apply keyboard backlight: ${e.message || e}`);
      return false;
    } finally {
      setBusy(false);
    }
  }, [refreshAuthorHardwareState, showToast]);

  // 优先调用作者兼容桥接层：固定模式编号 0~3，并先开启显示模式管理。
  // 桥接 DLL 没有可靠回读时，状态只能是“已发送”，不能冒充硬件已确认。
  const applyDisplayMode = useCallback(async (mode: VendorDisplayModeId): Promise<boolean> => {
    setBusy(true);
    setBusyLabel(`APPLYING VENDOR DISPLAY MODE: ${mode.toUpperCase()}`);
    try {
      const res = await invokeBackend('apply_vendor_display_mode', { mode });
      if (!res?.status?.ok) {
        throw new Error(res?.status?.detail || 'Vendor service did not accept the display mode request');
      }
      const requested = String(res.mode || mode).toLowerCase() as VendorDisplayModeId;
      setLastRequestedDisplayMode(requested);
      setLastDisplayModeVerified(Boolean(res.verified));
      if (res.verified && res.display_mode) {
        setDisplayMode(res.display_mode);
        setServiceData((current) => current ? { ...current, displayMode: res.display_mode } : current);
        showToast('Vendor visual profile applied and verified.');
      } else {
        showToast('Visual profile request sent through the compatibility bridge; hardware readback is unavailable.');
      }
      return true;
    } catch (e: any) {
      showToast(`Failed to apply visual profile: ${e.message || e}`);
      return false;
    } finally {
      setBusy(false);
    }
  }, [showToast]);

  // 从本地 Preferences 缓存或默认值加载
  useEffect(() => {
    const refreshVisibleStatus = () => {
      if (!document.hidden) refreshStatus();
    };
    refreshVisibleStatus();
    const timer = setInterval(refreshVisibleStatus, 60000);
    document.addEventListener('visibilitychange', refreshVisibleStatus);
    
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshVisibleStatus);
    };
  }, [refreshStatus]);

  return {
    serviceStatus,
    serviceConnected,
    serviceStatusReady,
    serviceData,
    displayMode,
    displayBridgeAvailable: Boolean(bridgeStatus?.available),
    displayBridgeDetail: bridgeStatus?.detail || 'NUCtool.dll file status has not been checked',
    lastRequestedDisplayMode,
    lastDisplayModeVerified,
    batteryMode,
    setBatteryMode,
    batteryLevel,
    setBatteryLevel,
    authorReadback,
    refreshAuthorHardwareState,
    authorPowerPreset,
    authorPowerPlan,
    authorBenchmarkEnabled,
    keyboardEnabled,
    keyboardBrightness,
    lastRequestedOsd,
    setKeyboardBrightness,
    busy,
    busyLabel,
    applyBattery,
    applyBestBattery,
    applyStudioKey,
    applyStudioOsd,
    applyKeyboardColor,
    applyLightbar,
    applyWhisper,
    applyCustomDisplay,
    applyAuthorPowerProfile,
    applyAuthorBenchmarkMode,
    applyAuthorPowerPlan,
    applyKeyboardBasic,
    applyDisplayMode,
    refreshStatus,
  };
}
