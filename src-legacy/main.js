const tauriCore = window.__TAURI__?.core || {
  invoke: async (name, args) => {
    if (name === 'get_fan_control_snapshot') {
      return {
        running: false,
        active_mode: 'office',
        constant_mode: false,
        constant_speed: 60,
        cpu_power_limit_w: 45,
        cpu_power_short_w: 65,
        gpu_power_limit_w: 60,
        gpu_power_short_w: 80,
        dropped_samples: 0,
        sampled_at_ms: Date.now(),
      }
    }
    if (name === 'autostart_status' || name === 'autostart_set') return false
    if (name === 'get_current_fan_mode') return 'office'
    if (name === 'get_tdp') return [45, 65, 60, 80, 0]
    if (name === 'get_display_refresh_status') {
      return {
        current_hz: 60,
        supported_hz: [40, 60, 90, 120, 144, 165],
        device_count: 1,
        detail: 'mock display refresh status',
        devices: ['mock display 2560x1440 60Hz supported=[40,60,90,120,144,165]'],
      }
    }
    if (name === 'set_display_refresh_rate') {
      const hz = Math.round(Number(args?.hz || 60))
      return {
        current_hz: hz,
        supported_hz: [40, 60, 90, 120, 144, 165],
        device_count: 1,
        detail: 'mock refresh changed',
        devices: [`mock display 2560x1440 ${hz}Hz supported=[40,60,90,120,144,165]`],
      }
    }
    if (name === 'force_fan_sentinel_restart') {
      return '本地预览模式：哨兵强制测试已模拟完成。'
    }
    if (name === 'get_diagnostic_summary') {
      return {
        path: 'mock://diagnostic.log',
        size_bytes: 0,
        modified_ms: Date.now(),
        total_lines: 0,
        scanned_lines: 0,
        health: 'ok',
        summary: '本地预览模式，未连接 Tauri 诊断日志。',
        warning_count: 0,
        error_count: 0,
        invoke_failure_count: 0,
        invoke_timeout_count: 0,
        ui_drift_count: 0,
        watchdog_reload_count: 0,
        watchdog_event_count: 0,
        sentinel_event_count: 0,
        tdp_drift_count: 0,
        tdp_reapply_failed_count: 0,
        actor_hung_count: 0,
        vendor_failure_count: 0,
        hardware_busy_count: 0,
        recent_watchdog_events: [],
        recent_issues: [],
      }
    }
    if (name === 'set_tdp' || name === 'lock_tdp' || name === 'set_cpu_tdp' || name === 'lock_cpu_tdp' || name === 'apply_system_power_profile') return true
    if (name === 'frontend_heartbeat' || name === 'frontend_diag_log') return true
    if (name === 'get_vendor_service_status') {
      return {
        ok: false,
        detail: 'mock vendor service unavailable',
        data: {
          connected: false,
          packageFound: false,
          packagePath: null,
          sdkFound: false,
          sdkPath: null,
          sdkSource: null,
          processRunning: false,
          endpoint: 'ws://localhost:58594/UniwillService',
          currentState: null,
          features: [],
          errors: ['本地预览模式无法检测厂家服务'],
        },
      }
    }
    if (name === 'apply_vendor_whisper') {
      return {
        mode: 'Off',
        fps: 0,
        status: {
          ok: false,
          detail: 'mock vendor service unavailable',
          data: {
            whisper: { type: 'Off', fps: 0 },
          },
        },
      }
    }
    if (name === 'apply_vendor_battery') {
      return {
        mode: 'BestBattery',
        level: 80,
        status: {
          ok: false,
          detail: 'mock vendor service unavailable',
          data: {
            battery: { mode: 'BestBattery', chargingLevel: 80 },
          },
        },
      }
    }
    if (name === 'apply_vendor_lighting') {
      return {
        r: 255,
        g: 255,
        b: 255,
        keyboard_brightness: 30,
        lightbar_brightness: 0,
        status: {
          ok: false,
          detail: 'mock vendor service unavailable',
          data: {
            lighting: {
              keyboard: {
                effect: 'Monocolor',
                brightnessAc: 30,
                brightnessDc: 30,
                colors: [{ r: 255, g: 255, b: 255 }],
              },
              lightbar: {
                breathing: false,
                ac: { effect: 'Monocolor', r: 0, g: 0, b: 0 },
                dc: { effect: 'Monocolor', r: 0, g: 0, b: 0 },
              },
            },
          },
        },
      }
    }
    if (name === 'load_fan_config') return null
    return null
  },
}
const listen = window.__TAURI__?.event?.listen || (async () => () => {})

const BACKEND_TIMEOUT_MS = 4500
const POLL_TIMEOUT_MS = 1800
const CHART_UPDATE_INTERVAL_MS = 1800
const LOW_POWER_CHART_UPDATE_INTERVAL_MS = 5000
const DIAG_RECENT_STORAGE_KEY = 'nuctool.diagnostic.recent'
const DIAG_RECENT_LIMIT = 80
const FRONTEND_HEARTBEAT_INTERVAL_MS = 3000
const VENDOR_STATUS_TIMEOUT_MS = 10000
const VENDOR_STATUS_REFRESH_MS = 60000
const DIAGNOSTIC_TIMEOUT_MS = 6500
const DIAGNOSTIC_REFRESH_MS = 60000
const WHISPER_MODES = ['Off', 'Quieter', 'Quiet', 'Balanced']
const BATTERY_MODES = ['AcMode', 'BestBattery', 'Custom']
const NOISY_INVOKE_COMMANDS = new Set(['get_fan_control_snapshot', 'get_current_fan_mode', 'get_diagnostic_summary'])

let diagSeq = 0
let frontendHeartbeatSeq = 0
let frontendHeartbeatTimer = null

function safeError(error) {
  if (!error) return null
  const message = String(error.message || error)
  return {
    message: message.length > 700 ? `${message.slice(0, 700)}...` : message,
    stack: error.stack ? String(error.stack).slice(0, 1600) : null,
  }
}

function truncateText(value, limit = 240) {
  const text = String(value || '')
  return text.length > limit ? `${text.slice(0, limit)}...` : text
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function summarizeSystemPowerActions(actions) {
  const list = Array.isArray(actions) ? actions : []
  const failedActions = list
    .filter((action) => action && action.ok === false)
    .slice(0, 4)
    .map((action) => ({
      name: String(action.name || 'unknown'),
      detail: truncateText(action.detail, 180),
    }))

  return {
    actionCount: list.length,
    failedCount: failedActions.length,
    failedActions,
    failedActionNames: failedActions.map((action) => action.name),
  }
}

function diagState() {
  let appState = {}
  try {
    appState = {
      running: state.running,
      lowPowerMode: state.lowPowerMode,
      resumeRecovering: state.resumeRecovering,
      modePollInFlight: state.modePollInFlight,
      actorPollInFlight: state.actorPollInFlight,
      realtimeFramePending: state.realtimeFramePending,
      selectedScenario: state.selectedScenario,
      cpuPowerMode: state.cpuPowerMode,
    }
  } catch {
    appState = { ready: false }
  }

  return {
    hidden: !!document.hidden,
    visibility: document.visibilityState,
    hasFocus: typeof document.hasFocus === 'function' ? document.hasFocus() : null,
    ...appState,
  }
}

function rememberDiag(entry) {
  try {
    const recent = JSON.parse(localStorage.getItem(DIAG_RECENT_STORAGE_KEY) || '[]')
    recent.push(entry)
    while (recent.length > DIAG_RECENT_LIMIT) recent.shift()
    localStorage.setItem(DIAG_RECENT_STORAGE_KEY, JSON.stringify(recent))
  } catch {
    // ignore storage failure
  }
}

function shouldWriteDiag(entry) {
  if (entry.level === 'warn' || entry.level === 'error' || entry.level === 'info') return true
  if (entry.event === 'invoke.start' && NOISY_INVOKE_COMMANDS.has(entry.details?.command)) return false
  if (entry.event === 'invoke.done' && NOISY_INVOKE_COMMANDS.has(entry.details?.command)) {
    const elapsed = Number(entry.details?.elapsedMs || 0)
    return elapsed >= 150 || entry.seq % 60 === 0
  }
  return true
}

function diagLog(level, event, details = {}) {
  const entry = {
    ts: new Date().toISOString(),
    seq: ++diagSeq,
    level,
    event,
    details,
    state: diagState(),
  }
  const shouldWrite = shouldWriteDiag(entry)
  if (shouldWrite && level !== 'debug') {
    rememberDiag(entry)
  }

  const consoleMethod = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'
  try {
    if (level === 'debug') {
      // Debug logs still go to the file when sampled, but avoid noisy DevTools console pressure.
    } else {
      console[consoleMethod]('[NUCtool diag]', entry)
    }
  } catch {
    // ignore console failure
  }

  if (!shouldWrite) return

  try {
    tauriCore.invoke('frontend_diag_log', {
      level,
      event,
      details: JSON.stringify(entry),
    }).catch(() => {})
  } catch {
    // ignore backend logging failure
  }
}

function sendFrontendHeartbeat(reason = 'interval') {
  frontendHeartbeatSeq += 1
  try {
    tauriCore.invoke('frontend_heartbeat', {
      seq: frontendHeartbeatSeq,
      visible: !document.hidden,
      focused: typeof document.hasFocus === 'function' ? document.hasFocus() : false,
      running: !!state?.running,
      reason,
    }).catch(() => {})
  } catch {
    // ignore heartbeat failure
  }
}

function startFrontendHeartbeat() {
  if (frontendHeartbeatTimer) return
  sendFrontendHeartbeat('start')
  frontendHeartbeatTimer = window.setInterval(() => {
    sendFrontendHeartbeat('interval')
  }, FRONTEND_HEARTBEAT_INTERVAL_MS)
}

const SCENARIOS = {
  silent: {
    mode: 'silent',
    label: '静音',
    tags: ['噪音倾向: 低', '散热倾向: 中'],
    ramp: 2,
    hysteresis: 8,
    cpuCap: 35,
    gpuCap: 30,
    cpuCurve: [20, 20, 22, 24, 27, 30, 32, 34, 35, 35, 35],
    gpuCurve: [18, 18, 20, 22, 24, 26, 28, 29, 30, 30, 30],
  },
  office: {
    mode: 'office',
    label: '办公',
    tags: ['噪音倾向: 中低', '散热倾向: 中高'],
    ramp: 3,
    hysteresis: 5,
    cpuCap: 55,
    gpuCap: 45,
    cpuCurve: [20, 22, 24, 28, 32, 38, 44, 49, 53, 55, 55],
    gpuCurve: [18, 20, 22, 26, 30, 34, 38, 41, 44, 45, 45],
  },
  gaming: {
    mode: 'gaming',
    label: '游戏',
    tags: ['噪音倾向: 中高', '散热倾向: 高'],
    ramp: 5,
    hysteresis: 3,
    cpuCap: 80,
    gpuCap: 90,
    cpuCurve: [25, 28, 33, 40, 48, 56, 64, 71, 76, 79, 80],
    gpuCurve: [28, 32, 40, 50, 60, 70, 78, 84, 88, 90, 90],
  },
  performance: {
    mode: 'performance',
    label: '性能',
    tags: ['噪音倾向: 高', '散热倾向: 极高'],
    ramp: 8,
    hysteresis: 2,
    cpuCap: 100,
    gpuCap: 100,
    cpuCurve: [35, 40, 48, 58, 68, 76, 84, 90, 95, 98, 100],
    gpuCurve: [35, 42, 52, 62, 72, 82, 90, 95, 98, 100, 100],
  },
  benchmark: {
    mode: 'benchmark',
    label: '基准',
    tags: ['噪音倾向: 极高', '散热倾向: 压测'],
    ramp: 12,
    hysteresis: 1,
    cpuCap: 100,
    gpuCap: 100,
    cpuCurve: [45, 55, 65, 76, 86, 94, 100, 100, 100, 100, 100],
    gpuCurve: [45, 58, 70, 82, 92, 100, 100, 100, 100, 100, 100],
  },
}

const CURVE_TEMPS = [35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85]
const HISTORY_POINTS = 21
const MONITOR_MODE_STORAGE_KEY = 'nuctool.monitorModeOnStartup'
const CPU_POWER_STORAGE_KEY = 'nuctool.cpuPowerMode'
const LIGHTING_STORAGE_KEY = 'nuctool.lightingPreference'
const DISPLAY_REFRESH_STORAGE_KEY = 'nuctool.displayRefreshHz'
const TDP_TIMEOUT_MS = 11000
const SYSTEM_POWER_TIMEOUT_MS = 20000
const DISPLAY_REFRESH_TIMEOUT_MS = 10000
const DISPLAY_REFRESH_SETTLE_MS = 2500
const RESUME_RECOVERY_COOLDOWN_MS = 10000
const RESUME_TDP_REFRESH_INTERVAL_MS = 30000
const FOCUS_EVENT_COOLDOWN_MS = 8000
const RESUME_SKIP_LOG_INTERVAL_MS = 8000
const HARD_RECOVERY_COOLDOWN_MS = 30000
const HARD_RECOVERY_DRIFT_MS = 30000
const FAN_ZERO_RECOVERY_TEMP = 60
const FAN_ZERO_RECOVERY_STRIKES = 2
const TDP_DRIFT_RECOVERY_STRIKES = 2
const CPU_POWER_PROFILES = {
  performance: {
    label: '最佳性能',
    cpu1: 55,
    cpu2: 80,
    gpu1: 80,
    gpu2: 105,
    gpuClock: '最高/恢复',
    refresh: '不自动切换刷新率',
    boost: 'Aggressive',
    scheme: '最佳性能',
    desc: '游戏、渲染、编译等重负载，设置 Windows 最佳性能和积极 Boost；刷新率不自动切换，避免屏幕重置造成卡顿。',
  },
  balanced: {
    label: '平衡',
    cpu1: 45,
    cpu2: 65,
    gpu1: 60,
    gpu2: 80,
    gpuClock: '约 1200MHz',
    refresh: '不自动切换刷新率',
    boost: 'Efficient',
    scheme: '平衡',
    desc: '网页、视频、办公推荐，匹配官方 Balanced 档的 CPU 45W/65W，避免与官方控件反复抢写。',
  },
  powersave: {
    label: '最佳能效',
    cpu1: 25,
    cpu2: 38,
    gpu1: 40,
    gpu2: 55,
    gpuClock: '约 900MHz / 核显优先',
    refresh: '不自动切换刷新率',
    boost: 'Disabled',
    scheme: '最佳能效',
    desc: '强省电：设置 Windows 最佳能效，限制 CPU 并关闭 Boost；刷新率保持当前值，避免切屏时像卡死。',
  },
}

const SCENARIO_THEMES = {
  silent: {
    accent: '#38bdf8',
    accent2: '#2563eb',
    warm: '#67e8f9',
    rgb: '56, 189, 248',
    rgb2: '37, 99, 235',
    cpuTemp: '#e0f7ff',
    gpuTemp: '#38bdf8',
    cpuFan: '#67e8f9',
    gpuFan: '#2563eb',
    tempFill: 'rgba(56, 189, 248, 0.10)',
    gpuFill: 'rgba(37, 99, 235, 0.10)',
    fanFill: 'rgba(103, 232, 249, 0.07)',
    gpuFanFill: 'rgba(37, 99, 235, 0.07)',
    axis: 'rgba(224, 247, 255, 0.72)',
    grid: 'rgba(56, 189, 248, 0.14)',
  },
  office: {
    accent: '#2dd4bf',
    accent2: '#22c55e',
    warm: '#84cc16',
    rgb: '45, 212, 191',
    rgb2: '34, 197, 94',
    cpuTemp: '#ffffff',
    gpuTemp: '#2dd4bf',
    cpuFan: '#84cc16',
    gpuFan: '#22c55e',
    tempFill: 'rgba(45, 212, 191, 0.10)',
    gpuFill: 'rgba(34, 197, 94, 0.10)',
    fanFill: 'rgba(132, 204, 22, 0.07)',
    gpuFanFill: 'rgba(34, 197, 94, 0.07)',
    axis: 'rgba(223, 252, 247, 0.72)',
    grid: 'rgba(45, 212, 191, 0.14)',
  },
  gaming: {
    accent: '#f97316',
    accent2: '#dc2626',
    warm: '#f59e0b',
    rgb: '249, 115, 22',
    rgb2: '220, 38, 38',
    cpuTemp: '#fff7ed',
    gpuTemp: '#f97316',
    cpuFan: '#f59e0b',
    gpuFan: '#dc2626',
    tempFill: 'rgba(249, 115, 22, 0.10)',
    gpuFill: 'rgba(220, 38, 38, 0.10)',
    fanFill: 'rgba(245, 158, 11, 0.07)',
    gpuFanFill: 'rgba(220, 38, 38, 0.07)',
    axis: 'rgba(255, 241, 223, 0.72)',
    grid: 'rgba(249, 115, 22, 0.14)',
  },
  performance: {
    accent: '#e50914',
    accent2: '#7f1d1d',
    warm: '#ff4d57',
    rgb: '229, 9, 20',
    rgb2: '127, 29, 29',
    cpuTemp: '#ffffff',
    gpuTemp: '#e50914',
    cpuFan: '#ff4d57',
    gpuFan: '#9b111e',
    tempFill: 'rgba(229, 9, 20, 0.10)',
    gpuFill: 'rgba(127, 29, 29, 0.12)',
    fanFill: 'rgba(255, 77, 87, 0.07)',
    gpuFanFill: 'rgba(155, 17, 30, 0.07)',
    axis: 'rgba(255, 229, 231, 0.72)',
    grid: 'rgba(229, 9, 20, 0.14)',
  },
  benchmark: {
    accent: '#facc15',
    accent2: '#ef4444',
    warm: '#fb7185',
    rgb: '250, 204, 21',
    rgb2: '239, 68, 68',
    cpuTemp: '#fff7cc',
    gpuTemp: '#facc15',
    cpuFan: '#fb7185',
    gpuFan: '#ef4444',
    tempFill: 'rgba(250, 204, 21, 0.10)',
    gpuFill: 'rgba(239, 68, 68, 0.11)',
    fanFill: 'rgba(251, 113, 133, 0.07)',
    gpuFanFill: 'rgba(239, 68, 68, 0.08)',
    axis: 'rgba(255, 247, 204, 0.74)',
    grid: 'rgba(250, 204, 21, 0.16)',
  },
}

function getScenarioTheme(name = state.selectedScenario) {
  return SCENARIO_THEMES[name] || SCENARIO_THEMES.office
}

const state = {
  running: false,
  selectedScenario: 'office',
  trendChart: null,
  modePoller: null,
  actorPoller: null,
  vendorPoller: null,
  diagnosticPoller: null,
  uiHealthPoller: null,
  realtimeUnlisten: null,
  latestRealtime: null,
  realtimeFramePending: false,
  chartLastUpdateAt: 0,
  lowPowerMode: false,
  modePollInFlight: false,
  actorPollInFlight: false,
  vendorPollInFlight: false,
  vendorWriteBusy: false,
  vendorWhisperBusy: false,
  vendorBatteryBusy: false,
  vendorLightingBusy: false,
  vendorStatusCheckedAt: 0,
  sentinelTestBusy: false,
  scenarioRuntimeInFlight: false,
  scenarioRuntimeQueued: false,
  hardRecovering: false,
  resumeRecovering: false,
  lastResumeRecoverAt: 0,
  lastHardRecoverAt: 0,
  lastResumeSkipLogAt: 0,
  lastFocusEventAt: 0,
  lastCpuPowerRefreshAt: 0,
  cpuFanZeroStrikes: 0,
  gpuFanZeroStrikes: 0,
  tdpDriftStrikes: 0,
  monitorMode: false,
  autostartEnabled: false,
  startupTakeoverEnabled: false,
  constantSpeedEnabled: false,
  constantSpeed: 60,
  cpuPowerMode: 'balanced',
  cpuPowerBusy: false,
  cpuPowerApplySeq: 0,
  systemPowerProfileBusy: false,
  pendingSystemPowerProfile: null,
  displayRefreshBusy: false,
  displayRefreshRefreshTimer: null,
  displayRefreshStatus: null,
  selectedDisplayRefreshHz: null,
  tdpReadPromise: null,
  lastTdp: null,
  vendorStatus: null,
  diagnosticSummary: null,
  lightingPreferenceLoaded: false,
  whisperMode: 'Off',
  whisperFps: 0,
  batteryMode: 'BestBattery',
  batteryLevel: 80,
  lightingColor: '#ffffff',
  keyboardBrightness: 30,
  lightbarBrightness: 0,
}

function byId(id) {
  return document.getElementById(id)
}

function clamp(v, min, max) {
  const n = Number(v)
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

function setText(id, text) {
  const el = byId(id)
  if (el) el.textContent = text
}

function formatPowerPair(limit, shortLimit) {
  const pl1 = Number(limit)
  const pl2 = Number(shortLimit)
  if (Number.isFinite(pl1) && pl1 > 0 && Number.isFinite(pl2) && pl2 > 0) {
    return `${Math.round(pl1)}W / ${Math.round(pl2)}W`
  }
  if (Number.isFinite(pl1) && pl1 > 0) return `${Math.round(pl1)}W`
  return '--'
}

function setDot(id, dotState) {
  const el = byId(id)
  if (el) el.setAttribute('data-state', dotState)
}

function updateTrendChartTheme(theme = getScenarioTheme()) {
  if (!state.trendChart) return

  const datasets = state.trendChart.data.datasets
  if (datasets[0]) {
    datasets[0].borderColor = theme.cpuTemp
    datasets[0].backgroundColor = theme.tempFill
  }
  if (datasets[1]) {
    datasets[1].borderColor = theme.gpuTemp
    datasets[1].backgroundColor = theme.gpuFill
  }
  if (datasets[2]) {
    datasets[2].borderColor = theme.cpuFan
    datasets[2].backgroundColor = theme.fanFill
  }
  if (datasets[3]) {
    datasets[3].borderColor = theme.gpuFan
    datasets[3].backgroundColor = theme.gpuFanFill
  }

  const options = state.trendChart.options
  if (options.plugins?.legend?.labels) {
    options.plugins.legend.labels.color = theme.axis
  }
  if (options.scales?.x) {
    options.scales.x.ticks.color = theme.axis
    options.scales.x.grid.color = theme.grid
  }
  if (options.scales?.temp) {
    options.scales.temp.title.color = theme.axis
    options.scales.temp.ticks.color = theme.axis
    options.scales.temp.grid.color = theme.grid
  }
  if (options.scales?.rpm) {
    options.scales.rpm.title.color = theme.axis
    options.scales.rpm.ticks.color = theme.axis
  }
  state.trendChart.update('none')
}

function applyScenarioTheme(name = state.selectedScenario) {
  const scenario = SCENARIOS[name] ? name : 'office'
  const theme = getScenarioTheme(scenario)
  document.body.dataset.scenario = scenario
  document.documentElement.style.setProperty('--scene-accent', theme.accent)
  document.documentElement.style.setProperty('--scene-accent-2', theme.accent2)
  document.documentElement.style.setProperty('--scene-warm', theme.warm)
  document.documentElement.style.setProperty('--scene-rgb', theme.rgb)
  document.documentElement.style.setProperty('--scene-rgb-2', theme.rgb2)
  updateTrendChartTheme(theme)
}

function summarizeInvokeValue(value, command = '') {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.length <= 8 ? value : { type: 'array', length: value.length }

  if (command === 'get_diagnostic_summary') {
    return {
      health: value.health,
      warning_count: value.warning_count,
      error_count: value.error_count,
      invoke_failure_count: value.invoke_failure_count,
      invoke_timeout_count: value.invoke_timeout_count,
      ui_drift_count: value.ui_drift_count,
      watchdog_reload_count: value.watchdog_reload_count,
      watchdog_event_count: value.watchdog_event_count,
      sentinel_event_count: value.sentinel_event_count,
      tdp_drift_count: value.tdp_drift_count,
      tdp_reapply_failed_count: value.tdp_reapply_failed_count,
      actor_hung_count: value.actor_hung_count,
      vendor_failure_count: value.vendor_failure_count,
      hardware_busy_count: value.hardware_busy_count,
      scanned_lines: value.scanned_lines,
      total_lines: value.total_lines,
      size_bytes: value.size_bytes,
      recent_issue_count: Array.isArray(value.recent_issues) ? value.recent_issues.length : 0,
    }
  }

  if (typeof value.mode === 'string' && Array.isArray(value.actions)) {
    return {
      mode: value.mode,
      ...summarizeSystemPowerActions(value.actions),
    }
  }

  if ('ok' in value && 'detail' in value && 'data' in value) {
    const data = value.data || {}
    return {
      ok: !!value.ok,
      detail: truncateText(value.detail, 240),
      connected: !!data.connected,
      processRunning: !!data.processRunning,
      packageFound: !!data.packageFound,
      sdkFound: !!data.sdkFound,
      selectedProfile: data.currentState?.selectedProfile || null,
      batteryMode: data.battery?.mode || null,
      whisperType: data.whisper?.type || null,
      errors: Array.isArray(data.errors) ? data.errors.slice(0, 3).map((entry) => truncateText(entry, 120)) : [],
    }
  }

  if (value.status && typeof value.status === 'object') {
    return {
      ...value,
      status: summarizeInvokeValue(value.status),
    }
  }

  return value
}

function summarizeInvokeArgs(args) {
  if (!args || typeof args !== 'object') return args
  if (args.fanData) {
    const control = args.fanData.control || {}
    return {
      fanData: {
        mode: control.mode,
        preset: control.preset,
        control_mode: control.control_mode,
        constant_speed_enabled: !!control.constant_speed_enabled,
        constant_speed: control.constant_speed,
        sample_interval_ms: args.fanData.monitor?.sample_interval_ms,
      },
    }
  }
  return args
}

function invokeBackend(command, args, timeoutMs = BACKEND_TIMEOUT_MS) {
  const callId = `${command}#${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`
  const started = performance.now()
  diagLog('debug', 'invoke.start', { callId, command, timeoutMs, args: summarizeInvokeArgs(args) })
  let timeoutId = null
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      diagLog('warn', 'invoke.timeout', {
        callId,
        command,
        timeoutMs,
        elapsedMs: Math.round(performance.now() - started),
      })
      reject(new Error(`${command} timeout after ${timeoutMs}ms`))
    }, timeoutMs)
  })

  return Promise.race([tauriCore.invoke(command, args), timeout])
    .then((result) => {
      diagLog('debug', 'invoke.done', {
        callId,
        command,
        elapsedMs: Math.round(performance.now() - started),
        result: summarizeInvokeValue(result, command),
      })
      return result
    })
    .catch((error) => {
      diagLog('warn', 'invoke.failed', {
        callId,
        command,
        elapsedMs: Math.round(performance.now() - started),
        error: safeError(error),
      })
      throw error
    })
    .finally(() => {
      if (timeoutId !== null) window.clearTimeout(timeoutId)
    })
}

function showToast(message) {
  const stack = byId('toastStack') || createToastStack()
  const toast = document.createElement('div')
  toast.className = 'toast'
  toast.textContent = String(message || '')
  stack.appendChild(toast)

  window.setTimeout(() => {
    toast.classList.add('leaving')
    window.setTimeout(() => toast.remove(), 220)
  }, 3200)
}

function createToastStack() {
  const stack = document.createElement('div')
  stack.id = 'toastStack'
  stack.className = 'toast-stack'
  document.body.appendChild(stack)
  return stack
}

function parseMonitorModeFromQuery() {
  const params = new URLSearchParams(window.location.search)
  const raw = params.get('monitor')
  if (!raw) return null

  const normalized = raw.trim().toLowerCase()
  if (['1', 'true', 'on', 'yes', 'full', 'fullscreen'].includes(normalized)) {
    return true
  }
  if (['0', 'false', 'off', 'no'].includes(normalized)) {
    return false
  }
  return null
}

function readMonitorModePreference() {
  const fromQuery = parseMonitorModeFromQuery()
  if (fromQuery !== null) {
    return fromQuery
  }
  try {
    const stored = localStorage.getItem(MONITOR_MODE_STORAGE_KEY)
    if (stored === '1') return true
    if (stored === '0') return false
  } catch {
    // ignore storage failure
  }
  return false
}

function persistMonitorModePreference(enabled) {
  try {
    localStorage.setItem(MONITOR_MODE_STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    // ignore storage failure
  }
}

function readCpuPowerPreference() {
  try {
    const stored = localStorage.getItem(CPU_POWER_STORAGE_KEY)
    if (CPU_POWER_PROFILES[stored]) return stored
  } catch {
    // ignore storage failure
  }
  return 'balanced'
}

function persistCpuPowerPreference(mode) {
  try {
    localStorage.setItem(CPU_POWER_STORAGE_KEY, mode)
  } catch {
    // ignore storage failure
  }
}

function readDisplayRefreshPreference() {
  try {
    const stored = Number(localStorage.getItem(DISPLAY_REFRESH_STORAGE_KEY))
    if (Number.isFinite(stored) && stored >= 24 && stored <= 500) return Math.round(stored)
  } catch {
    // ignore storage failure
  }
  return null
}

function persistDisplayRefreshPreference(hz) {
  try {
    if (Number.isFinite(hz) && hz > 0) {
      localStorage.setItem(DISPLAY_REFRESH_STORAGE_KEY, String(Math.round(hz)))
    }
  } catch {
    // ignore storage failure
  }
}

function normalizeTdp(raw) {
  const list = Array.isArray(raw) ? raw : [0, 0, 0, 0, 0]
  return {
    cpu1: clamp(list[0], 0, 120),
    cpu2: clamp(list[1], 0, 140),
    gpu1: clamp(list[2], 0, 160),
    gpu2: clamp(list[3], 0, 180),
    tcc: clamp(list[4], 0, 120),
  }
}

function closestCpuPowerMode(tdp) {
  let bestMode = 'balanced'
  let bestDistance = Number.POSITIVE_INFINITY

  Object.entries(CPU_POWER_PROFILES).forEach(([mode, profile]) => {
    const distance = Math.abs(tdp.cpu1 - profile.cpu1) + Math.abs(tdp.cpu2 - profile.cpu2)
    if (distance < bestDistance) {
      bestMode = mode
      bestDistance = distance
    }
  })

  return bestDistance <= 10 ? bestMode : null
}

function tdpDiffersFromProfile(tdp, profile) {
  if (!tdp || !profile) return false
  const cpuReadable = tdp.cpu1 > 0 && tdp.cpu2 > 0
  const gpuReadable = tdp.gpu1 > 0 && tdp.gpu2 > 0 && profile.gpu1 > 0 && profile.gpu2 > 0
  const cpuDiffers = cpuReadable && (tdp.cpu1 !== profile.cpu1 || tdp.cpu2 !== profile.cpu2)
  const gpuDiffers = gpuReadable && (tdp.gpu1 !== profile.gpu1 || tdp.gpu2 !== profile.gpu2)
  return cpuDiffers || gpuDiffers
}

function recordTdpDriftIfNeeded(tdp) {
  const profile = CPU_POWER_PROFILES[state.cpuPowerMode] || CPU_POWER_PROFILES.balanced
  if (!tdpDiffersFromProfile(tdp, profile)) {
    state.tdpDriftStrikes = 0
    return
  }

  state.tdpDriftStrikes += 1
  const detail = {
    strikes: state.tdpDriftStrikes,
    mode: state.cpuPowerMode,
    want: {
      cpu1: profile.cpu1,
      cpu2: profile.cpu2,
      gpu1: profile.gpu1,
      gpu2: profile.gpu2,
    },
    got: {
      cpu1: tdp.cpu1,
      cpu2: tdp.cpu2,
      gpu1: tdp.gpu1,
      gpu2: tdp.gpu2,
    },
  }
  diagLog('warn', 'power.tdp_external_drift', detail)

  if (state.tdpDriftStrikes === TDP_DRIFT_RECOVERY_STRIKES) {
    queueHardRecovery('tdp_external_drift', detail)
  }
}

function setCpuPowerBusy(busy) {
  state.cpuPowerBusy = busy
  document.querySelectorAll('.power-btn').forEach((btn) => {
    btn.disabled = busy
  })
  const refreshButton = byId('refreshPowerButton')
  if (refreshButton) refreshButton.disabled = busy
}

function syncCpuPowerUI() {
  const profile = CPU_POWER_PROFILES[state.cpuPowerMode] || CPU_POWER_PROFILES.balanced

  document.querySelectorAll('.power-btn').forEach((btn) => {
    const active = btn.getAttribute('data-power-mode') === state.cpuPowerMode
    btn.classList.toggle('active', active)
  })

  setText('cpuPowerModeValue', profile.label)
  setText('cpuPowerPl1Value', `${profile.cpu1}W`)
  setText('cpuPowerPl2Value', `${profile.cpu2}W`)
  setText('gpuClockLimitValue', `${profile.refresh} / ${profile.boost}`)
  setText('cpuPowerHint', profile.desc)

  if (state.lastTdp) {
    const gpuInfo = state.lastTdp.gpu1 ? ` | GPU: ${state.lastTdp.gpu1}W` : ''
    setText('cpuPowerCurrentValue', `${state.lastTdp.cpu1}W / ${state.lastTdp.cpu2}W${gpuInfo}`)
    setText('cpuPowerValue', formatPowerPair(state.lastTdp.cpu1, state.lastTdp.cpu2))
    setText('gpuPowerValue', formatPowerPair(state.lastTdp.gpu1, state.lastTdp.gpu2))
  } else {
    setText('cpuPowerCurrentValue', '--')
  }
}

function normalizeDisplayRefreshStatus(raw) {
  const supported = Array.isArray(raw?.supported_hz)
    ? raw.supported_hz
      .map((hz) => Math.round(Number(hz)))
      .filter((hz) => Number.isFinite(hz) && hz >= 24 && hz <= 500)
    : []
  supported.sort((a, b) => a - b)
  const uniqueSupported = [...new Set(supported)]
  const current = Math.round(Number(raw?.current_hz || 0))
  return {
    currentHz: Number.isFinite(current) && current > 0 ? current : null,
    supportedHz: uniqueSupported,
    deviceCount: Math.max(0, Math.round(Number(raw?.device_count || 0))),
    detail: truncateText(raw?.detail || '', 180),
    devices: Array.isArray(raw?.devices) ? raw.devices.map((entry) => truncateText(entry, 180)) : [],
  }
}

function setDisplayRefreshBusy(busy) {
  state.displayRefreshBusy = busy
  const select = byId('displayRefreshSelect')
  const applyButton = byId('applyDisplayRefreshButton')
  const refreshButton = byId('refreshDisplayRefreshButton')
  if (select) select.disabled = busy
  if (applyButton) applyButton.disabled = busy || !state.selectedDisplayRefreshHz
  if (refreshButton) refreshButton.disabled = busy
}

function syncDisplayRefreshUI() {
  const status = state.displayRefreshStatus
  const select = byId('displayRefreshSelect')
  const currentText = status?.currentHz ? `${status.currentHz}Hz` : '--'
  const supportedText = status?.supportedHz?.length ? status.supportedHz.map((hz) => `${hz}`).join(' / ') : '--'

  setText('displayRefreshCurrentValue', currentText)
  setText('displayRefreshSupportedValue', supportedText)
  setText(
    'displayRefreshHint',
    status?.supportedHz?.length
      ? `检测到 ${status.deviceCount || 1} 个显示设备。刷新率只会在你点击应用时修改。`
      : '点击刷新读取当前屏幕支持的刷新率。',
  )

  if (select) {
    const rates = status?.supportedHz || []
    const optionKey = rates.join(',')
    if (select.dataset.options !== optionKey) {
      select.textContent = ''
      if (!rates.length) {
        const option = document.createElement('option')
        option.value = ''
        option.textContent = '未检测到'
        select.appendChild(option)
      } else {
        rates.forEach((hz) => {
          const option = document.createElement('option')
          option.value = String(hz)
          option.textContent = `${hz}Hz`
          select.appendChild(option)
        })
      }
      select.dataset.options = optionKey
    }

    const preferred = state.selectedDisplayRefreshHz || readDisplayRefreshPreference() || status?.currentHz
    const selected = rates.includes(preferred) ? preferred : rates.includes(status?.currentHz) ? status.currentHz : rates[0]
    state.selectedDisplayRefreshHz = selected || null
    select.value = selected ? String(selected) : ''
  }

  setDisplayRefreshBusy(state.displayRefreshBusy)
}

async function refreshDisplayRefreshStatus(options = {}) {
  if (state.displayRefreshBusy) return state.displayRefreshStatus
  setDisplayRefreshBusy(true)
  try {
    const raw = await invokeBackend('get_display_refresh_status', undefined, DISPLAY_REFRESH_TIMEOUT_MS)
    state.displayRefreshStatus = normalizeDisplayRefreshStatus(raw)
    syncDisplayRefreshUI()
    if (!options.silent) {
      showToast(`刷新率状态：当前 ${state.displayRefreshStatus.currentHz || '--'}Hz`)
    }
    return state.displayRefreshStatus
  } catch (error) {
    diagLog('warn', 'display.refresh_status.failed', { error: safeError(error), silent: !!options.silent })
    if (!options.silent) {
      showToast(`读取刷新率失败\n${error}`)
    }
    syncDisplayRefreshUI()
    return null
  } finally {
    setDisplayRefreshBusy(false)
  }
}

function scheduleDisplayRefreshStatusRefresh() {
  if (state.displayRefreshRefreshTimer) {
    window.clearTimeout(state.displayRefreshRefreshTimer)
  }
  state.displayRefreshRefreshTimer = window.setTimeout(() => {
    state.displayRefreshRefreshTimer = null
    refreshDisplayRefreshStatus({ silent: true })
  }, DISPLAY_REFRESH_SETTLE_MS)
}

async function applyDisplayRefreshRate() {
  const hz = Math.round(Number(state.selectedDisplayRefreshHz || byId('displayRefreshSelect')?.value || 0))
  if (!Number.isFinite(hz) || hz <= 0 || state.displayRefreshBusy) return

  setDisplayRefreshBusy(true)
  try {
    const raw = await invokeBackend('set_display_refresh_rate', { hz }, DISPLAY_REFRESH_TIMEOUT_MS)
    state.displayRefreshStatus = normalizeDisplayRefreshStatus(raw)
    state.selectedDisplayRefreshHz = hz
    persistDisplayRefreshPreference(hz)
    syncDisplayRefreshUI()
    showToast(`刷新率已设置为 ${state.displayRefreshStatus.currentHz || hz}Hz`)
    scheduleDisplayRefreshStatusRefresh()
  } catch (error) {
    diagLog('warn', 'display.refresh_apply.failed', { hz, error: safeError(error) })
    showToast(`设置刷新率失败\n${error}`)
  } finally {
    setDisplayRefreshBusy(false)
  }
}

function readCpuPowerTdp() {
  if (state.tdpReadPromise) return state.tdpReadPromise
  state.tdpReadPromise = invokeBackend('get_tdp', undefined, TDP_TIMEOUT_MS)
    .then((raw) => normalizeTdp(raw))
    .finally(() => {
      state.tdpReadPromise = null
    })
  return state.tdpReadPromise
}

function tdpPayloadForProfile(profile, tcc = 0) {
  return {
    cpu1: profile.cpu1,
    cpu2: profile.cpu2,
    gpu1: profile.gpu1,
    gpu2: profile.gpu2,
    tcc: clamp(tcc, 0, 120),
  }
}

async function lockCpuPowerProfile(mode, profile, tcc, reason) {
  const applied = await invokeBackend('lock_tdp', {
    t: tdpPayloadForProfile(profile, tcc),
  }, TDP_TIMEOUT_MS)

  if (applied !== true) {
    throw new Error('硬件读回校验未通过（CPU 功耗未能锁定），请尝试以管理员权限运行或检查是否被 BIOS 限制。')
  }

  diagLog('info', 'power.tdp_locked', {
    mode,
    reason,
    cpu1: profile.cpu1,
    cpu2: profile.cpu2,
    gpu1: profile.gpu1,
    gpu2: profile.gpu2,
    tcc,
  })

  return tdpPayloadForProfile(profile, tcc)
}

async function refreshCpuPowerMode(options = {}) {
  if (state.cpuPowerBusy) {
    diagLog('debug', 'power.refresh.skipped_busy', { mode: state.cpuPowerMode })
    syncCpuPowerUI()
    return state.lastTdp
  }

  try {
    const tdp = await readCpuPowerTdp()
    state.lastTdp = tdp
    state.lastCpuPowerRefreshAt = performance.now()
    recordTdpDriftIfNeeded(tdp)
    syncCpuPowerUI()
    return tdp
  } catch (error) {
    syncCpuPowerUI()
    diagLog('warn', 'power.refresh.failed', { error: safeError(error), silent: !!options.silent })
    if (!options.silent) {
      showToast(`读取 CPU 功耗失败\n${error}`)
    }
    return null
  }
}

function queueSystemPowerProfile(mode, options = {}) {
  if (options.skipSystemProfile) return

  const token = state.cpuPowerApplySeq
  state.pendingSystemPowerProfile = {
    mode,
    token,
    silent: !!options.silent,
  }
  diagLog('info', 'power.system_profile.queued', { mode, token })

  window.setTimeout(() => {
    runSystemPowerProfileQueue()
  }, 0)
}

async function runSystemPowerProfileQueue() {
  if (state.systemPowerProfileBusy) return
  state.systemPowerProfileBusy = true

  try {
    while (state.pendingSystemPowerProfile) {
      const job = state.pendingSystemPowerProfile
      state.pendingSystemPowerProfile = null
      await applySystemPowerProfileJob(job)
    }
  } finally {
    state.systemPowerProfileBusy = false
  }
}

async function applySystemPowerProfileJob(job) {
  const mode = job?.mode
  const profile = CPU_POWER_PROFILES[mode]
  if (!profile) return

  if (job.token !== state.cpuPowerApplySeq || state.cpuPowerMode !== mode) {
    diagLog('debug', 'power.system_profile.skipped_stale', {
      mode,
      token: job.token,
      currentToken: state.cpuPowerApplySeq,
      currentMode: state.cpuPowerMode,
    })
    return
  }

  let failedSystemActions = []
  try {
    const systemApplied = await invokeBackend('apply_system_power_profile', { mode }, SYSTEM_POWER_TIMEOUT_MS)
    const systemSummary = summarizeSystemPowerActions(systemApplied?.actions)
    failedSystemActions = systemSummary.failedActions
    diagLog('info', 'power.system_profile.applied', {
      mode,
      token: job.token,
      actionCount: systemSummary.actionCount,
      failedCount: systemSummary.failedCount,
      failedActions: systemSummary.failedActions,
    })
  } catch (systemError) {
    failedSystemActions = [{ name: 'system.profile', detail: String(systemError) }]
    diagLog('warn', 'power.system_profile.failed', { mode, token: job.token, error: safeError(systemError) })
  }

  if (job.token !== state.cpuPowerApplySeq || state.cpuPowerMode !== mode) {
    diagLog('debug', 'power.system_profile.relock_skipped_stale', {
      mode,
      token: job.token,
      currentToken: state.cpuPowerApplySeq,
      currentMode: state.cpuPowerMode,
    })
    return
  }

  try {
    const tcc = state.lastTdp?.tcc ?? 0
    const lockedTdp = await lockCpuPowerProfile(mode, profile, tcc, 'background-after-system-profile')
    if (job.token === state.cpuPowerApplySeq && state.cpuPowerMode === mode) {
      state.lastTdp = lockedTdp
      state.lastCpuPowerRefreshAt = performance.now()
      state.tdpDriftStrikes = 0
      syncCpuPowerUI()
    }
  } catch (error) {
    diagLog('warn', 'power.system_profile.relock_failed', { mode, token: job.token, error: safeError(error) })
    if (!job.silent && job.token === state.cpuPowerApplySeq && state.cpuPowerMode === mode) {
      showToast(`系统方案已后台处理，但复锁功耗失败\n${error}`)
    }
    return
  }

  if (!job.silent && failedSystemActions.length && job.token === state.cpuPowerApplySeq && state.cpuPowerMode === mode) {
    showToast(`功耗已锁定；部分系统动作后台未完成：${failedSystemActions.map((action) => action.name).join('、')}`)
  }
}

async function applyCpuPowerMode(mode, options = {}) {
  const profile = CPU_POWER_PROFILES[mode]
  if (!profile || state.cpuPowerBusy) return

  const token = ++state.cpuPowerApplySeq
  setCpuPowerBusy(true)
  try {
    const current = state.lastTdp || await readCpuPowerTdp()
    const lockedTdp = await lockCpuPowerProfile(mode, profile, current.tcc, 'foreground')

    if (token !== state.cpuPowerApplySeq) return

    state.lastTdp = lockedTdp
    state.lastCpuPowerRefreshAt = performance.now()
    state.tdpDriftStrikes = 0
    state.cpuPowerMode = mode
    persistCpuPowerPreference(mode)
    syncCpuPowerUI()
    if (!options.silent) {
      const systemText = options.skipSystemProfile ? '' : '\n系统电源方案将在后台继续应用。'
      showToast(`已锁定为${profile.label}：CPU ${profile.cpu1}W / ${profile.cpu2}W，GPU ${profile.gpu1}W / ${profile.gpu2}W${systemText}`)
    }
    queueSystemPowerProfile(mode, options)
  } catch (error) {
    diagLog('warn', 'power.apply.failed', { mode, error: safeError(error), silent: !!options.silent })
    if (!options.silent) {
      showToast(`锁定功耗失败\n${error}`)
    }
  } finally {
    setCpuPowerBusy(false)
  }
}

function queueHardRecovery(reason, details = {}) {
  window.setTimeout(() => {
    runHardRecovery(reason, details)
  }, 0)
}

async function runHardRecovery(reason, details = {}) {
  const now = performance.now()
  if (state.hardRecovering) {
    diagLog('debug', 'hard_recovery.skipped_busy', { reason, details })
    return
  }
  if (now - state.lastHardRecoverAt < HARD_RECOVERY_COOLDOWN_MS) {
    diagLog('debug', 'hard_recovery.skipped_cooldown', {
      reason,
      sinceLastMs: Math.round(now - state.lastHardRecoverAt),
      details,
    })
    return
  }

  state.hardRecovering = true
  state.lastHardRecoverAt = now
  state.modePollInFlight = false
  state.actorPollInFlight = false
  state.realtimeFramePending = false
  state.tdpReadPromise = null
  setDot('modeStatusDot', 'warn')
  enableLowPowerMode(`hard recovery: ${reason}`)
  diagLog('warn', 'hard_recovery.start', { reason, details })

  try {
    const payload = buildPayload()
    await invokeBackend('start_fan_control', { fanData: payload }, BACKEND_TIMEOUT_MS)
    setRunningUI(true)
    setText('runtimeModeText', controlStatusText())

    const results = await Promise.allSettled([
      applyCpuPowerMode(state.cpuPowerMode, { silent: true, skipSystemProfile: true }),
      refreshActorSnapshot(),
      refreshRuntimeMode(),
      refreshDiagnosticSummary({ silent: true }),
    ])
    state.cpuFanZeroStrikes = 0
    state.gpuFanZeroStrikes = 0
    diagLog('warn', 'hard_recovery.done', { reason, results })
    setDot('modeStatusDot', 'active')
  } catch (error) {
    diagLog('error', 'hard_recovery.failed', { reason, error: safeError(error), details })
    setDot('modeStatusDot', 'danger')
    showToast(`自动恢复失败\n${error}`)
  } finally {
    state.hardRecovering = false
  }
}

function monitorModeLabel() {
  return state.monitorMode ? '退出大屏监控' : '进入大屏监控'
}

function setMonitorModeUI(enabled, options = {}) {
  state.monitorMode = enabled
  document.body.classList.toggle('monitor-mode', enabled)
  setText('toggleMonitorModeButton', monitorModeLabel())
  if (enabled) {
    syncSidebarNavigation('monitorSection')
  }
  if (options.persist === true) {
    persistMonitorModePreference(enabled)
  }
}

function setRunningUI(running) {
  state.running = running
  setText('btnText', running ? '停止控制' : '启动控制')
  setText('fanStatusText', running ? '运行中' : '待机')
  setDot('fanStatusDot', running ? 'active' : 'idle')
  if (!running) {
    setText('runtimeModeText', controlStatusText())
    setDot('modeStatusDot', 'idle')
  }
}

function controlStatusText() {
  if (state.constantSpeedEnabled) {
    return `模式: 恒速 ${clamp(state.constantSpeed, 0, 100)}%（场景仅保存）`
  }
  return `模式: ${SCENARIOS[state.selectedScenario].label}`
}

function setAutostartButtonText() {
  setText('autostartButton', `开机自启: ${state.autostartEnabled ? '开启' : '关闭'}`)
}

function formatBytes(bytes) {
  const value = Number(bytes || 0)
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function formatLogTime(timestampMs) {
  const value = Number(timestampMs || 0)
  if (!value) return '--:--:--'
  try {
    return new Date(value).toLocaleTimeString()
  } catch {
    return '--:--:--'
  }
}

function diagnosticHealthLabel(health) {
  if (health === 'danger') return '需要处理'
  if (health === 'warn') return '有告警'
  if (health === 'ok') return '正常'
  return '未知'
}

function diagnosticDotState(health) {
  if (health === 'danger') return 'danger'
  if (health === 'warn') return 'warn'
  if (health === 'ok') return 'active'
  return 'idle'
}

function renderDiagnosticIssues(summary) {
  const body = byId('consoleBody')
  if (!body) return
  const issues = Array.isArray(summary?.recent_issues) ? summary.recent_issues : []
  if (issues.length === 0) {
    body.innerHTML = [
      '<div class="log-line"><span class="log-time">--:--:--</span><span class="log-tag">OK</span><span class="log-msg">最近诊断日志没有明显异常。</span></div>',
      `<div class="log-line"><span class="log-time">--:--:--</span><span class="log-tag">LOG</span><span class="log-msg">${formatBytes(summary?.size_bytes)} / ${summary?.total_lines ?? 0} 行</span></div>`,
    ].join('')
    return
  }

  body.innerHTML = issues.slice().reverse().map((issue) => {
    const tagClass = issue.level === 'warn' ? ' warn' : issue.level === 'error' ? ' error' : ''
    const label = `${issue.component || 'app'}.${issue.event || 'event'}`
    const message = truncateText(issue.message || '', 180)
    return `<div class="log-line"><span class="log-time">${escapeHtml(formatLogTime(issue.timestamp_ms))}</span><span class="log-tag${tagClass}">${escapeHtml(truncateText(issue.level || 'log', 5).toUpperCase())}</span><span class="log-msg">${escapeHtml(label)} ${escapeHtml(message)}</span></div>`
  }).join('')
}

function watchdogEventLabel(event) {
  if (!event) return '--'
  const component = event.component || ''
  const name = event.event || ''
  if (component === 'fan_sentinel') {
    if (name === 'start') return '守护线程已启动'
    if (name === 'sdown.enter') return '发现疑似卡住，先观察'
    if (name === 'sdown.confirming') return '异常还在，继续确认'
    if (name === 'sdown.clear' || name === 'sdown.clear_no_runtime') return '异常解除'
    if (name === 'odown.enter') return '确认异常，准备恢复'
    if (name === 'odown.clear_no_runtime') return '已停止控制，不需要恢复'
    if (name === 'restart.queued') return '已安排重启风扇控制'
    if (name === 'restart.start') return '开始恢复风扇控制'
    if (name === 'restart.failed') return '恢复失败'
    if (name === 'restart.skipped_no_runtime') return '控制已停止，跳过恢复'
    if (name === 'restart.skipped_cooldown') return '恢复太频繁，稍后再试'
    if (name === 'manual_test.start') return '你手动触发了哨兵测试'
    if (name === 'manual_test.queued') return '已排队：先停止再启动'
    if (name === 'manual_test.done') return '自检通过：连续采样正常'
    if (name === 'manual_test.failed') return '自检失败：采样不稳定'
  }
  if (component === 'frontend_watchdog') {
    if (name === 'start') return '界面看门狗已启动'
    if (name === 'heartbeat') return '界面心跳正常'
    if (name === 'reload') return '界面无响应，已重载'
  }
  if (component === 'external_sentinel') {
    if (name === 'start') return '独立哨兵已启动'
    if (name === 'spawn.ok') return '独立哨兵进程已拉起'
    if (name === 'frontend_stale_restart') return '独立哨兵发现界面卡死，重启软件'
    if (name === 'parent_missing_restart') return '软件退出但风扇仍在控制，独立哨兵重启软件'
    if (name === 'restart.spawned') return '独立哨兵已启动新软件'
    if (name === 'restart.failed') return '独立哨兵重启失败'
    if (name === 'resume_gap') return '电脑刚恢复，独立哨兵暂缓判断'
  }
  if (name === 'actor_hung.flagged') return '风扇控制线程卡住'
  return `${component || 'watchdog'}.${name || 'event'}`
}

function watchdogPlainStatus(events, eventCount) {
  const last = events[events.length - 1]
  if (!eventCount) return { dot: 'idle', text: '还没开始记录' }
  if (last?.component === 'external_sentinel' && last?.event === 'frontend_stale_restart') return { dot: 'danger', text: '独立哨兵已接管重启' }
  if (last?.component === 'external_sentinel' && last?.event === 'parent_missing_restart') return { dot: 'warn', text: '独立哨兵正在拉起软件' }
  if (last?.component === 'external_sentinel' && last?.event === 'restart.spawned') return { dot: 'active', text: '独立哨兵已重启软件' }
  if (last?.component === 'external_sentinel' && last?.event === 'spawn.ok') return { dot: 'active', text: '独立哨兵运行中' }
  if (last?.event === 'restart.failed' || last?.level === 'error') return { dot: 'danger', text: '恢复失败，需要你看一下' }
  if (last?.event === 'odown.enter') return { dot: 'warn', text: '确认异常，正在恢复' }
  if (last?.event === 'sdown.enter' || last?.event === 'sdown.confirming') return { dot: 'warn', text: '发现异常，正在观察' }
  if (last?.event === 'restart.queued' || last?.event === 'restart.start') return { dot: 'warn', text: '正在重启风扇控制' }
  if (last?.event === 'manual_test.start' || last?.event === 'manual_test.queued') return { dot: 'warn', text: '后端正在验证哨兵' }
  if (last?.event === 'manual_test.done') return { dot: 'active', text: '哨兵自检通过' }
  if (last?.event === 'manual_test.failed') return { dot: 'danger', text: '哨兵自检失败' }
  if (last?.event === 'restart.skipped_no_runtime' || last?.event === 'odown.clear_no_runtime' || last?.event === 'sdown.clear_no_runtime') {
    return { dot: 'idle', text: '风扇控制已停止' }
  }
  if (last?.event === 'sdown.clear') return { dot: 'active', text: '异常已恢复' }
  return { dot: 'active', text: '正常守护中' }
}

function syncWatchdogHomeUI(summary) {
  const events = Array.isArray(summary?.recent_watchdog_events) ? summary.recent_watchdog_events : []
  const last = events[events.length - 1]
  const eventCount = summary?.watchdog_event_count ?? 0
  const sentinelCount = summary?.sentinel_event_count ?? 0
  const reloadCount = summary?.watchdog_reload_count ?? 0
  const status = watchdogPlainStatus(events, eventCount)

  setDot('watchdogHomeDot', status.dot)
  setText('watchdogHomeStateValue', status.text)
  setText('watchdogHomeCountsValue', `记录 ${eventCount} 条，哨兵 ${sentinelCount} 条，界面重载 ${reloadCount} 次`)
  setText('watchdogHomeLastEventValue', last ? `${formatLogTime(last.timestamp_ms)} ${watchdogEventLabel(last)}` : '--')
  setText(
    'watchdogHomeDetailValue',
    last ? `最近动作：${watchdogEventLabel(last)}。原始信息：${truncateText(last.message || '', 140)}` : '还没有读取到哨兵或看门狗日志。',
  )
  setText('watchdogHomeUpdatedValue', summary?.modified_ms ? `更新 ${formatLogTime(summary.modified_ms)}` : '等待诊断')
}

async function runSentinelSelfTest() {
  if (state.sentinelTestBusy) return
  const button = byId('forceSentinelTestButton')
  state.sentinelTestBusy = true
  if (button) {
    button.disabled = true
    button.textContent = '测试中...'
  }
  setDot('watchdogHomeDot', 'warn')
  setText('watchdogHomeStateValue', '正在测试哨兵重启')
  setText('watchdogHomeDetailValue', '正在把自检交给后端执行，界面不会等待硬件采样完成。')
  diagLog('warn', 'sentinel.manual_test.requested', { running: state.running, selectedScenario: state.selectedScenario })

  try {
    const result = await invokeBackend('force_fan_sentinel_restart', { fanData: buildPayload() }, BACKEND_TIMEOUT_MS)
    setDot('watchdogHomeDot', 'warn')
    setText('watchdogHomeStateValue', '后端正在验证哨兵')
    setText('watchdogHomeDetailValue', result || '哨兵自检已开始，稍后会在首页日志显示通过或失败。')
    showToast(result || '哨兵自检已开始，约 12 秒后看首页结果')
    window.setTimeout(() => {
      refreshActorSnapshot().catch(() => {})
      refreshRuntimeMode().catch(() => {})
    }, 1500)
    window.setTimeout(() => {
      refreshDiagnosticSummary({ silent: true }).catch(() => {})
    }, 14000)
  } catch (error) {
    setDot('watchdogHomeDot', 'danger')
    setText('watchdogHomeStateValue', '哨兵自检无法启动')
    setText('watchdogHomeDetailValue', `自检没有成功交给后端：${String(error)}`)
    diagLog('error', 'sentinel.manual_test.failed', { error: safeError(error) })
    showToast(`哨兵自检无法启动\n${error}`)
    window.setTimeout(() => {
      refreshDiagnosticSummary({ silent: true }).catch(() => {})
    }, 3000)
  } finally {
    state.sentinelTestBusy = false
    if (button) {
      button.disabled = false
      button.textContent = '强制测试哨兵'
    }
  }
}

function syncDiagnosticSummaryUI(summary) {
  state.diagnosticSummary = summary || null
  const health = summary?.health || 'unknown'
  setDot('diagnosticHealthDot', diagnosticDotState(health))
  setText('diagnosticHealthValue', diagnosticHealthLabel(health))
  setText('diagnosticWarnErrorValue', `${summary?.warning_count ?? 0} / ${summary?.error_count ?? 0}`)
  setText('diagnosticTdpValue', `${summary?.tdp_drift_count ?? 0} 次，失败 ${summary?.tdp_reapply_failed_count ?? 0}`)
  setText('diagnosticUiValue', `${summary?.ui_drift_count ?? 0} 次，重载 ${summary?.watchdog_reload_count ?? 0}`)
  setText('diagnosticVendorValue', `${summary?.vendor_failure_count ?? 0} 次`)
  setText('diagnosticBusyValue', `${summary?.hardware_busy_count ?? 0} 次`)
  setText(
    'diagnosticSummaryText',
    `${summary?.summary || '暂无诊断摘要。'} 扫描 ${summary?.scanned_lines ?? 0}/${summary?.total_lines ?? 0} 行，日志 ${formatBytes(summary?.size_bytes)}。`,
  )
  setText('diagnosticLogPath', summary?.path || '--')
  setText('diagnosticUpdatedValue', summary?.modified_ms ? `更新 ${formatLogTime(summary.modified_ms)}` : '未生成日志')
  syncWatchdogHomeUI(summary)
  renderDiagnosticIssues(summary)
}

async function refreshDiagnosticSummary(options = {}) {
  const button = byId('refreshDiagnosticsButton')
  if (button) button.disabled = true
  try {
    const summary = await invokeBackend('get_diagnostic_summary', undefined, DIAGNOSTIC_TIMEOUT_MS)
    syncDiagnosticSummaryUI(summary)
    if (options.silent !== true) {
      showToast(`诊断已刷新：${diagnosticHealthLabel(summary?.health)}`)
    }
    return summary
  } catch (error) {
    diagLog('warn', 'diagnostic.summary_failed', { error: safeError(error) })
    if (options.silent !== true) {
      showToast(`诊断刷新失败\n${error}`)
    }
    return null
  } finally {
    if (button) button.disabled = false
  }
}

function vendorServiceLabel(status) {
  const data = status?.data || {}
  if (status?.ok) return '已连接'
  if (data.processRunning) return '服务运行 / 未连接'
  if (data.packageFound) return '老包存在 / 服务离线'
  return '不可用'
}

function vendorDotState(status) {
  const data = status?.data || {}
  if (status?.ok) return 'active'
  if (data.processRunning || data.packageFound || data.sdkFound) return 'warn'
  if (status) return 'danger'
  return 'idle'
}

function yesNo(value) {
  return value ? '存在' : '未发现'
}

function compactPath(path) {
  const text = String(path || '').trim()
  if (!text) return ''
  const parts = text.split(/[\\/]+/).filter(Boolean)
  if (parts.length <= 3) return text
  return `...\\${parts.slice(-3).join('\\')}`
}

function vendorPackageLabel(status) {
  const data = status?.data || {}
  const label = yesNo(Boolean(data.packageFound))
  const path = compactPath(data.packagePath)
  return path ? `${label} · ${path}` : label
}

function vendorSdkLabel(status) {
  const data = status?.data || {}
  if (!data.sdkFound) return '未发现'
  const source = data.sdkSource ? String(data.sdkSource) : '未知来源'
  const path = compactPath(data.sdkPath)
  return path ? `已找到 · ${source} · ${path}` : `已找到 · ${source}`
}

function vendorProcessLabel(status) {
  const data = status?.data || {}
  if (data.processRunning) return 'UniwillService 正在运行'
  if (data.packageFound || data.sdkFound) return '未运行'
  return '未发现'
}

function vendorDetailLabel(status) {
  if (!status) return '--'
  const data = status.data || {}
  const errors = Array.isArray(data.errors) ? data.errors.filter(Boolean) : []
  if (errors.length > 0) return `${status.detail || '厂家服务异常'} · ${errors.join('；')}`
  return status.detail || (status.ok ? '厂家服务可用' : '厂家服务不可用')
}

function vendorProfileLabel(status) {
  const data = status?.data || {}
  const profile = data.currentState?.selectedProfile
  const whisper = data.whisper?.type
  const whisperFps = data.whisper?.fps
  const battery = data.battery?.mode
  const batteryLevel = data.battery?.chargingLevel
  const featureCount = Array.isArray(data.features) ? data.features.length : 0
  const parts = []
  if (profile) parts.push(profile)
  if (whisper) {
    const fpsText = Number(whisperFps) > 0 ? ` ${Math.round(Number(whisperFps))} FPS` : ''
    parts.push(`Whisper ${whisper}${fpsText}`)
  }
  if (battery) {
    const levelText = Number(batteryLevel) > 0 ? ` ${Math.round(Number(batteryLevel))}%` : ''
    parts.push(`Battery ${battery}${levelText}`)
  }
  if (featureCount > 0) parts.push(`${featureCount} 项功能`)
  return parts.join(' / ') || '--'
}

function normalizeWhisperMode(mode) {
  const value = String(mode || 'Off').trim().toLowerCase()
  return WHISPER_MODES.find((item) => item.toLowerCase() === value) || 'Off'
}

function normalizeBatteryMode(mode) {
  const value = String(mode || 'BestBattery').trim().toLowerCase()
  return BATTERY_MODES.find((item) => item.toLowerCase() === value) || 'BestBattery'
}

function rgbToHex(r, g, b) {
  const channel = (value) => clamp(value, 0, 255).toString(16).padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

function parseHexColor(value) {
  const text = String(value || '').trim()
  const match = /^#?([0-9a-f]{6})$/i.exec(text)
  if (!match) return { r: 255, g: 255, b: 255 }
  const raw = match[1]
  return {
    r: parseInt(raw.slice(0, 2), 16),
    g: parseInt(raw.slice(2, 4), 16),
    b: parseInt(raw.slice(4, 6), 16),
  }
}

function normalizeLightingPreference(raw) {
  if (!raw || typeof raw !== 'object') return null
  const color = /^#[0-9a-f]{6}$/i.test(String(raw.color || '')) ? String(raw.color).toLowerCase() : '#ffffff'
  return {
    color,
    keyboardBrightness: clamp(raw.keyboardBrightness ?? 30, 0, 100),
    lightbarBrightness: clamp(raw.lightbarBrightness ?? 0, 0, 100),
  }
}

function readLightingPreference() {
  try {
    return normalizeLightingPreference(JSON.parse(localStorage.getItem(LIGHTING_STORAGE_KEY) || 'null'))
  } catch {
    return null
  }
}

function persistLightingPreference() {
  try {
    localStorage.setItem(LIGHTING_STORAGE_KEY, JSON.stringify({
      color: state.lightingColor,
      keyboardBrightness: clamp(state.keyboardBrightness, 0, 100),
      lightbarBrightness: clamp(state.lightbarBrightness, 0, 100),
    }))
    state.lightingPreferenceLoaded = true
  } catch {
    // ignore storage failure
  }
}

function restoreLightingPreference() {
  const preference = readLightingPreference()
  if (!preference) return false
  state.lightingColor = preference.color
  state.keyboardBrightness = preference.keyboardBrightness
  state.lightbarBrightness = preference.lightbarBrightness
  state.lightingPreferenceLoaded = true
  return true
}

function syncVendorStatusUI(status) {
  state.vendorStatus = status || null
  state.vendorStatusCheckedAt = Date.now()
  const whisper = status?.data?.whisper || {}
  const battery = status?.data?.battery || {}
  const lighting = status?.data?.lighting || {}
  const keyboardColor = Array.isArray(lighting.keyboard?.colors) ? lighting.keyboard.colors[0] : null
  const lightbarAc = lighting.lightbar?.ac || {}
  state.whisperMode = normalizeWhisperMode(whisper.type || state.whisperMode)
  state.whisperFps = clamp(whisper.fps ?? state.whisperFps, 0, 240)
  state.batteryMode = normalizeBatteryMode(battery.mode || state.batteryMode)
  state.batteryLevel = clamp(battery.chargingLevel ?? state.batteryLevel, 50, 100)
  if (!state.lightingPreferenceLoaded) {
    if (keyboardColor) {
      state.lightingColor = rgbToHex(keyboardColor.r, keyboardColor.g, keyboardColor.b)
    }
    state.keyboardBrightness = clamp(
      lighting.keyboard?.brightnessAc ?? state.keyboardBrightness,
      0,
      100,
    )
    state.lightbarBrightness = clamp(
      Math.max(Number(lightbarAc.r || 0), Number(lightbarAc.g || 0), Number(lightbarAc.b || 0)),
      0,
      100,
    )
  }
  setDot('vendorServiceDot', vendorDotState(status))
  setText('vendorServiceValue', vendorServiceLabel(status))
  setText('vendorPackageValue', vendorPackageLabel(status))
  setText('vendorProcessValue', vendorProcessLabel(status))
  setText('vendorSdkValue', vendorSdkLabel(status))
  setText('vendorProfileValue', vendorProfileLabel(status))
  setText('vendorEndpointValue', status?.data?.endpoint || '--')
  setText('vendorDetailValue', vendorDetailLabel(status))
  setText('vendorUpdatedValue', `厂家服务 ${formatLogTime(state.vendorStatusCheckedAt)}`)
  syncWhisperUI()
  syncBatteryUI()
  syncLightingUI()
}

function syncWhisperUI() {
  document.querySelectorAll('.whisper-btn').forEach((btn) => {
    const active = normalizeWhisperMode(btn.getAttribute('data-whisper-mode')) === state.whisperMode
    btn.classList.toggle('active', active)
    btn.disabled = state.vendorWriteBusy
  })
  const range = byId('whisperFpsRange')
  if (range) {
    range.value = String(clamp(state.whisperFps, 0, 240))
    range.disabled = state.vendorWriteBusy
  }
  const applyButton = byId('applyWhisperButton')
  if (applyButton) applyButton.disabled = state.vendorWriteBusy
  const fps = clamp(state.whisperFps, 0, 240)
  setText('whisperFpsValue', fps > 0 ? `${fps} FPS` : '不限制')
  setText('whisperHint', state.vendorWriteBusy ? '正在写入厂商服务...' : '厂商安静模式与 FPS 限制。')
}

function syncBatteryUI() {
  document.querySelectorAll('.battery-btn').forEach((btn) => {
    const active = normalizeBatteryMode(btn.getAttribute('data-battery-mode')) === state.batteryMode
    btn.classList.toggle('active', active)
    btn.disabled = state.vendorWriteBusy
  })
  const range = byId('batteryLevelRange')
  if (range) {
    range.value = String(clamp(state.batteryLevel, 50, 100))
    range.disabled = state.vendorWriteBusy || state.batteryMode !== 'Custom'
  }
  const applyButton = byId('applyBatteryButton')
  if (applyButton) applyButton.disabled = state.vendorWriteBusy
  setText('batteryLevelValue', `${clamp(state.batteryLevel, 50, 100)}%`)
  const hint = state.vendorWriteBusy
    ? '正在写入厂商服务...'
    : state.batteryMode === 'Custom'
      ? '自定义充电上限会写入厂商服务。'
      : state.batteryMode === 'AcMode'
        ? '满充模式通常允许充到 100%。'
        : '保养模式由厂商服务管理充电策略。'
  setText('batteryHint', hint)
}

function syncLightingUI() {
  const colorInput = byId('lightingColorInput')
  if (colorInput) {
    colorInput.value = state.lightingColor
    colorInput.disabled = state.vendorWriteBusy
  }
  const keyboardRange = byId('keyboardBrightnessRange')
  if (keyboardRange) {
    keyboardRange.value = String(clamp(state.keyboardBrightness, 0, 100))
    keyboardRange.disabled = state.vendorWriteBusy
  }
  const lightbarRange = byId('lightbarBrightnessRange')
  if (lightbarRange) {
    lightbarRange.value = String(clamp(state.lightbarBrightness, 0, 100))
    lightbarRange.disabled = state.vendorWriteBusy
  }
  const applyButton = byId('applyLightingButton')
  if (applyButton) applyButton.disabled = state.vendorWriteBusy
  setText('keyboardBrightnessValue', `${clamp(state.keyboardBrightness, 0, 100)}%`)
  setText('lightbarBrightnessValue', `${clamp(state.lightbarBrightness, 0, 100)}%`)
  setText(
    'lightingHint',
    state.vendorWriteBusy ? '正在写入厂商服务...' : '键盘灯与 Lightbar 单色模式。',
  )
}

async function refreshVendorServiceStatus(options = {}) {
  if (state.vendorWriteBusy) return state.vendorStatus
  if (state.vendorPollInFlight) return state.vendorStatus
  const button = byId('refreshVendorStatusButton')
  if (button) button.disabled = true
  state.vendorPollInFlight = true
  try {
    const status = await invokeBackend(
      'get_vendor_service_status',
      undefined,
      VENDOR_STATUS_TIMEOUT_MS,
    )
    syncVendorStatusUI(status)
    if (status?.ok && options.silent !== true) {
      showToast(`厂家服务：${vendorServiceLabel(status)}`)
    }
    if (!status?.ok && options.silent !== true) {
      showToast(`厂商服务不可用\n${status?.detail || '未知错误'}`)
    }
    return status
  } catch (error) {
    const status = {
      ok: false,
      detail: String(error),
      data: {},
    }
    syncVendorStatusUI(status)
    if (options.silent !== true) {
      showToast(`厂商服务检测失败\n${error}`)
    }
    return status
  } finally {
    state.vendorPollInFlight = false
    if (button) button.disabled = false
  }
}

async function applyVendorWhisper() {
  if (state.vendorWriteBusy || state.vendorWhisperBusy) return
  state.vendorWriteBusy = true
  state.vendorWhisperBusy = true
  syncWhisperUI()
  syncBatteryUI()
  syncLightingUI()
  try {
    const result = await invokeBackend(
      'apply_vendor_whisper',
      {
        mode: state.whisperMode,
        fps: clamp(state.whisperFps, 0, 240),
      },
      VENDOR_STATUS_TIMEOUT_MS,
    )
    syncVendorStatusUI(result?.status)
    if (result?.status?.ok) {
      showToast('Whisper 设置已应用')
    } else {
      showToast(`Whisper 设置未确认\n${result?.status?.detail || '厂商服务没有返回成功状态'}`)
    }
  } catch (error) {
    showToast(`Whisper 设置失败\n${error}`)
  } finally {
    state.vendorWhisperBusy = false
    state.vendorWriteBusy = false
    syncWhisperUI()
    syncBatteryUI()
    syncLightingUI()
  }
}

async function applyVendorBattery() {
  if (state.vendorWriteBusy || state.vendorBatteryBusy) return
  state.vendorWriteBusy = true
  state.vendorBatteryBusy = true
  syncBatteryUI()
  syncWhisperUI()
  syncLightingUI()
  try {
    const result = await invokeBackend(
      'apply_vendor_battery',
      {
        mode: state.batteryMode,
        level: clamp(state.batteryLevel, 50, 100),
      },
      VENDOR_STATUS_TIMEOUT_MS,
    )
    syncVendorStatusUI(result?.status)
    if (result?.status?.ok) {
      showToast('电池充电限制已应用')
    } else {
      showToast(`电池设置未确认\n${result?.status?.detail || '厂商服务没有返回成功状态'}`)
    }
  } catch (error) {
    showToast(`电池设置失败\n${error}`)
  } finally {
    state.vendorBatteryBusy = false
    state.vendorWriteBusy = false
    syncBatteryUI()
    syncWhisperUI()
    syncLightingUI()
  }
}

async function applyVendorLighting() {
  if (state.vendorWriteBusy || state.vendorLightingBusy) return
  state.vendorWriteBusy = true
  state.vendorLightingBusy = true
  syncLightingUI()
  syncWhisperUI()
  syncBatteryUI()
  try {
    const color = parseHexColor(state.lightingColor)
    const result = await invokeBackend(
      'apply_vendor_lighting',
      {
        ...color,
        keyboardBrightness: clamp(state.keyboardBrightness, 0, 100),
        lightbarBrightness: clamp(state.lightbarBrightness, 0, 100),
      },
      VENDOR_STATUS_TIMEOUT_MS,
    )
    syncVendorStatusUI(result?.status)
    if (result) {
      state.lightingColor = rgbToHex(result.r, result.g, result.b)
      state.keyboardBrightness = clamp(result.keyboard_brightness, 0, 100)
      state.lightbarBrightness = clamp(result.lightbar_brightness, 0, 100)
      persistLightingPreference()
    }
    if (result?.status?.ok) {
      showToast('灯效已应用')
    } else {
      showToast(`灯效设置未确认\n${result?.status?.detail || '厂商服务没有返回成功状态'}`)
    }
  } catch (error) {
    showToast(`灯效设置失败\n${error}`)
  } finally {
    state.vendorLightingBusy = false
    state.vendorWriteBusy = false
    syncLightingUI()
    syncWhisperUI()
    syncBatteryUI()
  }
}

function syncSettingUI() {
  const startupTakeoverCheckbox = byId('startupTakeoverCheckbox')
  const constantSpeedRange = byId('constantSpeedRange')

  if (startupTakeoverCheckbox) {
    startupTakeoverCheckbox.checked = !!state.startupTakeoverEnabled
  }
  if (constantSpeedRange) {
    constantSpeedRange.value = String(clamp(state.constantSpeed, 0, 100))
    constantSpeedRange.disabled = !state.constantSpeedEnabled
  }
  syncControlModeButtons()
  syncWhisperUI()
  syncBatteryUI()
  syncLightingUI()
  setText('constantSpeedValue', `${clamp(state.constantSpeed, 0, 100)}%`)
  setAutostartButtonText()
}

function syncControlModeButtons() {
  const scenarioButton = byId('enableScenarioButton')
  const constantButton = byId('enableConstantButton')
  const constantMode = !!state.constantSpeedEnabled

  if (scenarioButton) {
    scenarioButton.classList.toggle('primary', !constantMode)
    scenarioButton.classList.toggle('secondary', constantMode)
  }

  if (constantButton) {
    constantButton.classList.toggle('primary', constantMode)
    constantButton.classList.toggle('secondary', !constantMode)
  }

  setText('controlModeHint', constantMode ? '恒速已启用，场景不会生效。' : '场景已启用，恒速不会生效。')

  document.querySelectorAll('.scene-btn').forEach((btn) => {
    btn.classList.toggle('disabled', constantMode)
  })
}

function updateAlert(cpuTemp, gpuTemp, options = {}) {
  const strip = byId('alertStrip')
  const liveStrip = byId('liveStrip')
  const liveStripText = byId('liveStripText')
  if (!strip) return

  if (options.enabled === false) {
    strip.classList.remove('visible')
    strip.textContent = ''
    if (liveStrip && liveStripText) {
      liveStrip.className = 'live-strip safe'
      liveStripText.textContent = '状态色带：安全，风扇策略处于稳定区间。'
    }
    return
  }

  if (cpuTemp >= 90 || gpuTemp >= 90) {
    const suggestedCoolingScene = Math.max(cpuTemp, gpuTemp) >= 92 ? '基准场景' : '性能场景'
    strip.classList.add('visible')
    strip.textContent = `过温警告：CPU ${cpuTemp}°C / GPU ${gpuTemp}°C，建议切换到“${suggestedCoolingScene}”。`
    setDot('modeStatusDot', 'danger')
    if (liveStrip && liveStripText) {
      liveStrip.className = 'live-strip hot'
      liveStripText.textContent = '状态色带：高危，温度已进入保护区间，建议立即切换更强散热场景。'
    }
    return
  }

  if (cpuTemp >= 80 || gpuTemp >= 80) {
    strip.classList.add('visible')
    strip.textContent = `高温提醒：CPU ${cpuTemp}°C / GPU ${gpuTemp}°C，建议切换到“游戏场景”或“性能场景”。`
    setDot('modeStatusDot', 'warn')
    if (liveStrip && liveStripText) {
      liveStrip.className = 'live-strip warm'
      liveStripText.textContent = '状态色带：升温，建议关注负载并提前切换到更高散热倾向场景。'
    }
    return
  }

  strip.classList.remove('visible')
  strip.textContent = ''
  if (liveStrip && liveStripText) {
    liveStrip.className = 'live-strip safe'
    liveStripText.textContent = '状态色带：安全，风扇策略处于稳定区间。'
  }
  if (state.running) {
    setDot('modeStatusDot', 'active')
  }
}

function recommendedScenarioByTemp(cpuTemp, gpuTemp) {
  const hottest = Math.max(cpuTemp, gpuTemp)
  if (hottest >= 92) return 'benchmark'
  if (hottest >= 85) return 'performance'
  if (hottest >= 78) return 'gaming'
  if (hottest >= 65) return 'office'
  return 'silent'
}

function updateScenarioRecommendations(cpuTemp, gpuTemp) {
  const suggested = recommendedScenarioByTemp(cpuTemp, gpuTemp)
  document.querySelectorAll('[data-suggest]').forEach((badge) => {
    const key = badge.getAttribute('data-suggest')
    const isRecommended = key === suggested
    badge.classList.toggle('is-recommended', isRecommended)
    badge.textContent = isRecommended ? '当前建议' : '待命'
  })
}

function makeTrendChart() {
  const canvas = byId('trendChart')
  if (!canvas) return null
  const chartTheme = getScenarioTheme()

  return new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: Array.from({ length: HISTORY_POINTS }, (_, i) => `${(HISTORY_POINTS - 1 - i) * 3}s`),
      datasets: [
        {
          label: 'CPU 温度',
          data: Array(HISTORY_POINTS).fill(0),
          borderColor: chartTheme.cpuTemp,
          backgroundColor: chartTheme.tempFill,
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
          fill: true,
          yAxisID: 'temp',
        },
        {
          label: 'GPU 温度',
          data: Array(HISTORY_POINTS).fill(0),
          borderColor: chartTheme.gpuTemp,
          backgroundColor: chartTheme.gpuFill,
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
          fill: true,
          yAxisID: 'temp',
        },
        {
          label: 'CPU 风扇 RPM',
          data: Array(HISTORY_POINTS).fill(0),
          borderColor: chartTheme.cpuFan,
          backgroundColor: chartTheme.fanFill,
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
          fill: false,
          yAxisID: 'rpm',
        },
        {
          label: 'GPU 风扇 RPM',
          data: Array(HISTORY_POINTS).fill(0),
          borderColor: chartTheme.gpuFan,
          backgroundColor: chartTheme.gpuFanFill,
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
          fill: false,
          yAxisID: 'rpm',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: {
          labels: {
            color: chartTheme.axis,
            font: { size: 11 },
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: chartTheme.axis,
            autoSkip: true,
            maxTicksLimit: 8,
            maxRotation: 0,
          },
          grid: {
            color: chartTheme.grid,
          },
        },
        temp: {
          type: 'linear',
          position: 'left',
          min: 0,
          max: 110,
          title: {
            display: true,
            text: '温度 (°C)',
            color: chartTheme.axis,
            font: { size: 11 },
          },
          ticks: { color: chartTheme.axis },
          grid: { color: chartTheme.grid },
        },
        rpm: {
          type: 'linear',
          position: 'right',
          min: 0,
          max: 7000,
          title: {
            display: true,
            text: '风扇 (RPM)',
            color: chartTheme.axis,
            font: { size: 11 },
          },
          ticks: { color: chartTheme.axis },
          grid: {
            drawOnChartArea: false,
          },
        },
      },
    },
  })
}

function ensureTrendChart() {
  if (state.trendChart) return state.trendChart
  state.trendChart = makeTrendChart()
  updateTrendChartTheme()
  return state.trendChart
}

function isMonitorPageVisible() {
  const monitorPage = document.getElementById('page3')
  return !!monitorPage && !monitorPage.hidden && monitorPage.classList.contains('active')
}

function resizeTrendChartSoon() {
  window.requestAnimationFrame(() => {
    try {
      const chart = ensureTrendChart()
      chart?.resize()
      chart?.update('none')
    } catch (error) {
      diagLog('warn', 'chart.resize_failed', { error: safeError(error) })
      console.warn('[NUCtool] chart resize failed:', error)
    }
  })
}

function pushTrend(cpuTemp, gpuTemp, cpuFan, gpuFan) {
  if (!state.trendChart) return

  const values = [cpuTemp, gpuTemp, cpuFan, gpuFan]
  state.trendChart.data.datasets.forEach((dataset, i) => {
    dataset.data.push(values[i])
    dataset.data.shift()
  })
  state.trendChart.update('none')
}

function shouldUpdateChart(now) {
  if (document.hidden || !state.trendChart || !isMonitorPageVisible()) return false
  const interval = state.lowPowerMode
    ? LOW_POWER_CHART_UPDATE_INTERVAL_MS
    : CHART_UPDATE_INTERVAL_MS
  return now - state.chartLastUpdateAt >= interval
}

function assessFanSafety(cpuTemp, gpuTemp, cpuFan, gpuFan, source) {
  if (!state.running) {
    state.cpuFanZeroStrikes = 0
    state.gpuFanZeroStrikes = 0
    return
  }

  if (cpuTemp >= FAN_ZERO_RECOVERY_TEMP && cpuFan <= 0) {
    state.cpuFanZeroStrikes += 1
  } else {
    state.cpuFanZeroStrikes = 0
  }

  if (gpuTemp >= FAN_ZERO_RECOVERY_TEMP && gpuFan <= 0) {
    state.gpuFanZeroStrikes += 1
  } else {
    state.gpuFanZeroStrikes = 0
  }

  if (state.cpuFanZeroStrikes === FAN_ZERO_RECOVERY_STRIKES) {
    queueHardRecovery('cpu_fan_zero_rpm', {
      source,
      cpuTemp,
      gpuTemp,
      cpuFan,
      gpuFan,
      strikes: state.cpuFanZeroStrikes,
    })
  }

  if (state.gpuFanZeroStrikes === FAN_ZERO_RECOVERY_STRIKES) {
    queueHardRecovery('gpu_fan_zero_rpm', {
      source,
      cpuTemp,
      gpuTemp,
      cpuFan,
      gpuFan,
      strikes: state.gpuFanZeroStrikes,
    })
  }
}

function renderRealtimeFrame() {
  state.realtimeFramePending = false
  const payload = state.latestRealtime
  if (!payload) return

  const cpuTemp = clamp(payload.left_temp ?? 0, 0, 110)
  const gpuTemp = clamp(payload.right_temp ?? 0, 0, 110)
  const cpuFan = clamp(payload.left_fan_speed ?? 0, 0, 7000)
  const gpuFan = clamp(payload.right_fan_speed ?? 0, 0, 7000)
  const cpuPower = formatPowerPair(payload.cpu_power_limit_w, payload.cpu_power_short_w)
  const gpuPower = formatPowerPair(payload.gpu_power_limit_w, payload.gpu_power_short_w)

  setText('cpuTempValue', cpuTemp || '--')
  setText('gpuTempValue', gpuTemp || '--')
  setText('cpuFanValue', cpuFan || '--')
  setText('gpuFanValue', gpuFan || '--')
  setText('cpuPowerValue', cpuPower)
  setText('gpuPowerValue', gpuPower)

  const detail = { cpuTemp, gpuTemp, cpuFan, gpuFan }
  document.dispatchEvent(new CustomEvent('nuctool-metrics', { detail }))

  assessFanSafety(cpuTemp, gpuTemp, cpuFan, gpuFan, 'realtime')
  updateAlert(cpuTemp, gpuTemp, { enabled: state.running })
  updateScenarioRecommendations(cpuTemp, gpuTemp)

  const now = performance.now()
  if (shouldUpdateChart(now)) {
    pushTrend(cpuTemp, gpuTemp, cpuFan, gpuFan)
    state.chartLastUpdateAt = now
  }
}

function scheduleRealtimeFrame(payload) {
  state.latestRealtime = payload
  if (state.realtimeFramePending) return
  state.realtimeFramePending = true
  window.requestAnimationFrame(renderRealtimeFrame)
}

function scenarioCurvePoints(name, side) {
  const s = SCENARIOS[name] || SCENARIOS.office
  const source = side === 'gpu' ? s.gpuCurve : s.cpuCurve
  return CURVE_TEMPS.map((temperature, i) => ({
    temperature,
    speed: clamp(source[i], 0, 100),
  }))
}

function buildPayload() {
  const s = SCENARIOS[state.selectedScenario] || SCENARIOS.office
  const constantEnabled = !!state.constantSpeedEnabled
  const constantValue = clamp(state.constantSpeed, 0, 100)
  return {
    left_fan: scenarioCurvePoints(state.selectedScenario, 'cpu'),
    right_fan: scenarioCurvePoints(state.selectedScenario, 'gpu'),
    control: {
      mode: s.mode,
      strategy: 'independent',
      preset: s.mode,
      control_mode: constantEnabled ? 'constant' : 'curve',
      ramp_up_step: s.ramp,
      ramp_down_step: s.ramp,
      min_speed: 20,
      zero_rpm_enabled: false,
      zero_rpm_threshold: 45,
      constant_speed_enabled: constantEnabled,
      constant_speed: constantValue,
      startup_takeover_enabled: !!state.startupTakeoverEnabled,
      cpu_hysteresis_bandwidth: s.hysteresis,
      gpu_hysteresis_bandwidth: s.hysteresis,
      cpu_fan_max_percent: s.cpuCap,
      gpu_fan_max_percent: s.gpuCap,
      gpu_linkage_enabled: true,
      gpu_linkage_threshold: 83,
      gpu_linkage_boost: 10,
    },
    alerts: {
      cpu: {
        threshold: 90,
        actions: {
          popup: true,
          sound: false,
          log: true,
          force_shutdown: false,
          confirm_times: 2,
        },
      },
      gpu: {
        threshold: 90,
        actions: {
          popup: true,
          sound: false,
          log: true,
          force_shutdown: false,
          confirm_times: 2,
        },
      },
      recover_delta: 3,
    },
    monitor: {
      sample_interval_ms: 1000,
      log_enabled: true,
    },
  }
}

async function refreshAutostartStatus() {
  const enabled = await invokeBackend('autostart_status')
  state.autostartEnabled = !!enabled
  setAutostartButtonText()
  return state.autostartEnabled
}

async function toggleAutostart() {
  const next = !state.autostartEnabled
  const enabled = await invokeBackend('autostart_set', { enable: next })
  state.autostartEnabled = !!enabled
  setAutostartButtonText()
  showToast(state.autostartEnabled ? '开机自启已开启' : '开机自启已关闭')
}

async function applyScenarioRuntimeOnce() {
  const payload = buildPayload()

  if (!state.running) {
    // 控制未启动：自动启动并写入配置
    await invokeBackend('start_fan_control', { fanData: payload })
    setRunningUI(true)
  } else {
    // 已在运行：热更新策略
    await invokeBackend('update_fan_policy', { fanData: payload })
  }

  setText('runtimeModeText', controlStatusText())
  setDot('modeStatusDot', 'active')
}

async function applyScenarioRuntime() {
  if (state.scenarioRuntimeInFlight) {
    state.scenarioRuntimeQueued = true
    setDot('modeStatusDot', 'warn')
    return
  }

  state.scenarioRuntimeInFlight = true
  setDot('modeStatusDot', 'warn')

  try {
    do {
      state.scenarioRuntimeQueued = false
      await applyScenarioRuntimeOnce()
    } while (state.scenarioRuntimeQueued)
  } finally {
    state.scenarioRuntimeInFlight = false
    if (state.running) {
      setDot('modeStatusDot', 'active')
    }
  }
}

function updateScenarioButtons() {
  applyScenarioTheme(state.selectedScenario)
  document.querySelectorAll('.scene-btn').forEach((btn) => {
    const active = btn.getAttribute('data-scenario') === state.selectedScenario
    btn.classList.toggle('active', active)
  })
  setText('sceneLabel', SCENARIOS[state.selectedScenario]?.label || '--')
}

function syncSidebarNavigation(activeTarget) {
  document.querySelectorAll('.nav-item').forEach((item) => {
    const isActive = item.getAttribute('data-target') === activeTarget
    item.classList.toggle('active', isActive)
    item.setAttribute('aria-selected', String(isActive))
  })

  const target = activeTarget ? document.getElementById(activeTarget) : null
  const activePage = target?.closest('.view-page')
  if (!activePage) return

  document.querySelectorAll('.view-page').forEach((page) => {
    const isActive = page === activePage
    page.classList.toggle('active', isActive)
    page.hidden = !isActive
  })

  if (activeTarget === 'monitorSection') {
    resizeTrendChartSoon()
  }
}

function bindSidebarNavigation() {
  document.querySelectorAll('.nav-item[data-target]').forEach((item) => {
    item.addEventListener('click', () => {
      const targetId = item.getAttribute('data-target')
      const target = targetId ? document.getElementById(targetId) : null
      if (target) {
        syncSidebarNavigation(targetId)
        const page = target.closest('.view-page')
        page?.focus({ preventScroll: true })
      }
    })
  })
}

async function onScenarioSelected(scenario) {
  if (!SCENARIOS[scenario]) return

  // 如果当前在恒速模式，自动退出并切换回场景曲线模式
  if (state.constantSpeedEnabled) {
    state.constantSpeedEnabled = false
    syncSettingUI()
  }

  state.selectedScenario = scenario
  updateScenarioButtons()
  await applyScenarioRuntime()
}

function patchFromConfig(fanData) {
  if (!fanData || !fanData.control) return
  const mode = String(fanData.control.mode || fanData.control.preset || 'office')
  if (SCENARIOS[mode]) {
    state.selectedScenario = mode
    updateScenarioButtons()
  }

  state.constantSpeedEnabled = !!fanData.control.constant_speed_enabled
  state.constantSpeed = clamp(fanData.control.constant_speed ?? 60, 0, 100)
  state.startupTakeoverEnabled = !!fanData.control.startup_takeover_enabled
  syncSettingUI()
  setText('runtimeModeText', controlStatusText())
}

async function saveConfig() {
  const payload = buildPayload()
  await invokeBackend('save_fan_config', { fanData: payload })
  if (state.running) {
    await invokeBackend('update_fan_policy', { fanData: payload })
  }
}

async function loadConfig() {
  const fanData = await invokeBackend('load_fan_config')
  patchFromConfig(fanData)
}

async function startControl() {
  const payload = buildPayload()
  await invokeBackend('start_fan_control', { fanData: payload })
  setRunningUI(true)
  setText('runtimeModeText', controlStatusText())
  setDot('modeStatusDot', 'active')
}

async function stopControl() {
  await invokeBackend('stop_fan_control')
  setRunningUI(false)
}

async function refreshRuntimeMode() {
  try {
    if (state.constantSpeedEnabled) {
      setText('runtimeModeText', controlStatusText())
      return
    }
    const mode = await invokeBackend('get_current_fan_mode', undefined, POLL_TIMEOUT_MS)
    if (!mode) return
    const label = SCENARIOS[mode] ? SCENARIOS[mode].label : mode
    setText('runtimeModeText', `模式: ${label}`)
  } catch {
    // ignore polling failures
  }
}

function setActorHealth(stateText, dotState) {
  setText('actorStateValue', stateText)
  setDot('actorStateDot', dotState)
}

async function refreshActorSnapshot() {
  try {
    const snap = await invokeBackend('get_fan_control_snapshot', undefined, POLL_TIMEOUT_MS)
    if (!snap) return null

    const runningText = snap.running ? '运行中' : '已停止'
    const modeText = snap.active_mode || '--'
    const controlText = snap.constant_mode ? `恒速 ${snap.constant_speed}%` : '曲线'
    const dropped = Number(snap.dropped_samples ?? 0)
    const sampledAt = snap.sampled_at_ms ? new Date(Number(snap.sampled_at_ms)).toLocaleTimeString() : '--'
    const cpuTemp = clamp(snap.cpu_temp ?? 0, 0, 110)
    const gpuTemp = clamp(snap.gpu_temp ?? 0, 0, 110)
    const cpuFan = clamp(snap.cpu_fan_rpm ?? 0, 0, 7000)
    const gpuFan = clamp(snap.gpu_fan_rpm ?? 0, 0, 7000)

    const cpuPowerText = formatPowerPair(snap.cpu_power_limit_w, snap.cpu_power_short_w)
    const gpuPowerText = formatPowerPair(snap.gpu_power_limit_w, snap.gpu_power_short_w)
    setText(
      'cpuPowerValue',
      cpuPowerText !== '--' || !state.lastTdp ? cpuPowerText : formatPowerPair(state.lastTdp.cpu1, state.lastTdp.cpu2),
    )
    setText(
      'gpuPowerValue',
      gpuPowerText !== '--' || !state.lastTdp ? gpuPowerText : formatPowerPair(state.lastTdp.gpu1, state.lastTdp.gpu2),
    )
    setText('actorRunningValue', runningText)
    setText('actorModeValue', modeText)
    setText('actorControlValue', controlText)
    setText('actorDroppedValue', String(dropped))
    setText('actorSampleAtValue', sampledAt)
    assessFanSafety(cpuTemp, gpuTemp, cpuFan, gpuFan, 'actor_snapshot')

    if (!snap.running) {
      setActorHealth('空闲', 'idle')
      return
    }

    if (dropped > 0) {
      setActorHealth('背压丢样', 'warn')
    } else {
      setActorHealth('正常', 'active')
    }
    return snap
  } catch {
    setActorHealth('不可用', 'danger')
  }
}

function enableLowPowerMode(reason) {
  if (state.lowPowerMode) return
  state.lowPowerMode = true
  document.body.classList.add('low-power-mode')
  document.body.dataset.uiHealth = 'recovering'
  diagLog('warn', 'ui.low_power.enabled', { reason })
  console.warn('[NUCtool] low power UI mode enabled:', reason)
  showToast('界面检测到卡顿，已自动降低玻璃特效和图表刷新频率。')
}

function startUiHealthMonitor() {
  if (state.uiHealthPoller) return
  let last = performance.now()
  let strikes = 0

  state.uiHealthPoller = window.setInterval(() => {
    const now = performance.now()
    const drift = now - last - 2000
    last = now

    if (drift > 900) {
      strikes += 1
      diagLog('warn', 'ui.event_loop.drift', {
        driftMs: Math.round(drift),
        strikes,
      })
      if (drift >= HARD_RECOVERY_DRIFT_MS) {
        queueHardRecovery('event_loop_drift', {
          driftMs: Math.round(drift),
          strikes,
        })
      }
    } else {
      strikes = Math.max(0, strikes - 1)
    }

    if (strikes >= 2) {
      enableLowPowerMode(`event-loop drift ${Math.round(drift)}ms`)
    }
  }, 2000)
}

function recoverAfterResume(reason) {
  const now = performance.now()
  if (state.cpuPowerBusy || state.resumeRecovering || now - state.lastResumeRecoverAt < RESUME_RECOVERY_COOLDOWN_MS) {
    if (now - state.lastResumeSkipLogAt > RESUME_SKIP_LOG_INTERVAL_MS) {
      state.lastResumeSkipLogAt = now
      diagLog('debug', 'resume.skipped', {
        reason,
        cpuPowerBusy: state.cpuPowerBusy,
        resumeRecovering: state.resumeRecovering,
        sinceLastMs: Math.round(now - state.lastResumeRecoverAt),
      })
    }
    return
  }

  diagLog('info', 'resume.start', { reason })
  state.resumeRecovering = true
  state.lastResumeRecoverAt = now
  state.modePollInFlight = false
  state.actorPollInFlight = false
  state.realtimeFramePending = false
  state.chartLastUpdateAt = 0
  enableLowPowerMode(`resume: ${reason}`)

  window.setTimeout(() => {
    try {
      if (state.trendChart) {
        state.trendChart.resize()
        state.trendChart.update('none')
      }
    } catch (error) {
      diagLog('warn', 'resume.chart_failed', { error: safeError(error) })
      console.warn('[NUCtool] chart resume failed:', error)
    }

    const shouldRefreshCpuPower = now - state.lastCpuPowerRefreshAt > RESUME_TDP_REFRESH_INTERVAL_MS
    const cpuPowerTask = shouldRefreshCpuPower
      ? refreshCpuPowerMode({ silent: true })
      : Promise.resolve('skipped_recent_cpu_power_refresh')

    Promise.allSettled([
      invokeBackend('get_fan_speeds', undefined, POLL_TIMEOUT_MS),
      refreshActorSnapshot(),
      refreshRuntimeMode(),
      cpuPowerTask,
    ]).then((results) => {
      diagLog('info', 'resume.refresh_done', { reason, shouldRefreshCpuPower, results })
    }).finally(() => {
      state.resumeRecovering = false
      diagLog('info', 'resume.done', { reason })
    })
  }, 250)
}

function bindResumeRecovery() {
  document.addEventListener('visibilitychange', () => {
    sendFrontendHeartbeat('visibilitychange')
    diagLog('info', 'page.visibilitychange', { hidden: document.hidden, visibility: document.visibilityState })
    if (!document.hidden) recoverAfterResume('visible')
  })

  window.addEventListener('focus', () => {
    const now = performance.now()
    if (now - state.lastFocusEventAt < FOCUS_EVENT_COOLDOWN_MS) return
    state.lastFocusEventAt = now
    sendFrontendHeartbeat('focus')
    diagLog('info', 'window.focus', {})
    recoverAfterResume('focus')
  })

  window.addEventListener('pageshow', () => {
    sendFrontendHeartbeat('pageshow')
    diagLog('info', 'page.pageshow', {})
    recoverAfterResume('pageshow')
  })

  listen('nuctool-resume', (event) => {
    const payload = event?.payload || 'resume'
    if (payload === 'resize') return
    diagLog('info', 'tauri.nuctool_resume', { payload })
    recoverAfterResume(`tauri:${payload}`)
  }).catch((error) => {
    diagLog('warn', 'tauri.resume_listener_failed', { error: safeError(error) })
    console.warn('[NUCtool] resume listener failed:', error)
  })
}

function bindEvents() {
  bindSidebarNavigation()

  document.querySelectorAll('.power-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = String(btn.getAttribute('data-power-mode') || 'balanced')
      applyCpuPowerMode(mode)
    })
  })

  byId('refreshPowerButton')?.addEventListener('click', () => {
    if (!state.cpuPowerBusy) refreshCpuPowerMode()
  })

  byId('displayRefreshSelect')?.addEventListener('change', (event) => {
    const hz = Math.round(Number(event.target.value || 0))
    state.selectedDisplayRefreshHz = Number.isFinite(hz) && hz > 0 ? hz : null
    syncDisplayRefreshUI()
  })

  byId('applyDisplayRefreshButton')?.addEventListener('click', () => {
    applyDisplayRefreshRate()
  })

  byId('refreshDisplayRefreshButton')?.addEventListener('click', () => {
    refreshDisplayRefreshStatus({ force: true })
  })

  byId('refreshDiagnosticsButton')?.addEventListener('click', () => {
    refreshDiagnosticSummary()
  })

  byId('forceSentinelTestButton')?.addEventListener('click', () => {
    runSentinelSelfTest()
  })

  byId('refreshVendorStatusButton')?.addEventListener('click', () => {
    refreshVendorServiceStatus()
  })

  document.querySelectorAll('.whisper-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.whisperMode = normalizeWhisperMode(btn.getAttribute('data-whisper-mode'))
      syncWhisperUI()
    })
  })

  byId('whisperFpsRange')?.addEventListener('input', (event) => {
    state.whisperFps = clamp(event.target.value, 0, 240)
    syncWhisperUI()
  })

  byId('applyWhisperButton')?.addEventListener('click', () => {
    applyVendorWhisper()
  })

  document.querySelectorAll('.battery-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.batteryMode = normalizeBatteryMode(btn.getAttribute('data-battery-mode'))
      syncBatteryUI()
    })
  })

  byId('batteryLevelRange')?.addEventListener('input', (event) => {
    state.batteryLevel = clamp(event.target.value, 50, 100)
    syncBatteryUI()
  })

  byId('applyBatteryButton')?.addEventListener('click', () => {
    applyVendorBattery()
  })

  byId('lightingColorInput')?.addEventListener('input', (event) => {
    state.lightingColor = String(event.target.value || '#ffffff')
    persistLightingPreference()
    syncLightingUI()
  })

  byId('keyboardBrightnessRange')?.addEventListener('input', (event) => {
    state.keyboardBrightness = clamp(event.target.value, 0, 100)
    persistLightingPreference()
    syncLightingUI()
  })

  byId('lightbarBrightnessRange')?.addEventListener('input', (event) => {
    state.lightbarBrightness = clamp(event.target.value, 0, 100)
    persistLightingPreference()
    syncLightingUI()
  })

  byId('applyLightingButton')?.addEventListener('click', () => {
    applyVendorLighting()
  })

  document.querySelectorAll('.scene-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const scenario = String(btn.getAttribute('data-scenario') || 'office')
      onScenarioSelected(scenario).catch((error) => {
        showToast(`切换场景失败\n${error}`)
      })
    })
  })

  byId('startStopButton').addEventListener('click', async () => {
    try {
      if (state.running) {
        await stopControl()
      } else {
        await startControl()
      }
    } catch (error) {
      showToast(`控制操作失败\n${error}`)
    }
  })

  byId('autostartButton').addEventListener('click', async () => {
    try {
      await toggleAutostart()
    } catch (error) {
      showToast(`设置开机自启失败\n${error}`)
    }
  })

  byId('startupTakeoverCheckbox').addEventListener('change', (event) => {
    state.startupTakeoverEnabled = !!event.target.checked
  })

  byId('enableScenarioButton').addEventListener('click', async () => {
    state.constantSpeedEnabled = false
    syncSettingUI()
    setText('runtimeModeText', controlStatusText())
    try {
      await applyScenarioRuntime()
    } catch (error) {
      showToast(`切换场景模式失败\n${error}`)
    }
  })

  byId('enableConstantButton').addEventListener('click', async () => {
    state.constantSpeedEnabled = true
    syncSettingUI()
    setText('runtimeModeText', controlStatusText())
    try {
      await applyScenarioRuntime()
    } catch (error) {
      showToast(`切换恒速模式失败\n${error}`)
    }
  })

  byId('constantSpeedRange').addEventListener('input', (event) => {
    state.constantSpeed = clamp(event.target.value, 0, 100)
    setText('constantSpeedValue', `${state.constantSpeed}%`)
    setText('runtimeModeText', controlStatusText())
  })

  byId('constantSpeedRange').addEventListener('change', async (event) => {
    state.constantSpeed = clamp(event.target.value, 0, 100)
    if (state.constantSpeedEnabled) {
      try {
        await applyScenarioRuntime()
      } catch (error) {
        showToast(`更新恒速失败\n${error}`)
      }
    }
  })

  byId('toggleMonitorModeButton').addEventListener('click', () => {
    setMonitorModeUI(!state.monitorMode, { persist: true })
  })

  byId('saveConfigButton').addEventListener('click', async () => {
    try {
      await saveConfig()
      showToast('场景已保存')
    } catch (error) {
      showToast(`保存失败\n${error}`)
    }
  })

  byId('loadConfigButton').addEventListener('click', async () => {
    try {
      await loadConfig()
      await applyScenarioRuntime()
      showToast('已加载上次场景')
    } catch (error) {
      showToast(`加载失败\n${error}`)
    }
  })
}

async function bindRealtime() {
  if (state.realtimeUnlisten) return
  diagLog('info', 'realtime.bind.start', {})
  state.realtimeUnlisten = await listen('get-fan-speeds', (event) => {
    scheduleRealtimeFrame(event.payload || {})
  })
  diagLog('info', 'realtime.bind.done', {})
}

async function init() {
  diagLog('info', 'app.init.start', {
    userAgent: navigator.userAgent,
    href: window.location.href,
  })
  updateScenarioButtons()
  syncSidebarNavigation('overviewSection')
  bindEvents()
  bindResumeRecovery()
  await bindRealtime()
  startUiHealthMonitor()
  setMonitorModeUI(readMonitorModePreference(), { persist: false })
  restoreLightingPreference()
  syncSettingUI()
  state.cpuPowerMode = readCpuPowerPreference()
  state.selectedDisplayRefreshHz = readDisplayRefreshPreference()
  syncCpuPowerUI()
  syncDisplayRefreshUI()

  await invokeBackend('get_fan_speeds')

  try {
    await loadConfig()
  } catch {
    // keep default scenario
  }

  setRunningUI(false)
  setText('runtimeModeText', controlStatusText())
  updateScenarioRecommendations(0, 0)

  try {
    await refreshAutostartStatus()
  } catch {
    state.autostartEnabled = false
    setAutostartButtonText()
  }

  refreshVendorServiceStatus({ silent: true })
  refreshDisplayRefreshStatus({ silent: true })
  if (state.vendorPoller) {
    clearInterval(state.vendorPoller)
  }
  state.vendorPoller = setInterval(() => {
    refreshVendorServiceStatus({ silent: true })
  }, VENDOR_STATUS_REFRESH_MS)

  refreshDiagnosticSummary({ silent: true })
  if (state.diagnosticPoller) {
    clearInterval(state.diagnosticPoller)
  }
  state.diagnosticPoller = setInterval(() => {
    refreshDiagnosticSummary({ silent: true })
  }, DIAGNOSTIC_REFRESH_MS)

  window.setTimeout(() => {
    applyCpuPowerMode(state.cpuPowerMode, { silent: true, skipSystemProfile: true })
      .then(() => refreshCpuPowerMode({ silent: true }))
      .catch((error) => {
        diagLog('warn', 'power.startup_apply.failed', { error: safeError(error) })
      })
  }, 900)

  if (state.autostartEnabled && state.startupTakeoverEnabled && !state.running) {
    try {
      await startControl()
    } catch (error) {
      showToast(`自动接管失败\n${error}`)
    }
  }

  if (state.modePoller) {
    clearInterval(state.modePoller)
  }
  state.modePoller = setInterval(() => {
    if (state.modePollInFlight) return
    state.modePollInFlight = true
    refreshRuntimeMode().finally(() => {
      state.modePollInFlight = false
    })
  }, 2500)

  const initialActorSnap = await refreshActorSnapshot()
  if (initialActorSnap?.running) {
    setRunningUI(true)
    if (SCENARIOS[initialActorSnap.active_mode]) {
      state.selectedScenario = initialActorSnap.active_mode
      updateScenarioButtons()
    }
    state.constantSpeedEnabled = !!initialActorSnap.constant_mode
    state.constantSpeed = clamp(initialActorSnap.constant_speed ?? state.constantSpeed, 0, 100)
    syncSettingUI()
    setText('runtimeModeText', controlStatusText())
    setDot('modeStatusDot', 'active')
  }
  if (state.actorPoller) {
    clearInterval(state.actorPoller)
  }
  state.actorPoller = setInterval(() => {
    if (state.actorPollInFlight) return
    state.actorPollInFlight = true
    refreshActorSnapshot().finally(() => {
      state.actorPollInFlight = false
    })
  }, 1200)
  diagLog('info', 'app.init.done', {})
}

document.addEventListener('DOMContentLoaded', () => {
  startFrontendHeartbeat()
  diagLog('info', 'dom.content_loaded', {})
  init().catch((error) => {
    diagLog('error', 'app.init.failed', { error: safeError(error) })
    showToast(`页面初始化失败\n${error}`)
  })
})

window.addEventListener('beforeunload', () => {
  diagLog('info', 'window.beforeunload', {})
  if (typeof state.realtimeUnlisten === 'function') {
    try { state.realtimeUnlisten() } catch {}
  }
  if (state.modePoller) window.clearInterval(state.modePoller)
  if (state.actorPoller) window.clearInterval(state.actorPoller)
  if (state.vendorPoller) window.clearInterval(state.vendorPoller)
  if (state.diagnosticPoller) window.clearInterval(state.diagnosticPoller)
  if (state.uiHealthPoller) window.clearInterval(state.uiHealthPoller)
  if (state.displayRefreshRefreshTimer) window.clearTimeout(state.displayRefreshRefreshTimer)
  if (frontendHeartbeatTimer) window.clearInterval(frontendHeartbeatTimer)
  if (state.trendChart) state.trendChart.destroy()
})

window.addEventListener('error', (event) => {
  diagLog('error', 'window.error', {
    message: event.message,
    source: event.filename,
    line: event.lineno,
    column: event.colno,
    error: safeError(event.error),
  })
})

window.addEventListener('unhandledrejection', (event) => {
  diagLog('error', 'window.unhandledrejection', {
    reason: safeError(event.reason) || String(event.reason),
  })
})
