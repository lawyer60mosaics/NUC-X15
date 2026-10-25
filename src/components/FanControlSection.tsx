import React, { useEffect, useState } from 'react';
import { SCENARIOS, CurvePoint } from '../hooks/useFanControl';
import { scenarioLabel } from '../i18n';
import { FanControlSectionProps, SensorValue } from './powerTypes';

const CurveEditor: React.FC<{
  kind: 'cpu' | 'gpu';
  curve: CurvePoint[];
  temperature: SensorValue;
  rpm: SensorValue;
  editable: boolean;
  onChange: (curve: CurvePoint[]) => void;
  isZh: boolean;
}> = ({ kind, curve, temperature, rpm, editable, onChange, isZh }) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const chart = { left: 36, top: 12, width: 472, height: 140 };
  const safeIndex = Math.min(selectedIndex, Math.max(0, curve.length - 1));
  const selected = curve[safeIndex];

  useEffect(() => {
    if (selectedIndex >= curve.length) setSelectedIndex(Math.max(0, curve.length - 1));
  }, [curve.length, selectedIndex]);

  const updatePoint = (index: number, requestedSpeed: number) => {
    if (!editable || !curve[index]) return;
    const previous = index > 0 ? curve[index - 1].speed : 0;
    const next = index < curve.length - 1 ? curve[index + 1].speed : 100;
    const speed = Math.max(previous, Math.min(next, Math.round(requestedSpeed)));
    onChange(curve.map((point, pointIndex) => pointIndex === index ? { ...point, speed } : point));
    setSelectedIndex(index);
  };

  const updateFromPointer = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!editable || curve.length === 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * 520;
    const y = ((event.clientY - bounds.top) / bounds.height) * 180;
    const index = Math.max(0, Math.min(curve.length - 1, Math.round(((x - chart.left) / chart.width) * (curve.length - 1))));
    const speed = 100 - ((y - chart.top) / chart.height) * 100;
    updatePoint(index, Math.max(0, Math.min(100, speed)));
  };

  const points = curve.map((point, index) => ({
    x: chart.left + (index / Math.max(1, curve.length - 1)) * chart.width,
    y: chart.top + ((100 - point.speed) / 100) * chart.height,
    ...point,
  }));

  return (
    <article className={`fan-curve-card is-${kind} ${editable ? '' : 'is-readonly'}`}>
      <div className="fan-curve-heading">
        <div>
          <span className="fan-series-mark" aria-hidden="true" />
          <strong>{kind.toUpperCase()} {isZh ? '风扇曲线' : 'FAN CURVE'}</strong>
          <small>{editable ? (isZh ? '拖动节点调整' : 'DRAG POINTS TO TUNE') : (isZh ? '当前不可编辑' : 'EDITING UNAVAILABLE')}</small>
        </div>
        <div className="fan-live-reading">
          <strong>{rpm === '--' ? '--' : rpm.toLocaleString()}</strong><small>RPM</small>
          <span>{temperature === '--' ? '--' : `${temperature}°C`}</span>
        </div>
      </div>
      <svg
        className="fan-curve-chart"
        viewBox="0 0 520 180"
        role="img"
        aria-label={`${kind.toUpperCase()} ${isZh ? '风扇温度曲线' : 'fan temperature curve'}`}
        onPointerDown={(event) => {
          if (!editable) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          updateFromPointer(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPointer(event);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
      >
        {[0, 25, 50, 75, 100].map((value) => {
          const y = chart.top + ((100 - value) / 100) * chart.height;
          return <g key={value}><line x1={chart.left} x2={chart.left + chart.width} y1={y} y2={y} /><text x="2" y={y + 3}>{value}%</text></g>;
        })}
        <polyline points={points.map((point) => `${point.x},${point.y}`).join(' ')} />
        {points.map((point, index) => (
          <circle key={`${point.temperature}-${index}`} cx={point.x} cy={point.y} r={index === safeIndex ? 5.5 : 4} className={index === safeIndex ? 'is-selected' : ''} onPointerDown={() => setSelectedIndex(index)} />
        ))}
        {points.length > 0 && <>
          <text className="curve-temp-label" x={chart.left} y="176">{points[0].temperature}°</text>
          <text className="curve-temp-label" x={chart.left + chart.width} y="176" textAnchor="end">{points[points.length - 1].temperature}°C</text>
        </>}
      </svg>
      <div className="curve-point-control">
        <span>{selected ? `${selected.temperature}°C` : '--'}</span>
        <input
          type="range"
          min={safeIndex > 0 ? curve[safeIndex - 1].speed : 0}
          max={safeIndex < curve.length - 1 ? curve[safeIndex + 1].speed : 100}
          value={selected?.speed ?? 0}
          disabled={!editable || !selected}
          onChange={(event) => updatePoint(safeIndex, Number(event.target.value))}
          aria-label={`${kind.toUpperCase()} ${selected?.temperature ?? '--'}°C fan speed`}
        />
        <strong>{selected ? `${selected.speed}%` : '--'}</strong>
      </div>
    </article>
  );
};

export const FanControlSection: React.FC<FanControlSectionProps> = ({
  cpuTemp, gpuTemp, cpuFanRpm, gpuFanRpm, running, toggleControl,
  fanControlBackend, selectedScenario, onSelectFanScenario,
  constantSpeedEnabled, setConstantSpeedEnabled, constantSpeed, setConstantSpeed,
  cpuCurve, gpuCurve, setCpuCurve, setGpuCurve, saveFanConfig,
  resetCurveToScenario, fanBusy, language = 'en',
}) => {
  const isZh = language === 'zh';
  const usesDirectEc = fanControlBackend === 'direct_ec';
  const setFanSpeed = (value: number) => {
    if (!constantSpeedEnabled) setConstantSpeedEnabled(true);
    setConstantSpeed(value);
  };

  return (
    <div className="dashboard-section power-dashboard fan-dashboard">
      <div className="section-intro">
        <span className="section-kicker">02 / {isZh ? '散热 · EC 控制' : 'COOLING · EC CONTROL'}</span>
        <h2>{isZh ? '风扇控制' : 'FAN CONTROL'}</h2>
        <p>{isZh ? '本页只调节 EC 风扇，不改变 NUCtool.dll 性能档、基准模式或 Windows 电源方案。' : 'Controls EC fans only. It does not change NUCtool.dll profiles, benchmark mode, or Windows power plans.'}</p>
      </div>

      <section className="fan-live-strip" aria-label={isZh ? '实时风扇状态' : 'Live fan status'}>
        <article><span>CPU</span><strong>{cpuTemp === '--' ? '--' : `${cpuTemp}°C`}</strong><small>{cpuFanRpm === '--' ? '-- RPM' : `${cpuFanRpm.toLocaleString()} RPM`}</small></article>
        <article><span>GPU</span><strong>{gpuTemp === '--' ? '--' : `${gpuTemp}°C`}</strong><small>{gpuFanRpm === '--' ? '-- RPM' : `${gpuFanRpm.toLocaleString()} RPM`}</small></article>
        <article className="fan-live-control"><span>{isZh ? 'EC 控制状态' : 'EC CONTROL'}</span><strong>{running ? (isZh ? '运行中' : 'RUNNING') : (isZh ? '未接管' : 'NOT ACTIVE')}</strong><small>{constantSpeedEnabled ? (isZh ? `固定 ${constantSpeed}%` : `Fixed ${constantSpeed}%`) : (isZh ? '自动曲线' : 'Auto curve')}</small></article>
      </section>

      <section className="panel fan-control-simple">
        <div className="panel-header">
          <div>
            <span className="panel-kicker">EC / {isZh ? '风扇控制' : 'FAN CONTROL'}</span>
            <h3>{isZh ? '风扇运行方式' : 'FAN BEHAVIOR'}</h3>
            <p>{isZh ? '静音、均衡、散热优先三档，可按需要调整曲线。' : 'Choose a quiet, balanced, or cooling-focused curve and tune it as needed.'}</p>
          </div>
          <button className={`button ${running ? 'button-secondary' : 'button-primary'}`} type="button" onClick={toggleControl} disabled={!usesDirectEc || fanBusy}>
            {running ? (isZh ? '停止 EC 控制' : 'STOP EC CONTROL') : (isZh ? '启动 EC 控制' : 'START EC CONTROL')}
          </button>
        </div>
        <div className="fan-control-options">
          <div>
            <span className="form-label">{isZh ? '风扇曲线预设' : 'FAN CURVE PRESET'}</span>
            <div className="fan-strategy-grid fan-scene-grid">
              {Object.keys(SCENARIOS).map((scenario) => (
                <button key={scenario} type="button" className={selectedScenario === scenario ? 'is-active' : ''} aria-pressed={selectedScenario === scenario} onClick={() => onSelectFanScenario(scenario)} disabled={!usesDirectEc || fanBusy}>
                  <strong>{scenarioLabel(language, scenario)}</strong>
                  <small>{isZh ? SCENARIOS[scenario as keyof typeof SCENARIOS].detailZh : SCENARIOS[scenario as keyof typeof SCENARIOS].detailEn}</small>
                </button>
              ))}
            </div>
          </div>
          <div className="fan-strategy-grid">
            <button type="button" className={!constantSpeedEnabled ? 'is-active' : ''} aria-pressed={!constantSpeedEnabled} onClick={() => setConstantSpeedEnabled(false)} disabled={!usesDirectEc || fanBusy}>
              <strong>{isZh ? '自动温度曲线' : 'AUTOMATIC CURVE'}</strong><small>{isZh ? '推荐 · 根据 CPU/GPU 温度动态调速' : 'Recommended · follows CPU/GPU temperature'}</small>
            </button>
            <button type="button" className={constantSpeedEnabled ? 'is-active' : ''} aria-pressed={constantSpeedEnabled} onClick={() => setConstantSpeedEnabled(true)} disabled={!usesDirectEc || fanBusy}>
              <strong>{isZh ? '固定转速' : 'FIXED OUTPUT'}</strong><small>{isZh ? '测试用 · CPU/GPU 使用相同输出' : 'For testing · shared CPU/GPU output'}</small>
            </button>
          </div>
          {constantSpeedEnabled && (
            <div className="range-field fan-fixed-range">
              <label htmlFor="fan-output-limit"><span>{isZh ? '固定输出' : 'FIXED OUTPUT'}</span><strong>{constantSpeed}%</strong></label>
              <input id="fan-output-limit" type="range" min="20" max="100" value={constantSpeed} onChange={(event) => setFanSpeed(Number(event.target.value))} disabled={!usesDirectEc || fanBusy} />
              <div className="range-scale"><span>20%</span><span>60%</span><span>100%</span></div>
            </div>
          )}
        </div>
      </section>

      <section className="panel fan-curves-panel">
        <div className="panel-header compact">
          <div>
            <span className="panel-kicker">EC / {isZh ? '曲线调校' : 'CURVE TUNING'}</span>
            <h3>{isZh ? 'CPU / GPU 温度曲线' : 'CPU / GPU TEMPERATURE CURVES'}</h3>
            <p>{constantSpeedEnabled ? (isZh ? '固定转速开启时曲线只读。' : 'Curves are read-only while fixed output is active.') : (isZh ? '拖动节点调整，曲线会自动保持递增。' : 'Drag points to tune; curves remain monotonic automatically.')}</p>
          </div>
          <div className="fan-curve-actions">
            <button className="button button-secondary button-small" type="button" onClick={() => resetCurveToScenario(selectedScenario)} disabled={!usesDirectEc || fanBusy}>{isZh ? '恢复预设' : 'RESET PRESET'}</button>
            <button className="button button-primary button-small" type="button" onClick={saveFanConfig} disabled={!usesDirectEc || fanBusy}>{fanBusy ? (isZh ? '正在同步' : 'SYNCING') : (isZh ? '保存并应用' : 'SAVE & APPLY')}</button>
          </div>
        </div>
        <div className="fan-curves-grid">
          <CurveEditor kind="cpu" curve={cpuCurve} temperature={cpuTemp} rpm={cpuFanRpm} editable={usesDirectEc && !constantSpeedEnabled} onChange={setCpuCurve} isZh={isZh} />
          <CurveEditor kind="gpu" curve={gpuCurve} temperature={gpuTemp} rpm={gpuFanRpm} editable={usesDirectEc && !constantSpeedEnabled} onChange={setGpuCurve} isZh={isZh} />
        </div>
      </section>
    </div>
  );
};

export default FanControlSection;
