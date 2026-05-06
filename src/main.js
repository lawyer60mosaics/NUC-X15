const tauriCore = window.__TAURI__?.core || {
  invoke: async (name) => {
    if (name === 'get_fan_control_snapshot') {
      return {
        running: false,
        active_mode: 'office',
        constant_mode: false,
        constant_speed: 60,
        dropped_samples: 0,
        sampled_at_ms: Date.now(),
      }
    }
    if (name === 'autostart_status' || name === 'autostart_set') return false
    if (name === 'get_current_fan_mode') return 'office'
    if (name === 'get_tdp') return [45, 65, 0, 0, 0]
    if (name === 'set_tdp' || name === 'set_cpu_tdp' || name === 'lock_cpu_tdp') return true
    if (name === 'frontend_heartbeat' || name === 'frontend_diag_log') return true
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
const NOISY_INVOKE_COMMANDS = new Set(['get_fan_control_snapshot', 'get_current_fan_mode'])

let diagSeq = 0
let frontendHeartbeatSeq = 0
let frontendHeartbeatTimer = null

function safeError(error) {
  if (!error) return null
  return {
    message: String(error.message || error),
    stack: error.stack ? String(error.stack).slice(0, 1600) : null,
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
}

const CURVE_TEMPS = [35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85]
const HISTORY_POINTS = 21
const MONITOR_MODE_STORAGE_KEY = 'nuctool.monitorModeOnStartup'
const CPU_POWER_STORAGE_KEY = 'nuctool.cpuPowerMode'
const TDP_TIMEOUT_MS = 11000
const CPU_POWER_PROFILES = {
  performance: {
    label: '性能',
    cpu1: 55,
    cpu2: 80,
    desc: '适合游戏和重负载，保留更高睿频空间。',
  },
  balanced: {
    label: '平衡',
    cpu1: 40,
    cpu2: 60,
    desc: '日常推荐，明显降低发热与风扇压力。',
  },
  powersave: {
    label: '省电',
    cpu1: 25,
    cpu2: 38,
    desc: '优先安静和续航，适合办公、浏览和轻负载。',
  },
}
const TREND_COLORS = {
  cpuTemp: '#ffffff',
  gpuTemp: '#e50914',
  cpuFan: '#ff4d57',
  gpuFan: '#9b111e',
  axis: 'rgba(255, 255, 255, 0.68)',
  grid: 'rgba(229, 9, 20, 0.14)',
}

const state = {
  running: false,
  selectedScenario: 'office',
  trendChart: null,
  modePoller: null,
  actorPoller: null,
  uiHealthPoller: null,
  realtimeUnlisten: null,
  latestRealtime: null,
  realtimeFramePending: false,
  chartLastUpdateAt: 0,
  lowPowerMode: false,
  modePollInFlight: false,
  actorPollInFlight: false,
  resumeRecovering: false,
  lastResumeRecoverAt: 0,
  monitorMode: false,
  autostartEnabled: false,
  startupTakeoverEnabled: false,
  constantSpeedEnabled: false,
  constantSpeed: 60,
  cpuPowerMode: 'balanced',
  cpuPowerBusy: false,
  lastTdp: null,
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

function setDot(id, dotState) {
  const el = byId(id)
  if (el) el.setAttribute('data-state', dotState)
}

function invokeBackend(command, args, timeoutMs = BACKEND_TIMEOUT_MS) {
  const callId = `${command}#${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`
  const started = performance.now()
  diagLog('debug', 'invoke.start', { callId, command, timeoutMs, args })
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
        result,
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
  setText('cpuPowerHint', profile.desc)

  if (state.lastTdp) {
    setText('cpuPowerCurrentValue', `${state.lastTdp.cpu1}W / ${state.lastTdp.cpu2}W`)
  } else {
    setText('cpuPowerCurrentValue', '--')
  }
}

async function refreshCpuPowerMode() {
  try {
    const tdp = normalizeTdp(await invokeBackend('get_tdp', undefined, TDP_TIMEOUT_MS))
    state.lastTdp = tdp
    syncCpuPowerUI()
  } catch (error) {
    syncCpuPowerUI()
    showToast(`读取 CPU 功耗失败\n${error}`)
  }
}

async function applyCpuPowerMode(mode, options = {}) {
  const profile = CPU_POWER_PROFILES[mode]
  if (!profile || state.cpuPowerBusy) return

  setCpuPowerBusy(true)
  try {
    const applied = await invokeBackend('lock_cpu_tdp', {
      cpu1: profile.cpu1,
      cpu2: profile.cpu2,
    }, TDP_TIMEOUT_MS)
    if (applied !== true) {
      throw new Error('硬件读回校验未通过，CPU 功耗锁定没有生效')
    }

    const current = state.lastTdp || normalizeTdp(await invokeBackend('get_tdp', undefined, TDP_TIMEOUT_MS))
    state.lastTdp = {
      ...current,
      cpu1: profile.cpu1,
      cpu2: profile.cpu2,
    }
    state.cpuPowerMode = mode
    persistCpuPowerPreference(mode)
    syncCpuPowerUI()
    if (!options.silent) {
      showToast(`CPU 功耗已锁定为 ${profile.label}: ${profile.cpu1}W / ${profile.cpu2}W`)
    }
  } catch (error) {
    showToast(`锁定 CPU 功耗失败\n${error}`)
  } finally {
    setCpuPowerBusy(false)
  }
}

function monitorModeLabel() {
  return state.monitorMode ? '退出大屏监控' : '进入大屏监控'
}

function setMonitorModeUI(enabled, options = {}) {
  state.monitorMode = enabled
  document.body.classList.toggle('monitor-mode', enabled)
  setText('toggleMonitorModeButton', monitorModeLabel())
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

function updateAlert(cpuTemp, gpuTemp) {
  const strip = byId('alertStrip')
  const liveStrip = byId('liveStrip')
  const liveStripText = byId('liveStripText')
  if (!strip) return

  if (cpuTemp >= 90 || gpuTemp >= 90) {
    strip.classList.add('visible')
    strip.textContent = `过温警告：CPU ${cpuTemp}°C / GPU ${gpuTemp}°C，建议切换到“性能场景”。`
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
  if (hottest >= 90) return 'performance'
  if (hottest >= 80) return 'gaming'
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

  return new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: Array.from({ length: HISTORY_POINTS }, (_, i) => `${(HISTORY_POINTS - 1 - i) * 3}s`),
      datasets: [
        {
          label: 'CPU 温度',
          data: Array(HISTORY_POINTS).fill(0),
          borderColor: TREND_COLORS.cpuTemp,
          backgroundColor: 'rgba(255, 118, 64, 0.10)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
          fill: true,
          yAxisID: 'temp',
        },
        {
          label: 'GPU 温度',
          data: Array(HISTORY_POINTS).fill(0),
          borderColor: TREND_COLORS.gpuTemp,
          backgroundColor: 'rgba(255, 56, 96, 0.10)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
          fill: true,
          yAxisID: 'temp',
        },
        {
          label: 'CPU 风扇 RPM',
          data: Array(HISTORY_POINTS).fill(0),
          borderColor: TREND_COLORS.cpuFan,
          backgroundColor: 'rgba(77, 158, 255, 0.08)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
          fill: false,
          yAxisID: 'rpm',
        },
        {
          label: 'GPU 风扇 RPM',
          data: Array(HISTORY_POINTS).fill(0),
          borderColor: TREND_COLORS.gpuFan,
          backgroundColor: 'rgba(255, 179, 64, 0.08)',
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
            color: TREND_COLORS.axis,
            font: { size: 11 },
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: TREND_COLORS.axis,
            autoSkip: true,
            maxTicksLimit: 8,
            maxRotation: 0,
          },
          grid: {
            color: TREND_COLORS.grid,
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
            color: TREND_COLORS.axis,
            font: { size: 11 },
          },
          ticks: { color: TREND_COLORS.axis },
          grid: { color: TREND_COLORS.grid },
        },
        rpm: {
          type: 'linear',
          position: 'right',
          min: 0,
          max: 7000,
          title: {
            display: true,
            text: '风扇 (RPM)',
            color: TREND_COLORS.axis,
            font: { size: 11 },
          },
          ticks: { color: TREND_COLORS.axis },
          grid: {
            drawOnChartArea: false,
          },
        },
      },
    },
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
  if (document.hidden || !state.trendChart) return false
  const interval = state.lowPowerMode
    ? LOW_POWER_CHART_UPDATE_INTERVAL_MS
    : CHART_UPDATE_INTERVAL_MS
  return now - state.chartLastUpdateAt >= interval
}

function renderRealtimeFrame() {
  state.realtimeFramePending = false
  const payload = state.latestRealtime
  if (!payload) return

  const cpuTemp = clamp(payload.left_temp ?? 0, 0, 110)
  const gpuTemp = clamp(payload.right_temp ?? 0, 0, 110)
  const cpuFan = clamp(payload.left_fan_speed ?? 0, 0, 7000)
  const gpuFan = clamp(payload.right_fan_speed ?? 0, 0, 7000)

  setText('cpuTempValue', cpuTemp || '--')
  setText('gpuTempValue', gpuTemp || '--')
  setText('cpuFanValue', cpuFan || '--')
  setText('gpuFanValue', gpuFan || '--')

  const detail = { cpuTemp, gpuTemp, cpuFan, gpuFan }
  document.dispatchEvent(new CustomEvent('nuctool-metrics', { detail }))

  updateAlert(cpuTemp, gpuTemp)
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

async function applyScenarioRuntime() {
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

function updateScenarioButtons() {
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
  })
}

function bindSidebarNavigation() {
  document.querySelectorAll('.nav-item[data-target]').forEach((item) => {
    item.addEventListener('click', () => {
      const targetId = item.getAttribute('data-target')
      const target = targetId ? document.getElementById(targetId) : null
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' })
        syncSidebarNavigation(targetId)
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

    setText('actorRunningValue', runningText)
    setText('actorModeValue', modeText)
    setText('actorControlValue', controlText)
    setText('actorDroppedValue', String(dropped))
    setText('actorSampleAtValue', sampledAt)

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
  if (state.resumeRecovering || now - state.lastResumeRecoverAt < 2500) {
    diagLog('debug', 'resume.skipped', {
      reason,
      resumeRecovering: state.resumeRecovering,
      sinceLastMs: Math.round(now - state.lastResumeRecoverAt),
    })
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

    Promise.allSettled([
      invokeBackend('get_fan_speeds', undefined, POLL_TIMEOUT_MS),
      refreshActorSnapshot(),
      refreshRuntimeMode(),
      refreshCpuPowerMode(),
    ]).then((results) => {
      diagLog('info', 'resume.refresh_done', { reason, results })
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
    diagLog('info', 'tauri.nuctool_resume', { payload: event?.payload })
    recoverAfterResume(`tauri:${event?.payload || 'resume'}`)
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
  state.trendChart = makeTrendChart()
  updateScenarioButtons()
  syncSidebarNavigation('overviewSection')
  bindEvents()
  bindResumeRecovery()
  await bindRealtime()
  startUiHealthMonitor()
  setMonitorModeUI(readMonitorModePreference(), { persist: false })
  syncSettingUI()
  state.cpuPowerMode = readCpuPowerPreference()
  syncCpuPowerUI()

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

  window.setTimeout(() => {
    applyCpuPowerMode(state.cpuPowerMode, { silent: true })
      .then(() => refreshCpuPowerMode())
      .catch((error) => {
        showToast(`后台锁定 CPU 功耗失败\n${error}`)
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
  if (state.uiHealthPoller) window.clearInterval(state.uiHealthPoller)
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
