import React, { useState, useEffect } from 'react';
import SurfaceCard from './SurfaceCard';
import { DiagnosticSummary } from '../hooks/useDiagnostics';
import { invokeBackend } from '../hooks/useTauriApi';
import { tr } from '../i18n';

interface MonitorSectionProps {
  cpuTemp: number | '--';
  gpuTemp: number | '--';
  summary: DiagnosticSummary | null;
  runSentinelTest: () => void;
  language?: 'en' | 'zh';
}

interface HotProcess {
  pid: number;
  name: string;
  cpu_percent: number;
  memory_mb: number;
  heat_score: number;
}

interface HotProcessSnapshot {
  sampled_at_ms: number;
  sample_ms: number;
  logical_cores: number;
  note: string;
  items: HotProcess[];
}

const WATCHDOG_LIVE_WINDOW_MS = 120_000;
const WATCHDOG_STALE_LOG_MS = 150_000;

export const MonitorSection: React.FC<MonitorSectionProps> = ({
  cpuTemp,
  gpuTemp,
  summary,
  runSentinelTest,
  language = 'en',
}) => {
  const isZh = language === 'zh';
  const [hotProcessSnapshot, setHotProcessSnapshot] = useState<HotProcessSnapshot | null>(null);
  const [hotProcessError, setHotProcessError] = useState<string>('');
  const statusNow = Date.now();
  const liveWatchdogEvents = (summary?.recent_watchdog_events ?? [])
    .filter((issue) => statusNow - issue.timestamp_ms <= WATCHDOG_LIVE_WINDOW_MS)
    .filter((issue) => !issue.event.startsWith('manual_test.'));

  useEffect(() => {
    let disposed = false;

    const refreshHotProcesses = async () => {
      if (document.hidden) return;
      try {
        const res = await invokeBackend('get_hot_processes', { limit: 10 });
        if (!disposed && res) {
          setHotProcessSnapshot(res);
          setHotProcessError('');
        }
      } catch (e: any) {
        if (!disposed) {
          setHotProcessError(e?.message || String(e));
        }
      }
    };

    refreshHotProcesses();
    const timer = window.setInterval(refreshHotProcesses, 30000);
    document.addEventListener('visibilitychange', refreshHotProcesses);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshHotProcesses);
    };
  }, []);

  // 计算健康等级
  const getHealthStatus = () => {
    if (!summary) return { label: tr(language, 'DISCONNECTED', '未连接'), color: '#64748b', bg: 'rgba(100, 116, 139, 0.16)' };
    if (summary.modified_ms && statusNow - summary.modified_ms > WATCHDOG_STALE_LOG_MS) {
      return { label: tr(language, 'STALE', '无心跳'), color: '#a16207', bg: 'rgba(161, 98, 7, 0.14)' };
    }
    const recentIssues = [
      ...(summary.recent_issues ?? []).filter((issue) => statusNow - issue.timestamp_ms <= WATCHDOG_LIVE_WINDOW_MS),
      ...liveWatchdogEvents,
    ];
    if (recentIssues.some((issue) => issue.level === 'error' || issue.event.includes('hung'))) {
      return { label: tr(language, 'DEGRADED', '异常'), color: '#dc2626', bg: 'rgba(220, 38, 38, 0.14)' };
    }
    if (recentIssues.some((issue) => issue.level === 'warn')) {
      return { label: tr(language, 'CAUTION', '注意'), color: '#a16207', bg: 'rgba(161, 98, 7, 0.14)' };
    }
    return { label: tr(language, 'EXCELLENT', '良好'), color: '#047857', bg: 'rgba(4, 120, 87, 0.14)' };
  };

  const health = getHealthStatus();
  const sentinelEventCount = liveWatchdogEvents.filter((issue) =>
    issue.component === 'fan_sentinel' || issue.component === 'external_sentinel'
  ).length;
  const watchdogEventCount = liveWatchdogEvents.length;
  const hottestScore = Math.max(1, ...(hotProcessSnapshot?.items ?? []).map((item) => item.heat_score || 0));

  const diagnosticRows = [
    [isZh ? '看门狗恢复' : 'WATCHDOG RECOVERIES', summary?.watchdog_reload_count ?? 0],
    [isZh ? 'ACPI 忙碌阻塞' : 'ACPI BUSY BLOCKS', summary?.hardware_busy_count ?? 0],
    [isZh ? '厂商服务失败' : 'VENDOR IO FAILURES', summary?.vendor_failure_count ?? 0],
    [isZh ? '内核错误' : 'KERNEL ERRORS', summary?.error_count ?? 0],
    [isZh ? '内核警告' : 'KERNEL WARNINGS', summary?.warning_count ?? 0],
    [isZh ? '调用超时' : 'COMMAND TIMEOUTS', summary?.invoke_timeout_count ?? 0],
  ];

  return (
    <div className="dashboard-section monitor-section">
      <div className="section-intro">
        <span className="section-kicker">{isZh ? '02 / 监控' : '02 / MONITOR'}</span>
        <h2>{isZh ? '系统监控' : 'SYSTEM MONITOR'}</h2>
        <p>{isZh ? '查看健康状态、诊断事件和高负载进程。' : 'Review health status, diagnostic events, and high-load processes.'}</p>
      </div>

      <SurfaceCard className="module-card watchdog-card">
        <div className="panel-header">
          <div>
            <span className="panel-kicker">{isZh ? '恢复机制' : 'RECOVERY'}</span>
            <h3>{isZh ? '自愈看门狗' : 'RECOVERY WATCHDOG'}</h3>
            <p>{isZh ? '持续检查控制核心、WMI 与前端心跳，确认故障后执行受控重启。' : 'Checks the control core, WMI, and frontend heartbeat; confirmed faults trigger a controlled restart.'}</p>
          </div>
          <button className="button button-danger" type="button" onClick={runSentinelTest}>{isZh ? '运行恢复测试' : 'RUN RECOVERY TEST'}</button>
        </div>
        <div className="metric-grid">
          {[
            { label: isZh ? '当前状态' : 'CURRENT STATUS', value: health.label },
            { label: isZh ? '哨兵事件' : 'SENTINEL EVENTS', value: sentinelEventCount },
            { label: isZh ? '看门狗事件' : 'WATCHDOG EVENTS', value: watchdogEventCount },
            { label: isZh ? '恢复次数' : 'RECOVERY COUNT', value: summary?.watchdog_reload_count ?? 0 },
          ].map((item) => <div className="metric-tile" key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>)}
        </div>
      </SurfaceCard>

      <div className="monitor-grid monitor-grid-single">
        <div className="module-stack">
          <SurfaceCard className="module-card">
            <div className="panel-header compact"><div><span className="panel-kicker">{isZh ? '遥测' : 'TELEMETRY'}</span><h3>{isZh ? '实时温度' : 'LIVE TEMPERATURE'}</h3></div></div>
            <div className="metric-grid metric-grid-two">
              <div className="metric-tile"><span>CPU</span><strong>{cpuTemp === '--' ? '--' : `${cpuTemp}°C`}</strong></div>
              <div className="metric-tile"><span>GPU</span><strong>{gpuTemp === '--' ? '--' : `${gpuTemp}°C`}</strong></div>
            </div>
          </SurfaceCard>

          <SurfaceCard className="module-card">
            <div className="panel-header compact">
              <div><span className="panel-kicker">{isZh ? '诊断' : 'DIAGNOSTICS'}</span><h3>{isZh ? '内核与 ACPI' : 'KERNEL & ACPI'}</h3></div>
              <span className="status-badge" style={{ color: health.color, borderColor: health.color }}>{health.label}</span>
            </div>
            <dl className="diagnostic-list">
              {diagnosticRows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
            </dl>
          </SurfaceCard>

          <SurfaceCard className="module-card process-card">
            <div className="panel-header compact">
              <div><span className="panel-kicker">{isZh ? '进程' : 'PROCESSES'}</span><h3>{isZh ? '高负载进程' : 'HIGH-LOAD PROCESSES'}</h3><p>{isZh ? '按短期 CPU 增量与内存占用排序。' : 'Ranked by short-term CPU delta and memory usage.'}</p></div>
              <span className="sample-meta">{hotProcessSnapshot?.sample_ms ? `${hotProcessSnapshot.sample_ms}ms` : '--'}<small>{hotProcessSnapshot?.logical_cores ? `${hotProcessSnapshot.logical_cores} ${isZh ? '核' : 'CORES'}` : (isZh ? '等待采样' : 'WAITING')}</small></span>
            </div>
            {hotProcessError ? <div className="inline-alert is-error">{isZh ? '进程采样失败：' : 'Process sampling failed: '}{hotProcessError}</div>
              : !hotProcessSnapshot || hotProcessSnapshot.items.length === 0 ? <div className="empty-state">{isZh ? '正在等待有效进程样本。' : 'Waiting for a valid process sample.'}</div>
              : <div className="process-list">
                {hotProcessSnapshot.items.map((item, index) => {
                  const width = Math.max(5, Math.min(100, (item.heat_score / hottestScore) * 100));
                  const hot = item.cpu_percent >= 50 || index === 0;
                  return <div className={`process-row ${hot ? 'is-hot' : ''}`} key={`${item.pid}-${item.name}`}>
                    <span className="process-rank">{index + 1}</span>
                    <div className="process-copy"><div><strong>{item.name}</strong><span>PID {item.pid}</span></div><i><b style={{ width: `${width}%` }} /></i></div>
                    <span className="process-stat"><strong>{item.cpu_percent.toFixed(1)}%</strong><small>CPU</small></span>
                    <span className="process-stat"><strong>{item.memory_mb >= 1024 ? `${(item.memory_mb / 1024).toFixed(1)}G` : `${Math.round(item.memory_mb)}M`}</strong><small>RAM</small></span>
                  </div>;
                })}
              </div>}
          </SurfaceCard>
        </div>
      </div>
    </div>
  );
};

export default MonitorSection;
