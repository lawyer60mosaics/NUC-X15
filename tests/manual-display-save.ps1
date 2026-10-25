# Opt-in hardware check. Changes one saved Gaming preset value, reads it back,
# then restores all five saved presets. Does not call SetDisplayMode.
$ErrorActionPreference = 'Stop'
$result = [ordered]@{ changedMode = 'Gaming'; changedField = 'Contrast'; writeVerified = $false; restored = $false; activationRequested = $false; error = $null }
$original = $null
$before = $null
$client = $null

function New-VendorClient {
  $callback = [UniwillSdkClient.Models.UniwillCallbackHandler]::new($null)
  $context = [System.ServiceModel.InstanceContext]::new($callback)
  $binding = [System.ServiceModel.NetHttpBinding]::new()
  $binding.WebSocketSettings.TransportUsage = [System.ServiceModel.Channels.WebSocketTransportUsage]::Always
  $address = [System.ServiceModel.EndpointAddress]::new('ws://localhost:58594/UniwillService')
  return [UniwillSdkClient.UniwillService.UniwillServiceClient]::new($context, $binding, $address)
}

function Snapshot-Modes($modes) {
  return @($modes | Sort-Object Index | ForEach-Object {
    [ordered]@{ index = [int]$_.Index; type = $_.Type.ToString(); brightnessAc = [int]$_.BrightnessAC; brightnessDc = [int]$_.BrightnessDC; colorTemp = [int]$_.ColorTemp; contrast = [single]$_.Contrast; red = [int]$_.Red; green = [int]$_.Green; blue = [int]$_.Blue }
  })
}

function Same-Modes($a, $b) {
  return (ConvertTo-Json -InputObject $a -Depth 5 -Compress) -ceq (ConvertTo-Json -InputObject $b -Depth 5 -Compress)
}

try {
  if (Get-Process -Name NUCtool -ErrorAction SilentlyContinue) { throw 'Close all NUCtool instances before this hardware check' }
  $package = Get-AppxPackage -Name 'AppUp.IntelNUCSoftwareStudio' | Select-Object -First 1
  if (-not $package) { throw 'Intel NUC Software Studio SDK is not installed' }
  $sdk = Join-Path $package.InstallLocation 'NucSoftwareStudio'
  Add-Type -Path (Join-Path $sdk 'Prism.dll')
  Add-Type -Path (Join-Path $sdk 'UniwillSdkClient.dll')
  $client = New-VendorClient
  $null = $client.GetCurrentState()
  $modes = @($client.GetSavedDisplayModes())
  $before = Snapshot-Modes $modes
  $matches = @($modes | Where-Object { $_.Type -eq [UniwillSdkClient.UniwillService.DisplayModeType]::Gaming })
  if ($modes.Count -ne 5 -or $matches.Count -ne 1) { throw 'Expected five presets including one Gaming mode' }
  $original = $matches[0]
  $test = @($client.GetSavedDisplayModes() | Where-Object { $_.Type -eq [UniwillSdkClient.UniwillService.DisplayModeType]::Gaming })[0]
  $next = if ([single]$test.Contrast -lt 100) { [single]$test.Contrast + 1 } else { [single]$test.Contrast - 1 }
  $test.Contrast = [single]$next
  $expected = Snapshot-Modes @($modes | ForEach-Object { if ($_.Type -eq [UniwillSdkClient.UniwillService.DisplayModeType]::Gaming) { $test } else { $_ } })
  $client.UpdateDisplayMode($test)
  $client.Abort(); $client = New-VendorClient
  $actual = Snapshot-Modes @($client.GetSavedDisplayModes())
  $result.writeVerified = Same-Modes $expected $actual
  if (-not $result.writeVerified) { throw 'Saved Gaming preset did not read back as expected' }
} catch {
  $result.error = $_.Exception.Message
} finally {
  if ($null -ne $original) {
    try {
      if ($client) { $client.Abort() }
      $client = New-VendorClient
      $client.UpdateDisplayMode($original)
      $client.Abort(); $client = New-VendorClient
      $restored = Snapshot-Modes @($client.GetSavedDisplayModes())
      $result.restored = Same-Modes $before $restored
      if (-not $result.restored) { $result.error = "Restore readback mismatch. $($result.error)" }
    } catch { $result.error = "Restore failed: $($_.Exception.Message). $($result.error)" }
  }
  if ($client) { try { $client.Abort() } catch {} }
}
$result | ConvertTo-Json -Depth 4 -Compress
if (-not $result.writeVerified -or -not $result.restored) { exit 1 }
