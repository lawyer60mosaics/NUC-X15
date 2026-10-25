<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from '@tauri-apps/api/core';
import { ElMessageBox } from 'element-plus';
import { useHardware, type DisplaySettings, type LightbarMode, type LightbarProfile, type Rgb, type Scene, type VisualMode } from './useHardware';
import { readKeyboardProfiles, validKeyPalette, writeKeyboardProfiles, type KeyboardProfile } from './keyboardProfiles';
import { keyboardGroupSlots, readKeyboardGroups, writeKeyboardGroups, type KeyboardGroup } from './keyboardGroups';
import { keyboardUsRows, type KeyboardLedKey } from './keymapUs';
import { batteryReadback } from './batteryState';

const hardware = useHardware();
const { state } = hardware;
const aboutOpen = ref(false);
const displayOpen = ref<'standard' | 'gaming' | 'video' | 'reading' | 'custom'>('standard');
const lightbarSource = ref<'ac' | 'battery'>('ac');
const lightbarDraft = reactive<Rgb>({ r: 49, g: 0, b: 0 });
const displayDraft = reactive<DisplaySettings>({ brightnessAc: 50, brightnessDc: 50, colorTemp: 6500, contrast: 50, red: 128, green: 128, blue: 128 });
const visualModes: { key: VisualMode; label: string }[] = [{ key: 'standard', label: '标准' }, { key: 'gaming', label: '游戏' }, { key: 'video', label: '视频' }, { key: 'reading', label: '阅读' }];
const keyboardPalette = ['#ffffff', '#ff3939', '#ffaf22', '#fff454', '#2fd469', '#12a9ee', '#7468ff', '#f36fc8'];
const keyboardProfiles = ref<KeyboardProfile[]>(readKeyboardProfiles());
const keyboardGroups = ref<KeyboardGroup[]>(readKeyboardGroups());
const selectedKeyboardGroup = ref('');
const groupKeyIds = ref<string[]>([]);
const groupEditing = ref(false);
const selectedKeyboardProfile = ref('');
const selectedLedKey = ref('');
const selectedLedColor = ref('#00ace6');
const keyboardEffects = [
  { value: 'Monocolor', label: '单色' }, { value: 'Breathing', label: '呼吸' },
  { value: 'Wave', label: '波浪' }, { value: 'Reactive', label: '按键响应' },
  { value: 'Rainbow', label: '彩虹' }, { value: 'Ripple', label: '波纹' },
  { value: 'Raindrop', label: '雨滴' }, { value: 'Marquee', label: '跑马灯' },
  { value: 'Aurora', label: '极光' }, { value: 'Spark', label: '火花' },
  { value: 'Music', label: '音乐' },
  { value: 'UserMode', label: '逐键自定义' },
  { value: 'GamingMode', label: '游戏键位' },
];
const effectDirections = [
  { value: 'None', label: '无方向' }, { value: 'Right', label: '向右' },
  { value: 'Left', label: '向左' }, { value: 'Up', label: '向上' },
  { value: 'Down', label: '向下' }, { value: 'Auto', label: '自动' },
  { value: 'PressAnyKey', label: '随按键' },
];
const keyRows = ['ESC F1 F2 F3 F4 F5 F6 F7 F8 F9 F10 F11 F12 INS DEL', '` 1 2 3 4 5 6 7 8 9 0 - = BACK', 'TAB Q W E R T Y U I O P [ ] \\ HOME', 'CAPS A S D F G H J K L ; ENTER PGUP', 'SHIFT Z X C V B N M , . / SHIFT ↑ END', 'CTRL FN ⊞ ALT SPACE ALT CTRL ← ↓ →'];
const keyControls = [
  { label: '数字键盘', key: 'NumPad', invert: false },
  { label: 'Windows 键', key: 'WinKey', invert: false },
  { label: 'Fn 键可用', key: 'FnKey', invert: false },
  { label: '允许触控板快捷键', key: 'DisableTouchPadToggle', invert: true },
];
const profileChoices = [
  { key: 'performance' as const, vendorKey: 'Performance', label: '性能', index: 1, note: '最大释放性能' },
  { key: 'balanced' as const, vendorKey: 'Balanced', label: '平衡', index: 2, note: '日常使用' },
  { key: 'powersave' as const, vendorKey: 'BatterySaver', label: '省电', index: 3, note: '低功耗优先' },
];
const powerSources = [{ key: 'ac' as const, label: '外接电源', readKey: 'ac' as const }, { key: 'battery' as const, label: '电池', readKey: 'dc' as const }];
const vendorModeOptions = [{ value: 1, label: '性能' }, { value: 2, label: '平衡' }, { value: 3, label: '省电' }];
const vendorProfileDraft = reactive<Record<string, { cpu: number; dgpu: number }>>({});
const vendorProfileDirty = reactive<Record<string, boolean>>({});
function vendorDraftKey(profile: string, source: 'ac' | 'dc') { return `${profile}:${source}`; }
function vendorModeNumber(value: unknown): number | null {
  const number = Number(value);
  return [1, 2, 3].includes(number) ? number : null;
}
watch(() => state.serviceData?.currentProfiles, (profiles) => {
  for (const profile of profileChoices) for (const source of powerSources) {
    const value = profiles?.[profile.vendorKey]?.[source.readKey];
    const cpu = vendorModeNumber(value?.cpu);
    const dgpu = vendorModeNumber(value?.dgpu);
    const key = vendorDraftKey(profile.vendorKey, source.readKey);
    if (!vendorProfileDirty[key] && cpu != null && dgpu != null) vendorProfileDraft[key] = { cpu, dgpu };
  }
}, { immediate: true });
function vendorProfileEditable(profile: string, source: 'ac' | 'dc') {
  const value = state.serviceData?.currentProfiles?.[profile]?.[source];
  return state.serviceConnected && !state.fan.running && !state.busy
    && vendorModeNumber(value?.cpu) != null && vendorModeNumber(value?.dgpu) != null
    && vendorModeNumber(value?.fan) != null && !!vendorProfileDraft[vendorDraftKey(profile, source)];
}
async function saveVendorProfile(profile: typeof profileChoices[number], source: 'ac' | 'dc') {
  if (!vendorProfileEditable(profile.vendorKey, source)) return;
  const key = vendorDraftKey(profile.vendorKey, source);
  const draft = vendorProfileDraft[key];
  if (!draft || !vendorProfileDirty[key]) return;
  const active = state.serviceData?.currentState?.selectedProfile === profile.vendorKey;
  try {
    await ElMessageBox.confirm(
      `保存${profile.label}档${source === 'ac' ? '插电' : '电池'}的 CPU/独显模式${active ? '，并重新应用当前厂商档位' : ''}？官方服务要求同时提交未修改的风扇字段；此操作只在 EC 未接管时开放。`,
      '确认厂商性能配置', { type: 'warning' },
    );
  } catch { return; }
  if (await hardware.updateVendorProfile(profile.index, source, draft.cpu, draft.dgpu)) {
    vendorProfileDirty[key] = false;
    const readback = state.serviceData?.currentProfiles?.[profile.vendorKey]?.[source];
    const cpu = vendorModeNumber(readback?.cpu);
    const dgpu = vendorModeNumber(readback?.dgpu);
    if (cpu != null && dgpu != null) vendorProfileDraft[key] = { cpu, dgpu };
  }
}
const displaySliders: { key: keyof DisplaySettings; label: string; min: number; max: number; step: number; suffix?: string }[] = [
  { key: 'brightnessAc', label: '亮度 · 插电', min: 0, max: 100, step: 1, suffix: '%' },
  { key: 'brightnessDc', label: '亮度 · 电池', min: 0, max: 100, step: 1, suffix: '%' },
  { key: 'contrast', label: '对比度', min: 0, max: 100, step: 1 },
  { key: 'colorTemp', label: '色温', min: 4000, max: 7500, step: 100, suffix: ' K' },
  { key: 'red', label: '红色', min: 0, max: 255, step: 1 },
  { key: 'green', label: '绿色', min: 0, max: 255, step: 1 },
  { key: 'blue', label: '蓝色', min: 0, max: 255, step: 1 },
];
const profileIndex = computed<number | null>(() => state.author?.current_profile_index ?? null);
const profileName = computed(() => profileChoices.find((profile) => profile.index === profileIndex.value)?.label ?? (profileIndex.value == null ? '未读到' : `未知索引 (${profileIndex.value})`));
const batteryStatus = computed(() => batteryReadback(state.serviceData?.battery?.mode, state.serviceData?.battery?.chargingLevel, state.author?.battery_charging_level));
const vendorKeys = computed(() => new Map<string, boolean>(state.serviceData?.keyStates?.map((key: { type: string; state: boolean }) => [key.type, key.state]) ?? []));
const lightbar = computed(() => state.serviceData?.lighting?.lightbar);
const lightbarSetting = computed(() => lightbar.value?.[lightbarSource.value === 'ac' ? 'ac' : 'dc'] as (Rgb & { effect?: string }) | undefined);
const lightbarSupported = computed(() => state.serviceConnected && state.serviceData?.features?.includes('LightbarSingleColor') && !!lightbarSetting.value);
function lightbarModeOn(setting?: Partial<LightbarMode> | null) {
  return !!setting && Number(setting.r) + Number(setting.g) + Number(setting.b) > 0;
}
const lightbarOn = computed(() => lightbarModeOn(lightbarSetting.value as LightbarMode | undefined));
const lightbarTotalOn = computed(() => lightbarModeOn(lightbar.value?.ac) || lightbarModeOn(lightbar.value?.dc));
const lightbarPowerMemory = reactive<{ ac: LightbarMode | null; dc: LightbarMode | null }>({ ac: null, dc: null });
const lightbarPreviousGlobal = ref<{ ac: boolean; dc: boolean } | null>(null);
const lightbarPreviousBreathing = ref(false);
function lightbarMode(value: any): LightbarMode | null {
  if (!value || !['Monocolor', 'Rainbow'].includes(value.effect) ||
    !(['r', 'g', 'b'] as const).every((key) => Number.isInteger(value[key]) && value[key] >= 0 && value[key] <= 100)) return null;
  return { effect: value.effect, r: value.r, g: value.g, b: value.b };
}
function lightbarProfile(): LightbarProfile | null {
  const ac = lightbarMode(lightbar.value?.ac);
  const dc = lightbarMode(lightbar.value?.dc);
  return ac && dc && typeof lightbar.value?.breathing === 'boolean' ? { ac, dc, breathing: lightbar.value.breathing } : null;
}
watch(lightbar, (value) => {
  for (const source of ['ac', 'dc'] as const) {
    const mode = lightbarMode(value?.[source]);
    if (lightbarModeOn(mode)) lightbarPowerMemory[source] = mode;
  }
  if (lightbarModeOn(value?.ac) || lightbarModeOn(value?.dc)) lightbarPreviousBreathing.value = !!value?.breathing;
}, { immediate: true });
const customSaved = computed(() => state.serviceData?.savedDisplayModes?.find((item: { type: string }) => item.type === 'Custom'));
const selectedSavedDisplay = computed(() => {
  const type = ({ standard: 'Standard', gaming: 'Gaming', video: 'Video', reading: 'Reading' } as Record<string, string>)[displayOpen.value];
  return type ? state.serviceData?.savedDisplayModes?.find((item: { type: string }) => item.type === type) : null;
});
const presetEditableFields: Record<'standard' | VisualMode, (keyof DisplaySettings)[]> = {
  standard: [],
  gaming: ['brightnessAc', 'brightnessDc', 'colorTemp', 'contrast', 'red', 'green', 'blue'],
  video: ['brightnessAc', 'brightnessDc', 'colorTemp'],
  reading: ['brightnessAc', 'brightnessDc', 'colorTemp', 'blue'],
};
const presetDraft = reactive<DisplaySettings>({ ...displayDraft });
const presetDirty = ref(false);
const selectedPresetFields = computed(() => displayOpen.value === 'custom' ? [] : presetEditableFields[displayOpen.value]);
function markPresetDirty() {
  presetDirty.value = selectedPresetFields.value.some((key) => Number(presetDraft[key]) !== Number(selectedSavedDisplay.value?.[key]));
}
function loadSelectedPresetDraft() {
  const value = selectedSavedDisplay.value;
  if (value) for (const key of Object.keys(presetDraft) as (keyof DisplaySettings)[]) presetDraft[key] = Number(value[key]);
  presetDirty.value = false;
}
watch(displayOpen, loadSelectedPresetDraft);
watch(selectedSavedDisplay, () => { if (!presetDirty.value) loadSelectedPresetDraft(); }, { immediate: true });
async function savePresetDisplay() {
  const mode = displayOpen.value;
  if (mode === 'custom' || mode === 'standard' || !selectedSavedDisplay.value || !presetDirty.value) return;
  const label = visualModes.find((item) => item.key === mode)?.label ?? mode;
  try {
    await ElMessageBox.confirm(`保存${label}模式的可编辑参数，并向厂商服务请求应用？保存值可读回，当前画面模式无法独立读回。`, '确认保存画质', { type: 'warning' });
  } catch { return; }
  if (await hardware.setPresetDisplay(mode, { ...presetDraft })) loadSelectedPresetDraft();
}
const keyboardColor = computed(() => state.serviceData?.lighting?.keyboard?.colors?.[0] as Rgb | undefined);
const selectedLedKeyData = computed(() => keyboardUsRows.flat().find((key) => key.id === selectedLedKey.value));
const perKeyAvailable = computed(() => state.serviceConnected && state.serviceData?.features?.includes('KeyboardLedIndividualKeyControl') && state.serviceData?.lighting?.keyboard?.keyColorCount === 126);
const whisperOn = computed(() => state.serviceData?.whisper?.type && state.serviceData.whisper.type !== 'Off');

watch(customSaved, (value) => {
  if (!value) return;
  for (const key of Object.keys(displayDraft) as (keyof DisplaySettings)[]) displayDraft[key] = Number(value[key]);
}, { immediate: true });
watch([lightbarSource, lightbarSetting], () => {
  const value = lightbarSetting.value;
  if (value) Object.assign(lightbarDraft, { r: value.r, g: value.g, b: value.b });
}, { immediate: true });

function keyChecked(key: string, invert: boolean) {
  const value = vendorKeys.value.get(key);
  return value == null ? false : invert ? !value : value;
}
function keyUnavailable(key: string) { return !state.serviceConnected || !vendorKeys.value.has(key) || state.busy; }
function rgbHex(rgb?: Rgb, max = 255) {
  if (!rgb) return '#263d4c';
  return `#${(['r','g','b'] as const).map((key) => Math.round(Math.min(max, Math.max(0, rgb[key])) * 255 / max).toString(16).padStart(2, '0')).join('')}`;
}
function hexRgb(value: string, max = 255): Rgb {
  const hex = value.replace('#', '').padEnd(6, '0');
  return { r: Math.round(parseInt(hex.slice(0, 2), 16) * max / 255), g: Math.round(parseInt(hex.slice(2, 4), 16) * max / 255), b: Math.round(parseInt(hex.slice(4, 6), 16) * max / 255) };
}
function visualChoice(key: VisualMode | 'custom') {
  if (key === 'custom') { state.page = 'display'; displayOpen.value = 'custom'; return; }
  void hardware.setVisual(key);
}
function selectDisplay(key: VisualMode | 'custom') {
  displayOpen.value = key;
  if (key !== 'custom') void hardware.setVisual(key);
}
async function resetDisplaySelection() {
  const selected = displayOpen.value;
  try {
    await ElMessageBox.confirm(`恢复${selected === 'custom' ? '自定义画质' : visualModes.find((item) => item.key === selected)?.label ?? ''}的原版默认参数？当前保存的值会被覆盖。`, '确认恢复画质', { type: 'warning' });
    await hardware.resetDisplay(selected);
    if (selected !== 'custom') loadSelectedPresetDraft();
  } catch { /* User cancelled. */ }
}
async function confirmPassiveCooling(enabled: boolean) {
  try {
    await ElMessageBox.confirm(
      enabled ? '开启厂商被动散热后，EC 风扇将不能接管，直到你关闭此模式并获得服务读回。继续？' : '关闭厂商被动散热并恢复普通散热策略？',
      '确认被动散热', { type: 'warning' },
    );
  } catch { return; }
  await hardware.setPassiveCooling(enabled);
}
async function confirmPerformanceReset() {
  try {
    await ElMessageBox.confirm('将原版三档性能配置的插电/电池 CPU、dGPU 和厂商风扇字段全部恢复默认，并重新应用当前档位。此操作不会修改已保存的 EC 曲线；若中途失败，部分厂商档位可能已改变。继续？', '确认恢复厂商性能配置', { type: 'warning' });
  } catch { return; }
  await hardware.restorePerformanceDefaults();
}
function lightbarOffMode(): LightbarMode { return { effect: 'Monocolor', r: 0, g: 0, b: 0 }; }
function lightbarRestoreMode(source: 'ac' | 'dc'): LightbarMode {
  return lightbarPowerMemory[source] ?? { effect: 'Monocolor', r: 100, g: 100, b: 100 };
}
async function setLightbarOn(value: boolean) {
  const current = lightbarProfile();
  if (!current) return;
  const source = lightbarSource.value === 'ac' ? 'ac' : 'dc';
  if (value === lightbarModeOn(current[source])) return;
  if (!value) lightbarPowerMemory[source] = current[source];
  const next = { ...current, [source]: value ? lightbarRestoreMode(source) : lightbarOffMode(), breathing: value ? lightbarPreviousBreathing.value : false };
  if (await hardware.setLightbarProfile(next) && !value) lightbarPreviousBreathing.value = current.breathing;
}
async function setLightbarGlobal(value: boolean) {
  const current = lightbarProfile();
  if (!current || value === lightbarTotalOn.value) return;
  if (!value) {
    const previous = { ac: lightbarModeOn(current.ac), dc: lightbarModeOn(current.dc) };
    if (await hardware.setLightbarProfile({ ac: lightbarOffMode(), dc: lightbarOffMode(), breathing: false })) {
      lightbarPreviousGlobal.value = previous;
      lightbarPreviousBreathing.value = current.breathing;
    }
    return;
  }
  const previous = lightbarPreviousGlobal.value ?? { ac: true, dc: false };
  await hardware.setLightbarProfile({
    ac: previous.ac ? lightbarRestoreMode('ac') : lightbarOffMode(),
    dc: previous.dc ? lightbarRestoreMode('dc') : lightbarOffMode(),
    breathing: lightbarPreviousBreathing.value,
  });
}
function setLightbarBreathing(value: boolean) {
  const color = lightbarSetting.value ? { r: lightbarSetting.value.r, g: lightbarSetting.value.g, b: lightbarSetting.value.b } : { ...lightbarDraft };
  void hardware.setLightbar(lightbarSource.value, color, value);
}
async function resetLightbarSource() {
  const source = lightbarSource.value;
  try { await ElMessageBox.confirm(`恢复${source === 'ac' ? '外接电源' : '电池'}光条的原版内置颜色和单色效果？当前颜色会被覆盖，闲置计时保留。`, '确认恢复光条', { type: 'warning' }); }
  catch { return; }
  await hardware.setLightbar(source, source === 'ac' ? { r: 100, g: 100, b: 100 } : { r: 0, g: 0, b: 0 }, !!lightbar.value?.breathing);
}
function editLightbarColor(value: string | null) { if (value) Object.assign(lightbarDraft, hexRgb(value, 100)); }
function windowAction(action: 'minimize' | 'toggleMaximize' | 'close') { if (isTauri()) void getCurrentWindow()[action](); }
function degree(value: number | null) { return value == null ? '—' : `${value}°C`; }
function rpm(value: number | null) { return value == null ? '—' : `${value} RPM`; }
function percent(value: number | null | undefined) { return value == null ? '—' : `${Math.round(value)}%`; }
function mhz(value: number | null | undefined) { return value == null ? '—' : `${value} MHz`; }
function gbFromKb(value: number | null | undefined) { return value == null ? '—' : `${(value / 1024 / 1024).toFixed(1)} GB`; }
const memoryUsage = computed(() => {
  const memory = state.monitor?.memory;
  if (!memory?.totalKb || memory.freeKb == null) return null;
  return Math.round((1 - memory.freeKb / memory.totalKb) * 100);
});
function keyboardPaletteApply(value: string) { void hardware.setKeyboardColor(hexRgb(value)); }
function currentLedColor(key: KeyboardLedKey): Rgb | undefined {
  const keyboard = state.serviceData?.lighting?.keyboard;
  return keyboard?.effect === 'UserMode' ? keyboard.keyColors?.[key.indices[0]] : keyboard?.colors?.[0];
}
function selectLedKey(key: KeyboardLedKey) {
  if (groupEditing.value) {
    groupKeyIds.value = groupKeyIds.value.includes(key.id)
      ? groupKeyIds.value.filter((id) => id !== key.id) : [...groupKeyIds.value, key.id];
    return;
  }
  selectedLedKey.value = key.id;
  selectedLedColor.value = rgbHex(currentLedColor(key));
}
function selectKeyboardGroup(id: string) {
  selectedKeyboardGroup.value = id;
  groupKeyIds.value = [...(keyboardGroups.value.find((group) => group.id === id)?.keyIds ?? [])];
  groupEditing.value = false;
}
function newKeyboardGroup() {
  selectedKeyboardGroup.value = '';
  groupKeyIds.value = [];
  groupEditing.value = true;
}
async function saveKeyboardGroup() {
  if (!groupKeyIds.value.length) { hardware.toast('请先选中至少一个键'); return; }
  const existing = keyboardGroups.value.find((group) => group.id === selectedKeyboardGroup.value);
  if (!existing && keyboardGroups.value.length >= 20) { hardware.toast('最多保存 20 个键组'); return; }
  let name = existing?.name;
  if (!name) {
    try { ({ value: name } = await ElMessageBox.prompt('输入键组名称（最多 32 字）', '保存键组', { inputPattern: /^.{1,32}$/, inputErrorMessage: '请输入 1–32 个字符' })); }
    catch { return; }
  }
  name = name?.trim();
  if (!name) return;
  const group: KeyboardGroup = { id: existing?.id ?? crypto.randomUUID(), name, keyIds: [...groupKeyIds.value] };
  const next = existing ? keyboardGroups.value.map((item) => item.id === existing.id ? group : item) : [...keyboardGroups.value, group];
  try {
    writeKeyboardGroups(next);
    keyboardGroups.value = next;
    selectedKeyboardGroup.value = group.id;
    groupEditing.value = false;
    hardware.toast(`键组“${name}”已保存到本机；尚未写入硬件`);
  } catch (error) { hardware.toast(`键组保存失败：${String(error)}`); }
}
async function deleteKeyboardGroup() {
  const group = keyboardGroups.value.find((item) => item.id === selectedKeyboardGroup.value);
  if (!group) return;
  try { await ElMessageBox.confirm(`删除本机键组“${group.name}”？`, '确认删除键组', { type: 'warning' }); }
  catch { return; }
  const next = keyboardGroups.value.filter((item) => item.id !== group.id);
  try {
    writeKeyboardGroups(next);
    keyboardGroups.value = next;
    selectKeyboardGroup('');
    hardware.toast('本机键组已删除');
  } catch (error) { hardware.toast(`键组删除失败：${String(error)}`); }
}
async function renameKeyboardGroup() {
  const group = keyboardGroups.value.find((item) => item.id === selectedKeyboardGroup.value);
  if (!group) return;
  let name: string;
  try { ({ value: name } = await ElMessageBox.prompt('输入新名称（最多 32 字）', '重命名键组', { inputValue: group.name, inputPattern: /^.{1,32}$/, inputErrorMessage: '请输入 1–32 个字符' })); }
  catch { return; }
  name = name.trim();
  if (!name || name === group.name) return;
  const next = keyboardGroups.value.map((item) => item.id === group.id ? { ...item, name } : item);
  try { writeKeyboardGroups(next); keyboardGroups.value = next; hardware.toast('键组名称已保存到本机'); }
  catch (error) { hardware.toast(`重命名失败：${String(error)}`); }
}
async function paintKeyboardGroup() {
  const slots = keyboardGroupSlots(groupKeyIds.value);
  if (!slots.length || !perKeyAvailable.value) return;
  if (!/^#[0-9a-f]{6}$/i.test(selectedLedColor.value ?? '')) { hardware.toast('请先选择有效的键盘颜色'); return; }
  if (state.serviceData?.lighting?.keyboard?.effect !== 'UserMode') {
    try { await ElMessageBox.confirm(`将 ${groupKeyIds.value.length} 个实体键切换为自定义逐键颜色？其它灯位保留现有颜色。`, '确认键组上色', { type: 'warning' }); }
    catch { return; }
  }
  await hardware.setKeyGroupColor(slots, hexRgb(selectedLedColor.value));
}
async function paintSelectedKey() {
  const key = selectedLedKeyData.value;
  if (!key || !perKeyAvailable.value) return;
  if (!/^#[0-9a-f]{6}$/i.test(selectedLedColor.value ?? '')) { hardware.toast('请先选择有效的键盘颜色'); return; }
  if (state.serviceData?.lighting?.keyboard?.effect !== 'UserMode') {
    try { await ElMessageBox.confirm('首次逐键上色会切换到自定义逐键模式。其它键会保留已有逐键颜色；若尚未设置，则以当前主颜色填充。', '切换键盘灯模式', { type: 'warning' }); }
    catch { return; }
  }
  await hardware.setKeyColor(key.indices, hexRgb(selectedLedColor.value));
}
function captureKeyboardProfile(name: string): KeyboardProfile | null {
  const keyboard = state.serviceData?.lighting?.keyboard;
  const color = keyboard?.colors?.[0];
  const brightness = state.serviceData?.keyboardBrightness;
  const idle = state.serviceData?.keyboardIdleTimer;
  if (!state.serviceConnected || !keyboard || !color || brightness?.ac == null || brightness?.dc == null || idle?.ac == null || idle?.dc == null) return null;
  if (keyboard.effect === 'UserMode' && !validKeyPalette(keyboard.keyColors)) return null;
  return {
    id: crypto.randomUUID(), name, effect: String(keyboard.effect), direction: String(keyboard.direction), speed: Number(keyboard.speed),
    color: { r: Number(color.r), g: Number(color.g), b: Number(color.b) },
    brightnessAc: Number(brightness.ac), brightnessDc: Number(brightness.dc), idleAc: Number(idle.ac), idleDc: Number(idle.dc),
    ...(keyboard.effect === 'UserMode' ? { keyColors: keyboard.keyColors.map((item: Rgb) => ({ r: item.r, g: item.g, b: item.b })) } : {}),
  };
}
async function saveKeyboardProfile() {
  if (keyboardProfiles.value.length >= 20) { hardware.toast('最多保存 20 个本地键盘配置'); return; }
  const snapshot = captureKeyboardProfile('');
  if (!snapshot) { hardware.toast('无法完整读取键盘参数，暂不能保存配置'); return; }
  let value: string;
  try { ({ value } = await ElMessageBox.prompt('输入配置名称（最多 32 字）', '保存当前硬件配置', { inputPattern: /^.{1,32}$/, inputErrorMessage: '请输入 1–32 个字符' })); }
  catch { return; }
  snapshot.name = value.trim();
  if (!snapshot.name) return;
  try {
    const next = [...keyboardProfiles.value, snapshot];
    writeKeyboardProfiles(next);
    keyboardProfiles.value = next;
    selectedKeyboardProfile.value = snapshot.id;
    hardware.toast('当前硬件读回已保存到本机；尚未再次应用');
  } catch (error) { hardware.toast(`无法保存本地配置：${String(error)}`); }
}
async function resetKeyboardDefaults() {
  try { await ElMessageBox.confirm('将键盘主颜色恢复为白色、插电亮度 100%、电池亮度 50%，并恢复原版灯效/定时默认值？现有逐键颜色可能不再显示。', '确认恢复键盘默认值', { type: 'warning' }); }
  catch { return; }
  await hardware.applyKeyboardProfile({
    id: 'original-defaults', name: '原版内置默认', effect: 'Monocolor', direction: 'Right', speed: 5,
    color: { r: 255, g: 255, b: 255 }, brightnessAc: 100, brightnessDc: 50, idleAc: 0, idleDc: 4,
  });
}
async function renameKeyboardProfile() {
  const selected = keyboardProfiles.value.find((item) => item.id === selectedKeyboardProfile.value);
  if (!selected) return;
  let value: string;
  try { ({ value } = await ElMessageBox.prompt('新名称', '重命名配置', { inputValue: selected.name, inputPattern: /^.{1,32}$/, inputErrorMessage: '请输入 1–32 个字符' })); }
  catch { return; }
  const name = value.trim();
  if (!name) return;
  try {
    const next = keyboardProfiles.value.map((item) => item.id === selected.id ? { ...item, name } : item);
    writeKeyboardProfiles(next);
    keyboardProfiles.value = next;
  } catch (error) { hardware.toast(`无法重命名本地配置：${String(error)}`); }
}
async function deleteKeyboardProfile() {
  const selected = keyboardProfiles.value.find((item) => item.id === selectedKeyboardProfile.value);
  if (!selected) return;
  try { await ElMessageBox.confirm(`删除本地配置“${selected.name}”？不会改变当前键盘灯。`, '删除配置', { type: 'warning' }); }
  catch { return; }
  try {
    const next = keyboardProfiles.value.filter((item) => item.id !== selected.id);
    writeKeyboardProfiles(next);
    keyboardProfiles.value = next;
    selectedKeyboardProfile.value = '';
  } catch (error) { hardware.toast(`无法删除本地配置：${String(error)}`); }
}
function applySelectedKeyboardProfile() {
  const selected = keyboardProfiles.value.find((item) => item.id === selectedKeyboardProfile.value);
  if (selected) void hardware.applyKeyboardProfile(selected);
}
function changeFanScene(value: string | number | boolean) { void hardware.setFanScene(String(value) as Scene); }
</script>

<template>
  <div class="studio-shell">
    <header class="studio-titlebar" data-tauri-drag-region>
      <div class="studio-brand" data-tauri-drag-region><span class="brand-mark">nuc</span><strong>NUCtool 软件工作室</strong><small>STUDIO</small></div>
      <div class="window-actions"><button aria-label="关于 NUCtool" title="关于" @click="aboutOpen = true">⚙</button><button aria-label="最小化" @click="windowAction('minimize')">—</button><button aria-label="最大化" @click="windowAction('toggleMaximize')">□</button><button aria-label="关闭" @click="windowAction('close')">×</button></div>
    </header>
    <div v-if="!isTauri()" class="preview-strip">浏览器预览 · 所有设备数值为模拟数据，不会操作硬件</div>
    <main class="studio-main" :class="`page-${state.page}`">
      <div v-if="state.page === 'home'" class="studio-dashboard">
        <div v-if="state.serviceReady && (!state.serviceConnected || !state.bridgeAvailable)" class="connection-banner" role="status">
          <strong>部分控制暂不可用</strong><span v-if="!state.serviceConnected">官方服务未连接：{{ state.serviceDetail }}。系统键、键盘颜色、光条和自定义画质暂不可操作。<small v-if="state.serviceData?.errors?.length">{{ state.serviceData.errors[0] }}</small></span><el-button v-if="!state.serviceConnected" size="small" @click="hardware.refreshService">重新检测服务</el-button><span v-if="!state.bridgeAvailable">NUCtool.dll 未就绪；性能档位、四个画质预设及基础键盘/电池控制不可操作。{{ state.bridgeDetail }}</span>
        </div>
        <div class="dashboard-top">
          <section class="studio-card system-card">
            <div class="card-header"><span class="card-icon">⚙</span><h2>系统配置</h2><small>官方服务 / 电池</small></div>
            <div class="system-body">
              <div class="system-keys"><div v-for="item in keyControls" :key="item.key" class="control-line"><span>{{ item.label }}</span><el-switch :model-value="keyChecked(item.key, item.invert)" :disabled="keyUnavailable(item.key)" aria-label="切换按键设置" @change="(value: boolean) => hardware.setKey(item.key, item.invert ? !value : value)" /></div><div class="control-line"><span>屏幕提示 <i class="request-hint">请求</i></span><el-switch :model-value="!!state.lastOsd" :disabled="!state.serviceConnected || state.busy" @change="(value: boolean) => hardware.setOsd(value)" /></div></div>
              <div class="system-battery"><h3>电池健康优化器</h3><el-radio-group v-model="state.batteryChoice" class="battery-radios"><el-radio value="best">最佳电池健康</el-radio><el-radio value="custom">自定义上限</el-radio><el-radio value="full">充至 100%</el-radio></el-radio-group><div v-if="state.batteryChoice === 'custom'" class="battery-slider"><el-slider v-model="state.batteryDraft" :min="50" :max="100" :step="5" /><strong>{{ state.batteryDraft }}%</strong></div><el-button type="primary" size="small" :loading="state.busy" :disabled="!state.serviceConnected || (state.batteryChoice !== 'best' && !state.bridgeAvailable) || state.busy" @click="hardware.setBattery">应用设置</el-button><small>所选为待应用设置，右侧为设备读回。</small></div>
              <div class="battery-status"><div class="battery-graphic"><i /></div><strong>{{ batteryStatus.label }}</strong><small :class="{ 'battery-conflict': batteryStatus.consistent === false }">{{ batteryStatus.detail }}</small><span>DLL 阈值 {{ state.author?.battery_charging_level == null ? '—' : `${state.author.battery_charging_level}%` }} · 当前电量 {{ state.batteryPercent == null ? '—' : `${state.batteryPercent}%` }}</span></div>
            </div>
          </section>
          <section class="studio-card performance-card">
            <div class="card-header"><span class="card-icon">◉</span><h2>性能调优</h2><small>DLL 性能 / EC 散热</small><button class="open-detail" aria-label="打开性能调优" @click="state.page = 'performance'">➜</button></div>
            <div class="performance-body"><div class="summary-grid"><div><span>性能模式</span><strong>{{ profileName }}</strong><small>NUCtool.dll 全局档位</small></div><div><span>风扇模式</span><strong>{{ state.fan.running ? 'EC 接管' : '系统控制' }}</strong><small>{{ state.fan.health }}</small></div><div><span>风扇速度</span><strong>{{ rpm(state.fan.cpuRpm) }}</strong><small>左风扇 / 右风扇 {{ rpm(state.fan.gpuRpm) }}</small></div></div><div class="sensor-grid"><div class="sensor-dial"><span>CPU</span><strong>{{ percent(state.monitor?.cpu?.usage) }}</strong><small>{{ degree(state.fan.cpuTemp) }}</small></div><div class="sensor-dial"><span>dGPU</span><strong>{{ percent(state.monitor?.dgpu?.usage) }}</strong><small>{{ degree(state.fan.gpuTemp) }}</small></div><div class="sensor-aside"><b>✣</b><span>左风扇<br /><strong>{{ rpm(state.fan.cpuRpm) }}</strong></span><b>✣</b><span>右风扇<br /><strong>{{ rpm(state.fan.gpuRpm) }}</strong></span></div></div></div>
          </section>
        </div>
        <div class="dashboard-bottom">
          <section class="studio-card display-card"><div class="card-header"><span class="card-icon">▱</span><h2>显示设置</h2><button class="open-detail" aria-label="打开显示设置" @click="state.page = 'display'">➜</button></div><div class="display-home-body"><div class="display-list"><button v-for="item in visualModes" :key="item.key" :class="{ chosen: state.lastVisual === item.key }" :disabled="!state.bridgeAvailable || state.busy" @click="visualChoice(item.key)"><i />{{ item.label }}</button><button :class="{ chosen: state.lastVisual === 'custom' }" @click="visualChoice('custom')"><i />自定义</button></div><div class="display-description"><strong>画质模式</strong><p>标准、游戏、视频、阅读由 NUCtool.dll 请求切换。</p><small>自定义参数由官方服务保存并读回；当前生效模式无回读。</small></div></div></section>
          <section class="studio-card keyboard-card"><div class="card-header"><span class="card-icon">▤</span><h2>键盘</h2><button class="open-detail" aria-label="打开键盘设置" @click="state.page = 'keyboard'">➜</button></div><div class="keyboard-art"><div v-for="(row, index) in keyRows" :key="index"><span v-for="(key, keyIndex) in row.split(' ')" :key="`${index}-${keyIndex}`">{{ key }}</span></div></div><div class="keyboard-home-foot"><span>颜色：{{ keyboardColor ? rgbHex(keyboardColor) : '未读到' }}</span><label>背光 <el-switch :model-value="!!state.author?.keyboard_enabled" :disabled="!state.bridgeAvailable || state.author?.keyboard_enabled == null || state.busy" @change="(value: boolean) => hardware.setKeyboard(value)" /></label></div></section>
          <section class="studio-card lightbar-card"><div class="card-header"><span class="card-icon">━</span><h2>光条</h2><button class="open-detail" aria-label="打开光条设置" @click="state.page = 'lightbar'">➜</button></div><div class="lightbar-home-body"><div><span>使用外接电源：</span><i :style="{ background: rgbHex(lightbar?.ac, 100) }" /></div><div><span>使用电池：</span><i :style="{ background: rgbHex(lightbar?.dc, 100) }" /></div><div class="lightbar-home-foot"><span>呼吸效果</span><el-switch :model-value="!!lightbar?.breathing" :disabled="!lightbarSupported || state.busy" @change="(value: boolean) => hardware.setLightbar('ac', { r: lightbar?.ac?.r ?? 0, g: lightbar?.ac?.g ?? 0, b: lightbar?.ac?.b ?? 0 }, value)" /></div></div></section>
        </div>
        <div class="module-row"><button @click="state.page = 'ec'"><span>✣</span><strong>EC 风扇控制</strong><small>{{ state.fan.health }}</small><b>›</b></button><button @click="state.page = 'monitor'"><span>▥</span><strong>系统监视器</strong><small>设备状态与硬件读数</small><b>›</b></button></div>
      </div>

      <div v-else class="detail-wrap" :class="`detail-${state.page}`">
        <nav class="breadcrumbs"><button @click="state.page = 'home'">‹ 主页</button><span>› {{ ({ performance: '性能调优', display: '显示设置', keyboard: '键盘', lightbar: '光条', monitor: '系统监视器', ec: 'EC 风扇控制' } as Record<string,string>)[state.page] }}</span></nav>
        <section class="detail-panel"><div class="detail-heading"><span class="detail-icon">{{ ({ performance: '◉', display: '▱', keyboard: '▤', lightbar: '━', monitor: '▥', ec: '✣' } as Record<string,string>)[state.page] }}</span><h1>{{ ({ performance: '性能调优', display: '显示设置', keyboard: '键盘', lightbar: '光条', monitor: '系统监视器', ec: 'EC 风扇控制' } as Record<string,string>)[state.page] }}</h1><span v-if="state.page === 'monitor'" class="heading-side">电量 {{ state.batteryPercent == null ? '—' : `${state.batteryPercent}%` }}</span></div>
          <div v-if="state.page === 'performance'" class="detail-body performance-detail"><div class="detail-section-title">NUCtool.dll 性能档位 <small>下方厂商 AC/DC 配置独立保存；全局档位不能代替它</small></div><div class="profile-grid"><button v-for="profile in profileChoices" :key="profile.key" :class="{ selected: profileIndex === profile.index }" :disabled="!state.bridgeAvailable || state.busy" @click="hardware.setProfile(profile.key)"><strong>{{ profile.label }}</strong><span>{{ profile.note }}</span><small>{{ profileIndex === profile.index ? '硬件已读回' : `DLL 档位 ${profile.index}` }}</small></button></div><div class="performance-settings"><div class="setting-row"><div><strong>基准模式</strong><small>DLL 独立请求；关闭只清标记，计划 4 保留</small></div><div class="button-pair"><el-button :disabled="!state.bridgeAvailable || state.busy" @click="hardware.setBenchmark(true)">请求开启</el-button><el-button :disabled="!state.bridgeAvailable || state.busy" @click="hardware.setBenchmark(false)">请求关闭</el-button></div></div><div class="setting-row"><div><strong>NVIDIA WhisperMode</strong><small>官方服务设置并读回；风扇仍由 EC 独立管理</small></div><el-switch :model-value="!!whisperOn" :disabled="!state.serviceConnected || !state.serviceData?.whisper || state.busy" @change="(value: boolean) => hardware.setWhisper(value)" /></div><div class="setting-row"><div><strong>EC 风扇策略</strong><small>与 DLL 性能档位互不联动</small></div><el-button @click="state.page = 'ec'">打开 EC 控制</el-button></div></div><div class="detail-telemetry"><span>CPU {{ degree(state.fan.cpuTemp) }}</span><span>dGPU {{ degree(state.fan.gpuTemp) }}</span><span>左 {{ rpm(state.fan.cpuRpm) }}</span><span>右 {{ rpm(state.fan.gpuRpm) }}</span></div></div>
          <div v-else-if="state.page === 'display'" class="detail-body display-detail"><div class="display-modes"><button v-for="item in visualModes" :key="item.key" :class="{ selected: displayOpen === item.key }" :disabled="!state.bridgeAvailable || state.busy" @click="selectDisplay(item.key)"><i />{{ item.label }}</button><button :class="{ selected: displayOpen === 'custom' }" @click="selectDisplay('custom')"><i />自定义</button></div><div v-if="displayOpen === 'custom'" class="display-editor"><div v-for="slider in displaySliders" :key="slider.key" class="slider-line"><label>{{ slider.label }}</label><el-slider v-model="displayDraft[slider.key]" :min="slider.min" :max="slider.max" :step="slider.step" :disabled="!state.serviceConnected || !customSaved || state.busy" /><output>{{ displayDraft[slider.key] }}{{ slider.suffix }}</output></div><el-button type="primary" :disabled="!state.serviceConnected || !customSaved || state.busy" @click="hardware.setCustomDisplay({ ...displayDraft })">保存并启用自定义</el-button></div><div v-else class="display-editor display-info"><h2>{{ visualModes.find((mode) => mode.key === displayOpen)?.label }}画质预设</h2><p>通过 NUCtool.dll 请求切换。厂商接口不提供当前模式读回，因此不会标为“已生效”。</p><p>最近请求：{{ state.lastVisual ? visualModes.find((mode) => mode.key === state.lastVisual)?.label ?? '自定义' : '无' }}</p></div><aside class="display-aside"><strong>状态说明</strong><p>自定义参数：{{ customSaved ? `官方服务已读到索引 ${customSaved.index}` : '未读到配置' }}。</p><p>保存参数可读回；实际显示模式目前只能确认请求已发送。</p></aside></div>
          <div v-else-if="state.page === 'keyboard'" class="detail-body keyboard-detail"><div class="keyboard-controls"><div class="setting-row"><div><strong>启用键盘 LED</strong><small>NUCtool.dll · 开关可读回</small></div><el-switch :model-value="!!state.author?.keyboard_enabled" :disabled="!state.bridgeAvailable || state.author?.keyboard_enabled == null || state.busy" @change="(value: boolean) => hardware.setKeyboard(value)" /></div><div class="setting-row"><div><strong>单色灯效</strong><small>当前已验证的官方服务控制</small></div><span class="readback-badge">{{ state.serviceData?.lighting?.keyboard?.effect ?? '未读到' }}</span></div><div class="keyboard-color-panel"><h3>选择键盘颜色</h3><div class="palette"><button v-for="hex in keyboardPalette" :key="hex" :style="{ background: hex }" :aria-label="`设置键盘颜色 ${hex}`" :disabled="!state.serviceConnected || !state.serviceData?.lighting?.keyboard || state.busy" @click="keyboardPaletteApply(hex)" /></div><el-color-picker :model-value="rgbHex(keyboardColor)" :disabled="!state.serviceConnected || state.busy" @change="(value: string | null) => value && keyboardPaletteApply(value)" /><p>当前读回：{{ keyboardColor ? `R${keyboardColor.r} G${keyboardColor.g} B${keyboardColor.b}` : '暂无' }}</p></div></div><div class="keyboard-preview"><div class="keyboard-art"><div v-for="(row, index) in keyRows" :key="index"><span v-for="(key, keyIndex) in row.split(' ')" :key="`${index}-${keyIndex}`">{{ key }}</span></div></div><p>US 键位逐键上色在下方操作，并可保存完整灯位配置；其他键盘布局尚未支持。亮度和熄灯计时可按插电、电池分别设置。</p></div></div>
          <div v-else-if="state.page === 'lightbar'" class="detail-body lightbar-detail"><div class="lightbar-toolbar"><el-radio-group v-model="lightbarSource"><el-radio-button value="ac">外接电源</el-radio-button><el-radio-button value="battery">电池</el-radio-button></el-radio-group><div>当前供电侧点亮 <el-switch :model-value="lightbarOn" :disabled="!lightbarSupported || !lightbarProfile() || state.busy" @change="(value: boolean) => setLightbarOn(value)" /></div></div><div class="lightbar-editor"><div class="lightbar-preview"><div class="light-strip" :style="{ background: rgbHex(lightbarSetting, 100) }" /><strong>当前颜色</strong><div class="color-block" :style="{ background: rgbHex(lightbarSetting, 100) }" /><small>{{ lightbarSetting ? `R ${lightbarSetting.r} · G ${lightbarSetting.g} · B ${lightbarSetting.b}` : '官方服务未读到光条状态' }}</small></div><div class="lightbar-color"><h3>设置新颜色</h3><el-color-picker :model-value="rgbHex(lightbarDraft, 100)" :disabled="!lightbarSupported || state.busy" @change="editLightbarColor" /><div v-for="channel in (['r','g','b'] as const)" :key="channel" class="slider-line"><label>{{ ({ r: '红色', g: '绿色', b: '蓝色' } as Record<string,string>)[channel] }}</label><el-slider v-model="lightbarDraft[channel]" :min="0" :max="100" :disabled="!lightbarSupported || state.busy" /><output>{{ lightbarDraft[channel] }}%</output></div></div><div class="lightbar-side"><div class="setting-row"><span>呼吸效果</span><el-switch :model-value="!!lightbar?.breathing" :disabled="!lightbarSupported || state.busy" @change="(value: boolean) => setLightbarBreathing(value)" /></div><el-button type="primary" :disabled="!lightbarSupported || state.busy" @click="hardware.setLightbar(lightbarSource, { ...lightbarDraft }, !!lightbar?.breathing)">应用到{{ lightbarSource === 'ac' ? '外接电源' : '电池' }}</el-button><small>仅修改当前供电配置；颜色与呼吸状态由官方服务读回。</small></div></div></div>
          <div v-else-if="state.page === 'monitor'" class="detail-body monitor-detail">
            <div v-if="state.monitorError" class="connection-banner" role="status">监视器本次读取失败：{{ state.monitorError }}。保留上次读数；请检查 Windows 硬件信息服务。</div>
            <div class="monitor-grid">
              <div class="monitor-tile"><div class="monitor-gauge">{{ percent(state.monitor?.cpu?.usage) }}</div><div><h2>CPU</h2><p>{{ state.monitor?.cpu?.name ?? '未读到型号' }}</p><p>使用率 <strong>{{ percent(state.monitor?.cpu?.usage) }}</strong></p><p>温度 <strong>{{ degree(state.fan.cpuTemp) }}</strong></p><p>当前 / 系统报告上限 <strong>{{ mhz(state.monitor?.cpu?.currentMhz) }} / {{ mhz(state.monitor?.cpu?.maxMhz) }}</strong></p><p>二级 / 三级缓存 <strong>{{ state.monitor?.cpu?.l2Kb ?? '—' }} / {{ state.monitor?.cpu?.l3Kb ?? '—' }} KB</strong></p></div></div>
              <div class="monitor-tile"><div class="monitor-gauge">{{ percent(memoryUsage) }}</div><div><h2>内存</h2><p>使用率 <strong>{{ percent(memoryUsage) }}</strong></p><p>可用 / 总量 <strong>{{ gbFromKb(state.monitor?.memory?.freeKb) }} / {{ gbFromKb(state.monitor?.memory?.totalKb) }}</strong></p><p>频率 <strong>{{ mhz(state.monitor?.memory?.speedMhz) }}</strong></p></div></div>
              <div class="monitor-tile"><div class="monitor-gauge">{{ percent(state.monitor?.igpu?.usage) }}</div><div><h2>iGPU</h2><p>{{ state.monitor?.igpu?.name ?? '未读到型号' }}</p><p>使用率 <strong>{{ percent(state.monitor?.igpu?.usage) }}</strong></p><p>温度 <strong>—</strong></p><p>频率 <strong>{{ mhz(state.monitor?.igpu?.currentMhz) }}</strong></p><small>此设备暂无可靠的 iGPU 动态读数</small></div></div>
              <div class="monitor-tile"><div class="monitor-gauge">{{ percent(state.monitor?.dgpu?.usage) }}</div><div><h2>dGPU</h2><p>{{ state.monitor?.dgpu?.name ?? '未读到型号' }}</p><p>使用率 <strong>{{ percent(state.monitor?.dgpu?.usage) }}</strong></p><p>温度 <strong>{{ degree(state.monitor?.dgpu?.temperature ?? state.fan.gpuTemp) }}</strong></p><p>频率 <strong>{{ mhz(state.monitor?.dgpu?.currentMhz) }}</strong></p><p>显存 <strong>{{ state.monitor?.dgpu?.memoryUsedMb ?? '—' }} / {{ state.monitor?.dgpu?.memoryTotalMb ?? '—' }} MB</strong></p></div></div>
            </div>
            <div class="monitor-footer"><span>BIOS {{ state.monitor?.system?.bios ?? '—' }} · EC — · 型号 {{ state.monitor?.system?.model ?? '—' }} · SKU {{ state.monitor?.system?.sku ?? '—' }} · {{ state.monitor?.system?.manufacturer ?? '—' }}</span><span>左风扇 {{ rpm(state.fan.cpuRpm) }}</span><span>右风扇 {{ rpm(state.fan.gpuRpm) }}</span></div>
            <small>采样 {{ state.monitor?.sampledAt ? new Date(state.monitor.sampledAt).toLocaleTimeString() : '—' }}。— 表示当前没有可靠读数，不代表 0。</small>
          </div>
          <div v-else-if="state.page === 'ec'" class="detail-body ec-detail">
            <div class="ec-health"><div><strong>{{ state.fan.health }}</strong><small>最近采样 {{ state.fan.lastSampled }} · 丢失 {{ state.fan.droppedSamples }} 个采样</small><small v-if="state.serviceData?.currentState?.passiveCooling">厂商被动散热已开启，请先在性能页关闭</small></div><el-button :type="state.fan.running ? 'default' : 'primary'" :disabled="state.busy || (!state.fan.running && !!state.serviceData?.currentState?.passiveCooling)" @click="hardware.toggleFan">{{ state.fan.running ? '交还系统控制' : '启用 EC 控制' }}</el-button></div>
            <div class="ec-power-auto">
              <div><strong>按电源来源切换 EC 风扇曲线</strong><small>当前：{{ state.powerSource === 'ac' ? '外接电源' : state.powerSource === 'battery' ? '电池' : '未识别（使用下方手动曲线）' }}。恒定转速启用时优先生效，温度保护始终保留。</small></div>
              <el-switch :model-value="state.fan.powerAuto" :disabled="state.busy" aria-label="按电源来源自动切换 EC 风扇曲线" @change="(value: boolean) => hardware.setFanPowerAuto(value)" />
              <template v-if="state.fan.powerAuto">
                <label>插电策略 <el-select :model-value="state.fan.acScene" :disabled="state.busy" aria-label="插电风扇策略" @change="(value: Scene) => hardware.setFanPowerScene('ac', value)"><el-option v-for="(scene, key) in hardware.scenarios" :key="key" :label="scene.label" :value="key" /></el-select></label>
                <label>电池策略 <el-select :model-value="state.fan.dcScene" :disabled="state.busy" aria-label="电池风扇策略" @change="(value: Scene) => hardware.setFanPowerScene('battery', value)"><el-option v-for="(scene, key) in hardware.scenarios" :key="key" :label="scene.label" :value="key" /></el-select></label>
              </template>
            </div>
            <p v-if="state.fan.powerAuto" class="ec-fallback-note">下方手动曲线仅在电源状态无法识别时使用；切换电源后的风速会按 EC 安全限速逐步变化。</p>
            <div class="ec-scenes"><button v-for="(scene, key) in hardware.scenarios" :key="key" :class="{ selected: state.fan.scene === key }" :disabled="state.busy" @click="changeFanScene(key)"><strong>{{ scene.label }}</strong><small>{{ key === 'quiet' ? '低噪优先' : key === 'balanced' ? '日常平衡' : '高负载散热' }}</small></button></div>
            <div class="ec-curves"><div v-for="side in (['cpu','gpu'] as const)" :key="side"><h3>{{ side === 'cpu' ? 'CPU / 左风扇' : 'GPU / 右风扇' }}</h3><div v-for="(speed, index) in state.fan[side === 'cpu' ? 'cpuCurve' : 'gpuCurve']" :key="index" class="ec-curve-point"><span>{{ 35 + 5 * index }}°C</span><el-slider v-model="state.fan[side === 'cpu' ? 'cpuCurve' : 'gpuCurve'][index]" :min="20" :max="100" :step="1" :disabled="state.busy" /><output>{{ speed }}%</output></div></div></div>
            <div class="ec-advanced"><label>恒定转速 <el-switch v-model="state.fan.constant" :disabled="state.busy" /></label><el-slider v-model="state.fan.constantSpeed" :min="20" :max="100" :step="5" :disabled="!state.fan.constant || state.busy" /><output>{{ state.fan.constantSpeed }}%</output><label>开机自动接管 <el-switch v-model="state.fan.startupTakeover" :disabled="state.busy" /></label></div>
            <div class="ec-actions"><el-button :disabled="state.busy || !state.fan.running" @click="hardware.updateFan">同步到 EC</el-button><el-button type="primary" :disabled="state.busy" @click="hardware.saveFan">保存策略</el-button><small>EC 只控制风扇，性能模式仍由 NUCtool.dll 控制。</small></div>
          </div>
          <section v-if="state.page === 'display'" class="aux-panel">
            <h2>恢复画质默认值 <small>原版预设经官方服务恢复；自定义使用原版出厂参数</small></h2>
            <div class="aux-row">
              <el-button :disabled="!state.serviceConnected || state.busy || (displayOpen === 'custom' && !customSaved)" @click="resetDisplaySelection">恢复当前选中模式</el-button>
              <small>覆盖已保存参数。预设恢复后可重新读取配置；当前实际生效的画质仍无法回读。</small>
            </div>
          </section>
          <section v-if="state.page === 'display' && displayOpen !== 'custom'" class="aux-panel">
            <h2>当前预设参数 <small>官方服务读回 · 当前实际生效模式无法确认</small></h2>
            <div v-if="selectedSavedDisplay" class="display-saved-grid">
              <span v-for="field in displaySliders" :key="field.key">{{ field.label }} <strong>{{ selectedSavedDisplay[field.key] }}{{ field.suffix }}</strong></span>
            </div>
            <p v-else>官方服务未返回这个预设的保存参数。</p>
            <div v-if="selectedSavedDisplay && selectedPresetFields.length" class="display-preset-editor">
              <div v-for="field in displaySliders.filter((item) => selectedPresetFields.includes(item.key))" :key="field.key" class="slider-line">
                <label>{{ field.label }}</label>
                <el-slider v-model="presetDraft[field.key]" :min="field.min" :max="field.max" :step="field.step" :disabled="!state.serviceConnected || state.busy" @change="markPresetDirty" />
                <output>{{ presetDraft[field.key] }}{{ field.suffix }}</output>
              </div>
              <el-button type="primary" :disabled="!state.serviceConnected || state.busy || !presetDirty" @click="savePresetDisplay">保存并请求应用</el-button>
              <small>仅开放原版允许编辑的参数。阅读模式的蓝色通道为原版特有规则；其余灰置参数保持原值。</small>
            </div>
            <p v-else-if="selectedSavedDisplay">标准模式参数由厂商固定，不能在原版界面编辑。</p>
          </section>
          <section v-if="state.page === 'performance'" class="aux-panel">
            <h2>厂商散热与配置恢复 <small>仅在 EC 未接管时开放 · 后端互斥保护</small></h2>
            <div class="aux-row effect-row">
              <label>被动散热 <el-switch :model-value="!!state.serviceData?.currentState?.passiveCooling" :disabled="!state.serviceConnected || state.serviceData?.currentState?.passiveCooling == null || state.fan.running || state.busy" @change="(value: boolean) => confirmPassiveCooling(value)" /></label>
              <span>读回：{{ state.serviceData?.currentState?.passiveCooling == null ? '未知' : state.serviceData.currentState.passiveCooling ? '已开启' : '已关闭' }}</span>
              <el-button :disabled="!state.serviceConnected || !state.serviceData?.defaultProfiles || state.fan.running || state.busy" @click="confirmPerformanceReset">恢复三档厂商默认配置</el-button>
            </div>
            <small>恢复会改写官方服务保存的三档 AC/DC CPU、dGPU、风扇字段；启用 EC 风扇前必须先关闭被动散热。此处不会改写本机 EC 曲线。</small>
          </section>
          <section v-if="state.page === 'performance'" class="aux-panel">
            <h2>WhisperMode 细调 <small>官方服务 · 独立于 EC 风扇</small></h2>
            <div class="aux-row effect-row">
              <label>噪声策略 <el-select v-model="state.whisperDraft.mode" :disabled="!state.serviceConnected || !state.serviceData?.whisper || state.busy"><el-option label="更安静" value="Quieter" /><el-option label="安静" value="Quiet" /><el-option label="平衡" value="Balanced" /></el-select></label>
              <label>目标帧率 <el-input-number v-model="state.whisperDraft.fps" :min="30" :max="240" :step="5" :disabled="!state.serviceConnected || state.busy" /></label>
              <el-button type="primary" :disabled="!state.serviceConnected || !state.serviceData?.whisper || state.busy" @click="hardware.setWhisperSettings">应用参数</el-button>
              <small>读回：{{ state.serviceData?.whisper?.type ?? '—' }} · {{ state.serviceData?.whisper?.fps ?? '—' }} FPS</small>
            </div>
          </section>
          <section v-if="state.page === 'performance'" class="aux-panel">
            <h2>原版性能配置 <small>UniwillService · 插电/电池独立保存，与 DLL 全局档位分开</small></h2>
            <div v-if="state.serviceData?.currentProfiles" class="vendor-profile-grid">
              <div v-for="profile in profileChoices" :key="profile.vendorKey" class="vendor-profile-card">
                <strong>{{ profile.label }}</strong>
                <div v-for="source in powerSources" :key="source.key" class="vendor-profile-source">
                  <span>{{ source.label }}</span>
                  <template v-if="vendorProfileDraft[vendorDraftKey(profile.vendorKey, source.readKey)]">
                    <label>CPU <el-select v-model="vendorProfileDraft[vendorDraftKey(profile.vendorKey, source.readKey)].cpu" :disabled="!vendorProfileEditable(profile.vendorKey, source.readKey)" @change="vendorProfileDirty[vendorDraftKey(profile.vendorKey, source.readKey)] = true"><el-option v-for="mode in vendorModeOptions" :key="mode.value" :label="mode.label" :value="mode.value" /></el-select></label>
                    <label>独显 <el-select v-model="vendorProfileDraft[vendorDraftKey(profile.vendorKey, source.readKey)].dgpu" :disabled="!vendorProfileEditable(profile.vendorKey, source.readKey)" @change="vendorProfileDirty[vendorDraftKey(profile.vendorKey, source.readKey)] = true"><el-option v-for="mode in vendorModeOptions" :key="mode.value" :label="mode.label" :value="mode.value" /></el-select></label>
                    <el-button size="small" type="primary" :disabled="!vendorProfileEditable(profile.vendorKey, source.readKey) || !vendorProfileDirty[vendorDraftKey(profile.vendorKey, source.readKey)]" @click="saveVendorProfile(profile, source.readKey)">保存</el-button>
                  </template>
                  <span v-else>CPU / 独显：未读到有效编号</span>
                  <small>读回 CPU {{ state.serviceData.currentProfiles?.[profile.vendorKey]?.[source.readKey]?.cpu ?? '—' }} · 独显 {{ state.serviceData.currentProfiles?.[profile.vendorKey]?.[source.readKey]?.dgpu ?? '—' }} · 厂商风扇 {{ state.serviceData.currentProfiles?.[profile.vendorKey]?.[source.readKey]?.fan ?? '—' }}（保存时保持原值）</small>
                </div>
              </div>
            </div>
            <p v-else>官方服务尚未返回三档 AC/DC 配置，无法编辑。</p>
            <p class="vendor-profile-note">EC 接管时禁止保存。当前厂商档位保存后会重新应用；其它档位保存后，切换到该档位才会生效。只有服务读回一致才显示保存成功。</p>
          </section>
          <section v-if="state.page === 'keyboard'" class="aux-panel">
            <h2>逐键上色 <small>原版美式键盘映射 · 126 个 LED 槽位</small></h2>
            <p v-if="!perKeyAvailable">仅当官方服务读回 126 个 LED 槽位且设备支持逐键控制时开放。</p>
            <div v-else class="per-key-editor">
              <div class="per-key-rows">
                <div v-for="(row, rowIndex) in keyboardUsRows" :key="rowIndex" class="per-key-row">
                  <button v-for="key in row" :key="key.id" type="button" :class="{ selected: !groupEditing && selectedLedKey === key.id, 'group-selected': groupKeyIds.includes(key.id) }" :style="{ '--key-color': rgbHex(currentLedColor(key)) }" :aria-label="`${groupEditing ? '切换键组成员' : '选择'} ${key.label} 键，LED 槽位 ${key.indices.join('、')}`" :aria-pressed="groupEditing ? groupKeyIds.includes(key.id) : selectedLedKey === key.id" :disabled="state.busy" @click="selectLedKey(key)">{{ key.label }}</button>
                </div>
              </div>
              <div class="aux-row">
                <span>当前键：{{ selectedLedKeyData?.label ?? '未选择' }}</span>
                <el-color-picker v-model="selectedLedColor" :disabled="state.busy" />
                <el-button type="primary" :disabled="!selectedLedKeyData || groupEditing || state.busy" @click="paintSelectedKey">应用到选中键</el-button>
                <small>大键的多个 LED 同步设置；切换至自定义逐键模式后可逐个修改。</small>
              </div>
              <div class="keyboard-group-editor">
                <h3>自定义键组 <small>本机保存 · 一次写入并核对所有 126 个灯位</small></h3>
                <div class="aux-row">
                  <el-select :model-value="selectedKeyboardGroup" placeholder="选择键组" aria-label="选择键盘键组" @change="selectKeyboardGroup"><el-option v-for="group in keyboardGroups" :key="group.id" :label="`${group.name}（${group.keyIds.length} 键）`" :value="group.id" /></el-select>
                  <el-button :disabled="state.busy" @click="newKeyboardGroup">新建键组</el-button>
                  <el-button :disabled="!selectedKeyboardGroup || state.busy" @click="groupEditing = !groupEditing">{{ groupEditing ? '结束选键' : '编辑成员' }}</el-button>
                  <el-button :disabled="!groupKeyIds.length || state.busy" @click="saveKeyboardGroup">保存键组</el-button>
                  <el-button :disabled="!selectedKeyboardGroup || state.busy" @click="renameKeyboardGroup">重命名</el-button>
                  <el-button :disabled="!selectedKeyboardGroup || state.busy" @click="deleteKeyboardGroup">删除键组</el-button>
                </div>
                <div class="aux-row">
                  <span>已选 {{ groupKeyIds.length }} 键 · {{ keyboardGroupSlots(groupKeyIds).length }} 个灯位</span>
                  <el-button type="primary" :disabled="!groupKeyIds.length || !state.serviceConnected || state.busy" @click="paintKeyboardGroup">按当前颜色应用到键组</el-button>
                  <small v-if="groupEditing">点击上方键盘选择或移除成员，再保存到本机。</small>
                </div>
              </div>
            </div>
          </section>
          <section v-if="state.page === 'keyboard'" class="aux-panel">
            <h2>最近使用的键盘颜色 <small>写入并读回成功后才记录在本机</small></h2>
            <div class="palette"><button v-for="(color, index) in state.recentColors.keyboard" :key="index" :style="{ background: rgbHex(color) }" :aria-label="`重新应用键盘颜色 ${rgbHex(color)}`" :disabled="!state.serviceConnected || state.busy" @click="hardware.setKeyboardColor(color)" /></div>
            <small v-if="!state.recentColors.keyboard.length">还没有成功应用过颜色。</small>
          </section>
          <section v-if="state.page === 'keyboard'" class="aux-panel">
            <h2>键盘配置文件 <small>保存在本机 · 应用时逐项写入并读回</small></h2>
            <div class="aux-row effect-row">
              <el-select v-model="selectedKeyboardProfile" placeholder="选择本机配置" aria-label="选择键盘配置文件">
                <el-option v-for="profile in keyboardProfiles" :key="profile.id" :label="profile.name" :value="profile.id" />
              </el-select>
              <el-button :disabled="!state.serviceConnected || !state.serviceData?.lighting?.keyboard || (state.serviceData?.lighting?.keyboard?.effect === 'UserMode' && !perKeyAvailable) || state.busy || keyboardProfiles.length >= 20" @click="saveKeyboardProfile">保存当前读回</el-button>
              <el-button type="primary" :disabled="!selectedKeyboardProfile || !state.serviceConnected || state.busy" @click="applySelectedKeyboardProfile">应用配置</el-button>
              <el-button :disabled="!selectedKeyboardProfile || state.busy" @click="renameKeyboardProfile">重命名</el-button>
              <el-button :disabled="!selectedKeyboardProfile || state.busy" @click="deleteKeyboardProfile">删除</el-button>
            </div>
            <small>保存灯效、方向、速度、主颜色、插电/电池亮度和定时；逐键模式还保存全部 126 个灯位颜色。写入中断可能部分生效，会报告已完成项数。</small>
          </section>
          <section v-if="state.page === 'keyboard'" class="aux-panel">
            <h2>恢复键盘默认值 <small>原版内置设置 · 会覆盖当前灯效和亮度</small></h2>
            <div class="aux-row">
              <el-button :disabled="!state.serviceConnected || !state.serviceData?.lighting?.keyboard || state.busy" @click="resetKeyboardDefaults">恢复原版内置默认</el-button>
              <small>恢复主颜色、灯效、方向、速度、插电/电池亮度和熄灯计时；不删除本机保存的配置文件。</small>
            </div>
          </section>
          <section v-if="state.page === 'keyboard'" class="aux-panel">
            <h2>动态灯效 <small>官方服务 · 写后读回</small></h2>
            <div class="aux-row effect-row">
              <label>效果 <el-select v-model="state.keyboardEffectDraft.effect" :disabled="!state.serviceConnected || !state.serviceData?.lighting?.keyboard || state.busy"><el-option v-for="effect in keyboardEffects" :key="effect.value" :label="effect.label" :value="effect.value" /></el-select></label>
              <label>方向 <el-select v-model="state.keyboardEffectDraft.direction" :disabled="!state.serviceConnected || state.busy"><el-option v-for="direction in effectDirections" :key="direction.value" :label="direction.label" :value="direction.value" /></el-select></label>
              <label>速度 <el-input-number v-model="state.keyboardEffectDraft.speed" :min="0" :max="9" :disabled="!state.serviceConnected || state.busy" /></label>
              <el-button type="primary" :disabled="!state.serviceConnected || !state.serviceData?.lighting?.keyboard || state.busy" @click="hardware.setKeyboardEffect">应用灯效</el-button>
              <small>读回：{{ state.serviceData?.lighting?.keyboard?.effect ?? '—' }} · {{ state.serviceData?.lighting?.keyboard?.direction ?? '—' }} · 速度 {{ state.serviceData?.lighting?.keyboard?.speed ?? '—' }}</small>
            </div>
            <small>逐键模式可在上方为单个实体键上色并保存整组灯位；游戏键位目前只切换厂商效果，原版默认配色与键组仍待补齐。</small>
          </section>
          <section v-if="state.page === 'keyboard'" class="aux-panel">
            <h2>插电 / 电池独立设置 <small>官方服务 · 写后读回</small></h2>
            <div v-for="source in powerSources" :key="source.key" class="aux-row">
              <strong>{{ source.label }}</strong>
              <label>亮度 <el-slider v-model="state.vendorAuxDraft.keyboardBrightness[source.key]" :min="0" :max="100" :disabled="state.serviceData?.keyboardBrightness?.[source.readKey] == null || state.busy" /><output>{{ state.vendorAuxDraft.keyboardBrightness[source.key] }}%</output></label>
              <el-button size="small" :disabled="state.serviceData?.keyboardBrightness?.[source.readKey] == null || state.busy" @click="hardware.setVendorAux('keyboardBrightness', source.key)">应用亮度</el-button>
              <label>闲置熄灯档位 <el-input-number v-model="state.vendorAuxDraft.keyboardIdleTimer[source.key]" :min="0" :max="13" size="small" :disabled="state.serviceData?.keyboardIdleTimer?.[source.readKey] == null || state.busy" /></label>
              <el-button size="small" :disabled="state.serviceData?.keyboardIdleTimer?.[source.readKey] == null || state.busy" @click="hardware.setVendorAux('keyboardIdleTimer', source.key)">应用定时</el-button>
              <small>已读回：亮度 {{ state.serviceData?.keyboardBrightness?.[source.readKey] ?? '—' }}% · 定时档位 {{ state.serviceData?.keyboardIdleTimer?.[source.readKey] ?? '—' }}</small>
            </div>
          </section>
          <section v-if="state.page === 'lightbar'" class="aux-panel">
            <h2>光条总开关 <small>官方服务 · 同时控制插电与电池配置</small></h2>
            <div class="aux-row">
              <label>光条点亮 <el-switch :model-value="lightbarTotalOn" :disabled="!lightbarSupported || !lightbarProfile() || state.busy" @change="(value: boolean) => setLightbarGlobal(value)" /></label>
              <small>关闭时两侧写入黑色；重新开启时恢复本次运行中记住的颜色、效果和原先启用的供电侧。若没有可恢复记录，默认开启插电白光。</small>
            </div>
          </section>
          <section v-if="state.page === 'lightbar'" class="aux-panel">
            <h2>最近使用的光条颜色 <small>写入并读回成功后才记录在本机</small></h2>
            <div class="palette"><button v-for="(color, index) in state.recentColors.lightbar" :key="index" :style="{ background: rgbHex(color, 100) }" :aria-label="`重新应用光条颜色 ${rgbHex(color, 100)}`" :disabled="!lightbarSupported || state.busy" @click="hardware.setLightbar(lightbarSource, color, !!lightbar?.breathing)" /></div>
            <small v-if="!state.recentColors.lightbar.length">还没有成功应用过颜色。</small>
          </section>
          <section v-if="state.page === 'lightbar'" class="aux-panel">
            <h2>恢复当前供电侧颜色 <small>原版内置默认值：插电白色；电池关闭</small></h2>
            <div class="aux-row">
              <el-button :disabled="!lightbarSupported || state.busy" @click="resetLightbarSource">恢复{{ lightbarSource === 'ac' ? '插电' : '电池' }}颜色</el-button>
              <small>只恢复颜色和单色效果，不改另一供电侧、呼吸开关或闲置计时。</small>
            </div>
          </section>
          <section v-if="state.page === 'lightbar'" class="aux-panel">
            <h2>光条效果 <small>仅修改当前供电侧</small></h2>
            <div class="aux-row effect-row">
              <strong>{{ lightbarSource === 'ac' ? '外接电源' : '电池' }}</strong>
              <el-radio-group :model-value="lightbarSetting?.effect ?? ''" :disabled="!lightbarSupported || state.busy" @change="(value: string | number | boolean) => hardware.setLightbarEffect(lightbarSource, String(value) as 'Monocolor' | 'Rainbow')">
                <el-radio-button value="Monocolor">单色</el-radio-button><el-radio-button value="Rainbow">彩虹</el-radio-button>
              </el-radio-group>
              <small>硬件读回：{{ lightbarSetting?.effect ?? '—' }}。呼吸效果为另一个独立设置。</small>
            </div>
          </section>
          <section v-if="state.page === 'lightbar'" class="aux-panel">
            <h2>闲置熄灯计时 <small>官方服务 · 秒；0 为关闭</small></h2>
            <div v-for="source in powerSources" :key="source.key" class="aux-row">
              <strong>{{ source.label }}</strong>
              <el-input-number v-model="state.vendorAuxDraft.lightbarIdleTimer[source.key]" :min="0" :max="3600" :step="30" size="small" :disabled="state.serviceData?.lightbarIdleTimer?.[source.readKey] == null || state.busy" />
              <el-button size="small" :disabled="state.serviceData?.lightbarIdleTimer?.[source.readKey] == null || state.busy" @click="hardware.setVendorAux('lightbarIdleTimer', source.key)">应用定时</el-button>
              <small>硬件已读回 {{ state.serviceData?.lightbarIdleTimer?.[source.readKey] ?? '—' }} 秒</small>
            </div>
          </section>
        </section>
      </div>
    </main>
    <el-dialog v-model="aboutOpen" title="关于 NUCtool" width="360px" append-to-body><p>NUCtool 软件工作室 · Vue 3 / Element Plus</p><p>参考 Intel NUC Software Studio 的功能与布局。本项目并非 Intel 官方软件。</p></el-dialog>
    <div v-if="state.notice" class="studio-toast" role="status"><span>{{ state.notice }}</span><button aria-label="关闭提示" @click="state.notice = ''">×</button></div>
  </div>
</template>
