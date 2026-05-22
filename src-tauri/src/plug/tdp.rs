/**
* @Author: cyear
* @Create time: 2025-02-28
* @Description:
* @Version: 1
**/
use crate::plug::{
    diagnostics::app_log,
    fan, keyboard_rgb,
    struct_set::{RGB, TDP},
    vendor,
};
use serde::Serialize;
#[cfg(windows)]
use std::{
    os::windows::process::CommandExt,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, Instant},
};
#[cfg(windows)]
use tauri::{AppHandle, Manager};
#[cfg(windows)]
use windows::{
    core::PCWSTR,
    Win32::Graphics::Gdi::{
        ChangeDisplaySettingsExW, EnumDisplayDevicesW, EnumDisplaySettingsW, CDS_UPDATEREGISTRY,
        DEVMODEW, DISPLAY_DEVICEW, DISPLAY_DEVICE_ACTIVE, DISP_CHANGE_SUCCESSFUL, DM_BITSPERPEL,
        DM_DISPLAYFREQUENCY, DM_PELSHEIGHT, DM_PELSWIDTH, ENUM_CURRENT_SETTINGS,
        ENUM_DISPLAY_SETTINGS_MODE,
    },
};

#[derive(Debug, Serialize)]
pub struct SystemPowerAction {
    pub name: String,
    pub ok: bool,
    pub detail: String,
}

#[derive(Debug, Serialize)]
pub struct SystemPowerApplyResult {
    pub mode: String,
    pub actions: Vec<SystemPowerAction>,
}

#[derive(Debug, Serialize)]
pub struct DisplayRefreshStatus {
    pub current_hz: u32,
    pub supported_hz: Vec<u32>,
    pub device_count: usize,
    pub detail: String,
    pub devices: Vec<String>,
}

#[cfg(windows)]
#[derive(Clone, Copy)]
struct SystemPowerProfile {
    scheme_alias: &'static str,
    ac_processor_max: u8,
    dc_processor_max: u8,
    ac_boost_mode: u8,
    dc_boost_mode: u8,
    ac_energy_preference: u8,
    dc_energy_preference: u8,
    refresh_candidates: &'static [u32],
    use_highest_refresh: bool,
    gpu_clock_max_mhz: Option<i64>,
    reset_gpu_clock: bool,
}

const NO_REFRESH_CANDIDATES: &[u32] = &[];
// Windows 11's battery power-mode flyout is stable on the Balanced plan.
// Profile differences are applied through EPP, Boost, CPU caps, and TDP.
// Display refresh changes are intentionally not automatic because switching
// panel modes can blank the screen and look like the app froze.
const WINDOWS_POWER_MODE_SCHEME: &str = "SCHEME_BALANCED";
// The vendor WCF service can take a few seconds to spin up the duplex channel.
const UNIWILL_PROFILE_TIMEOUT: Duration = Duration::from_secs(8);
const SYSTEM_PROFILE_TDP_LOCK_PAUSE_MS: u64 = 12_000;
const ACTION_DETAIL_LIMIT: usize = 240;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(windows)]
const DISPLAY_STATUS_TIMEOUT: Duration = Duration::from_secs(5);
#[cfg(windows)]
const DISPLAY_SET_TIMEOUT: Duration = Duration::from_secs(8);
#[cfg(windows)]
const DISPLAY_RECOVERY_RELOAD_DELAY: Duration = Duration::from_millis(1500);

#[cfg(windows)]
static DISPLAY_COMMAND_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

#[cfg(windows)]
struct DisplayCommandGuard;

#[cfg(windows)]
impl Drop for DisplayCommandGuard {
    fn drop(&mut self) {
        DISPLAY_COMMAND_IN_FLIGHT.store(false, Ordering::SeqCst);
    }
}

#[cfg(windows)]
fn system_power_profile(mode: &str) -> Option<SystemPowerProfile> {
    match mode {
        "powersave" => Some(SystemPowerProfile {
            scheme_alias: WINDOWS_POWER_MODE_SCHEME,
            ac_processor_max: 70,
            dc_processor_max: 60,
            ac_boost_mode: 0,
            dc_boost_mode: 0,
            ac_energy_preference: 80,
            dc_energy_preference: 100,
            refresh_candidates: NO_REFRESH_CANDIDATES,
            use_highest_refresh: false,
            gpu_clock_max_mhz: None,
            reset_gpu_clock: false,
        }),
        "balanced" => Some(SystemPowerProfile {
            scheme_alias: WINDOWS_POWER_MODE_SCHEME,
            ac_processor_max: 100,
            dc_processor_max: 80,
            ac_boost_mode: 4,
            dc_boost_mode: 4,
            ac_energy_preference: 33,
            dc_energy_preference: 50,
            refresh_candidates: NO_REFRESH_CANDIDATES,
            use_highest_refresh: false,
            gpu_clock_max_mhz: None,
            reset_gpu_clock: false,
        }),
        "performance" => Some(SystemPowerProfile {
            scheme_alias: WINDOWS_POWER_MODE_SCHEME,
            ac_processor_max: 100,
            dc_processor_max: 100,
            ac_boost_mode: 2,
            dc_boost_mode: 2,
            ac_energy_preference: 0,
            dc_energy_preference: 0,
            refresh_candidates: NO_REFRESH_CANDIDATES,
            use_highest_refresh: false,
            gpu_clock_max_mhz: None,
            reset_gpu_clock: false,
        }),
        _ => None,
    }
}

#[cfg(windows)]
fn push_action(actions: &mut Vec<SystemPowerAction>, name: &str, result: Result<String, String>) {
    actions.push(action_result(name, result));
}

#[cfg(windows)]
fn short_detail(detail: &str, limit: usize) -> String {
    let mut normalized = detail.replace('\r', "\\r").replace('\n', "\\n");
    let char_count = normalized.chars().count();
    if char_count > limit {
        normalized = normalized.chars().take(limit).collect();
        normalized.push_str("...");
    }
    normalized
}

#[cfg(windows)]
fn args_summary(args: &[&str]) -> String {
    let summarized: Vec<String> = args.iter().map(|arg| short_detail(arg, 80)).collect();
    format!("{:?}", summarized)
}

#[cfg(windows)]
fn action_result(name: &str, result: Result<String, String>) -> SystemPowerAction {
    match result {
        Ok(detail) => SystemPowerAction {
            name: name.to_string(),
            ok: true,
            detail: short_detail(&detail, ACTION_DETAIL_LIMIT),
        },
        Err(detail) => SystemPowerAction {
            name: name.to_string(),
            ok: false,
            detail: short_detail(&detail, ACTION_DETAIL_LIMIT),
        },
    }
}

#[cfg(windows)]
fn summarize_system_power_result(
    result: &Result<SystemPowerApplyResult, String>,
) -> (usize, usize, String) {
    match result {
        Ok(result) => {
            let failed: Vec<String> = result
                .actions
                .iter()
                .filter(|action| !action.ok)
                .map(|action| action.name.clone())
                .collect();
            (result.actions.len(), failed.len(), failed.join(","))
        }
        Err(error) => (0, 1, short_detail(error, ACTION_DETAIL_LIMIT)),
    }
}

#[cfg(windows)]
fn run_program(program: &str, args: &[&str]) -> Result<String, String> {
    run_program_timeout(program, args, Duration::from_secs(4))
}

#[cfg(windows)]
fn run_program_timeout(program: &str, args: &[&str], timeout: Duration) -> Result<String, String> {
    let mut command = Command::new(program);
    command
        .creation_flags(CREATE_NO_WINDOW)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|e| format!("failed to start {}: {}", program, e))?;
    let started = Instant::now();

    loop {
        match child.try_wait() {
            Ok(Some(_status)) => {
                let output = child
                    .wait_with_output()
                    .map_err(|e| format!("failed to collect {} output: {}", program, e))?;
                return command_output_result(program, args, output);
            }
            Ok(None) => {
                if started.elapsed() >= timeout {
                    let _ = child.kill();
                    let output = child.wait_with_output().map_err(|e| {
                        format!("{} timed out and output collection failed: {}", program, e)
                    })?;
                    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                    return Err(format!(
                        "{} timed out after {}ms args={} stdout='{}' stderr='{}'",
                        program,
                        timeout.as_millis(),
                        args_summary(args),
                        short_detail(&stdout, 400),
                        short_detail(&stderr, 400)
                    ));
                }
                thread::sleep(Duration::from_millis(40));
            }
            Err(e) => return Err(format!("failed while waiting for {}: {}", program, e)),
        }
    }
}

#[cfg(windows)]
fn command_output_result(
    program: &str,
    args: &[&str],
    output: std::process::Output,
) -> Result<String, String> {
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if output.status.success() {
        Ok(if stdout.is_empty() {
            "ok".to_string()
        } else {
            stdout
        })
    } else {
        Err(format!(
            "{} failed args={} status={} stdout='{}' stderr='{}'",
            program,
            args_summary(args),
            output.status,
            short_detail(&stdout, 400),
            short_detail(&stderr, 400)
        ))
    }
}

#[cfg(windows)]
fn run_powercfg(args: &[&str]) -> Result<String, String> {
    run_program_timeout("powercfg", args, Duration::from_secs(2))
}

#[cfg(windows)]
fn uniwill_profile_for_mode(mode: &str) -> Option<&'static str> {
    match mode {
        "performance" => Some("Performance"),
        "balanced" => Some("Balanced"),
        "powersave" => Some("BatterySaver"),
        _ => None,
    }
}

#[cfg(windows)]
fn apply_uniwill_profile(mode: &str) -> Result<String, String> {
    let _guard = vendor::try_vendor_command_lock()?;
    let profile = uniwill_profile_for_mode(mode)
        .ok_or_else(|| format!("unknown Uniwill profile mode: {}", mode))?;
    let script = r#"
$ErrorActionPreference = 'Stop'
$profileName = '__PROFILE__'

function HasSdkFiles($path) {
  if ([string]::IsNullOrWhiteSpace($path)) { return $false }
  return (Test-Path (Join-Path $path 'Prism.dll')) -and (Test-Path (Join-Path $path 'UniwillSdkClient.dll'))
}

$sdkCandidates = @()
if (-not [string]::IsNullOrWhiteSpace($env:NUCTOOL_UNIWILL_SDK_DIR)) {
  $sdkCandidates += [pscustomobject]@{ source = 'env:NUCTOOL_UNIWILL_SDK_DIR'; path = $env:NUCTOOL_UNIWILL_SDK_DIR }
}
$configSdkRoot = Join-Path $env:APPDATA 'com.nuc.x15.fan.cyear.app\vendor-sdk'
$sdkCandidates += [pscustomobject]@{ source = 'nuctool-config'; path = (Join-Path $configSdkRoot 'NucSoftwareStudio') }
$sdkCandidates += [pscustomobject]@{ source = 'nuctool-config-root'; path = $configSdkRoot }

$registeredPackage = Get-AppxPackage -Name 'AppUp.IntelNUCSoftwareStudio' -ErrorAction SilentlyContinue |
  Sort-Object InstallDate -Descending |
  Select-Object -First 1
if ($registeredPackage -and -not [string]::IsNullOrWhiteSpace($registeredPackage.InstallLocation)) {
  $sdkCandidates += [pscustomobject]@{ source = 'intel-appx-registration'; path = (Join-Path $registeredPackage.InstallLocation 'NucSoftwareStudio') }
}
$packageRoot = Join-Path $env:ProgramFiles 'WindowsApps'
$package = Get-ChildItem -Path $packageRoot -Directory -Filter 'AppUp.IntelNUCSoftwareStudio_*_x64__8j3eq9eme6ctt' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if ($package) {
  $sdkCandidates += [pscustomobject]@{ source = 'intel-msix-package'; path = (Join-Path $package.FullName 'NucSoftwareStudio') }
}

$sdkPath = $null
$sdkSource = $null
foreach ($candidate in $sdkCandidates) {
  if (HasSdkFiles $candidate.path) {
    $sdkPath = $candidate.path
    $sdkSource = $candidate.source
    break
  }
}
if ([string]::IsNullOrWhiteSpace($sdkPath)) {
  throw 'Uniwill SDK files not found for profile apply'
}

Add-Type -Path (Join-Path $sdkPath 'Prism.dll')
Add-Type -Path (Join-Path $sdkPath 'UniwillSdkClient.dll')
$callback = [UniwillSdkClient.Models.UniwillCallbackHandler]::new($null)
$context = [System.ServiceModel.InstanceContext]::new($callback)
$binding = [System.ServiceModel.NetHttpBinding]::new()
$binding.WebSocketSettings.TransportUsage = [System.ServiceModel.Channels.WebSocketTransportUsage]::Always
$address = [System.ServiceModel.EndpointAddress]::new('ws://localhost:58594/UniwillService')
$client = [UniwillSdkClient.UniwillService.UniwillServiceClient]::new($context, $binding, $address)
try {
  $target = [UniwillSdkClient.UniwillService.ProfileIndex]::$profileName
  $client.ApplyProfile($target)
  $state = $client.GetCurrentState()
  [pscustomobject]@{
    appliedProfile = $target.ToString()
    selectedProfile = $state.SelectedProfileIndex.ToString()
    benchmarkMode = $state.BenchmarkMode
    passiveCooling = $state.PassiveCooling
    sdkSource = $sdkSource
  } | ConvertTo-Json -Compress
} finally {
  if ($client.State -eq [System.ServiceModel.CommunicationState]::Faulted) {
    $client.Abort()
  } else {
    $client.Close()
  }
}
"#
    .replace("__PROFILE__", profile);
    run_program_timeout(
        "powershell",
        &[
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ],
        UNIWILL_PROFILE_TIMEOUT,
    )
}

#[cfg(windows)]
fn wide_to_string(value: &[u16]) -> String {
    let len = value.iter().position(|c| *c == 0).unwrap_or(value.len());
    String::from_utf16_lossy(&value[..len])
}

#[cfg(windows)]
fn run_display_task_with_timeout<T, F>(
    label: &'static str,
    timeout: Duration,
    task: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    if DISPLAY_COMMAND_IN_FLIGHT
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err(format!("{} is already running", label));
    }

    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let _guard = DisplayCommandGuard;
        let result = task();
        let _ = tx.send(result);
    });

    match rx.recv_timeout(timeout) {
        Ok(result) => result,
        Err(mpsc::RecvTimeoutError::Timeout) => {
            if !cfg!(test) {
                app_log(
                    "command",
                    "warn",
                    "display.command_timeout",
                    format!("label={} timeout_ms={}", label, timeout.as_millis()),
                );
            }
            Err(format!(
                "{} timed out after {}ms; Windows may still be finishing the display switch",
                label,
                timeout.as_millis()
            ))
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(format!("{} worker stopped", label)),
    }
}

#[cfg(windows)]
fn schedule_display_recovery_reload(app: AppHandle, detail: String) {
    if detail.contains("already at") {
        return;
    }

    thread::spawn(move || {
        thread::sleep(DISPLAY_RECOVERY_RELOAD_DELAY);
        let Some(window) = app.get_webview_window("main") else {
            app_log(
                "command",
                "warn",
                "display.recovery_reload.window_missing",
                detail,
            );
            return;
        };

        match window.reload() {
            Ok(_) => app_log("command", "info", "display.recovery_reload.ok", detail),
            Err(error) => app_log(
                "command",
                "warn",
                "display.recovery_reload.failed",
                format!("detail={} error={}", detail, error),
            ),
        }
    });
}

#[cfg(windows)]
fn active_display_devices() -> Vec<DISPLAY_DEVICEW> {
    let mut devices = Vec::new();
    let mut index = 0;
    loop {
        let mut device = DISPLAY_DEVICEW {
            cb: std::mem::size_of::<DISPLAY_DEVICEW>() as u32,
            ..Default::default()
        };
        let ok = unsafe { EnumDisplayDevicesW(PCWSTR::null(), index, &mut device, 0) };
        if !ok.as_bool() {
            break;
        }
        if device.StateFlags & DISPLAY_DEVICE_ACTIVE != 0
            && !wide_to_string(&device.DeviceName).is_empty()
        {
            devices.push(device);
        }
        index += 1;
    }
    devices
}

#[cfg(windows)]
fn current_display_mode(device_name: PCWSTR) -> Result<DEVMODEW, String> {
    let mut mode = DEVMODEW {
        dmSize: std::mem::size_of::<DEVMODEW>() as u16,
        ..Default::default()
    };
    let ok = unsafe { EnumDisplaySettingsW(device_name, ENUM_CURRENT_SETTINGS, &mut mode) };
    if ok.as_bool() {
        Ok(mode)
    } else {
        Err("EnumDisplaySettingsW current mode failed".to_string())
    }
}

#[cfg(windows)]
fn supported_refresh_rates_for_device(device_name: PCWSTR) -> Result<Vec<u32>, String> {
    let current = current_display_mode(device_name)?;
    let mut rates = Vec::new();
    let mut index = 0;
    loop {
        let mut mode = DEVMODEW {
            dmSize: std::mem::size_of::<DEVMODEW>() as u16,
            ..Default::default()
        };
        let ok = unsafe {
            EnumDisplaySettingsW(device_name, ENUM_DISPLAY_SETTINGS_MODE(index), &mut mode)
        };
        if !ok.as_bool() {
            break;
        }
        if mode.dmPelsWidth == current.dmPelsWidth
            && mode.dmPelsHeight == current.dmPelsHeight
            && mode.dmBitsPerPel == current.dmBitsPerPel
            && mode.dmDisplayFrequency > 0
        {
            rates.push(mode.dmDisplayFrequency);
        }
        index += 1;
    }
    rates.sort_unstable();
    rates.dedup();
    if rates.is_empty() {
        Err("no refresh rates found for current display mode".to_string())
    } else {
        Ok(rates)
    }
}

#[cfg(windows)]
fn display_refresh_status() -> Result<DisplayRefreshStatus, String> {
    let devices = active_display_devices();
    let mut supported_union = Vec::new();
    let mut details = Vec::new();
    let mut current_hz = 0;

    if devices.is_empty() {
        let mode = current_display_mode(PCWSTR::null())?;
        let rates = supported_refresh_rates_for_device(PCWSTR::null())?;
        current_hz = mode.dmDisplayFrequency;
        supported_union.extend(rates.iter().copied());
        details.push(format!(
            "default {}x{} {}Hz supported={:?}",
            mode.dmPelsWidth, mode.dmPelsHeight, mode.dmDisplayFrequency, rates
        ));
    } else {
        for device in &devices {
            let name = wide_to_string(&device.DeviceName);
            match (
                current_display_mode(PCWSTR(device.DeviceName.as_ptr())),
                supported_refresh_rates_for_device(PCWSTR(device.DeviceName.as_ptr())),
            ) {
                (Ok(mode), Ok(rates)) => {
                    if current_hz == 0 {
                        current_hz = mode.dmDisplayFrequency;
                    }
                    supported_union.extend(rates.iter().copied());
                    details.push(format!(
                        "{} {}x{} {}Hz supported={:?}",
                        name, mode.dmPelsWidth, mode.dmPelsHeight, mode.dmDisplayFrequency, rates
                    ));
                }
                (mode_result, rates_result) => {
                    details.push(format!(
                        "{} failed mode={:?} rates={:?}",
                        name,
                        mode_result.err(),
                        rates_result.err()
                    ));
                }
            }
        }
    }

    supported_union.sort_unstable();
    supported_union.dedup();
    if current_hz == 0 || supported_union.is_empty() {
        Err(format!(
            "display refresh status unavailable; {}",
            details.join(" | ")
        ))
    } else {
        Ok(DisplayRefreshStatus {
            current_hz,
            supported_hz: supported_union,
            device_count: devices.len().max(1),
            detail: "ok".to_string(),
            devices: details,
        })
    }
}

#[cfg(windows)]
struct DisplayRefreshApplyResult {
    target_hz: u32,
    supported_hz: Vec<u32>,
    detail: String,
}

#[cfg(windows)]
fn set_display_refresh_rate_candidates(candidates: &[u32]) -> Result<String, String> {
    set_display_refresh_rate_by_selector(|rates| {
        candidates
            .iter()
            .copied()
            .find(|candidate| rates.contains(candidate))
            .or_else(|| {
                let max_candidate = candidates.iter().copied().max()?;
                rates
                    .iter()
                    .copied()
                    .filter(|rate| *rate <= max_candidate)
                    .max()
            })
            .or_else(|| rates.iter().min().copied())
    })
    .map(|status| status.detail)
}

#[cfg(windows)]
fn set_display_refresh_rate_exact(target_hz: u32) -> Result<DisplayRefreshStatus, String> {
    if !(24..=500).contains(&target_hz) {
        return Err(format!(
            "refresh rate out of supported guard range: {}Hz",
            target_hz
        ));
    }
    set_display_refresh_rate_by_selector(|rates| {
        if rates.contains(&target_hz) {
            Some(target_hz)
        } else {
            None
        }
    })
}

#[cfg(windows)]
fn set_highest_display_refresh_rate() -> Result<String, String> {
    set_display_refresh_rate_by_selector(|rates| rates.iter().max().copied())
        .map(|status| status.detail)
}

#[cfg(windows)]
fn set_display_refresh_rate_by_selector<F>(selector: F) -> Result<DisplayRefreshStatus, String>
where
    F: Fn(&[u32]) -> Option<u32>,
{
    let mut details = Vec::new();
    let mut device_details = Vec::new();
    let mut supported_union = Vec::new();
    let devices = active_display_devices();
    let device_count = devices.len().max(1);
    if devices.is_empty() {
        details.push("no active display device found; trying default display".to_string());
        let result = set_display_refresh_rate_for_device(PCWSTR::null(), "default", &selector);
        return result
            .map(|applied| DisplayRefreshStatus {
                current_hz: applied.target_hz,
                supported_hz: applied.supported_hz,
                device_count,
                detail: applied.detail.clone(),
                devices: vec![applied.detail],
            })
            .map_err(|e| format!("{}; details={}", e, details.join(" | ")));
    }

    let mut successes = Vec::new();
    let mut current_hz = 0;
    for device in devices {
        let name = wide_to_string(&device.DeviceName);
        let result = set_display_refresh_rate_for_device(
            PCWSTR(device.DeviceName.as_ptr()),
            &name,
            &selector,
        );
        match result {
            Ok(applied) => {
                if current_hz == 0 {
                    current_hz = applied.target_hz;
                }
                supported_union.extend(applied.supported_hz.iter().copied());
                device_details.push(applied.detail.clone());
                successes.push(applied.detail);
            }
            Err(error) => {
                device_details.push(error.clone());
                details.push(error);
            }
        }
    }

    supported_union.sort_unstable();
    supported_union.dedup();

    if successes.is_empty() {
        Err(format!(
            "no display refresh rate changed; {}",
            details.join(" | ")
        ))
    } else {
        Ok(DisplayRefreshStatus {
            current_hz,
            supported_hz: supported_union,
            device_count,
            detail: successes.join(" | "),
            devices: device_details,
        })
    }
}

#[cfg(windows)]
fn set_display_refresh_rate_for_device<F>(
    device_name: PCWSTR,
    label: &str,
    selector: &F,
) -> Result<DisplayRefreshApplyResult, String>
where
    F: Fn(&[u32]) -> Option<u32>,
{
    let rates = supported_refresh_rates_for_device(device_name)?;
    let target_hz = selector(&rates).ok_or_else(|| {
        format!(
            "{}: no usable refresh rate found; supported={:?}",
            label, rates
        )
    })?;
    let mut mode = current_display_mode(device_name)?;
    let old_hz = mode.dmDisplayFrequency;
    if old_hz == target_hz {
        return Ok(DisplayRefreshApplyResult {
            target_hz,
            supported_hz: rates,
            detail: format!("{} already at {}Hz", label, target_hz),
        });
    }
    mode.dmDisplayFrequency = target_hz;
    mode.dmFields = DM_DISPLAYFREQUENCY | DM_PELSWIDTH | DM_PELSHEIGHT | DM_BITSPERPEL;
    let result = unsafe {
        ChangeDisplaySettingsExW(device_name, Some(&mode), None, CDS_UPDATEREGISTRY, None)
    };
    if result == DISP_CHANGE_SUCCESSFUL {
        Ok(DisplayRefreshApplyResult {
            target_hz,
            supported_hz: rates,
            detail: format!(
                "{} refresh {}Hz -> {}Hz requested",
                label, old_hz, target_hz
            ),
        })
    } else {
        Err(format!(
            "{} ChangeDisplaySettingsExW failed code={:?} target={}Hz supported={:?}",
            label, result, target_hz, rates
        ))
    }
}

#[cfg(windows)]
#[tauri::command]
pub async fn get_display_refresh_status() -> Result<DisplayRefreshStatus, String> {
    app_log("command", "debug", "get_display_refresh_status.start", "");
    let result = tauri::async_runtime::spawn_blocking(|| {
        run_display_task_with_timeout(
            "get_display_refresh_status",
            DISPLAY_STATUS_TIMEOUT,
            display_refresh_status,
        )
    })
    .await
    .map_err(|e| format!("display refresh status task failed: {}", e))?;
    app_log(
        "command",
        if result.is_ok() { "info" } else { "warn" },
        "get_display_refresh_status.done",
        format!("{:?}", result),
    );
    result
}

#[cfg(windows)]
#[tauri::command]
pub async fn set_display_refresh_rate(
    app: AppHandle,
    hz: u32,
) -> Result<DisplayRefreshStatus, String> {
    app_log(
        "command",
        "info",
        "set_display_refresh_rate.start",
        format!("hz={}", hz),
    );
    let result = tauri::async_runtime::spawn_blocking(move || {
        run_display_task_with_timeout("set_display_refresh_rate", DISPLAY_SET_TIMEOUT, move || {
            set_display_refresh_rate_exact(hz)
        })
    })
    .await
    .map_err(|e| format!("display refresh set task failed: {}", e))?;
    app_log(
        "command",
        if result.is_ok() { "info" } else { "warn" },
        "set_display_refresh_rate.done",
        format!("{:?}", result),
    );
    if let Ok(status) = &result {
        schedule_display_recovery_reload(app, status.detail.clone());
    }
    result
}

#[tauri::command]
pub async fn get_tdp() -> Result<(i64, i64, i64, i64, i64), String> {
    app_log("command", "debug", "get_tdp.start", "");
    let started = std::time::Instant::now();
    let result = tauri::async_runtime::spawn_blocking(fan::request_tdp)
        .await
        .map_err(|e| format!("TDP task failed: {}", e))?;
    app_log(
        "command",
        if result.is_ok() { "debug" } else { "warn" },
        "get_tdp.done",
        format!(
            "elapsed_ms={} result={:?}",
            started.elapsed().as_millis(),
            result
        ),
    );
    result
}

#[tauri::command]
pub async fn set_tdp(t: TDP) -> Result<bool, String> {
    app_log(
        "command",
        "info",
        "set_tdp.start",
        format!(
            "cpu={}W/{}W gpu={}W/{}W tcc={}",
            t.cpu1, t.cpu2, t.gpu1, t.gpu2, t.tcc
        ),
    );
    let started = std::time::Instant::now();
    let result = tauri::async_runtime::spawn_blocking(move || fan::request_set_tdp(t))
        .await
        .map_err(|e| format!("TDP task failed: {}", e))?;
    app_log(
        "command",
        if result == Ok(true) { "info" } else { "warn" },
        "set_tdp.done",
        format!(
            "elapsed_ms={} result={:?}",
            started.elapsed().as_millis(),
            result
        ),
    );
    result
}

#[tauri::command]
pub async fn lock_tdp(t: TDP) -> Result<bool, String> {
    app_log(
        "command",
        "info",
        "lock_tdp.start",
        format!(
            "cpu={}W/{}W gpu={}W/{}W tcc={}",
            t.cpu1, t.cpu2, t.gpu1, t.gpu2, t.tcc
        ),
    );
    let started = std::time::Instant::now();
    let result = tauri::async_runtime::spawn_blocking(move || fan::request_lock_tdp(t))
        .await
        .map_err(|e| format!("TDP lock task failed: {}", e))?;
    app_log(
        "command",
        if result == Ok(true) { "info" } else { "warn" },
        "lock_tdp.done",
        format!(
            "elapsed_ms={} result={:?}",
            started.elapsed().as_millis(),
            result
        ),
    );
    result
}

#[tauri::command]
pub async fn set_cpu_tdp(cpu1: i64, cpu2: i64) -> Result<bool, String> {
    app_log(
        "command",
        "info",
        "set_cpu_tdp.start",
        format!("cpu={}W/{}W", cpu1, cpu2),
    );
    let started = std::time::Instant::now();
    let result = tauri::async_runtime::spawn_blocking(move || fan::request_set_cpu_tdp(cpu1, cpu2))
        .await
        .map_err(|e| format!("CPU TDP task failed: {}", e))?;
    app_log(
        "command",
        if result == Ok(true) { "info" } else { "warn" },
        "set_cpu_tdp.done",
        format!(
            "elapsed_ms={} result={:?}",
            started.elapsed().as_millis(),
            result
        ),
    );
    result
}

#[tauri::command]
pub async fn lock_cpu_tdp(cpu1: i64, cpu2: i64) -> Result<bool, String> {
    app_log(
        "command",
        "info",
        "lock_cpu_tdp.start",
        format!("cpu={}W/{}W", cpu1, cpu2),
    );
    let started = std::time::Instant::now();
    let result =
        tauri::async_runtime::spawn_blocking(move || fan::request_lock_cpu_tdp(cpu1, cpu2))
            .await
            .map_err(|e| format!("CPU TDP lock task failed: {}", e))?;
    app_log(
        "command",
        if result == Ok(true) { "info" } else { "warn" },
        "lock_cpu_tdp.done",
        format!(
            "elapsed_ms={} result={:?}",
            started.elapsed().as_millis(),
            result
        ),
    );
    result
}

#[tauri::command]
#[cfg(windows)]
pub async fn apply_system_power_profile(mode: String) -> Result<SystemPowerApplyResult, String> {
    let normalized = mode.to_ascii_lowercase();
    let profile = system_power_profile(&normalized)
        .ok_or_else(|| format!("unknown system power profile: {}", mode))?;
    app_log(
        "command",
        "info",
        "apply_system_power_profile.start",
        format!("mode={}", normalized),
    );
    fan::pause_tdp_lock_reapply(SYSTEM_PROFILE_TDP_LOCK_PAUSE_MS, "system_power_profile");
    let started = std::time::Instant::now();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut actions = Vec::new();

        push_action(
            &mut actions,
            "powercfg.set_active_scheme",
            run_powercfg(&["/setactive", profile.scheme_alias]),
        );
        push_action(
            &mut actions,
            "powercfg.unhide_boost_mode",
            run_powercfg(&[
                "-attributes",
                "SUB_PROCESSOR",
                "PERFBOOSTMODE",
                "-ATTRIB_HIDE",
            ]),
        );
        push_action(
            &mut actions,
            "powercfg.unhide_energy_preference",
            run_powercfg(&["-attributes", "SUB_PROCESSOR", "PERFEPP", "-ATTRIB_HIDE"]),
        );
        push_action(
            &mut actions,
            "powercfg.ac_processor_max",
            run_powercfg(&[
                "/setacvalueindex",
                "SCHEME_CURRENT",
                "SUB_PROCESSOR",
                "PROCTHROTTLEMAX",
                &profile.ac_processor_max.to_string(),
            ]),
        );
        push_action(
            &mut actions,
            "powercfg.dc_processor_max",
            run_powercfg(&[
                "/setdcvalueindex",
                "SCHEME_CURRENT",
                "SUB_PROCESSOR",
                "PROCTHROTTLEMAX",
                &profile.dc_processor_max.to_string(),
            ]),
        );
        push_action(
            &mut actions,
            "powercfg.ac_boost_mode",
            run_powercfg(&[
                "/setacvalueindex",
                "SCHEME_CURRENT",
                "SUB_PROCESSOR",
                "PERFBOOSTMODE",
                &profile.ac_boost_mode.to_string(),
            ]),
        );
        push_action(
            &mut actions,
            "powercfg.dc_boost_mode",
            run_powercfg(&[
                "/setdcvalueindex",
                "SCHEME_CURRENT",
                "SUB_PROCESSOR",
                "PERFBOOSTMODE",
                &profile.dc_boost_mode.to_string(),
            ]),
        );
        push_action(
            &mut actions,
            "powercfg.ac_energy_preference",
            run_powercfg(&[
                "/setacvalueindex",
                "SCHEME_CURRENT",
                "SUB_PROCESSOR",
                "PERFEPP",
                &profile.ac_energy_preference.to_string(),
            ]),
        );
        push_action(
            &mut actions,
            "powercfg.dc_energy_preference",
            run_powercfg(&[
                "/setdcvalueindex",
                "SCHEME_CURRENT",
                "SUB_PROCESSOR",
                "PERFEPP",
                &profile.dc_energy_preference.to_string(),
            ]),
        );
        push_action(
            &mut actions,
            "powercfg.commit_current_scheme",
            run_powercfg(&["/setactive", "SCHEME_CURRENT"]),
        );
        push_action(
            &mut actions,
            "powercfg.query_energy_preference",
            run_powercfg(&["/query", "SCHEME_CURRENT", "SUB_PROCESSOR", "PERFEPP"]),
        );
        push_action(
            &mut actions,
            "uniwill.apply_profile",
            apply_uniwill_profile(&normalized),
        );

        if !profile.refresh_candidates.is_empty() {
            push_action(
                &mut actions,
                "display.refresh_rate",
                set_display_refresh_rate_candidates(profile.refresh_candidates),
            );
        } else if profile.use_highest_refresh {
            push_action(
                &mut actions,
                "display.refresh_rate",
                set_highest_display_refresh_rate(),
            );
        }

        if profile.reset_gpu_clock {
            push_action(
                &mut actions,
                "nvidia.reset_gpu_clocks",
                run_program("nvidia-smi", &["-i", "0", "--reset-gpu-clocks"]),
            );
        } else if let Some(max_mhz) = profile.gpu_clock_max_mhz {
            let max_arg = format!("405,{}", max_mhz);
            push_action(
                &mut actions,
                "nvidia.lock_gpu_clocks",
                run_program("nvidia-smi", &["-i", "0", "--lock-gpu-clocks", &max_arg]),
            );
        }

        Ok(SystemPowerApplyResult {
            mode: normalized,
            actions,
        })
    })
    .await
    .map_err(|e| format!("system power profile task failed: {}", e))?;

    fan::pause_tdp_lock_reapply(
        SYSTEM_PROFILE_TDP_LOCK_PAUSE_MS,
        "system_power_profile.done",
    );
    let (action_count, failed_count, failed_actions) = summarize_system_power_result(&result);
    app_log(
        "command",
        if result.is_ok() { "info" } else { "warn" },
        "apply_system_power_profile.done",
        format!(
            "elapsed_ms={} mode={} ok={} action_count={} failed_count={} failed_actions={}",
            started.elapsed().as_millis(),
            mode,
            result.is_ok(),
            action_count,
            failed_count,
            failed_actions
        ),
    );
    result
}

#[tauri::command]
#[cfg(unix)]
pub async fn apply_system_power_profile(_mode: String) -> Result<SystemPowerApplyResult, String> {
    Err("System power profiles are currently implemented for Windows only".to_string())
}

#[tauri::command]
#[cfg(unix)]
pub async fn get_display_refresh_status() -> Result<DisplayRefreshStatus, String> {
    Err("Display refresh control is currently implemented for Windows only".to_string())
}

#[tauri::command]
#[cfg(unix)]
pub async fn set_display_refresh_rate(_hz: u32) -> Result<DisplayRefreshStatus, String> {
    Err("Display refresh control is currently implemented for Windows only".to_string())
}

#[tauri::command]
#[cfg(windows)]
pub async fn set_gpu_clock_limit(max_mhz: i64) -> Result<bool, String> {
    let max_mhz = max_mhz.clamp(405, 2100);
    app_log(
        "command",
        "info",
        "set_gpu_clock_limit.start",
        format!("max_mhz={}", max_mhz),
    );
    let started = std::time::Instant::now();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let max_arg = format!("405,{}", max_mhz);
        let output = Command::new("nvidia-smi")
            .args(["-i", "0", "--lock-gpu-clocks", &max_arg])
            .output()
            .map_err(|e| format!("failed to start nvidia-smi: {}", e))?;

        if output.status.success() {
            Ok(true)
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            Err(format!(
                "nvidia-smi failed status={} stdout='{}' stderr='{}'",
                output.status, stdout, stderr
            ))
        }
    })
    .await
    .map_err(|e| format!("GPU clock limit task failed: {}", e))?;
    app_log(
        "command",
        if result == Ok(true) { "info" } else { "warn" },
        "set_gpu_clock_limit.done",
        format!(
            "elapsed_ms={} max_mhz={} result={:?}",
            started.elapsed().as_millis(),
            max_mhz,
            result
        ),
    );
    result
}

#[tauri::command]
#[cfg(unix)]
pub async fn set_gpu_clock_limit(_max_mhz: i64) -> Result<bool, String> {
    Err("GPU clock limit is currently implemented for Windows only".to_string())
}

#[tauri::command]
#[cfg(windows)]
pub async fn set_rgb(rgb: RGB) -> Result<bool, String> {
    let started = std::time::Instant::now();
    let result = tauri::async_runtime::spawn_blocking(move || keyboard_rgb::set_static_color(&rgb))
        .await
        .map_err(|e| format!("Keyboard RGB task failed: {}", e))?;
    app_log(
        "command",
        if result == Ok(true) { "info" } else { "warn" },
        "set_rgb.done",
        format!(
            "elapsed_ms={} result={:?}",
            started.elapsed().as_millis(),
            result
        ),
    );
    result
}

#[tauri::command]
#[cfg(windows)]
pub async fn get_rgb() -> RGB {
    RGB { r: 0, g: 0, b: 0 }
}

#[tauri::command]
#[cfg(unix)]
pub async fn set_rgb(rgb: RGB) -> Result<bool, String> {
    keyboard_rgb::set_static_color(&rgb)
}

#[tauri::command]
#[cfg(unix)]
pub async fn get_rgb() -> RGB {
    RGB { r: 0, g: 0, b: 0 }
}

#[tauri::command]
#[cfg(windows)]
pub async fn set_rgb_color_y() {
    let _ = tauri::async_runtime::spawn_blocking(fan::request_set_rgb_color_y).await;
}

#[tauri::command]
#[cfg(windows)]
pub async fn set_rgb_color_n() {
    let _ = tauri::async_runtime::spawn_blocking(fan::request_set_rgb_color_n).await;
}

#[tauri::command]
#[cfg(windows)]
pub async fn get_rgb_color() -> bool {
    tauri::async_runtime::spawn_blocking(|| fan::request_get_rgb_color().unwrap_or(false))
        .await
        .unwrap_or(false)
}

#[tauri::command]
#[cfg(unix)]
pub async fn set_rgb_color_y() {}

#[tauri::command]
#[cfg(unix)]
pub async fn set_rgb_color_n() {}

#[tauri::command]
#[cfg(unix)]
pub async fn get_rgb_color() -> bool {
    false
}

#[cfg(test)]
mod tests {
    #[cfg(windows)]
    use super::*;

    #[cfg(windows)]
    #[test]
    fn display_task_timeout_returns_and_blocks_overlap_until_worker_finishes() {
        let timed_out =
            run_display_task_with_timeout("slow_display_test", Duration::from_millis(10), || {
                thread::sleep(Duration::from_millis(60));
                Ok(())
            });

        assert!(timed_out
            .err()
            .is_some_and(|error| error.contains("timed out")));

        let overlap = run_display_task_with_timeout(
            "overlap_display_test",
            Duration::from_millis(10),
            || Ok(()),
        );
        assert!(overlap
            .err()
            .is_some_and(|error| error.contains("already running")));

        thread::sleep(Duration::from_millis(80));
        assert!(run_display_task_with_timeout(
            "fast_display_test",
            Duration::from_millis(50),
            || Ok(())
        )
        .is_ok());
    }
}
