const INVOKE_TIMEOUT_MS = 12000

const tauriCore = window.__TAURI__?.core || {
  invoke: async (command) => {
    console.warn(`[NUCtool] Tauri is not available for ${command}`)
    return command === 'get_tdp' ? [0, 0, 0, 0, 0] : command === 'get_rgb_color' ? false : null
  },
}

const byId = (id) => document.getElementById(id)

const fields = {
  gpu1: byId('gpu1'),
  gpu2: byId('gpu2'),
  cpu1: byId('cpu1'),
  cpu2: byId('cpu2'),
  tcc: byId('tcc'),
}

const refreshButton = byId('a')
const applyButton = byId('b')
const rInput = byId('rgb_r')
const gInput = byId('rgb_g')
const bInput = byId('rgb_b')
const rVal = byId('r_val')
const gVal = byId('g_val')
const bVal = byId('b_val')
const colorPreview = byId('colorPreview')
const rgbButton = byId('rgb_button')
const toggle = byId('rgb_toggle')

let busy = false

function invokeBackend(command, args, timeoutMs = INVOKE_TIMEOUT_MS) {
  let timeoutId = 0
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(`${command} 响应超时，请稍后重试`))
    }, timeoutMs)
  })

  return Promise.race([tauriCore.invoke(command, args), timeout])
    .finally(() => window.clearTimeout(timeoutId))
}

function showMessage(message, type = 'info') {
  let toast = byId('tdpToast')
  if (!toast) {
    toast = document.createElement('div')
    toast.id = 'tdpToast'
    toast.setAttribute('role', 'status')
    document.body.appendChild(toast)
  }

  toast.textContent = message
  toast.dataset.type = type
  toast.classList.add('visible')
  window.clearTimeout(showMessage.timer)
  showMessage.timer = window.setTimeout(() => {
    toast.classList.remove('visible')
  }, 2800)
}

function setBusy(next) {
  busy = next
  refreshButton.disabled = next
  applyButton.disabled = next
  rgbButton.disabled = next || toggle.classList.contains('active')
  document.body.classList.toggle('is-busy', next)
}

function numberValue(input) {
  return Number.parseInt(input.value, 10) || 0
}

function validateTdp(tdp) {
  return Object.entries(tdp).every(([key, value]) => key === 'tcc' || value >= 0)
}

async function refreshTdp(options = {}) {
  if (busy && !options.force) return
  if (!options.force) setBusy(true)
  try {
    const [c1, c2, g1, g2, cc] = await invokeBackend('get_tdp')
    fields.cpu1.value = c1
    fields.cpu2.value = c2
    fields.gpu1.value = g1
    fields.gpu2.value = g2
    fields.tcc.value = cc
    showMessage('TDP 已刷新', 'success')
  } catch (error) {
    console.error('get_tdp failed:', error)
    showMessage(`读取 TDP 失败：${error.message || error}`, 'error')
  } finally {
    if (!options.force) setBusy(false)
  }
}

async function applyTdp() {
  if (busy) return

  const t = {
    cpu1: numberValue(fields.cpu1),
    cpu2: numberValue(fields.cpu2),
    gpu1: numberValue(fields.gpu1),
    gpu2: numberValue(fields.gpu2),
    tcc: numberValue(fields.tcc),
  }

  if (!validateTdp(t)) {
    showMessage('TDP 值不能为负数', 'error')
    return
  }

  setBusy(true)
  try {
    const applied = await invokeBackend('set_tdp', { t })
    if (applied !== true) {
      throw new Error('硬件读回校验未通过')
    }
    await refreshTdp({ force: true })
    showMessage('TDP 已应用', 'success')
  } catch (error) {
    console.error('set_tdp failed:', error)
    showMessage(`设置 TDP 失败：${error.message || error}`, 'error')
  } finally {
    setBusy(false)
  }
}

function updateColorPreview() {
  const r = Math.round(numberValue(rInput) * 5.1)
  const g = Math.round(numberValue(gInput) * 5.1)
  const b = Math.round(numberValue(bInput) * 5.1)

  if (!toggle.classList.contains('active')) {
    colorPreview.style.backgroundColor = `rgb(${r}, ${g}, ${b})`
  }

  rVal.textContent = String(numberValue(rInput))
  gVal.textContent = String(numberValue(gInput))
  bVal.textContent = String(numberValue(bInput))
}

async function setRgbColorMode(enabled) {
  toggle.classList.toggle('active', enabled)
  rInput.disabled = enabled
  gInput.disabled = enabled
  bInput.disabled = enabled
  rgbButton.disabled = enabled || busy
  rgbButton.style.background = enabled ? 'gray' : 'red'
  colorPreview.style.backgroundColor = enabled ? 'gray' : colorPreview.style.backgroundColor

  try {
    await invokeBackend(enabled ? 'set_rgb_color_y' : 'set_rgb_color_n')
    if (!enabled) updateColorPreview()
    showMessage(enabled ? '彩色模式已开启' : '彩色模式已关闭', 'success')
  } catch (error) {
    console.error('set rgb color mode failed:', error)
    showMessage(`切换 RGB 模式失败：${error.message || error}`, 'error')
  }
}

async function applyRgb() {
  if (busy || rgbButton.disabled) return

  const rgb = {
    r: Math.round(numberValue(rInput) * 5.1),
    g: Math.round(numberValue(gInput) * 5.1),
    b: Math.round(numberValue(bInput) * 5.1),
  }

  setBusy(true)
  try {
    await invokeBackend('set_rgb', { rgb })
    showMessage('RGB 已应用', 'success')
  } catch (error) {
    console.error('set_rgb failed:', error)
    showMessage(`设置 RGB 失败：${error.message || error}`, 'error')
  } finally {
    setBusy(false)
  }
}

refreshButton.addEventListener('click', refreshTdp)
applyButton.addEventListener('click', applyTdp)
rgbButton.addEventListener('click', applyRgb)
toggle.addEventListener('click', () => {
  setRgbColorMode(!toggle.classList.contains('active'))
})

;[rInput, gInput, bInput].forEach((input) => {
  input.addEventListener('input', updateColorPreview)
  input.addEventListener('change', updateColorPreview)
})

document.addEventListener('DOMContentLoaded', async () => {
  updateColorPreview()
  try {
    const colorModeEnabled = await invokeBackend('get_rgb_color')
    if (colorModeEnabled) {
      await setRgbColorMode(true)
    }
  } catch (error) {
    console.warn('get_rgb_color failed:', error)
  }
})

updateColorPreview()
refreshTdp()
