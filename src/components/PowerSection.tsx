import React, { useEffect, useMemo, useState } from 'react';

import { SCENARIOS } from '../hooks/useFanControl';
import { scenarioLabel, scenarioNoise, tr } from '../i18n';

type SensorValue = number | '--';

interface PowerSectionProps {
  cpuTemp: SensorValue;
  gpuTemp: SensorValue;
  running: boolean;
  toggleControl: () => void;
  selectedScenario: string;
  requestScenarioChange: (scenario: string) => void;
  constantSpeedEnabled: boolean;
  setConstantSpeedEnabled: (enabled: boolean) => void;
  constantSpeed: number;
  setConstantSpeed: (speed: number) => void;
  language?: 'en' | 'zh';
}

const fallbackCpuHistory = [54, 55, 57, 59, 58, 60, 61, 63, 62, 64, 65, 67, 68, 70, 71, 72];
const fallbackGpuHistory = [42, 43, 43, 44, 45, 44, 46, 47, 48, 48, 49, 50, 50, 51, 52, 53];

function temperatureState(value: SensorValue) {
  if (typeof value !== 'number') return { label: 'WAITING', className: 'is-idle' };
  if (value >= 85) return { label: 'HOT', className: 'is-danger' };
  if (value >= 70) return { label: 'WARM', className: 'is-warm' };
  return { label: 'NORMAL', className: 'is-normal' };
}

const ThermalIcon = ({ type }: { type: 'fan' | 'history' | 'load' | 'display' }) => {
  if (type === 'fan') return <><path d="M12 12c-4-1-5-5-3-7 2-2 5 1 4 5m-1 2c1-4 5-5 7-3 2 2-1 5-5 4m-2-1c4 1 5 5 3 7-2 2-5-1-4-5m1-2c-1 4-5 5-7 3-2-2 1-5 5-4" /><circle cx="12" cy="12" r="1.5" /></>;
  if (type === 'history') return <><path d="M4 19V5m0 14h16" /><path d="m6 16 4-5 3 2 5-7" /></>;
  if (type === 'load') return <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 12h2l1.5-4 2.5 8 1.5-4H18" /></>;
  return <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>;
};

export const PowerSection: React.FC<PowerSectionProps> = ({
  cpuTemp,
  gpuTemp,
  running,
  toggleControl,
  selectedScenario,
  requestScenarioChange,
  constantSpeedEnabled,
  setConstantSpeedEnabled,
  constantSpeed,
  setConstantSpeed,
  language = 'en',
}) => {
  const [cpuHistory, setCpuHistory] = useState(fallbackCpuHistory);
  const [gpuHistory, setGpuHistory] = useState(fallbackGpuHistory);

  useEffect(() => {
    if (typeof cpuTemp === 'number') setCpuHistory((history) => [...history.slice(-15), cpuTemp]);
  }, [cpuTemp]);

  useEffect(() => {
    if (typeof gpuTemp === 'number') setGpuHistory((history) => [...history.slice(-15), gpuTemp]);
  }, [gpuTemp]);

  const chartLines = useMemo(() => {
    const toPoints = (history: number[]) => history.map((temperature, index) => {
      const x = (index / Math.max(1, history.length - 1)) * 280;
      const y = 128 - ((Math.min(100, Math.max(25, temperature)) - 25) / 75) * 108;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return { cpu: toPoints(cpuHistory), gpu: toPoints(gpuHistory) };
  }, [cpuHistory, gpuHistory]);

  const maxFanThreshold = constantSpeed;
  const isZh = language === 'zh';

  const updateLinkedFanSpeed = (value: number) => {
    if (!constantSpeedEnabled) setConstantSpeedEnabled(true);
    setConstantSpeed(value);
  };

  return (
    <div className="thermal-dashboard power-dashboard">
      <main className="thermal-dashboard-grid">
        <div className="thermal-column thermal-column-center">
          <section className="aurora-fan-hero" aria-label={tr(language, 'Primary fan status', '主风扇状态')}>
            <div className="aurora-fan-hero-copy">
              <span className="aurora-kicker">{isZh ? '风扇控制' : 'FAN CONTROL'}</span>
              <strong>{running ? (isZh ? '手动' : 'MANUAL') : (isZh ? '自动' : 'AUTO')}</strong>
            </div>
            <div className="aurora-fan-visual" aria-hidden="true">
              <div className="aurora-fan-ring aurora-fan-ring-outer" />
              <div className="aurora-fan-ring aurora-fan-ring-inner" />
              <div
                className="aurora-fan-blades"
                style={{ '--aurora-fan-duration': `${Math.max(0.38, 2.25 - maxFanThreshold * 0.017)}s` } as React.CSSProperties}
              ><i /><i /><i /><i /><i /><i /><i /></div>
              <div className="aurora-fan-hub"><span>{isZh ? '风扇 01' : 'FAN 01'}</span><strong>{maxFanThreshold}%</strong><small>{isZh ? '上限' : 'CEILING'}</small></div>
            </div>
            <div className="aurora-fan-hero-meta">
              <span><small>CPU</small><strong>{cpuTemp === '--' ? '--' : `${cpuTemp}°C`}</strong></span>
              <span><small>GPU</small><strong>{gpuTemp === '--' ? '--' : `${gpuTemp}°C`}</strong></span>
            </div>
          </section>
          <section className="thermal-panel thermal-fan-panel">
            <div className="thermal-panel-heading">
              <span className="thermal-heading-icon"><svg viewBox="0 0 24 24"><ThermalIcon type="fan" /></svg></span>
              <div><h3>{isZh ? '风扇阈值' : 'FAN LIMIT'}</h3><p>{isZh ? 'CPU / GPU 共享控制' : 'SHARED CPU / GPU CONTROL'}</p></div>
              <button type="button" className={running ? 'is-active' : ''} onClick={toggleControl}>{running ? (isZh ? 'EC 接管' : 'EC TAKEOVER') : (isZh ? '自动模式' : 'AUTO MODE')}</button>
            </div>
            <div className="thermal-fan-sliders">
              <label><span><b>{isZh ? '最高输出限制' : 'MAX OUTPUT LIMIT'}</b><small>{isZh ? 'CPU / GPU 共享风扇上限' : 'SHARED CPU / GPU FAN CEILING'}</small><strong>{maxFanThreshold}%</strong></span><input aria-label={isZh ? '最高风扇输出限制' : 'Maximum fan output limit'} type="range" min="20" max="100" value={maxFanThreshold} onChange={(event) => updateLinkedFanSpeed(Number(event.target.value))} /><i><em>20%</em><em>60%</em><em>100%</em></i></label>
            </div>
            <label className="thermal-link-control"><input type="checkbox" checked={constantSpeedEnabled} onChange={(event) => setConstantSpeedEnabled(event.target.checked)} /><span>{isZh ? '启用风扇上限' : 'ENABLE FAN CEILING'}</span><small>{isZh ? '同时应用到两组风扇' : 'APPLIES TO BOTH FANS'}</small></label>
          </section>

          <section className="thermal-panel thermal-mode-panel">
            <div className="thermal-section-label">{isZh ? '性能模式' : 'PERFORMANCE MODE'}</div>
            <div className="thermal-mode-grid">
              {Object.keys(SCENARIOS).map((key, index) => (
                <button key={key} type="button" className={selectedScenario === key ? 'is-active' : ''} onClick={() => requestScenarioChange(key)}>
                  <svg viewBox="0 0 24 24"><path d={index === 0 ? 'M12 3v18M4 12h16' : index === 1 ? 'M4 5h16v12H4zM8 21h8' : 'M13 2 4 14h7l-1 8 9-12h-7l1-8Z'} /></svg>
                  <span>{scenarioLabel(language, key)}</span><small>{scenarioNoise(language, key)}</small>
                </button>
              ))}
            </div>
          </section>
        </div>

        <div className="thermal-column thermal-column-right">
          <section className="aurora-device-stack" aria-label={tr(language, 'Device status', '设备状态')}>
            <div className="aurora-stack-heading"><h3>{isZh ? '设备状态' : 'DEVICE STATUS'}</h3></div>
            {[
              { label: 'CPU', value: cpuTemp, accent: 'cyan' },
              { label: 'GPU', value: gpuTemp, accent: 'violet' },
            ].map((device) => (
              <div className={`aurora-device-card is-compact ${device.accent}`} key={device.label}>
                <div className="aurora-device-icon">◈</div>
                <div className="aurora-device-name"><strong>{device.label}</strong><small>{device.value === '--' ? '--' : `${device.value}°C`}</small></div>
                <div className="aurora-device-state"><small>{isZh ? '温度状态' : 'THERMAL STATE'}</small><strong>{tr(language, temperatureState(device.value).label, temperatureState(device.value).label === 'NORMAL' ? '正常' : temperatureState(device.value).label === 'WARM' ? '偏热' : temperatureState(device.value).label === 'HOT' ? '高温' : '等待中')}</strong></div>
                <i className="aurora-device-meter"><b /></i>
              </div>
            ))}
          </section>
          <section className="thermal-panel thermal-history-panel">
            <div className="thermal-panel-heading compact"><div><h3>{isZh ? '温度趋势' : 'TEMPERATURE HISTORY'}</h3><p><i className="cpu-dot" />CPU <i className="gpu-dot" />GPU</p></div></div>
            <div className="thermal-chart-wrap">
              <span className="chart-y-label y100">100°</span><span className="chart-y-label y75">75°</span><span className="chart-y-label y50">50°</span><span className="chart-y-label y25">25°</span>
              <svg viewBox="0 0 280 140" preserveAspectRatio="none" aria-label={tr(language, 'CPU and GPU temperature history chart', 'CPU 与 GPU 温度历史图表')}>
                <defs><linearGradient id="cpuHistoryFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#e42f35" stopOpacity=".26" /><stop offset="1" stopColor="#e42f35" stopOpacity="0" /></linearGradient></defs>
                <path className="chart-grid-lines" d="M0 20H280M0 56H280M0 92H280M0 128H280" />
                <polyline className="gpu-history-line" points={chartLines.gpu} />
                <polyline className="cpu-history-line" points={chartLines.cpu} />
              </svg>
              <div className="thermal-chart-time"><span>60M</span><span>45M</span><span>30M</span><span>15M</span><span>{isZh ? '当前' : 'NOW'}</span></div>
            </div>
          </section>

        </div>
      </main>

    </div>
  );
};

export default PowerSection;
