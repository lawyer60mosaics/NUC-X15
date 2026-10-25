import React, { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import PowerSection from './components/PowerSection';
import DisplaySection from './components/DisplaySection';
import MonitorSection from './components/MonitorSection';
import SettingsSection from './components/SettingsSection';
import packageJson from '../package.json';

// 导入核心 Hooks
import { SCENARIOS, useFanControl } from './hooks/useFanControl';
import { usePower } from './hooks/usePower';
import { useVendorService } from './hooks/useVendorService';
import { useDiagnostics } from './hooks/useDiagnostics';
import { useAutostart } from './hooks/useAutostart';
import { invokeBackend } from './hooks/useTauriApi';
import { tr, translateRuntimeText, UiLanguage } from './i18n';
import {
  AppSettings,
  AppTabId,
  DEFAULT_APP_SETTINGS,
  normalizeAppSettings,
} from './types/appSettings';

const FONT_SETTINGS_STORAGE_KEY = 'nuctool.fontSettings';

type LoadingSource = 'fan' | 'power' | 'vendor' | 'diagnostics' | 'autostart' | 'settings';

type LoadingItem = {
  active: boolean;
  label: string;
  source: LoadingSource;
  moduleEn: string;
  moduleZh: string;
  waitEn: string;
  waitZh: string;
  timeoutEn: string;
  timeoutZh: string;
};

function readCachedFontSettings(): Partial<AppSettings> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(FONT_SETTINGS_STORAGE_KEY);
    const cached = raw ? JSON.parse(raw) : {};
    return typeof cached === 'object' && cached !== null ? cached : {};
  } catch {
    return {};
  }
}

function loadCachedFontSettings() {
  return normalizeAppSettings({ ...DEFAULT_APP_SETTINGS, ...readCachedFontSettings() });
}

function cacheFontSettings(settings: AppSettings) {
  try {
    window.localStorage.setItem(FONT_SETTINGS_STORAGE_KEY, JSON.stringify({
      ui_font_size: settings.ui_font_size,
      ui_font_size_px: settings.ui_font_size_px,
    }));
  } catch {
    // 本地缓存失败时仍由后端配置文件负责持久化。
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
    {id === 'fan' && <><circle cx="12" cy="12" r="2.2" /><path d="M12 9.8c-1.2-3.4.1-6 2.2-6.4 2-.3 3.2 1.5 2.2 3.4C15.6 8.3 13.9 9.3 12 9.8ZM14 13c3.5-.7 5.8.9 5.8 3 0 2-2 2.9-3.7 1.6-1.4-1-2-2.9-2.1-4.6ZM10.2 13.1c-2.3 2.8-5.2 3.1-6.4 1.4-1.1-1.7.1-3.4 2.3-3.2 1.8.1 3.2.8 4.1 1.8Z" /></>}
    {id === 'performance' && <><path d="M4 17a8 8 0 1 1 16 0" /><path d="m12 13 4-4M7 17h10" /></>}
    {id === 'display' && <><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M8 21h8m-4-3v3M7 9h10" /></>}
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

  const [appSettings, setAppSettings] = useState<AppSettings>(loadCachedFontSettings);
  const appSettingsRef = useRef<AppSettings>(appSettings);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsBusyLabel, setSettingsBusyLabel] = useState('Saving application settings');
  const settingsLoadedRef = useRef(false);
  const settingsSaveTimerRef = useRef<number | null>(null);
  const settingsSaveInFlightRef = useRef(false);
  const settingsSaveSequenceRef = useRef(0);
  const pendingSettingsSaveRef = useRef<{ next: AppSettings; message: string; sequence: number } | null>(null);
  const getAppSettings = useCallback(() => appSettingsRef.current, []);

  // 2. 挂载所有底层的 React 硬件桥接 Hooks
  const fanCtrl = useFanControl(showToast, getAppSettings);
  const autostartCtrl = useAutostart(showToast);
  const powerCtrl = usePower(showToast);
  const vendorCtrl = useVendorService(showToast);
  const handleFanScenarioSelect = useCallback((scenarioName: string) => {
    if (!SCENARIOS[scenarioName as keyof typeof SCENARIOS]) return;
    fanCtrl.setSelectedScenario(scenarioName);
  }, [fanCtrl.setSelectedScenario]);
  const getFanPayload = useCallback(() => fanCtrl.buildPayload(), [fanCtrl.buildPayload]);
  const getFanRunning = useCallback(() => fanCtrl.running, [fanCtrl.running]);
  const diagCtrl = useDiagnostics(showToast, getFanPayload, getFanRunning);
  const loadingSources: LoadingItem[] = [
    {
      active: fanCtrl.busy,
      label: fanCtrl.busyLabel,
      source: 'fan',
      moduleEn: 'FAN CONTROL / EC',
      moduleZh: '风扇控制 / EC',
      waitEn: 'The app is waiting for the embedded controller to finish the fan operation. Do not click the control again while it is running.',
      waitZh: '正在等待 EC 控制器完成风扇操作。执行期间请不要重复点击同一个控制。',
      timeoutEn: 'The EC may be unavailable or waiting for administrator access. Check fan-control permissions and try again after the current operation ends.',
      timeoutZh: 'EC 可能不可用，或正在等待管理员权限。当前操作结束后，请检查风扇控制权限再重试。',
    },
    {
      active: powerCtrl.busy,
      label: powerCtrl.busyLabel,
      source: 'power',
      moduleEn: 'POWER CONTROL',
      moduleZh: '功耗控制',
      waitEn: 'The app is reading or writing the Windows power profile / TDP limits. PowerShell and hardware responses can take a few seconds.',
      waitZh: '正在读取或写入 Windows 电源方案 / TDP 限制。PowerShell 和硬件响应可能需要几秒钟。',
      timeoutEn: 'PowerShell or the hardware power interface may not have responded. Check administrator access and the power-service status before retrying.',
      timeoutZh: 'PowerShell 或硬件功耗接口可能没有响应。重试前请检查管理员权限和功耗服务状态。',
    },
    {
      active: vendorCtrl.busy,
      label: vendorCtrl.busyLabel,
      source: 'vendor',
      moduleEn: 'VENDOR SERVICE',
      moduleZh: '厂商服务',
      waitEn: 'The app is waiting for Intel NUC Software Studio / Uniwill service to apply the hardware setting.',
      waitZh: '正在等待 Intel NUC Software Studio / Uniwill 服务应用硬件设置。',
      timeoutEn: 'The vendor service may not be running or may not support this device. Check the installed service and retry after it is available.',
      timeoutZh: '厂商服务可能未运行，或不支持当前设备。请检查已安装的服务，确认可用后再重试。',
    },
    {
      active: diagCtrl.busy,
      label: diagCtrl.busyLabel,
      source: 'diagnostics',
      moduleEn: 'DIAGNOSTICS',
      moduleZh: '诊断模块',
      waitEn: 'The app is collecting hardware state or dispatching a recovery test.',
      waitZh: '正在读取硬件状态或执行恢复测试。',
      timeoutEn: 'The diagnostic backend did not return in time. Check the backend status and run the test again when the device is idle.',
      timeoutZh: '诊断后端没有及时返回。请检查后端状态，等待设备空闲后再重新执行测试。',
    },
    {
      active: autostartCtrl.autostartBusy,
      label: autostartCtrl.autostartBusyLabel,
      source: 'autostart',
      moduleEn: 'WINDOWS STARTUP',
      moduleZh: 'Windows 开机启动',
      waitEn: 'The app is reading or updating the Windows startup task. This may require administrator access.',
      waitZh: '正在读取或更新 Windows 开机启动任务，此操作可能需要管理员权限。',
      timeoutEn: 'Windows did not finish the startup-task operation. Check administrator access and Task Scheduler, then retry.',
      timeoutZh: 'Windows 没有完成开机启动任务操作。请检查管理员权限和任务计划程序后再重试。',
    },
    {
      active: settingsBusy,
      label: settingsBusyLabel,
      source: 'settings',
      moduleEn: 'LOCAL SETTINGS',
      moduleZh: '本地设置',
      waitEn: 'The app is saving the current preferences to its local configuration file.',
      waitZh: '正在把当前偏好保存到本地配置文件。',
      timeoutEn: 'The local configuration file may be locked or inaccessible. Check the app data directory and file permissions before retrying.',
      timeoutZh: '本地配置文件可能被占用或无法访问。请检查应用数据目录和文件权限后再重试。',
    },
  ];
  const activeLoading = loadingSources.find((source) => source.active);

  // 3. 全局切页 Tab 状态
  const [activeTab, setActiveTab] = useState<AppTabId>(DEFAULT_APP_SETTINGS.default_tab);

  const [uiLanguage, setUiLanguage] = useState<UiLanguage>(() => {
    try { return window.localStorage.getItem('nuctool.uiLanguage') === 'en' ? 'en' : 'zh'; } catch { return 'zh'; }
  });

  const loadingSignature = activeLoading ? `${activeLoading.source}:${activeLoading.label}` : '';
  const [loadingElapsed, setLoadingElapsed] = useState(0);

  useEffect(() => {
    if (!loadingSignature) {
      setLoadingElapsed(0);
      return undefined;
    }

    const startedAt = Date.now();
    setLoadingElapsed(0);
    const timer = window.setInterval(() => {
      setLoadingElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [loadingSignature]);

  const loadingIsSlow = loadingElapsed >= 10;
  const loadingIsTimedOut = loadingElapsed >= 30;

  const tabs: Array<{ id: AppTabId; label: string; subtitle: string; group: 'device' | 'system' }> = [
    { id: 'power', label: uiLanguage === 'zh' ? '设备概览' : 'DEVICE OVERVIEW', subtitle: uiLanguage === 'zh' ? '状态 · 快捷入口' : 'STATUS · SHORTCUTS', group: 'device' },
    { id: 'fan', label: uiLanguage === 'zh' ? '风扇控制' : 'FAN CONTROL', subtitle: uiLanguage === 'zh' ? '转速 · 温度曲线' : 'SPEED · CURVES', group: 'device' },
    { id: 'performance', label: uiLanguage === 'zh' ? '性能模式' : 'PERFORMANCE', subtitle: uiLanguage === 'zh' ? '省电 · 平衡 · 性能' : 'POWER SAVE · BALANCED · PERFORMANCE', group: 'device' },
    { id: 'display', label: uiLanguage === 'zh' ? '画质场景' : 'DISPLAY SCENES', subtitle: uiLanguage === 'zh' ? '阅读 · 观影 · 竞技' : 'READ · VIDEO · GAME', group: 'device' },
    ...(!appSettings.hidden_modules.includes('monitor')
      ? [{ id: 'monitor' as AppTabId, label: uiLanguage === 'zh' ? '系统监控' : 'SYSTEM MONITOR', subtitle: uiLanguage === 'zh' ? '温度 · 诊断' : 'THERMALS · HEALTH', group: 'system' as const }]
      : []),
    { id: 'settings', label: uiLanguage === 'zh' ? '系统设置' : 'SYSTEM SETTINGS', subtitle: uiLanguage === 'zh' ? '偏好 · 默认值' : 'PREFERENCES · DEFAULTS', group: 'system' },
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
    try { window.localStorage.removeItem('nuctool.operationHistory'); } catch { /* ignore storage failures */ }
  }, []);

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

  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-ui-font-size', appSettings.ui_font_size);
    document.documentElement.style.setProperty('--ui-font-scale', String(appSettings.ui_font_size_px / 15));
  }, [appSettings.ui_font_size, appSettings.ui_font_size_px]);

  const flushAppSettingsSave = useCallback(async () => {
    if (settingsSaveInFlightRef.current) return;
    const pending = pendingSettingsSaveRef.current;
    if (!pending) {
      setSettingsBusy(false);
      return;
    }
    pendingSettingsSaveRef.current = null;
    settingsSaveInFlightRef.current = true;
    setSettingsBusy(true);
    setSettingsBusyLabel('Saving application settings');
    try {
      const payload = fanCtrl.buildPayload();
      await invokeBackend('save_fan_config', { fanData: { ...payload, app_settings: pending.next } });
      if (pending.sequence === settingsSaveSequenceRef.current) showToast(pending.message);
    } catch (e: any) {
      if (pending.sequence === settingsSaveSequenceRef.current) {
        showToast(`Failed to save application settings: ${e.message || e}`);
      }
    } finally {
      settingsSaveInFlightRef.current = false;
      if (pendingSettingsSaveRef.current) {
        settingsSaveTimerRef.current = window.setTimeout(() => {
          settingsSaveTimerRef.current = null;
          void flushAppSettingsSave();
        }, 0);
      } else {
        setSettingsBusy(false);
      }
    }
  }, [fanCtrl.buildPayload, showToast]);

  const persistAppSettings = useCallback((next: AppSettings, message = 'Application settings saved.') => {
    appSettingsRef.current = next;
    setAppSettings(next);
    cacheFontSettings(next);
    setSettingsBusy(true);
    const sequence = settingsSaveSequenceRef.current + 1;
    settingsSaveSequenceRef.current = sequence;
    pendingSettingsSaveRef.current = { next, message, sequence };
    if (settingsSaveTimerRef.current !== null) window.clearTimeout(settingsSaveTimerRef.current);
    settingsSaveTimerRef.current = window.setTimeout(() => {
      settingsSaveTimerRef.current = null;
      void flushAppSettingsSave();
    }, 180);
  }, [flushAppSettingsSave]);

  useEffect(() => () => {
    if (settingsSaveTimerRef.current !== null) window.clearTimeout(settingsSaveTimerRef.current);
  }, []);

  const updateAppSettings = useCallback((patch: Partial<AppSettings>) => {
    const next = normalizeAppSettings({ ...appSettingsRef.current, ...patch });
    persistAppSettings(next);
  }, [persistAppSettings]);

  useEffect(() => {
    if (settingsLoadedRef.current) return;
    settingsLoadedRef.current = true;

    const loadAppSettings = async () => {
      setSettingsBusy(true);
      setSettingsBusyLabel('Loading application settings');
      try {
        const fanData = await invokeBackend('load_fan_config');
        const loaded = normalizeAppSettings({ ...(fanData?.app_settings ?? {}), ...readCachedFontSettings() });
        appSettingsRef.current = loaded;
        setAppSettings(loaded);
        cacheFontSettings(loaded);
        setActiveTab(loaded.default_tab);
      } catch (e: any) {
        showToast(`Failed to load application settings: ${e.message || e}`);
      } finally {
        setSettingsBusy(false);
      }
    };

    loadAppSettings();
  }, [fanCtrl, showToast]);

  const handleToggleFanControl = useCallback(() => {
    fanCtrl.toggleControl();
  }, [fanCtrl]);

  const handleRunSentinelTest = useCallback(() => {
    diagCtrl.runSentinelTest();
  }, [diagCtrl]);

  const resetAppSettings = () => {
    persistAppSettings(DEFAULT_APP_SETTINGS, 'Application settings restored to defaults.');
  };

  return (
    <div 
      className={`app-shell thermal-page-${activeTab}`}
    >
      <a className="skip-link" href="#workspace-main">
        {tr(uiLanguage, 'Skip to content', '跳转到主要内容')}
      </a>

      <div className="toast-region">
        {toasts.map((toast) => {
          const isError = /^(failed|error|warning:)/i.test(toast.message.trim());
          return (
          <div className={`toast-item ${isError ? 'is-error' : ''}`} key={toast.id} role={isError ? 'alert' : 'status'} aria-live={isError ? 'assertive' : 'polite'} aria-atomic="true">
            <span className="status-dot" aria-hidden="true" />
            <span className="toast-copy">
              <span>{translateRuntimeText(toast.message, uiLanguage)}</span>
              {isError && <small>{uiLanguage === 'zh' ? '请先确认对应设备、服务或权限正常，再重试。' : 'Check the related device, service, or permissions before retrying.'}</small>}
            </span>
          </div>
          );
        })}
      </div>

      {activeLoading && (
        <div className="global-loading-overlay" role="alert" aria-live="assertive" aria-busy="true">
          <div className={`global-loading-panel ${loadingIsTimedOut ? 'is-timeout' : loadingIsSlow ? 'is-slow' : ''}`}>
            <div className="global-loading-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="global-loading-content">
              <div className="global-loading-kicker">
                {uiLanguage === 'zh' ? activeLoading.moduleZh : activeLoading.moduleEn}
              </div>
              <div className="global-loading-title">{translateRuntimeText(activeLoading.label, uiLanguage)}</div>
              <div className="global-loading-message">
                {uiLanguage === 'zh'
                  ? `已等待 ${loadingElapsed} 秒${loadingIsTimedOut ? ' · 可能超时' : loadingIsSlow ? ' · 响应较慢' : ''}`
                  : `Waiting ${loadingElapsed}s${loadingIsTimedOut ? ' · POSSIBLE TIMEOUT' : loadingIsSlow ? ' · SLOW RESPONSE' : ''}`}
              </div>
              <div className="global-loading-detail">
                {loadingIsTimedOut
                  ? (uiLanguage === 'zh' ? activeLoading.timeoutZh : activeLoading.timeoutEn)
                  : (uiLanguage === 'zh' ? activeLoading.waitZh : activeLoading.waitEn)}
              </div>
              <div className="global-loading-note">
                {uiLanguage === 'zh'
                  ? '当前界面已锁定，避免重复写入；操作完成后会自动解除。'
                  : 'The interface is locked to prevent duplicate writes and will unlock automatically when this finishes.'}
              </div>
              {loadingIsTimedOut && (
                <div className="global-loading-next-step" role="note">
                  {uiLanguage === 'zh'
                    ? '这只是超时提醒，后台命令仍在运行，并未取消。请勿重复提交；确认权限或对应服务状态后等待本次操作结束。若长时间不返回，退出并重新打开应用，再尝试一次。'
                    : 'This is a timeout warning; the command is still running and has not been cancelled. Do not submit it again. Check permissions or the related service and wait for this operation to finish. If it remains stuck, close and reopen the app before retrying.'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <aside className="admin-sidebar">
        <div className="sidebar-brand">
          <div className="brand-lockup">
            <span className="brand-glyph" aria-hidden="true">N</span>
            <div>
              <h1><b>NUC</b>tool</h1>
              <span>{tr(uiLanguage, 'Hardware Control Studio', '硬件控制中心')}</span>
            </div>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label={tr(uiLanguage, 'Primary navigation', '主导航')}>
          {tabs.map((tab, index) => {
            const isActive = tab.id === activeTab;
            return (
              <React.Fragment key={tab.id}>
                {(index === 0 || tabs[index - 1].group !== tab.group) && (
                  <span className="sidebar-nav-group">
                    {tab.group === 'device'
                      ? tr(uiLanguage, 'DEVICE', '设备')
                      : tr(uiLanguage, 'SYSTEM', '系统')}
                  </span>
                )}
                <button
                  className={`sidebar-nav-item ${isActive ? 'is-active' : ''}`}
                  onClick={() => setActiveTab(tab.id)}
                  type="button"
                  aria-current={isActive ? 'page' : undefined}
                >
                  <span className="nav-index"><NavIcon id={tab.id} /></span>
                  <span className="nav-copy">
                    <strong>{tab.label}</strong>
                    <small>{tab.subtitle}</small>
                  </span>
                </button>
              </React.Fragment>
            );
          })}
        </nav>
        <div className="sidebar-control-status" aria-label={tr(uiLanguage, 'Control channel status', '控制通道状态')}>
          <span className="sidebar-control-title">{tr(uiLanguage, 'CONTROL CHANNELS', '控制通道')}</span>
          <div><i className={fanCtrl.running ? 'is-active' : ''} /><span>EC / {tr(uiLanguage, 'Fans', '风扇')}</span><strong>{fanCtrl.running ? tr(uiLanguage, 'Active', '接管中') : tr(uiLanguage, 'System', '系统托管')}</strong></div>
          <div><i className={vendorCtrl.displayBridgeAvailable ? 'is-active' : ''} /><span>NUCtool.dll</span><strong>{vendorCtrl.displayBridgeAvailable ? tr(uiLanguage, 'File verified', '文件已校验') : tr(uiLanguage, 'Unavailable', '不可用')}</strong></div>
        </div>
      </aside>

      <section className="admin-workspace">
        <header className="workspace-header">
          <div className="workspace-brandline">
            <div>
              <p className="workspace-eyebrow">NUCTOOL / {uiLanguage === 'zh' ? '硬件控制台' : 'HARDWARE CONTROL CENTER'}</p>
              <h2>{tr(uiLanguage, 'Control Center', '控制中心')}</h2>
            </div>
          </div>
          <div className="workspace-actions">
            <div className="workspace-utility" aria-label={tr(uiLanguage, 'Application utilities', '应用工具')}>
              <div className="language-toggle" role="group" aria-label={tr(uiLanguage, 'Language selector', '语言选择')}>
                <button type="button" className={uiLanguage === 'en' ? 'is-active' : ''} aria-pressed={uiLanguage === 'en'} onClick={() => setUiLanguage('en')}>EN</button>
                <button type="button" className={uiLanguage === 'zh' ? 'is-active' : ''} aria-pressed={uiLanguage === 'zh'} onClick={() => setUiLanguage('zh')}>中文</button>
              </div>
            </div>
          <div className="workspace-live-status">
            <span className={fanCtrl.running ? 'is-running' : ''}><i />{fanCtrl.running ? (uiLanguage === 'zh' ? 'EC 风扇接管中' : 'EC FAN CONTROL ACTIVE') : (uiLanguage === 'zh' ? 'EC 风扇由系统托管' : 'FANS SYSTEM-MANAGED')}</span>
              <span>
                {powerCtrl.powerSource === 'ac'
                  ? (uiLanguage === 'zh' ? '交流供电' : 'AC POWER')
                  : powerCtrl.powerSource === 'battery'
                    ? `${uiLanguage === 'zh' ? '电池供电' : 'BATTERY'}${powerCtrl.batteryPercent === null ? '' : ` ${powerCtrl.batteryPercent}%`}`
                    : (uiLanguage === 'zh' ? '电源未知' : 'POWER UNKNOWN')}
              </span>
          </div>
          </div>
        </header>

        <main className="workspace-content" id="workspace-main" tabIndex={-1}>
        {(activeTab === 'power' || activeTab === 'fan' || activeTab === 'performance') && (
          <PowerSection
            view={activeTab === 'power' ? 'overview' : activeTab}
            onNavigate={(view) => setActiveTab(view === 'overview' ? 'power' : view)}
            cpuTemp={fanCtrl.cpuTemp}
            gpuTemp={fanCtrl.gpuTemp}
            cpuFanRpm={fanCtrl.cpuFanRpm}
            gpuFanRpm={fanCtrl.gpuFanRpm}
            running={fanCtrl.running}
            toggleControl={handleToggleFanControl}
            fanControlBackend={appSettings.fan_control_backend}
            selectedScenario={fanCtrl.selectedScenario}
            onSelectFanScenario={handleFanScenarioSelect}
            constantSpeedEnabled={fanCtrl.constantSpeedEnabled}
            setConstantSpeedEnabled={fanCtrl.setConstantSpeedEnabled}
            constantSpeed={fanCtrl.constantSpeed}
            setConstantSpeed={fanCtrl.setConstantSpeed}
            cpuCurve={fanCtrl.cpuCurve}
            gpuCurve={fanCtrl.gpuCurve}
            setCpuCurve={fanCtrl.setCpuCurve}
            setGpuCurve={fanCtrl.setGpuCurve}
            saveFanConfig={fanCtrl.saveConfig}
            resetCurveToScenario={fanCtrl.resetCurveToScenario}
            fanBusy={fanCtrl.busy}
            cpuPowerSustainedW={powerCtrl.cpuPl1}
            cpuPowerBoostW={powerCtrl.cpuPl2}
            gpuPowerSustainedW={powerCtrl.gpuPl1}
            gpuPowerBoostW={powerCtrl.gpuPl2}
            systemPowerParameters={powerCtrl.systemPowerParameters}
            authorBridgeAvailable={vendorCtrl.displayBridgeAvailable}
            authorBridgeDetail={vendorCtrl.displayBridgeDetail}
            vendorServiceConnected={vendorCtrl.serviceConnected}
            authorPowerPreset={vendorCtrl.authorPowerPreset}
            authorReadback={vendorCtrl.authorReadback}
            authorPowerPlan={vendorCtrl.authorPowerPlan}
            authorBenchmarkEnabled={vendorCtrl.authorBenchmarkEnabled}
            authorBridgeBusy={vendorCtrl.busy}
            applyAuthorPowerProfile={vendorCtrl.applyAuthorPowerProfile}
            applyAuthorBenchmarkMode={vendorCtrl.applyAuthorBenchmarkMode}
            applyAuthorPowerPlan={vendorCtrl.applyAuthorPowerPlan}
            language={uiLanguage}
          />
        )}

        {activeTab === 'display' && (
          <DisplaySection
            currentHz={powerCtrl.currentHz}
            supportedHz={powerCtrl.supportedHz}
            displayDevices={powerCtrl.displayDevices}
            displayDetail={powerCtrl.displayDetail}
            vendorDisplayMode={vendorCtrl.displayMode}
            vendorServiceConnected={vendorCtrl.serviceConnected}
            displayBridgeAvailable={vendorCtrl.displayBridgeAvailable}
            displayBridgeDetail={vendorCtrl.displayBridgeDetail}
            lastRequestedDisplayMode={vendorCtrl.lastRequestedDisplayMode}
            lastDisplayModeVerified={vendorCtrl.lastDisplayModeVerified}
            busy={powerCtrl.busy || vendorCtrl.busy}
            language={uiLanguage}
            onApplyVisualScene={vendorCtrl.applyDisplayMode}
            onApplyHz={powerCtrl.applyDisplayHz}
          />
        )}

        {activeTab === 'monitor' && (
          <ThermalPageFrame>
            <MonitorSection
              cpuTemp={fanCtrl.cpuTemp}
              gpuTemp={fanCtrl.gpuTemp}
              summary={diagCtrl.summary}
              runSentinelTest={handleRunSentinelTest}
              language={uiLanguage}
            />
          </ThermalPageFrame>
        )}

        {activeTab === 'settings' && (
          <ThermalPageFrame>
            <SettingsSection
              settings={appSettings}
              autostartEnabled={autostartCtrl.autostartEnabled}
              autostartBusy={autostartCtrl.autostartBusy}
              setAutostartEnabled={autostartCtrl.setAutostartEnabled}
              startupTakeoverEnabled={fanCtrl.startupTakeoverEnabled}
              setStartupTakeoverEnabled={fanCtrl.setStartupTakeoverEnabled}
              timeThemeMode={fanCtrl.timeThemeMode}
              setTimeThemeMode={fanCtrl.setTimeThemeMode}
              currentKeyboardBrightness={vendorCtrl.keyboardBrightness}
              setKeyboardBrightness={vendorCtrl.setKeyboardBrightness}
              currentBatteryLevel={vendorCtrl.batteryLevel}
              setBatteryLevel={vendorCtrl.setBatteryLevel}
              applyBattery={vendorCtrl.applyBattery}
              keyboardEnabled={vendorCtrl.keyboardEnabled}
              applyKeyboardBasic={vendorCtrl.applyKeyboardBasic}
              authorBridgeAvailable={vendorCtrl.displayBridgeAvailable}
              authorReadback={vendorCtrl.authorReadback}
              busy={settingsBusy || vendorCtrl.busy || fanCtrl.busy}
              onChange={updateAppSettings}
              onReset={resetAppSettings}
              language={uiLanguage}
              setLanguage={setUiLanguage}
            />
          </ThermalPageFrame>
        )}
        </main>

        <footer className="workspace-footer">
          <span>NUCtool v{packageJson.version}</span>
          <span>{tr(uiLanguage, 'Local hardware control · Tauri', '本地硬件控制 · Tauri')}</span>
        </footer>
      </section>
    </div>
  );
};

export default App;
