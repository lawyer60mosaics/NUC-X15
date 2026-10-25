import { useState, useEffect, useCallback, useRef } from 'react';
import { invokeBackend } from './useTauriApi';

export interface DiagnosticSummary {
  path: string;
  size_bytes: number;
  modified_ms: number | null;
  total_lines: number;
  scanned_lines: number;
  health: string;
  summary: string;
  warning_count: number;
  error_count: number;
  invoke_failure_count: number;
  invoke_timeout_count: number;
  ui_drift_count: number;
  watchdog_reload_count: number;
  watchdog_event_count: number;
  sentinel_event_count: number;
  tdp_drift_count: number;
  tdp_reapply_failed_count: number;
  actor_hung_count: number;
  vendor_failure_count: number;
  hardware_busy_count: number;
  recent_watchdog_events: DiagnosticIssue[];
  recent_issues: DiagnosticIssue[];
}

export interface DiagnosticIssue {
  timestamp_ms: number;
  level: string;
  component: string;
  event: string;
  message: string;
}

export function useDiagnostics(
  showToast: (msg: string) => void,
  getFanPayload?: () => any,
  getFanRunning?: () => boolean,
) {
  // 诊断汇总
  const [summary, setSummary] = useState<DiagnosticSummary | null>(null);

  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('RUNNING DIAGNOSTICS');

  // 前端心跳包序号
  const heartbeatSeq = useRef(0);

  // 刷新诊断详情
  const refreshSummary = useCallback(async () => {
    try {
      const res = await invokeBackend('get_diagnostic_summary');
      if (res) {
        setSummary(res);
      }
    } catch (e: any) {
      console.warn('Failed to read diagnostic summary:', e);
    }
  }, []);

  // 手动测试哨兵卡死自愈
  const runSentinelTest = useCallback(async () => {
    setBusy(true);
    setBusyLabel('TRIGGERING RECOVERY WATCHDOG TEST');
    try {
      const fanData = getFanPayload?.();
      const res = await invokeBackend('force_fan_sentinel_restart', { fanData });
      showToast(res || 'Recovery watchdog test command dispatched.');
      await refreshSummary();
    } catch (e: any) {
      showToast(`Failed to trigger recovery test: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  }, [getFanPayload, refreshSummary, showToast]);

  // 后台向 Rust 定期发送心跳，告知前端处于活动状态，心跳时间 3 秒
  useEffect(() => {
    const heartbeatTimer = setInterval(async () => {
      try {
        heartbeatSeq.current += 1;
        await invokeBackend('frontend_heartbeat', {
          seq: heartbeatSeq.current,
          visible: typeof document === 'undefined' ? true : !document.hidden,
          focused: typeof document !== 'undefined' && typeof document.hasFocus === 'function'
            ? document.hasFocus()
            : false,
          reason: 'interval',
          running: getFanRunning?.() ?? false,
        });
      } catch (e) {
        // ignore heartbeat errors in background
      }
    }, 3000);

    refreshSummary();
    // 定时轮询诊断文件摘要
    const refreshVisibleSummary = () => {
      if (!document.hidden) refreshSummary();
    };
    const diagTimer = setInterval(refreshVisibleSummary, 60000);
    document.addEventListener('visibilitychange', refreshVisibleSummary);

    return () => {
      clearInterval(heartbeatTimer);
      clearInterval(diagTimer);
      document.removeEventListener('visibilitychange', refreshVisibleSummary);
    };
  }, [getFanRunning, refreshSummary]);

  return {
    summary,
    busy,
    busyLabel,
    refreshSummary,
    runSentinelTest,
  };
}
