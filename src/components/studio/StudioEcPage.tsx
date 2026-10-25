import { useState, type Dispatch, type SetStateAction } from 'react';
import { SCENARIOS } from '../../hooks/useFanControl';
import type { FanScenarioId } from '../../types/appSettings';
import { FanReadout, StudioIcon, StudioPageFrame, StudioSwitch } from './StudioAtoms';
import type { StudioFan } from './StudioTypes';

function CurvePreview({ title, points, color }: { title: string; points: StudioFan['cpuCurve']; color: string }) {
  const coordinates = points.map((point) => {
    const x = ((point.temperature - 35) / 50) * 480 + 10;
    const y = 130 - (point.speed / 100) * 116;
    return `${x},${y}`;
  }).join(' ');
  return <section className="nss-ec-curve"><div><strong>{title}</strong><small>EC 风扇曲线</small></div><svg viewBox="0 0 500 155" role="img" aria-label={`${title} EC 风扇曲线预览`}>
    {[25, 50, 75, 100].map((percent) => <g key={percent}><line x1="10" x2="490" y1={130 - percent * 1.16} y2={130 - percent * 1.16} /><text x="0" y={134 - percent * 1.16}>{percent}</text></g>)}
    <polyline points={coordinates} fill="none" stroke={color} strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
    {points.map((point) => <circle key={point.temperature} cx={((point.temperature - 35) / 50) * 480 + 10} cy={130 - (point.speed / 100) * 116} r="3.3" fill={color} />)}
    <text x="10" y="151">35°C</text><text x="452" y="151">85°C</text>
  </svg><small>温度上升时按曲线提高风扇输出；具体转速以 EC 实际遥测为准。</small></section>;
}

function CurveEditor({ title, points, setPoints, onEdit }: {
  title: string;
  points: StudioFan['cpuCurve'];
  setPoints: Dispatch<SetStateAction<StudioFan['cpuCurve']>>;
  onEdit: () => void;
}) {
  return <details className="nss-ec-editor"><summary>{title} 风扇曲线微调</summary><div className="nss-ec-editor-grid">{points.map((point, index) => <label key={point.temperature}><span>{point.temperature}°C</span><input type="range" min={index === 0 ? 0 : points[index - 1].speed} max={index === points.length - 1 ? 100 : points[index + 1].speed} value={point.speed} onChange={(event) => { const speed = Number(event.target.value); onEdit(); setPoints((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, speed } : item)); }} aria-label={`${title}风扇在${point.temperature}度时的速度`} /><output>{point.speed}%</output></label>)}</div><small>滑块限制为相邻点之间的单调曲线，防止温度升高时风扇输出反向下降。</small></details>;
}

export function StudioEcPage({ fan, onHome }: { fan: StudioFan; onHome: () => void }) {
  const [curveEdited, setCurveEdited] = useState(false);
  const scenarioLabels: Record<FanScenarioId, string> = { quiet: '安静', balanced: '均衡', cooling: '散热优先' };
  const health = fan.actorState === 'danger' ? '风扇异常' : fan.running ? 'EC 正在控制' : '系统控制中';
  const healthClass = fan.actorState === 'danger' ? 'is-danger' : fan.running ? 'is-active' : '';
  return <StudioPageFrame title="EC 风扇控制" icon="fan" onHome={onHome}>
    <div className="nss-ec-statusbar"><div><span className={`nss-ec-health ${healthClass}`}><i />{health}</span><small>{fan.running ? `EC 状态：${fan.actorStateText} · 最近采样 ${fan.lastSampledTime}` : 'EC 未接管，风扇由系统策略管理'}</small></div><button type="button" className={fan.running ? 'nss-ec-release' : 'nss-ec-takeover'} disabled={fan.busy} onClick={() => void fan.toggleControl()}>{fan.busy ? '正在切换…' : fan.running ? '交还系统控制' : '启用 EC 控制'}</button></div>
    <div className="nss-ec-readouts"><article><StudioIcon name="fan" size={32} /><div><small>CPU 温度</small><strong>{fan.cpuTemp === '--' ? '—' : `${fan.cpuTemp}°C`}</strong></div><FanReadout label="CPU 风扇" rpm={fan.cpuFanRpm} /></article><article><StudioIcon name="fan" size={32} /><div><small>GPU 温度</small><strong>{fan.gpuTemp === '--' ? '—' : `${fan.gpuTemp}°C`}</strong></div><FanReadout label="GPU 风扇" rpm={fan.gpuFanRpm} /></article></div>
    <section className="nss-ec-section"><div className="nss-ec-section-heading"><div><h2>EC 散热策略</h2><p>只调整风扇曲线，不会切换 NUCtool.dll 性能档位。选择策略后启用接管；运行中调整会自动同步。</p></div><span>当前：{curveEdited ? `自定义（${scenarioLabels[fan.selectedScenario]}为基线）` : scenarioLabels[fan.selectedScenario]}</span></div><div className="nss-ec-scenarios">{(['quiet', 'balanced', 'cooling'] as FanScenarioId[]).map((scenario) => <button key={scenario} type="button" className={!curveEdited && fan.selectedScenario === scenario ? 'is-current' : ''} disabled={fan.busy} onClick={() => { fan.setSelectedScenario(scenario); setCurveEdited(false); }}><strong>{scenarioLabels[scenario]}</strong><small>{SCENARIOS[scenario].detailZh}</small><em>{SCENARIOS[scenario].tags.join(' · ')}</em></button>)}</div>
      <div className="nss-ec-curves"><CurvePreview title="CPU" points={fan.cpuCurve} color="#00b5e8" /><CurvePreview title="GPU" points={fan.gpuCurve} color="#3bd6c9" /></div>
      <div className="nss-ec-manual"><CurveEditor title="CPU" points={fan.cpuCurve} setPoints={fan.setCpuCurve} onEdit={() => setCurveEdited(true)} /><CurveEditor title="GPU" points={fan.gpuCurve} setPoints={fan.setGpuCurve} onEdit={() => setCurveEdited(true)} /></div>
      <div className="nss-ec-advanced"><div><span>恒定转速</span><StudioSwitch label="EC 恒定转速模式" checked={fan.constantSpeedEnabled} disabled={fan.busy} onChange={fan.setConstantSpeedEnabled} /><input type="range" min="20" max="100" step="5" value={fan.constantSpeed} disabled={fan.busy || !fan.constantSpeedEnabled} onChange={(event) => fan.setConstantSpeed(Number(event.target.value))} aria-label="EC 恒定风扇速度" /><output>{fan.constantSpeed}%</output></div><div><span>开机后接管风扇</span><StudioSwitch label="开机自动接管 EC 风扇" checked={fan.startupTakeoverEnabled} disabled={fan.busy} onChange={(enabled) => void fan.setStartupTakeoverEnabled(enabled)} /><small>保存策略；下次启动 NUCtool 后生效</small></div></div>
      <div className="nss-ec-actions"><div><strong>异常保护</strong><small>{fan.actorState === 'danger' ? '检测到风扇异常，后端 EC 保护已介入。' : 'EC 后端负责监测风扇停转并执行保护。'}</small></div><div><strong>遥测采样</strong><small>{fan.droppedSamples > 0 ? `丢失 ${fan.droppedSamples} 个采样点` : '当前未报告丢失采样'} · {fan.lastSampledTime}</small></div><button type="button" disabled={fan.busy} onClick={() => void fan.saveConfig()}>保存当前策略</button></div>
    </section>
  </StudioPageFrame>;
}
