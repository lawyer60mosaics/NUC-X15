import React from 'react';
import { SystemPowerParameters } from '../hooks/usePower';
import { scenarioLabel } from '../i18n';
import OperationStatus, { OperationState } from './OperationStatus';
import { PerformanceSectionProps } from './powerTypes';

const ModeIcon = ({ index }: { index: number }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={index === 0 ? 'M18 15.5A7 7 0 0 1 8.5 6 7.5 7.5 0 1 0 18 15.5Z' : index === 1 ? 'M4 5h16v12H4zM8 21h8' : 'M13 2 4 14h7l-1 8 9-12h-7l1-8Z'} />
  </svg>
);

const PowerDomain = ({ name, scope, sustained, boost, isZh }: {
  name: string;
  scope: string;
  sustained: number;
  boost: number;
  isZh: boolean;
}) => {
  const ceiling = Math.max(1, sustained, boost);
  const rows = [
    { label: isZh ? '持续功率上限' : 'SUSTAINED LIMIT', hint: 'PL1', value: sustained },
    { label: isZh ? '短时功率上限' : 'SHORT-TERM LIMIT', hint: 'PL2', value: boost },
  ];
  return (
    <article className="power-domain-card">
      <div className="power-domain-heading">
        <div><span>{name}</span><small>{scope}</small></div>
        <strong>{sustained}<small>W</small></strong>
      </div>
      <div className="power-domain-rows">
        {rows.map((row) => (
          <div className="power-domain-row" key={row.hint}>
            <div><span>{row.label}</span><small>{row.hint}</small></div>
            <progress max={ceiling} value={row.value} aria-label={`${name} ${row.label} ${row.value}W`} />
            <strong>{row.value}<small>W</small></strong>
          </div>
        ))}
      </div>
    </article>
  );
};

function boostModeLabel(value: number, isZh: boolean) {
  const labels: Record<number, [string, string]> = {
    0: ['Disabled', '已禁用'], 1: ['Enabled', '已启用'], 2: ['High performance', '高性能'],
    3: ['Efficient', '高效率'], 4: ['High performance + efficient', '高性能高效率'],
    5: ['Aggressive', '积极且有保障'], 6: ['Efficient aggressive', '高效积极且有保障'],
  };
  const label = labels[value];
  return `${label ? label[isZh ? 1 : 0] : 'Unknown'} (${value})`;
}

function schemeName(parameters: SystemPowerParameters | null, isZh: boolean) {
  const names: Record<string, [string, string]> = {
    SCHEME_BALANCED: ['Balanced', '平衡'], SCHEME_MIN: ['Power saver', '节能'],
    SCHEME_MAX: ['High performance', '高性能'], CUSTOM_SCHEME: ['Custom', '自定义'],
  };
  const alias = parameters?.scheme_alias || '';
  return names[alias]?.[isZh ? 1 : 0] || alias || '--';
}

export const PerformanceSection: React.FC<PerformanceSectionProps> = ({
  selectedScenario,
  cpuPowerSustainedW,
  cpuPowerBoostW,
  gpuPowerSustainedW,
  gpuPowerBoostW,
  systemPowerParameters,
  authorBridgeAvailable,
  authorBridgeDetail,
  vendorServiceConnected,
  authorPowerPreset,
  authorReadback,
  authorPowerPlan,
  authorBenchmarkEnabled,
  authorBridgeBusy,
  applyAuthorPowerProfile,
  applyAuthorBenchmarkMode,
  applyAuthorPowerPlan,
  language = 'en',
}) => {
  const isZh = language === 'zh';
  const profileLabels: Record<number, string> = {
    1: isZh ? '性能（1）' : 'Performance (1)',
    2: isZh ? '平衡（2）' : 'Balanced (2)',
    3: isZh ? '省电（3）' : 'Power save (3)',
  };
  const currentProfile = authorReadback?.current_profile_index ?? null;
  const profileReadbackUnrecognized = currentProfile !== null && ![1, 2, 3].includes(currentProfile);
  const profileName = currentProfile === null
    ? (isZh ? '未读取' : 'Not read')
    : profileLabels[currentProfile] || `${isZh ? '无法识别的回读值' : 'Unrecognized readback'} (${currentProfile})`;
  const activePreset = currentProfile === 1 ? 'performance' : currentProfile === 2 ? 'balanced' : currentProfile === 3 ? 'powersave' : null;
  const profileState: OperationState = !authorBridgeAvailable
    ? 'unavailable'
    : activePreset !== null ? 'readback' : authorPowerPreset ? 'requested' : 'unavailable';
  const benchmarkState: OperationState = !authorBridgeAvailable
    ? 'unavailable'
    : authorBenchmarkEnabled === null ? 'unavailable' : 'requested';
  const planState: OperationState = !authorBridgeAvailable
    ? 'unavailable'
    : authorPowerPlan ? 'requested' : 'unavailable';
  const parameters = systemPowerParameters;
  const advancedValues = parameters ? [
    { label: isZh ? 'CPU 最大状态' : 'CPU MAX STATE', value: `${parameters.ac_processor_max}% / ${parameters.dc_processor_max}%`, detail: isZh ? '插电 / 电池' : 'AC / Battery' },
    { label: isZh ? 'Boost 模式' : 'BOOST MODE', value: `${boostModeLabel(parameters.ac_boost_mode, isZh)} / ${boostModeLabel(parameters.dc_boost_mode, isZh)}`, detail: isZh ? '插电 / 电池' : 'AC / Battery' },
    { label: isZh ? '能效偏好（EPP）' : 'ENERGY PREFERENCE (EPP)', value: `${parameters.ac_energy_preference} / ${parameters.dc_energy_preference}`, detail: isZh ? '插电 / 电池' : 'AC / Battery' },
  ] : [];

  return (
    <div className="dashboard-section power-dashboard performance-dashboard">
      <div className="section-intro">
        <span className="section-kicker">03 / {isZh ? '性能 · NUCtool.dll 控制' : 'PERFORMANCE · NUCTOOL.DLL'}</span>
        <h2>{isZh ? '性能模式' : 'PERFORMANCE MODE'}</h2>
        <p>{isZh ? '省电 3、平衡 2、性能 1；风扇由 EC 独立管理。' : 'Power save 3, balanced 2, performance 1; fans remain under EC control.'}</p>
      </div>

      <section className="panel performance-switch-panel author-hardware-panel">
        <div className="panel-header compact">
          <div>
            <span className="panel-kicker">NUCTOOL.DLL / {isZh ? '设备性能' : 'DEVICE PERFORMANCE'}</span>
            <h3>{isZh ? '性能预设' : 'PERFORMANCE PRESETS'}</h3>
            <p>{isZh ? '切换档位会请求关闭基准标记；NUCtool 厂商计划保持不变。' : 'Switching profiles requests benchmark-off; the NUCtool vendor plan stays unchanged.'}</p>
          </div>
          <span className={`system-parameters-badge ${authorBridgeAvailable ? 'is-live' : ''}`}>
            {authorBridgeAvailable ? (isZh ? 'DLL 文件已校验' : 'DLL FILE VERIFIED') : (isZh ? 'DLL 文件未通过校验' : 'DLL FILE UNVERIFIED')}
          </span>
        </div>
        <p className="system-parameters-note">
          {isZh ? '原厂服务：' : 'Vendor service: '}
          {vendorServiceConnected ? (isZh ? '接口可读' : 'API reachable') : (isZh ? '接口读回暂不可用' : 'API readback unavailable')}
          {' · '}{authorBridgeDetail}
        </p>

        <div className="mode-grid author-power-grid">
          {[
            { id: 'powersave', icon: 0, zh: '省电', en: 'POWER SAVE', index: 3 },
            { id: 'balanced', icon: 1, zh: '平衡', en: 'BALANCED', index: 2 },
            { id: 'performance', icon: 2, zh: '性能', en: 'PERFORMANCE', index: 1 },
          ].map((preset) => (
            <button key={preset.id} type="button" className={`mode-button ${activePreset === preset.id ? 'is-active' : ''}`} aria-pressed={activePreset === preset.id} disabled={!authorBridgeAvailable || authorBridgeBusy} onClick={() => { void applyAuthorPowerProfile(preset.id); }}>
              <span className="mode-icon"><ModeIcon index={preset.icon} /></span>
              <span><strong>{isZh ? preset.zh : preset.en}</strong><small>{isZh ? `NUCtool.dll 档位 ${preset.index}` : `NUCtool.dll PROFILE ${preset.index}`}</small></span>
              <i aria-hidden="true" />
            </button>
          ))}
        </div>
        <OperationStatus owner="NUCtool.dll" state={profileState} language={language} detail={isZh
          ? `当前档位：${profileName}${profileReadbackUnrecognized ? '（未确认有效档位）' : ''}${authorPowerPreset ? ` · 最近请求：${authorPowerPreset}` : ''}`
          : `Current profile: ${profileName}${profileReadbackUnrecognized ? ' (not a confirmed profile)' : ''}${authorPowerPreset ? ` · Last requested: ${authorPowerPreset}` : ''}`} />

        <div className="performance-subsection">
          <div className="performance-subsection-copy">
            <span className="panel-kicker">NUCTOOL.DLL / {isZh ? '独立开关' : 'STANDALONE SWITCH'}</span>
            <h3>{isZh ? '基准模式' : 'BENCHMARK MODE'}</h3>
            <p>{isZh ? '开启会请求 DLL 基准标记和厂商计划 4；关闭只清除基准标记，计划 4 保留。不会修改 EC 风扇。' : 'Enabling requests the DLL benchmark flag and vendor plan 4. Disabling clears the flag only; plan 4 stays. EC fans are untouched.'}</p>
            <OperationStatus owner="NUCtool.dll" state={benchmarkState} language={language} detail={authorBenchmarkEnabled === null ? (isZh ? 'DLL 不提供基准状态回读；此处仅显示最近请求，无法确认设备是否接受或生效。' : 'The DLL has no benchmark-state readback; this shows only the last request, not whether the device accepted or applied it.') : (isZh ? `最近请求：${authorBenchmarkEnabled ? '开启' : '关闭'} · 无状态回读，是否接受/生效未知` : `Last request: ${authorBenchmarkEnabled ? 'On' : 'Off'} · no readback; acceptance/effect unknown`)} />
          </div>
          <div className="benchmark-actions" role="group" aria-label={isZh ? '基准模式请求' : 'Benchmark mode requests'}>
            <button type="button" className="button button-primary" disabled={!authorBridgeAvailable || authorBridgeBusy} onClick={() => { void applyAuthorBenchmarkMode(true); }}>
              {isZh ? '请求开启' : 'REQUEST ON'}
            </button>
            <button type="button" className="button button-secondary" disabled={!authorBridgeAvailable || authorBridgeBusy} onClick={() => { void applyAuthorBenchmarkMode(false); }}>
              {isZh ? '请求关闭' : 'REQUEST OFF'}
            </button>
          </div>
        </div>

        <details className="advanced-power-details vendor-plan-details">
          <summary>{isZh ? '高级：NUCtool 厂商电源计划' : 'ADVANCED: NUCTOOL VENDOR POWER PLAN'}</summary>
          <p>{isZh ? '这是 DLL 内部计划，不是 Windows 电源计划；没有硬件回读。基准关闭后，计划 4 会保留。' : 'This is an internal DLL plan, not the Windows power plan. It has no hardware readback; plan 4 remains after benchmark is disabled.'}</p>
          <OperationStatus owner="NUCtool.dll" state={planState} language={language} detail={authorPowerPlan ? (isZh ? `最近请求：${authorPowerPlan} · DLL 不提供状态回读` : `Last request: ${authorPowerPlan} · DLL has no state readback`) : (isZh ? 'DLL 不提供当前计划回读，当前计划未知。' : 'The DLL does not expose the current plan; its state is unknown.')} />
          <div className="mode-grid author-plan-grid">
            {[
              { id: 'off', zh: '关闭', en: 'OFF' }, { id: 'performance', zh: '性能', en: 'PERFORMANCE' },
              { id: 'balanced', zh: '平衡', en: 'BALANCED' }, { id: 'powersave', zh: '省电', en: 'POWER SAVE' },
              { id: 'benchmark', zh: '基准', en: 'BENCHMARK' },
            ].map((plan, index) => (
              <button key={plan.id} type="button" className="mode-button" disabled={!authorBridgeAvailable || authorBridgeBusy} onClick={() => { void applyAuthorPowerPlan(plan.id); }}>
                <span><strong>{isZh ? plan.zh : plan.en}</strong><small>{isZh ? `计划 ${index}` : `PLAN ${index}`}</small></span><i aria-hidden="true" />
              </button>
            ))}
          </div>
        </details>
      </section>

      <section className="panel power-domains-panel">
        <div className="panel-header compact">
          <div><span className="panel-kicker">{isZh ? '配置参考' : 'CONFIGURATION REFERENCE'}</span><h3>{isZh ? 'CPU / GPU 功率上限' : 'CPU / GPU POWER LIMITS'}</h3><p>{isZh ? '显示当前配置的安全上限，不是实时功耗，也不在这里修改。' : 'Configured limits, not live power draw; this section is read-only.'}</p></div>
          <span className="power-source-badge">{isZh ? '只读' : 'READ ONLY'}</span>
        </div>
        <div className="power-domain-grid">
          <PowerDomain name="CPU" scope={isZh ? '封装 / 全核心' : 'PACKAGE / ALL CORES'} sustained={cpuPowerSustainedW} boost={cpuPowerBoostW} isZh={isZh} />
          <PowerDomain name="GPU" scope={isZh ? '核心 / 板级' : 'CORE / BOARD'} sustained={gpuPowerSustainedW} boost={gpuPowerBoostW} isZh={isZh} />
        </div>
      </section>

      <section className="panel system-parameters-panel performance-parameters-panel">
        <div className="panel-header compact">
          <div><span className="panel-kicker">WINDOWS / {isZh ? '只读状态' : 'READ ONLY'}</span><h3>{isZh ? '当前 Windows 参数' : 'CURRENT WINDOWS PARAMETERS'}</h3><p>{isZh ? '只观察 Windows 当前电源方案，与 DLL 厂商计划分开。' : 'Windows state only, separate from the DLL vendor plan.'}</p></div>
          <span className={`system-parameters-badge ${parameters ? 'is-live' : ''}`}>{parameters ? (isZh ? '参数已读取' : 'READ BACK') : (isZh ? '暂不可用' : 'UNAVAILABLE')}</span>
        </div>
        {parameters ? <>
          <div className="system-parameters-grid performance-summary-grid">
            <article className="system-parameter-card scheme-card"><span>EC / {isZh ? '风扇曲线' : 'FAN CURVE'}</span><strong>{scenarioLabel(language, selectedScenario)}</strong><small>{isZh ? '与 DLL 性能档独立' : 'Independent from DLL profile'}</small></article>
            <article className="system-parameter-card scheme-card"><span>WINDOWS / {isZh ? '电源方案' : 'POWER PLAN'}</span><strong>{schemeName(parameters, isZh)}</strong><small>{parameters.scheme_guid}</small></article>
            <article className="system-parameter-card"><span>CPU TDP</span><strong>{cpuPowerSustainedW}W / {cpuPowerBoostW}W</strong><small>PL1 / PL2</small></article>
            <article className="system-parameter-card"><span>GPU TDP</span><strong>{gpuPowerSustainedW}W / {gpuPowerBoostW}W</strong><small>PL1 / PL2</small></article>
          </div>
          <details className="advanced-power-details">
            <summary>{isZh ? '查看高级 Windows 参数' : 'VIEW ADVANCED WINDOWS PARAMETERS'}</summary>
            <div className="system-parameters-grid">{advancedValues.map((value) => <article className="system-parameter-card" key={value.label}><span>{value.label}</span><strong>{value.value}</strong><small>{value.detail}</small></article>)}</div>
            <p className="system-parameters-note">{isZh ? 'AC 为接通电源，DC 为电池供电。数值来自 Windows 当前电源配置。' : 'AC is plugged-in power and DC is battery power. Values come from the active Windows power configuration.'}</p>
          </details>
        </> : <div className="system-parameters-empty">{isZh ? 'Windows 参数暂不可用' : 'WINDOWS PARAMETERS UNAVAILABLE'}</div>}
      </section>
    </div>
  );
};

export default PerformanceSection;
