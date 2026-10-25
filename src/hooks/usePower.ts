import { useState, useEffect, useCallback } from 'react';
import { invokeBackend } from './useTauriApi';

export interface SystemPowerParameters {
  scheme_guid: string;
  scheme_alias: string;
  ac_processor_max: number;
  dc_processor_max: number;
  ac_boost_mode: number;
  dc_boost_mode: number;
  ac_energy_preference: number;
  dc_energy_preference: number;
}

export type PowerSource = 'ac' | 'battery' | 'unknown';

// This hook only reads power state and changes the Windows display refresh rate.
// Fan writes live in useFanControl; device performance writes live in useVendorService.
export function usePower(showToast: (msg: string) => void) {
  const [cpuPl1, setCpuPl1] = useState(45);
  const [cpuPl2, setCpuPl2] = useState(65);
  const [gpuPl1, setGpuPl1] = useState(60);
  const [gpuPl2, setGpuPl2] = useState(80);
  const [systemPowerParameters, setSystemPowerParameters] = useState<SystemPowerParameters | null>(null);
  const [powerSource, setPowerSource] = useState<PowerSource>('unknown');
  const [batteryPercent, setBatteryPercent] = useState<number | null>(null);
  const [currentHz, setCurrentHz] = useState(60);
  const [supportedHz, setSupportedHz] = useState<number[]>([60]);
  const [displayDevices, setDisplayDevices] = useState<string[]>([]);
  const [displayDetail, setDisplayDetail] = useState('--');
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('READING POWER STATE');

  const refreshTdp = useCallback(async () => {
    try {
      const tdp = await invokeBackend('get_tdp');
      if (Array.isArray(tdp) && tdp.length >= 4) {
        setCpuPl1(tdp[0]);
        setCpuPl2(tdp[1]);
        setGpuPl1(tdp[2]);
        setGpuPl2(tdp[3]);
      }
    } catch (error) {
      console.warn('Failed to read TDP:', error);
    }
  }, []);

  const refreshSystemPowerParameters = useCallback(async () => {
    try {
      const parameters = await invokeBackend('get_system_power_parameters');
      if (parameters) setSystemPowerParameters(parameters);
    } catch (error) {
      console.warn('Failed to read system power parameters:', error);
    }
  }, []);

  const refreshPowerSource = useCallback(async () => {
    try {
      const status = await invokeBackend('get_power_source');
      const source: PowerSource = status?.source === 'ac' || status?.source === 'battery' ? status.source : 'unknown';
      setPowerSource(source);
      const reportedPercent = status?.battery_percent;
      setBatteryPercent(reportedPercent == null || !Number.isFinite(Number(reportedPercent))
        ? null
        : Number(reportedPercent));
    } catch {
      setPowerSource('unknown');
      setBatteryPercent(null);
    }
  }, []);

  const refreshDisplayHz = useCallback(async () => {
    try {
      const res = await invokeBackend('get_display_refresh_status');
      if (res) {
        setCurrentHz(res.current_hz || 60);
        setSupportedHz(res.supported_hz || [60]);
        setDisplayDevices(res.devices || []);
        setDisplayDetail(res.detail || '--');
      }
    } catch (error) {
      console.warn('Failed to read display refresh rate:', error);
    }
  }, []);

  const applyDisplayHz = useCallback(async (hz: number): Promise<boolean> => {
    if (!Number.isFinite(hz) || hz <= 0) return false;
    setBusy(true);
    setBusyLabel(`SWITCHING DISPLAY REFRESH RATE TO ${hz}Hz`);
    try {
      const res = await invokeBackend('set_display_refresh_rate', { hz });
      if (!res) throw new Error('Windows display service returned no confirmation');
      setCurrentHz(res.current_hz || hz);
      setSupportedHz(res.supported_hz || supportedHz);
      setDisplayDevices(res.devices || displayDevices);
      setDisplayDetail(res.detail || displayDetail);
      showToast(`Display refresh rate set to ${hz}Hz.`);
      return true;
    } catch (error) {
      showToast(`Failed to set display refresh rate: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    } finally {
      setBusy(false);
    }
  }, [displayDetail, displayDevices, showToast, supportedHz]);

  useEffect(() => {
    const refreshVisibleTdp = () => {
      if (!document.hidden) void refreshTdp();
    };
    refreshVisibleTdp();
    void refreshSystemPowerParameters();
    void refreshPowerSource();
    void refreshDisplayHz();
    const timer = window.setInterval(() => {
      refreshVisibleTdp();
      void refreshSystemPowerParameters();
      void refreshPowerSource();
    }, 30000);
    document.addEventListener('visibilitychange', refreshVisibleTdp);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshVisibleTdp);
    };
  }, [refreshTdp, refreshSystemPowerParameters, refreshPowerSource, refreshDisplayHz]);

  return {
    cpuPl1,
    cpuPl2,
    gpuPl1,
    gpuPl2,
    systemPowerParameters,
    powerSource,
    batteryPercent,
    currentHz,
    supportedHz,
    displayDevices,
    displayDetail,
    busy,
    busyLabel,
    applyDisplayHz,
    refreshTdp,
    refreshSystemPowerParameters,
    refreshPowerSource,
    refreshDisplayHz,
  };
}
