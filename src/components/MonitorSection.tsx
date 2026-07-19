import React, { useState, useEffect } from 'react';
import GlassCard from './GlassCard';
import { DiagnosticSummary, LogEntry } from '../hooks/useDiagnostics';
import { invokeBackend } from '../hooks/useTauriApi';
import { OperationLogEntry } from '../types/appSettings';
import { tr, translateRuntimeText } from '../i18n';

interface MonitorSectionProps {
  cpuTemp: number | '--';
  gpuTemp: number | '--';
  summary: DiagnosticSummary | null;
  logs: LogEntry[];
  runSentinelTest: () => void;
  operationLogs: OperationLogEntry[];
  operationLogRetentionMinutes: number;
  clearOperationLogs: () => void;
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
  logs,
  runSentinelTest,
  operationLogs,
  operationLogRetentionMinutes,
  clearOperationLogs,
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
  const formatOperationTime = (timestamp: number) => new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const levelLabel: Record<OperationLogEntry['level'], string> = {
    info: 'INFO',
    success: 'OK',
    warn: 'WARN',
    error: 'ERR',
  };

  return (
    <div className="dashboard-section monitor-section">
      <div className="section-intro">
        <span className="section-kicker">{isZh ? '02 / 系统脉冲' : '02 / SYSTEM PULSE'}</span>
        <h2>{isZh ? '系统监控' : 'SYSTEM MONITOR'}</h2>
        <p>{isZh ? '查看健康状态、趋势、诊断和高热进程。' : 'Review system health, trends, diagnostics, and high-heat processes.'}</p>
      </div>
      <GlassCard className="module-card" style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <h3 className="card-title" style={{ fontSize: '18px' }}>
              {isZh ? '自愈看门狗' : 'RECOVERY WATCHDOG'}
            </h3>
            <p className="card-subtitle" style={{ fontSize: '12px' }}>
              {isZh ? '持续检查风扇控制核心、WMI 心跳、前端心跳和采样时效；确认故障后执行受控的风扇重启。' : 'Continuously checks the fan control core, WMI heartbeat, frontend heartbeat, and sample freshness; confirmed faults trigger a controlled fan restart.'}
            </p>
          </div>
          <button
            onClick={runSentinelTest}
            style={{
              background: 'rgba(255, 69, 58, 0.12)',
              border: '1.5px solid rgba(255, 69, 58, 0.42)',
              color: 'var(--text-danger)',
              borderRadius: '10px',
              padding: '9px 16px',
              fontSize: '12px',
              fontWeight: 900,
              cursor: 'pointer',
              minWidth: '160px',
            }}
          >
            {isZh ? '强制看门狗重启测试' : 'FORCE WATCHDOG RESTART TEST'}
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
          {[
            { label: isZh ? '当前状态' : 'CURRENT STATUS', value: health.label, color: health.color },
            { label: isZh ? '当前哨兵事件' : 'ACTIVE SENTINEL EVENTS', value: `${sentinelEventCount}`, color: 'var(--text-primary)' },
            { label: isZh ? '当前看门狗事件' : 'ACTIVE WATCHDOG EVENTS', value: `${watchdogEventCount}`, color: 'var(--text-primary)' },
            { label: isZh ? '恢复重启次数' : 'RECOVERY RESTARTS', value: `${summary?.watchdog_reload_count ?? 0}`, color: 'var(--text-primary)' },
          ].map((item) => (
            <div
              key={item.label}
              style={{
                padding: '10px 12px',
                borderRadius: '10px',
                background: 'var(--surface-sunken)',
                border: '1px solid var(--border-muted)',
              }}
            >
              <div style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: 800, letterSpacing: '0.05em' }}>
                {item.label}
              </div>
              <div style={{ marginTop: '5px', fontSize: '15px', fontWeight: 900, color: item.color }}>
                {item.value}
              </div>
            </div>
          ))}
        </div>
      </GlassCard>

      <div className="dashboard-grid-wide">
      
      {/* 左列：图表趋势与健康报告 */}
      <div className="module-stack module-stack-equal module-card-lg">
        
        {/* 轻量实时数值，避免持续绘制 Canvas 图表 */}
        <GlassCard style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <h3 className="card-title" style={{ marginBottom: '12px' }}>
            {isZh ? '实时状态（轻量遥测）' : 'LIVE STATUS (LIGHTWEIGHT TELEMETRY)'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px' }}>
            {[
              { label: isZh ? 'CPU 温度' : 'CPU TEMPERATURE', value: cpuTemp === '--' ? '--' : `${cpuTemp}°C` },
              { label: isZh ? 'GPU 温度' : 'GPU TEMPERATURE', value: gpuTemp === '--' ? '--' : `${gpuTemp}°C` },
            ].map((item) => (
              <div key={item.label} style={{ padding: '14px', background: 'var(--surface-sunken)', border: '1px solid var(--border-muted)', borderRadius: '10px' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: 800 }}>{item.label}</div>
                <strong style={{ display: 'block', marginTop: '6px', fontSize: '20px', color: 'var(--text-primary)' }}>{item.value}</strong>
              </div>
            ))}
          </div>
        </GlassCard>

        {/* 模块：WMI 硬件与哨兵健康度汇总 */}
        <GlassCard style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px', overflow: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 className="card-title">
              {isZh ? '内核与 ACPI 诊断' : 'KERNEL & ACPI DIAGNOSTICS (KERNEL DIAG)'}
            </h3>
            
            {/* 健康状态胶囊 */}
            <div 
              style={{
                fontSize: '11px',
                fontWeight: 900,
                color: health.color,
                background: health.bg,
                padding: '4px 10px',
                borderRadius: '99px',
                boxShadow: `0 0 10px ${health.bg}`,
                border: `1px solid ${health.color}33`,
              }}
            >
              {health.label}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--divider-color)', paddingBottom: '4px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{isZh ? '看门狗恢复：' : 'WATCHDOG RECOVERIES:'}</span>
                <strong style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                  {summary?.watchdog_reload_count ?? 0}
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--divider-color)', paddingBottom: '4px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{isZh ? 'ACPI 忙碌阻塞：' : 'ACPI BUSY BLOCKS:'}</span>
                <strong style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                  {summary?.hardware_busy_count ?? 0}
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--divider-color)', paddingBottom: '4px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{isZh ? 'UNIWILL IO 失败：' : 'UNIWILL IO FAILURES:'}</span>
                <strong style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                  {summary?.vendor_failure_count ?? 0}
                </strong>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--divider-color)', paddingBottom: '4px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{isZh ? '日志行数：' : 'LOG LINES:'}</span>
                <strong style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                  {summary?.total_lines ?? 0}
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--divider-color)', paddingBottom: '4px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{isZh ? '内核错误：' : 'KERNEL ERRORS:'}</span>
                <strong style={{ fontFamily: 'var(--font-display)', color: (summary?.error_count ?? 0) > 0 ? 'var(--text-danger)' : 'var(--text-primary)' }}>
                  {summary?.error_count ?? 0}
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--divider-color)', paddingBottom: '4px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{isZh ? '内核警告：' : 'KERNEL WARNINGS:'}</span>
                <strong style={{ fontFamily: 'var(--font-display)', color: (summary?.warning_count ?? 0) > 0 ? '#a16207' : 'var(--text-primary)' }}>
                  {summary?.warning_count ?? 0}
                </strong>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-secondary)', opacity: 0.8, maxWidth: '240px', lineHeight: 1.3 }}>
              {isZh ? '诊断日志：' : 'DIAGNOSTIC LOG: '}<code style={{ color: 'var(--accent-color)' }}>{summary?.path ? summary.path.split(/[\\/]/).pop() : 'nuctool.log'}</code> ({Math.round((summary?.size_bytes ?? 0) / 1024)} KB)
            </span>
            <button
              onClick={runSentinelTest}
              style={{
                background: 'rgba(255, 69, 58, 0.1)',
                border: '1.5px dashed rgba(255, 69, 58, 0.4)',
                color: 'var(--text-danger)',
                borderRadius: '8px',
                padding: '6px 14px',
                fontSize: '11px',
                fontWeight: 800,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              {isZh ? '模拟看门狗停滞并重启' : 'SIMULATE WATCHDOG STALL + RESTART'}
            </button>
          </div>
        </GlassCard>

        <GlassCard style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px', minHeight: '260px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
            <div>
              <h3 className="card-title">
                {isZh ? '高热进程' : 'HIGH-HEAT PROCESSES (PROCESS HEAT)'}
              </h3>
              <p className="card-subtitle">
                {isZh ? '热度分数根据短期 CPU 增量和内存占用估算；100% CPU 表示一个逻辑核心满载。' : 'Heat score is estimated from short-term CPU delta and memory usage; 100% CPU equals one fully loaded logical core.'}
              </p>
            </div>
            <div style={{ textAlign: 'right', fontSize: '10px', color: 'var(--text-secondary)', lineHeight: 1.4, whiteSpace: 'nowrap' }}>
              <div>{hotProcessSnapshot?.sample_ms ? `${hotProcessSnapshot.sample_ms}ms ${isZh ? '采样' : 'SAMPLE'}` : (isZh ? '等待采样' : 'WAITING FOR SAMPLE')}</div>
              <div>{hotProcessSnapshot?.logical_cores ? `${hotProcessSnapshot.logical_cores} ${isZh ? '个逻辑核心' : 'LOGICAL CORES'}` : '--'}</div>
            </div>
          </div>

          {hotProcessError ? (
            <div style={{ padding: '12px', borderRadius: '10px', background: 'rgba(255, 69, 58, 0.1)', border: '1px solid rgba(255, 69, 58, 0.28)', color: 'var(--text-danger)', fontSize: '12px', lineHeight: 1.45 }}>
              {isZh ? '进程热度采样失败：' : 'Process heat sampling failed: '}{hotProcessError}
            </div>
          ) : !hotProcessSnapshot ? (
            <div style={{ display: 'grid', placeItems: 'center', flex: 1, color: 'var(--text-secondary)', fontSize: '12px' }}>
              {isZh ? '正在建立进程采样窗口……' : 'Building process sampling window...'}
            </div>
          ) : hotProcessSnapshot.items.length === 0 ? (
            <div style={{ display: 'grid', placeItems: 'center', flex: 1, color: 'var(--text-secondary)', fontSize: '12px' }}>
              {isZh ? '未检测到明显的高负载进程。' : 'No significant high-load process detected.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {hotProcessSnapshot.items.map((item, index) => {
                const width = Math.max(5, Math.min(100, (item.heat_score / hottestScore) * 100));
                const hot = item.cpu_percent >= 50 || index === 0;
                return (
                  <div
                    key={`${item.pid}-${item.name}`}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '28px minmax(0, 1fr) 74px 74px',
                      gap: '10px',
                      alignItems: 'center',
                      padding: '9px 10px',
                      borderRadius: '10px',
                      background: 'var(--surface-sunken)',
                      border: '1px solid var(--border-muted)',
                    }}
                  >
                    <div style={{ fontSize: '12px', fontWeight: 900, color: hot ? '#ff453a' : 'var(--text-secondary)' }}>
                      #{index + 1}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'baseline' }}>
                        <strong style={{ fontSize: '12px', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.name}
                        </strong>
                        <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>
                          PID {item.pid}
                        </span>
                      </div>
                      <div style={{ height: '4px', background: 'var(--progress-track)', borderRadius: '99px', overflow: 'hidden', marginTop: '7px' }}>
                        <div
                          style={{
                            height: '100%',
                            width: `${width}%`,
                            background: hot ? 'linear-gradient(90deg, #ff9f0a, #ff453a)' : 'linear-gradient(90deg, #00c6ff, #30d158)',
                            borderRadius: '99px',
                          }}
                        />
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '12px', fontWeight: 900, color: hot ? '#ff453a' : 'var(--text-primary)' }}>
                        {item.cpu_percent.toFixed(1)}%
                      </div>
                      <div style={{ fontSize: '9px', color: 'var(--text-secondary)' }}>CPU</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '12px', fontWeight: 900, color: 'var(--text-primary)' }}>
                        {item.memory_mb >= 1024 ? `${(item.memory_mb / 1024).toFixed(1)}G` : `${Math.round(item.memory_mb)}M`}
                      </div>
                      <div style={{ fontSize: '9px', color: 'var(--text-secondary)' }}>RAM</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </GlassCard>

      </div>

      {/* 右列：黑客帝国暗黑风格诊断终端 */}
      <div className="module-stack module-stack-equal module-card-lg">
        <GlassCard style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', minHeight: '260px' }}>
          <div className="operation-log-header">
            <div>
              <h3 className="card-title">{isZh ? '操作记录' : 'OPERATION TRACE'}</h3>
              <p className="card-subtitle">{isZh ? `最近 ${operationLogRetentionMinutes} 分钟的前端操作。` : `Frontend operations from the last ${operationLogRetentionMinutes} minutes.`}</p>
            </div>
            <button
              className="operation-log-clear"
              type="button"
              onClick={clearOperationLogs}
              disabled={operationLogs.length === 0}
            >
              {isZh ? '清除' : 'CLEAR'}
            </button>
          </div>

          <div className="operation-log-list">
            {operationLogs.length === 0 ? (
              <div className="operation-log-empty">{isZh ? '暂无操作记录。场景、灯光、调度和配置操作将显示在这里。' : 'No operation records. Scene, lighting, scheduling, and profile actions will appear here.'}</div>
            ) : (
              operationLogs.map((entry) => (
                <div className="operation-log-row" key={entry.id}>
                  <div className="operation-log-meta">
                    <span>{formatOperationTime(entry.timestamp)}</span>
                    <span className={`operation-log-level is-${entry.level}`}>{levelLabel[entry.level]}</span>
                  </div>
                  <div className="operation-log-copy">
                    <strong>{translateRuntimeText(entry.action, language)}</strong>
                    <span>{translateRuntimeText(entry.detail, language)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </GlassCard>

        <GlassCard
          style={{
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--surface-terminal)',
            border: 'var(--glass-border)',
            boxShadow: 'var(--glass-shadow)',
          }}
        >
          {/* 终端顶栏 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--divider-color)', paddingBottom: '10px', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ff5f56' }} />
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ffbd2e' }} />
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#27c93f' }} />
              <span style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--text-secondary)', marginLeft: '10px' }}>
                nuctool_wmi_daemon.sh
              </span>
            </div>
            <div style={{ fontSize: '10px', fontFamily: 'monospace', color: '#27c93f', textShadow: '0 0 4px rgba(39, 201, 63, 0.4)' }}>
              {isZh ? '● 终端在线' : '● ONLINE TERMINAL'}
            </div>
          </div>

          {/* 滚动日志核心区域 */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              fontFamily: 'Consolas, Monaco, monospace',
              fontSize: '11px',
              lineHeight: '1.6',
              color: '#30d158',
              paddingRight: '6px',
            }}
          >
            {logs.length === 0 ? (
              <div style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                {isZh ? '[系统] 终端已就绪，正在监听驱动回调日志……' : '[SYSTEM] Terminal ready; listening for driver callback logs...'}
              </div>
            ) : (
              logs.map((log) => {
                let color = '#30d158'; // 默认绿
                let prefix = '[INFO]';
                if (log.level === 'warn') {
                  color = '#ffd60a'; // 黄
                  prefix = '[WARN]';
                } else if (log.level === 'error') {
                  color = '#ff453a'; // 红
                  prefix = '[ERR!]';
                }

                return (
                  <div
                    key={log.id}
                    style={{
                      color,
                      display: 'flex',
                      gap: '8px',
                      marginBottom: '4px',
                      wordBreak: 'break-all',
                      textShadow: log.level === 'error' ? '0 0 6px rgba(255, 69, 58, 0.2)' : 'none'
                    }}
                  >
                    <span style={{ color: 'var(--text-tertiary)', userSelect: 'none' }}>{log.time}</span>
                    <span style={{ fontWeight: 'bold', userSelect: 'none' }}>{prefix}</span>
                    <span style={{ color: 'var(--text-secondary)', userSelect: 'none' }}>[{log.tag.toUpperCase()}]</span>
                    <span style={{ flex: 1 }}>{log.msg}</span>
                  </div>
                );
              })
            )}
          <div />
          </div>
        </GlassCard>
      </div>

      </div>
    </div>
  );
};

export default MonitorSection;
