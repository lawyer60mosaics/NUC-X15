import React, { useState } from 'react';
import SurfaceCard from './SurfaceCard';
import OperationStatus, { OperationState } from './OperationStatus';
import { AppSettings, HiddenModuleId, UiFontSize } from '../types/appSettings';
import { SCENARIOS, TimeThemeMode } from '../hooks/useFanControl';
import { scenarioLabel, tr, UiLanguage } from '../i18n';
import type { AuthorHardwareReadback } from '../hooks/useVendorService';

interface SettingsSectionProps {
  settings: AppSettings;
  autostartEnabled: boolean;
  autostartBusy: boolean;
  setAutostartEnabled: (enabled: boolean) => void;
  startupTakeoverEnabled: boolean;
  setStartupTakeoverEnabled: (enabled: boolean) => void;
  timeThemeMode: TimeThemeMode;
  setTimeThemeMode: (mode: TimeThemeMode) => void;
  currentKeyboardBrightness: number;
  setKeyboardBrightness: (value: number) => void;
  currentBatteryLevel: number;
  setBatteryLevel: (value: number) => void;
  applyBattery: (level: number) => Promise<boolean>;
  keyboardEnabled: boolean;
  applyKeyboardBasic: (enabled: boolean, brightness: number) => Promise<boolean>;
  authorBridgeAvailable: boolean;
  authorReadback: AuthorHardwareReadback | null;
  busy: boolean;
  onChange: (patch: Partial<AppSettings>) => void;
  onReset: () => void;
  language?: 'en' | 'zh';
  setLanguage: (language: UiLanguage) => void;
}

const getModuleOptions = (language: UiLanguage): Array<{ id: HiddenModuleId; label: string; detail: string }> => [
  { id: 'monitor', label: tr(language, 'SYSTEM MONITOR', '系统监控'), detail: tr(language, 'Thermal health and recovery diagnostics', '温度状态与恢复诊断') },
];

const getFontSizeOptions = (language: UiLanguage): Array<{ id: Exclude<UiFontSize, 'custom'>; label: string; detail: string }> => [
  { id: 'compact', label: tr(language, 'COMPACT', '紧凑'), detail: tr(language, 'Higher density for large displays.', '适合大尺寸屏幕的高密度布局。') },
  { id: 'standard', label: tr(language, 'STANDARD', '标准'), detail: tr(language, 'Default size with balanced density.', '兼顾字号与信息密度的默认尺寸。') },
  { id: 'comfortable', label: tr(language, 'COMFORTABLE', '舒适'), detail: tr(language, 'Larger text for bright rooms or distance.', '适合明亮环境或远距离观看的大字号。') },
];

const FONT_SIZE_PRESETS: Record<'compact' | 'standard' | 'comfortable', number> = {
  compact: 14,
  standard: 15,
  comfortable: 16,
};

const ToggleRow: React.FC<{
  title: string;
  detail: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}> = ({ title, detail, checked, onChange, disabled = false }) => (
  <button className="settings-toggle-row" type="button" onClick={() => onChange(!checked)} disabled={disabled} aria-pressed={checked}>
    <span>
      <strong>{title}</strong>
      <small>{detail}</small>
    </span>
    <span className={`settings-switch ${checked ? 'is-on' : ''}`} aria-hidden="true">
      <span />
    </span>
  </button>
);

export const SettingsSection: React.FC<SettingsSectionProps> = ({
  settings,
  autostartEnabled,
  autostartBusy,
  setAutostartEnabled,
  startupTakeoverEnabled,
  setStartupTakeoverEnabled,
  timeThemeMode,
  setTimeThemeMode,
  currentKeyboardBrightness,
  setKeyboardBrightness,
  currentBatteryLevel,
  setBatteryLevel,
  applyBattery,
  keyboardEnabled,
  applyKeyboardBasic,
  authorBridgeAvailable,
  authorReadback,
  busy,
  onChange,
  onReset,
  language = 'en',
  setLanguage,
}) => {
  const isZh = language === 'zh';
  const [lastBatteryRequest, setLastBatteryRequest] = useState<number | null>(null);
  const [lastKeyboardRequest, setLastKeyboardRequest] = useState<{ enabled: boolean; brightness: number } | null>(null);
  const moduleOptions = getModuleOptions(language);
  const fontSizeOptions = getFontSizeOptions(language);
  const batteryReadback = authorReadback?.battery_charging_level ?? null;
  const batteryStatus: OperationState = !authorBridgeAvailable
    ? 'unavailable'
    : batteryReadback !== null && (lastBatteryRequest === null || batteryReadback === lastBatteryRequest)
      ? 'readback'
      : lastBatteryRequest !== null ? 'requested' : 'unavailable';
  const keyboardReadback = authorReadback?.keyboard_enabled ?? null;
  const keyboardStatus: OperationState = !authorBridgeAvailable
    ? 'unavailable'
    : keyboardReadback !== null && (lastKeyboardRequest === null || keyboardReadback === lastKeyboardRequest.enabled)
      ? 'readback'
      : lastKeyboardRequest !== null ? 'requested' : 'unavailable';
  const brightnessStatus: OperationState = !authorBridgeAvailable
    ? 'unavailable'
    : lastKeyboardRequest ? 'requested' : 'unavailable';
  const submitBattery = async () => {
    const requested = currentBatteryLevel;
    if (await applyBattery(requested)) setLastBatteryRequest(requested);
  };
  const submitKeyboard = async (enabled: boolean, brightness: number) => {
    if (await applyKeyboardBasic(enabled, brightness)) setLastKeyboardRequest({ enabled, brightness });
  };
  const toggleModule = (id: HiddenModuleId, visible: boolean) => {
    const nextHidden = visible
      ? settings.hidden_modules.filter((item) => item !== id)
      : Array.from(new Set([...settings.hidden_modules, id]));
    onChange({ hidden_modules: nextHidden });
  };

  return (
    <div className="dashboard-section settings-section">
      <div className="section-intro">
        <span className="section-kicker">{isZh ? '03 / 工作台配置' : '03 / WORKSPACE CONFIG'}</span>
        <h2>{isZh ? '工作台设置' : 'WORKSPACE SETTINGS'}</h2>
        <p>{isZh ? '控制默认入口、模块显示和长期运行偏好。' : 'Control default entry points, module visibility, and long-running preferences.'}</p>
      </div>
      <SurfaceCard className="module-card settings-card settings-interface-card">
        <div className="settings-card-header">
          <div>
            <h3 className="card-title">{isZh ? '界面' : 'INTERFACE'}</h3>
            <p className="card-subtitle">{isZh ? '保留常用入口并隐藏不需要的模块。' : 'Keep common entry points and hide unused modules.'}</p>
          </div>
        </div>

        <div className="settings-grid">
          <label>
            <span className="form-label">{isZh ? '界面语言' : 'INTERFACE LANGUAGE'}</span>
            <select className="form-select" value={language} onChange={(event) => setLanguage(event.target.value as UiLanguage)}>
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </label>
          <label>
            <span className="form-label">{isZh ? '默认打开页面' : 'DEFAULT LANDING PAGE'}</span>
            <select className="form-select" value={settings.default_tab} onChange={(event) => onChange({ default_tab: event.target.value as AppSettings['default_tab'] })}>
              <option value="power">{isZh ? '设备概览' : 'DEVICE OVERVIEW'}</option>
              <option value="fan">{isZh ? '风扇控制' : 'FAN CONTROL'}</option>
              <option value="performance">{isZh ? '性能模式' : 'PERFORMANCE'}</option>
              <option value="display">{isZh ? '画质场景' : 'DISPLAY SCENES'}</option>
              {!settings.hidden_modules.includes('monitor') && <option value="monitor">{isZh ? '系统监控' : 'SYSTEM MONITOR'}</option>}
              <option value="settings">{isZh ? '系统设置' : 'SYSTEM SETTINGS'}</option>
            </select>
          </label>
          <label>
            <span className="form-label">{isZh ? '昼夜主题' : 'DAY / NIGHT THEME'}</span>
            <select className="form-select" value={timeThemeMode} onChange={(event) => setTimeThemeMode(event.target.value as TimeThemeMode)}>
              <option value="auto">{isZh ? '自动' : 'AUTO'}</option>
              <option value="day">{isZh ? '日间' : 'DAY'}</option>
              <option value="night">{isZh ? '夜间' : 'NIGHT'}</option>
            </select>
          </label>
        </div>

        <div>
          <span className="form-label">{isZh ? '界面字号' : 'UI FONT SIZE'}</span>
          <div className="settings-choice-grid">
            {fontSizeOptions.map((option) => (
              <button
                key={option.id}
                className={`settings-choice ${settings.ui_font_size === option.id ? 'is-active' : ''}`}
                type="button"
                aria-pressed={settings.ui_font_size === option.id}
                onClick={() => onChange({
                  ui_font_size: option.id,
                  ui_font_size_px: FONT_SIZE_PRESETS[option.id],
                })}
              >
                <strong>{option.label}</strong>
                <small>{option.detail}</small>
              </button>
            ))}
          </div>
          <div className={`font-size-custom-control ${settings.ui_font_size === 'custom' ? 'is-active' : ''}`}>
            <div className="font-size-custom-header">
              <div>
                <strong>{isZh ? '自定义字号' : 'CUSTOM SIZE'}</strong>
                <small>{isZh ? '统一缩放界面中的文字层级。' : 'Scale every interface text level consistently.'}</small>
              </div>
              <label className="font-size-value">
                <input
                  type="number"
                  min={12}
                  max={20}
                  step={1}
                  value={settings.ui_font_size_px}
                  aria-label={isZh ? '自定义界面字号数值' : 'Custom interface font size value'}
                  onChange={(event) => {
                    if (event.target.value !== '') {
                      onChange({ ui_font_size: 'custom', ui_font_size_px: Number(event.target.value) });
                    }
                  }}
                />
                <span>px</span>
              </label>
            </div>
            <input
              id="custom-font-size"
              type="range"
              min={12}
              max={20}
              step={1}
              value={settings.ui_font_size_px}
              aria-label={isZh ? '自定义界面字号' : 'Custom interface font size'}
              aria-valuetext={`${settings.ui_font_size_px}px`}
              onChange={(event) => onChange({ ui_font_size: 'custom', ui_font_size_px: Number(event.target.value) })}
            />
            <div className="font-size-scale" aria-hidden="true"><span>12px</span><span>16px</span><span>20px</span></div>
          </div>
        </div>

        <ToggleRow
          title={isZh ? '紧凑模式' : 'COMPACT MODE'}
          detail={isZh ? '保持高密度管理布局，仅显示所选模块。' : 'Keep the management layout dense and show only selected modules.'}
          checked={settings.compact_mode}
          onChange={(checked) => onChange({ compact_mode: checked })}
        />

        <div className="settings-module-grid">
          {moduleOptions.map((module) => {
            const visible = !settings.hidden_modules.includes(module.id);
            return (
              <button
                key={module.id}
                className={`settings-module ${visible ? 'is-visible' : ''}`}
                type="button"
                aria-pressed={visible}
                onClick={() => toggleModule(module.id, !visible)}
              >
                <span>
                  <strong>{module.label}</strong>
                  <small>{module.detail}</small>
                </span>
                <em>{visible ? (isZh ? '显示' : 'VISIBLE') : (isZh ? '隐藏' : 'HIDDEN')}</em>
              </button>
            );
          })}
        </div>
      </SurfaceCard>

      <SurfaceCard className="module-card settings-card settings-startup-card">
        <div className="settings-card-header">
          <div>
            <h3 className="card-title">{isZh ? '启动与后台运行' : 'STARTUP & BACKGROUND'}</h3>
            <p className="card-subtitle">
              {isZh ? '设置登录后的启动方式，以及是否自动接管风扇控制。' : 'Choose how NUCtool starts after sign-in and whether it resumes fan control.'}
            </p>
          </div>
          <span className={`settings-status-chip ${autostartEnabled ? 'is-on' : ''}`}>
            {autostartEnabled ? (isZh ? '自启已开启' : 'AUTOSTART ON') : (isZh ? '自启已关闭' : 'AUTOSTART OFF')}
          </span>
        </div>

        <ToggleRow
          title={isZh ? '开机自动启动' : 'LAUNCH AT STARTUP'}
          detail={isZh ? '登录系统后自动启动 NUCtool。Windows 将使用最高权限计划任务。' : 'Start NUCtool after sign-in. Windows uses an elevated scheduled task.'}
          checked={autostartEnabled}
          onChange={setAutostartEnabled}
          disabled={busy || autostartBusy}
        />

        <div>
          <span className="form-label">{isZh ? '开机启动方式' : 'AUTOSTART MODE'}</span>
          <div className="settings-choice-grid settings-startup-modes">
            <button
              className={`settings-choice ${settings.startup_run_mode === 'silent' ? 'is-active' : ''}`}
              type="button"
              aria-pressed={settings.startup_run_mode === 'silent'}
              disabled={busy || autostartBusy}
              onClick={() => onChange({ startup_run_mode: 'silent' })}
            >
              <strong>{isZh ? '后台静默启动' : 'SILENT BACKGROUND'}</strong>
              <small>{isZh ? '不显示主窗口，保留托盘、监控和硬件控制。' : 'Keep tray, monitoring, and hardware control active without opening the window.'}</small>
            </button>
            <button
              className={`settings-choice ${settings.startup_run_mode === 'full' ? 'is-active' : ''}`}
              type="button"
              aria-pressed={settings.startup_run_mode === 'full'}
              disabled={busy || autostartBusy}
              onClick={() => onChange({ startup_run_mode: 'full' })}
            >
              <strong>{isZh ? '完整界面启动' : 'FULL INTERFACE'}</strong>
              <small>{isZh ? '登录后显示并聚焦主窗口，执行完整启动流程。' : 'Show and focus the main window after sign-in and run the full startup flow.'}</small>
            </button>
          </div>
          <p className="settings-startup-note">
            {isZh ? '启动方式将在下次登录时生效；手动打开程序始终显示完整界面。' : 'The mode takes effect at the next sign-in. Manual launches always open the full interface.'}
          </p>
        </div>

        <div>
          <span className="form-label">{isZh ? '风扇控制路径' : 'FAN CONTROL PATH'}</span>
          <div className="settings-choice-grid settings-startup-modes">
            <div className="settings-choice is-active" aria-label={isZh ? '风扇仅使用 EC 直接控制' : 'Fans use direct EC control only'}>
              <strong>{isZh ? 'EC 直接风扇控制' : 'DIRECT EC FAN CONTROL'}</strong>
              <small>{isZh ? '风扇曲线、固定转速和启动接管只写入 EC。厂商 DLL 不参与风扇控制。' : 'Fan curves, fixed speed, and startup takeover write to EC only. The vendor DLL never controls fans.'}</small>
            </div>
          </div>
          <p className="settings-startup-note">
            {isZh ? '旧版“NUC 工具栏配置”已自动迁移到 EC 风扇控制，避免两套风扇控制相互覆盖。' : 'The legacy NUC service fan option is migrated to EC control to prevent competing fan writers.'}
          </p>
        </div>

        <ToggleRow
          title={isZh ? '启动时接管风扇' : 'TAKE OVER FANS ON STARTUP'}
          detail={isZh ? '载入已保存策略，并在应用启动后恢复 EC 风扇控制。' : 'Load the saved policy and resume EC fan control when the app starts.'}
          checked={startupTakeoverEnabled}
          onChange={setStartupTakeoverEnabled}
          disabled={busy || autostartBusy}
        />
      </SurfaceCard>

      <SurfaceCard className="module-card settings-card settings-scene-card">
        <div className="settings-card-header">
          <div>
            <h3 className="card-title">{isZh ? '风扇曲线偏好' : 'FAN CURVE PREFERENCE'}</h3>
            <p className="card-subtitle">{isZh ? '设置启动时使用的 EC 风扇曲线；不影响设备性能模式。' : 'Choose the startup EC fan curve; device performance is unaffected.'}</p>
          </div>
        </div>
        <div className="settings-grid">
          <label>
            <span className="form-label">{isZh ? '默认风扇曲线' : 'DEFAULT FAN CURVE'}</span>
            <select className="form-select" value={settings.default_scenario} onChange={(event) => onChange({ default_scenario: event.target.value as AppSettings['default_scenario'] })}>
              {Object.keys(SCENARIOS).map((key) => (
                <option key={key} value={key}>{scenarioLabel(language, key)}</option>
              ))}
            </select>
          </label>
          <ToggleRow
            title={isZh ? '确认场景切换' : 'CONFIRM SCENE SWITCH'}
            detail={isZh ? '切换时只更改 EC 风扇曲线。' : 'Switching changes the EC fan curve only.'}
            checked={settings.confirm_scene_switch}
            onChange={(checked) => onChange({ confirm_scene_switch: checked })}
          />
        </div>

        <div className="settings-startup-note">
          {isZh ? '风扇曲线由 EC 独立控制。省电、平衡、性能和基准模式在“性能模式”中由 NUCtool.dll 单独控制。' : 'EC controls fan curves independently. Choose power-save, balanced, performance, and benchmark modes separately through NUCtool.dll on Performance.'}
        </div>

      </SurfaceCard>

      <SurfaceCard className="module-card settings-card settings-lighting-card">
        <div className="settings-card-header">
          <div>
            <h3 className="card-title">NUCTOOL.DLL / {isZh ? '厂商硬件控制' : 'VENDOR HARDWARE CONTROL'}</h3>
            <p className="card-subtitle">{isZh ? '电池、键盘背光和其他非风扇控制统一通过 NUCtool.dll；风扇始终由 EC 直接管理。' : 'Battery, keyboard backlight, and other non-fan controls use NUCtool.dll; fans always stay under direct EC control.'}</p>
          </div>
          <span className={`settings-status-chip ${authorBridgeAvailable ? 'is-on' : ''}`}>
            {authorBridgeAvailable ? (isZh ? 'DLL 文件已校验' : 'DLL FILE VERIFIED') : (isZh ? 'DLL 文件未通过校验' : 'DLL FILE UNVERIFIED')}
          </span>
        </div>
        <div className="settings-lighting-controls">
          <label>
            <span className="form-label">{isZh ? '目标充电上限' : 'TARGET CHARGE LIMIT'} · {currentBatteryLevel}%</span>
            <input
              type="range"
              min={50}
              max={100}
              step={1}
              value={currentBatteryLevel}
              onChange={(event) => setBatteryLevel(Number(event.target.value))}
              disabled={busy || !authorBridgeAvailable}
            />
          </label>
          <div className="settings-lighting-actions">
            <button
              className="settings-action primary"
              type="button"
              disabled={busy || !authorBridgeAvailable}
              onClick={() => { void submitBattery(); }}
            >
              {isZh ? '应用上限' : 'APPLY LIMIT'}
            </button>
          </div>
          <OperationStatus
            owner="NUCtool.dll"
            state={batteryStatus}
            language={language}
            detail={batteryReadback !== null
              ? (isZh ? `目标 ${currentBatteryLevel}% · 硬件当前上限 ${batteryReadback}%${lastBatteryRequest !== null && batteryReadback !== lastBatteryRequest ? ` · 请求值 ${lastBatteryRequest}% 尚未确认` : ''}` : `Target ${currentBatteryLevel}% · current hardware limit ${batteryReadback}%${lastBatteryRequest !== null && batteryReadback !== lastBatteryRequest ? ` · request ${lastBatteryRequest}% is unverified` : ''}`)
              : (isZh ? '无法读取设备当前的充电上限。' : 'The device charge limit could not be read.')}
          />
        </div>
        <div className="settings-lighting-controls">
          <ToggleRow
            title={isZh ? '键盘背光开关' : 'KEYBOARD BACKLIGHT'}
            detail={isZh ? `${keyboardReadback == null ? '开关状态未读取' : keyboardReadback ? '设备当前已开启' : '设备当前已关闭'}；亮度不支持回读` : `${keyboardReadback == null ? 'Switch state not read' : keyboardReadback ? 'Device is on' : 'Device is off'}; brightness has no readback`}
            checked={keyboardEnabled}
            onChange={(enabled) => { void submitKeyboard(enabled, currentKeyboardBrightness); }}
            disabled={busy || !authorBridgeAvailable}
          />
          <OperationStatus
            owner="NUCtool.dll"
            state={keyboardStatus}
            language={language}
            detail={keyboardReadback == null
              ? (isZh ? '键盘灯开关状态暂时读不到。' : 'The keyboard switch state is not available.')
              : (isZh ? `键盘灯${keyboardReadback ? '已开启' : '已关闭'}（设备回读）` : `Keyboard light ${keyboardReadback ? 'on' : 'off'} (device readback)`)}
          />
          <div className="settings-lighting-actions">
            <span className={`settings-status-chip ${authorBridgeAvailable ? 'is-on' : ''}`}>
              {authorBridgeAvailable ? (isZh ? '基础背光 DLL 文件已校验' : 'BASIC BACKLIGHT DLL FILE VERIFIED') : (isZh ? '基础背光 DLL 文件未通过校验' : 'BASIC BACKLIGHT DLL FILE UNVERIFIED')}
            </span>
            <button
              className="settings-action"
              type="button"
              disabled={busy || !authorBridgeAvailable || !keyboardEnabled}
              onClick={() => { void submitKeyboard(true, currentKeyboardBrightness); }}
            >
              {isZh ? '应用基础亮度' : 'APPLY BASIC BRIGHTNESS'}
            </button>
          </div>
          <label>
            <span className="form-label">{isZh ? '键盘亮度' : 'KEYBOARD BRIGHTNESS'} · {currentKeyboardBrightness}%</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={currentKeyboardBrightness}
              disabled={busy || !authorBridgeAvailable || !keyboardEnabled}
              onChange={(event) => setKeyboardBrightness(Number(event.target.value))}
            />
          </label>
          <OperationStatus owner="NUCtool.dll" state={brightnessStatus} language={language} detail={lastKeyboardRequest
            ? (isZh ? `最近请求亮度 ${lastKeyboardRequest.brightness}%；DLL 不支持亮度回读。` : `Last requested brightness ${lastKeyboardRequest.brightness}%; the DLL has no brightness readback.`)
            : (isZh ? 'DLL 不支持亮度回读；调整后点击“应用基础亮度”才会发送请求。' : 'Brightness has no DLL readback; moving the slider does not apply it until requested.')}
          />
          <small className="settings-startup-note">{isZh ? '仅提供 DLL 支持的开关与基础亮度；颜色、灯条和动画已移除，避免与厂商服务发生覆盖。' : 'Only DLL-supported on/off and basic brightness remain. Color, lightbar, and animation controls were removed to avoid vendor-service conflicts.'}</small>
        </div>
        <div className="author-capability-readback" aria-live="polite">
          <div><span>{isZh ? 'DLL 支持功能数' : 'DLL SUPPORTED FEATURES'}</span><strong>{authorReadback?.supported_features_count ?? (isZh ? '未读取' : 'NOT READ')}</strong></div>
          <div><span>{isZh ? '灯条能力' : 'LIGHTBAR CAPABILITY'}</span><strong>{authorReadback?.lightbar_supported == null ? (isZh ? '未知' : 'UNKNOWN') : authorReadback.lightbar_supported ? (isZh ? '已检测' : 'DETECTED') : (isZh ? '未检测到' : 'NOT DETECTED')}</strong></div>
          <div><span>PROJECT AURORA</span><strong>{authorReadback?.aurora_installed == null ? (isZh ? '未知' : 'UNKNOWN') : authorReadback.aurora_installed ? (isZh ? '已安装' : 'INSTALLED') : (isZh ? '未安装' : 'NOT INSTALLED')}</strong></div>
        </div>
      </SurfaceCard>

      <SurfaceCard className="module-card settings-card settings-danger">
        <div>
          <h3 className="card-title">{isZh ? '恢复默认设置' : 'RESET DEFAULTS'}</h3>
          <p className="card-subtitle">{isZh ? '重置界面和调度设置，不清除风扇曲线，也不更改系统自启开关。' : 'Reset interface and scheduling settings without clearing fan curves or changing system autostart.'}</p>
        </div>
        <button className="settings-action danger" type="button" onClick={onReset} disabled={busy}>
          {isZh ? '恢复默认设置' : 'RESET DEFAULTS'}
        </button>
      </SurfaceCard>
    </div>
  );
};

export default SettingsSection;
