import { useCallback, useEffect, useState } from 'react';
import { invokeBackend } from './useTauriApi';

export function useAutostart(showToast: (msg: string) => void) {
  const [autostartEnabled, setAutostartEnabledState] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);

  const refreshAutostart = useCallback(async () => {
    try {
      const enabled = await invokeBackend('autostart_status');
      setAutostartEnabledState(!!enabled);
    } catch (e: any) {
      showToast(`读取程序自启动状态失败: ${e.message || e}`);
    }
  }, [showToast]);

  const setAutostartEnabled = useCallback(async (enabled: boolean) => {
    if (autostartBusy) return;
    setAutostartBusy(true);
    try {
      const actual = await invokeBackend('autostart_set', { enable: enabled });
      setAutostartEnabledState(!!actual);
      showToast(enabled ? '程序开机自启动已开启。' : '程序开机自启动已关闭。');
    } catch (e: any) {
      showToast(`设置程序自启动失败: ${e.message || e}`);
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
    refreshAutostart,
    setAutostartEnabled,
  };
}
