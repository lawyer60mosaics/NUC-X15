import { useEffect, useState } from 'react';
import { SCENARIOS } from '../../hooks/useFanControl';
import type { VendorDisplayMode, VendorDisplayModeId } from '../../hooks/useVendorService';
import type { FanScenarioId } from '../../types/appSettings';
import { FanReadout, StudioIcon, StudioKeyboardArt, StudioPageFrame, StudioRing, StudioSwitch } from './StudioAtoms';
import type { StudioHardware } from './StudioTypes';

const profiles = [
  { label: '性能', id: 'performance', index: 1 },
  { label: '平衡', id: 'balanced', index: 2 },
  { label: '省电', id: 'powersave', index: 3 },
] as const;
const modes: { label: string; id: VendorDisplayModeId | 'custom' }[] = [
  { label: '标准', id: 'standard' }, { label: '游戏', id: 'gaming' },
  { label: '视频', id: 'video' }, { label: '阅读', id: 'reading' }, { label: '自定义', id: 'custom' },
];

export function StudioPerformancePage({ fan, vendor, onHome }: StudioHardware & { onHome: () => void }) {
  const selected = vendor.authorReadback?.current_profile_index;
  const whisper = vendor.serviceData?.whisper?.type;
  return <StudioPageFrame title="性能调优" icon="performance" onHome={onHome}>
    <div className="nss-perf-table-head"><span>性能模式</span><span>厂商档位</span><span>控制来源</span></div>
    {profiles.map((profile) => <div className="nss-perf-row" key={profile.id}>
      <label className="nss-radio-line"><input type="radio" name="vendor-profile" checked={selected === profile.index} disabled={!vendor.displayBridgeAvailable || vendor.busy} onChange={() => void vendor.applyAuthorPowerProfile(profile.id)} />{profile.label}</label>
      <div><small>NUCtool.dll 索引</small><strong>{profile.index}</strong></div>
      <div><small>风扇控制</small><strong>EC 独立管理</strong></div>
    </div>)}
    <p className="nss-hardware-note">NUCtool.dll 性能档位：{selected === 1 ? '性能' : selected === 2 ? '平衡' : selected === 3 ? '省电' : '硬件档位未确认'}。此处是全局档位，暂不支持分别设置插电和电池配置。</p>
    <div className="nss-perf-lower"><div className="nss-perf-options"><div><span>基准模式</span><div className="nss-dual-buttons"><button type="button" disabled={!vendor.displayBridgeAvailable || vendor.busy} onClick={() => void vendor.applyAuthorBenchmarkMode(true)}>请求开启</button><button type="button" disabled={!vendor.displayBridgeAvailable || vendor.busy} onClick={() => void vendor.applyAuthorBenchmarkMode(false)}>请求关闭</button></div></div><small>请求后无法读回；关闭只清除标记，厂商计划 4 保留。</small><div><span>NVIDIA® WhisperMode（60 FPS）</span><StudioSwitch label="NVIDIA WhisperMode" checked={whisper == null ? null : whisper !== 'Off'} disabled={!vendor.serviceConnected || whisper == null || vendor.busy} onChange={(enabled) => void vendor.applyWhisper(enabled)} /></div><small>WhisperMode 由官方服务设置和读回；风扇噪声与最低转速请到 EC 风扇控制页调整。</small></div>
      <div className="nss-ec-box"><strong>EC 风扇控制</strong><small>独立于 NUCtool.dll 性能档位</small><div className="nss-ec-controls"><select value={fan.selectedScenario} onChange={(e) => fan.setSelectedScenario(e.target.value as FanScenarioId)} disabled={fan.busy} aria-label="EC 风扇策略">{(['quiet', 'balanced', 'cooling'] as const).map((scenario) => <option value={scenario} key={scenario}>{scenario === 'quiet' ? '安静' : scenario === 'balanced' ? '均衡' : '散热优先'}</option>)}</select><button type="button" disabled={fan.busy} onClick={() => void fan.toggleControl()}>{fan.running ? '交还系统控制' : '启用 EC 控制'}</button></div><p>{fan.running ? `EC 已接管 · ${SCENARIOS[fan.selectedScenario].detailZh}` : '系统控制风扇，EC 未接管。'}</p></div>
    </div>
    <div className="nss-perf-sensors"><StudioRing label="CPU" value={null} temperature={fan.cpuTemp} color="orange" /><StudioRing label="dGPU" value={null} temperature={fan.gpuTemp} /><FanReadout label="左风扇" rpm={fan.cpuFanRpm} /><FanReadout label="右风扇" rpm={fan.gpuFanRpm} /></div>
  </StudioPageFrame>;
}

export function StudioDisplayPage({ vendor, onHome }: StudioHardware & { onHome: () => void }) {
  const selected = vendor.lastRequestedDisplayMode;
  const custom = vendor.serviceData?.savedDisplayModes?.find((mode) => mode.type === 'Custom');
  const [customOpen, setCustomOpen] = useState(false);
  const [settings, setSettings] = useState<Omit<VendorDisplayMode, 'index' | 'type'>>({ brightnessAc: 50, brightnessDc: 50, colorTemp: 6500, contrast: 50, red: 128, green: 128, blue: 128 });
  useEffect(() => {
    if (custom) setSettings({ brightnessAc: custom.brightnessAc, brightnessDc: custom.brightnessDc, colorTemp: custom.colorTemp, contrast: custom.contrast, red: custom.red, green: custom.green, blue: custom.blue });
  }, [custom?.brightnessAc, custom?.brightnessDc, custom?.colorTemp, custom?.contrast, custom?.red, custom?.green, custom?.blue]);
  const sliders = [
    { key: 'brightnessAc', label: '亮度（外接电源）', min: 0, max: 100, step: 1 },
    { key: 'brightnessDc', label: '亮度（电池）', min: 0, max: 100, step: 1 },
    { key: 'contrast', label: '对比度', min: 0, max: 100, step: 1 },
    { key: 'colorTemp', label: '色温', min: 4000, max: 7500, step: 100 },
    { key: 'red', label: '红色', min: 0, max: 255, step: 1 },
    { key: 'green', label: '绿色', min: 0, max: 255, step: 1 },
    { key: 'blue', label: '蓝色', min: 0, max: 255, step: 1 },
  ] as const;
  return <StudioPageFrame title="显示设置" icon="display" onHome={onHome}>
    <div className="nss-display-detail-grid"><div className="nss-display-mode-list">{modes.map((mode) => <button type="button" key={mode.id} className={(mode.id === 'custom' ? customOpen : selected === mode.id) ? 'is-active' : ''} disabled={mode.id !== 'custom' && (!vendor.displayBridgeAvailable || vendor.busy)} onClick={() => { if (mode.id === 'custom') setCustomOpen(true); else { setCustomOpen(false); void vendor.applyDisplayMode(mode.id as VendorDisplayModeId); } }}><i />{mode.label}</button>)}</div>
      {customOpen ? <div className="nss-display-sliders">{sliders.map(({ key, label, min, max, step }) => <label className="nss-slider-row" key={key}><span>{label}</span><input type="range" min={min} max={max} step={step} value={settings[key]} disabled={!vendor.serviceConnected || !custom || vendor.busy} onChange={(event) => setSettings((previous) => ({ ...previous, [key]: Number(event.target.value) }))} /><output>{settings[key]}{key === 'colorTemp' ? ' K' : ''}</output></label>)}<button className="nss-cyan-button" type="button" disabled={!vendor.serviceConnected || !custom || vendor.busy} onClick={() => void vendor.applyCustomDisplay(settings)}>保存并启用自定义模式</button></div> : <div className="nss-display-summary"><h2>画质预设</h2><p>选择左侧预设后，NUCtool.dll 向设备发送对应模式请求。</p><p>最近请求：{selected ? modes.find((mode) => mode.id === selected)?.label : '无'}。</p><p>选择“自定义”可编辑亮度、对比度、色温与 RGB 色彩。</p></div>}
      <div className="nss-display-help"><strong>状态说明</strong><p>{custom ? `官方服务已读到自定义配置（索引 ${custom.index}）。` : '官方服务尚未读到自定义配置。'}</p><p>自定义参数保存后可读回，但当前实际画质模式无法读回；预设模式也只有请求状态。</p></div></div>
  </StudioPageFrame>;
}

export function StudioKeyboardPage({ vendor, onHome }: StudioHardware & { onHome: () => void }) {
  const [brightness, setBrightness] = useState(vendor.keyboardBrightness);
  const on = vendor.authorReadback?.keyboard_enabled ?? null;
  const currentColor = vendor.serviceData?.lighting?.keyboard?.colors?.[0];
  const colors = ['#ffffff', '#ff3939', '#ff9400', '#f5e84b', '#37dc65', '#22c9f4', '#4b75ef', '#d064ec'];
  return <StudioPageFrame title="键盘" icon="keyboard" onHome={onHome} action={<div className="nss-keyboard-header-controls"><span>键盘背光</span><StudioSwitch label="启用键盘 LED" checked={on} disabled={!vendor.displayBridgeAvailable || vendor.busy} onChange={(enabled) => void vendor.applyKeyboardBasic(enabled, brightness)} /></div>}>
    <div className="nss-keyboard-detail">
      <aside><h3>当前设置</h3><p>灯效：{vendor.serviceData?.lighting?.keyboard?.effect || '未读到'}</p><p>颜色：{currentColor ? `R ${currentColor.r} · G ${currentColor.g} · B ${currentColor.b}` : '未读到'}</p><small>颜色由 Intel NUC 官方服务设置并读回；背光开关与基础亮度由 NUCtool.dll 控制。</small></aside>
      <div className="nss-keyboard-center"><h3>选择固定颜色</h3><div className="nss-color-swatches nss-color-actions">{colors.map((hex) => <button type="button" key={hex} style={{ backgroundColor: hex }} aria-label={`设置键盘灯颜色 ${hex}`} title={hex} disabled={!vendor.serviceConnected || vendor.busy || !vendor.serviceData?.lighting?.keyboard} onClick={() => void vendor.applyKeyboardColor({ r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) })} />)}</div><div className="nss-color-band" /><StudioKeyboardArt /></div>
      <div className="nss-keyboard-side"><label>基础亮度（DLL 请求值）<input type="range" min="0" max="100" step="10" value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} />{brightness}%</label><button type="button" disabled={!vendor.displayBridgeAvailable || vendor.busy} onClick={() => void vendor.applyKeyboardBasic(on ?? true, brightness)}>应用亮度</button><small>开关：{on == null ? '暂不可读' : on ? '硬件已开启' : '硬件已关闭'}。亮度无 DLL 读回，颜色有官方服务读回。</small></div>
    </div>
  </StudioPageFrame>;
}

export function StudioLightbarPage({ vendor, onHome }: StudioHardware & { onHome: () => void }) {
  const [source, setSource] = useState<'ac' | 'battery'>('ac');
  const setting = source === 'ac' ? vendor.serviceData?.lighting?.lightbar?.ac : vendor.serviceData?.lighting?.lightbar?.dc;
  const breathing = vendor.serviceData?.lighting?.lightbar?.breathing ?? false;
  const supported = vendor.serviceConnected && vendor.serviceData?.features?.includes('LightbarSingleColor') && !!setting;
  const [color, setColor] = useState({ r: 49, g: 0, b: 0 });
  useEffect(() => {
    if (setting) setColor({ r: setting.r, g: setting.g, b: setting.b });
  }, [source, setting?.r, setting?.g, setting?.b]);
  const lit = setting ? setting.r + setting.g + setting.b > 0 : null;
  const currentCss = setting ? `rgb(${setting.r * 255 / 100}, ${setting.g * 255 / 100}, ${setting.b * 255 / 100})` : '#263e50';
  const nextCss = `rgb(${color.r * 255 / 100}, ${color.g * 255 / 100}, ${color.b * 255 / 100})`;
  return <StudioPageFrame title="光条" icon="lightbar" onHome={onHome} action={<div className="nss-heading-switch">所选电源下点亮 <StudioSwitch label="所选电源下点亮光条" checked={lit} disabled={!supported || vendor.busy} onChange={(enabled) => void vendor.applyLightbar(source, enabled ? (color.r + color.g + color.b > 0 ? color : { r: 49, g: 0, b: 0 }) : { r: 0, g: 0, b: 0 }, breathing)} /></div>}>
    <div className="nss-lightbar-tabs"><button type="button" className={source === 'ac' ? 'is-active' : ''} onClick={() => setSource('ac')}>使用外接电源</button><button type="button" className={source === 'battery' ? 'is-active' : ''} onClick={() => setSource('battery')}>使用电池</button></div>
    <div className="nss-lightbar-editor"><div><div className="nss-long-light" style={{ backgroundColor: currentCss }} /><h3>当前状态</h3><p>{setting ? `官方服务读回：${setting.effect} · R ${setting.r} G ${setting.g} B ${setting.b}` : '官方服务未读到光条状态'}</p><p>呼吸效果 <StudioSwitch label="光条呼吸效果" checked={setting ? breathing : null} disabled={!supported || vendor.busy} onChange={(enabled) => void vendor.applyLightbar(source, { r: setting?.r ?? color.r, g: setting?.g ?? color.g, b: setting?.b ?? color.b }, enabled)} /></p></div><div><h3>当前颜色　　　新颜色</h3><div className="nss-color-squares"><i style={{ backgroundColor: currentCss }} /><i style={{ backgroundColor: nextCss }} /></div>{(['r', 'g', 'b'] as const).map((channel) => <label className="nss-slider-row" key={channel}><span>{{ r: '红色', g: '绿色', b: '蓝色' }[channel]}</span><input type="range" min="0" max="100" value={color[channel]} disabled={!supported || vendor.busy} onChange={(event) => setColor((previous) => ({ ...previous, [channel]: Number(event.target.value) }))} /><output>{color[channel]}%</output></label>)}</div><div><h3>应用到{source === 'ac' ? '外接电源' : '电池'}配置</h3><p>只修改当前电源配置，保留另一侧颜色。</p><button type="button" disabled={!supported || vendor.busy} onClick={() => void vendor.applyLightbar(source, color, breathing)}>应用颜色</button></div></div><p className="nss-hardware-note">{supported ? '颜色与呼吸状态通过官方 Uniwill 服务设置并读回。' : '官方服务尚未报告单色光条能力，或当前状态未读到。'}</p>
  </StudioPageFrame>;
}

export function StudioMonitorPage({ fan, power, onHome }: StudioHardware & { onHome: () => void }) {
  return <div className="nss-monitor-panel"><div className="nss-monitor-heading"><StudioIcon name="monitor" size={50} /><h1>系统监视器</h1><div className="nss-monitor-battery"><StudioIcon name="battery" size={23} />{power.batteryPercent == null ? '—' : `${power.batteryPercent}%`}</div><button type="button" onClick={onHome} aria-label="关闭系统监视器">×</button></div>
    <div className="nss-monitor-grid">{[
      { title: 'CPU', temp: fan.cpuTemp, stats: [['频率','—'],['功耗','—'],['使用率','—']] },
      { title: '内存', temp: '--' as const, stats: [['容量','—'],['已使用','—'],['使用率','—']] },
      { title: 'iGPU', temp: '--' as const, stats: [['频率','—'],['功耗','—'],['使用率','—']] },
      { title: 'dGPU', temp: fan.gpuTemp, stats: [['频率','—'],['功耗','—'],['使用率','—']] },
    ].map((item) => <section key={item.title}><h2>{item.title}</h2><StudioRing value={null} temperature={item.temp} /><div>{item.stats.map(([label,value]) => <p key={label}>{label}<strong>{value}</strong></p>)}</div></section>)}</div>
    <div className="nss-monitor-bottom"><div>系统信息：<span>BIOS —　设备型号 —　EC 版本 —</span></div><FanReadout label="左风扇" rpm={fan.cpuFanRpm} /><FanReadout label="右风扇" rpm={fan.gpuFanRpm} /></div><p className="nss-monitor-footnote">— 表示当前服务没有可靠读数，并非 0。</p>
  </div>;
}
