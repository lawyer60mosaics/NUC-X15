import React from 'react';
import GlassCard from './GlassCard';
import LiquidSlider from './LiquidSlider';
import { CurvePoint, TimeThemeMode } from '../hooks/useFanControl';
import { useThemeTokens } from '../hooks/useThemeTokens';

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
import dragDataPlugin from 'chartjs-plugin-dragdata';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  dragDataPlugin
);

interface OverviewSectionProps {
  cpuTemp: number | '--';
  gpuTemp: number | '--';
  cpuFanRpm: number | '--';
  gpuFanRpm: number | '--';
  cpuCurve: CurvePoint[];
  gpuCurve: CurvePoint[];
  setCpuCurve: React.Dispatch<React.SetStateAction<CurvePoint[]>>;
  setGpuCurve: React.Dispatch<React.SetStateAction<CurvePoint[]>>;
  constantSpeedEnabled: boolean;
  setConstantSpeedEnabled: (val: boolean) => void;
  constantSpeed: number;
  setConstantSpeed: (val: number) => void;
  startupTakeoverEnabled: boolean;
  setStartupTakeoverEnabled: (val: boolean) => void;
  autostartEnabled: boolean;
  autostartBusy: boolean;
  setAutostartEnabled: (val: boolean) => void;
  timeThemeMode: TimeThemeMode;
  setTimeThemeMode: (mode: TimeThemeMode) => void;
  running: boolean;
  toggleControl: () => void;
  saveConfig: () => void;
  loadConfig: () => void;
  actorStateText: string;
  lastSampledTime: string;
}

export const OverviewSection: React.FC<OverviewSectionProps> = ({
  cpuTemp,
  gpuTemp,
  cpuFanRpm,
  gpuFanRpm,
  cpuCurve,
  gpuCurve,
  setCpuCurve,
  setGpuCurve,
  constantSpeedEnabled,
  setConstantSpeedEnabled,
  constantSpeed,
  setConstantSpeed,
  startupTakeoverEnabled,
  setStartupTakeoverEnabled,
  autostartEnabled,
  autostartBusy,
  setAutostartEnabled,
  timeThemeMode,
  setTimeThemeMode,
  running,
  toggleControl,
  saveConfig,
  loadConfig,
  actorStateText,
  lastSampledTime,
}) => {
  const theme = useThemeTokens();
  
  // 提取 X 轴刻度 (温度值)
  const chartLabels = cpuCurve.map(pt => `${pt.temperature}°C`);

  // CPU 曲线数据集
  const cpuSpeeds = cpuCurve.map(pt => pt.speed);
  // GPU 曲线数据集
  const gpuSpeeds = gpuCurve.map(pt => pt.speed);

  // 渲染温控曲线配置
  const chartData = {
    labels: chartLabels,
    datasets: [
      {
        label: 'CPU 风扇速度 (%)',
        data: cpuSpeeds,
        borderColor: '#00c6ff',
        backgroundColor: 'rgba(0, 198, 255, 0.08)',
        borderWidth: 3,
        pointRadius: 6,
        pointHoverRadius: 9,
        pointBackgroundColor: '#ffffff',
        pointBorderColor: '#00c6ff',
        pointBorderWidth: 3,
        tension: 0.35,
        fill: true,
      },
      {
        label: 'GPU 风扇速度 (%)',
        data: gpuSpeeds,
        borderColor: '#30d158',
        backgroundColor: 'rgba(48, 209, 88, 0.08)',
        borderWidth: 3,
        pointRadius: 6,
        pointHoverRadius: 9,
        pointBackgroundColor: '#ffffff',
        pointBorderColor: '#30d158',
        pointBorderWidth: 3,
        tension: 0.35,
        fill: true,
      }
    ]
  };

  // 极具质感的 Chart 样式配置
  const chartOptions: any = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: {
        display: true,
        labels: {
          color: theme.chartTick,
          font: { family: 'var(--font-sans)', size: 12, weight: 600 },
          boxWidth: 10,
          boxHeight: 10,
          useBorderRadius: true,
          borderRadius: 3,
        }
      },
      tooltip: {
        backgroundColor: theme.chartTooltipBg,
        backdropFilter: 'blur(10px)',
        titleColor: theme.chartTooltipText,
        titleFont: { weight: 'bold' },
        bodyColor: theme.chartTooltipText,
        borderColor: theme.borderSoft,
        borderWidth: 1,
        padding: 10,
        cornerRadius: 8,
      },
      dragData: {
        round: 0,
        showTooltip: true,
        onDragStart: (_e: any, _datasetIndex: number, _index: number, _value: number) => {
          // 在恒速模式下，禁止拖动风扇曲线
          return !constantSpeedEnabled;
        },
        onDrag: (_e: any, _datasetIndex: number, _index: number, value: number) => {
          // 限制滑块在 0% - 100% 之间
          if (value < 0) return 0;
          if (value > 100) return 100;
          return value;
        },
        onDragEnd: (_e: any, datasetIndex: number, index: number, value: number) => {
          const roundedVal = Math.round(Math.max(0, Math.min(100, value)));
          if (datasetIndex === 0) {
            setCpuCurve(prev => {
              const next = [...prev];
              next[index] = { ...next[index], speed: roundedVal };
              return next;
            });
          } else {
            setGpuCurve(prev => {
              const next = [...prev];
              next[index] = { ...next[index], speed: roundedVal };
              return next;
            });
          }
        }
      }
    },
    scales: {
      x: {
        grid: { color: theme.chartGrid },
        ticks: { color: theme.chartTick, font: { size: 10, family: 'var(--font-sans)' } },
        title: { display: false }
      },
      y: {
        min: 0,
        max: 100,
        grid: { color: theme.chartGrid },
        ticks: { 
          color: theme.chartTick, 
          font: { size: 10, family: 'var(--font-display)' },
          callback: (value: any) => `${value}%`
        },
        title: { display: false }
      }
    }
  };

  const renderSwitch = (enabled: boolean, onClick: () => void, disabled = false) => (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      aria-pressed={enabled}
      disabled={disabled}
      style={{
        width: '38px',
        height: '22px',
        borderRadius: '999px',
        background: enabled ? 'var(--accent-color)' : 'var(--control-bg)',
        border: '1px solid var(--control-border)',
        position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        padding: 0,
      }}
    >
      <span
        style={{
          width: '16px',
          height: '16px',
          borderRadius: '50%',
          background: '#ffffff',
          boxShadow: '0 1px 4px rgba(0,0,0,0.26)',
          position: 'absolute',
          top: '2px',
          left: enabled ? '18px' : '2px',
        }}
      />
    </button>
  );

  const themeOptions: Array<{ value: TimeThemeMode; label: string }> = [
    { value: 'auto', label: '自动' },
    { value: 'day', label: '白天' },
    { value: 'night', label: '夜晚' },
  ];

  return (
    <div className="dashboard-section">
      
      {/* 顶部三维数字仪表盘卡片组 */}
      <div className="dashboard-grid">
        
        {/* CPU 温度卡 */}
        <GlassCard className="module-card-sm" style={{ padding: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', position: 'relative', overflow: 'hidden' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 700, letterSpacing: '0.08em' }}>CPU TEMPERATURE</div>
          <div style={{ display: 'flex', alignItems: 'baseline', marginTop: '6px' }}>
            <span className="metric-value" style={{ color: cpuTemp !== '--' && cpuTemp > 80 ? 'var(--text-danger)' : 'var(--text-primary)' }}>
              {cpuTemp}
            </span>
            <span style={{ fontSize: '14px', marginLeft: '2px', color: 'var(--text-secondary)', fontWeight: 700 }}>°C</span>
          </div>
          {/* 流体进度条指示器 */}
          <div style={{ width: '100%', height: '4px', background: 'var(--progress-track)', borderRadius: '99px', marginTop: '10px', overflow: 'hidden' }}>
            <div 
              style={{ 
                height: '100%', 
                width: cpuTemp !== '--' ? `${cpuTemp}%` : '0%', 
                background: 'linear-gradient(90deg, #00c6ff, #0072ff)',
                borderRadius: '99px',
                transition: 'width 0.5s ease-out'
              }} 
            />
          </div>
        </GlassCard>

        {/* GPU 温度卡 */}
        <GlassCard className="module-card-sm" style={{ padding: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', position: 'relative', overflow: 'hidden' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 700, letterSpacing: '0.08em' }}>GPU TEMPERATURE</div>
          <div style={{ display: 'flex', alignItems: 'baseline', marginTop: '6px' }}>
            <span className="metric-value" style={{ color: gpuTemp !== '--' && gpuTemp > 80 ? 'var(--text-danger)' : 'var(--text-primary)' }}>
              {gpuTemp}
            </span>
            <span style={{ fontSize: '14px', marginLeft: '2px', color: 'var(--text-secondary)', fontWeight: 700 }}>°C</span>
          </div>
          <div style={{ width: '100%', height: '4px', background: 'var(--progress-track)', borderRadius: '99px', marginTop: '10px', overflow: 'hidden' }}>
            <div 
              style={{ 
                height: '100%', 
                width: gpuTemp !== '--' ? `${gpuTemp}%` : '0%', 
                background: 'linear-gradient(90deg, #30d158, #10b981)',
                borderRadius: '99px',
                transition: 'width 0.5s ease-out'
              }} 
            />
          </div>
        </GlassCard>

        {/* CPU 风扇转速卡 */}
        <GlassCard className="module-card-sm" style={{ padding: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', position: 'relative', overflow: 'hidden' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 700, letterSpacing: '0.08em' }}>CPU FAN SPEED</div>
          <div style={{ display: 'flex', alignItems: 'baseline', marginTop: '6px' }}>
            <span className="metric-value" style={{ color: 'var(--text-primary)' }}>
              {cpuFanRpm}
            </span>
            <span style={{ fontSize: '12px', marginLeft: '3px', color: 'var(--text-secondary)', fontWeight: 700 }}>RPM</span>
          </div>
          <div style={{ width: '100%', height: '4px', background: 'var(--progress-track)', borderRadius: '99px', marginTop: '10px', overflow: 'hidden' }}>
            <div 
              style={{ 
                height: '100%', 
                width: cpuFanRpm !== '--' ? `${(cpuFanRpm / 6000) * 100}%` : '0%', 
                background: 'linear-gradient(90deg, #bf5af2, #ff2d55)',
                borderRadius: '99px',
                transition: 'width 0.5s ease-out'
              }} 
            />
          </div>
        </GlassCard>

        {/* GPU 风扇转速卡 */}
        <GlassCard className="module-card-sm" style={{ padding: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', position: 'relative', overflow: 'hidden' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 700, letterSpacing: '0.08em' }}>GPU FAN SPEED</div>
          <div style={{ display: 'flex', alignItems: 'baseline', marginTop: '6px' }}>
            <span className="metric-value" style={{ color: 'var(--text-primary)' }}>
              {gpuFanRpm}
            </span>
            <span style={{ fontSize: '12px', marginLeft: '3px', color: 'var(--text-secondary)', fontWeight: 700 }}>RPM</span>
          </div>
          <div style={{ width: '100%', height: '4px', background: 'var(--progress-track)', borderRadius: '99px', marginTop: '10px', overflow: 'hidden' }}>
            <div 
              style={{ 
                height: '100%', 
                width: gpuFanRpm !== '--' ? `${(gpuFanRpm / 6000) * 100}%` : '0%', 
                background: 'linear-gradient(90deg, #ffd60a, #ff9f0a)',
                borderRadius: '99px',
                transition: 'width 0.5s ease-out'
              }} 
            />
          </div>
        </GlassCard>

      </div>

      {/* 主面板：曲线拖拽编辑器 + 恒速设置 */}
      <div className="dashboard-grid-wide">
        
        {/* 左侧：可拖动温控曲线 */}
        <GlassCard className="module-card-lg" style={{ padding: '18px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 className="card-title">
              双向液态温控矩阵 {constantSpeedEnabled && <span style={{ fontSize: '12px', color: '#ff9f0a', marginLeft: '6px' }}>(恒速已接管)</span>}
            </h3>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
              {constantSpeedEnabled ? '温控曲线锁定中，禁用拖拽' : '鼠标随意拖拽曲线节点调整目标转速'}
            </span>
          </div>
          
          <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
            <Line data={chartData} options={chartOptions} />
          </div>
        </GlassCard>

        {/* 右侧：恒速接管及哨兵控制面板 */}
        <div className="module-stack module-stack-equal module-card-lg">
          
          <GlassCard style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>恒速静音接管</span>
              
              {/* 开关 */}
              <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}>
                <div 
                  onClick={() => setConstantSpeedEnabled(!constantSpeedEnabled)}
                  style={{
                    width: '36px',
                    height: '20px',
                    borderRadius: '99px',
                    background: constantSpeedEnabled ? 'var(--accent-color)' : 'var(--control-bg)',
                    border: '1px solid var(--control-border)',
                    position: 'relative',
                    transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                >
                  <div 
                    style={{
                      width: '14px',
                      height: '14px',
                      borderRadius: '50%',
                      background: '#ffffff',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                      position: 'absolute',
                      top: '2px',
                      left: constantSpeedEnabled ? '18px' : '2px',
                      transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                    }}
                  />
                </div>
              </label>
            </div>

            <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
              开启后将无视下方温度曲线，风扇将以恒定功率运转以保持极致静音节奏。
            </p>

            <LiquidSlider
              label="恒定风扇负荷"
              min={20}
              max={100}
              value={constantSpeed}
              unit="%"
              disabled={!constantSpeedEnabled}
              onChange={setConstantSpeed}
            />
          </GlassCard>

          <GlassCard style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text-primary)' }}>启动与日夜策略</div>

            <div style={{ display: 'grid', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 800, color: 'var(--text-primary)' }}>程序开机自启动</div>
                  <p style={{ fontSize: '10px', color: 'var(--text-secondary)', margin: '2px 0 0', lineHeight: 1.35 }}>
                    Windows 登录后自动启动 NUCtool 主程序。
                  </p>
                </div>
                {renderSwitch(autostartEnabled, () => setAutostartEnabled(!autostartEnabled), autostartBusy)}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 800, color: 'var(--text-primary)' }}>启动后接管风扇</div>
                  <p style={{ fontSize: '10px', color: 'var(--text-secondary)', margin: '2px 0 0', lineHeight: 1.35 }}>
                    程序启动后加载保存策略并接管 EC 温控。
                  </p>
                </div>
                {renderSwitch(startupTakeoverEnabled, () => setStartupTakeoverEnabled(!startupTakeoverEnabled))}
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--divider-color)', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ fontSize: '12px', fontWeight: 800, color: 'var(--text-primary)' }}>日夜场景</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                {themeOptions.map((option) => {
                  const selected = timeThemeMode === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setTimeThemeMode(option.value)}
                      style={{
                        background: selected ? 'var(--accent-color)' : 'var(--surface-muted)',
                        border: selected ? '1px solid var(--border-soft)' : '1px solid var(--border-muted)',
                        color: selected ? 'var(--text-inverse)' : 'var(--text-primary)',
                        borderRadius: 'var(--radius-control)',
                        padding: '7px 6px',
                        fontSize: '11px',
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <p style={{ fontSize: '10px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.35 }}>
                选择后立即保存；自动模式按 07:00-18:00 使用白天，其余时间使用夜晚。
              </p>
            </div>
          </GlassCard>

          {/* 策略快速应用按钮区 */}
          <GlassCard style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button 
                onClick={toggleControl}
                style={{
                  flex: 1,
                  background: running ? 'var(--text-danger)' : 'var(--accent-color)',
                  color: running ? '#ffffff' : 'var(--text-inverse)',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '10px',
                  fontWeight: 800,
                  fontSize: '12px',
                  cursor: 'pointer',
                  boxShadow: running ? 'none' : '0 4px 12px var(--accent-color-glow)',
                  transition: 'all 0.2s ease',
                }}
              >
                {running ? '停止风控' : '启动温控接管'}
              </button>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button 
                onClick={loadConfig}
                style={{
                  flex: 1,
                  background: 'var(--surface-muted)',
                  border: '1px solid var(--border-muted)',
                  color: 'var(--text-primary)',
                  borderRadius: '8px',
                  padding: '8px',
                  fontWeight: 700,
                  fontSize: '11px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
              >
                加载配置
              </button>
              <button 
                onClick={saveConfig}
                style={{
                  flex: 1,
                  background: 'var(--surface-muted)',
                  border: '1px solid var(--border-muted)',
                  color: 'var(--text-primary)',
                  borderRadius: '8px',
                  padding: '8px',
                  fontWeight: 700,
                  fontSize: '11px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
              >
                保存配置
              </button>
            </div>

            <hr style={{ border: 'none', borderBottom: '1px solid var(--divider-color)', margin: '4px 0' }} />

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-secondary)', opacity: 0.7 }}>
              <span>看门狗哨兵: <strong style={{ color: running ? '#30d158' : '#8e8e93' }}>{actorStateText}</strong></span>
              <span>拉取时间: <strong>{lastSampledTime}</strong></span>
            </div>
          </GlassCard>

        </div>

      </div>

    </div>
  );
};

export default OverviewSection;
