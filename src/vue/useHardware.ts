import { onMounted, onUnmounted, reactive } from 'vue';
import { call } from './bridge';
import { validKeyboardProfile, type KeyboardProfile } from './keyboardProfiles';
import { readRecentColors, rememberColor } from './recentColors';

export type Scene = 'quiet' | 'balanced' | 'cooling';
export type VisualMode = 'standard' | 'gaming' | 'video' | 'reading';
export type PowerSource = 'ac' | 'battery' | 'unknown';
export type Rgb = { r: number; g: number; b: number };
export type LightbarMode = Rgb & { effect: 'Monocolor' | 'Rainbow' };
export type LightbarProfile = { ac: LightbarMode; dc: LightbarMode; breathing: boolean };
export type DisplaySettings = { brightnessAc: number; brightnessDc: number; colorTemp: number; contrast: number; red: number; green: number; blue: number };

const temps = [35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85];
const scenarios: Record<Scene, { label: string; ramp: number; hysteresis: number; cap: number; cpu: number[]; gpu: number[] }> = {
  quiet: { label: '安静', ramp: 2, hysteresis: 6, cap: 50, cpu: [20,20,24,29,34,39,44,48,50,50,50], gpu: [20,20,23,28,33,39,44,48,50,50,50] },
  balanced: { label: '均衡', ramp: 5, hysteresis: 4, cap: 80, cpu: [25,28,34,42,50,58,66,72,76,79,80], gpu: [25,29,36,44,52,60,68,74,78,80,80] },
  cooling: { label: '散热优先', ramp: 10, hysteresis: 1, cap: 100, cpu: [35,40,48,58,68,76,84,90,95,98,100], gpu: [35,42,52,62,72,82,90,95,98,100,100] },
};

function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
function validNumber(value: unknown): number | null { const n = Number(value); return value == null || !Number.isFinite(n) || n <= 0 ? null : n; }

export function useHardware() {
  const state = reactive({
    page: 'home' as 'home' | 'performance' | 'display' | 'keyboard' | 'lightbar' | 'monitor' | 'ec',
    notice: '',
    busy: false,
    serviceReady: false,
    serviceConnected: false,
    serviceDetail: '尚未检查 UniwillService',
    serviceData: null as any,
    bridgeAvailable: false,
    bridgeDetail: '尚未检查 NUCtool.dll',
    author: null as any,
    recentColors: readRecentColors(),
    powerSource: 'unknown' as PowerSource,
    batteryPercent: null as number | null,
    monitor: null as any,
    monitorError: '',
    batteryDraft: 60,
    batteryChoice: 'custom' as 'best' | 'custom' | 'full',
    keyboardBrightness: 30,
    whisperDraft: { mode: 'Quiet', fps: 60 },
    keyboardEffectDraft: { effect: 'Monocolor', direction: 'None', speed: 0 },
    vendorAuxDraft: {
      keyboardBrightness: { ac: 30, battery: 30 },
      keyboardIdleTimer: { ac: 0, battery: 0 },
      lightbarIdleTimer: { ac: 0, battery: 0 },
    },
    lastOsd: null as boolean | null,
    lastVisual: null as VisualMode | 'custom' | null,
    lastBenchmark: null as boolean | null,
    fan: {
      running: false,
      scene: 'balanced' as Scene,
      powerAuto: false,
      acScene: 'balanced' as Scene,
      dcScene: 'balanced' as Scene,
      cpuTemp: null as number | null,
      gpuTemp: null as number | null,
      cpuRpm: null as number | null,
      gpuRpm: null as number | null,
      health: '未接管',
      droppedSamples: 0,
      lastSampled: '—',
      constant: false,
      constantSpeed: 50,
      startupTakeover: false,
      cpuCurve: [...scenarios.balanced.cpu],
      gpuCurve: [...scenarios.balanced.gpu],
    },
  });

  let noticeTimer: number | undefined;
  let fanTimer: number | undefined;
  let statusTimer: number | undefined;
  let powerTimer: number | undefined;
  let monitorTimer: number | undefined;
  let monitorPending = false;
  let batteryChoiceInitialized = false;
  let batteryDraftInitialized = false;
  let vendorAuxInitialized = false;
  let keyboardEffectInitialized = false;
  let whisperInitialized = false;
  let savedAppSettings: Record<string, unknown> = {};
  let savedAppearance: Record<string, unknown> = {};
  function toast(text: string) {
    state.notice = text;
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => { state.notice = ''; }, 7500);
  }
  async function operation<T>(label: string, task: () => Promise<T>): Promise<T | null> {
    if (state.busy) return null;
    state.busy = true;
    try { return await task(); }
    catch (error) { toast(`${label}失败：${message(error)}`); return null; }
    finally { state.busy = false; }
  }

  async function refreshAuthor() {
    try {
      const result = await call('read_author_hardware_state');
      state.author = result?.status?.ok ? result : null;
      if (!batteryDraftInitialized && state.author?.battery_charging_level != null) {
        state.batteryDraft = state.author.battery_charging_level;
        batteryDraftInitialized = true;
      }
    } catch { state.author = null; }
  }
  async function refreshService() {
    const [service, bridge] = await Promise.allSettled([call('get_vendor_service_status'), call('get_author_bridge_status')]);
    state.serviceReady = true;
    state.serviceConnected = service.status === 'fulfilled' && service.value?.ok === true;
    state.serviceDetail = service.status === 'fulfilled' ? String(service.value?.detail ?? '服务未响应') : message(service.reason);
    state.serviceData = service.status === 'fulfilled' ? service.value?.data ?? null : null;
    state.bridgeAvailable = bridge.status === 'fulfilled' && bridge.value?.available === true;
    state.bridgeDetail = bridge.status === 'fulfilled' ? String(bridge.value?.detail ?? '未就绪') : '无法检查 NUCtool.dll';
    if (!vendorAuxInitialized && state.serviceConnected && state.serviceData) {
      for (const kind of ['keyboardBrightness', 'keyboardIdleTimer', 'lightbarIdleTimer'] as const) {
        const current = state.serviceData[kind];
        if (current?.ac != null) state.vendorAuxDraft[kind].ac = Number(current.ac);
        if (current?.dc != null) state.vendorAuxDraft[kind].battery = Number(current.dc);
      }
      vendorAuxInitialized = true;
    }
    if (!keyboardEffectInitialized && state.serviceConnected && state.serviceData?.lighting?.keyboard) {
      const current = state.serviceData.lighting.keyboard;
      state.keyboardEffectDraft.effect = String(current.effect ?? 'Monocolor');
      state.keyboardEffectDraft.direction = String(current.direction ?? 'None');
      state.keyboardEffectDraft.speed = Number(current.speed ?? 0);
      keyboardEffectInitialized = true;
    }
    if (!whisperInitialized && state.serviceConnected && state.serviceData?.whisper) {
      const current = state.serviceData.whisper;
      state.whisperDraft.mode = current.type && current.type !== 'Off' ? String(current.type) : 'Quiet';
      state.whisperDraft.fps = Number(current.fps > 0 ? current.fps : 60);
      whisperInitialized = true;
    }
    if (!batteryChoiceInitialized && state.serviceData?.battery?.mode) {
      state.batteryChoice = state.serviceData.battery.mode === 'BestBattery' ? 'best' : state.serviceData.battery.mode === 'AcMode' ? 'full' : 'custom';
      batteryChoiceInitialized = true;
    }
    await refreshAuthor();
  }
  async function refreshPower() {
    try {
      const result = await call('get_power_source');
      state.powerSource = result?.source === 'ac' || result?.source === 'battery' ? result.source : 'unknown';
      const percent = Number(result?.battery_percent);
      state.batteryPercent = result?.battery_percent == null || !Number.isFinite(percent) ? null : percent;
    } catch { state.powerSource = 'unknown'; state.batteryPercent = null; }
  }
  async function refreshMonitor() {
    if (monitorPending) return;
    monitorPending = true;
    try {
      state.monitor = await call('get_studio_monitor_snapshot');
      state.monitorError = '';
    } catch (error) {
      state.monitorError = message(error);
    } finally {
      monitorPending = false;
    }
  }
  async function refreshFan() {
    try {
      const result = await call('get_fan_control_snapshot');
      state.fan.running = !!result?.running;
      state.fan.cpuTemp = validNumber(result?.mock_cpu_temp ?? result?.cpu_temp);
      state.fan.gpuTemp = validNumber(result?.mock_gpu_temp ?? result?.gpu_temp);
      state.fan.cpuRpm = validNumber(result?.mock_cpu_fan ?? result?.cpu_fan_rpm);
      state.fan.gpuRpm = validNumber(result?.mock_gpu_fan ?? result?.gpu_fan_rpm);
      state.fan.droppedSamples = Number(result?.dropped_samples ?? 0);
      state.fan.lastSampled = result?.sampled_at_ms ? new Date(Number(result.sampled_at_ms)).toLocaleTimeString() : '—';
      state.fan.health = result?.hung ? '控制线程无响应，等待安全回退' : result?.cpu_fan_stalled || result?.gpu_fan_stalled ? '风扇异常，后端安全保护中' : result?.dropped_samples ? '采样丢失' : result?.running ? 'EC 接管中' : '系统控制';
    } catch { state.fan.health = 'EC 状态暂不可用'; }
  }

  async function setKey(key: string, enabled: boolean) {
    await operation('按键设置', async () => {
      const result = await call('apply_vendor_key', { key, enabled });
      if (!result?.verified) throw new Error(result?.status?.detail ?? '未获得读回确认');
      state.serviceData = result.status.data;
      toast('按键状态已由官方服务读回确认');
    });
  }
  async function setOsd(enabled: boolean) {
    await operation('屏幕提示', async () => {
      const result = await call('apply_vendor_osd', { enabled });
      if (!result?.status?.ok) throw new Error(result?.status?.detail ?? '请求未接受');
      state.lastOsd = enabled;
      toast('屏幕提示请求已发送；此项无法读取当前状态');
    });
  }
  async function setBattery() {
    await operation('电池设置', async () => {
      if (!state.serviceConnected || (state.batteryChoice !== 'best' && !state.bridgeAvailable)) throw new Error('厂商服务与 NUCtool.dll 都必须就绪，才能同步电池模式和充电阈值');
      const choice = state.batteryChoice;
      const level = choice === 'full' ? 100 : state.batteryDraft;
      const mode = choice === 'best' ? 'BestBattery' : choice === 'full' ? 'AcMode' : 'Custom';
      const result = await call('apply_vendor_battery', { mode, level });
      if (result?.status?.data) state.serviceData = result.status.data;
      if (!result?.status?.ok) {
        await refreshService();
        throw new Error(`厂商电池模式未获读回确认；${result?.status?.detail ?? '请检查服务状态'}`);
      }
      if (state.batteryChoice === 'best') {
        await refreshAuthor();
        toast('最佳电池健康模式已由厂商服务读回；DLL 保存的阈值不代表当前停止点');
      } else {
        let limitResult: any;
        try { limitResult = await call('apply_author_battery_limit', { level }); }
        catch (error) {
          await refreshService();
          throw new Error(`厂商模式已改为 ${mode}，但 DLL 阈值写入失败，可能部分生效：${message(error)}`);
        }
        if (!limitResult?.status?.ok) {
          await refreshService();
          throw new Error(`厂商模式已改为 ${mode}，但 DLL 阈值请求失败，可能部分生效：${limitResult?.status?.detail ?? '未知错误'}`);
        }
        await refreshService();
        if (state.serviceData?.battery?.mode !== mode) throw new Error(`DLL 阈值已请求，但厂商模式未保持 ${mode}；两路可能部分生效`);
        if (state.author?.battery_charging_level !== level) throw new Error('厂商模式已改变，但 DLL 阈值未获读回确认；可能部分生效');
        const serviceLevel = Number(state.serviceData?.battery?.chargingLevel);
        if (choice === 'custom' && serviceLevel !== level) throw new Error(`DLL 阈值已读回 ${level}%，但厂商服务读回 ${serviceLevel}%；两路不一致`);
        toast(`${choice === 'full' ? '充至 100%' : `自定义 ${level}%`}：厂商模式与 DLL 阈值均已读回`);
      }
    });
  }
  async function setProfile(mode: 'performance' | 'balanced' | 'powersave') {
    await operation('性能档位', async () => {
      const result = await call('apply_author_power_profile', { mode });
      if (!result?.dispatched) throw new Error(result?.status?.detail ?? '调用失败');
      await refreshAuthor();
      const index = mode === 'performance' ? 1 : mode === 'balanced' ? 2 : 3;
      const label = mode === 'performance' ? '性能' : mode === 'balanced' ? '平衡' : '省电';
      toast(result?.verified && state.author?.current_profile_index === index ? `${label}档位已读回确认` : '档位请求已发送，但未获得硬件读回确认');
    });
  }
  async function setBenchmark(enabled: boolean) {
    await operation('基准模式', async () => {
      const result = await call('apply_author_benchmark_mode', { enabled });
      if (!result?.dispatched || result?.status?.ok === false) throw new Error(result?.status?.detail ?? '请求未发送');
      state.lastBenchmark = enabled;
      toast('基准模式请求已发送；接口不提供当前状态读回');
    });
  }
  async function setWhisper(enabled: boolean, fps = state.whisperDraft.fps) {
    await operation('WhisperMode', async () => {
      const result = await call('apply_vendor_whisper', { mode: enabled ? 'Quiet' : 'Off', fps: enabled ? fps : 0 });
      if (!result?.status?.ok) throw new Error(result?.status?.detail ?? '未获读回确认');
      state.serviceData = result.status.data;
      toast('WhisperMode 已读回确认');
    });
  }
  async function setWhisperSettings() {
    await operation('WhisperMode 参数', async () => {
      const { mode, fps } = state.whisperDraft;
      const result = await call('apply_vendor_whisper', { mode, fps });
      if (!result?.status?.ok) throw new Error(result?.status?.detail ?? '未获读回确认');
      state.serviceData = result.status.data;
      toast('WhisperMode 噪声档位与目标帧率已读回确认');
    });
  }
  async function setPassiveCooling(enabled: boolean) {
    await operation('被动散热', async () => {
      if (state.fan.running) throw new Error('EC 风扇仍在接管，请先交还系统控制');
      const result = await call('apply_vendor_passive_cooling', { enabled });
      if (result?.data) { state.serviceData = result.data; state.serviceConnected = result.data.connected === true; }
      if (!result?.ok) throw new Error(result?.detail ?? '官方服务未确认被动散热状态');
      toast(`被动散热已${enabled ? '开启' : '关闭'}，官方服务已读回；启用 EC 前请先关闭此模式`);
    });
  }
  async function restorePerformanceDefaults() {
    await operation('厂商性能配置恢复', async () => {
      if (state.fan.running) throw new Error('EC 风扇仍在接管，请先交还系统控制');
      const result = await call('restore_vendor_performance_defaults');
      if (result?.data) { state.serviceData = result.data; state.serviceConnected = result.data.connected === true; }
      if (!result?.ok) throw new Error(result?.detail ?? '恢复后未能确认所有厂商性能配置');
      toast('三档厂商性能配置已恢复并读回；这不修改单独保存的 EC 风扇曲线');
    });
  }
  async function updateVendorProfile(index: number, source: 'ac' | 'dc', cpu: number, dgpu: number): Promise<boolean> {
    return (await operation('厂商 AC/DC 性能配置', async () => {
      if (state.fan.running) throw new Error('EC 风扇仍在接管，请先交还系统控制');
      try {
        const result = await call('update_vendor_performance_profile', { index, source, cpu, dgpu });
        if (result?.data) {
          state.serviceData = result.data;
          state.serviceConnected = result.data.connected === true;
        }
        if (!result?.ok) throw new Error(result?.detail ?? '保存后未能确认 CPU、独显及风扇字段');
        toast(result.data?.profileWrite?.applied
          ? '厂商配置已保存、应用并读回；风扇字段保持原值'
          : '厂商配置已保存并读回；切换到该档位后才会应用');
        return true;
      } finally {
        // A service call can fail after UpdateProfile already ran. Refresh the
        // actual state so the UI never treats an old draft as hardware state.
        await refreshService();
      }
    })) === true;
  }
  async function setVisual(mode: VisualMode) {
    await operation('画质预设', async () => {
      const result = await call('apply_vendor_display_mode', { mode });
      if (!result?.status?.ok) throw new Error(result?.status?.detail ?? '请求失败');
      state.lastVisual = mode;
      toast('画质预设请求已发送；当前实际模式无法读回');
    });
  }
  async function setCustomDisplay(settings: DisplaySettings) {
    await operation('自定义画质', async () => {
      const result = await call('apply_vendor_custom_display', settings);
      if (!result?.saved_profile_verified || !result?.activation_requested) throw new Error(result?.status?.detail ?? '保存未获读回确认');
      state.serviceData = result.status.data;
      state.lastVisual = 'custom';
      toast('自定义参数已保存并读回；启用请求已发送，当前模式无法读回');
    });
  }
  async function setPresetDisplay(mode: VisualMode, settings: DisplaySettings): Promise<boolean> {
    return (await operation('画质预设参数', async () => {
      try {
        const result = await call('apply_vendor_preset_display', { mode, ...settings });
        if (result?.status?.data) state.serviceData = result.status.data;
        if (!result?.saved_profile_verified || !result?.activation_requested) {
          throw new Error(result?.status?.detail ?? '保存未获读回确认');
        }
        state.lastVisual = mode;
        toast('预设参数已保存并读回；应用请求已发送，当前模式无法独立读回');
        return true;
      } catch (error) {
        throw new Error(`保存或应用未获完整确认，可能部分生效；已重新读取服务状态。${message(error)}`);
      } finally { await refreshService(); }
    })) === true;
  }
  async function resetDisplay(mode: VisualMode | 'custom') {
    if (mode === 'custom') {
      // Values recovered from the original MobileDisplayModeCustomSettings defaults.
      await setCustomDisplay({ brightnessAc: 50, brightnessDc: 50, colorTemp: 6500, contrast: 50, red: 128, green: 128, blue: 128 });
      return;
    }
    await operation('画质恢复预设', async () => {
      const result = await call('reset_vendor_display_mode', { mode });
      if (!result?.ok) throw new Error(result?.detail ?? '官方服务未确认');
      state.serviceData = result.data;
      toast('恢复请求已发送，保存配置已重新读取；当前生效模式无法确认');
    });
  }
  async function setKeyboard(on: boolean, brightness = state.keyboardBrightness) {
    await operation('键盘背光', async () => {
      const result = await call('apply_author_keyboard_basic', { enabled: on, brightness });
      if (!result?.status?.ok) throw new Error(result?.status?.detail ?? '请求失败');
      state.keyboardBrightness = brightness;
      await refreshAuthor();
      toast(state.author?.keyboard_enabled === on ? '键盘开关已读回确认；亮度仅为请求值' : '键盘请求已发送，但开关状态未确认');
    });
  }
  async function setKeyboardColor(color: Rgb) {
    await operation('键盘颜色', async () => {
      const result = await call('apply_vendor_keyboard_color', color);
      if (!result?.verified) throw new Error(result?.status?.detail ?? '未获读回确认');
      state.serviceData = result.status.data;
      state.keyboardEffectDraft = { effect: 'Monocolor', direction: 'None', speed: 0 };
      state.recentColors = rememberColor(state.recentColors, 'keyboard', color);
      toast('键盘颜色已读回确认');
    });
  }
  async function setKeyboardEffect() {
    await operation('键盘灯效', async () => {
      const result = await call('apply_vendor_keyboard_effect', { ...state.keyboardEffectDraft });
      if (!result?.verified) throw new Error(result?.status?.detail ?? '未获得读回确认');
      state.serviceData = result.status.data;
      toast('键盘灯效、方向和速度已读回确认');
    });
  }
  async function setKeyColor(indices: number[], color: Rgb) {
    await operation('逐键颜色', async () => {
      const result = await call('apply_vendor_key_colors', { indices, ...color });
      if (!result?.ok) throw new Error(result?.detail ?? '逐键颜色未获得读回确认');
      state.serviceData = result.data;
      state.keyboardEffectDraft.effect = 'UserMode';
      toast('逐键颜色已读回；键盘进入自定义逐键模式');
    });
  }
  async function setKeyGroupColor(indices: number[], color: Rgb): Promise<boolean> {
    return (await operation('键组上色', async () => {
      const keyboard = state.serviceData?.lighting?.keyboard;
      if (!keyboard || keyboard.keyColorCount !== 126) throw new Error('未读到完整 126 个 LED 槽位');
      if (!indices.length || new Set(indices).size !== indices.length || indices.some((index) => !Number.isInteger(index) || index < 0 || index >= 126)) throw new Error('键组槽位无效');
      try {
        // Backend takes a fresh service snapshot before changing only these slots.
        const result = await call('apply_vendor_key_colors', { indices, ...color });
        if (result?.data) state.serviceData = result.data;
        if (!result?.ok) throw new Error(result?.detail ?? '键组颜色未获得完整读回确认');
        state.keyboardEffectDraft.effect = 'UserMode';
        state.recentColors = rememberColor(state.recentColors, 'keyboard', color);
        toast(`${indices.length} 个 LED 槽位已写入并读回`);
        return true;
      } finally { await refreshService(); }
    })) === true;
  }
  async function applyKeyboardProfile(profile: KeyboardProfile) {
    await operation('键盘配置', async () => {
      if (!validKeyboardProfile(profile)) throw new Error('配置数据无效');
      if (!state.serviceConnected || !state.serviceData?.lighting?.keyboard) throw new Error('官方服务尚未返回键盘状态');
      let applied = 0;
      const total = profile.keyColors ? 7 : 6;
      const write = async (command: string, args: Record<string, unknown>) => {
        const result = await call(command, args);
        if (!result?.verified) throw new Error(result?.status?.detail ?? `${command} 未获得硬件读回确认`);
        applied += 1;
        state.serviceData = result.status.data;
      };
      try {
        // Color writes switch to Monocolor; apply the saved effect afterwards.
        await write('apply_vendor_keyboard_color', profile.color);
        if (!profile.keyColors) await write('apply_vendor_keyboard_effect', { effect: profile.effect, direction: profile.direction, speed: profile.speed });
        for (const [kind, ac, dc] of [
          ['keyboardBrightness', profile.brightnessAc, profile.brightnessDc],
          ['keyboardIdleTimer', profile.idleAc, profile.idleDc],
        ] as const) {
          await write('apply_vendor_aux_setting', { kind, source: 'ac', value: ac });
          await write('apply_vendor_aux_setting', { kind, source: 'battery', value: dc });
        }
        if (profile.keyColors) {
          const result = await call('apply_vendor_key_palette', { colors: profile.keyColors });
          if (!result?.ok) throw new Error(result?.detail ?? '126 个灯位未全部读回确认');
          applied += 1;
          state.serviceData = result.data;
          await write('apply_vendor_keyboard_effect', { effect: 'UserMode', direction: profile.direction, speed: profile.speed });
          const actual = state.serviceData?.lighting?.keyboard?.keyColors;
          if (!Array.isArray(actual) || actual.length !== 126 || actual.some((color: Rgb, index: number) =>
            color?.r !== profile.keyColors?.[index].r || color?.g !== profile.keyColors?.[index].g || color?.b !== profile.keyColors?.[index].b)) {
            applied -= 1;
            throw new Error('恢复方向/速度后，126 个灯位颜色与配置不一致');
          }
        }
      } catch (error) {
        await refreshService();
        throw new Error(`已完成 ${applied}/${total} 项；可能部分生效，请检查各项读回。${message(error)}`);
      }
      state.keyboardEffectDraft = { effect: profile.effect, direction: profile.direction, speed: profile.speed };
      state.vendorAuxDraft.keyboardBrightness = { ac: profile.brightnessAc, battery: profile.brightnessDc };
      state.vendorAuxDraft.keyboardIdleTimer = { ac: profile.idleAc, battery: profile.idleDc };
      toast(`键盘配置“${profile.name}”的 ${total} 项设置均已读回`);
    });
  }
  async function setLightbar(source: 'ac' | 'battery', color: Rgb, breathing: boolean) {
    await operation('光条', async () => {
      const result = await call('apply_vendor_lightbar', { source, ...color, breathing });
      if (!result?.verified) throw new Error(result?.status?.detail ?? '未获读回确认');
      state.serviceData = result.status.data;
      state.recentColors = rememberColor(state.recentColors, 'lightbar', color);
      toast('光条颜色与呼吸状态已读回确认');
    });
  }
  async function setLightbarProfile(profile: LightbarProfile): Promise<boolean> {
    return (await operation('光条开关', async () => {
      try {
        const result = await call('apply_vendor_lightbar_profile', { profile });
        if (result?.data) state.serviceData = result.data;
        if (!result?.ok) throw new Error(result?.detail ?? '插电/电池光条状态未全部读回');
        toast('光条插电、电池及呼吸状态已由官方服务读回');
        return true;
      } finally {
        await refreshService();
      }
    })) === true;
  }
  async function setLightbarEffect(source: 'ac' | 'battery', effect: 'Monocolor' | 'Rainbow') {
    await operation('光条灯效', async () => {
      const result = await call('apply_vendor_lightbar_effect', { source, effect });
      if (!result?.verified) throw new Error(result?.status?.detail ?? '未获得读回确认');
      state.serviceData = result.status.data;
      toast('光条灯效已读回确认');
    });
  }
  async function setVendorAux(kind: 'keyboardBrightness' | 'keyboardIdleTimer' | 'lightbarIdleTimer', source: 'ac' | 'battery') {
    await operation('厂商设置', async () => {
      const value = state.vendorAuxDraft[kind][source];
      const result = await call('apply_vendor_aux_setting', { kind, source, value });
      if (!result?.verified) throw new Error(result?.status?.detail ?? '未获得读回确认');
      state.serviceData = result.status.data;
      toast('设置已由官方服务读回确认');
    });
  }

  function fanPayload() {
    const scene = scenarios[state.fan.scene];
    const points = (speeds: number[]) => temps.map((temperature, i) => ({ temperature, speed: speeds[i] }));
    return {
      left_fan: points(state.fan.cpuCurve),
      right_fan: points(state.fan.gpuCurve),
      power_curves: state.fan.powerAuto ? {
        ac_left: points(scenarios[state.fan.acScene].cpu), ac_right: points(scenarios[state.fan.acScene].gpu),
        dc_left: points(scenarios[state.fan.dcScene].cpu), dc_right: points(scenarios[state.fan.dcScene].gpu),
      } : null,
      control: { mode: 'custom', strategy: 'independent', preset: 'custom', control_mode: state.fan.constant ? 'constant' : 'curve', ramp_up_step: state.fan.powerAuto ? 10 : scene.ramp, ramp_down_step: state.fan.powerAuto ? 5 : scene.ramp, min_speed: 20, zero_rpm_enabled: false, zero_rpm_threshold: 45, constant_speed_enabled: state.fan.constant, constant_speed: state.fan.constantSpeed, startup_takeover_enabled: state.fan.startupTakeover, cpu_hysteresis_bandwidth: state.fan.powerAuto ? 1 : scene.hysteresis, gpu_hysteresis_bandwidth: state.fan.powerAuto ? 1 : scene.hysteresis, cpu_fan_max_percent: state.fan.powerAuto ? 100 : scene.cap, gpu_fan_max_percent: state.fan.powerAuto ? 100 : scene.cap, gpu_linkage_enabled: true, gpu_linkage_threshold: 83, gpu_linkage_boost: 10 },
      alerts: { cpu: { threshold: 90, actions: { popup: true, sound: false, log: true, force_shutdown: false, confirm_times: 2 } }, gpu: { threshold: 90, actions: { popup: true, sound: false, log: true, force_shutdown: false, confirm_times: 2 } }, recover_delta: 3 },
      monitor: { sample_interval_ms: 1000, log_enabled: false },
      appearance: { ...savedAppearance, time_theme_mode: savedAppearance.time_theme_mode ?? 'auto' },
      app_settings: { ...savedAppSettings, default_scenario: state.fan.scene, ac_fan_scene: state.fan.acScene, dc_fan_scene: state.fan.dcScene },
    };
  }
  async function setFanScene(scene: Scene) {
    state.fan.scene = scene;
    state.fan.cpuCurve = [...scenarios[scene].cpu];
    state.fan.gpuCurve = [...scenarios[scene].gpu];
    if (state.fan.running) await updateFan();
  }
  async function setFanPowerAuto(enabled: boolean) {
    const previous = state.fan.powerAuto;
    state.fan.powerAuto = enabled;
    if (state.fan.running && !await updateFan()) state.fan.powerAuto = previous;
  }
  async function setFanPowerScene(source: 'ac' | 'battery', scene: Scene) {
    const previous = source === 'ac' ? state.fan.acScene : state.fan.dcScene;
    if (source === 'ac') state.fan.acScene = scene;
    else state.fan.dcScene = scene;
    if (state.fan.running && state.fan.powerAuto && !await updateFan()) {
      if (source === 'ac') state.fan.acScene = previous;
      else state.fan.dcScene = previous;
    }
  }
  async function updateFan() {
    return (await operation('EC 曲线更新', async () => {
      await call('update_fan_policy', { fanData: fanPayload() });
      await refreshFan();
      toast('EC 风扇曲线已提交；请观察下一次采样的风扇转速');
      return true;
    })) === true;
  }
  async function toggleFan() {
    await operation('EC 控制', async () => {
      if (state.fan.running) await call('stop_fan_control');
      else {
        if (state.serviceData?.currentState?.passiveCooling === true) throw new Error('厂商被动散热仍在开启，请先在性能页关闭并读回确认');
        await call('start_fan_control', { fanData: fanPayload() });
      }
      await refreshFan();
      toast(state.fan.running ? 'EC 已接管风扇' : '风扇已交还系统控制');
    });
  }
  async function saveFan() {
    await operation('风扇策略保存', async () => {
      await call('save_fan_config', { fanData: fanPayload() });
      if (state.fan.running) await call('update_fan_policy', { fanData: fanPayload() });
      toast('风扇策略已保存');
    });
  }
  async function loadFan() {
    try {
      const stored = await call('load_fan_config');
      if (!stored?.control) return;
      savedAppSettings = stored.app_settings && typeof stored.app_settings === 'object' ? { ...stored.app_settings } : {};
      savedAppearance = stored.appearance && typeof stored.appearance === 'object' ? { ...stored.appearance } : {};
      const storedScene = String(savedAppSettings.default_scenario ?? '').toLowerCase();
      if (storedScene === 'quiet' || storedScene === 'balanced' || storedScene === 'cooling') state.fan.scene = storedScene;
      const acScene = String(savedAppSettings.ac_fan_scene ?? '').toLowerCase();
      const dcScene = String(savedAppSettings.dc_fan_scene ?? '').toLowerCase();
      if (acScene === 'quiet' || acScene === 'balanced' || acScene === 'cooling') state.fan.acScene = acScene;
      if (dcScene === 'quiet' || dcScene === 'balanced' || dcScene === 'cooling') state.fan.dcScene = dcScene;
      state.fan.powerAuto = !!stored.power_curves;
      state.fan.constant = !!stored.control.constant_speed_enabled;
      state.fan.constantSpeed = Number(stored.control.constant_speed ?? 50);
      state.fan.startupTakeover = !!stored.control.startup_takeover_enabled;
      const cpu = stored.left_fan?.map((p: any) => Number(p.speed));
      const gpu = stored.right_fan?.map((p: any) => Number(p.speed));
      if (Array.isArray(cpu) && cpu.length === temps.length) state.fan.cpuCurve = cpu;
      if (Array.isArray(gpu) && gpu.length === temps.length) state.fan.gpuCurve = gpu;
    } catch { /* absence of a saved policy is normal */ }
  }
  function visibleRefresh() { if (!document.hidden) { void refreshFan(); void refreshService(); void refreshPower(); void refreshMonitor(); } }
  onMounted(() => {
    void refreshFan(); void refreshService(); void refreshPower(); void refreshMonitor(); void loadFan();
    fanTimer = window.setInterval(() => { if (!document.hidden) void refreshFan(); }, 5000);
    statusTimer = window.setInterval(() => { if (!document.hidden) void refreshService(); }, 60000);
    powerTimer = window.setInterval(() => { if (!document.hidden) void refreshPower(); }, 15000);
    monitorTimer = window.setInterval(() => { if (!document.hidden) void refreshMonitor(); }, 20000);
    document.addEventListener('visibilitychange', visibleRefresh);
  });
  onUnmounted(() => {
    window.clearInterval(fanTimer); window.clearInterval(statusTimer); window.clearInterval(powerTimer); window.clearInterval(monitorTimer); window.clearTimeout(noticeTimer);
    document.removeEventListener('visibilitychange', visibleRefresh);
  });

  return { state, scenarios, refreshService, refreshFan, setKey, setOsd, setBattery, setProfile, setBenchmark, setWhisper, setWhisperSettings, setPassiveCooling, restorePerformanceDefaults, updateVendorProfile, setVisual, setCustomDisplay, setPresetDisplay, resetDisplay, setKeyboard, setKeyboardColor, setKeyboardEffect, setKeyColor, setKeyGroupColor, applyKeyboardProfile, setLightbar, setLightbarProfile, setLightbarEffect, setVendorAux, setFanScene, setFanPowerAuto, setFanPowerScene, updateFan, toggleFan, saveFan, toast };
}
