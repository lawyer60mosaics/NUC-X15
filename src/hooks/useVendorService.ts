import { useState, useEffect, useCallback } from 'react';
import { invokeBackend } from './useTauriApi';

export interface VendorServiceData {
  connected: boolean;
  packageFound: boolean;
  processRunning: boolean;
  endpoint: string;
  features: string[];
  errors: string[];
}

// 颜色转换工具
export function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 255, g: 255, b: 255 };
}

export function rgbToHex(r: number, g: number, b: number) {
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

export function useVendorService(showToast: (msg: string) => void) {
  // 服务运行状态
  const [serviceStatus, setServiceStatus] = useState<string>('DISCONNECTED');
  const [serviceConnected, setServiceConnected] = useState(false);
  const [serviceData, setServiceData] = useState<VendorServiceData | null>(null);

  // Whisper（游戏静音限帧）
  const [whisperMode, setWhisperMode] = useState<string>('Off');
  const [whisperFps, setWhisperFps] = useState<number>(60);

  // 电池养护设置
  const [batteryMode, setBatteryMode] = useState<string>('BestBattery');
  const [batteryLevel, setBatteryLevel] = useState<number>(60);

  // RGB 灯效与亮度
  const [lightingColor, setLightingColor] = useState<string>('#ffffff');
  const [keyboardBrightness, setKeyboardBrightness] = useState<number>(30);
  const [lightbarBrightness, setLightbarBrightness] = useState<number>(0);
  const [lightbarBreathing, setLightbarBreathing] = useState(false);

  // 刷新状态
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('SYNCING VENDOR SERVICE');

  // 轮询并同步服务状态
  const refreshStatus = useCallback(async () => {
    try {
      const res = await invokeBackend('get_vendor_service_status');
      if (res) {
        setServiceConnected(res.ok);
        setServiceStatus(res.ok ? 'SERVICE ONLINE' : 'UNAVAILABLE');
        if (res.data) {
          setServiceData(res.data);
        }
      }
    } catch (e: any) {
      setServiceConnected(false);
      setServiceStatus('COMMUNICATION ERROR');
    }
  }, []);

  // 应用 Whisper（防卡限帧策略）
  const applyWhisper = useCallback(async (mode: string, fpsVal: number) => {
    setBusy(true);
    setBusyLabel('WRITING WHISPER GAME SILENCE POLICY');
    try {
      const res = await invokeBackend('apply_vendor_whisper', { mode, fps: Number(fpsVal) });
      if (res) {
        setWhisperMode(res.mode || mode);
        setWhisperFps(res.fps || fpsVal);
        showToast('Whisper frame limit policy synced to the vendor service.');
      }
    } catch (e: any) {
      showToast(`Failed to apply Whisper: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  }, [showToast]);

  // 应用电池养护方案
  const applyBattery = useCallback(async (mode: string, levelVal: number) => {
    setBusy(true);
    setBusyLabel('WRITING BATTERY CARE LIMIT');
    try {
      const res = await invokeBackend('apply_vendor_battery', { mode, level: Number(levelVal) });
      if (res) {
        setBatteryMode(res.mode || mode);
        setBatteryLevel(res.level || levelVal);
        showToast('Battery care limit written to the EC controller.');
      }
    } catch (e: any) {
      showToast(`Failed to apply battery limit: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  }, [showToast]);

  // 应用 RGB 灯效
  const applyLighting = useCallback(async (colorHex: string, kbBright: number, lbBright: number, breathing: boolean) => {
    setBusy(true);
    setBusyLabel('WRITING KEYBOARD LIGHTING SETTINGS');
    const { r, g, b } = hexToRgb(colorHex);

    try {
      const res = await invokeBackend('apply_vendor_lighting', {
        r,
        g,
        b,
        keyboardBrightness: Number(kbBright),
        lightbarBrightness: Number(lbBright),
        lightbarBreathing: !!breathing,
      });

      if (res) {
        if (res.status && res.status.ok === false) {
          const errors = Array.isArray(res.status.errors) && res.status.errors.length > 0
            ? `: ${res.status.errors.join('; ')}`
            : '';
          throw new Error(`${res.status.detail || 'Vendor service did not confirm lighting write'}${errors}`);
        }
        setLightingColor(rgbToHex(res.r ?? r, res.g ?? g, res.b ?? b));
        setKeyboardBrightness(res.keyboard_brightness ?? kbBright);
        setLightbarBrightness(res.lightbar_brightness ?? lbBright);
        setLightbarBreathing(res.lightbar_breathing ?? breathing);
        showToast('RGB lighting policy written to the peripheral controller.');
      }
    } catch (e: any) {
      showToast(`Failed to apply RGB lighting: ${e.message || e}`);
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
    
    // 初始化读取本地 Preferences
    const cachedLighting = localStorage.getItem('nuctool.lightingPreference');
    if (cachedLighting) {
      try {
        const parsed = JSON.parse(cachedLighting);
        if (parsed.color) setLightingColor(parsed.color);
        if (parsed.keyboardBrightness) setKeyboardBrightness(parsed.keyboardBrightness);
        if (parsed.lightbarBrightness) setLightbarBrightness(parsed.lightbarBrightness);
      } catch (e) {
        // ignore cached format errors
      }
    }

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshVisibleStatus);
    };
  }, [refreshStatus]);

  // 缓存 Preferences
  const saveLightingPreference = useCallback((color: string, kb: number, lb: number) => {
    localStorage.setItem('nuctool.lightingPreference', JSON.stringify({
      color, keyboardBrightness: kb, lightbarBrightness: lb
    }));
  }, []);

  return {
    serviceStatus,
    serviceConnected,
    serviceData,
    whisperMode,
    setWhisperMode,
    whisperFps,
    setWhisperFps,
    batteryMode,
    setBatteryMode,
    batteryLevel,
    setBatteryLevel,
    lightingColor,
    setLightingColor,
    keyboardBrightness,
    setKeyboardBrightness,
    lightbarBrightness,
    setLightbarBrightness,
    lightbarBreathing,
    setLightbarBreathing,
    busy,
    busyLabel,
    applyWhisper,
    applyBattery,
    applyLighting,
    refreshStatus,
    saveLightingPreference,
  };
}
