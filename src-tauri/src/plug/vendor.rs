use serde::Serialize;
use serde_json::{json, Value};

#[cfg(windows)]
use std::{
    fs,
    io::Read,
    os::windows::process::CommandExt,
    path::PathBuf,
    process::{Command, Stdio},
    sync::{Mutex, MutexGuard, TryLockError},
    thread,
    time::{Duration, Instant},
};

#[cfg(windows)]
use libloading::{Library, Symbol};
#[cfg(windows)]
use sha2::{Digest, Sha256};

#[cfg(windows)]
use crate::plug::diagnostics::app_log;

#[derive(Debug, Serialize)]
pub struct VendorServiceStatus {
    pub ok: bool,
    pub detail: String,
    pub data: Value,
}

#[derive(Clone, Debug, serde::Deserialize)]
pub struct VendorRgb {
    r: i64,
    g: i64,
    b: i64,
}

#[derive(Clone, Debug, serde::Deserialize)]
pub struct VendorLightbarSettingInput {
    effect: String,
    r: i64,
    g: i64,
    b: i64,
}

#[derive(Clone, Debug, serde::Deserialize)]
pub struct VendorLightbarProfileInput {
    ac: VendorLightbarSettingInput,
    dc: VendorLightbarSettingInput,
    breathing: bool,
}

#[derive(Debug, Serialize)]
pub struct VendorWhisperApplyResult {
    pub mode: String,
    pub fps: i64,
    pub status: VendorServiceStatus,
}

#[derive(Debug, Serialize)]
pub struct VendorBatteryApplyResult {
    pub mode: String,
    pub level: i64,
    pub status: VendorServiceStatus,
}

#[derive(Debug, Serialize)]
pub struct VendorLightingApplyResult {
    pub r: i64,
    pub g: i64,
    pub b: i64,
    pub keyboard_brightness: i64,
    pub lightbar_brightness: i64,
    pub lightbar_breathing: bool,
    pub status: VendorServiceStatus,
}

#[derive(Debug, Serialize)]
pub struct VendorDisplayModeApplyResult {
    pub mode: String,
    pub display_mode: Value,
    pub verified: bool,
    pub transport: String,
    pub status: VendorServiceStatus,
}

#[derive(Debug, Serialize)]
pub struct AuthorPowerProfileApplyResult {
    pub mode: String,
    pub profile_index: i32,
    pub benchmark_enabled: bool,
    pub dispatched: bool,
    pub verified: bool,
    pub current_profile_index: Option<i32>,
    pub status: VendorServiceStatus,
}

#[derive(Debug, Serialize)]
pub struct AuthorBenchmarkApplyResult {
    pub enabled: bool,
    pub dispatched: bool,
    pub power_plan_index: Option<i32>,
    pub status: VendorServiceStatus,
}

#[derive(Debug, Serialize)]
pub struct AuthorPowerPlanApplyResult {
    pub mode: String,
    pub power_plan_index: i32,
    pub status: VendorServiceStatus,
}

#[derive(Debug, Serialize)]
pub struct AuthorBatteryApplyResult {
    pub level: i64,
    pub status: VendorServiceStatus,
}

#[derive(Debug, Serialize)]
pub struct AuthorKeyboardApplyResult {
    pub enabled: bool,
    pub brightness: i64,
    pub status: VendorServiceStatus,
}

#[derive(Debug, Serialize)]
pub struct AuthorHardwareReadback {
    pub battery_charging_level: Option<i32>,
    pub keyboard_leds_power: Option<i32>,
    pub keyboard_enabled: Option<bool>,
    pub current_profile_index: Option<i32>,
    pub supported_features_count: Option<i32>,
    pub lightbar_indicators_power: Option<i32>,
    pub lightbar_supported: Option<bool>,
    pub aurora_installed: Option<bool>,
    pub status: VendorServiceStatus,
}

#[derive(Debug, Serialize)]
pub struct VendorKeyApplyResult {
    pub key: String,
    pub enabled: bool,
    pub verified: bool,
    pub status: VendorServiceStatus,
}

#[derive(Debug, Serialize)]
pub struct VendorOsdApplyResult {
    pub enabled: bool,
    pub status: VendorServiceStatus,
}

#[derive(Debug, Serialize)]
pub struct VendorKeyboardColorApplyResult {
    pub r: i64,
    pub g: i64,
    pub b: i64,
    pub verified: bool,
    pub status: VendorServiceStatus,
}

#[derive(Debug, Serialize)]
pub struct VendorLightbarApplyResult {
    pub source: String,
    pub r: i64,
    pub g: i64,
    pub b: i64,
    pub breathing: bool,
    pub verified: bool,
    pub status: VendorServiceStatus,
}

#[derive(Debug, Serialize)]
pub struct VendorCustomDisplayApplyResult {
    pub profile_index: i32,
    pub saved_profile_verified: bool,
    pub activation_requested: bool,
    pub status: VendorServiceStatus,
}

#[derive(Debug, Serialize)]
pub struct VendorAuxApplyResult {
    pub source: String,
    pub value: i64,
    pub verified: bool,
    pub status: VendorServiceStatus,
}

#[derive(Debug, Serialize)]
pub struct VendorKeyboardEffectApplyResult {
    pub effect: String,
    pub direction: String,
    pub speed: i64,
    pub verified: bool,
    pub status: VendorServiceStatus,
}

#[derive(Debug, Serialize)]
pub struct VendorLightbarEffectApplyResult {
    pub source: String,
    pub effect: String,
    pub verified: bool,
    pub status: VendorServiceStatus,
}

#[cfg(windows)]
const VENDOR_STATUS_TIMEOUT: Duration = Duration::from_secs(8);
#[cfg(windows)]
const VENDOR_WRITE_TIMEOUT: Duration = Duration::from_secs(6);
#[cfg(windows)]
const VENDOR_RESET_TIMEOUT: Duration = Duration::from_secs(10);
// Windows CREATE_NO_WINDOW keeps helper PowerShell processes invisible.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
// The vendor service accepts an integer FPS target. Keep the UI write range
// bounded to common panel/game caps instead of forwarding arbitrary values.
const MAX_WHISPER_FPS: i64 = 240;
const MIN_BATTERY_CHARGE_LEVEL: i64 = 50;
const MAX_BATTERY_CHARGE_LEVEL: i64 = 100;
const MAX_RGB_CHANNEL: i64 = 255;
const MAX_LIGHT_BRIGHTNESS: i64 = 100;
#[cfg(windows)]
const AUTHOR_DISPLAY_BRIDGE_HASH: &str =
    "8F7B8338EAF242372FBF096CC9364CA0F60145281ACA17E4E97955945A920875";

#[cfg(windows)]
static VENDOR_COMMAND_LOCK: Mutex<()> = Mutex::new(());

#[cfg(windows)]
pub(crate) fn try_vendor_command_lock() -> Result<MutexGuard<'static, ()>, String> {
    match VENDOR_COMMAND_LOCK.try_lock() {
        Ok(guard) => Ok(guard),
        Err(TryLockError::WouldBlock) => Err("vendor service command already running".to_string()),
        Err(TryLockError::Poisoned(_)) => Err("vendor service command lock poisoned".to_string()),
    }
}

#[cfg(windows)]
pub(crate) fn bundled_uniwill_sdk_dir() -> Option<String> {
    std::env::current_exe()
        .ok()
        .and_then(|path| {
            path.parent().map(|parent| {
                let installed = parent.join("NucSoftwareStudio");
                if installed.is_dir() {
                    installed
                } else {
                    parent.join("resources/NucSoftwareStudio")
                }
            })
        })
        .map(|path| path.to_string_lossy().into_owned())
}

#[cfg(windows)]
fn author_display_bridge_path() -> Option<PathBuf> {
    bundled_uniwill_sdk_dir().map(|path| PathBuf::from(path).join("NUCtool.dll"))
}

#[cfg(windows)]
fn author_display_bridge_status() -> Value {
    let Some(path) = author_display_bridge_path() else {
        return json!({
            "available": false,
            "detail": "NUCtool display bridge path is unavailable"
        });
    };
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(_) => {
            return json!({
                "available": false,
                "detail": "NUCtool display bridge is not bundled"
            })
        }
    };
    let actual_hash = hex::encode_upper(Sha256::digest(bytes));
    if !actual_hash.eq_ignore_ascii_case(AUTHOR_DISPLAY_BRIDGE_HASH) {
        return json!({
            "available": false,
            "detail": "NUCtool display bridge integrity check failed",
            "expectedHash": AUTHOR_DISPLAY_BRIDGE_HASH,
            "actualHash": actual_hash,
        });
    }
    json!({
        "available": true,
        "detail": "NUCtool.dll file integrity verified; service operation not yet confirmed",
        "path": path,
        "hash": actual_hash,
    })
}

#[cfg(windows)]
fn with_author_bridge<T>(
    operation: &str,
    call: impl FnOnce(&Library) -> Result<T, String>,
) -> Result<(T, Value), String> {
    let _guard = try_vendor_command_lock()?;
    let bridge = author_display_bridge_status();
    if !bridge
        .get("available")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Err(bridge
            .get("detail")
            .and_then(Value::as_str)
            .unwrap_or("NUCtool bridge is unavailable")
            .to_string());
    }
    let path = author_display_bridge_path()
        .ok_or_else(|| "NUCtool bridge path is unavailable".to_string())?;
    let library = unsafe { Library::new(&path) }
        .map_err(|e| format!("failed to load NUCtool bridge for {}: {}", operation, e))?;
    Ok((call(&library)?, bridge))
}

#[cfg(windows)]
fn display_mode_index(mode: &str) -> Option<i32> {
    match mode {
        "Standard" => Some(0),
        "Gaming" => Some(1),
        "Video" => Some(2),
        "Reading" => Some(3),
        _ => None,
    }
}

fn author_power_profile(mode: &str) -> Option<(&'static str, i32)> {
    match mode.trim().to_ascii_lowercase().as_str() {
        "powersave" | "power-saving" | "saving" => Some(("powersave", 3)),
        "balanced" => Some(("balanced", 2)),
        "performance" | "high-performance" => Some(("performance", 1)),
        _ => None,
    }
}

fn author_power_plan_index(mode: &str) -> Option<(&'static str, i32)> {
    match mode.trim().to_ascii_lowercase().as_str() {
        "off" | "disabled" => Some(("off", 0)),
        "performance" | "high-performance" => Some(("performance", 1)),
        "balanced" => Some(("balanced", 2)),
        "powersave" | "power-saving" | "saving" => Some(("powersave", 3)),
        "benchmark" | "bench" => Some(("benchmark", 4)),
        _ => None,
    }
}

fn author_benchmark_plan_index(enabled: bool) -> Option<i32> {
    enabled.then_some(4)
}

#[cfg(windows)]
fn hidden_command(program: &str) -> Command {
    let mut command = Command::new(program);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

fn normalize_whisper_mode(mode: &str) -> Option<&'static str> {
    match mode.trim().to_ascii_lowercase().as_str() {
        "off" => Some("Off"),
        "on" => Some("Quiet"),
        "quieter" => Some("Quieter"),
        "quiet" => Some("Quiet"),
        "balanced" => Some("Balanced"),
        _ => None,
    }
}

fn normalize_battery_mode(mode: &str) -> Option<&'static str> {
    match mode.trim().to_ascii_lowercase().as_str() {
        "acmode" | "full" | "fullcharge" => Some("AcMode"),
        "custom" | "standard" => Some("Custom"),
        "bestbattery" | "care" | "conservation" => Some("BestBattery"),
        _ => None,
    }
}

#[cfg(any(windows, test))]
fn vendor_battery_confirmed(data: &Value, mode: &str, level: i64) -> bool {
    data.get("connected").and_then(Value::as_bool) == Some(true)
        && data.get("sdkFound").and_then(Value::as_bool) == Some(true)
        && data.pointer("/battery/mode").and_then(Value::as_str) == Some(mode)
        && (mode != "Custom"
            || data.pointer("/battery/chargingLevel").and_then(Value::as_i64) == Some(level))
}

// These names match UniwillSdkClient.UniwillService.DisplayModeType. We only
// accept the vendor's built-in content modes; Custom remains managed by NUC
// Software Studio so the app never overwrites a user's calibrated profile.
fn normalize_display_mode(mode: &str) -> Option<&'static str> {
    match mode.trim().to_ascii_lowercase().as_str() {
        "standard" | "default" => Some("Standard"),
        "gaming" | "game" => Some("Gaming"),
        "video" | "movie" | "cinema" => Some("Video"),
        "reading" | "read" => Some("Reading"),
        _ => None,
    }
}

#[cfg(windows)]
fn run_powershell_json(script: &str, timeout: Duration) -> Result<String, String> {
    let _guard = try_vendor_command_lock()?;

    let mut command = hidden_command("powershell");
    command.args([
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
    ]);
    if let Some(sdk_dir) = bundled_uniwill_sdk_dir() {
        command.env("NUCTOOL_BUNDLED_UNIWILL_SDK_DIR", sdk_dir);
    }
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to start powershell: {}", e))?;

    // Drain both pipes while the process runs. Waiting for exit before reading
    // deadlocks once the full keyboard LED snapshot exceeds a pipe buffer.
    let mut stdout_pipe = child.stdout.take().ok_or("powershell stdout is unavailable")?;
    let mut stderr_pipe = child.stderr.take().ok_or("powershell stderr is unavailable")?;
    let stdout_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout_pipe.read_to_end(&mut bytes).map(|_| bytes)
    });
    let stderr_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        stderr_pipe.read_to_end(&mut bytes).map(|_| bytes)
    });

    let start = Instant::now();
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|e| format!("failed waiting for powershell: {}", e))?
        {
            let stdout_bytes = stdout_reader.join()
                .map_err(|_| "powershell stdout reader panicked".to_string())?
                .map_err(|e| format!("failed reading powershell stdout: {e}"))?;
            let stderr_bytes = stderr_reader.join()
                .map_err(|_| "powershell stderr reader panicked".to_string())?
                .map_err(|e| format!("failed reading powershell stderr: {e}"))?;
            let stdout = String::from_utf8_lossy(&stdout_bytes).trim().to_string();
            let stderr = String::from_utf8_lossy(&stderr_bytes).trim().to_string();
            if status.success() {
                return Ok(stdout);
            }
            return Err(format!(
                "powershell failed status={} stdout='{}' stderr='{}'",
                status, stdout, stderr
            ));
        }

        if start.elapsed() >= timeout {
            let pid = child.id();
            app_log(
                "vendor",
                "warn",
                "powershell.timeout",
                format!("pid={} timeout_ms={}", pid, timeout.as_millis()),
            );
            let _ = hidden_command("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "powershell timed out after {} ms",
                timeout.as_millis()
            ));
        }

        thread::sleep(Duration::from_millis(50));
    }
}

#[cfg(windows)]
fn vendor_status_script() -> &'static str {
    r#"
$ErrorActionPreference = 'Stop'

function TextOrNull($value) {
  if ($null -eq $value) { return $null }
  return $value.ToString()
}

function ModeObject($mode) {
  if ($null -eq $mode) { return $null }
  [pscustomobject]@{
    cpu = TextOrNull $mode.CpuMode
    dgpu = TextOrNull $mode.DGpuMode
    fan = TextOrNull $mode.FanMode
  }
}

function ProfileObject($profile) {
  if ($null -eq $profile) { return $null }
  [pscustomobject]@{
    ac = ModeObject $profile.AC
    dc = ModeObject $profile.DC
  }
}

function ProfilesObject($profiles) {
  $out = [ordered]@{}
  if ($null -eq $profiles) { return $out }
  foreach ($name in @('Performance', 'Balanced', 'BatterySaver')) {
    try {
      $index = [UniwillSdkClient.UniwillService.ProfileIndex]::$name
      # GetCurrentProfiles/GetDefaultProfiles return a compact array, while
      # ProfileIndex enum values are 1..3. Match the profile's own Index.
      $profile = @($profiles | Where-Object { $_.Index -eq $index } | Select-Object -First 1)
      if ($profile.Count -eq 1) { $profile = $profile[0] } else { $profile = $null }
      if ($null -ne $profile) {
        $out[$name] = ProfileObject $profile
      }
    } catch {
      $out[$name] = [pscustomobject]@{ error = $_.Exception.Message }
    }
  }
  return $out
}

$result = [ordered]@{
  packageFound = $false
  packagePath = $null
  sdkFound = $false
  sdkPath = $null
  sdkSource = $null
  processRunning = $false
  endpoint = 'ws://localhost:58594/UniwillService'
  connected = $false
  currentState = $null
  features = @()
  currentProfiles = $null
  defaultProfiles = $null
  keyStates = @()
  savedDisplayModes = @()
  whisper = $null
  battery = $null
  lighting = $null
  keyboardBrightness = $null
  keyboardIdleTimer = $null
  lightbarIdleTimer = $null
  errors = @()
}

$result.processRunning = [bool](Get-Process -Name 'UniwillService' -ErrorAction SilentlyContinue)

function HasSdkFiles($path) {
  if ([string]::IsNullOrWhiteSpace($path)) { return $false }
  return (Test-Path (Join-Path $path 'Prism.dll')) -and (Test-Path (Join-Path $path 'UniwillSdkClient.dll'))
}

$sdkCandidates = @()
if (-not [string]::IsNullOrWhiteSpace($env:NUCTOOL_BUNDLED_UNIWILL_SDK_DIR)) {
  $sdkCandidates += [pscustomobject]@{ source = 'bundled-resource'; path = $env:NUCTOOL_BUNDLED_UNIWILL_SDK_DIR }
}
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
  $result.packageFound = $true
  $result.packagePath = $registeredPackage.InstallLocation
  $sdkCandidates += [pscustomobject]@{ source = 'intel-appx-registration'; path = (Join-Path $registeredPackage.InstallLocation 'NucSoftwareStudio') }
} else {
  $packageRoot = Join-Path $env:ProgramFiles 'WindowsApps'
  $package = Get-ChildItem -Path $packageRoot -Directory -Filter 'AppUp.IntelNUCSoftwareStudio_*_x64__8j3eq9eme6ctt' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($package) {
    $result.packageFound = $true
    $result.packagePath = $package.FullName
    $sdkCandidates += [pscustomobject]@{ source = 'intel-msix-package'; path = (Join-Path $package.FullName 'NucSoftwareStudio') }
  } else {
    $result.errors += 'Intel NUC Software Studio package not found; using local SDK fallback if present'
  }
}

foreach ($candidate in $sdkCandidates) {
  if (HasSdkFiles $candidate.path) {
    $result.sdkFound = $true
    $result.sdkPath = $candidate.path
    $result.sdkSource = $candidate.source
    break
  }
}

if (-not $result.sdkFound) {
  $result.errors += 'Uniwill SDK files not found. Keep Intel NUC Software Studio installed or configure a local SDK fallback.'
  $result | ConvertTo-Json -Depth 8 -Compress
  exit 0
}

$sdkPath = $result.sdkPath
Add-Type -Path (Join-Path $sdkPath 'Prism.dll')
Add-Type -Path (Join-Path $sdkPath 'UniwillSdkClient.dll')

$callback = [UniwillSdkClient.Models.UniwillCallbackHandler]::new($null)
$context = [System.ServiceModel.InstanceContext]::new($callback)
$binding = [System.ServiceModel.NetHttpBinding]::new()
$binding.WebSocketSettings.TransportUsage = [System.ServiceModel.Channels.WebSocketTransportUsage]::Always
$address = [System.ServiceModel.EndpointAddress]::new($result.endpoint)
$client = [UniwillSdkClient.UniwillService.UniwillServiceClient]::new($context, $binding, $address)
try {
  $state = $client.GetCurrentState()
  $result.connected = $true
  $result.currentState = [pscustomobject]@{
    selectedProfile = TextOrNull $state.SelectedProfileIndex
    benchmarkMode = $state.BenchmarkMode
    passiveCooling = $state.PassiveCooling
  }

  try { $result.features = @($client.GetSupportedFeatures() | ForEach-Object { $_.Type.ToString() }) } catch { $result.errors += "GetSupportedFeatures: $($_.Exception.Message)" }
  try {
    $result.keyStates = @($client.GetCurrentKeyStates() | ForEach-Object {
      [pscustomobject]@{ type = $_.Type.ToString(); state = [bool]$_.State }
    })
  } catch { $result.errors += "GetCurrentKeyStates: $($_.Exception.Message)" }
  try { $result.currentProfiles = ProfilesObject ($client.GetCurrentProfiles()) } catch { $result.errors += "GetCurrentProfiles: $($_.Exception.Message)" }
  try { $result.defaultProfiles = ProfilesObject ($client.GetDefaultProfiles()) } catch { $result.errors += "GetDefaultProfiles: $($_.Exception.Message)" }
  try {
    $result.savedDisplayModes = @($client.GetSavedDisplayModes() | ForEach-Object {
      [pscustomobject]@{
        index = [int]$_.Index
        type = $_.Type.ToString()
        brightnessAc = [int]$_.BrightnessAC
        brightnessDc = [int]$_.BrightnessDC
        colorTemp = [int]$_.ColorTemp
        contrast = [single]$_.Contrast
        red = [int]$_.Red
        green = [int]$_.Green
        blue = [int]$_.Blue
      }
    })
  } catch { $result.errors += "GetSavedDisplayModes: $($_.Exception.Message)" }
  try {
    $result.whisper = [pscustomobject]@{
      type = TextOrNull ($client.GetWhisperModeType())
      fps = $client.GetWhisperModeFps()
    }
  } catch {
    $result.errors += "WhisperMode: $($_.Exception.Message)"
  }
  try {
    $batteryState = $client.GetBatteryState()
    $result.battery = [pscustomobject]@{
      mode = TextOrNull ($client.GetBatteryMode())
      chargingLevel = $client.GetBatteryChargingLevel()
      timeAt100Elapsed = $batteryState.Item1
      ermTimeThresholdReached = $batteryState.Item2
    }
  } catch {
    $result.errors += "Battery: $($_.Exception.Message)"
  }
  try {
    $levels = $client.GetKeyboardBrightness()
    $result.keyboardBrightness = [pscustomobject]@{ ac = [int]$levels.Item1; dc = [int]$levels.Item2 }
  } catch { $result.errors += "GetKeyboardBrightness: $($_.Exception.Message)" }
  try {
    $timers = $client.GetIdleTimerValue()
    $result.keyboardIdleTimer = [pscustomobject]@{ ac = [int]$timers.Item1; dc = [int]$timers.Item2 }
  } catch { $result.errors += "GetIdleTimerValue: $($_.Exception.Message)" }
  try {
    $timers = $client.GetLightBarIdleTimerValue()
    $result.lightbarIdleTimer = [pscustomobject]@{ ac = [int]$timers.Item1; dc = [int]$timers.Item2 }
  } catch { $result.errors += "GetLightBarIdleTimerValue: $($_.Exception.Message)" }
  # This service's GetCurrentDisplayMode contract returns void. On this device
  # calling it also breaks subsequent lighting reads on the same WCF session.
  # Keep displayMode unknown rather than poisoning the rest of the snapshot.
  try {
    $keyboard = $client.GetCurrentKeyboardLedProfile()
    $lightbar = $client.GetCurrentLightbarProfile()
    $result.lighting = [pscustomobject]@{
      keyboard = [pscustomobject]@{
        effect = TextOrNull $keyboard.Effect
        direction = TextOrNull $keyboard.Direction
        speed = $keyboard.Speed
        brightnessAc = $keyboard.Brightness_AC
        brightnessDc = $keyboard.Brightness_DC
        colorLength = $keyboard.ColorLength
        colors = @($keyboard.Color | Select-Object -First 3 | ForEach-Object {
          [pscustomobject]@{ r = $_.R; g = $_.G; b = $_.B }
        })
        keyColorCount = @($keyboard.KeyColor).Count
        keyColors = @($keyboard.KeyColor | ForEach-Object {
          [pscustomobject]@{ r = $_.R; g = $_.G; b = $_.B }
        })
      }
      lightbar = [pscustomobject]@{
        breathing = $lightbar.BreathingEnable
        ac = [pscustomobject]@{
          effect = TextOrNull $lightbar.AcSetting.Effect
          r = $lightbar.AcSetting.R_Brightness
          g = $lightbar.AcSetting.G_Brightness
          b = $lightbar.AcSetting.B_Brightness
        }
        dc = [pscustomobject]@{
          effect = TextOrNull $lightbar.DcSetting.Effect
          r = $lightbar.DcSetting.R_Brightness
          g = $lightbar.DcSetting.G_Brightness
          b = $lightbar.DcSetting.B_Brightness
        }
      }
    }
  } catch {
    $result.errors += "Lighting: $($_.Exception.Message)"
  }
} catch {
  $result.connected = $false
  $result.errors += "UniwillService request: $($_.Exception.Message)"
} finally {
  try {
    if ($client.State -eq [System.ServiceModel.CommunicationState]::Faulted) {
      $client.Abort()
    } else {
      $client.Close()
    }
  } catch { $client.Abort() }
}

$result | ConvertTo-Json -Depth 8 -Compress
"#
}

#[cfg(windows)]
fn vendor_whisper_script(mode: &str, fps: i64) -> String {
    vendor_mutation_script(
        &format!(
            "$targetWhisperMode = [UniwillSdkClient.UniwillService.WhisperModeType]::{mode}\n$targetWhisperFps = {fps}"
        ),
        "  $client.SetWhisperModeType($targetWhisperMode)\n  $client.SetWhisperModeFps($targetWhisperFps)",
    )
}

#[cfg(windows)]
fn vendor_battery_script(mode: &str, level: i64) -> String {
    vendor_mutation_script(
        &format!(
            "$targetBatteryMode = [UniwillSdkClient.UniwillService.BatteryMode]::{mode}\n$targetBatteryLevel = {level}"
        ),
        "  $client.SetBatteryMode($targetBatteryMode)\n  if ($targetBatteryMode -eq [UniwillSdkClient.UniwillService.BatteryMode]::Custom) { $client.SetBatteryChargingLevel($targetBatteryLevel) }",
    )
}

#[cfg(windows)]
fn vendor_key_type(key: &str) -> Option<&'static str> {
    match key {
        "WinKey" => Some("WinKey"),
        "FnKey" => Some("FnKey"),
        "NumPad" => Some("NumPad"),
        "DisableTouchPadToggle" => Some("DisableTouchPadToggle"),
        _ => None,
    }
}

#[cfg(windows)]
fn vendor_key_script(key: &str, enabled: bool) -> String {
    let state = if enabled { "$true" } else { "$false" };
    vendor_mutation_script(
        "",
        &format!(
            "  $keyState = [UniwillSdkClient.UniwillService.KeyState]::new()\n  $keyState.Type = [UniwillSdkClient.UniwillService.KeyType]::{key}\n  $keyState.State = {state}\n  $client.EnableKey($keyState)"
        )
    )
}

#[cfg(windows)]
fn apply_vendor_key_blocking(key: String, enabled: bool) -> Result<VendorKeyApplyResult, String> {
    let key = vendor_key_type(&key).ok_or_else(|| format!("unknown vendor key: {key}"))?;
    let stdout = run_powershell_json(&vendor_key_script(key, enabled), VENDOR_WRITE_TIMEOUT)?;
    let data = serde_json::from_str::<Value>(&stdout)
        .map_err(|e| format!("failed to parse vendor key JSON: {e}"))?;
    let verified = data
        .get("keyStates")
        .and_then(Value::as_array)
        .and_then(|states| {
            states
                .iter()
                .find(|state| state.get("type").and_then(Value::as_str) == Some(key))
        })
        .and_then(|state| state.get("state"))
        .and_then(Value::as_bool)
        == Some(enabled);
    let status = VendorServiceStatus {
        ok: verified,
        detail: if verified {
            format!("{key} state confirmed by Uniwill service")
        } else {
            format!("{key} request was not confirmed by service readback")
        },
        data,
    };
    Ok(VendorKeyApplyResult {
        key: key.to_string(),
        enabled,
        verified,
        status,
    })
}

#[cfg(windows)]
fn vendor_mutation_script(values: &str, operation: &str) -> String {
    let sdk_marker = "Add-Type -Path (Join-Path $sdkPath 'UniwillSdkClient.dll')";
    let state_marker = "  $state = $client.GetCurrentState()";
    vendor_status_script()
        .replace(sdk_marker, &format!("{sdk_marker}\n{values}"))
        .replace(
            state_marker,
            &format!(
                "{operation}\n  # A write can close the service's WCF session. Use a fresh client for readback.\n  $client.Abort()\n  $client = [UniwillSdkClient.UniwillService.UniwillServiceClient]::new($context, $binding, $address)\n{state_marker}"
            ),
        )
}

#[cfg(windows)]
fn apply_vendor_passive_cooling_blocking(enabled: bool) -> Result<VendorServiceStatus, String> {
    crate::plug::fan::with_vendor_fan_operation(|| {
        // The original setter passes !enabled to DisablePassiveCoolingMode.
        let disable = if enabled { "$false" } else { "$true" };
        let script = vendor_mutation_script(
            &format!("$targetDisablePassive = {disable}"),
            "  $client.DisablePassiveCoolingMode($targetDisablePassive)",
        );
        let stdout = run_powershell_json(&script, VENDOR_WRITE_TIMEOUT)?;
        let data: Value = serde_json::from_str(&stdout)
            .map_err(|e| format!("failed to parse passive cooling response: {e}"))?;
        let verified = data.pointer("/currentState/passiveCooling").and_then(Value::as_bool) == Some(enabled);
        if verified { crate::plug::fan::set_vendor_passive_active(enabled); }
        Ok(VendorServiceStatus {
            ok: verified,
            detail: if verified { "Passive cooling confirmed by official service readback" } else { "Passive cooling request was not confirmed by readback" }.to_string(),
            data,
        })
    })
}

#[cfg(windows)]
fn restore_vendor_performance_defaults_blocking() -> Result<VendorServiceStatus, String> {
    crate::plug::fan::with_vendor_fan_operation(|| {
        let operation = r#"  $indices = @(
    [UniwillSdkClient.UniwillService.ProfileIndex]::Performance,
    [UniwillSdkClient.UniwillService.ProfileIndex]::Balanced,
    [UniwillSdkClient.UniwillService.ProfileIndex]::BatterySaver
  )
  $defaults = @($client.GetDefaultProfiles())
  $current = @($client.GetCurrentProfiles())
  $selected = $client.GetCurrentState().SelectedProfileIndex
  if ($defaults.Count -ne 3 -or $current.Count -ne 3 -or $selected -notin $indices) {
    throw 'Vendor profiles or selected profile are incomplete; no reset was sent'
  }
  foreach ($index in $indices) {
    if (@($defaults | Where-Object { $_.Index -eq $index }).Count -ne 1 -or
        @($current | Where-Object { $_.Index -eq $index }).Count -ne 1) {
      throw 'Vendor profile indices are not unique; no reset was sent'
    }
  }
  foreach ($index in $indices) {
    $profile = @($defaults | Where-Object { $_.Index -eq $index })[0]
    $client.UpdateProfile($index, $profile.AC, $profile.DC)
    $client.Abort()
    $client = [UniwillSdkClient.UniwillService.UniwillServiceClient]::new($context, $binding, $address)
  }
  $client.ApplyProfile($selected)"#;
        let stdout = run_powershell_json(&vendor_mutation_script("", operation), VENDOR_RESET_TIMEOUT)?;
        let data: Value = serde_json::from_str(&stdout)
            .map_err(|e| format!("failed to parse performance reset response: {e}"))?;
        let current = data.get("currentProfiles").filter(|v| v.is_object());
        let defaults = data.get("defaultProfiles").filter(|v| v.is_object());
        let verified = match (current, defaults) {
            (Some(current), Some(defaults)) => ["Performance", "Balanced", "BatterySaver"].iter().all(|key| {
                current.get(*key).filter(|v| v.is_object() && v.get("error").is_none())
                    == defaults.get(*key).filter(|v| v.is_object() && v.get("error").is_none())
                    && current.get(*key).is_some()
            }),
            _ => false,
        };
        Ok(VendorServiceStatus {
            ok: verified,
            detail: if verified { "All three vendor profiles match the service defaults" } else { "Reset may be partially applied; one or more vendor profiles did not match the defaults" }.to_string(),
            data,
        })
    })
}

#[cfg(windows)]
fn vendor_profile_write_target(
    index: i64,
    source: &str,
    cpu: i64,
    dgpu: i64,
) -> Result<(&'static str, &'static str), String> {
    let key = match index {
        1 => "Performance",
        2 => "Balanced",
        3 => "BatterySaver",
        _ => return Err("厂商性能配置仅接受索引 1、2、3".to_string()),
    };
    let source = match source {
        "ac" => "ac",
        "dc" => "dc",
        _ => return Err("供电侧仅接受 ac 或 dc".to_string()),
    };
    if !(1..=3).contains(&cpu) || !(1..=3).contains(&dgpu) {
        return Err("CPU 和独显模式仅接受官方服务编号 1、2、3".to_string());
    }
    Ok((key, source))
}

#[cfg(windows)]
fn vendor_profile_write_confirmed(
    data: &Value,
    key: &str,
    source: &str,
    cpu: i64,
    dgpu: i64,
) -> bool {
    if data.get("connected").and_then(Value::as_bool) != Some(true) {
        return false;
    }
    let other = if source == "ac" { "dc" } else { "ac" };
    let before = &data["profileWrite"]["before"];
    let after = &data["currentProfiles"][key];
    let other_profiles_unchanged = ["Performance", "Balanced", "BatterySaver"]
        .iter()
        .filter(|candidate| **candidate != key)
        .all(|candidate| {
            data["profileWrite"]["beforeProfiles"][*candidate].is_object()
                && data["currentProfiles"][*candidate]
                    == data["profileWrite"]["beforeProfiles"][*candidate]
        });
    let expected_cpu = cpu.to_string();
    let expected_dgpu = dgpu.to_string();
    other_profiles_unchanged
        && data["profileWrite"]["selected"].is_string()
        && data["currentState"]["selectedProfile"] == data["profileWrite"]["selected"]
        && before[source]["fan"].is_string()
        && before[other].is_object()
        && after[source]["cpu"].as_str() == Some(expected_cpu.as_str())
        && after[source]["dgpu"].as_str() == Some(expected_dgpu.as_str())
        && after[source]["fan"] == before[source]["fan"]
        && after[other] == before[other]
}

#[cfg(windows)]
fn update_vendor_performance_profile_blocking(
    index: i64,
    source: String,
    cpu: i64,
    dgpu: i64,
) -> Result<VendorServiceStatus, String> {
    let (key, source) = vendor_profile_write_target(index, &source, cpu, dgpu)?;
    crate::plug::fan::with_vendor_fan_operation(|| {
        let values = format!(
            "$targetIndex = [UniwillSdkClient.UniwillService.ProfileIndex]::{key}\n$targetSource = '{source}'\n$targetCpu = {cpu}\n$targetDGpu = {dgpu}"
        );
        let operation = r#"  $indices = @(
    [UniwillSdkClient.UniwillService.ProfileIndex]::Performance,
    [UniwillSdkClient.UniwillService.ProfileIndex]::Balanced,
    [UniwillSdkClient.UniwillService.ProfileIndex]::BatterySaver
  )
  $profiles = @($client.GetCurrentProfiles())
  $selected = $client.GetCurrentState().SelectedProfileIndex
  if ($profiles.Count -ne 3 -or $selected -notin $indices) {
    throw 'Vendor profiles or selected profile are incomplete; no update was sent'
  }
  foreach ($index in $indices) {
    if (@($profiles | Where-Object { $_.Index -eq $index }).Count -ne 1) {
      throw 'Vendor profile indices are not unique; no update was sent'
    }
  }
  $profile = @($profiles | Where-Object { $_.Index -eq $targetIndex })[0]
  if ($null -eq $profile.AC -or $null -eq $profile.DC) {
    throw 'Vendor AC/DC profile is incomplete; no update was sent'
  }
  $before = ProfileObject $profile
  $beforeProfiles = ProfilesObject $profiles
  $mode = if ($targetSource -eq 'ac') { $profile.AC } else { $profile.DC }
  $mode.CpuMode = $targetCpu
  $mode.DGpuMode = $targetDGpu
  # UpdateProfile requires both full PerformanceMode objects. FanMode is not edited.
  $client.UpdateProfile($targetIndex, $profile.AC, $profile.DC)
  $client.Abort()
  $client = [UniwillSdkClient.UniwillService.UniwillServiceClient]::new($context, $binding, $address)
  if ($selected -eq $targetIndex) {
    $client.ApplyProfile($selected)
    $client.Abort()
    $client = [UniwillSdkClient.UniwillService.UniwillServiceClient]::new($context, $binding, $address)
  }
  $result.profileWrite = [pscustomobject]@{
    before = $before
    beforeProfiles = $beforeProfiles
    selected = TextOrNull $selected
    applied = ($selected -eq $targetIndex)
  }"#;
        let stdout = run_powershell_json(&vendor_mutation_script(&values, operation), VENDOR_WRITE_TIMEOUT)?;
        let data: Value = serde_json::from_str(&stdout)
            .map_err(|e| format!("failed to parse performance profile response: {e}"))?;
        let verified = vendor_profile_write_confirmed(&data, key, source, cpu, dgpu);
        Ok(VendorServiceStatus {
            ok: verified,
            detail: if verified {
                if data.pointer("/profileWrite/applied").and_then(Value::as_bool) == Some(true) {
                    "Vendor AC/DC CPU and GPU settings saved, applied and read back; vendor fan setting unchanged"
                } else {
                    "Vendor AC/DC CPU and GPU settings saved and read back; this profile is not currently active"
                }
            } else {
                "Vendor profile update was not fully confirmed; check the current profile and fan fields before retrying"
            }.to_string(),
            data,
        })
    })
}

#[cfg(windows)]
fn apply_vendor_osd_blocking(enabled: bool) -> Result<VendorOsdApplyResult, String> {
    let value = if enabled { "$true" } else { "$false" };
    let script = vendor_mutation_script(
        &format!("$targetOsd = {value}"),
        "  $null = $client.EnableOnScreenDisplay($targetOsd)",
    );
    let stdout = run_powershell_json(&script, VENDOR_WRITE_TIMEOUT)?;
    let data = serde_json::from_str::<Value>(&stdout)
        .map_err(|e| format!("failed to parse vendor OSD JSON: {e}"))?;
    let connected = data.get("connected").and_then(Value::as_bool) == Some(true);
    Ok(VendorOsdApplyResult {
        enabled,
        status: VendorServiceStatus {
            ok: connected,
            detail: "On-screen display request sent; the service has no state readback".to_string(),
            data,
        },
    })
}

#[cfg(windows)]
fn apply_vendor_keyboard_color_blocking(
    r: i64,
    g: i64,
    b: i64,
) -> Result<VendorKeyboardColorApplyResult, String> {
    let (r, g, b) = (
        r.clamp(0, MAX_RGB_CHANNEL),
        g.clamp(0, MAX_RGB_CHANNEL),
        b.clamp(0, MAX_RGB_CHANNEL),
    );
    let script = vendor_mutation_script(
        &format!("$targetR = {r}\n$targetG = {g}\n$targetB = {b}"),
        r#"  $profile = $client.GetCurrentKeyboardLedProfile()
  $color = [UniwillSdkClient.UniwillService.RGB]::new()
  $color.R = [byte]$targetR
  $color.G = [byte]$targetG
  $color.B = [byte]$targetB
  $profile.Effect = [UniwillSdkClient.UniwillService.RGBKeyboardEffect]::Monocolor
  $profile.Direction = [UniwillSdkClient.UniwillService.RGBKeyboardDirection]::None
  $profile.Speed = 0
  $profile.ColorLength = 1
  $profile.Color = @($color)
  $client.ApplyKeyboardLedProfile($profile)"#,
    );
    let stdout = run_powershell_json(&script, VENDOR_WRITE_TIMEOUT)?;
    let data = serde_json::from_str::<Value>(&stdout)
        .map_err(|e| format!("failed to parse vendor keyboard color JSON: {e}"))?;
    let current = data
        .pointer("/lighting/keyboard/colors/0")
        .ok_or_else(|| "keyboard color readback is unavailable".to_string())?;
    let verified = data
        .pointer("/lighting/keyboard/effect")
        .and_then(Value::as_str)
        == Some("Monocolor")
        && current.get("r").and_then(Value::as_i64) == Some(r)
        && current.get("g").and_then(Value::as_i64) == Some(g)
        && current.get("b").and_then(Value::as_i64) == Some(b);
    Ok(VendorKeyboardColorApplyResult {
        r,
        g,
        b,
        verified,
        status: VendorServiceStatus {
            ok: verified,
            detail: if verified {
                "Keyboard color confirmed by Uniwill service".to_string()
            } else {
                "Keyboard color request was not confirmed by service readback".to_string()
            },
            data,
        },
    })
}

#[cfg(windows)]
fn apply_vendor_lightbar_blocking(
    source: String,
    r: i64,
    g: i64,
    b: i64,
    breathing: bool,
) -> Result<VendorLightbarApplyResult, String> {
    let (setting_name, json_name) = match source.as_str() {
        "ac" => ("AcSetting", "ac"),
        "battery" => ("DcSetting", "dc"),
        _ => return Err(format!("unknown lightbar power source: {source}")),
    };
    let (r, g, b) = (
        r.clamp(0, MAX_LIGHT_BRIGHTNESS),
        g.clamp(0, MAX_LIGHT_BRIGHTNESS),
        b.clamp(0, MAX_LIGHT_BRIGHTNESS),
    );
    let breathing_value = if breathing { "$true" } else { "$false" };
    let script = vendor_mutation_script(
        &format!(
            "$targetR = {r}\n$targetG = {g}\n$targetB = {b}\n$targetBreathing = {breathing_value}"
        ),
        &format!(
            "  $profile = $client.GetCurrentLightbarProfile()\n  $profile.{setting_name}.Effect = [UniwillSdkClient.UniwillService.LightBarEffect]::Monocolor\n  $profile.{setting_name}.R_Brightness = $targetR\n  $profile.{setting_name}.G_Brightness = $targetG\n  $profile.{setting_name}.B_Brightness = $targetB\n  $profile.BreathingEnable = $targetBreathing\n  $client.SetLightbarProfile($profile)"
        ),
    );
    let stdout = run_powershell_json(&script, VENDOR_WRITE_TIMEOUT)?;
    let data = serde_json::from_str::<Value>(&stdout)
        .map_err(|e| format!("failed to parse vendor lightbar JSON: {e}"))?;
    let setting = data
        .pointer(&format!("/lighting/lightbar/{json_name}"))
        .ok_or_else(|| "lightbar readback is unavailable".to_string())?;
    let verified = setting.get("effect").and_then(Value::as_str) == Some("Monocolor")
        && setting.get("r").and_then(Value::as_i64) == Some(r)
        && setting.get("g").and_then(Value::as_i64) == Some(g)
        && setting.get("b").and_then(Value::as_i64) == Some(b)
        && data
            .pointer("/lighting/lightbar/breathing")
            .and_then(Value::as_bool)
            == Some(breathing);
    Ok(VendorLightbarApplyResult {
        source,
        r,
        g,
        b,
        breathing,
        verified,
        status: VendorServiceStatus {
            ok: verified,
            detail: if verified {
                "Lightbar settings confirmed by Uniwill service".to_string()
            } else {
                "Lightbar request was not confirmed by service readback".to_string()
            },
            data,
        },
    })
}

#[cfg(windows)]
fn valid_vendor_lightbar_profile(profile: &VendorLightbarProfileInput) -> bool {
    [&profile.ac, &profile.dc].iter().all(|setting| {
        ["Monocolor", "Rainbow"].contains(&setting.effect.as_str())
            && [setting.r, setting.g, setting.b].iter().all(|channel| (0..=100).contains(channel))
    })
}

#[cfg(windows)]
fn apply_vendor_lightbar_profile_blocking(
    profile: VendorLightbarProfileInput,
) -> Result<VendorServiceStatus, String> {
    if !valid_vendor_lightbar_profile(&profile) {
        return Err("光条配置只接受单色/彩虹与 0–100 的 RGB 值".to_string());
    }
    let breathing = if profile.breathing { "$true" } else { "$false" };
    let values = format!(
        "$acEffect = [UniwillSdkClient.UniwillService.LightBarEffect]::{ac_effect}\n$dcEffect = [UniwillSdkClient.UniwillService.LightBarEffect]::{dc_effect}\n$acR = {ac_r}\n$acG = {ac_g}\n$acB = {ac_b}\n$dcR = {dc_r}\n$dcG = {dc_g}\n$dcB = {dc_b}\n$breathing = {breathing}",
        ac_effect = profile.ac.effect,
        dc_effect = profile.dc.effect,
        ac_r = profile.ac.r, ac_g = profile.ac.g, ac_b = profile.ac.b,
        dc_r = profile.dc.r, dc_g = profile.dc.g, dc_b = profile.dc.b,
    );
    let script = vendor_mutation_script(
        &values,
        r#"  $profile = $client.GetCurrentLightbarProfile()
  if ($null -eq $profile -or $null -eq $profile.AcSetting -or $null -eq $profile.DcSetting) {
    throw 'Lightbar AC/DC profile is incomplete; no update was sent'
  }
  $profile.AcSetting.Effect = $acEffect
  $profile.AcSetting.R_Brightness = $acR
  $profile.AcSetting.G_Brightness = $acG
  $profile.AcSetting.B_Brightness = $acB
  $profile.DcSetting.Effect = $dcEffect
  $profile.DcSetting.R_Brightness = $dcR
  $profile.DcSetting.G_Brightness = $dcG
  $profile.DcSetting.B_Brightness = $dcB
  $profile.BreathingEnable = $breathing
  $client.SetLightbarProfile($profile)"#,
    );
    let stdout = run_powershell_json(&script, VENDOR_RESET_TIMEOUT)?;
    let data: Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("failed to parse full lightbar profile response: {e}"))?;
    let actual = data.pointer("/lighting/lightbar");
    let matches = |source: &str, target: &VendorLightbarSettingInput| {
        let setting = actual.and_then(|item| item.get(source));
        setting.and_then(|value| value.get("effect")).and_then(Value::as_str) == Some(target.effect.as_str())
            && setting.and_then(|value| value.get("r")).and_then(Value::as_i64) == Some(target.r)
            && setting.and_then(|value| value.get("g")).and_then(Value::as_i64) == Some(target.g)
            && setting.and_then(|value| value.get("b")).and_then(Value::as_i64) == Some(target.b)
    };
    let verified = matches("ac", &profile.ac) && matches("dc", &profile.dc)
        && actual.and_then(|value| value.get("breathing")).and_then(Value::as_bool) == Some(profile.breathing);
    Ok(VendorServiceStatus {
        ok: verified,
        detail: if verified { "Both lightbar power settings and breathing state confirmed by service readback" }
            else { "Lightbar switch request was not fully confirmed by service readback" }.to_string(),
        data,
    })
}

#[cfg(windows)]
fn apply_vendor_aux_setting_blocking(
    kind: String,
    source: String,
    value: i64,
) -> Result<VendorAuxApplyResult, String> {
    let (source_key, ac_flag) = match source.as_str() {
        "ac" => ("ac", "$true"),
        "battery" => ("dc", "$false"),
        _ => return Err(format!("unknown power source: {source}")),
    };
    // The keyboard timer is a 0..13 selector in the original client. The
    // lightbar timer is seconds; keep its write bounded to one hour.
    let (method, readback_path, maximum) = match kind.as_str() {
        "keyboardBrightness" => ("SetKeyboardBrightness", "keyboardBrightness", 100),
        "keyboardIdleTimer" => ("SetIdleTimerValue", "keyboardIdleTimer", 13),
        "lightbarIdleTimer" => ("SetLightBarIdleTimerValue", "lightbarIdleTimer", 3600),
        _ => return Err(format!("unknown vendor setting: {kind}")),
    };
    if !(0..=maximum).contains(&value) {
        return Err(format!("{kind} value must be within 0..={maximum}"));
    }
    let script = vendor_mutation_script(
        &format!("$targetValue = {value}\n$targetAc = {ac_flag}"),
        &format!("  $client.{method}($targetValue, $targetAc)"),
    );
    let stdout = run_powershell_json(&script, VENDOR_WRITE_TIMEOUT)?;
    let data = serde_json::from_str::<Value>(&stdout)
        .map_err(|e| format!("failed to parse {kind} JSON: {e}"))?;
    let actual = data
        .pointer(&format!("/{readback_path}/{source_key}"))
        .and_then(Value::as_i64);
    let verified = actual == Some(value);
    Ok(VendorAuxApplyResult {
        source,
        value,
        verified,
        status: VendorServiceStatus {
            ok: verified,
            detail: if verified {
                format!("{kind} confirmed by service readback")
            } else {
                format!("{kind} request not confirmed; readback={actual:?}")
            },
            data,
        },
    })
}

#[cfg(windows)]
fn apply_vendor_keyboard_effect_blocking(
    effect: String,
    direction: String,
    speed: i64,
) -> Result<VendorKeyboardEffectApplyResult, String> {
    const EFFECTS: &[&str] = &[
        "Monocolor", "Breathing", "Wave", "Reactive", "Rainbow", "Ripple",
        "Raindrop", "Marquee", "Aurora", "Spark", "Music", "UserMode", "GamingMode",
    ];
    const DIRECTIONS: &[&str] = &[
        "None", "Right", "Left", "Up", "Down", "Auto", "PressAnyKey",
    ];
    if !EFFECTS.contains(&effect.as_str()) {
        return Err(format!("unsupported keyboard effect: {effect}"));
    }
    if !DIRECTIONS.contains(&direction.as_str()) || !(0..=9).contains(&speed) {
        return Err("keyboard direction or speed is outside the supported range".to_string());
    }
    let script = vendor_mutation_script(
        &format!("$targetEffect = [UniwillSdkClient.UniwillService.RGBKeyboardEffect]::{effect}\n$targetDirection = [UniwillSdkClient.UniwillService.RGBKeyboardDirection]::{direction}\n$targetSpeed = {speed}"),
        "  $profile = $client.GetCurrentKeyboardLedProfile()\n  $profile.Effect = $targetEffect\n  $profile.Direction = $targetDirection\n  $profile.Speed = $targetSpeed\n  $client.ApplyKeyboardLedProfile($profile)",
    );
    let stdout = run_powershell_json(&script, VENDOR_WRITE_TIMEOUT)?;
    let data: Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("failed to parse keyboard effect response: {e}"))?;
    let current = data.pointer("/lighting/keyboard");
    let verified = current.and_then(|v| v.get("effect")).and_then(Value::as_str) == Some(effect.as_str())
        && current.and_then(|v| v.get("direction")).and_then(Value::as_str) == Some(direction.as_str())
        && current.and_then(|v| v.get("speed")).and_then(Value::as_i64) == Some(speed);
    Ok(VendorKeyboardEffectApplyResult {
        effect, direction, speed, verified,
        status: VendorServiceStatus {
            ok: verified,
            detail: if verified { "Keyboard effect confirmed by service readback".to_string() } else { "Keyboard effect request was not confirmed by service readback".to_string() },
            data,
        },
    })
}

#[cfg(windows)]
fn apply_vendor_key_colors_blocking(
    indices: Vec<usize>,
    r: i64,
    g: i64,
    b: i64,
) -> Result<VendorServiceStatus, String> {
    if indices.is_empty() || indices.len() > 126 || indices.iter().any(|index| *index >= 126) {
        return Err("expected 1..126 keyboard LED indices within 0..125".to_string());
    }
    let mut unique = indices.clone();
    unique.sort_unstable();
    unique.dedup();
    if unique.len() != indices.len() {
        return Err("duplicate keyboard LED indices are not allowed".to_string());
    }
    if !(0..=255).contains(&r) || !(0..=255).contains(&g) || !(0..=255).contains(&b) {
        return Err("keyboard RGB channels must be within 0..255".to_string());
    }
    let indices_text = indices.iter().map(usize::to_string).collect::<Vec<_>>().join(",");
    let script = vendor_mutation_script(
        &format!("$targetIndices = @({indices_text})\n$targetR = {r}\n$targetG = {g}\n$targetB = {b}"),
        r#"  $profile = $client.GetCurrentKeyboardLedProfile()
  if ($null -eq $profile.KeyColor -or $profile.KeyColor.Length -ne 126) { throw 'This device did not return the expected 126 per-key LED slots' }
  if ($profile.Effect -ne [UniwillSdkClient.UniwillService.RGBKeyboardEffect]::UserMode) {
    $hasCustomColors = @($profile.KeyColor | Where-Object { $_.R -ne 0 -or $_.G -ne 0 -or $_.B -ne 0 }).Count -gt 0
    if (-not $hasCustomColors -and @($profile.Color).Count -gt 0) {
      $base = $profile.Color[0]
      for ($i = 0; $i -lt 126; $i++) {
        $fill = [UniwillSdkClient.UniwillService.RGB]::new()
        $fill.R = [byte]$base.R; $fill.G = [byte]$base.G; $fill.B = [byte]$base.B
        $profile.KeyColor[$i] = $fill
      }
    }
  }
  foreach ($index in $targetIndices) {
    $color = [UniwillSdkClient.UniwillService.RGB]::new()
    $color.R = [byte]$targetR; $color.G = [byte]$targetG; $color.B = [byte]$targetB
    $profile.KeyColor[[int]$index] = $color
  }
  $profile.Effect = [UniwillSdkClient.UniwillService.RGBKeyboardEffect]::UserMode
  $result.keyColorExpected = @($profile.KeyColor | ForEach-Object {
    [pscustomobject]@{ r = [int]$_.R; g = [int]$_.G; b = [int]$_.B }
  })
  $client.ApplyKeyboardLedProfile($profile)"#,
    );
    let stdout = run_powershell_json(&script, VENDOR_WRITE_TIMEOUT)?;
    let data: Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("failed to parse per-key color response: {e}"))?;
    let key_colors = data.pointer("/lighting/keyboard/keyColors").and_then(Value::as_array);
    let expected = data.get("keyColorExpected").and_then(Value::as_array);
    let verified = data.pointer("/lighting/keyboard/effect").and_then(Value::as_str) == Some("UserMode")
        && key_colors.zip(expected).is_some_and(|(colors, before)| {
            colors.len() == 126 && before.len() == 126 && colors == before
                && indices.iter().all(|index| colors.get(*index).is_some_and(|color| {
                    color.get("r").and_then(Value::as_i64) == Some(r)
                        && color.get("g").and_then(Value::as_i64) == Some(g)
                        && color.get("b").and_then(Value::as_i64) == Some(b)
                }))
        });
    Ok(VendorServiceStatus {
        ok: verified,
        detail: if verified {
            "Per-key colors and UserMode confirmed by service readback".to_string()
        } else {
            "Per-key request was not confirmed by service readback".to_string()
        },
        data,
    })
}

#[cfg(windows)]
fn apply_vendor_key_palette_blocking(colors: Vec<VendorRgb>) -> Result<VendorServiceStatus, String> {
    if colors.len() != 126 || colors.iter().any(|color| {
        !(0..=255).contains(&color.r)
            || !(0..=255).contains(&color.g)
            || !(0..=255).contains(&color.b)
    }) {
        return Err("逐键配置必须包含 126 个 0–255 RGB 灯位".to_string());
    }
    let hex = colors.iter().map(|color| {
        format!("{:02X}{:02X}{:02X}", color.r, color.g, color.b)
    }).collect::<Vec<_>>().join(",");
    let script = vendor_mutation_script(
        &format!("$targetColors = '{hex}'.Split(',')"),
        r#"  $profile = $client.GetCurrentKeyboardLedProfile()
  if ($null -eq $profile.KeyColor -or $profile.KeyColor.Length -ne 126) {
    throw 'This device did not return the expected 126 per-key LED slots'
  }
  for ($i = 0; $i -lt 126; $i++) {
    $hex = $targetColors[$i]
    $color = [UniwillSdkClient.UniwillService.RGB]::new()
    $color.R = [byte]::Parse($hex.Substring(0, 2), [System.Globalization.NumberStyles]::HexNumber)
    $color.G = [byte]::Parse($hex.Substring(2, 2), [System.Globalization.NumberStyles]::HexNumber)
    $color.B = [byte]::Parse($hex.Substring(4, 2), [System.Globalization.NumberStyles]::HexNumber)
    $profile.KeyColor[$i] = $color
  }
  $profile.Effect = [UniwillSdkClient.UniwillService.RGBKeyboardEffect]::UserMode
  $client.ApplyKeyboardLedProfile($profile)"#,
    );
    let stdout = run_powershell_json(&script, VENDOR_RESET_TIMEOUT)?;
    let data: Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("failed to parse 126-key palette response: {e}"))?;
    let readback = data.pointer("/lighting/keyboard/keyColors").and_then(Value::as_array);
    let verified = data.pointer("/lighting/keyboard/effect").and_then(Value::as_str) == Some("UserMode")
        && readback.is_some_and(|actual| actual.len() == 126 && actual.iter().zip(&colors).all(|(value, expected)| {
            value.get("r").and_then(Value::as_i64) == Some(expected.r)
                && value.get("g").and_then(Value::as_i64) == Some(expected.g)
                && value.get("b").and_then(Value::as_i64) == Some(expected.b)
        }));
    Ok(VendorServiceStatus {
        ok: verified,
        detail: if verified {
            "All 126 keyboard LED colors and UserMode confirmed by service readback"
        } else {
            "Keyboard palette was not fully confirmed; refresh hardware state before retrying"
        }.to_string(),
        data,
    })
}

#[cfg(windows)]
fn apply_vendor_lightbar_effect_blocking(
    source: String,
    effect: String,
) -> Result<VendorLightbarEffectApplyResult, String> {
    let (setting_name, json_name) = match source.as_str() {
        "ac" => ("AcSetting", "ac"),
        "battery" => ("DcSetting", "dc"),
        _ => return Err(format!("unknown lightbar power source: {source}")),
    };
    if effect != "Monocolor" && effect != "Rainbow" {
        return Err(format!("unsupported lightbar effect: {effect}"));
    }
    let script = vendor_mutation_script(
        &format!("$targetEffect = [UniwillSdkClient.UniwillService.LightBarEffect]::{effect}"),
        &format!("  $profile = $client.GetCurrentLightbarProfile()\n  $profile.{setting_name}.Effect = $targetEffect\n  $client.SetLightbarProfile($profile)"),
    );
    let stdout = run_powershell_json(&script, VENDOR_WRITE_TIMEOUT)?;
    let data: Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("failed to parse lightbar effect response: {e}"))?;
    let verified = data.pointer(&format!("/lighting/lightbar/{json_name}/effect"))
        .and_then(Value::as_str) == Some(effect.as_str());
    Ok(VendorLightbarEffectApplyResult {
        source, effect, verified,
        status: VendorServiceStatus {
            ok: verified,
            detail: if verified { "Lightbar effect confirmed by service readback".to_string() } else { "Lightbar effect request was not confirmed by service readback".to_string() },
            data,
        },
    })
}

#[cfg(windows)]
fn apply_vendor_custom_display_blocking(
    brightness_ac: i64,
    brightness_dc: i64,
    color_temp: i64,
    contrast: i64,
    red: i64,
    green: i64,
    blue: i64,
) -> Result<VendorCustomDisplayApplyResult, String> {
    let brightness_ac = brightness_ac.clamp(0, 100);
    let brightness_dc = brightness_dc.clamp(0, 100);
    let color_temp = color_temp.clamp(4000, 7500);
    let contrast = contrast.clamp(0, 100);
    let red = red.clamp(0, 255);
    let green = green.clamp(0, 255);
    let blue = blue.clamp(0, 255);
    let variables = format!(
        "$targetBrightnessAc = {brightness_ac}\n$targetBrightnessDc = {brightness_dc}\n$targetColorTemp = {color_temp}\n$targetContrast = {contrast}\n$targetRed = {red}\n$targetGreen = {green}\n$targetBlue = {blue}"
    );
    let operation = r#"  $customModes = @($client.GetSavedDisplayModes() | Where-Object { $_.Type -eq [UniwillSdkClient.UniwillService.DisplayModeType]::Custom })
  if ($customModes.Count -ne 1) { throw 'The official service did not return one Custom display mode' }
  $custom = $customModes[0]
  $custom.BrightnessAC = [int]$targetBrightnessAc
  $custom.BrightnessDC = [int]$targetBrightnessDc
  $custom.ColorTemp = [int]$targetColorTemp
  $custom.Contrast = [single]$targetContrast
  $custom.Red = [int]$targetRed
  $custom.Green = [int]$targetGreen
  $custom.Blue = [int]$targetBlue
  $client.UpdateDisplayMode($custom)
  $client.Abort()
  $client = [UniwillSdkClient.UniwillService.UniwillServiceClient]::new($context, $binding, $address)
  $client.SetDisplayMode([int]$custom.Index)"#;
    let stdout = run_powershell_json(
        &vendor_mutation_script(&variables, operation),
        VENDOR_WRITE_TIMEOUT,
    )?;
    let data = serde_json::from_str::<Value>(&stdout)
        .map_err(|e| format!("failed to parse vendor custom display JSON: {e}"))?;
    let current = data
        .get("savedDisplayModes")
        .and_then(Value::as_array)
        .and_then(|modes| {
            modes
                .iter()
                .find(|mode| mode.get("type").and_then(Value::as_str) == Some("Custom"))
        })
        .ok_or_else(|| "Custom display profile readback is unavailable".to_string())?;
    let saved_profile_verified = current.get("brightnessAc").and_then(Value::as_i64)
        == Some(brightness_ac)
        && current.get("brightnessDc").and_then(Value::as_i64) == Some(brightness_dc)
        && current.get("colorTemp").and_then(Value::as_i64) == Some(color_temp)
        && current
            .get("contrast")
            .and_then(Value::as_f64)
            .is_some_and(|value| (value - contrast as f64).abs() < 0.1)
        && current.get("red").and_then(Value::as_i64) == Some(red)
        && current.get("green").and_then(Value::as_i64) == Some(green)
        && current.get("blue").and_then(Value::as_i64) == Some(blue);
    let profile_index = current.get("index").and_then(Value::as_i64).unwrap_or(-1) as i32;
    Ok(VendorCustomDisplayApplyResult {
        profile_index,
        saved_profile_verified,
        activation_requested: true,
        status: VendorServiceStatus {
            ok: saved_profile_verified,
            detail: if saved_profile_verified {
                "Custom display profile saved and read back; active mode has no readback"
                    .to_string()
            } else {
                "Custom display profile write was not confirmed by service readback".to_string()
            },
            data,
        },
    })
}

// MobileDisplayModeSettingsMgr.SetEnablingVariables in the installed MSIX:
// Standard=none, Gaming=all, Video=brightness+temperature,
// Reading=brightness+temperature+blue, Custom=all.
fn editable_preset_display_fields(mode: &str) -> Option<[bool; 7]> {
    match mode {
        "Gaming" => Some([true; 7]),
        "Video" => Some([true, true, true, false, false, false, false]),
        "Reading" => Some([true, true, true, false, false, false, true]),
        _ => None,
    }
}

#[cfg(windows)]
fn apply_vendor_preset_display_blocking(
    mode: String, brightness_ac: i64, brightness_dc: i64, color_temp: i64,
    contrast: i64, red: i64, green: i64, blue: i64,
) -> Result<VendorCustomDisplayApplyResult, String> {
    let mode = normalize_display_mode(&mode)
        .ok_or_else(|| format!("unknown vendor display mode: {mode}"))?;
    let editable = editable_preset_display_fields(mode)
        .ok_or_else(|| format!("{mode} has no editable preset parameters"))?;
    let requested = [brightness_ac, brightness_dc, color_temp, contrast, red, green, blue];
    let bounds = [(0, 100), (0, 100), (4000, 7500), (0, 100), (0, 255), (0, 255), (0, 255)];
    if requested.iter().zip(bounds).any(|(value, (min, max))| *value < min || *value > max) {
        return Err("display setting is outside the supported range".to_string());
    }
    let variables = format!(
        "$targetDisplayType = [UniwillSdkClient.UniwillService.DisplayModeType]::{mode}\n$targetBrightnessAc = {brightness_ac}\n$targetBrightnessDc = {brightness_dc}\n$targetColorTemp = {color_temp}\n$targetContrast = {contrast}\n$targetRed = {red}\n$targetGreen = {green}\n$targetBlue = {blue}"
    );
    let mut operation = String::from(r#"  $saved = @($client.GetSavedDisplayModes())
  $matches = @($saved | Where-Object { $_.Type -eq $targetDisplayType })
  if ($matches.Count -ne 1) { throw 'The official service did not return one matching display mode' }
  $target = $matches[0]
  $result.displayBefore = @($saved | ForEach-Object {
    [pscustomobject]@{ index = [int]$_.Index; type = $_.Type.ToString(); brightnessAc = [int]$_.BrightnessAC; brightnessDc = [int]$_.BrightnessDC; colorTemp = [int]$_.ColorTemp; contrast = [single]$_.Contrast; red = [int]$_.Red; green = [int]$_.Green; blue = [int]$_.Blue }
  })
"#);
    for (allowed, property, value) in [
        (editable[0], "BrightnessAC", "$targetBrightnessAc"),
        (editable[1], "BrightnessDC", "$targetBrightnessDc"),
        (editable[2], "ColorTemp", "$targetColorTemp"),
        (editable[3], "Contrast", "$targetContrast"),
        (editable[4], "Red", "$targetRed"),
        (editable[5], "Green", "$targetGreen"),
        (editable[6], "Blue", "$targetBlue"),
    ] {
        if allowed { operation.push_str(&format!("  $target.{property} = {value}\n")); }
    }
    operation.push_str(r#"  $client.UpdateDisplayMode($target)
  $client.Abort()
  $client = [UniwillSdkClient.UniwillService.UniwillServiceClient]::new($context, $binding, $address)
  $client.SetDisplayMode([int]$target.Index)"#);
    let stdout = run_powershell_json(&vendor_mutation_script(&variables, &operation), VENDOR_WRITE_TIMEOUT)?;
    let data: Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("failed to parse vendor preset display JSON: {e}"))?;
    let before = data.get("displayBefore").and_then(Value::as_array)
        .ok_or_else(|| "display preflight snapshot is unavailable".to_string())?;
    let after = data.get("savedDisplayModes").and_then(Value::as_array)
        .ok_or_else(|| "display profile readback is unavailable".to_string())?;
    let fields = ["brightnessAc", "brightnessDc", "colorTemp", "contrast", "red", "green", "blue"];
    let verified = data.get("connected").and_then(Value::as_bool) == Some(true)
        && before.len() == after.len()
        && before.iter().all(|old| {
            let Some(current) = after.iter().find(|item| item.get("index") == old.get("index") && item.get("type") == old.get("type")) else { return false; };
            let is_target = current.get("type").and_then(Value::as_str) == Some(mode);
            fields.iter().enumerate().all(|(index, key)| {
                if is_target && editable[index] {
                    current.get(*key).and_then(Value::as_f64)
                        .is_some_and(|value| (value - requested[index] as f64).abs() < 0.1)
                } else { current.get(*key) == old.get(*key) }
            })
        });
    let profile_index = after.iter().find(|item| item.get("type").and_then(Value::as_str) == Some(mode))
        .and_then(|item| item.get("index")).and_then(Value::as_i64).unwrap_or(-1) as i32;
    Ok(VendorCustomDisplayApplyResult {
        profile_index,
        saved_profile_verified: verified,
        activation_requested: true,
        status: VendorServiceStatus {
            ok: verified,
            detail: if verified { "Preset parameters saved and read back; active display mode has no readback" } else { "Preset parameters or untouched profiles were not confirmed by readback" }.to_string(),
            data,
        },
    })
}

#[cfg(windows)]
fn reset_vendor_display_mode_blocking(mode: String) -> Result<VendorServiceStatus, String> {
    let mode = normalize_display_mode(&mode)
        .ok_or_else(|| format!("unknown vendor display mode: {mode}"))?;
    let script = vendor_mutation_script(
        &format!("$targetDisplayType = [UniwillSdkClient.UniwillService.DisplayModeType]::{mode}"),
        r#"  $matches = @($client.GetSavedDisplayModes() | Where-Object { $_.Type -eq $targetDisplayType })
  if ($matches.Count -ne 1) { throw 'The official service did not return one matching display mode' }
  $client.RecoverDisplayMode([int]$matches[0].Index)"#,
    );
    let stdout = run_powershell_json(&script, VENDOR_WRITE_TIMEOUT)?;
    let data: Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("failed to parse vendor display reset response: {e}"))?;
    let saved = data.get("savedDisplayModes").and_then(Value::as_array)
        .and_then(|modes| modes.iter().find(|item| item.get("type").and_then(Value::as_str) == Some(mode)));
    let connected = data.get("connected").and_then(Value::as_bool) == Some(true);
    Ok(VendorServiceStatus {
        ok: connected && saved.is_some(),
        detail: if connected && saved.is_some() {
            "Display reset request sent and saved profile read back; factory values and active mode have no independent confirmation".to_string()
        } else {
            "Display reset request was not confirmed by service readback".to_string()
        },
        data,
    })
}

#[cfg(windows)]
fn vendor_lighting_script(
    r: i64,
    g: i64,
    b: i64,
    keyboard_brightness: i64,
    lightbar_brightness: i64,
    lightbar_breathing: bool,
) -> String {
    let light_r = r * lightbar_brightness / MAX_RGB_CHANNEL;
    let light_g = g * lightbar_brightness / MAX_RGB_CHANNEL;
    let light_b = b * lightbar_brightness / MAX_RGB_CHANNEL;
    let lightbar_breathing_ps = if lightbar_breathing {
        "$true"
    } else {
        "$false"
    };
    vendor_status_script()
        .replace(
            "Add-Type -Path (Join-Path $sdkPath 'UniwillSdkClient.dll')",
            &format!(
                "Add-Type -Path (Join-Path $sdkPath 'UniwillSdkClient.dll')\n$targetRgbR = {r}\n$targetRgbG = {g}\n$targetRgbB = {b}\n$targetKeyboardBrightness = {keyboard_brightness}\n$targetLightR = {light_r}\n$targetLightG = {light_g}\n$targetLightB = {light_b}\n$targetLightbarBreathing = {lightbar_breathing_ps}"
            ),
        )
        .replace(
            "  $state = $client.GetCurrentState()",
            r#"  $keyboardProfile = $client.GetCurrentKeyboardLedProfile()
  $keyboardColor = [UniwillSdkClient.UniwillService.RGB]::new()
  $keyboardColor.R = [byte]$targetRgbR
  $keyboardColor.G = [byte]$targetRgbG
  $keyboardColor.B = [byte]$targetRgbB
  $keyboardProfile.Effect = [UniwillSdkClient.UniwillService.RGBKeyboardEffect]::Monocolor
  $keyboardProfile.Direction = [UniwillSdkClient.UniwillService.RGBKeyboardDirection]::None
  $keyboardProfile.Speed = 0
  $keyboardProfile.ColorLength = 1
  $keyboardProfile.Color = @($keyboardColor)
  $keyboardProfile.Brightness_AC = $targetKeyboardBrightness
  $keyboardProfile.Brightness_DC = $targetKeyboardBrightness
  $client.EnableKeyboardLeds($true)
  $client.ApplyKeyboardLedProfile($keyboardProfile)

  $lightbarProfile = $client.GetCurrentLightbarProfile()
  $acSetting = [UniwillSdkClient.UniwillService.LightbarSetting]::new()
  $acSetting.Effect = [UniwillSdkClient.UniwillService.LightBarEffect]::Monocolor
  $acSetting.R_Brightness = $targetLightR
  $acSetting.G_Brightness = $targetLightG
  $acSetting.B_Brightness = $targetLightB
  $dcSetting = [UniwillSdkClient.UniwillService.LightbarSetting]::new()
  $dcSetting.Effect = [UniwillSdkClient.UniwillService.LightBarEffect]::Monocolor
  $dcSetting.R_Brightness = $targetLightR
  $dcSetting.G_Brightness = $targetLightG
  $dcSetting.B_Brightness = $targetLightB
  $lightbarProfile.BreathingEnable = $targetLightbarBreathing
  $lightbarProfile.AcSetting = $acSetting
  $lightbarProfile.DcSetting = $dcSetting
  $client.SetLightbarProfile($lightbarProfile)

  $result.connected = $true
  $result.lighting = [pscustomobject]@{
    keyboard = [pscustomobject]@{
      effect = 'Monocolor'
      direction = 'None'
      speed = 0
      brightnessAc = $targetKeyboardBrightness
      brightnessDc = $targetKeyboardBrightness
      colorLength = 1
      colors = @([pscustomobject]@{ r = $targetRgbR; g = $targetRgbG; b = $targetRgbB })
      keyColorCount = 0
    }
    lightbar = [pscustomobject]@{
      breathing = $targetLightbarBreathing
      ac = [pscustomobject]@{
        effect = 'Monocolor'
        r = $targetLightR
        g = $targetLightG
        b = $targetLightB
      }
      dc = [pscustomobject]@{
        effect = 'Monocolor'
        r = $targetLightR
        g = $targetLightG
        b = $targetLightB
      }
    }
  }
  $result | ConvertTo-Json -Depth 8 -Compress
  exit 0"#,
        )
}

#[cfg(windows)]
fn vendor_display_mode_script(mode: &str) -> String {
    vendor_status_script()
        .replace(
            "Add-Type -Path (Join-Path $sdkPath 'UniwillSdkClient.dll')",
            &format!(
                "Add-Type -Path (Join-Path $sdkPath 'UniwillSdkClient.dll')\n$targetDisplayModeType = [UniwillSdkClient.UniwillService.DisplayModeType]::{mode}"
            ),
        )
        .replace(
            "  $state = $client.GetCurrentState()",
            r#"  # SetDisplayMode takes the saved profile index, not the enum ordinal. Resolve
  # it from the service first so machines with reordered vendor profiles stay safe.
  $savedDisplayModes = @($client.GetSavedDisplayModes())
  $targetDisplayMode = @($savedDisplayModes | Where-Object { (TextOrNull $_.Type) -eq $targetDisplayModeType.ToString() } | Select-Object -First 1)
  if ($targetDisplayMode.Count -eq 0 -or $null -eq $targetDisplayMode[0]) {
    throw "The vendor service does not expose a saved $($targetDisplayModeType.ToString()) display profile. Open Intel NUC Software Studio once and save that mode before applying it here."
  }
  $client.SetDisplayMode([int]$targetDisplayMode[0].Index)
  Start-Sleep -Milliseconds 250
  $state = $client.GetCurrentState()"#,
        )
}

#[cfg(windows)]
fn read_vendor_status() -> VendorServiceStatus {
    match run_powershell_json(vendor_status_script(), VENDOR_STATUS_TIMEOUT) {
        Ok(stdout) => match serde_json::from_str::<Value>(&stdout) {
            Ok(data) => {
                let connected = data
                    .get("connected")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let sdk_found = data
                    .get("sdkFound")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                if connected && sdk_found {
                    if let Some(active) = data.pointer("/currentState/passiveCooling").and_then(Value::as_bool) {
                        crate::plug::fan::set_vendor_passive_active(active);
                    }
                }
                VendorServiceStatus {
                    ok: connected && sdk_found,
                    detail: if connected {
                        "Uniwill vendor service is reachable".to_string()
                    } else if data.get("processRunning").and_then(Value::as_bool) == Some(true) {
                        "UniwillService is running but its control endpoint is not responding; restart the official service and retry".to_string()
                    } else {
                        "UniwillService is not running; start the official service and retry".to_string()
                    },
                    data,
                }
            }
            Err(e) => VendorServiceStatus {
                ok: false,
                detail: format!("failed to parse vendor status JSON: {}", e),
                data: json!({ "raw": stdout }),
            },
        },
        Err(e) => VendorServiceStatus {
            ok: false,
            detail: e,
            data: Value::Null,
        },
    }
}

#[cfg(windows)]
fn apply_vendor_whisper_blocking(
    mode: String,
    fps: i64,
) -> Result<VendorWhisperApplyResult, String> {
    let normalized_mode =
        normalize_whisper_mode(&mode).ok_or_else(|| format!("unknown Whisper mode: {}", mode))?;
    let fps = fps.clamp(0, MAX_WHISPER_FPS);
    let script = vendor_whisper_script(normalized_mode, fps);

    let stdout = run_powershell_json(&script, VENDOR_WRITE_TIMEOUT)?;
    let data = serde_json::from_str::<Value>(&stdout)
        .map_err(|e| format!("failed to parse vendor Whisper JSON: {}", e))?;
    let connected = data
        .get("connected")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let sdk_found = data
        .get("sdkFound")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let confirmed = connected
        && sdk_found
        && data.pointer("/whisper/type").and_then(Value::as_str) == Some(normalized_mode)
        && data.pointer("/whisper/fps").and_then(Value::as_i64) == Some(fps);
    let status = VendorServiceStatus {
        ok: confirmed,
        detail: if confirmed {
            "Vendor Whisper settings confirmed by service readback".to_string()
        } else {
            "Vendor Whisper settings were not confirmed by service readback".to_string()
        },
        data,
    };

    Ok(VendorWhisperApplyResult {
        mode: normalized_mode.to_string(),
        fps,
        status,
    })
}

#[cfg(windows)]
fn apply_vendor_battery_blocking(
    mode: String,
    level: i64,
) -> Result<VendorBatteryApplyResult, String> {
    let normalized_mode = normalize_battery_mode(&mode)
        .ok_or_else(|| format!("unknown battery charge mode: {}", mode))?;
    let level = level.clamp(MIN_BATTERY_CHARGE_LEVEL, MAX_BATTERY_CHARGE_LEVEL);
    let script = vendor_battery_script(normalized_mode, level);

    let stdout = run_powershell_json(&script, VENDOR_WRITE_TIMEOUT)?;
    let data = serde_json::from_str::<Value>(&stdout)
        .map_err(|e| format!("failed to parse vendor battery JSON: {}", e))?;
    let confirmed = vendor_battery_confirmed(&data, normalized_mode, level);
    let status = VendorServiceStatus {
        ok: confirmed,
        detail: if confirmed {
            "Vendor battery mode and custom level confirmed by service readback".to_string()
        } else {
            "Vendor battery setting was not confirmed by service readback".to_string()
        },
        data,
    };

    Ok(VendorBatteryApplyResult {
        mode: normalized_mode.to_string(),
        level,
        status,
    })
}

#[cfg(windows)]
fn apply_vendor_lighting_blocking(
    r: i64,
    g: i64,
    b: i64,
    keyboard_brightness: i64,
    lightbar_brightness: i64,
    lightbar_breathing: bool,
) -> Result<VendorLightingApplyResult, String> {
    let r = r.clamp(0, MAX_RGB_CHANNEL);
    let g = g.clamp(0, MAX_RGB_CHANNEL);
    let b = b.clamp(0, MAX_RGB_CHANNEL);
    let keyboard_brightness = keyboard_brightness.clamp(0, MAX_LIGHT_BRIGHTNESS);
    let lightbar_brightness = lightbar_brightness.clamp(0, MAX_LIGHT_BRIGHTNESS);
    let script = vendor_lighting_script(
        r,
        g,
        b,
        keyboard_brightness,
        lightbar_brightness,
        lightbar_breathing,
    );

    let stdout = run_powershell_json(&script, VENDOR_WRITE_TIMEOUT)?;
    let data = serde_json::from_str::<Value>(&stdout)
        .map_err(|e| format!("failed to parse vendor lighting JSON: {}", e))?;
    let connected = data
        .get("connected")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let sdk_found = data
        .get("sdkFound")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let status = VendorServiceStatus {
        ok: connected && sdk_found,
        detail: if connected && sdk_found {
            "Vendor lighting settings applied".to_string()
        } else if connected {
            "Vendor service is reachable, but the lighting SDK was not found".to_string()
        } else {
            "Vendor lighting settings were not confirmed".to_string()
        },
        data,
    };

    Ok(VendorLightingApplyResult {
        r,
        g,
        b,
        keyboard_brightness,
        lightbar_brightness,
        lightbar_breathing,
        status,
    })
}

#[cfg(windows)]
fn apply_vendor_display_mode_via_sdk_blocking(
    mode: String,
) -> Result<VendorDisplayModeApplyResult, String> {
    let normalized_mode = normalize_display_mode(&mode)
        .ok_or_else(|| format!("unknown vendor display mode: {}", mode))?;
    let stdout = run_powershell_json(
        &vendor_display_mode_script(normalized_mode),
        VENDOR_WRITE_TIMEOUT,
    )?;
    let data = serde_json::from_str::<Value>(&stdout)
        .map_err(|e| format!("failed to parse vendor display mode JSON: {}", e))?;
    let connected = data
        .get("connected")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let sdk_found = data
        .get("sdkFound")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let display_mode = data.get("displayMode").cloned().unwrap_or(Value::Null);
    let confirmed_mode = display_mode.get("type").and_then(Value::as_str);
    if !connected
        || !sdk_found
        || !confirmed_mode.is_some_and(|current| current.eq_ignore_ascii_case(normalized_mode))
    {
        return Err(format!(
            "Vendor display mode write was not confirmed (requested {}, reported {})",
            normalized_mode,
            confirmed_mode.unwrap_or("unavailable")
        ));
    }

    Ok(VendorDisplayModeApplyResult {
        mode: normalized_mode.to_string(),
        display_mode,
        verified: true,
        transport: "vendor-sdk".to_string(),
        status: VendorServiceStatus {
            ok: true,
            detail: "Vendor display mode applied and verified".to_string(),
            data,
        },
    })
}

#[cfg(windows)]
fn apply_author_display_mode_bridge(mode: &str) -> Result<VendorDisplayModeApplyResult, String> {
    type WcfConnectFn = unsafe extern "system" fn() -> i32;
    type WcfDisconnectFn = unsafe extern "system" fn();
    type WcfEnableDisplayModeManagementFn = unsafe extern "system" fn(i32) -> i32;
    type WcfSetDisplayModeFn = unsafe extern "system" fn(i32) -> i32;

    let index = display_mode_index(mode)
        .ok_or_else(|| format!("no author bridge index for display mode: {}", mode))?;
    let _guard = try_vendor_command_lock()?;
    let bridge = author_display_bridge_status();
    if !bridge
        .get("available")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Err(bridge
            .get("detail")
            .and_then(Value::as_str)
            .unwrap_or("NUCtool display bridge is unavailable")
            .to_string());
    }
    let path = author_display_bridge_path()
        .ok_or_else(|| "NUCtool display bridge path is unavailable".to_string())?;

    // This is intentionally the same minimal call sequence used by the
    // upstream project: connect -> enable management -> set fixed mode index
    // -> disconnect. The DLL does not expose a reliable readback API, so the
    // result below is a dispatched request, never a claimed hardware readback.
    let (connect_code, management_code, set_code) = unsafe {
        let library = Library::new(&path)
            .map_err(|e| format!("failed to load NUCtool display bridge: {}", e))?;
        let connect: Symbol<WcfConnectFn> = library
            .get(b"wcf_connect")
            .map_err(|e| format!("NUCtool bridge missing wcf_connect: {}", e))?;
        let disconnect: Symbol<WcfDisconnectFn> = library
            .get(b"wcf_disconnect")
            .map_err(|e| format!("NUCtool bridge missing wcf_disconnect: {}", e))?;
        let enable_management: Symbol<WcfEnableDisplayModeManagementFn> = library
            .get(b"wcf_enable_display_mode_mgmt")
            .map_err(|e| format!("NUCtool bridge missing display management: {}", e))?;
        let set_display_mode: Symbol<WcfSetDisplayModeFn> = library
            .get(b"wcf_set_display_mode")
            .map_err(|e| format!("NUCtool bridge missing display mode setter: {}", e))?;

        let connect_code = connect();
        let management_code = enable_management(1);
        let set_code = set_display_mode(index);
        disconnect();
        (connect_code, management_code, set_code)
    };

    Ok(VendorDisplayModeApplyResult {
        mode: mode.to_string(),
        display_mode: Value::Null,
        verified: false,
        transport: "author-nuctool-bridge".to_string(),
        status: VendorServiceStatus {
            ok: true,
            detail: format!(
                "Author-compatible display request dispatched (connect={}, management={}, set={}); vendor readback is unavailable",
                connect_code, management_code, set_code
            ),
            data: json!({
                "displayBridge": bridge,
                "requestedMode": mode,
                "requestedIndex": index,
                "connectCode": connect_code,
                "managementCode": management_code,
                "setCode": set_code,
            }),
        },
    })
}

#[cfg(windows)]
fn apply_author_benchmark_mode_blocking(
    enabled: bool,
) -> Result<AuthorBenchmarkApplyResult, String> {
    type WcfConnectFn = unsafe extern "system" fn() -> i32;
    type WcfDisconnectFn = unsafe extern "system" fn();
    type WcfSetPowerPlanFn = unsafe extern "system" fn(i32) -> i32;
    type WcfApplyBenchmarkModeFn = unsafe extern "system" fn(i32) -> i32;

    let plan_index = author_benchmark_plan_index(enabled);
    let ((connect_code, benchmark_code, plan_code), bridge) =
        with_author_bridge("benchmark mode", |library| unsafe {
            let connect: Symbol<WcfConnectFn> =
                library.get(b"wcf_connect").map_err(|e| e.to_string())?;
            let disconnect: Symbol<WcfDisconnectFn> =
                library.get(b"wcf_disconnect").map_err(|e| e.to_string())?;
            let apply_benchmark: Symbol<WcfApplyBenchmarkModeFn> = library
                .get(b"wcf_apply_benchmark_mode")
                .map_err(|e| e.to_string())?;
            let set_power_plan: Symbol<WcfSetPowerPlanFn> = library
                .get(b"wcf_set_power_plan")
                .map_err(|e| e.to_string())?;
            let connect_code = connect();
            let benchmark_code = apply_benchmark(if enabled { 1 } else { 0 });
            // The user chose to leave plan 4 in place when disabling the flag.
            let plan_code = plan_index.map(|index| set_power_plan(index));
            disconnect();
            Ok((connect_code, benchmark_code, plan_code))
        })?;

    let dispatched = true;
    Ok(AuthorBenchmarkApplyResult {
        enabled,
        dispatched,
        power_plan_index: plan_index,
        status: VendorServiceStatus {
            // The DLL has no benchmark/plan readback. This only means the call
            // path returned; the UI must describe it as a request, not verified state.
            ok: dispatched,
            detail: format!(
                "NUCtool benchmark request dispatched (connect={}, benchmark={}, plan={:?}); hardware state is not readable",
                connect_code, benchmark_code, plan_code
            ),
            data: json!({
                "bridge": bridge,
                "connectCode": connect_code,
                "benchmarkCode": benchmark_code,
                "planCode": plan_code,
                "planIndex": plan_index,
                "verified": false,
            }),
        },
    })
}

#[cfg(windows)]
fn apply_author_power_profile_blocking(
    mode: String,
) -> Result<AuthorPowerProfileApplyResult, String> {
    type WcfConnectFn = unsafe extern "system" fn() -> i32;
    type WcfDisconnectFn = unsafe extern "system" fn();
    type WcfApplyProfileFn = unsafe extern "system" fn(i32) -> i32;
    type WcfApplyBenchmarkModeFn = unsafe extern "system" fn(i32) -> i32;
    type WcfReadIntFn = unsafe extern "system" fn() -> i32;

    let (normalized, profile_index) = author_power_profile(&mode)
        .ok_or_else(|| format!("unknown NUCtool bridge power profile: {}", mode))?;
    let ((connect_code, benchmark_code, profile_code, current_profile_index), bridge) =
        with_author_bridge("power profile", |library| unsafe {
            let connect: Symbol<WcfConnectFn> =
                library.get(b"wcf_connect").map_err(|e| e.to_string())?;
            let disconnect: Symbol<WcfDisconnectFn> =
                library.get(b"wcf_disconnect").map_err(|e| e.to_string())?;
            let apply_profile: Symbol<WcfApplyProfileFn> = library
                .get(b"wcf_apply_profile")
                .map_err(|e| e.to_string())?;
            let apply_benchmark: Symbol<WcfApplyBenchmarkModeFn> = library
                .get(b"wcf_apply_benchmark_mode")
                .map_err(|e| e.to_string())?;
            let get_current_profile: Symbol<WcfReadIntFn> = library
                .get(b"wcf_get_current_profile_index")
                .map_err(|e| e.to_string())?;
            let connect_code = connect();
            let benchmark_code = apply_benchmark(0);
            let profile_code = apply_profile(profile_index);
            let current_profile_index = get_current_profile();
            disconnect();
            Ok((
                connect_code,
                benchmark_code,
                profile_code,
                current_profile_index,
            ))
        })?;

    let current_profile_index = (current_profile_index >= 0).then_some(current_profile_index);
    let verified = current_profile_index == Some(profile_index);
    Ok(AuthorPowerProfileApplyResult {
        mode: normalized.to_string(),
        profile_index,
        benchmark_enabled: false,
        dispatched: true,
        verified,
        current_profile_index,
        status: VendorServiceStatus {
            ok: verified,
            detail: format!(
                "NUCtool profile request dispatched (connect={}, benchmark={}, profile={}); requested={}, readback={:?}, verified={}",
                connect_code, benchmark_code, profile_code, profile_index, current_profile_index, verified
            ),
            data: json!({
                "bridge": bridge,
                "connectCode": connect_code,
                "benchmarkCode": benchmark_code,
                "profileCode": profile_code,
                "requestedProfileIndex": profile_index,
                "currentProfileIndex": current_profile_index,
                "verified": verified,
                "powerPlanChanged": false,
            }),
        },
    })
}

#[cfg(windows)]
fn apply_author_power_plan_blocking(mode: String) -> Result<AuthorPowerPlanApplyResult, String> {
    type WcfConnectFn = unsafe extern "system" fn() -> i32;
    type WcfDisconnectFn = unsafe extern "system" fn();
    type WcfSetPowerPlanFn = unsafe extern "system" fn(i32) -> i32;

    let (normalized, power_plan_index) = author_power_plan_index(&mode)
        .ok_or_else(|| format!("unknown NUCtool bridge power plan: {}", mode))?;
    let ((connect_code, set_code), bridge) = with_author_bridge("power plan", |library| unsafe {
        let connect: Symbol<WcfConnectFn> =
            library.get(b"wcf_connect").map_err(|e| e.to_string())?;
        let disconnect: Symbol<WcfDisconnectFn> =
            library.get(b"wcf_disconnect").map_err(|e| e.to_string())?;
        let set_power_plan: Symbol<WcfSetPowerPlanFn> = library
            .get(b"wcf_set_power_plan")
            .map_err(|e| e.to_string())?;
        let connect_code = connect();
        let set_code = set_power_plan(power_plan_index);
        disconnect();
        Ok((connect_code, set_code))
    })?;

    Ok(AuthorPowerPlanApplyResult {
        mode: normalized.to_string(),
        power_plan_index,
        status: VendorServiceStatus {
            ok: true,
            detail: format!(
                "NUCtool bridge power plan dispatched (connect={}, set={})",
                connect_code, set_code
            ),
            data: json!({
                "bridge": bridge,
                "connectCode": connect_code,
                "setCode": set_code,
                "requestedIndex": power_plan_index,
            }),
        },
    })
}

#[cfg(windows)]
fn apply_author_battery_limit_blocking(level: i64) -> Result<AuthorBatteryApplyResult, String> {
    type WcfConnectFn = unsafe extern "system" fn() -> i32;
    type WcfDisconnectFn = unsafe extern "system" fn();
    type WcfSetBatteryChargingLevelFn = unsafe extern "system" fn(i32) -> i32;

    let level = level.clamp(MIN_BATTERY_CHARGE_LEVEL, MAX_BATTERY_CHARGE_LEVEL);
    let ((connect_code, set_code), bridge) =
        with_author_bridge("battery limit", |library| unsafe {
            let connect: Symbol<WcfConnectFn> =
                library.get(b"wcf_connect").map_err(|e| e.to_string())?;
            let disconnect: Symbol<WcfDisconnectFn> =
                library.get(b"wcf_disconnect").map_err(|e| e.to_string())?;
            let set_level: Symbol<WcfSetBatteryChargingLevelFn> = library
                .get(b"wcf_set_battery_charging_level")
                .map_err(|e| e.to_string())?;
            let connect_code = connect();
            let set_code = set_level(level as i32);
            disconnect();
            Ok((connect_code, set_code))
        })?;
    Ok(AuthorBatteryApplyResult {
        level,
        status: VendorServiceStatus {
            ok: true,
            detail: format!(
                "NUCtool bridge battery limit dispatched (connect={}, set={})",
                connect_code, set_code
            ),
            data: json!({ "bridge": bridge, "connectCode": connect_code, "setCode": set_code }),
        },
    })
}

#[cfg(windows)]
fn apply_author_keyboard_basic_blocking(
    enabled: bool,
    brightness: i64,
) -> Result<AuthorKeyboardApplyResult, String> {
    type WcfConnectFn = unsafe extern "system" fn() -> i32;
    type WcfDisconnectFn = unsafe extern "system" fn();
    type WcfEnableKeyboardLedsFn = unsafe extern "system" fn(i32) -> i32;
    type WcfSetKeyboardBrightnessFn = unsafe extern "system" fn(i32, i32) -> i32;

    let brightness = brightness.clamp(0, MAX_LIGHT_BRIGHTNESS);
    let ((connect_code, enabled_code, brightness_code), bridge) =
        with_author_bridge("keyboard basic lighting", |library| unsafe {
            let connect: Symbol<WcfConnectFn> =
                library.get(b"wcf_connect").map_err(|e| e.to_string())?;
            let disconnect: Symbol<WcfDisconnectFn> =
                library.get(b"wcf_disconnect").map_err(|e| e.to_string())?;
            let enable_leds: Symbol<WcfEnableKeyboardLedsFn> = library
                .get(b"wcf_enable_keyboard_leds")
                .map_err(|e| e.to_string())?;
            let set_brightness: Symbol<WcfSetKeyboardBrightnessFn> = library
                .get(b"wcf_set_keyboard_brightness")
                .map_err(|e| e.to_string())?;
            let connect_code = connect();
            let enabled_code = enable_leds(if enabled { 1 } else { 0 });
            let brightness_code = if enabled {
                set_brightness(brightness as i32, 1)
            } else {
                0
            };
            disconnect();
            Ok((connect_code, enabled_code, brightness_code))
        })?;
    Ok(AuthorKeyboardApplyResult {
        enabled,
        brightness,
        status: VendorServiceStatus {
            ok: true,
            detail: format!(
                "NUCtool bridge keyboard request dispatched (connect={}, enable={}, brightness={})",
                connect_code, enabled_code, brightness_code
            ),
            data: json!({ "bridge": bridge, "connectCode": connect_code, "enableCode": enabled_code, "brightnessCode": brightness_code }),
        },
    })
}

#[cfg(windows)]
fn read_author_hardware_state_blocking() -> Result<AuthorHardwareReadback, String> {
    type WcfConnectFn = unsafe extern "system" fn() -> i32;
    type WcfDisconnectFn = unsafe extern "system" fn();
    type WcfReadIntFn = unsafe extern "system" fn() -> i32;

    let (
        (connect_code, battery, keyboard_power, profile, feature_count, lightbar_power, aurora),
        bridge,
    ) = with_author_bridge("hardware readback", |library| unsafe {
        let connect: Symbol<WcfConnectFn> = library
            .get(b"wcf_connect")
            .map_err(|e| format!("NUCtool bridge missing wcf_connect: {}", e))?;
        let disconnect: Symbol<WcfDisconnectFn> = library
            .get(b"wcf_disconnect")
            .map_err(|e| format!("NUCtool bridge missing wcf_disconnect: {}", e))?;
        let get_battery: Symbol<WcfReadIntFn> = library
            .get(b"wcf_get_battery_charging_level")
            .map_err(|e| format!("NUCtool bridge missing battery readback: {}", e))?;
        let get_keyboard_power: Symbol<WcfReadIntFn> = library
            .get(b"wcf_get_keyboard_leds_power")
            .map_err(|e| format!("NUCtool bridge missing keyboard readback: {}", e))?;
        let get_profile: Symbol<WcfReadIntFn> = library
            .get(b"wcf_get_current_profile_index")
            .map_err(|e| format!("NUCtool bridge missing profile readback: {}", e))?;
        let get_feature_count: Symbol<WcfReadIntFn> = library
            .get(b"wcf_get_supported_features_count")
            .map_err(|e| format!("NUCtool bridge missing feature probe: {}", e))?;
        let get_lightbar_power: Option<Symbol<WcfReadIntFn>> =
            library.get(b"wcf_get_lightbar_indicators_power").ok();
        let get_aurora_installed: Option<Symbol<WcfReadIntFn>> =
            library.get(b"wcf_get_project_aurora_installed").ok();

        let connect_code = connect();
        let battery = get_battery();
        let keyboard_power = get_keyboard_power();
        let profile = get_profile();
        let feature_count = get_feature_count();
        let lightbar_power = get_lightbar_power.map(|get| get());
        let aurora = get_aurora_installed.map(|get| get());
        disconnect();
        Ok((
            connect_code,
            battery,
            keyboard_power,
            profile,
            feature_count,
            lightbar_power,
            aurora,
        ))
    })?;

    let battery_charging_level = (50..=100).contains(&battery).then_some(battery);
    let keyboard_leds_power = (keyboard_power >= 0).then_some(keyboard_power);
    // Keep the raw non-negative value so the UI can explain an unmapped result
    // (for example 0) without presenting it as a recognized profile.
    let current_profile_index = (profile >= 0).then_some(profile);
    let supported_features_count = (feature_count >= 0).then_some(feature_count);
    let lightbar_indicators_power = lightbar_power.filter(|value| *value >= 0);
    let aurora_installed = aurora.filter(|value| *value >= 0).map(|value| value != 0);
    let lightbar_supported =
        supported_features_count.map(|count| count > 0 && lightbar_indicators_power.is_some());
    let keyboard_enabled = keyboard_leds_power.map(|power| power > 0);

    Ok(AuthorHardwareReadback {
        battery_charging_level,
        keyboard_leds_power,
        keyboard_enabled,
        current_profile_index,
        supported_features_count,
        lightbar_indicators_power,
        lightbar_supported,
        aurora_installed,
        status: VendorServiceStatus {
            ok: true,
            detail: format!(
                "NUCtool hardware readback completed (connect={}, battery={:?}, keyboardPower={:?}, profile={:?}, supportedFeatures={:?})",
                connect_code,
                battery_charging_level,
                keyboard_leds_power,
                current_profile_index,
                supported_features_count
            ),
            data: json!({ "bridge": bridge, "connectCode": connect_code }),
        },
    })
}

#[cfg(windows)]
fn apply_vendor_display_mode_blocking(
    mode: String,
) -> Result<VendorDisplayModeApplyResult, String> {
    let normalized_mode = normalize_display_mode(&mode)
        .ok_or_else(|| format!("unknown vendor display mode: {}", mode))?;
    // A visual-mode write has one owner; no silent legacy-SDK fallback.
    apply_author_display_mode_bridge(normalized_mode)
}

#[tauri::command]
#[cfg(windows)]
pub async fn get_author_bridge_status() -> Value {
    author_display_bridge_status()
}

#[tauri::command]
#[cfg(windows)]
pub async fn get_vendor_service_status() -> Result<VendorServiceStatus, String> {
    tauri::async_runtime::spawn_blocking(read_vendor_status)
        .await
        .map_err(|e| format!("vendor status task failed: {}", e))
}

#[tauri::command]
#[cfg(windows)]
pub async fn apply_vendor_passive_cooling(enabled: bool) -> Result<VendorServiceStatus, String> {
    tauri::async_runtime::spawn_blocking(move || apply_vendor_passive_cooling_blocking(enabled))
        .await
        .map_err(|e| format!("vendor passive cooling task failed: {e}"))?
}

#[tauri::command]
#[cfg(windows)]
pub async fn restore_vendor_performance_defaults() -> Result<VendorServiceStatus, String> {
    tauri::async_runtime::spawn_blocking(restore_vendor_performance_defaults_blocking)
        .await
        .map_err(|e| format!("vendor performance reset task failed: {e}"))?
}

#[tauri::command]
#[cfg(windows)]
pub async fn update_vendor_performance_profile(
    index: i64,
    source: String,
    cpu: i64,
    dgpu: i64,
) -> Result<VendorServiceStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        update_vendor_performance_profile_blocking(index, source, cpu, dgpu)
    })
    .await
    .map_err(|e| format!("vendor performance profile task failed: {e}"))?
}

#[tauri::command]
#[cfg(windows)]
pub async fn apply_vendor_whisper(
    mode: String,
    fps: i64,
) -> Result<VendorWhisperApplyResult, String> {
    tauri::async_runtime::spawn_blocking(move || apply_vendor_whisper_blocking(mode, fps))
        .await
        .map_err(|e| format!("vendor Whisper task failed: {}", e))?
}

#[tauri::command]
#[cfg(windows)]
pub async fn apply_vendor_battery(
    mode: String,
    level: i64,
) -> Result<VendorBatteryApplyResult, String> {
    tauri::async_runtime::spawn_blocking(move || apply_vendor_battery_blocking(mode, level))
        .await
        .map_err(|e| format!("vendor battery task failed: {}", e))?
}

#[tauri::command]
#[cfg(windows)]
pub async fn apply_vendor_key(key: String, enabled: bool) -> Result<VendorKeyApplyResult, String> {
    tauri::async_runtime::spawn_blocking(move || apply_vendor_key_blocking(key, enabled))
        .await
        .map_err(|e| format!("vendor key task failed: {e}"))?
}

#[tauri::command]
#[cfg(windows)]
pub async fn apply_vendor_osd(enabled: bool) -> Result<VendorOsdApplyResult, String> {
    tauri::async_runtime::spawn_blocking(move || apply_vendor_osd_blocking(enabled))
        .await
        .map_err(|e| format!("vendor OSD task failed: {e}"))?
}

#[tauri::command]
#[cfg(windows)]
pub async fn apply_vendor_keyboard_color(
    r: i64,
    g: i64,
    b: i64,
) -> Result<VendorKeyboardColorApplyResult, String> {
    tauri::async_runtime::spawn_blocking(move || apply_vendor_keyboard_color_blocking(r, g, b))
        .await
        .map_err(|e| format!("vendor keyboard color task failed: {e}"))?
}

#[tauri::command]
#[cfg(windows)]
pub async fn apply_vendor_lightbar(
    source: String,
    r: i64,
    g: i64,
    b: i64,
    breathing: bool,
) -> Result<VendorLightbarApplyResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        apply_vendor_lightbar_blocking(source, r, g, b, breathing)
    })
    .await
    .map_err(|e| format!("vendor lightbar task failed: {e}"))?
}

#[tauri::command]
#[cfg(windows)]
pub async fn apply_vendor_lightbar_profile(
    profile: VendorLightbarProfileInput,
) -> Result<VendorServiceStatus, String> {
    tauri::async_runtime::spawn_blocking(move || apply_vendor_lightbar_profile_blocking(profile))
        .await
        .map_err(|e| format!("vendor lightbar profile task failed: {e}"))?
}

#[tauri::command]
#[cfg(windows)]
pub async fn apply_vendor_aux_setting(
    kind: String,
    source: String,
    value: i64,
) -> Result<VendorAuxApplyResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        apply_vendor_aux_setting_blocking(kind, source, value)
    })
    .await
    .map_err(|e| format!("vendor auxiliary setting task failed: {e}"))?
}

#[tauri::command]
#[cfg(windows)]
pub async fn apply_vendor_keyboard_effect(
    effect: String,
    direction: String,
    speed: i64,
) -> Result<VendorKeyboardEffectApplyResult, String> {
    tauri::async_runtime::spawn_blocking(move || apply_vendor_keyboard_effect_blocking(effect, direction, speed))
        .await
        .map_err(|e| format!("vendor keyboard effect task failed: {e}"))?
}

#[tauri::command]
#[cfg(windows)]
pub async fn apply_vendor_key_colors(indices: Vec<usize>, r: i64, g: i64, b: i64) -> Result<VendorServiceStatus, String> {
    tauri::async_runtime::spawn_blocking(move || apply_vendor_key_colors_blocking(indices, r, g, b))
        .await
        .map_err(|e| format!("vendor per-key color task failed: {e}"))?
}

#[tauri::command]
#[cfg(windows)]
pub async fn apply_vendor_key_palette(colors: Vec<VendorRgb>) -> Result<VendorServiceStatus, String> {
    tauri::async_runtime::spawn_blocking(move || apply_vendor_key_palette_blocking(colors))
        .await
        .map_err(|e| format!("vendor key palette task failed: {e}"))?
}

#[tauri::command]
#[cfg(windows)]
pub async fn apply_vendor_lightbar_effect(
    source: String,
    effect: String,
) -> Result<VendorLightbarEffectApplyResult, String> {
    tauri::async_runtime::spawn_blocking(move || apply_vendor_lightbar_effect_blocking(source, effect))
        .await
        .map_err(|e| format!("vendor lightbar effect task failed: {e}"))?
}

#[tauri::command]
#[cfg(windows)]
pub async fn apply_vendor_custom_display(
    brightness_ac: i64,
    brightness_dc: i64,
    color_temp: i64,
    contrast: i64,
    red: i64,
    green: i64,
    blue: i64,
) -> Result<VendorCustomDisplayApplyResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        apply_vendor_custom_display_blocking(
            brightness_ac,
            brightness_dc,
            color_temp,
            contrast,
            red,
            green,
            blue,
        )
    })
    .await
    .map_err(|e| format!("vendor custom display task failed: {e}"))?
}

#[tauri::command]
#[cfg(windows)]
pub async fn apply_vendor_preset_display(
    mode: String, brightness_ac: i64, brightness_dc: i64, color_temp: i64,
    contrast: i64, red: i64, green: i64, blue: i64,
) -> Result<VendorCustomDisplayApplyResult, String> {
    tauri::async_runtime::spawn_blocking(move || apply_vendor_preset_display_blocking(
        mode, brightness_ac, brightness_dc, color_temp, contrast, red, green, blue,
    )).await.map_err(|e| format!("vendor preset display task failed: {e}"))?
}

#[tauri::command]
#[cfg(windows)]
pub async fn reset_vendor_display_mode(mode: String) -> Result<VendorServiceStatus, String> {
    tauri::async_runtime::spawn_blocking(move || reset_vendor_display_mode_blocking(mode))
        .await
        .map_err(|e| format!("vendor display reset task failed: {e}"))?
}

#[tauri::command]
#[cfg(windows)]
pub async fn apply_vendor_lighting(
    r: i64,
    g: i64,
    b: i64,
    keyboard_brightness: i64,
    lightbar_brightness: i64,
    lightbar_breathing: Option<bool>,
) -> Result<VendorLightingApplyResult, String> {
    let lightbar_breathing = lightbar_breathing.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        apply_vendor_lighting_blocking(
            r,
            g,
            b,
            keyboard_brightness,
            lightbar_brightness,
            lightbar_breathing,
        )
    })
    .await
    .map_err(|e| format!("vendor lighting task failed: {}", e))?
}

#[tauri::command]
#[cfg(windows)]
pub async fn apply_vendor_display_mode(
    mode: String,
) -> Result<VendorDisplayModeApplyResult, String> {
    tauri::async_runtime::spawn_blocking(move || apply_vendor_display_mode_blocking(mode))
        .await
        .map_err(|e| format!("vendor display mode task failed: {}", e))?
}

#[tauri::command]
#[cfg(windows)]
pub async fn apply_author_benchmark_mode(
    enabled: bool,
) -> Result<AuthorBenchmarkApplyResult, String> {
    tauri::async_runtime::spawn_blocking(move || apply_author_benchmark_mode_blocking(enabled))
        .await
        .map_err(|e| format!("NUCtool bridge benchmark task failed: {}", e))?
}

#[tauri::command]
#[cfg(windows)]
pub async fn apply_author_power_profile(
    mode: String,
) -> Result<AuthorPowerProfileApplyResult, String> {
    tauri::async_runtime::spawn_blocking(move || apply_author_power_profile_blocking(mode))
        .await
        .map_err(|e| format!("NUCtool bridge power profile task failed: {}", e))?
}

#[tauri::command]
#[cfg(windows)]
pub async fn apply_author_power_plan(mode: String) -> Result<AuthorPowerPlanApplyResult, String> {
    tauri::async_runtime::spawn_blocking(move || apply_author_power_plan_blocking(mode))
        .await
        .map_err(|e| format!("NUCtool bridge power plan task failed: {}", e))?
}

#[tauri::command]
#[cfg(windows)]
pub async fn apply_author_battery_limit(level: i64) -> Result<AuthorBatteryApplyResult, String> {
    tauri::async_runtime::spawn_blocking(move || apply_author_battery_limit_blocking(level))
        .await
        .map_err(|e| format!("NUCtool bridge battery task failed: {}", e))?
}

#[tauri::command]
#[cfg(windows)]
pub async fn apply_author_keyboard_basic(
    enabled: bool,
    brightness: i64,
) -> Result<AuthorKeyboardApplyResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        apply_author_keyboard_basic_blocking(enabled, brightness)
    })
    .await
    .map_err(|e| format!("NUCtool bridge keyboard task failed: {}", e))?
}

#[tauri::command]
#[cfg(windows)]
pub async fn read_author_hardware_state() -> Result<AuthorHardwareReadback, String> {
    tauri::async_runtime::spawn_blocking(read_author_hardware_state_blocking)
        .await
        .map_err(|e| format!("NUCtool hardware readback task failed: {}", e))?
}

#[tauri::command]
#[cfg(unix)]
pub async fn get_vendor_service_status() -> Result<VendorServiceStatus, String> {
    Ok(VendorServiceStatus {
        ok: false,
        detail: "Vendor service migration is currently implemented for Windows only".to_string(),
        data: json!({}),
    })
}

#[tauri::command]
#[cfg(unix)]
pub async fn apply_vendor_passive_cooling(_enabled: bool) -> Result<VendorServiceStatus, String> {
    Err("被动散热控制仅支持 Windows 官方服务".to_string())
}

#[tauri::command]
#[cfg(unix)]
pub async fn restore_vendor_performance_defaults() -> Result<VendorServiceStatus, String> {
    Err("厂商性能恢复默认仅支持 Windows 官方服务".to_string())
}

#[tauri::command]
#[cfg(unix)]
pub async fn update_vendor_performance_profile(
    _index: i64,
    _source: String,
    _cpu: i64,
    _dgpu: i64,
) -> Result<VendorServiceStatus, String> {
    Err("厂商 AC/DC 性能配置仅支持 Windows 官方服务".to_string())
}

#[tauri::command]
#[cfg(unix)]
pub async fn get_author_bridge_status() -> Value {
    json!({ "available": false, "detail": "NUCtool.dll is only available on Windows" })
}

#[tauri::command]
#[cfg(unix)]
pub async fn read_author_hardware_state() -> Result<AuthorHardwareReadback, String> {
    Ok(AuthorHardwareReadback {
        battery_charging_level: None,
        keyboard_leds_power: None,
        keyboard_enabled: None,
        current_profile_index: None,
        supported_features_count: None,
        lightbar_indicators_power: None,
        lightbar_supported: None,
        aurora_installed: None,
        status: VendorServiceStatus {
            ok: false,
            detail: "NUCtool bridge is Windows-only".to_string(),
            data: json!({}),
        },
    })
}

#[tauri::command]
#[cfg(unix)]
pub async fn apply_vendor_whisper(
    mode: String,
    fps: i64,
) -> Result<VendorWhisperApplyResult, String> {
    let normalized_mode =
        normalize_whisper_mode(&mode).ok_or_else(|| format!("unknown Whisper mode: {}", mode))?;
    Ok(VendorWhisperApplyResult {
        mode: normalized_mode.to_string(),
        fps: fps.clamp(0, MAX_WHISPER_FPS),
        status: VendorServiceStatus {
            ok: false,
            detail: "Vendor Whisper settings are currently implemented for Windows only"
                .to_string(),
            data: json!({}),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::{
        author_benchmark_plan_index, author_power_plan_index, author_power_profile,
        normalize_battery_mode, normalize_display_mode, normalize_whisper_mode,
        vendor_battery_confirmed,
    };

    #[test]
    fn preset_display_editability_matches_installed_studio() {
        assert_eq!(super::editable_preset_display_fields("Standard"), None);
        assert_eq!(super::editable_preset_display_fields("Gaming"), Some([true; 7]));
        assert_eq!(super::editable_preset_display_fields("Video"), Some([true, true, true, false, false, false, false]));
        assert_eq!(super::editable_preset_display_fields("Reading"), Some([true, true, true, false, false, false, true]));
        assert_eq!(super::editable_preset_display_fields("Unknown"), None);
    }

    #[cfg(windows)]
    #[test]
    fn vendor_profile_write_rejects_invalid_modes_and_power_sources() {
        assert_eq!(super::vendor_profile_write_target(1, "ac", 1, 3), Ok(("Performance", "ac")));
        assert!(super::vendor_profile_write_target(0, "ac", 1, 3).is_err());
        assert!(super::vendor_profile_write_target(1, "battery", 1, 3).is_err());
        assert!(super::vendor_profile_write_target(1, "ac", 0, 3).is_err());
        assert!(super::vendor_profile_write_target(1, "dc", 1, 4).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn vendor_profile_write_requires_full_readback_without_fan_or_other_profile_changes() {
        let mut data = serde_json::json!({
            "connected": true,
            "currentState": { "selectedProfile": "Performance" },
            "currentProfiles": {
                "Performance": {"ac":{"cpu":"2","dgpu":"3","fan":"1"},"dc":{"cpu":"1","dgpu":"1","fan":"1"}},
                "Balanced": {"ac":{"cpu":"2","dgpu":"2","fan":"2"},"dc":{"cpu":"2","dgpu":"2","fan":"2"}},
                "BatterySaver": {"ac":{"cpu":"3","dgpu":"3","fan":"3"},"dc":{"cpu":"3","dgpu":"3","fan":"3"}}
            },
            "profileWrite": {
                "selected": "Performance",
                "before": {"ac":{"cpu":"1","dgpu":"1","fan":"1"},"dc":{"cpu":"1","dgpu":"1","fan":"1"}},
                "beforeProfiles": {
                    "Performance": {"ac":{"cpu":"1","dgpu":"1","fan":"1"},"dc":{"cpu":"1","dgpu":"1","fan":"1"}},
                    "Balanced": {"ac":{"cpu":"2","dgpu":"2","fan":"2"},"dc":{"cpu":"2","dgpu":"2","fan":"2"}},
                    "BatterySaver": {"ac":{"cpu":"3","dgpu":"3","fan":"3"},"dc":{"cpu":"3","dgpu":"3","fan":"3"}}
                }
            }
        });
        assert!(super::vendor_profile_write_confirmed(&data, "Performance", "ac", 2, 3));
        data["currentProfiles"]["Performance"]["ac"]["fan"] = serde_json::json!("2");
        assert!(!super::vendor_profile_write_confirmed(&data, "Performance", "ac", 2, 3));
        data["currentProfiles"]["Performance"]["ac"]["fan"] = serde_json::json!("1");
        data["currentProfiles"]["Balanced"]["dc"]["cpu"] = serde_json::json!("3");
        assert!(!super::vendor_profile_write_confirmed(&data, "Performance", "ac", 2, 3));
    }

    #[cfg(windows)]
    #[test]
    fn full_lightbar_profile_rejects_unsupported_effects_and_channels() {
        let mut profile = super::VendorLightbarProfileInput {
            ac: super::VendorLightbarSettingInput { effect: "Monocolor".into(), r: 49, g: 0, b: 0 },
            dc: super::VendorLightbarSettingInput { effect: "Rainbow".into(), r: 100, g: 0, b: 20 },
            breathing: false,
        };
        assert!(super::valid_vendor_lightbar_profile(&profile));
        profile.dc.r = 101;
        assert!(!super::valid_vendor_lightbar_profile(&profile));
        profile.dc.r = 100;
        profile.ac.effect = "Unknown".into();
        assert!(!super::valid_vendor_lightbar_profile(&profile));
    }

    #[test]
    fn vendor_whisper_modes_match_frontend_options_and_legacy_aliases() {
        assert_eq!(normalize_whisper_mode("Off"), Some("Off"));
        assert_eq!(normalize_whisper_mode("Quiet"), Some("Quiet"));
        assert_eq!(normalize_whisper_mode("Quieter"), Some("Quieter"));
        assert_eq!(normalize_whisper_mode("Balanced"), Some("Balanced"));
        assert_eq!(normalize_whisper_mode("On"), Some("Quiet"));
    }

    #[test]
    fn vendor_battery_modes_match_frontend_options_and_legacy_aliases() {
        assert_eq!(normalize_battery_mode("BestBattery"), Some("BestBattery"));
        assert_eq!(normalize_battery_mode("Custom"), Some("Custom"));
        assert_eq!(normalize_battery_mode("AcMode"), Some("AcMode"));
        assert_eq!(normalize_battery_mode("Standard"), Some("Custom"));
        assert_eq!(normalize_battery_mode("FullCharge"), Some("AcMode"));
    }

    #[test]
    fn vendor_battery_readback_rejects_wrong_mode_or_custom_level() {
        let state = serde_json::json!({
            "connected": true,
            "sdkFound": true,
            "battery": { "mode": "Custom", "chargingLevel": 60 }
        });
        assert!(vendor_battery_confirmed(&state, "Custom", 60));
        assert!(!vendor_battery_confirmed(&state, "Custom", 80));
        assert!(!vendor_battery_confirmed(&state, "AcMode", 100));
        assert!(!vendor_battery_confirmed(&serde_json::json!({ "connected": false, "sdkFound": true, "battery": { "mode": "Custom", "chargingLevel": 60 } }), "Custom", 60));
    }

    #[test]
    fn vendor_display_modes_match_sdk_content_profiles() {
        assert_eq!(normalize_display_mode("standard"), Some("Standard"));
        assert_eq!(normalize_display_mode("gaming"), Some("Gaming"));
        assert_eq!(normalize_display_mode("video"), Some("Video"));
        assert_eq!(normalize_display_mode("reading"), Some("Reading"));
        assert_eq!(normalize_display_mode("custom"), None);
    }

    #[test]
    fn author_power_profile_selection_excludes_benchmark_and_windows_plan() {
        assert_eq!(author_power_profile("powersave"), Some(("powersave", 3)));
        assert_eq!(author_power_profile("balanced"), Some(("balanced", 2)));
        assert_eq!(
            author_power_profile("performance"),
            Some(("performance", 1))
        );
        assert_eq!(author_power_profile("benchmark"), None);
    }

    #[test]
    fn disabling_benchmark_clears_flag_without_changing_vendor_plan() {
        assert_eq!(author_benchmark_plan_index(true), Some(4));
        assert_eq!(author_benchmark_plan_index(false), None);
    }

    #[test]
    fn author_power_plan_indices_match_upstream_wcf_contract() {
        assert_eq!(author_power_plan_index("off"), Some(("off", 0)));
        assert_eq!(
            author_power_plan_index("performance"),
            Some(("performance", 1))
        );
        assert_eq!(author_power_plan_index("balanced"), Some(("balanced", 2)));
        assert_eq!(author_power_plan_index("powersave"), Some(("powersave", 3)));
        assert_eq!(author_power_plan_index("benchmark"), Some(("benchmark", 4)));
    }

    #[cfg(windows)]
    #[test]
    fn author_display_bridge_indices_match_upstream_modes() {
        assert_eq!(super::display_mode_index("Standard"), Some(0));
        assert_eq!(super::display_mode_index("Gaming"), Some(1));
        assert_eq!(super::display_mode_index("Video"), Some(2));
        assert_eq!(super::display_mode_index("Reading"), Some(3));
        assert_eq!(super::display_mode_index("Custom"), None);
    }

    #[cfg(windows)]
    #[test]
    fn powershell_reader_drains_large_status_payload_without_deadlock() {
        let output = super::run_powershell_json("'x' * 70000", std::time::Duration::from_secs(10))
            .expect("PowerShell output larger than a pipe buffer must complete");
        assert_eq!(output.len(), 70000);
    }

    #[cfg(windows)]
    #[test]
    fn bundled_author_display_bridge_matches_the_reviewed_binary() {
        use sha2::{Digest, Sha256};

        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("NucSoftwareStudio")
            .join("NUCtool.dll");
        let bytes = std::fs::read(path).expect("author display bridge should be bundled");
        assert_eq!(
            hex::encode_upper(Sha256::digest(bytes)),
            super::AUTHOR_DISPLAY_BRIDGE_HASH
        );
    }
}

#[tauri::command]
#[cfg(unix)]
pub async fn apply_vendor_battery(
    mode: String,
    level: i64,
) -> Result<VendorBatteryApplyResult, String> {
    let normalized_mode = normalize_battery_mode(&mode)
        .ok_or_else(|| format!("unknown battery charge mode: {}", mode))?;
    Ok(VendorBatteryApplyResult {
        mode: normalized_mode.to_string(),
        level: level.clamp(MIN_BATTERY_CHARGE_LEVEL, MAX_BATTERY_CHARGE_LEVEL),
        status: VendorServiceStatus {
            ok: false,
            detail: "Vendor battery settings are currently implemented for Windows only"
                .to_string(),
            data: json!({}),
        },
    })
}

#[tauri::command]
#[cfg(unix)]
pub async fn apply_vendor_key(key: String, enabled: bool) -> Result<VendorKeyApplyResult, String> {
    Ok(VendorKeyApplyResult {
        key,
        enabled,
        verified: false,
        status: VendorServiceStatus {
            ok: false,
            detail: "Vendor key control is available on Windows only".to_string(),
            data: json!({}),
        },
    })
}

#[tauri::command]
#[cfg(unix)]
pub async fn apply_vendor_osd(enabled: bool) -> Result<VendorOsdApplyResult, String> {
    Ok(VendorOsdApplyResult {
        enabled,
        status: VendorServiceStatus {
            ok: false,
            detail: "Vendor OSD control is available on Windows only".to_string(),
            data: json!({}),
        },
    })
}

#[tauri::command]
#[cfg(unix)]
pub async fn apply_vendor_keyboard_color(
    r: i64,
    g: i64,
    b: i64,
) -> Result<VendorKeyboardColorApplyResult, String> {
    Ok(VendorKeyboardColorApplyResult {
        r,
        g,
        b,
        verified: false,
        status: VendorServiceStatus {
            ok: false,
            detail: "Vendor keyboard colors are available on Windows only".to_string(),
            data: json!({}),
        },
    })
}

#[tauri::command]
#[cfg(unix)]
pub async fn apply_vendor_lightbar(
    source: String,
    r: i64,
    g: i64,
    b: i64,
    breathing: bool,
) -> Result<VendorLightbarApplyResult, String> {
    Ok(VendorLightbarApplyResult {
        source,
        r,
        g,
        b,
        breathing,
        verified: false,
        status: VendorServiceStatus {
            ok: false,
            detail: "Vendor lightbar control is available on Windows only".to_string(),
            data: json!({}),
        },
    })
}

#[tauri::command]
#[cfg(unix)]
pub async fn apply_vendor_lightbar_profile(
    _profile: VendorLightbarProfileInput,
) -> Result<VendorServiceStatus, String> {
    Err("光条总开关仅支持 Windows 官方服务".to_string())
}

#[tauri::command]
#[cfg(unix)]
pub async fn apply_vendor_aux_setting(
    kind: String,
    source: String,
    value: i64,
) -> Result<VendorAuxApplyResult, String> {
    Ok(VendorAuxApplyResult {
        source,
        value,
        verified: false,
        status: VendorServiceStatus {
            ok: false,
            detail: format!("{kind} is available on Windows only"),
            data: json!({}),
        },
    })
}

#[tauri::command]
#[cfg(unix)]
pub async fn apply_vendor_keyboard_effect(
    effect: String,
    direction: String,
    speed: i64,
) -> Result<VendorKeyboardEffectApplyResult, String> {
    Ok(VendorKeyboardEffectApplyResult {
        effect, direction, speed, verified: false,
        status: VendorServiceStatus { ok: false, detail: "Keyboard effects are available on Windows only".to_string(), data: json!({}) },
    })
}

#[tauri::command]
#[cfg(unix)]
pub async fn apply_vendor_key_colors(_indices: Vec<usize>, _r: i64, _g: i64, _b: i64) -> Result<VendorServiceStatus, String> {
    Ok(VendorServiceStatus {
        ok: false,
        detail: "Per-key keyboard control is available on Windows only".to_string(),
        data: json!({}),
    })
}

#[tauri::command]
#[cfg(unix)]
pub async fn apply_vendor_key_palette(_colors: Vec<VendorRgb>) -> Result<VendorServiceStatus, String> {
    Err("逐键配置仅支持 Windows 官方服务".to_string())
}

#[tauri::command]
#[cfg(unix)]
pub async fn apply_vendor_lightbar_effect(
    source: String,
    effect: String,
) -> Result<VendorLightbarEffectApplyResult, String> {
    Ok(VendorLightbarEffectApplyResult {
        source, effect, verified: false,
        status: VendorServiceStatus { ok: false, detail: "Lightbar effects are available on Windows only".to_string(), data: json!({}) },
    })
}

#[tauri::command]
#[cfg(unix)]
pub async fn apply_vendor_custom_display(
    _brightness_ac: i64,
    _brightness_dc: i64,
    _color_temp: i64,
    _contrast: i64,
    _red: i64,
    _green: i64,
    _blue: i64,
) -> Result<VendorCustomDisplayApplyResult, String> {
    Ok(VendorCustomDisplayApplyResult {
        profile_index: -1,
        saved_profile_verified: false,
        activation_requested: false,
        status: VendorServiceStatus {
            ok: false,
            detail: "Vendor custom display is available on Windows only".to_string(),
            data: json!({}),
        },
    })
}

#[tauri::command]
#[cfg(unix)]
pub async fn apply_vendor_preset_display(
    _mode: String, _brightness_ac: i64, _brightness_dc: i64, _color_temp: i64,
    _contrast: i64, _red: i64, _green: i64, _blue: i64,
) -> Result<VendorCustomDisplayApplyResult, String> {
    Err("Vendor display presets are available on Windows only".to_string())
}

#[tauri::command]
#[cfg(unix)]
pub async fn reset_vendor_display_mode(_mode: String) -> Result<VendorServiceStatus, String> {
    Ok(VendorServiceStatus {
        ok: false,
        detail: "Vendor display reset is available on Windows only".to_string(),
        data: json!({}),
    })
}
#[tauri::command]
#[cfg(unix)]
pub async fn apply_vendor_lighting(
    r: i64,
    g: i64,
    b: i64,
    keyboard_brightness: i64,
    lightbar_brightness: i64,
    lightbar_breathing: Option<bool>,
) -> Result<VendorLightingApplyResult, String> {
    Ok(VendorLightingApplyResult {
        r: r.clamp(0, MAX_RGB_CHANNEL),
        g: g.clamp(0, MAX_RGB_CHANNEL),
        b: b.clamp(0, MAX_RGB_CHANNEL),
        keyboard_brightness: keyboard_brightness.clamp(0, MAX_LIGHT_BRIGHTNESS),
        lightbar_brightness: lightbar_brightness.clamp(0, MAX_LIGHT_BRIGHTNESS),
        lightbar_breathing: lightbar_breathing.unwrap_or(false),
        status: VendorServiceStatus {
            ok: false,
            detail: "Vendor lighting settings are currently implemented for Windows only"
                .to_string(),
            data: json!({}),
        },
    })
}

#[tauri::command]
#[cfg(unix)]
pub async fn apply_vendor_display_mode(
    mode: String,
) -> Result<VendorDisplayModeApplyResult, String> {
    let normalized_mode = normalize_display_mode(&mode)
        .ok_or_else(|| format!("unknown vendor display mode: {}", mode))?;
    Ok(VendorDisplayModeApplyResult {
        mode: normalized_mode.to_string(),
        display_mode: Value::Null,
        verified: false,
        transport: "unsupported-platform".to_string(),
        status: VendorServiceStatus {
            ok: false,
            detail: "Vendor display modes are currently implemented for Windows only".to_string(),
            data: json!({}),
        },
    })
}

#[tauri::command]
#[cfg(unix)]
pub async fn apply_author_benchmark_mode(
    enabled: bool,
) -> Result<AuthorBenchmarkApplyResult, String> {
    Ok(AuthorBenchmarkApplyResult {
        enabled,
        dispatched: false,
        power_plan_index: author_benchmark_plan_index(enabled),
        status: VendorServiceStatus {
            ok: false,
            detail: "NUCtool bridge is Windows-only".to_string(),
            data: json!({ "verified": false }),
        },
    })
}

#[tauri::command]
#[cfg(unix)]
pub async fn apply_author_power_profile(
    mode: String,
) -> Result<AuthorPowerProfileApplyResult, String> {
    let (mode, profile_index) = author_power_profile(&mode)
        .ok_or_else(|| "unknown NUCtool bridge power profile".to_string())?;
    Ok(AuthorPowerProfileApplyResult {
        mode: mode.to_string(),
        profile_index,
        benchmark_enabled: false,
        dispatched: false,
        verified: false,
        current_profile_index: None,
        status: VendorServiceStatus {
            ok: false,
            detail: "NUCtool bridge is Windows-only".to_string(),
            data: json!({ "requestedProfileIndex": profile_index, "powerPlanChanged": false }),
        },
    })
}

#[tauri::command]
#[cfg(unix)]
pub async fn apply_author_power_plan(mode: String) -> Result<AuthorPowerPlanApplyResult, String> {
    let (mode, power_plan_index) = author_power_plan_index(&mode)
        .ok_or_else(|| "unknown NUCtool bridge power plan".to_string())?;
    Ok(AuthorPowerPlanApplyResult {
        mode: mode.to_string(),
        power_plan_index,
        status: VendorServiceStatus {
            ok: false,
            detail: "NUCtool bridge is Windows-only".to_string(),
            data: json!({}),
        },
    })
}

#[tauri::command]
#[cfg(unix)]
pub async fn apply_author_battery_limit(level: i64) -> Result<AuthorBatteryApplyResult, String> {
    Ok(AuthorBatteryApplyResult {
        level: level.clamp(MIN_BATTERY_CHARGE_LEVEL, MAX_BATTERY_CHARGE_LEVEL),
        status: VendorServiceStatus {
            ok: false,
            detail: "NUCtool bridge is Windows-only".to_string(),
            data: json!({}),
        },
    })
}

#[tauri::command]
#[cfg(unix)]
pub async fn apply_author_keyboard_basic(
    enabled: bool,
    brightness: i64,
) -> Result<AuthorKeyboardApplyResult, String> {
    Ok(AuthorKeyboardApplyResult {
        enabled,
        brightness: brightness.clamp(0, MAX_LIGHT_BRIGHTNESS),
        status: VendorServiceStatus {
            ok: false,
            detail: "NUCtool bridge is Windows-only".to_string(),
            data: json!({}),
        },
    })
}
