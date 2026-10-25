import React from 'react';
import { scenarioLabel, tr } from '../i18n';
import FanControlSection from './FanControlSection';
import PerformanceSection from './PerformanceSection';
import { PowerSectionProps, SensorValue } from './powerTypes';

const NavFanIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="2.2" />
    <path d="M12 9.8c-1.2-3.4.1-6 2.2-6.4 2-.3 3.2 1.5 2.2 3.4C15.6 8.3 13.9 9.3 12 9.8ZM14 13c3.5-.7 5.8.9 5.8 3 0 2-2 2.9-3.7 1.6-1.4-1-2-2.9-2.1-4.6ZM10.2 13.1c-2.3 2.8-5.2 3.1-6.4 1.4-1.1-1.7.1-3.4 2.3-3.2 1.8.1 3.2.8 4.1 1.8Z" />
  </svg>
);

const ModeIcon = ({ index }: { index: number }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={index === 0 ? 'M18 15.5A7 7 0 0 1 8.5 6 7.5 7.5 0 1 0 18 15.5Z' : index === 1 ? 'M4 5h16v12H4zM8 21h8' : 'M13 2 4 14h7l-1 8 9-12h-7l1-8Z'} />
  </svg>
);

function temperatureStatus(value: SensorValue, language: 'en' | 'zh') {
  if (typeof value !== 'number') return tr(language, 'Waiting', '等待数据');
  if (value >= 85) return tr(language, 'Hot', '高温');
  if (value >= 70) return tr(language, 'Warm', '偏热');
  return tr(language, 'Normal', '正常');
}

export const PowerSection: React.FC<PowerSectionProps> = (props) => {
  const { view, onNavigate, language = 'en' } = props;
  const isZh = language === 'zh';
  if (view === 'fan') return <FanControlSection {...props} />;
  if (view === 'performance') return <PerformanceSection {...props} />;

  const actualProfile = props.authorReadback?.current_profile_index;
  const profileText = actualProfile === 1
    ? tr(language, 'Performance profile', '性能档')
    : actualProfile === 2
      ? tr(language, 'Balanced profile', '平衡档')
      : actualProfile === 3
        ? tr(language, 'Power-save profile', '省电档')
        : tr(language, 'Profile unavailable', '性能档暂不可用');
  const statusSensors = [
    { label: 'CPU', value: props.cpuTemp },
    { label: 'GPU', value: props.gpuTemp },
  ];

  return (
    <div className="dashboard-section power-dashboard overview-dashboard">
      <div className="section-intro">
        <span className="section-kicker">{isZh ? '设备状态 / SYSTEM STATUS' : 'DEVICE STATUS / SYSTEM STATUS'}</span>
        <h2>{isZh ? '设备控制台' : 'DEVICE CONTROL CENTER'}</h2>
        <p>{isZh ? '先看温度与运行状态，再进入风扇或性能控制。每项设置只交给对应的控制通道。' : 'Review temperatures and operating state, then open fan or performance controls. Each setting has one owner.'}</p>
      </div>

      <section className="status-grid" aria-label={tr(language, 'Current device status', '当前设备状态')}>
        {statusSensors.map((sensor) => (
          <article className="status-card" key={sensor.label}>
            <div className="status-card-heading"><span>{sensor.label}</span><span className="status-badge is-idle">{temperatureStatus(sensor.value, language)}</span></div>
            <strong>{sensor.value === '--' ? '--' : `${sensor.value}°C`}</strong>
            <small>{isZh ? '当前温度' : 'CURRENT TEMPERATURE'}</small>
          </article>
        ))}
        <article className="status-card">
          <div className="status-card-heading"><span>EC / {isZh ? '风扇' : 'FANS'}</span><span className={`status-badge ${props.running ? 'is-normal' : 'is-idle'}`}>{props.running ? (isZh ? '接管中' : 'ACTIVE') : (isZh ? '系统托管' : 'SYSTEM MANAGED')}</span></div>
          <strong>{props.cpuFanRpm === '--' ? '--' : props.cpuFanRpm.toLocaleString()}<span className="status-unit"> RPM</span></strong>
          <small>{isZh ? 'CPU 风扇 · ' : 'CPU FAN · '}{props.constantSpeedEnabled ? `${props.constantSpeed}%` : (isZh ? '自动曲线' : 'AUTO CURVE')}</small>
        </article>
        <article className="status-card">
          <div className="status-card-heading"><span>NUCtool.dll / {isZh ? '性能' : 'PROFILE'}</span><span className={`status-badge ${actualProfile === 1 || actualProfile === 2 || actualProfile === 3 ? 'is-normal' : 'is-idle'}`}>{actualProfile === 1 || actualProfile === 2 || actualProfile === 3 ? (isZh ? '已读回' : 'READ BACK') : (isZh ? '未知' : 'UNKNOWN')}</span></div>
          <strong className="status-profile-value">{profileText}</strong>
          <small>{isZh ? '厂商性能预设' : 'VENDOR PERFORMANCE PROFILE'}</small>
        </article>
      </section>

      <div className="overview-section-heading">
        <div><span>{isZh ? '控制模块' : 'CONTROL MODULES'}</span><h3>{isZh ? '选择要调整的设备部分' : 'CHOOSE WHAT TO ADJUST'}</h3></div>
        <p>{isZh ? '风扇与设备性能互不联动' : 'Fan control and device performance remain independent'}</p>
      </div>
      <div className="overview-route-grid">
        <button className="overview-route-card" type="button" onClick={() => onNavigate('fan')}>
          <span className="overview-route-icon"><NavFanIcon /></span>
          <span className="overview-route-copy">
            <small>EC / {isZh ? '风扇控制' : 'FAN CONTROL'}</small>
            <strong>{scenarioLabel(language, props.selectedScenario)}</strong>
            <span>{props.constantSpeedEnabled ? (isZh ? `固定输出 ${props.constantSpeed}%` : `Fixed output ${props.constantSpeed}%`) : (isZh ? '按温度曲线自动调速' : 'Automatic temperature curve')}</span>
          </span>
          <span className="overview-route-metrics"><b>{props.cpuFanRpm === '--' ? '--' : props.cpuFanRpm.toLocaleString()}</b> CPU RPM<br /><b>{props.gpuFanRpm === '--' ? '--' : props.gpuFanRpm.toLocaleString()}</b> GPU RPM</span>
          <i aria-hidden="true">→</i>
        </button>
        <button className="overview-route-card" type="button" onClick={() => onNavigate('performance')}>
          <span className="overview-route-icon"><ModeIcon index={actualProfile === 3 ? 0 : actualProfile === 2 ? 1 : 2} /></span>
          <span className="overview-route-copy">
            <small>NUCTOOL.DLL / {isZh ? '性能控制' : 'PERFORMANCE CONTROL'}</small>
            <strong>{profileText}</strong>
            <span>{isZh ? '省电 · 平衡 · 性能；基准模式独立开关' : 'Power save · balanced · performance; benchmark is separate'}</span>
          </span>
          <span className="overview-route-metrics"><b>{actualProfile ?? '--'}</b><br />PROFILE</span>
          <i aria-hidden="true">→</i>
        </button>
      </div>

      <section className="overview-system-panel" aria-label={isZh ? '控制通道状态' : 'Control channel status'}>
        <div><span>EC / {isZh ? '风扇通道' : 'FAN CHANNEL'}</span><strong>{props.running ? (isZh ? '由 NUCtool 接管' : 'NUCtool active') : (isZh ? '系统托管' : 'System managed')}</strong></div>
        <div><span>NUCtool.dll / {isZh ? '设备性能' : 'DEVICE PERFORMANCE'}</span><strong>{props.authorBridgeAvailable ? (isZh ? 'DLL 文件已校验' : 'DLL file verified') : (isZh ? 'DLL 文件不可用' : 'DLL file unavailable')}</strong></div>
        <div><span>WINDOWS / {isZh ? '电源方案' : 'POWER SCHEME'}</span><strong>{props.systemPowerParameters?.scheme_alias || (isZh ? '尚未读回' : 'Not read back')}</strong></div>
      </section>
    </div>
  );
};

export default PowerSection;
