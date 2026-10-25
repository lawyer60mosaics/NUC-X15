import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const main = read('src-tauri/src/main.rs');
const handler = main.match(/\.invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]\)/)?.[1];

test('Tauri exposes EC fan, DLL profile and scoped official service commands', () => {
  assert.ok(handler, 'Tauri command registry must be present');
  for (const name of [
    'update_fan_policy',
    'get_fan_control_snapshot',
    'get_tdp',
    'apply_author_power_profile',
    'apply_author_benchmark_mode',
    'apply_author_power_plan',
    'get_author_bridge_status',
    'get_vendor_service_status',
    'apply_vendor_key',
    'apply_vendor_battery',
    'apply_vendor_osd',
    'apply_vendor_keyboard_color',
    'apply_vendor_lightbar',
    'apply_vendor_whisper',
    'apply_vendor_custom_display',
  ]) {
    assert.match(handler, new RegExp(`\\b${name}\\b`));
  }
  for (const name of [
    'apply_system_power_profile',
    'set_tdp',
    'lock_tdp',
    'set_cpu_tdp',
    'lock_cpu_tdp',
    'apply_display_scene_profile',
    'apply_vendor_lighting',
  ]) {
    assert.doesNotMatch(handler, new RegExp(`\\b${name}\\b`));
  }
});

test('front-end ownership is separated and visual mode has no SDK fallback', () => {
  const power = read('src/hooks/usePower.ts');
  const fan = read('src/hooks/useFanControl.ts');
  const vendor = read('src/hooks/useVendorService.ts');
  const backendVendor = read('src-tauri/src/plug/vendor.rs');
  const display = read('src/components/DisplaySection.tsx');
  const visualDispatcher = backendVendor.match(/fn apply_vendor_display_mode_blocking\([\s\S]*?\n}\n/)?.[0];

  assert.doesNotMatch(power, /apply_system_power_profile|set_tdp|lock_tdp|apply_author_power_profile/);
  assert.doesNotMatch(fan, /apply_author_power_profile|apply_author_benchmark_mode|apply_author_power_plan/);
  assert.doesNotMatch(vendor, /invokeBackend\(['"](?:set_tdp|lock_tdp|apply_system_power_profile|update_fan_policy)['"]/);
  assert.ok(visualDispatcher, 'Visual-mode dispatcher must be present');
  assert.match(visualDispatcher, /apply_author_display_mode_bridge/);
  assert.doesNotMatch(visualDispatcher, /apply_vendor_display_mode_via_sdk_blocking/);
  assert.match(display, /const displayModeAvailable = displayBridgeAvailable;/);
});

test('DLL file status and service API status are queried independently', () => {
  const vendor = read('src/hooks/useVendorService.ts');
  assert.match(vendor, /Promise\.allSettled\(\[\s*invokeBackend\('get_vendor_service_status'\),\s*invokeBackend\('get_author_bridge_status'\)/);
  assert.match(vendor, /displayBridgeAvailable:\s*Boolean\(bridgeStatus\?\.available\)/);
});

test('official service status keeps lighting reads on a healthy WCF session', () => {
  const backend = read('src-tauri/src/plug/vendor.rs');
  const statusScript = backend.match(/fn vendor_status_script\(\) -> &'static str \{\s*r#"([\s\S]*?)"#/)?.[1];
  assert.ok(statusScript, 'official service status script must be present');
  assert.doesNotMatch(statusScript, /\$client\.GetCurrentDisplayMode\(\)/);
  assert.match(statusScript, /\$client\.GetCurrentKeyStates\(\)/);
  assert.match(statusScript, /\$client\.GetSavedDisplayModes\(\)/);
  assert.match(statusScript, /\$client\.GetCurrentKeyboardLedProfile\(\)/);
  const mutation = backend.match(/fn vendor_mutation_script\([\s\S]*?\n}\n/)?.[0];
  assert.ok(mutation, 'official service mutation script builder must be present');
  assert.match(mutation, /\$client\.Abort\(\)/);
  assert.match(mutation, /UniwillServiceClient\]::new/);
});

test('custom display is saved through the official service and checked against readback', () => {
  const backend = read('src-tauri/src/plug/vendor.rs');
  const custom = backend.match(/fn apply_vendor_custom_display_blocking\([\s\S]*?\n}\n/)?.[0];
  assert.ok(custom);
  assert.match(custom, /\$client\.UpdateDisplayMode\(\$custom\)/);
  assert.match(custom, /\$client\.SetDisplayMode\(\[int\]\$custom\.Index\)/);
  assert.match(custom, /saved_profile_verified/);
  assert.match(custom, /active mode has no readback/);
});

test('AC/DC fan policy remains in the EC actor and never calls a vendor fan setter', () => {
  const vue = read('src/vue/useHardware.ts');
  const fan = read('src-tauri/src/plug/fan.rs');
  const studio = read('src/vue/StudioApp.vue');
  assert.match(vue, /power_curves:\s*state\.fan\.powerAuto/);
  assert.match(vue, /ac_left: points\(scenarios\[state\.fan\.acScene\]\.cpu\)/);
  assert.match(vue, /dc_right: points\(scenarios\[state\.fan\.dcScene\]\.gpu\)/);
  assert.match(fan, /let source = ec_power_source\(\)/);
  assert.match(fan, /curves_for_power_source\(fan_data, source\)/);
  assert.match(studio, /按电源来源切换 EC 风扇曲线/);
  assert.doesNotMatch(vue, /apply_vendor_fan|set_vendor_fan/);
});

test('passive cooling and vendor defaults are guarded against concurrent EC ownership', () => {
  const fan = read('src-tauri/src/plug/fan.rs');
  const vendor = read('src-tauri/src/plug/vendor.rs');
  const studio = read('src/vue/StudioApp.vue');
  assert.match(fan, /with_vendor_fan_operation/);
  assert.match(fan, /EC_CONTROL_ACTIVE\.load\(Ordering::SeqCst\), has_saved_runtime\(\), read_snapshot\(\)\.running/);
  assert.match(fan, /VENDOR_FAN_INTERLOCK\.lock\(\)/);
  assert.match(fan, /VENDOR_PASSIVE_ACTIVE\.load\(Ordering::SeqCst\)/);
  assert.match(vendor, /fn apply_vendor_passive_cooling_blocking[\s\S]*?with_vendor_fan_operation/);
  assert.match(vendor, /fn restore_vendor_performance_defaults_blocking[\s\S]*?with_vendor_fan_operation/);
  assert.match(vendor, /\$client\.UpdateProfile\(\$index, \$profile\.AC, \$profile\.DC\)/);
  assert.match(studio, /恢复三档厂商默认配置/);
});
