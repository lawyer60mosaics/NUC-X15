import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const html = read('index.html');
const entry = read('src/vue/main.ts');
const studio = read('src/vue/StudioApp.vue');
const hardware = read('src/vue/useHardware.ts');
const css = read('src/vue/studio.css');

test('Vue 3 + Element Plus are the only production entry and component framework', () => {
  assert.match(html, /src\/vue\/main\.ts/);
  assert.doesNotMatch(html, /src\/main\.tsx/);
  assert.match(entry, /createApp\(StudioApp\)\.use\(ElementPlus\)/);
  assert.match(entry, /element-plus\/dist\/index\.css/);
  assert.match(read('vite.config.ts'), /@vitejs\/plugin-vue/);
  assert.doesNotMatch(entry, /React|react-dom/);
});

test('home has five official-style cards and separate EC/monitor launchers', () => {
  for (const label of ['系统配置', '性能调优', '显示设置', '键盘', '光条', 'EC 风扇控制', '系统监视器']) {
    assert.ok(studio.includes(label), `${label} missing`);
  }
  assert.match(studio, /dashboard-top/);
  assert.match(studio, /dashboard-bottom/);
  assert.match(studio, /module-row/);
});

test('hardware ownership and unverifiable states remain explicit in the Vue controls', () => {
  assert.match(studio, /NUCtool\.dll 性能档位/);
  assert.match(studio, /EC 风扇策略/);
  assert.match(studio, /下方厂商 AC\/DC 配置独立保存/);
  assert.match(studio, /当前生效模式无回读/);
  assert.match(studio, /— 表示当前没有可靠读数/);
  assert.match(hardware, /apply_author_power_profile/);
  assert.match(hardware, /apply_vendor_display_mode/);
  assert.match(hardware, /apply_vendor_lightbar/);
  assert.match(hardware, /apply_vendor_custom_display/);
  assert.match(hardware, /update_fan_policy/);
  assert.doesNotMatch(hardware, /set_tdp|lock_tdp|apply_system_power_profile/);
});

test('dashboard stretches on tall windows and scrolls on narrow windows', () => {
  assert.match(css, /\.studio-shell\{display:flex;flex-direction:column;height:100dvh/);
  assert.match(css, /\.studio-main\{flex:1;min-height:0;overflow:auto/);
  assert.match(css, /\.dashboard-top\{grid-template-columns:1fr 1fr;flex:1\.1/);
  assert.match(css, /@media \(max-width:1100px\)/);
  assert.match(css, /@media \(max-width:720px\)/);
});

test('window controls and Tauri access stay available', () => {
  assert.match(studio, /getCurrentWindow\(\)\[action\]\(\)/);
  assert.match(read('src-tauri/tauri.windows.conf.json'), /"decorations": false/);
  assert.match(read('src-tauri/capabilities/migrated.json'), /core:window:allow-start-dragging/);
  assert.match(read('src/vue/bridge.ts'), /if \(isTauri\(\)\) return invoke/);
});

test('monitor shows real Windows and NVIDIA fields without invented iGPU telemetry', () => {
  const monitor = read('src-tauri/src/plug/studio_monitor.rs');
  assert.match(monitor, /Get-CimInstance Win32_Processor/);
  assert.match(monitor, /Get-CimInstance Win32_PhysicalMemory/);
  assert.match(monitor, /Get-CimInstance Win32_BIOS/);
  assert.match(monitor, /nvidia-smi\.exe/);
  assert.match(studio, /state\.monitor\?\.cpu\?\.usage/);
  assert.match(studio, /state\.monitor\?\.dgpu\?\.memoryTotalMb/);
  assert.match(studio, /此设备暂无可靠的 iGPU 动态读数/);
  assert.match(hardware, /get_studio_monitor_snapshot/);
});

test('effect controls are readback-gated and never route fan writes through the DLL', () => {
  const vendor = read('src-tauri/src/plug/vendor.rs');
  assert.match(vendor, /apply_vendor_keyboard_effect_blocking/);
  assert.match(vendor, /apply_vendor_lightbar_effect_blocking/);
  assert.match(vendor, /current\.and_then\(\|v\| v\.get\("effect"\)\)/);
  assert.match(studio, /动态灯效/);
  assert.match(studio, /硬件读回：/);
  assert.match(hardware, /if \(!result\?\.verified\) throw/);
  assert.doesNotMatch(hardware, /set_fan_speed|set_dll_fan/);
});

test('official-service failures are actionable and vendor AC/DC writes preserve the fan boundary', () => {
  const vendor = read('src-tauri/src/plug/vendor.rs');
  assert.match(vendor, /UniwillService is running but its control endpoint is not responding/);
  assert.match(studio, /重新检测服务/);
  assert.match(studio, /state\.serviceData\.currentProfiles/);
  assert.match(studio, /EC 接管时禁止保存/);
  assert.match(studio, /saveVendorProfile/);
  assert.match(hardware, /update_vendor_performance_profile/);
  assert.match(vendor, /with_vendor_fan_operation\(\|\|/);
  assert.match(vendor, /\$client\.UpdateProfile\(\$targetIndex, \$profile\.AC, \$profile\.DC\)/);
  assert.match(vendor, /after\[source\]\["fan"\] == before\[source\]\["fan"\]/);
});

test('vendor profiles are matched by embedded index, not compact array position', () => {
  const vendor = read('src-tauri/src/plug/vendor.rs');
  assert.match(vendor, /Where-Object \{ \$_\.Index -eq \$index \}/);
  assert.doesNotMatch(vendor, /\$profile = \$profiles\[\$index\]/);
  assert.match(vendor, /RecoverDisplayMode\(\[int\]\$matches\[0\]\.Index\)/);
  assert.match(read('src-tauri/src/main.rs'), /reset_vendor_display_mode/);
  assert.match(studio, /恢复当前选中模式/);
  assert.match(studio, /键盘配置文件/);
  assert.match(studio, /恢复.*颜色/);
  assert.match(studio, /id: 'original-defaults'.*effect: 'Monocolor'.*direction: 'Right'.*speed: 5/);
  assert.match(studio, /brightnessAc: 100, brightnessDc: 50, idleAc: 0, idleDc: 4/);
});
