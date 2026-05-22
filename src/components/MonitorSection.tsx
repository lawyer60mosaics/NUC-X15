import React, { useState, useEffect, useRef } from 'react';
import GlassCard from './GlassCard';
import { DiagnosticSummary, LogEntry } from '../hooks/useDiagnostics';

// Chart.js 核心注册
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface MonitorSectionProps {
  cpuTemp: number | '--';
  gpuTemp: number | '--';
  cpuFanRpm: number | '--';
  gpuFanRpm: number | '--';
  summary: DiagnosticSummary | null;
  logs: LogEntry[];
  runSentinelTest: () => void;
}

export const MonitorSection: React.FC<MonitorSectionProps> = ({
  cpuTemp,
  gpuTemp,
  cpuFanRpm,
  gpuFanRpm,
  summary,
  logs,
  runSentinelTest,
}) => {
  const consoleEndRef = useRef<HTMLDivElement>(null);
  
  // 维护滑动历史数据（25个点）
  const [historyPoints, setHistoryPoints] = useState<{
    time: string;
    cpuT: number;
    gpuT: number;
    cpuF: number;
    gpuF: number;
  }[]>([]);

  // 监听温度与转速指标，追加到滚动历史中
  useEffect(() => {
    // 过滤掉无效初始化值
    if (cpuTemp === '--' && gpuTemp === '--' && cpuFanRpm === '--' && gpuFanRpm === '--') {
      return;
    }

    const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const nextPoint = {
      time: nowStr,
      cpuT: cpuTemp === '--' ? 0 : cpuTemp,
      gpuT: gpuTemp === '--' ? 0 : gpuTemp,
      cpuF: cpuFanRpm === '--' ? 0 : cpuFanRpm,
      gpuF: gpuFanRpm === '--' ? 0 : gpuFanRpm,
    };

    setHistoryPoints((prev) => {
      const next = [...prev, nextPoint];
      if (next.length > 25) {
        return next.slice(next.length - 25);
      }
      return next;
    });
  }, [cpuTemp, gpuTemp, cpuFanRpm, gpuFanRpm]);

  // 控制台自动翻滚到底部
  useEffect(() => {
    if (consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // 双坐标轴趋势图数据源
  const trendData = {
    labels: historyPoints.map(p => p.time),
    datasets: [
      {
        label: 'CPU 温度 (°C)',
        data: historyPoints.map(p => p.cpuT),
        borderColor: '#ff453a',
        backgroundColor: 'rgba(255, 69, 58, 0.05)',
        borderWidth: 2,
        pointRadius: 0,
        yAxisID: 'y-temp',
        tension: 0.3,
        fill: true,
      },
      {
        label: 'GPU 温度 (°C)',
        data: historyPoints.map(p => p.gpuT),
        borderColor: '#ff9f0a',
        backgroundColor: 'rgba(255, 159, 10, 0.05)',
        borderWidth: 2,
        pointRadius: 0,
        yAxisID: 'y-temp',
        tension: 0.3,
        fill: true,
      },
      {
        label: 'CPU 转速 (RPM)',
        data: historyPoints.map(p => p.cpuF),
        borderColor: '#00c6ff',
        borderWidth: 2.2,
        borderDash: [4, 4],
        pointRadius: 0,
        yAxisID: 'y-fan',
        tension: 0.3,
        fill: false,
      },
      {
        label: 'GPU 转速 (RPM)',
        data: historyPoints.map(p => p.gpuF),
        borderColor: '#30d158',
        borderWidth: 2.2,
        borderDash: [4, 4],
        pointRadius: 0,
        yAxisID: 'y-fan',
        tension: 0.3,
        fill: false,
      }
    ]
  };

  const trendOptions: any = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false, // 实时波形禁用动画提升绝对帧率与降低 CPU 占比
    plugins: {
      legend: {
        position: 'top',
        labels: {
          color: 'rgba(255,255,255,0.7)',
          font: { family: 'var(--font-sans)', size: 10, weight: 600 },
          boxWidth: 8,
          boxHeight: 8,
          useBorderRadius: true,
          borderRadius: 2,
        }
      },
      tooltip: {
        mode: 'index',
        intersect: false,
        backgroundColor: 'rgba(4, 8, 18, 0.85)',
        backdropFilter: 'blur(10px)',
        titleColor: '#ffffff',
        bodyColor: 'rgba(255,255,255,0.85)',
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
      }
    },
    scales: {
      x: {
        grid: { color: 'rgba(255,255,255,0.02)' },
        ticks: { color: 'rgba(255,255,255,0.3)', font: { size: 9 } }
      },
      'y-temp': {
        type: 'linear',
        position: 'left',
        min: 0,
        max: 100,
        grid: { color: 'rgba(255,255,255,0.03)' },
        ticks: { 
          color: '#ff9f0a', 
          font: { size: 9 },
          callback: (value: any) => `${value}°C`
        }
      },
      'y-fan': {
        type: 'linear',
        position: 'right',
        min: 0,
        max: 6500,
        grid: { drawOnChartArea: false },
        ticks: { 
          color: '#00c6ff', 
          font: { size: 9 },
          callback: (value: any) => `${value} RPM`
        }
      }
    }
  };

  // 计算健康等级
  const getHealthStatus = () => {
    if (!summary) return { label: '未连接', color: '#8e8e93', bg: 'rgba(142, 142, 147, 0.2)' };
    const errCount = (summary.error_count || 0) + (summary.actor_hung_count || 0) + (summary.vendor_failure_count || 0);
    const warnCount = (summary.warning_count || 0) + (summary.hardware_busy_count || 0);

    if (errCount > 0) {
      return { label: '系统已降级', color: '#ff453a', bg: 'rgba(255, 69, 58, 0.2)' };
    }
    if (warnCount > 3) {
      return { label: '注意安全', color: '#ffd60a', bg: 'rgba(255, 214, 10, 0.2)' };
    }
    return { label: '运行极佳', color: '#30d158', bg: 'rgba(48, 209, 88, 0.2)' };
  };

  const health = getHealthStatus();

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', alignItems: 'stretch' }}>
      
      {/* 左列：图表趋势与健康报告 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        
        {/* 模块：实时平滑趋势监控图 */}
        <GlassCard style={{ padding: '20px', display: 'flex', flexDirection: 'column', height: '240px' }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)' }}>
            实时状态平滑监控趋势 (Rolling Telemetry)
          </h3>
          <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
            {historyPoints.length === 0 ? (
              <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--text-secondary)', fontSize: '12px' }}>
                等待心跳反馈并累计传感器历史样本中...
              </div>
            ) : (
              <Line data={trendData} options={trendOptions} />
            )}
          </div>
        </GlassCard>

        {/* 模块：WMI 硬件与哨兵健康度汇总 */}
        <GlassCard style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)' }}>
              底层驱动与 ACPI 监视诊断 (Kernel Diag)
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '4px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>哨兵死锁自愈发生:</span>
                <strong style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                  {summary?.watchdog_reload_count ?? 0} 次
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '4px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>ACPI 繁忙竞争阻塞:</span>
                <strong style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                  {summary?.hardware_busy_count ?? 0} 次
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '4px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Uniwill 读写挂起:</span>
                <strong style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                  {summary?.vendor_failure_count ?? 0} 次
                </strong>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '4px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>日志记录总行数:</span>
                <strong style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                  {summary?.total_lines ?? 0} 行
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '4px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>内核异常事件计:</span>
                <strong style={{ fontFamily: 'var(--font-display)', color: (summary?.error_count ?? 0) > 0 ? '#ff453a' : 'var(--text-primary)' }}>
                  {summary?.error_count ?? 0} 条
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '4px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>内核告警事件计:</span>
                <strong style={{ fontFamily: 'var(--font-display)', color: (summary?.warning_count ?? 0) > 0 ? '#ffd60a' : 'var(--text-primary)' }}>
                  {summary?.warning_count ?? 0} 条
                </strong>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-secondary)', opacity: 0.8, maxWidth: '240px', lineHeight: 1.3 }}>
              诊断日志源: <code style={{ color: 'var(--accent-color)' }}>{summary?.path ? summary.path.split(/[\\/]/).pop() : 'nuctool.log'}</code> ({Math.round((summary?.size_bytes ?? 0) / 1024)} KB)
            </span>
            <button
              onClick={runSentinelTest}
              style={{
                background: 'rgba(255, 69, 58, 0.1)',
                border: '1.5px dashed rgba(255, 69, 58, 0.4)',
                color: '#ff453a',
                borderRadius: '8px',
                padding: '6px 14px',
                fontSize: '11px',
                fontWeight: 800,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              模拟哨兵卡死重启测试
            </button>
          </div>
        </GlassCard>

      </div>

      {/* 右列：黑客帝国暗黑风格诊断终端 */}
      <GlassCard 
        style={{ 
          padding: '16px', 
          display: 'flex', 
          flexDirection: 'column', 
          background: 'rgba(4, 8, 18, 0.72)', 
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.5), inset 0 0 30px rgba(0, 198, 255, 0.05)',
          height: '420px'
        }}
      >
        {/* 终端顶栏 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '10px', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ff5f56' }} />
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ffbd2e' }} />
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#27c93f' }} />
            <span style={{ fontSize: '11px', fontFamily: 'monospace', color: 'rgba(255,255,255,0.5)', marginLeft: '10px' }}>
              nuctool_wmi_daemon.sh
            </span>
          </div>
          <div style={{ fontSize: '10px', fontFamily: 'monospace', color: '#27c93f', textShadow: '0 0 4px rgba(39, 201, 63, 0.4)' }}>
            ● ONLINE TERMINAL
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
            <div style={{ color: 'rgba(48, 209, 88, 0.3)', fontStyle: 'italic' }}>
              [SYSTEM] 终端就绪，正在监听驱动回调日志流...
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
                  <span style={{ color: 'rgba(255,255,255,0.35)', userSelect: 'none' }}>{log.time}</span>
                  <span style={{ fontWeight: 'bold', userSelect: 'none' }}>{prefix}</span>
                  <span style={{ color: 'rgba(255,255,255,0.4)', userSelect: 'none' }}>[{log.tag.toUpperCase()}]</span>
                  <span style={{ flex: 1 }}>{log.msg}</span>
                </div>
              );
            })
          )}
          <div ref={consoleEndRef} />
        </div>
      </GlassCard>

    </div>
  );
};

export default MonitorSection;
