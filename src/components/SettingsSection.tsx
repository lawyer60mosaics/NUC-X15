import React from 'react';
import GlassCard from './GlassCard';
import { AppSettings, HiddenModuleId, UiFontSize } from '../types/appSettings';
import { SCENARIOS, TimeThemeMode } from '../hooks/useFanControl';
import { scenarioLabel, tr, UiLanguage } from '../i18n';

interface SettingsSectionProps {
  settings: AppSettings;
  timeThemeMode: TimeThemeMode;
  setTimeThemeMode: (mode: TimeThemeMode) => void;
  currentLightingColor: string;
  currentKeyboardBrightness: number;
  currentLightbarBrightness: number;
  currentLightbarBreathing: boolean;
  busy: boolean;
  onChange: (patch: Partial<AppSettings>) => void;
  onSaveLightingDefaults: () => void;
  onReset: () => void;
  language?: 'en' | 'zh';
  setLanguage: (language: UiLanguage) => void;
}

const getModuleOptions = (language: UiLanguage): Array<{ id: HiddenModuleId; label: string; detail: string }> => [
  { id: 'lighting', label: tr(language, 'LIGHTING', '灯光'), detail: tr(language, 'Color, keyboard brightness, and lightbar output', '颜色、键盘亮度和灯条输出') },
  { id: 'display_scene', label: tr(language, 'DISPLAY PROFILE', '显示配置'), detail: tr(language, 'Reading, video, gaming, and office refresh profiles', '阅读、视频、游戏和办公刷新率配置') },
  { id: 'time_theme', label: tr(language, 'DAY / NIGHT UI', '昼夜界面'), detail: tr(language, 'Day, night, or automatic theme', '日间、夜间或自动主题') },
  { id: 'monitor', label: tr(language, 'SYSTEM MONITOR', '系统监控'), detail: tr(language, 'Thermal ranking and diagnostic logs', '温度排行和诊断日志') },
];

const getFontSizeOptions = (language: UiLanguage): Array<{ id: UiFontSize; label: string; detail: string }> => [
  { id: 'compact', label: tr(language, 'COMPACT', '紧凑'), detail: tr(language, 'Higher density for large displays.', '适合大尺寸屏幕的高密度布局。') },
  { id: 'standard', label: tr(language, 'STANDARD', '标准'), detail: tr(language, 'Default size with balanced density.', '兼顾字号与信息密度的默认尺寸。') },
  { id: 'comfortable', label: tr(language, 'COMFORTABLE', '舒适'), detail: tr(language, 'Larger text for bright rooms or distance.', '适合明亮环境或远距离观看的大字号。') },
];

const fieldLabelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: '6px',
  color: 'var(--text-secondary)',
  fontSize: '10px',
  fontWeight: 900,
  letterSpacing: '0.06em',
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  height: '34px',
  color: 'var(--text-primary)',
  background: 'var(--control-bg)',
  border: '1px solid var(--control-border)',
  borderRadius: 'var(--radius-control)',
  padding: '0 10px',
  fontSize: '12px',
  fontWeight: 800,
  outline: 'none',
};

const ToggleRow: React.FC<{
  title: string;
  detail: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}> = ({ title, detail, checked, onChange }) => (
  <button className="settings-toggle-row" type="button" onClick={() => onChange(!checked)}>
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
  timeThemeMode,
  setTimeThemeMode,
  currentLightingColor,
  currentKeyboardBrightness,
  currentLightbarBrightness,
  currentLightbarBreathing,
  busy,
  onChange,
  onSaveLightingDefaults,
  onReset,
  language = 'en',
  setLanguage,
}) => {
  const isZh = language === 'zh';
  const moduleOptions = getModuleOptions(language);
  const fontSizeOptions = getFontSizeOptions(language);
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
      <GlassCard className="module-card settings-card">
        <div className="settings-card-header">
          <div>
            <h3 className="card-title">{isZh ? '界面' : 'INTERFACE'}</h3>
            <p className="card-subtitle">{isZh ? '保留常用入口并隐藏不需要的模块。' : 'Keep common entry points and hide unused modules.'}</p>
          </div>
        </div>

        <div className="settings-grid">
          <label>
            <span style={fieldLabelStyle}>{isZh ? '界面语言' : 'INTERFACE LANGUAGE'}</span>
            <select value={language} onChange={(event) => setLanguage(event.target.value as UiLanguage)} style={selectStyle}>
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </label>
          <label>
            <span style={fieldLabelStyle}>{isZh ? '默认打开页面' : 'DEFAULT LANDING PAGE'}</span>
            <select value={settings.default_tab} onChange={(event) => onChange({ default_tab: event.target.value as AppSettings['default_tab'] })} style={selectStyle}>
              <option value="power">{isZh ? '控制中心' : 'CONTROL CENTER'}</option>
              <option value="monitor">{isZh ? '系统监控' : 'SYSTEM MONITOR'}</option>
              <option value="settings">{isZh ? '系统设置' : 'SYSTEM SETTINGS'}</option>
            </select>
          </label>
          <label>
            <span style={fieldLabelStyle}>{isZh ? '昼夜主题' : 'DAY / NIGHT THEME'}</span>
            <select value={timeThemeMode} onChange={(event) => setTimeThemeMode(event.target.value as TimeThemeMode)} style={selectStyle}>
              <option value="auto">{isZh ? '自动' : 'AUTO'}</option>
              <option value="day">{isZh ? '日间' : 'DAY'}</option>
              <option value="night">{isZh ? '夜间' : 'NIGHT'}</option>
            </select>
          </label>
        </div>

        <div>
          <span style={fieldLabelStyle}>{isZh ? '界面字号' : 'UI FONT SIZE'}</span>
          <div className="settings-choice-grid">
            {fontSizeOptions.map((option) => (
              <button
                key={option.id}
                className={`settings-choice ${settings.ui_font_size === option.id ? 'is-active' : ''}`}
                type="button"
                onClick={() => onChange({ ui_font_size: option.id })}
              >
                <strong>{option.label}</strong>
                <small>{option.detail}</small>
              </button>
            ))}
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
      </GlassCard>

      <GlassCard className="module-card settings-card">
        <div className="settings-card-header">
          <div>
            <h3 className="card-title">{isZh ? '场景设置' : 'SCENE SETTINGS'}</h3>
            <p className="card-subtitle">{isZh ? '设置启动偏好和场景切换行为。' : 'Set startup preferences and scene switching behavior.'}</p>
          </div>
        </div>
        <div className="settings-grid">
          <label>
            <span style={fieldLabelStyle}>{isZh ? '默认场景' : 'DEFAULT SCENE'}</span>
            <select value={settings.default_scenario} onChange={(event) => onChange({ default_scenario: event.target.value })} style={selectStyle}>
              {Object.keys(SCENARIOS).map((key) => (
                <option key={key} value={key}>{scenarioLabel(language, key)}</option>
              ))}
            </select>
          </label>
          <ToggleRow
            title={isZh ? '确认场景切换' : 'CONFIRM SCENE SWITCH'}
            detail={isZh ? '避免误写入功耗配置。' : 'Prevent accidental power profile writes.'}
            checked={settings.confirm_scene_switch}
            onChange={(checked) => onChange({ confirm_scene_switch: checked })}
          />
        </div>

      </GlassCard>

      <GlassCard className="module-card settings-card">
        <div className="settings-card-header">
          <div>
            <h3 className="card-title">{isZh ? '操作历史' : 'OPERATION HISTORY'}</h3>
            <p className="card-subtitle">{isZh ? '记录关键硬件操作并清理过期条目。' : 'Record key hardware actions and clean up expired entries.'}</p>
          </div>
        </div>
        <label>
          <span style={fieldLabelStyle}>{isZh ? '日志保留时间（分钟）' : 'LOG RETENTION (MINUTES)'}</span>
          <input
            className="settings-input"
            type="number"
            min={5}
            max={1440}
            value={settings.operation_log_retention_minutes}
            onChange={(event) => onChange({ operation_log_retention_minutes: Number(event.target.value) })}
          />
        </label>
      </GlassCard>

      <GlassCard className="module-card settings-card">
        <div className="settings-card-header">
          <div>
            <h3 className="card-title">{isZh ? '灯光设置' : 'LIGHTING SETTINGS'}</h3>
            <p className="card-subtitle">{isZh ? '保存键盘颜色和亮度，以便启动时恢复。' : 'Save preferred keyboard colors and brightness for startup restore.'}</p>
          </div>
          <button className="settings-action" type="button" onClick={onSaveLightingDefaults} disabled={busy}>
            {isZh ? '保存当前灯光' : 'SAVE CURRENT LIGHTING'}
          </button>
        </div>
        <ToggleRow
          title={isZh ? '启动时恢复灯光' : 'RESTORE LIGHTING ON STARTUP'}
          detail={isZh ? '启动应用时将保存的灯光配置写入外设服务。' : 'Write the saved lighting profile to the peripheral service on launch.'}
          checked={settings.restore_lighting_on_start}
          onChange={(checked) => onChange({ restore_lighting_on_start: checked })}
        />
        <div className="settings-lighting-preview">
          <span style={{ background: settings.default_lighting_color }} />
          <div>
            <strong>{settings.default_lighting_color.toUpperCase()}</strong>
            <small>
              {isZh ? '键盘' : 'KEYBOARD'} {settings.default_keyboard_brightness}% · {isZh ? '灯条' : 'LIGHTBAR'} {settings.default_lightbar_brightness}% · {settings.default_lightbar_breathing ? (isZh ? '呼吸开启' : 'BREATHING ON') : (isZh ? '呼吸关闭' : 'BREATHING OFF')}
            </small>
          </div>
        </div>
        <div className="settings-lighting-preview">
          <span style={{ background: currentLightingColor }} />
          <div>
            <strong>{isZh ? '当前灯光' : 'CURRENT LIGHTING'}</strong>
            <small>
              {currentLightingColor.toUpperCase()} · {isZh ? '键盘' : 'KEYBOARD'} {currentKeyboardBrightness}% · {isZh ? '灯条' : 'LIGHTBAR'} {currentLightbarBrightness}% · {currentLightbarBreathing ? (isZh ? '呼吸开启' : 'BREATHING ON') : (isZh ? '呼吸关闭' : 'BREATHING OFF')}
            </small>
          </div>
        </div>
      </GlassCard>

      <GlassCard className="module-card settings-card settings-danger">
        <div>
          <h3 className="card-title">{isZh ? '恢复默认设置' : 'RESET DEFAULTS'}</h3>
          <p className="card-subtitle">{isZh ? '重置界面和调度设置，不清除风扇曲线。' : 'Reset interface and scheduling settings without clearing fan curves.'}</p>
        </div>
        <button className="settings-action danger" type="button" onClick={onReset} disabled={busy}>
          {isZh ? '恢复默认设置' : 'RESET DEFAULTS'}
        </button>
      </GlassCard>
    </div>
  );
};

export default SettingsSection;
