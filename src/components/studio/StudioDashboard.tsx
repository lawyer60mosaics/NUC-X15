import { useEffect, useState } from 'react';
import { FanReadout, StudioIcon, StudioKeyboardArt, StudioRing, StudioSwitch, type StudioPage } from './StudioAtoms';
import type { StudioHardware } from './StudioTypes';
import type { VendorDisplayModeId } from '../../hooks/useVendorService';

const visualChoices: { value: VendorDisplayModeId | 'custom'; label: string }[] = [
  { value: 'standard', label: '标准' },
  { value: 'gaming', label: '游戏' },
  { value: 'video', label: '视频' },
  { value: 'reading', label: '阅读' },
  { value: 'custom', label: '自定义' },
];

export function StudioDashboard({ fan, power, vendor, navigate }: StudioHardware & { navigate: (page: StudioPage) => void }) {
  const [batteryChoice, setBatteryChoice] = useState<'best' | 'custom' | 'full'>('custom');
  useEffect(() => {
    if (vendor.serviceData?.battery?.mode === 'BestBattery') setBatteryChoice('best');
  }, [vendor.serviceData?.battery?.mode]);
  const profileIndex = vendor.authorReadback?.current_profile_index;
  const profileLabel = profileIndex === 1 ? '性能' : profileIndex === 2 ? '平衡' : profileIndex === 3 ? '省电' : '未确认';
  const displayPreview = vendor.lastRequestedDisplayMode;
  const batteryReadback = vendor.authorReadback?.battery_charging_level;
  const lightbar = vendor.serviceData?.lighting?.lightbar;
  const lightbarAc = lightbar?.ac;
  const lightbarDc = lightbar?.dc;
  const lightbarSupported = vendor.serviceConnected && vendor.serviceData?.features?.includes('LightbarSingleColor') && !!lightbarAc;
  const lightbarCss = (setting?: { r: number; g: number; b: number }) => setting ? `rgb(${setting.r * 255 / 100}, ${setting.g * 255 / 100}, ${setting.b * 255 / 100})` : '#304759';
  const keyStates = new Map(vendor.serviceData?.keyStates?.map((state) => [state.type, state.state]));
  const keyControls = [
    { label: '数字键盘', type: 'NumPad' },
    { label: 'Windows 键', type: 'WinKey' },
    { label: 'Fn 键可用', type: 'FnKey' },
    { label: '允许触控板快捷键', type: 'DisableTouchPadToggle', inverted: true },
  ] as const;

  return <div className="nss-dashboard">
    <div className="nss-home-top">
      <section className="nss-home-card nss-system-card">
        <div className="nss-card-title"><StudioIcon name="gear" /><h2>系统配置</h2></div>
        <div className="nss-system-body">
          <div className="nss-system-toggles">
            {keyControls.map(({ label, type, ...control }) => {
              const raw = keyStates.get(type);
              const inverted = 'inverted' in control && control.inverted;
              return <div className="nss-system-toggle" key={type}><span>{label}:</span><StudioSwitch checked={raw == null ? null : inverted ? !raw : raw} label={label} disabled={!vendor.serviceConnected || raw == null || vendor.busy} onChange={(enabled) => void vendor.applyStudioKey(type, inverted ? !enabled : enabled)} /></div>;
            })}
            <div className="nss-system-toggle"><span>屏幕提示（请求）:</span><StudioSwitch checked={vendor.lastRequestedOsd} label="屏幕提示请求；状态无法读回" disabled={!vendor.serviceConnected || vendor.busy} onChange={(enabled) => void vendor.applyStudioOsd(enabled)} /></div>
          </div>
          <div className="nss-battery-options"><h3>电池健康优化器</h3>
            <label><input type="radio" checked={batteryChoice === 'best'} onChange={() => setBatteryChoice('best')} />最佳电池健康</label>
            <label><input type="radio" checked={batteryChoice === 'custom'} onChange={() => setBatteryChoice('custom')} />定制</label>
            <label><input type="radio" checked={batteryChoice === 'full'} onChange={() => setBatteryChoice('full')} />充电达到 100% 电量</label>
            {batteryChoice === 'custom' && <div className="nss-battery-edit"><input type="range" min="50" max="100" step="5" value={vendor.batteryLevel} onChange={(event) => vendor.setBatteryLevel(Number(event.target.value))} aria-label="拟设置电池充电上限" /><span>{vendor.batteryLevel}%</span></div>}
            <button type="button" className="nss-mini-apply" disabled={vendor.busy || (batteryChoice === 'best' ? !vendor.serviceConnected : !vendor.displayBridgeAvailable)} onClick={() => void (batteryChoice === 'best' ? vendor.applyBestBattery() : vendor.applyBattery(batteryChoice === 'full' ? 100 : vendor.batteryLevel))}>{batteryChoice === 'best' ? '应用健康模式' : '应用上限'}</button>
          </div>
          <div className="nss-battery-illustration"><span>电池电量限制</span><div className="nss-battery-drawing"><i /></div><strong>{batteryReadback == null ? '—' : `${batteryReadback}%`}</strong><small>硬件读回</small><em>{power.batteryPercent == null ? '电量未知' : `当前 ${power.batteryPercent}%`}</em></div>
        </div>
      </section>

      <section className="nss-home-card nss-performance-card">
        <div className="nss-card-title"><StudioIcon name="performance" /><h2>性能调优</h2><button type="button" className="nss-card-arrow" onClick={() => navigate('performance')} aria-label="打开性能调优">➜</button></div>
        <div className="nss-performance-overview"><div><h3>性能模式</h3><p>全局：　{profileLabel}<br />AC/DC：　未独立设置</p></div><div><h3>风扇模式</h3><p>EC：　{fan.running ? '自定义接管' : '系统控制'}<br />AC/DC：　未独立设置</p></div><div><h3>风扇速度</h3></div></div>
        <div className="nss-performance-telemetry"><div className="nss-performance-rings"><StudioRing label="CPU" value={null} temperature={fan.cpuTemp} color="orange" /><StudioRing label="dGPU" value={null} temperature={fan.gpuTemp} /></div><div className="nss-performance-fans"><FanReadout label="左风扇" rpm={fan.cpuFanRpm} /><FanReadout label="右风扇" rpm={fan.gpuFanRpm} /></div></div>
      </section>
    </div>

    <div className="nss-home-bottom">
      <section className="nss-home-card nss-display-card"><div className="nss-card-title"><StudioIcon name="display" /><h2>显示设置</h2><button type="button" className="nss-card-arrow" onClick={() => navigate('display')} aria-label="打开显示设置">➜</button></div><div className="nss-display-overview"><div className="nss-display-choice-list">{visualChoices.map((choice) => <button key={choice.value} type="button" className={displayPreview === choice.value ? 'is-active' : ''} disabled={choice.value !== 'custom' && (!vendor.displayBridgeAvailable || vendor.busy)} onClick={() => choice.value === 'custom' ? navigate('display') : void vendor.applyDisplayMode(choice.value)}><i />{choice.label}</button>)}</div><div className="nss-display-summary"><strong>画质模式</strong><p>标准、游戏、视频、阅读由 NUCtool.dll 请求切换。</p><small>自定义亮度、色温与颜色可在详情页通过官方服务编辑。</small></div></div></section>

      <section className="nss-home-card nss-keyboard-card"><div className="nss-card-title"><StudioIcon name="keyboard" /><h2>键盘</h2><button type="button" className="nss-card-arrow" onClick={() => navigate('keyboard')} aria-label="打开键盘设置">➜</button></div><StudioKeyboardArt compact /><div className="nss-keyboard-home-bottom"><span>颜色：{vendor.serviceData?.lighting?.keyboard?.effect || '未读到'}</span><label>背光：<StudioSwitch label="键盘背光" checked={vendor.authorReadback?.keyboard_enabled ?? null} disabled={!vendor.displayBridgeAvailable || vendor.busy} onChange={(enabled) => void vendor.applyKeyboardBasic(enabled, vendor.keyboardBrightness)} /></label></div></section>

      <section className="nss-home-card nss-lightbar-card"><div className="nss-card-title"><StudioIcon name="lightbar" /><h2>光条</h2><button type="button" className="nss-card-arrow" onClick={() => navigate('lightbar')} aria-label="打开光条设置">➜</button></div><div className="nss-lightbar-overview"><div><span>使用外接电源：</span><i style={{ backgroundColor: lightbarCss(lightbarAc) }} /></div><div><span>使用电池：</span><i style={{ backgroundColor: lightbarCss(lightbarDc) }} /></div></div><div className="nss-lightbar-home-bottom">呼吸效果： <StudioSwitch checked={lightbar ? !!lightbar.breathing : null} label="光条呼吸效果" disabled={!lightbarSupported || vendor.busy} onChange={(enabled) => void vendor.applyLightbar('ac', { r: lightbarAc?.r ?? 0, g: lightbarAc?.g ?? 0, b: lightbarAc?.b ?? 0 }, enabled)} /></div></section>
    </div>

    <div className="nss-home-launchers">
      <button type="button" className="nss-module-entry" onClick={() => navigate('ec')}><StudioIcon name="fan" size={27} /><span><strong>EC 风扇控制</strong><small>{fan.running ? `EC 接管中 · ${fan.actorStateText}` : '查看传感器与散热策略'}</small></span><b>›</b></button>
      <button type="button" className="nss-module-entry" onClick={() => navigate('monitor')}><StudioIcon name="monitor" size={26} /><span><strong>系统监视器</strong><small>设备状态与硬件读数</small></span><b>›</b></button>
    </div>
  </div>;
}
