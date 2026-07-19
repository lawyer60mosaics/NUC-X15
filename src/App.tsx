import React, { useState, useEffect, useCallback, useRef } from 'react';
import ConfirmDialog from './components/ConfirmDialog';
import PowerSection from './components/PowerSection';
import MonitorSection from './components/MonitorSection';
import SettingsSection from './components/SettingsSection';

// 导入核心 Hooks
import { useFanControl, SCENARIOS } from './hooks/useFanControl';
import { usePower } from './hooks/usePower';
import { useVendorService } from './hooks/useVendorService';
import { useDiagnostics } from './hooks/useDiagnostics';
import { invokeBackend } from './hooks/useTauriApi';
import { scenarioLabel, tr, translateRuntimeText, UiLanguage } from './i18n';
import {
  AppSettings,
  DEFAULT_APP_SETTINGS,
  OperationLogEntry,
  normalizeAppSettings,
} from './types/appSettings';

const OPERATION_LOG_STORAGE_KEY = 'nuctool.operationHistory';

function pruneOperationLogs(logs: OperationLogEntry[], retentionMinutes: number) {
  const cutoff = Date.now() - Math.max(5, retentionMinutes) * 60_000;
  return logs
    .filter((entry) => Number.isFinite(entry.timestamp) && entry.timestamp >= cutoff)
    .slice(0, 200);
}

function loadOperationLogs(retentionMinutes: number) {
  try {
    const raw = window.localStorage.getItem(OPERATION_LOG_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return pruneOperationLogs(parsed, retentionMinutes);
  } catch {
    return [];
  }
}

const ThermalPageFrame: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => (
  <div className="thermal-secondary-frame">
    <main className="thermal-secondary-content">{children}</main>
  </div>
);

const NavIcon = ({ id }: { id: string }) => (
  <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
    {id === 'power' && <><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10.5V20h13v-9.5M9.5 20v-6h5v6" /></>}
    {id === 'monitor' && <><path d="M3 12h4l2-6 4 12 2-6h6" /><path d="M4 4h16v16H4z" /></>}
    {id === 'settings' && <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>}
  </svg>
);

export const App: React.FC = () => {
  // 1. Toast 全局弹窗通知系统
  const [toasts, setToasts] = useState<{ id: string; message: string }[]>([]);
  
  const showToast = useCallback((msg: string) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, message: msg }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const appSettingsRef = useRef<AppSettings>(DEFAULT_APP_SETTINGS);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsBusyLabel, setSettingsBusyLabel] = useState('Saving application settings');
  const [operationLogs, setOperationLogs] = useState<OperationLogEntry[]>(() =>
    typeof window === 'undefined' ? [] : loadOperationLogs(DEFAULT_APP_SETTINGS.operation_log_retention_minutes)
  );
  const settingsLoadedRef = useRef(false);
  const lightingRestoredRef = useRef(false);
  const getAppSettings = useCallback(() => appSettingsRef.current, []);

  // 2. 挂载所有底层的 React 硬件桥接 Hooks
  const fanCtrl = useFanControl(showToast, getAppSettings);
  const powerCtrl = usePower(showToast);
  const vendorCtrl = useVendorService(showToast);
  const getFanPayload = useCallback(() => fanCtrl.buildPayload(), [fanCtrl.buildPayload]);
  const getFanRunning = useCallback(() => fanCtrl.running, [fanCtrl.running]);
  const diagCtrl = useDiagnostics(showToast, getFanPayload, getFanRunning);
  const loadingSources = [
    { active: fanCtrl.busy, label: fanCtrl.busyLabel },
    { active: powerCtrl.busy, label: powerCtrl.busyLabel },
    { active: vendorCtrl.busy, label: vendorCtrl.busyLabel },
    { active: diagCtrl.busy, label: diagCtrl.busyLabel },
    { active: settingsBusy, label: settingsBusyLabel },
  ];
  const activeLoading = loadingSources.find((source) => source.active);

  // 3. 全局切页 Tab 状态
  const [activeTab, setActiveTab] = useState<string>(DEFAULT_APP_SETTINGS.default_tab);
  const [pendingScenario, setPendingScenario] = useState<string | null>(null);

  const writeOperationLogs = useCallback((nextLogs: OperationLogEntry[]) => {
    setOperationLogs(nextLogs);
    try {
      window.localStorage.setItem(OPERATION_LOG_STORAGE_KEY, JSON.stringify(nextLogs));
    } catch {
      // localStorage 失败不影响硬件控制。
    }
  }, []);

  const logOperation = useCallback((
    action: string,
    detail: string,
    level: OperationLogEntry['level'] = 'info'
  ) => {
    setOperationLogs((prev) => {
      const next = pruneOperationLogs([
        {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          timestamp: Date.now(),
          level,
          action,
          detail,
        },
        ...prev,
      ], appSettingsRef.current.operation_log_retention_minutes);
      try {
        window.localStorage.setItem(OPERATION_LOG_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // localStorage 失败不影响硬件控制。
      }
      return next;
    });
  }, []);

  const clearOperationLogs = useCallback(() => {
    writeOperationLogs([]);
    showToast('Operation history cleared.');
  }, [showToast, writeOperationLogs]);

  const [uiLanguage, setUiLanguage] = useState<UiLanguage>(() => {
    try { return window.localStorage.getItem('nuctool.uiLanguage') === 'zh' ? 'zh' : 'en'; } catch { return 'en'; }
  });

  const tabs = [
    { id: 'power', label: uiLanguage === 'zh' ? '控制中心' : 'CONTROL CENTER', subtitle: uiLanguage === 'zh' ? '灯光 · 场景 · 功耗' : 'LIGHTING · SCENES · POWER', index: 1 },
    ...(!appSettings.hidden_modules.includes('monitor')
      ? [{ id: 'monitor', label: uiLanguage === 'zh' ? '系统监控' : 'SYSTEM MONITOR', subtitle: uiLanguage === 'zh' ? '温度 · 日志' : 'THERMALS · LOGS', index: 2 }]
      : []),
    { id: 'settings', label: uiLanguage === 'zh' ? '系统设置' : 'SYSTEM SETTINGS', subtitle: uiLanguage === 'zh' ? '偏好 · 默认值' : 'PREFERENCES · DEFAULTS', index: appSettings.hidden_modules.includes('monitor') ? 2 : 3 },
  ];

  // 4. 场景只切换静态配色，不触发任何持续动效。
  useEffect(() => {
    document.documentElement.setAttribute('data-scenario', fanCtrl.selectedScenario);
  }, [fanCtrl.selectedScenario]);

  useEffect(() => {
    document.documentElement.setAttribute('data-ui-language', uiLanguage);
    try { window.localStorage.setItem('nuctool.uiLanguage', uiLanguage); } catch { /* ignore storage failures */ }
  }, [uiLanguage]);

  useEffect(() => {
    const syncTimeTheme = () => {
      const hour = new Date().getHours();
      const theme = fanCtrl.timeThemeMode === 'auto'
        ? (hour >= 7 && hour < 18 ? 'day' : 'night')
        : fanCtrl.timeThemeMode;
      document.documentElement.setAttribute('data-time-theme', theme);
    };

    syncTimeTheme();
    const syncWhenVisible = () => {
      if (!document.hidden) syncTimeTheme();
    };
    document.addEventListener('visibilitychange', syncWhenVisible);
    window.addEventListener('focus', syncTimeTheme);
    return () => {
      document.removeEventListener('visibilitychange', syncWhenVisible);
      window.removeEventListener('focus', syncTimeTheme);
    };
  }, [fanCtrl.timeThemeMode]);

  useEffect(() => {
    if (activeTab === 'monitor' && appSettings.hidden_modules.includes('monitor')) {
      setActiveTab('power');
    }
  }, [activeTab, appSettings.hidden_modules]);

  useEffect(() => {
    document.documentElement.setAttribute('data-ui-font-size', appSettings.ui_font_size);
  }, [appSettings.ui_font_size]);

  useEffect(() => {
    setOperationLogs((prev) => {
      const next = pruneOperationLogs(prev, appSettings.operation_log_retention_minutes);
      try {
        window.localStorage.setItem(OPERATION_LOG_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // localStorage 失败不影响硬件控制。
      }
      return next;
    });
  }, [appSettings.operation_log_retention_minutes]);

  const persistAppSettings = useCallback(async (next: AppSettings, message = 'Application settings saved.') => {
    appSettingsRef.current = next;
    setAppSettings(next);
    setSettingsBusy(true);
    setSettingsBusyLabel('Saving application settings');
    try {
      const payload = fanCtrl.buildPayload();
      await invokeBackend('save_fan_config', { fanData: { ...payload, app_settings: next } });
      logOperation('Save settings', message, 'success');
      showToast(message);
    } catch (e: any) {
      logOperation('Save settings failed', e.message || String(e), 'error');
      showToast(`Failed to save application settings: ${e.message || e}`);
    } finally {
      setSettingsBusy(false);
    }
  }, [fanCtrl, logOperation, showToast]);

  const updateAppSettings = useCallback((patch: Partial<AppSettings>) => {
    const next = normalizeAppSettings({ ...appSettingsRef.current, ...patch });
    persistAppSettings(next);
  }, [persistAppSettings]);

  const applyScenarioChange = useCallback((scenario: string) => {
    const label = SCENARIOS[scenario]?.label || scenario;
    fanCtrl.setSelectedScenario(scenario);
    logOperation('Change scene', `Scene changed to ${label}`, 'success');
  }, [fanCtrl.setSelectedScenario, logOperation]);

  // 功耗始终跟随风扇场景自动同步：用户不需要单独选择 CPU PL1/PL2。
  useEffect(() => {
    const powerMode = fanCtrl.selectedScenario === 'silent'
      ? 'powersave'
      : fanCtrl.selectedScenario === 'performance' ? 'performance' : 'balanced';
    const label = SCENARIOS[fanCtrl.selectedScenario]?.label || fanCtrl.selectedScenario;
    logOperation('Sync power', `${label} automatically matched ${powerMode} power and locked`, 'info');
    powerCtrl.applyPowerMode(powerMode, { quiet: true, preserveFanControl: true });
  }, [fanCtrl.selectedScenario, logOperation, powerCtrl.applyPowerMode]);

  const confirmScenarioChange = () => {
    if (!pendingScenario) return;
    applyScenarioChange(pendingScenario);
    setPendingScenario(null);
  };

  useEffect(() => {
    if (settingsLoadedRef.current) return;
    settingsLoadedRef.current = true;

    const loadAppSettings = async () => {
      setSettingsBusy(true);
      setSettingsBusyLabel('Loading application settings');
      try {
        const fanData = await invokeBackend('load_fan_config');
        const loaded = normalizeAppSettings(fanData?.app_settings);
        appSettingsRef.current = loaded;
        setAppSettings(loaded);
        setActiveTab(loaded.default_tab);
        if (SCENARIOS[loaded.default_scenario]) {
          fanCtrl.setSelectedScenario(loaded.default_scenario);
        }
      } catch (e: any) {
        showToast(`Failed to load application settings: ${e.message || e}`);
      } finally {
        setSettingsBusy(false);
      }
    };

    loadAppSettings();
  }, [fanCtrl, showToast]);

  useEffect(() => {
    if (lightingRestoredRef.current || !appSettings.restore_lighting_on_start) return;
    lightingRestoredRef.current = true;
    vendorCtrl.setLightingColor(appSettings.default_lighting_color);
    vendorCtrl.setKeyboardBrightness(appSettings.default_keyboard_brightness);
    vendorCtrl.setLightbarBrightness(appSettings.default_lightbar_brightness);
    vendorCtrl.setLightbarBreathing(appSettings.default_lightbar_breathing);
    vendorCtrl.applyLighting(
      appSettings.default_lighting_color,
      appSettings.default_keyboard_brightness,
      appSettings.default_lightbar_brightness,
      appSettings.default_lightbar_breathing
    );
    logOperation('Restore lighting', 'Restored keyboard and lightbar defaults', 'success');
  }, [appSettings, logOperation, vendorCtrl]);

  const handleToggleFanControl = useCallback(() => {
    logOperation(fanCtrl.running ? 'Release EC control' : 'Start EC control', fanCtrl.running ? 'Returned fan control to the system' : 'Enabled the current fan curve', 'info');
    fanCtrl.toggleControl();
  }, [fanCtrl, logOperation]);

  const handleRunSentinelTest = useCallback(() => {
    logOperation('Sentinel test', 'Manually triggered a sentinel restart test', 'warn');
    diagCtrl.runSentinelTest();
  }, [diagCtrl, logOperation]);

  const saveLightingDefaults = () => {
    updateAppSettings({
      default_lighting_color: vendorCtrl.lightingColor,
      default_keyboard_brightness: vendorCtrl.keyboardBrightness,
      default_lightbar_brightness: vendorCtrl.lightbarBrightness,
      default_lightbar_breathing: vendorCtrl.lightbarBreathing,
    });
  };

  const resetAppSettings = () => {
    persistAppSettings(DEFAULT_APP_SETTINGS, 'Application settings restored to defaults.');
  };

  return (
    <div 
      className={`app-shell faraday-shell lenovo-console thermal-dashboard-mode thermal-page-${activeTab}`}
    >
      {/* 背景底色层 */}
      <div className="fluid-glow-container">
        <div className="fluid-glow-orb-1" />
        <div className="fluid-glow-orb-2" />
      </div>

      {/* 极简折射 Toast 提醒组件 */}
      <div 
        style={{ 
          position: 'fixed', 
          top: '24px', 
          right: '24px', 
          zIndex: 99999, 
          display: 'flex', 
          flexDirection: 'column', 
          gap: '12px',
          pointerEvents: 'none'
        }}
      >
        {toasts.map((toast) => (
          <div 
            key={toast.id} 
            style={{
              background: 'var(--surface-toast)',
              backdropFilter: 'blur(20px)',
              border: '1px solid var(--border-strong)',
              borderRadius: '12px',
              padding: '12px 20px',
              color: '#ffffff',
              fontSize: '12px',
              fontWeight: 600,
              boxShadow: '0 20px 40px rgba(0,0,0,0.4), inset 0 0 10px rgba(255,255,255,0.05)',
              pointerEvents: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent-color)' }}></span>
            {translateRuntimeText(toast.message, uiLanguage)}
          </div>
        ))}
      </div>

      {activeLoading && (
        <div className="global-loading-overlay" role="alert" aria-live="assertive" aria-busy="true">
          <div className="global-loading-panel">
            <div className="global-loading-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div>
              <div className="global-loading-title">{tr(uiLanguage, 'Waiting for backend response', '正在等待后端响应')}</div>
              <div className="global-loading-message">{translateRuntimeText(activeLoading.label, uiLanguage)}</div>
            </div>
          </div>
        </div>
      )}

      {pendingScenario && (
        <ConfirmDialog
          title={tr(uiLanguage, 'Confirm scene change', '确认切换场景')}
          message={tr(
            uiLanguage,
            `Switch to ${scenarioLabel('en', pendingScenario)} and synchronize the power profile?`,
            `切换至${scenarioLabel('zh', pendingScenario)}模式并同步功耗配置？`
          )}
          confirmText={tr(uiLanguage, 'CONFIRM', '确认')}
          cancelText={tr(uiLanguage, 'CANCEL', '取消')}
          busyText={tr(uiLanguage, 'PROCESSING...', '处理中……')}
          busy={fanCtrl.busy || powerCtrl.busy}
          onCancel={() => setPendingScenario(null)}
          onConfirm={confirmScenarioChange}
        />
      )}

      <aside className="admin-sidebar">
        <div className="sidebar-brand">
          <div>
            <h1>AURORA</h1>
            <span>{tr(uiLanguage, 'ESPORTS FAN CONTROL CENTER', '电竞风扇控制中心')}</span>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label={tr(uiLanguage, 'Primary navigation', '主导航')}>
          {tabs.map((tab) => {
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                className={`sidebar-nav-item ${isActive ? 'is-active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
                type="button"
              >
                <span className="nav-index"><NavIcon id={tab.id} /></span>
                <span className="nav-copy">
                  <strong>{tab.label}</strong>
                  <small>{tab.subtitle}</small>
                </span>
              </button>
            );
          })}
        </nav>

      </aside>

      <section className="admin-workspace">
        <header className="workspace-header">
          <div className="workspace-brandline">
            <span className="workspace-brand-mark" aria-hidden="true">△</span>
            <div>
            <p className="workspace-eyebrow">AURORA / {uiLanguage === 'zh' ? '电竞硬件' : 'ESPORTS HARDWARE'}</p>
              <h2>{tabs.find((tab) => tab.id === activeTab)?.label}</h2>
            </div>
          </div>
          <div className="workspace-actions">
            <div className="workspace-utility" aria-label={tr(uiLanguage, 'Application utilities', '应用工具')}>
              <div className="language-toggle" role="group" aria-label={tr(uiLanguage, 'Language selector', '语言选择')}>
                <button type="button" className={uiLanguage === 'en' ? 'is-active' : ''} onClick={() => setUiLanguage('en')}>EN</button>
                <button type="button" className={uiLanguage === 'zh' ? 'is-active' : ''} onClick={() => setUiLanguage('zh')}>中文</button>
              </div>
            </div>
            <div className="workspace-live-status">
              <span className={fanCtrl.running ? 'is-running' : ''}><i />{fanCtrl.running ? (uiLanguage === 'zh' ? 'EC 接管正常' : 'EC TAKEOVER OK') : (uiLanguage === 'zh' ? '系统托管' : 'SYSTEM MANAGED')}</span>
              <span>{uiLanguage === 'zh' ? '交流电源' : 'AC POWER'}</span>
            </div>
          </div>
        </header>

        <main className="workspace-content">
        {activeTab === 'power' && (
          <PowerSection
            cpuTemp={fanCtrl.cpuTemp}
            gpuTemp={fanCtrl.gpuTemp}
            running={fanCtrl.running}
            toggleControl={handleToggleFanControl}
            selectedScenario={fanCtrl.selectedScenario}
            requestScenarioChange={(scenario) => {
              if (scenario === fanCtrl.selectedScenario) return;
              if (appSettings.confirm_scene_switch) setPendingScenario(scenario);
              else applyScenarioChange(scenario);
            }}
            constantSpeedEnabled={fanCtrl.constantSpeedEnabled}
            setConstantSpeedEnabled={fanCtrl.setConstantSpeedEnabled}
            constantSpeed={fanCtrl.constantSpeed}
            setConstantSpeed={fanCtrl.setConstantSpeed}
            language={uiLanguage}
          />
        )}

        {activeTab === 'monitor' && (
          <ThermalPageFrame>
            <MonitorSection
              cpuTemp={fanCtrl.cpuTemp}
              gpuTemp={fanCtrl.gpuTemp}
              summary={diagCtrl.summary}
              logs={diagCtrl.logs}
              runSentinelTest={handleRunSentinelTest}
              operationLogs={operationLogs}
              operationLogRetentionMinutes={appSettings.operation_log_retention_minutes}
              clearOperationLogs={clearOperationLogs}
              language={uiLanguage}
            />
          </ThermalPageFrame>
        )}

        {activeTab === 'settings' && (
          <ThermalPageFrame>
            <SettingsSection
              settings={appSettings}
              timeThemeMode={fanCtrl.timeThemeMode}
              setTimeThemeMode={fanCtrl.setTimeThemeMode}
              currentLightingColor={vendorCtrl.lightingColor}
              currentKeyboardBrightness={vendorCtrl.keyboardBrightness}
              currentLightbarBrightness={vendorCtrl.lightbarBrightness}
              currentLightbarBreathing={vendorCtrl.lightbarBreathing}
              busy={settingsBusy || vendorCtrl.busy}
              onChange={updateAppSettings}
              onSaveLightingDefaults={saveLightingDefaults}
              onReset={resetAppSettings}
              language={uiLanguage}
              setLanguage={setUiLanguage}
            />
          </ThermalPageFrame>
        )}
        </main>

        <footer className="workspace-footer">
          <span>NUCtool Matrix System v2.6.0-React</span>
          <span>{tr(uiLanguage, 'Operational Hardware Console', '硬件控制终端')}</span>
        </footer>
      </section>
    </div>
  );
};

export default App;
