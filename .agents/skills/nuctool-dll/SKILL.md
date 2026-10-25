---
name: nuctool-dll
description: Use when examining, integrating, documenting, or troubleshooting this repository's bundled NUCtool.dll. Identifies verified exports, current wrapper behavior, readback limits, and the control boundary between NUCtool.dll, EC, Windows, and the legacy Uniwill SDK.
---

# NUCtool.dll integration guide

Use this skill before changing a vendor-control feature or explaining which subsystem owns it. The checked-in binary, local Rust wrapper, and explicit product decisions are the evidence; exported names alone are not proof of device support or safe behavior.

## Sources of truth

- Bundled binary: `src-tauri/resources/NucSoftwareStudio/NUCtool.dll`.
- Current wrapper and DLL hash check: `src-tauri/src/plug/vendor.rs`.
- The bundled binary inspected for this guide is an x64 .NET/WCF assembly. The wrapper pins SHA-256 `8F7B8338EAF242372FBF096CC9364CA0F60145281ACA17E4E97955945A920875`.
- The author repository's `0.5.0-AI` source tree does not include this DLL's implementation. Treat signatures and behavior as verified only where the local wrapper declares and calls them.
- See [`references/api-map.md`](references/api-map.md) for all 40 exported names and which ones the app currently calls.

If the DLL is replaced, re-check the hash, architecture, export list, and all wrapper signatures before shipping. Never copy assumptions from a different DLL build.

## Control ownership rules

| Concern | Owner in this project | Rule |
|---|---|---|
| Fan speed, curves, EC manual-control enable | EC/WMI path | Keep fan control on EC. Do not call NUCtool fan-curve exports, even though they exist. |
| CPU/GPU PL1, PL2 and TCC | EC/WMI path (`set_tdp`) | Do not describe an author performance profile as a confirmed watt limit. Readback of the configured limits is separate from actual power consumption. |
| Author performance profile | `NUCtool.dll` | Expose the DLL's direct choices: powersave index 3, balanced index 2, performance index 1. Changing a profile must not change EC fan settings. The current profile-only wrapper clears the benchmark flag before applying the profile, but does not change the vendor power-plan index; make this side effect visible and do not imply the plan was restored. Hardware readback is available through `wcf_get_current_profile_index`. |
| Author benchmark flag / author power-plan index | `NUCtool.dll` | Benchmark is a separate DLL-only switch; the current benchmark preset also requests vendor plan index 4. It must not change EC fan settings. Current wrapper has no readback for benchmark state or plan. |
| Windows power scheme and processor settings | Windows `powercfg` | Never label this as the NUCtool DLL plan. The legacy combined system profile also invokes other components; inspect before reuse. |
| Vendor visual display mode | DLL bridge when available; legacy Uniwill SDK fallback exists | Standard=0, Gaming=1, Video=2, Reading=3. DLL path does not provide reliable mode readback; report “request sent,” not “verified.” |
| Display refresh rate | Windows display API | A refresh-rate scene is not the same thing as a vendor visual/color profile. |
| Keyboard backlight enable/basic brightness | `NUCtool.dll` | Switch state can be read. Brightness has no verified readback export in the current wrapper. Full RGB color is not exposed by the basic DLL path. |
| Battery charge threshold | `NUCtool.dll` | Wrapper clamps writes to 50–100 and can read the current threshold. |
| System key switches, keyboard fixed color, lightbar single color/breathing, WhisperMode, BestBattery | Official Uniwill SDK / PowerShell path | These controls have explicit official-service labels in the Studio UI. Key, color, lightbar, Whisper and BestBattery writes use service readback; OSD has request-only status. DLL-owned profile, benchmark, threshold and basic keyboard controls stay on the DLL. |

The fan-owner decision is explicit product direction: **EC owns fan control only**. Device performance modes (powersave/balanced/performance) and benchmark mode are separate DLL controls and must not implicitly change EC fan settings. The fact that the DLL exports fan functions does not change that boundary.

## Calling and reporting requirements

1. Use the existing guarded Rust bridge (`with_author_bridge`) and its global vendor-command lock. Keep DLL calls out of React/UI code.
2. Preserve the bundled-DLL integrity check. Do not load an arbitrary DLL from a user-controlled path.
3. Use `wcf_connect` → operation(s) → `wcf_disconnect`, and inspect individual return codes. The current wrapper records codes but some apply results set `status.ok = true` merely because the call was dispatched; do not treat that flag alone as hardware confirmation.
4. Read back whenever an export exists. If readback is missing, distinguish **request sent** from **hardware confirmed** in the UI and logs.
5. Treat negative integer readbacks as unavailable. Do not infer support for a particular feature from `wcf_get_supported_features_count` alone; it returns a count, not a feature bitmap.
6. Keep vendor-profile indices, vendor power-plan indices, Windows power-scheme aliases, and EC TDP values as separate types/concepts. Never reuse one field or label for another.
7. A scene that writes to both EC and DLL is a two-controller operation. Return partial failure distinctly and do not optimistically show both sides as applied when one side failed.
8. Test against the actual supported NUC model and read back the state after every write. Static export presence does not establish model compatibility.

## Known limits and caution points

- Current DLL wrapper reads charge level, keyboard on/off, current profile, supported-feature count, and optionally lightbar state/Aurora installation. It does not read back keyboard brightness, benchmark state, author power plan, or reliably read back visual display mode.
- The current lightbar capability value is a heuristic (`feature_count > 0` plus a lightbar-power export), not proof that every optional feature exists on this hardware.
- The exported symbol names for functions not called by the wrapper are cataloged by name only. Their calling convention, parameter types, return-code meanings, device support, and safe order are unverified.
- Do not disable passive cooling or manipulate DLL fan curves as a shortcut. Do not call Aurora, OSD, lightbar, GPU target-temperature, monitoring, or other unused **NUCtool.dll exports** without source/ABI review and hardware testing. Studio OSD and lightbar now use the separately inspected Uniwill SDK service methods.
- The Uniwill WCF `GetCurrentDisplayMode` call returns void on this SDK and disrupts later lighting reads on this device. Keep it out of the shared status read; active display mode still has request-only status. `GetSavedDisplayModes` does work on a healthy session, so the Custom profile can be edited with `UpdateDisplayMode` and its saved parameters read back after reconnecting.
- After a Uniwill SDK write, reopen its WCF client before reading state. Reusing the write session caused readback failures on this device.
- The existing Windows “system power profile” command is broader than a DLL profile: it writes `powercfg` settings and can invoke Uniwill profile, display-refresh, and NVIDIA clock operations. It is not a safe synonym for a NUCtool preset.

## Workflow for future feature work

1. Name the user outcome and the physical setting that should change.
2. Assign exactly one owner (EC, NUCtool.dll, Windows, or legacy SDK) for each write.
3. Find the existing wrapper and determine whether a readback exists.
4. Record the exact symbol, wrapper type/signature, index/range mapping, result-code handling, and rollback/failure behavior.
5. Add the UI only after capability and state semantics are defined.
6. Verify a real device: before state → write → per-call result → readback → partial-failure behavior.
7. Update this API map and the product requirements when ownership or confirmed behavior changes.
