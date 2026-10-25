# NUCtool.dll API map (local bundled build)

This inventory was extracted from the bundled DLL's PE export table and compared with `src-tauri/src/plug/vendor.rs`. The local DLL exports 40 `wcf_*` symbols; the Rust wrapper currently references 16. “Unused” means not dynamically called by the current Rust wrapper, not necessarily unsupported by the device.

## Called by the current wrapper

The wrapper declares the signatures listed below. Unless noted, the app connects, makes the call, disconnects, and currently returns integer call codes as diagnostic data.

| Export | Current use / verified wrapper mapping | Readback / caveat |
|---|---|---|
| `wcf_connect` | Opens the author WCF session; returns `i32` | Its return code is recorded, but apply paths do not consistently reject a non-success code before continuing. |
| `wcf_disconnect` | Closes the session; no arguments | Always pair with a connected operation path. |
| `wcf_apply_profile` | Applies profile index: 1 performance, 2 balanced, 3 powersave | The profile-only wrapper first requests `wcf_apply_benchmark_mode(0)`, then applies the profile and immediately reads the current profile index. It does not change the vendor plan. Only a matching readback is reported as verified. The mapping still needs real-device verification. |
| `wcf_apply_benchmark_mode` | Applies `0`/`1` benchmark flag | No dedicated benchmark-state readback. Enabling also requests vendor plan 4. Disabling clears only the benchmark flag and intentionally leaves the vendor plan unchanged (user-confirmed). |
| `wcf_set_power_plan` | Applies vendor plan index: 0 off, 1 performance, 2 balanced, 3 powersave, 4 benchmark | This is a DLL/vendor index. No readback; do not equate it to a Windows `powercfg` scheme. |
| `wcf_get_current_profile_index` | Reads current profile (`i32`) | Negative values are treated as unavailable. |
| `wcf_get_battery_charging_level` | Reads charge threshold (`i32`) | Negative values are treated as unavailable. |
| `wcf_set_battery_charging_level` | Writes integer threshold; project clamps to 50–100 | The wrapper can read back the resulting threshold. |
| `wcf_enable_keyboard_leds` | Writes `0`/`1` enable state | `wcf_get_keyboard_leds_power` reads switch state. |
| `wcf_get_keyboard_leds_power` | Reads keyboard LED power (`i32`) | Mapped to enabled when value > 0. |
| `wcf_set_keyboard_brightness` | Writes brightness 0–100; current wrapper passes a second argument of `1` | No verified brightness readback. |
| `wcf_enable_display_mode_mgmt` | Enables display-mode management with `1` | Return code is currently diagnostic data. |
| `wcf_set_display_mode` | Writes fixed visual-mode index: Standard=0, Gaming=1, Video=2, Reading=3 | DLL bridge cannot reliably read back the selected visual mode. Current result is dispatch-only. |
| `wcf_get_supported_features_count` | Reads an integer feature count | Count is not a per-feature capability map. |
| `wcf_get_lightbar_indicators_power` | Optional read of lightbar-indicator power | Export is optional; current support calculation is heuristic only. |
| `wcf_get_project_aurora_installed` | Optional read of Aurora-installed state | Export is optional; this does not mean the app has enabled or verified Aurora. |

## Exported but not called by the current wrapper

The binary exports these 24 additional names. Classifications below are inferred from names; no ABI or behavioral contract should be assumed until the signature/source and a safe hardware test are established.

| Export | Name-based area | Current disposition |
|---|---|---|
| `wcf_disable_passive_cooling` | Cooling policy | Unused; do not call without safety review. |
| `wcf_enable_display` | Display enable | Unused; semantics unknown. |
| `wcf_enable_lightbar_indicators` | Lightbar | Unused. |
| `wcf_enable_osd` | On-screen display | Unused. |
| `wcf_enable_project_aurora` | Aurora | Unused. |
| `wcf_get_battery_mode` | Battery mode | Unused. |
| `wcf_get_default_charge_rate` | Battery charge rate | Unused. |
| `wcf_get_default_profiles_count` | Profile enumeration | Unused; profile names/order are not established by this export name. |
| `wcf_get_fan_curve_count` | Fan curves | Unused by explicit product decision; EC owns fan control. |
| `wcf_get_fan_curve_entry` | Fan curves | Unused by explicit product decision; EC owns fan control. |
| `wcf_get_gaming_power_saver` | Gaming power policy | Unused. |
| `wcf_get_project_aurora_state` | Aurora | Unused. |
| `wcf_is_connected` | Connection state | Unused. |
| `wcf_restore_fan_curve` | Fan curves | Unused by explicit product decision; EC owns fan control. |
| `wcf_set_battery_mode` | Battery mode | Unused. |
| `wcf_set_default_charge_rate` | Battery charge rate | Unused. |
| `wcf_set_dgpu_target_temp` | dGPU thermal target | Unused; do not assume this is equivalent to EC TCC or safe for every device. |
| `wcf_set_fan_table` | Fan curves | Unused by explicit product decision; EC owns fan control. |
| `wcf_set_gaming_power_saver` | Gaming power policy | Unused. |
| `wcf_set_idle_timer` | Idle timer | Unused. |
| `wcf_set_lightbar_brightness` | Lightbar | Unused. |
| `wcf_set_lightbar_idle_timer` | Lightbar | Unused. |
| `wcf_stop_monitoring` | Monitoring | Unused. |
| `wcf_sys_monitor_subscribe` | Monitoring | Unused. |

## Names-only export catalog

For comparison with a future DLL build, the exact exported-name set in this local binary is:

```text
wcf_apply_benchmark_mode
wcf_apply_profile
wcf_connect
wcf_disable_passive_cooling
wcf_disconnect
wcf_enable_display
wcf_enable_display_mode_mgmt
wcf_enable_keyboard_leds
wcf_enable_lightbar_indicators
wcf_enable_osd
wcf_enable_project_aurora
wcf_get_battery_charging_level
wcf_get_battery_mode
wcf_get_current_profile_index
wcf_get_default_charge_rate
wcf_get_default_profiles_count
wcf_get_fan_curve_count
wcf_get_fan_curve_entry
wcf_get_gaming_power_saver
wcf_get_keyboard_leds_power
wcf_get_lightbar_indicators_power
wcf_get_project_aurora_installed
wcf_get_project_aurora_state
wcf_get_supported_features_count
wcf_is_connected
wcf_restore_fan_curve
wcf_set_battery_charging_level
wcf_set_battery_mode
wcf_set_default_charge_rate
wcf_set_dgpu_target_temp
wcf_set_display_mode
wcf_set_fan_table
wcf_set_gaming_power_saver
wcf_set_idle_timer
wcf_set_keyboard_brightness
wcf_set_lightbar_brightness
wcf_set_lightbar_idle_timer
wcf_set_power_plan
wcf_stop_monitoring
wcf_sys_monitor_subscribe
```
