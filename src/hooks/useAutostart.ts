import { useCallback, useEffect, useState } from 'react';
import { invokeBackend } from './useTauriApi';

export function useAutostart(showToast: (msg: string) => void) {
  const [autostartEnabled, setAutostartEnabledState] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [autostartBusyLabel, setAutostartBusyLabel] = useState('CONFIGURING STARTUP');

  const refreshAutostart = useCallback(async () => {
    try {
      const enabled = await invokeBackend('autostart_status');
      setAutostartEnabledState(!!enabled);
    } catch (e: any) {
      showToast(`Failed to read startup status: ${e.message || e}`);
    }
  }, [showToast]);

  const setAutostartEnabled = useCallback(async (enabled: boolean) => {
    if (autostartBusy) return;
    setAutostartBusy(true);
    setAutostartBusyLabel(enabled ? 'ENABLING STARTUP' : 'DISABLING STARTUP');
    try {
      const actual = await invokeBackend('autostart_set', { enable: enabled });
      setAutostartEnabledState(!!actual);
      showToast(enabled ? 'Launch at startup enabled.' : 'Launch at startup disabled.');
    } catch (e: any) {
      showToast(`Failed to configure startup: ${e.message || e}`);
      await refreshAutostart();
    } finally {
      setAutostartBusy(false);
    }
  }, [autostartBusy, refreshAutostart, showToast]);

  useEffect(() => {
    refreshAutostart();
  }, [refreshAutostart]);

  return {
    autostartEnabled,
    autostartBusy,
    autostartBusyLabel,
    refreshAutostart,
    setAutostartEnabled,
  };
}
