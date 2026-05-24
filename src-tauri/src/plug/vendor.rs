use serde::Serialize;
use serde_json::{json, Value};

#[cfg(windows)]
use std::{
    os::windows::process::CommandExt,
    process::{Command, Stdio},
    sync::{Mutex, MutexGuard, TryLockError},
    thread,
    time::{Duration, Instant},
};

#[cfg(windows)]
use crate::plug::diagnostics::app_log;

#[derive(Debug, Serialize)]
pub struct VendorServiceStatus {
    pub ok: bool,
    pub detail: String,
    pub data: Value,
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
    pub status: VendorServiceStatus,
}

#[cfg(windows)]
const VENDOR_STATUS_TIMEOUT: Duration = Duration::from_secs(8);
#[cfg(windows)]
const VENDOR_WRITE_TIMEOUT: Duration = Duration::from_secs(6);
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
fn hidden_command(program: &str) -> Command {
    let mut command = Command::new(program);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

fn normalize_whisper_mode(mode: &str) -> Option<&'static str> {
    match mode.trim().to_ascii_lowercase().as_str() {
        "off" => Some("Off"),
        "quieter" => Some("Quieter"),
        "quiet" => Some("Quiet"),
        "balanced" => Some("Balanced"),
        _ => None,
    }
}

fn normalize_battery_mode(mode: &str) -> Option<&'static str> {
    match mode.trim().to_ascii_lowercase().as_str() {
        "acmode" | "full" | "fullcharge" => Some("AcMode"),
        "custom" => Some("Custom"),
        "bestbattery" | "care" | "conservation" => Some("BestBattery"),
        _ => None,
    }
}

#[cfg(windows)]
fn run_powershell_json(script: &str, timeout: Duration) -> Result<String, String> {
    let _guard = try_vendor_command_lock()?;

    let mut child = hidden_command("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to start powershell: {}", e))?;

    let start = Instant::now();
    loop {
        if child
            .try_wait()
            .map_err(|e| format!("failed waiting for powershell: {}", e))?
            .is_some()
        {
            let output = child
                .wait_with_output()
                .map_err(|e| format!("failed reading powershell output: {}", e))?;
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if output.status.success() {
                return Ok(stdout);
            }
            return Err(format!(
                "powershell failed status={} stdout='{}' stderr='{}'",
                output.status, stdout, stderr
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
      $profile = $profiles[$index]
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
  whisper = $null
  battery = $null
  lighting = $null
  errors = @()
}

$result.processRunning = [bool](Get-Process -Name 'UniwillService' -ErrorAction SilentlyContinue)

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
  $result.errors += 'Uniwill SDK files not found. Run tools\Prepare-NucStudioRemoval.ps1 before uninstalling Intel NUC Software Studio.'
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
  try { $result.currentProfiles = ProfilesObject ($client.GetCurrentProfiles()) } catch { $result.errors += "GetCurrentProfiles: $($_.Exception.Message)" }
  try { $result.defaultProfiles = ProfilesObject ($client.GetDefaultProfiles()) } catch { $result.errors += "GetDefaultProfiles: $($_.Exception.Message)" }
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
} finally {
  if ($client.State -eq [System.ServiceModel.CommunicationState]::Faulted) {
    $client.Abort()
  } else {
    $client.Close()
  }
}

$result | ConvertTo-Json -Depth 8 -Compress
"#
}

#[cfg(windows)]
fn vendor_whisper_script(mode: &str, fps: i64) -> String {
    vendor_status_script()
        .replace(
            "Add-Type -Path (Join-Path $sdkPath 'UniwillSdkClient.dll')",
            &format!(
                "Add-Type -Path (Join-Path $sdkPath 'UniwillSdkClient.dll')\n$targetWhisperMode = [UniwillSdkClient.UniwillService.WhisperModeType]::{mode}\n$targetWhisperFps = {fps}"
            ),
        )
        .replace(
            "  $state = $client.GetCurrentState()",
            "  $client.SetWhisperModeType($targetWhisperMode)\n  $client.SetWhisperModeFps($targetWhisperFps)\n  $state = $client.GetCurrentState()",
        )
}

#[cfg(windows)]
fn vendor_battery_script(mode: &str, level: i64) -> String {
    vendor_status_script()
        .replace(
            "Add-Type -Path (Join-Path $sdkPath 'UniwillSdkClient.dll')",
            &format!(
                "Add-Type -Path (Join-Path $sdkPath 'UniwillSdkClient.dll')\n$targetBatteryMode = [UniwillSdkClient.UniwillService.BatteryMode]::{mode}\n$targetBatteryLevel = {level}"
            ),
        )
        .replace(
            "  $state = $client.GetCurrentState()",
            "  $client.SetBatteryMode($targetBatteryMode)\n  if ($targetBatteryMode -eq [UniwillSdkClient.UniwillService.BatteryMode]::Custom) { $client.SetBatteryChargingLevel($targetBatteryLevel) }\n  $state = $client.GetCurrentState()",
        )
}

#[cfg(windows)]
fn vendor_lighting_script(
    r: i64,
    g: i64,
    b: i64,
    keyboard_brightness: i64,
    lightbar_brightness: i64,
) -> String {
    let light_r = r * lightbar_brightness / MAX_RGB_CHANNEL;
    let light_g = g * lightbar_brightness / MAX_RGB_CHANNEL;
    let light_b = b * lightbar_brightness / MAX_RGB_CHANNEL;
    vendor_status_script()
        .replace(
            "Add-Type -Path (Join-Path $sdkPath 'UniwillSdkClient.dll')",
            &format!(
                "Add-Type -Path (Join-Path $sdkPath 'UniwillSdkClient.dll')\n$targetRgbR = {r}\n$targetRgbG = {g}\n$targetRgbB = {b}\n$targetKeyboardBrightness = {keyboard_brightness}\n$targetLightR = {light_r}\n$targetLightG = {light_g}\n$targetLightB = {light_b}"
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
  $lightbarProfile.BreathingEnable = $false
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
      breathing = $false
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
                VendorServiceStatus {
                    ok: connected && sdk_found,
                    detail: if connected {
                        "Uniwill vendor service is reachable".to_string()
                    } else {
                        "Uniwill vendor service is not reachable".to_string()
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
            data: json!({}),
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
    let status = VendorServiceStatus {
        ok: connected && sdk_found,
        detail: if connected {
            "Vendor Whisper settings applied".to_string()
        } else {
            "Vendor Whisper settings were not confirmed".to_string()
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
        detail: if connected {
            "Vendor battery settings applied".to_string()
        } else {
            "Vendor battery settings were not confirmed".to_string()
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
) -> Result<VendorLightingApplyResult, String> {
    let r = r.clamp(0, MAX_RGB_CHANNEL);
    let g = g.clamp(0, MAX_RGB_CHANNEL);
    let b = b.clamp(0, MAX_RGB_CHANNEL);
    let keyboard_brightness = keyboard_brightness.clamp(0, MAX_LIGHT_BRIGHTNESS);
    let lightbar_brightness = lightbar_brightness.clamp(0, MAX_LIGHT_BRIGHTNESS);
    let script = vendor_lighting_script(r, g, b, keyboard_brightness, lightbar_brightness);

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
        status,
    })
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
pub async fn apply_vendor_lighting(
    r: i64,
    g: i64,
    b: i64,
    keyboard_brightness: i64,
    lightbar_brightness: i64,
) -> Result<VendorLightingApplyResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        apply_vendor_lighting_blocking(r, g, b, keyboard_brightness, lightbar_brightness)
    })
    .await
    .map_err(|e| format!("vendor lighting task failed: {}", e))?
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
pub async fn apply_vendor_lighting(
    r: i64,
    g: i64,
    b: i64,
    keyboard_brightness: i64,
    lightbar_brightness: i64,
) -> Result<VendorLightingApplyResult, String> {
    Ok(VendorLightingApplyResult {
        r: r.clamp(0, MAX_RGB_CHANNEL),
        g: g.clamp(0, MAX_RGB_CHANNEL),
        b: b.clamp(0, MAX_RGB_CHANNEL),
        keyboard_brightness: keyboard_brightness.clamp(0, MAX_LIGHT_BRIGHTNESS),
        lightbar_brightness: lightbar_brightness.clamp(0, MAX_LIGHT_BRIGHTNESS),
        status: VendorServiceStatus {
            ok: false,
            detail: "Vendor lighting settings are currently implemented for Windows only"
                .to_string(),
            data: json!({}),
        },
    })
}
