import React from 'react';
import GlassCard from './GlassCard';
import LiquidSlider from './LiquidSlider';
import { CurvePoint } from '../hooks/useFanControl';

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
  running,
  toggleControl,
  saveConfig,
  loadConfig,
  actorStateText,
  lastSampledTime,
}) => {
  
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
    animation: {
      duration: 200,
    },
    plugins: {
      legend: {
        display: true,
        labels: {
          color: 'rgba(255,255,255,0.7)',
          font: { family: 'var(--font-sans)', size: 12, weight: 600 },
          boxWidth: 10,
          boxHeight: 10,
          useBorderRadius: true,
          borderRadius: 3,
        }
      },
      tooltip: {
        backgroundColor: 'rgba(4, 8, 18, 0.85)',
        backdropFilter: 'blur(10px)',
        titleColor: '#ffffff',
        titleFont: { weight: 'bold' },
        bodyColor: 'rgba(255,255,255,0.85)',
        borderColor: 'rgba(255,255,255,0.1)',
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
        grid: { color: 'rgba(255,255,255,0.03)' },
        ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 10, family: 'var(--font-sans)' } },
        title: { display: false }
      },
      y: {
        min: 0,
        max: 100,
        grid: { color: 'rgba(255,255,255,0.04)' },
        ticks: { 
          color: 'rgba(255,255,255,0.4)', 
          font: { size: 10, family: 'var(--font-display)' },
          callback: (value: any) => `${value}%`
        },
        title: { display: false }
      }
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* 顶部三维数字仪表盘卡片组 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        
        {/* CPU 温度卡 */}
        <GlassCard style={{ padding: '16px', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 700, letterSpacing: '0.08em' }}>CPU TEMPERATURE</div>
          <div style={{ display: 'flex', alignItems: 'baseline', marginTop: '6px' }}>
            <span style={{ fontSize: '32px', fontWeight: 900, fontFamily: 'var(--font-display)', color: cpuTemp !== '--' && cpuTemp > 80 ? '#ff453a' : 'var(--text-primary)' }}>
              {cpuTemp}
            </span>
            <span style={{ fontSize: '14px', marginLeft: '2px', color: 'var(--text-secondary)', fontWeight: 700 }}>°C</span>
          </div>
          {/* 流体进度条指示器 */}
          <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '99px', marginTop: '10px', overflow: 'hidden' }}>
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
        <GlassCard style={{ padding: '16px', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 700, letterSpacing: '0.08em' }}>GPU TEMPERATURE</div>
          <div style={{ display: 'flex', alignItems: 'baseline', marginTop: '6px' }}>
            <span style={{ fontSize: '32px', fontWeight: 900, fontFamily: 'var(--font-display)', color: gpuTemp !== '--' && gpuTemp > 80 ? '#ff453a' : 'var(--text-primary)' }}>
              {gpuTemp}
            </span>
            <span style={{ fontSize: '14px', marginLeft: '2px', color: 'var(--text-secondary)', fontWeight: 700 }}>°C</span>
          </div>
          <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '99px', marginTop: '10px', overflow: 'hidden' }}>
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
        <GlassCard style={{ padding: '16px', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 700, letterSpacing: '0.08em' }}>CPU FAN SPEED</div>
          <div style={{ display: 'flex', alignItems: 'baseline', marginTop: '6px' }}>
            <span style={{ fontSize: '32px', fontWeight: 900, fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
              {cpuFanRpm}
            </span>
            <span style={{ fontSize: '12px', marginLeft: '3px', color: 'var(--text-secondary)', fontWeight: 700 }}>RPM</span>
          </div>
          <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '99px', marginTop: '10px', overflow: 'hidden' }}>
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
        <GlassCard style={{ padding: '16px', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 700, letterSpacing: '0.08em' }}>GPU FAN SPEED</div>
          <div style={{ display: 'flex', alignItems: 'baseline', marginTop: '6px' }}>
            <span style={{ fontSize: '32px', fontWeight: 900, fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
              {gpuFanRpm}
            </span>
            <span style={{ fontSize: '12px', marginLeft: '3px', color: 'var(--text-secondary)', fontWeight: 700 }}>RPM</span>
          </div>
          <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '99px', marginTop: '10px', overflow: 'hidden' }}>
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: '20px' }}>
        
        {/* 左侧：可拖动温控曲线 */}
        <GlassCard style={{ padding: '20px', display: 'flex', flexDirection: 'column', height: '360px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)' }}>
              双向液态温控矩阵 {constantSpeedEnabled && <span style={{ fontSize: '12px', color: '#ff9f0a', marginLeft: '6px' }}>(恒速已接管)</span>}
            </h3>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', opacity: 0.8 }}>
              {constantSpeedEnabled ? '温控曲线锁定中，禁用拖拽' : '鼠标随意拖拽曲线节点调整目标转速'}
            </span>
          </div>
          
          <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
            <Line data={chartData} options={chartOptions} />
          </div>
        </GlassCard>

        {/* 右侧：恒速接管及哨兵控制面板 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
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
                    background: constantSpeedEnabled ? 'var(--accent-color)' : 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.08)',
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

          <GlassCard style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>开机自动接管</span>
              <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}>
                <div 
                  onClick={() => setStartupTakeoverEnabled(!startupTakeoverEnabled)}
                  style={{
                    width: '36px',
                    height: '20px',
                    borderRadius: '99px',
                    background: startupTakeoverEnabled ? 'var(--accent-color)' : 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.08)',
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
                      left: startupTakeoverEnabled ? '18px' : '2px',
                      transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                    }}
                  />
                </div>
              </label>
            </div>
            <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
              系统开机启动或唤醒后，自动让本程序接管 EC 温控，无需手动开启。
            </p>
          </GlassCard>

          {/* 策略快速应用按钮区 */}
          <GlassCard style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button 
                onClick={toggleControl}
                style={{
                  flex: 1,
                  background: running ? '#ff453a' : 'var(--accent-color)',
                  color: running ? '#ffffff' : '#040812',
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
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
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
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
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

            <hr style={{ border: 'none', borderBottom: '1px solid rgba(255,255,255,0.04)', margin: '4px 0' }} />

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
