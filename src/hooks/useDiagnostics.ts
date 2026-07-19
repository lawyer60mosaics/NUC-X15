import { useState, useEffect, useCallback, useRef } from 'react';
import { invokeBackend, useTauriEvent } from './useTauriApi';

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

export interface LogEntry {
  id: string;
  time: string;
  tag: string;
  msg: string;
  level: 'info' | 'warn' | 'error';
}

const MAX_FRONTEND_LOGS = 80;

export function useDiagnostics(
  showToast: (msg: string) => void,
  getFanPayload?: () => any,
  getFanRunning?: () => boolean,
) {
  // 诊断汇总
  const [summary, setSummary] = useState<DiagnosticSummary | null>(null);

  // 运行日志队列
  const [logs, setLogs] = useState<LogEntry[]>([]);
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

  // 新增日志行
  const pushLog = useCallback((level: string, tag: string, msg: string) => {
    const time = new Date().toLocaleTimeString();
    const id = `${Date.now()}-${Math.random()}`;
    const entry: LogEntry = {
      id,
      time,
      tag: tag || 'SYSTEM',
      msg: msg || '',
      level: (level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info') as any
    };

    setLogs((prev) => {
      const next = [...prev, entry];
      if (next.length > MAX_FRONTEND_LOGS) {
        return next.slice(next.length - MAX_FRONTEND_LOGS);
      }
      return next;
    });
  }, []);

  // 自动接收后台发出的诊断日志广播
  useTauriEvent('diagnostic_log', (payload: any) => {
    if (payload) {
      pushLog(payload.level || 'info', payload.event || 'IPC', payload.msg || '');
    }
  });

  useTauriEvent('diag', (payload: any) => {
    if (payload) {
      pushLog(payload.level || 'info', payload.event || 'IPC', payload.msg || '');
    }
  });

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

    // 默认推入两条初始化日志
    pushLog('info', 'console', 'NUCtool React frontend loaded successfully.');
    pushLog('info', 'console', 'Recovery WMI subprocess heartbeat connected.');

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
  }, [getFanRunning, refreshSummary, pushLog]);

  return {
    summary,
    logs,
    busy,
    busyLabel,
    pushLog,
    refreshSummary,
    runSentinelTest,
  };
}
