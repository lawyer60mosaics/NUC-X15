<template>
  <div class="app-shell">
    <div class="ambient ambient-a"></div>
    <div class="ambient ambient-b"></div>

    <el-card class="surface hero-panel" shadow="never">
      <div class="hero-copy">
        <p class="eyebrow">NUCTOOL · 风控矩阵</p>
        <h1>苏州式留白，安静地组织状态</h1>
        <p class="hero-desc">
          以青灰、留白和细线条重建信息层级，把趋势放在主位，把控制收回到辅助位。
        </p>
      </div>

      <div class="hero-aside">
        <div class="hero-statusline">
          <span class="status-pill" :class="{ 'is-live': isRunning }">
            {{ isRunning ? '运行中' : '待机' }}
          </span>
          <span>{{ activeScenario.label }}</span>
          <span>·</span>
          <span>{{ sceneModeEnabled ? '场景控制' : '恒速控制' }}</span>
        </div>

        <div class="hero-meta">
          <div>CPU {{ metrics.cpuTemp ?? '--' }}°</div>
          <div>GPU {{ metrics.gpuTemp ?? '--' }}°</div>
          <div>CPU {{ metrics.cpuFan ?? '--' }} RPM</div>
          <div>GPU {{ metrics.gpuFan ?? '--' }} RPM</div>
        </div>

        <div class="hero-actions">
          <div class="autostart-line">
            <span>开机自启</span>
            <el-switch v-model="autostartEnabled" @change="toggleAutostart" inline-prompt />
          </div>
          <el-tag effect="plain" class="status-tag" :type="configStatus.type">
            {{ configStatus.text }}
          </el-tag>
        </div>
      </div>
    </el-card>

    <el-alert
      v-if="isOverheat"
      title="过温警告：CPU 或 GPU 温度超过 85°C，系统会优先散热。"
      type="error"
      :closable="false"
      class="soft-alert"
      show-icon
    />

    <div class="summary-strip surface">
      <div v-for="item in monitorStrip" :key="item.label" class="summary-item">
        <span class="summary-label">{{ item.label }}</span>
        <strong class="summary-value">{{ item.value }}</strong>
      </div>
    </div>

    <div class="main-grid">
      <aside class="left-column">
        <el-card class="surface module-card" shadow="never">
          <div class="section-head">
            <div>
              <p class="section-kicker">场景</p>
              <h2>静音，办公，游戏，性能</h2>
            </div>
            <div class="section-note">
              {{ suggestedIntensity !== null ? `建议 ${suggestedIntensity}%` : '暂无建议' }}
            </div>
          </div>

          <div class="scene-pills">
            <button
              v-for="opt in modeOptions"
              :key="opt.value"
              class="scene-pill"
              :class="{ active: mode === opt.value, muted: !sceneModeEnabled }"
              :disabled="!sceneModeEnabled"
              @click="mode = opt.value"
            >
              <span>{{ opt.label }}</span>
              <small>{{ opt.detail }}</small>
            </button>
          </div>

          <div class="scenario-footnote">
            {{ activeScenario.tags.join(' · ') }}
          </div>
        </el-card>

        <el-card class="surface module-card" shadow="never">
          <div class="section-head">
            <div>
              <p class="section-kicker">控制</p>
              <h2>{{ sliderTitle }}</h2>
            </div>
            <div class="mode-switch">
              <button class="mode-chip" :class="{ active: sceneModeEnabled }" @click="enableSceneMode">场景</button>
              <button class="mode-chip" :class="{ active: constantSpeedEnabled }" @click="enableConstantMode">恒速</button>
            </div>
          </div>

          <p class="section-caption">{{ sliderHint }}</p>

          <div class="slider-frame">
            <el-slider
              v-if="sceneModeEnabled"
              v-model="intensity"
              :min="0"
              :max="100"
              :step="1"
              :disabled="!sceneModeEnabled"
              :marks="{ 0: '静', 50: '均衡', 100: '性能' }"
              class="slim-slider"
            />
            <el-slider
              v-else
              v-model="constantFanSpeed"
              :min="0"
              :max="100"
              :step="1"
              :disabled="!constantSpeedEnabled"
              :marks="{ 20: '静音', 50: '常用', 80: '高转' }"
              class="slim-slider"
            />
          </div>

          <div class="slider-footline">
            <span v-if="sceneModeEnabled">场景强度 {{ intensity }}%</span>
            <span v-else>固定转速 {{ constantFanSpeed }}%</span>
          </div>
        </el-card>

        <el-card class="surface module-card" shadow="never">
          <div class="section-head compact">
            <div>
              <p class="section-kicker">操作</p>
              <h2>控制、保存、加载</h2>
            </div>
          </div>

          <div class="action-grid">
            <el-button class="action-main" :type="isRunning ? 'danger' : 'primary'" @click="toggleFanControl" :loading="isLoading">
              {{ isRunning ? '停止控制' : '启动控制' }}
            </el-button>
            <el-button class="action-soft" @click="applyQuickMode" :loading="isLoading">快速应用</el-button>
            <el-button class="action-soft" @click="applyCustomCurve" :loading="isLoading">自定义曲线</el-button>
            <el-button class="action-soft" @click="loadConfig" :loading="isLoading">加载配置</el-button>
            <el-button class="action-soft" @click="saveConfig" :loading="isLoading">保存配置</el-button>
          </div>

          <div class="suggest-box" v-if="suggestedIntensity !== null">
            建议值来自最近使用记录，当前可直接应用为 <strong>{{ suggestedIntensity }}%</strong>。
            <el-button size="small" class="suggest-button" @click="applySuggested">应用建议</el-button>
          </div>
        </el-card>
      </aside>

      <section class="right-column">
        <el-card class="surface chart-card chart-primary" shadow="never">
          <template #header>
            <div class="chart-header">
              <div>
                <p class="section-kicker">趋势</p>
                <span class="chart-title">温度曲线</span>
              </div>
              <div class="chart-meta">
                <el-tag effect="plain">CPU {{ metrics.cpuTemp || '--' }}°C</el-tag>
                <el-tag effect="plain">GPU {{ metrics.gpuTemp || '--' }}°C</el-tag>
              </div>
            </div>
          </template>
          <div class="chart-wrapper chart-focus-wrapper">
            <canvas ref="tempChart"></canvas>
          </div>
        </el-card>

        <el-card class="surface chart-card chart-secondary" shadow="never">
          <template #header>
            <div class="chart-header">
              <div>
                <p class="section-kicker">辅助</p>
                <span class="chart-title">风扇转速</span>
              </div>
              <div class="chart-meta">
                <el-tag effect="plain">CPU {{ metrics.cpuFan || 0 }} RPM</el-tag>
                <el-tag effect="plain">GPU {{ metrics.gpuFan || 0 }} RPM</el-tag>
              </div>
            </div>
          </template>
          <div class="chart-wrapper chart-secondary-wrapper">
            <canvas ref="speedChart"></canvas>
          </div>
        </el-card>
      </section>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import {
  Promotion, Sunny, Cpu, WindPower, CircleCheck,
  TrendCharts, DataLine, VideoPlay, VideoPause, Download, Upload,
  Loading, Moon, Setting, Filter, Edit, Lightning
} from '@element-plus/icons-vue'
import Chart from 'chart.js/auto'
import dragDataPlugin from 'chartjs-plugin-dragdata'

Chart.register(dragDataPlugin)

const { listen } = window.__TAURI__.event

// 状态管理
const isRunning = ref(false)
const isLoading = ref(false)
const autostartEnabled = ref(false)
const isDarkMode = ref(false)

const fanStatus = reactive({ type: 'info', text: '风扇待机' })
const configStatus = reactive({ type: 'info', text: '配置未加载' })

const metrics = reactive({ cpuTemp: null, gpuTemp: null, cpuFan: null, gpuFan: null })

// 迷你历史数据（sparkline，保留20个点）
const SPARK_LEN = 20
const cpuTempHistory = ref(Array(SPARK_LEN).fill(0))
const gpuTempHistory = ref(Array(SPARK_LEN).fill(0))
const cpuFanHistory  = ref(Array(SPARK_LEN).fill(0))
const gpuFanHistory  = ref(Array(SPARK_LEN).fill(0))

// 过温计算属性
const isOverheat = computed(() => metrics.cpuTemp > 85 || metrics.gpuTemp > 85)

const isTauriReady = () => !!(window.__TAURI__ && window.__TAURI__.core)

// 快捷模式
const mode = ref('office')
const intensity = ref(50)
const controlMode = ref('scene')
const sceneModeEnabled = computed(() => controlMode.value === 'scene')
const constantSpeedEnabled = computed(() => controlMode.value === 'constant')
const constantFanSpeed = ref(60)
const usageHistory = ref([])

const modeOptions = Object.values(SCENARIOS).map((scenario) => ({
  value: scenario.mode,
  label: scenario.label,
  detail: scenario.tags[0].replace('噪音倾向: ', ''),
}))

const activeScenario = computed(() => SCENARIOS[mode.value] ?? SCENARIOS.office)
const sliderTitle = computed(() => (sceneModeEnabled.value ? '场景强度' : '恒速转速'))
const sliderHint = computed(() => (
  sceneModeEnabled.value
    ? '细线滑条只改变场景的强弱，不打断整体秩序。'
    : '固定风扇节奏，适合保持稳定而安静的运行状态。'
))
const monitorStrip = computed(() => ([
  { label: 'CPU', value: `${metrics.cpuTemp ?? '--'}°` },
  { label: 'GPU', value: `${metrics.gpuTemp ?? '--'}°` },
  { label: 'CPU 风扇', value: `${metrics.cpuFan ?? '--'} RPM` },
  { label: 'GPU 风扇', value: `${metrics.gpuFan ?? '--'} RPM` },
]))

const enableSceneMode = () => {
  controlMode.value = 'scene'
}

const enableConstantMode = () => {
  controlMode.value = 'constant'
}

// Load/save usage history from localStorage
const USAGE_KEY = 'nuctool_quick_usage'

function loadUsageHistory() {
  try {
    const raw = localStorage.getItem(USAGE_KEY)
    if (raw) usageHistory.value = JSON.parse(raw)
  } catch (e) { console.warn('无法加载使用历史', e) }
}

function saveUsageHistory() {
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify(usageHistory.value.slice(-200))) // keep last 200
  } catch (e) { console.warn('无法保存使用历史', e) }
}

// suggested intensity based on recent history for current mode
const suggestedIntensity = computed(() => {
  const modeHist = usageHistory.value.filter(h => h.mode === mode.value)
  if (!modeHist.length) return null
  const last = modeHist.slice(-20) // use last 20
  return Math.round(last.reduce((s, r) => s + r.intensity, 0) / last.length)
})

// 根据模式+强度生成曲线
const buildCurveFromMode = (labels, selectedMode, k) => {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
  return labels.map((t) => {
    const temp = Number(t)
    const base = ((temp - 30) / 60) * 70 + 20
    const shaped = clamp(base, 10, 95)
    let offset = 0, slope = 1
    if (selectedMode === 'silent')      { offset = -14; slope = 0.82 }
    else if (selectedMode === 'balanced') { offset = -4; slope = 1.0 }
    else if (selectedMode === 'performance') { offset = 8; slope = 1.12 }
    else if (selectedMode === 'auto') { offset = -6 + 12 * k; slope = 0.95 + 0.22 * k }
    const highTempGain = clamp((temp - 60) / 30, 0, 1)
    const speed = clamp(shaped * slope + offset + k * 18 + k * 20 * highTempGain, 10, 100)
    return { temperature: temp, speed: Math.round(speed) }
  })
}

// 快捷应用模式
const applyQuickMode = async () => {
  if (!leftFanChartInstance || !rightFanChartInstance) { ElMessage.warning('图表未初始化'); return }
  isLoading.value = true
  try {
    const k = intensity.value / 100
    const leftFanCurve = sceneModeEnabled.value
      ? buildCurveFromMode(leftFanChartInstance.data.labels, mode.value, k)
      : leftFanChartInstance.data.labels.map((temp, i) => ({
        temperature: temp,
        speed: leftFanChartInstance.data.datasets[0].data[i]
      }))
    const rightFanCurve = sceneModeEnabled.value
      ? buildCurveFromMode(rightFanChartInstance.data.labels, mode.value, k)
      : rightFanChartInstance.data.labels.map((temp, i) => ({
        temperature: temp,
        speed: rightFanChartInstance.data.datasets[0].data[i]
      }))

    const fanData = {
      left_fan: leftFanCurve,
      right_fan: rightFanCurve,
      control: {
        constant_speed_enabled: constantSpeedEnabled.value,
        constant_speed: constantFanSpeed.value,
      }
    }
    if (sceneModeEnabled.value) {
      leftFanChartInstance.data.datasets[0].data  = fanData.left_fan.map(p => p.speed)
      rightFanChartInstance.data.datasets[0].data = fanData.right_fan.map(p => p.speed)
      leftFanChartInstance.update()
      rightFanChartInstance.update()
    }
    if (isRunning.value) {
      await window.__TAURI__.core.invoke('stop_fan_control')
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    await window.__TAURI__.core.invoke('start_fan_control', { fanData })
    isRunning.value = true
    fanStatus.type = 'success'; fanStatus.text = '风扇运行中'
    ElMessage.success(sceneModeEnabled.value ? '已应用场景模式' : '已应用恒速模式')

    // 记录使用历史（异步，不阻塞 UI）
    try {
      usageHistory.value.push({ ts: Date.now(), mode: mode.value, intensity: intensity.value })
      saveUsageHistory()
    } catch (e) { console.warn('记录使用历史失败', e) }
  } catch (error) {
    ElMessage.error('应用失败: ' + error)
  } finally {
    isLoading.value = false
  }
}

// 应用当前自定义曲线（使用图表手动调整的数据）
const applyCustomCurve = async () => {
  if (!leftFanChartInstance || !rightFanChartInstance) { ElMessage.warning('图表未初始化'); return }
  isLoading.value = true
  try {
    const fanData = {
      left_fan: leftFanChartInstance.data.labels.map((temp, i) => ({
        temperature: temp, speed: leftFanChartInstance.data.datasets[0].data[i]
      })),
      right_fan: rightFanChartInstance.data.labels.map((temp, i) => ({
        temperature: temp, speed: rightFanChartInstance.data.datasets[0].data[i]
      }))
    }
    if (isRunning.value) {
      await window.__TAURI__.core.invoke('stop_fan_control')
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    await window.__TAURI__.core.invoke('start_fan_control', { fanData })
    isRunning.value = true
    fanStatus.type = 'success'; fanStatus.text = '风扇运行中'
    ElMessage.success('自定义曲线已应用')
  } catch (error) {
    ElMessage.error('应用失败: ' + error)
  } finally {
    isLoading.value = false
  }
}

// canvas refs and chart instances
const leftFanChart = ref(null)
const rightFanChart = ref(null)
const speedChart = ref(null)
const tempChart = ref(null)
let leftFanChartInstance = null
let rightFanChartInstance = null
let speedChartInstance = null
let tempChartInstance = null

// 初始化图表
const initCharts = () => {
  const baseScales = (xTitle, yTitle, yMin, yMax) => ({
    x: {
      grid: { color: 'rgba(0,0,0,0.06)' },
      ticks: { color: '#606266', font: { size: 11 } },
      title: { display: true, text: xTitle, color: '#909399', font: { size: 11 } }
    },
    y: {
      grid: { color: 'rgba(0,0,0,0.06)' },
      ticks: { color: '#606266', font: { size: 11 } },
      title: { display: true, text: yTitle, color: '#909399', font: { size: 11 } },
      min: yMin, max: yMax
    }
  })

  const baseOptions = (xTitle, yTitle, yMin, yMax, extra = {}) => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: { display: true, labels: { color: '#606266', font: { size: 11 }, boxWidth: 12 } },
      tooltip: { backgroundColor: 'rgba(48,49,51,0.9)', titleColor: '#fff', bodyColor: '#ddd' },
      ...extra
    },
    scales: baseScales(xTitle, yTitle, yMin, yMax)
  })

  const curveLabels = Array.from({ length: 15 }, (_, i) => (i + 30) + Math.round(i * 4))

  leftFanChartInstance = new Chart(leftFanChart.value, {
    type: 'line',
    data: {
      labels: curveLabels,
      datasets: [{
        label: 'CPU风扇速度 (%)',
        data: Array(15).fill(50),
        borderColor: '#409EFF',
        backgroundColor: 'rgba(64,158,255,0.08)',
        borderWidth: 2.5,
        pointRadius: 5,
        pointHoverRadius: 8,
        pointBackgroundColor: '#409EFF',
        tension: 0.3,
        fill: true
      }]
    },
    options: baseOptions('温度 (°C)', '风扇速度 (%)', 0, 100, {
      dragData: { round: 0, showTooltip: true, onDrag: (e, di, idx, val) => val >= 0 && val <= 100 }
    })
  })

  rightFanChartInstance = new Chart(rightFanChart.value, {
    type: 'line',
    data: {
      labels: curveLabels,
      datasets: [{
        label: 'GPU风扇速度 (%)',
        data: Array(15).fill(50),
        borderColor: '#67C23A',
        backgroundColor: 'rgba(103,194,58,0.08)',
        borderWidth: 2.5,
        pointRadius: 5,
        pointHoverRadius: 8,
        pointBackgroundColor: '#67C23A',
        tension: 0.3,
        fill: true
      }]
    },
    options: baseOptions('温度 (°C)', '风扇速度 (%)', 0, 100, {
      dragData: { round: 0, showTooltip: true, onDrag: (e, di, idx, val) => val >= 0 && val <= 100 }
    })
  })

  const historyLabels = Array.from({ length: 21 }, (_, i) => i * 3 + 's')

  speedChartInstance = new Chart(speedChart.value, {
    type: 'line',
    data: {
      labels: historyLabels,
      datasets: [
        { label: 'CPU风扇', data: Array(21).fill(0), borderColor: '#409EFF', backgroundColor: 'rgba(64,158,255,0.08)', borderWidth: 2, pointRadius: 0, tension: 0.4, fill: true },
        { label: 'GPU风扇', data: Array(21).fill(0), borderColor: '#67C23A', backgroundColor: 'rgba(103,194,58,0.08)', borderWidth: 2, pointRadius: 0, tension: 0.4, fill: true }
      ]
    },
    options: baseOptions('时间', '转速 (RPM)', 0, 6000)
  })

  tempChartInstance = new Chart(tempChart.value, {
    type: 'line',
    data: {
      labels: historyLabels,
      datasets: [
        { label: 'CPU温度', data: Array(21).fill(0), borderColor: '#F56C6C', backgroundColor: 'rgba(245,108,108,0.08)', borderWidth: 2, pointRadius: 0, tension: 0.4, fill: true },
        { label: 'GPU温度', data: Array(21).fill(0), borderColor: '#E6A23C', backgroundColor: 'rgba(230,162,60,0.08)',  borderWidth: 2, pointRadius: 0, tension: 0.4, fill: true }
      ]
    },
    options: baseOptions('时间', '温度 (°C)', 0, 100)
  })
}

const pushSpark = (arr, val, max = SPARK_LEN) => {
  arr.push(val ?? 0)
  if (arr.length > max) arr.shift()
}

const updateMetrics = (data) => {
  metrics.cpuTemp = data.left_temp
  metrics.gpuTemp = data.right_temp
  metrics.cpuFan  = data.left_fan_speed
  metrics.gpuFan  = data.right_fan_speed

  pushSpark(cpuTempHistory.value, data.left_temp)
  pushSpark(gpuTempHistory.value, data.right_temp)
  pushSpark(cpuFanHistory.value,  data.left_fan_speed)
  pushSpark(gpuFanHistory.value,  data.right_fan_speed)

  if (speedChartInstance) {
    speedChartInstance.data.datasets[0].data.push(data.left_fan_speed)
    speedChartInstance.data.datasets[0].data.shift()
    speedChartInstance.data.datasets[1].data.push(data.right_fan_speed)
    speedChartInstance.data.datasets[1].data.shift()
    speedChartInstance.update('none')
  }
  if (tempChartInstance) {
    tempChartInstance.data.datasets[0].data.push(data.left_temp)
    tempChartInstance.data.datasets[0].data.shift()
    tempChartInstance.data.datasets[1].data.push(data.right_temp)
    tempChartInstance.data.datasets[1].data.shift()
    tempChartInstance.update('none')
  }
}

const toggleFanControl = async () => {
  isLoading.value = true
  try {
    if (!isRunning.value) {
      const fanData = {
        left_fan: leftFanChartInstance.data.labels.map((temp, i) => ({
          temperature: temp, speed: leftFanChartInstance.data.datasets[0].data[i]
        })),
        right_fan: rightFanChartInstance.data.labels.map((temp, i) => ({
          temperature: temp, speed: rightFanChartInstance.data.datasets[0].data[i]
        })),
        control: {
          constant_speed_enabled: constantSpeedEnabled.value,
          constant_speed: constantFanSpeed.value,
        }
      }
      await window.__TAURI__.core.invoke('start_fan_control', { fanData })
      isRunning.value = true
      fanStatus.type = 'success'; fanStatus.text = '风扇运行中'
      ElMessage.success('风扇控制已启动')
    } else {
      await window.__TAURI__.core.invoke('stop_fan_control')
      isRunning.value = false
      fanStatus.type = 'info'; fanStatus.text = '风扇待机'
      ElMessage.info('风扇控制已停止')
    }
  } catch (error) {
    ElMessage.error('操作失败: ' + error)
  } finally {
    isLoading.value = false
  }
}

const loadConfig = async () => {
  isLoading.value = true
  try {
    const fanData = await window.__TAURI__.core.invoke('load_fan_config')
    leftFanChartInstance.data.datasets[0].data  = fanData.left_fan.map(p => p.speed)
    rightFanChartInstance.data.datasets[0].data = fanData.right_fan.map(p => p.speed)
    leftFanChartInstance.update()
    rightFanChartInstance.update()
    configStatus.type = 'success'; configStatus.text = '配置已加载'
    ElMessage.success('配置加载成功')
  } catch (error) {
    configStatus.type = 'warning'; configStatus.text = '配置加载失败'
    ElMessage.warning('配置加载失败: ' + error)
  } finally {
    isLoading.value = false
  }
}

const saveConfig = async () => {
  isLoading.value = true
  try {
    const fanData = {
      left_fan: leftFanChartInstance.data.labels.map((temp, i) => ({
        temperature: temp, speed: leftFanChartInstance.data.datasets[0].data[i]
      })),
      right_fan: rightFanChartInstance.data.labels.map((temp, i) => ({
        temperature: temp, speed: rightFanChartInstance.data.datasets[0].data[i]
      })),
      control: {
        constant_speed_enabled: constantSpeedEnabled.value,
        constant_speed: constantFanSpeed.value,
      }
    }
    await window.__TAURI__.core.invoke('save_fan_config', { fanData })
    configStatus.type = 'success'; configStatus.text = '配置已保存'
    ElMessage.success('配置保存成功')
    setTimeout(() => { configStatus.text = '配置已加载' }, 3000)
  } catch (error) {
    ElMessage.error('配置保存失败: ' + error)
  } finally {
    isLoading.value = false
  }
}

const setupListener = async () => {
  await window.__TAURI__.core.invoke('get_fan_speeds')
  await listen('get-fan-speeds', (event) => { updateMetrics(event.payload) })
}

const toggleAutostart = async () => {
  if (!isTauriReady()) {
    ElMessage.error('Tauri 未就绪，无法设置开机自启')
    autostartEnabled.value = !autostartEnabled.value
    return
  }
  try {
    if (autostartEnabled.value) {
      await window.__TAURI__.core.invoke('plugin:autostart|enable')
      ElMessage.success('开机自启动已启用')
    } else {
      await window.__TAURI__.core.invoke('plugin:autostart|disable')
      ElMessage.info('开机自启动已禁用')
    }
    await refreshAutostartStatus()
  } catch (error) {
    autostartEnabled.value = !autostartEnabled.value
    ElMessage.error('设置开机自启失败: ' + error)
  }
}

// remove unused applySuggested helper to silence linter warnings
const applySuggested = async () => {
  if (suggestedIntensity.value !== null) {
    intensity.value = suggestedIntensity.value
    await applyQuickMode()
  } else {
    ElMessage.info('暂无建议')
  }
}

onMounted(async () => {
  loadUsageHistory()
  await nextTick()
  initCharts()
  await setupListener()
  if (isTauriReady()) {
    try {
      const enabled = await refreshAutostartStatus()
      if (enabled) {
        await loadConfig()
        setTimeout(() => toggleFanControl(), 1000)
      }
    } catch (error) {
      console.error('❌ 检查开机自启状态失败:', error)
    }
  }
})

onUnmounted(() => {
  [leftFanChartInstance, rightFanChartInstance, speedChartInstance, tempChartInstance]
    .forEach(c => c?.destroy())
})
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;600&family=Noto+Serif+SC:wght@400;500&display=swap');

.app-shell {
  position: relative;
  min-height: 100vh;
  padding: 22px;
  overflow: hidden;
  color: #2f3a37;
  font-family: 'Noto Sans SC', sans-serif;
  background: linear-gradient(180deg, #eef2f0 0%, #e3e8e6 100%);
}

.app-shell::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.18;
  background-image:
    linear-gradient(rgba(47, 58, 55, 0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(47, 58, 55, 0.06) 1px, transparent 1px);
  background-size: 28px 28px;
  mask-image: radial-gradient(circle at center, black 40%, transparent 88%);
}

.ambient {
  position: absolute;
  border-radius: 999px;
  filter: blur(32px);
  pointer-events: none;
}

.ambient-a {
  top: -72px;
  right: 8%;
  width: 300px;
  height: 300px;
  background: rgba(111, 143, 136, 0.18);
}

.ambient-b {
  left: -100px;
  bottom: 6%;
  width: 280px;
  height: 280px;
  background: rgba(207, 222, 216, 0.8);
}

.surface {
  position: relative;
  z-index: 1;
  border: 1px solid rgba(47, 58, 55, 0.08);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.64);
  backdrop-filter: blur(12px) saturate(110%);
  box-shadow: 0 16px 40px rgba(53, 67, 61, 0.08);
}

.hero-panel {
  display: flex;
  justify-content: space-between;
  gap: 22px;
  padding: 20px 22px;
  margin: 0 auto 14px;
}

.hero-copy {
  flex: 1 1 54%;
}

.eyebrow,
.section-kicker {
  margin: 0 0 8px;
  color: #6f8f88;
  font-size: 12px;
  letter-spacing: 0.22em;
}

.hero-copy h1,
.section-head h2 {
  margin: 0;
  font-family: 'Noto Serif SC', serif;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: #2f3a37;
}

.hero-copy h1 {
  font-size: clamp(2rem, 4vw, 3.4rem);
  line-height: 1.08;
  max-width: 12ch;
}

.hero-desc {
  max-width: 44rem;
  margin: 14px 0 0;
  color: #5a6763;
  font-size: 14px;
  line-height: 1.9;
}

.hero-aside {
  flex: 0 0 min(420px, 100%);
  display: grid;
  gap: 14px;
  align-content: start;
}

.hero-statusline,
.hero-meta,
.hero-actions,
.summary-strip,
.section-head,
.chart-header,
.action-grid {
  display: flex;
  gap: 10px;
}

.hero-statusline,
.hero-actions,
.section-head,
.chart-header {
  align-items: center;
  justify-content: space-between;
}

.hero-statusline {
  flex-wrap: wrap;
  color: #52615d;
  font-size: 13px;
}

.status-pill,
.status-tag,
.mode-chip,
.scene-pill,
.summary-item,
.suggest-box,
.section-note,
.section-caption,
.slider-footline {
  border: 1px solid rgba(47, 58, 55, 0.08);
  background: rgba(245, 243, 239, 0.72);
}

.status-pill {
  padding: 6px 10px;
  border-radius: 999px;
}

.status-pill.is-live {
  border-color: rgba(111, 143, 136, 0.28);
  color: #2f5d55;
}

.hero-meta {
  flex-wrap: wrap;
  color: #2f3a37;
  font-size: 13px;
  line-height: 1.7;
}

.hero-meta > div {
  flex: 1 1 calc(50% - 10px);
  min-width: 140px;
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.48);
}

.hero-actions {
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.autostart-line {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: #566661;
  font-size: 13px;
}

.status-tag {
  border-radius: 999px;
  color: #425550;
}

.soft-alert {
  margin: 0 0 14px;
  border: 1px solid rgba(192, 106, 91, 0.18);
  background: rgba(245, 243, 239, 0.84);
  color: #7b4b41;
}

.summary-strip {
  margin-bottom: 14px;
  padding: 10px 12px;
  justify-content: space-between;
  flex-wrap: wrap;
}

.summary-item {
  flex: 1 1 calc(25% - 10px);
  min-width: 120px;
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.52);
  display: grid;
  gap: 4px;
}

.summary-label {
  color: #6d7b77;
  font-size: 11px;
  letter-spacing: 0.12em;
}

.summary-value {
  font-size: 18px;
  font-weight: 500;
  color: #2f3a37;
}

.main-grid {
  display: grid;
  grid-template-columns: minmax(300px, 0.42fr) minmax(0, 0.58fr);
  gap: 14px;
  align-items: start;
}

.left-column,
.right-column {
  display: grid;
  gap: 14px;
}

.module-card,
.chart-card {
  padding: 18px;
}

.section-head {
  align-items: flex-start;
  margin-bottom: 14px;
}

.section-head.compact {
  margin-bottom: 12px;
}

.section-head h2 {
  font-size: 19px;
  font-weight: 500;
}

.section-note,
.section-caption {
  padding: 10px 12px;
  border-radius: 14px;
  color: #61706b;
  font-size: 12px;
  line-height: 1.7;
}

.scene-pills {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.scene-pill,
.mode-chip {
  appearance: none;
  border-radius: 14px;
  padding: 12px 14px;
  color: #31403c;
  cursor: pointer;
  transition: transform 0.28s ease, border-color 0.28s ease, background 0.28s ease, opacity 0.28s ease;
}

.scene-pill {
  display: grid;
  gap: 4px;
  text-align: left;
  min-height: 66px;
}

.scene-pill small {
  color: #6b7a75;
  font-size: 12px;
}

.scene-pill.active,
.mode-chip.active {
  border-color: rgba(111, 143, 136, 0.42);
  background: rgba(207, 222, 216, 0.58);
}

.scene-pill.muted {
  opacity: 0.58;
}

.scene-pill:hover,
.mode-chip:hover,
.action-soft:hover,
.action-main:hover,
.suggest-button:hover {
  transform: translateY(-1px);
}

.scenario-footnote {
  margin-top: 12px;
  color: #6b7a75;
  font-size: 12px;
  line-height: 1.7;
}

.mode-switch {
  display: flex;
  gap: 8px;
}

.slider-frame {
  padding: 12px 2px 6px;
}

.slider-footline {
  display: inline-flex;
  padding: 8px 12px;
  border-radius: 999px;
  color: #51615d;
  font-size: 12px;
}

.action-grid {
  flex-wrap: wrap;
}

.action-main,
.action-soft,
.suggest-button {
  border-radius: 999px;
  border: 1px solid rgba(47, 58, 55, 0.1);
  background: rgba(255, 255, 255, 0.6);
  color: #2f3a37;
}

.action-main {
  min-width: 140px;
  background: linear-gradient(180deg, rgba(111, 143, 136, 0.92), rgba(111, 143, 136, 0.8));
  color: #f5f3ef;
  border-color: rgba(111, 143, 136, 0.24);
}

.suggest-box {
  margin-top: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  color: #5d6a66;
  line-height: 1.7;
}

.suggest-button {
  margin-left: 10px;
}

.chart-card {
  min-height: 320px;
}

.chart-primary {
  min-height: 420px;
}

.chart-secondary {
  min-height: 280px;
}

.chart-header {
  align-items: flex-start;
}

.chart-title {
  color: #2f3a37;
  font-size: 18px;
  font-weight: 500;
}

.chart-meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.chart-wrapper {
  position: relative;
  min-height: 220px;
}

.chart-focus-wrapper {
  min-height: 320px;
}

.chart-secondary-wrapper {
  min-height: 220px;
}

.chart-wrapper canvas {
  width: 100% !important;
  height: 100% !important;
}

:deep(.el-card) {
  overflow: hidden;
  border-radius: 18px;
  border: 1px solid rgba(47, 58, 55, 0.08);
  background: rgba(255, 255, 255, 0.56);
  box-shadow: none;
}

:deep(.el-card__body) {
  padding: 0;
}

:deep(.el-card__header) {
  padding: 0 0 14px;
  border-bottom: 1px solid rgba(47, 58, 55, 0.08);
  background: transparent;
}

:deep(.el-button) {
  transition: transform 0.28s ease, opacity 0.28s ease, background 0.28s ease, border-color 0.28s ease;
}

:deep(.el-button:hover) {
  transform: translateY(-1px);
}

:deep(.el-tag) {
  border-radius: 999px;
  border-color: rgba(47, 58, 55, 0.08);
  background: rgba(255, 255, 255, 0.56);
  color: #425550;
}

:deep(.el-slider__runway) {
  height: 2px;
  background: rgba(47, 58, 55, 0.12);
}

:deep(.el-slider__bar) {
  height: 2px;
  background: linear-gradient(90deg, #6f8f88, #cfded8);
}

:deep(.el-slider__button) {
  width: 16px;
  height: 16px;
  border: 1px solid rgba(47, 58, 55, 0.14);
  background: #f5f3ef;
}

:deep(.el-slider__marks-text) {
  color: #70817c;
  font-size: 12px;
}

:deep(.el-switch) {
  --el-switch-on-color: #6f8f88;
  --el-switch-off-color: rgba(111, 143, 136, 0.28);
}

:deep(.el-alert__content) {
  color: #7b4b41;
}

.app-shell :deep(.el-card:hover) {
  transform: translateY(-1px);
}

@media (max-width: 1120px) {
  .hero-panel {
    flex-direction: column;
  }

  .main-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .app-shell {
    padding: 14px;
  }

  .scene-pills {
    grid-template-columns: 1fr;
  }

  .summary-item {
    flex: 1 1 100%;
  }

  .hero-copy h1 {
    max-width: none;
    font-size: 1.8rem;
  }
}
</style>
