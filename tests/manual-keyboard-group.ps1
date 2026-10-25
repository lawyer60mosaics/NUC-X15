# Opt-in hardware check. Saves the complete SDK keyboard profile, changes
# six US-layout LED slots, reads back, then restores the original profile.
$ErrorActionPreference = 'Stop'
$result = [ordered]@{ changedSlots = @(65,76,77,84,85,86); writeVerified = $false; restored = $false; error = $null }
$original = $null
$client = $null

function New-VendorClient {
  $callback = [UniwillSdkClient.Models.UniwillCallbackHandler]::new($null)
  $context = [System.ServiceModel.InstanceContext]::new($callback)
  $binding = [System.ServiceModel.NetHttpBinding]::new()
  $binding.WebSocketSettings.TransportUsage = [System.ServiceModel.Channels.WebSocketTransportUsage]::Always
  $address = [System.ServiceModel.EndpointAddress]::new('ws://localhost:58594/UniwillService')
  return [UniwillSdkClient.UniwillService.UniwillServiceClient]::new($context, $binding, $address)
}

function Read-Profile($profile) {
  return [ordered]@{
    effect = $profile.Effect.ToString()
    direction = $profile.Direction.ToString()
    speed = [int]$profile.Speed
    brightnessAc = [int]$profile.Brightness_AC
    brightnessDc = [int]$profile.Brightness_DC
    colorLength = [int]$profile.ColorLength
    colors = @($profile.Color | ForEach-Object { '{0},{1},{2}' -f $_.R,$_.G,$_.B })
    keyColors = @($profile.KeyColor | ForEach-Object { '{0},{1},{2}' -f $_.R,$_.G,$_.B })
  }
}

function Same-Profile($a, $b) {
  return (ConvertTo-Json -InputObject $a -Depth 6 -Compress) -ceq (ConvertTo-Json -InputObject $b -Depth 6 -Compress)
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
  $original = $client.GetCurrentKeyboardLedProfile()
  if ($null -eq $original -or @($original.KeyColor).Count -ne 126) { throw 'Expected 126 LED slots before write' }
  $initial = Read-Profile $original
  $test = $client.GetCurrentKeyboardLedProfile()
  if ($test.Effect -ne [UniwillSdkClient.UniwillService.RGBKeyboardEffect]::UserMode) {
    $hasColors = @($test.KeyColor | Where-Object { $_.R -ne 0 -or $_.G -ne 0 -or $_.B -ne 0 }).Count -gt 0
    if (-not $hasColors -and @($test.Color).Count -gt 0) {
      $base = $test.Color[0]
      for ($i=0; $i -lt 126; $i++) {
        $fill = [UniwillSdkClient.UniwillService.RGB]::new()
        $fill.R = [byte]$base.R; $fill.G = [byte]$base.G; $fill.B = [byte]$base.B
        $test.KeyColor[$i] = $fill
      }
    }
  }
  foreach ($index in $result.changedSlots) {
    $prior = $test.KeyColor[$index]
    $color = [UniwillSdkClient.UniwillService.RGB]::new()
    $color.R = [byte](255 - [int]$prior.R)
    $color.G = [byte](255 - [int]$prior.G)
    $color.B = [byte](255 - [int]$prior.B)
    $test.KeyColor[$index] = $color
  }
  $test.Effect = [UniwillSdkClient.UniwillService.RGBKeyboardEffect]::UserMode
  $expected = Read-Profile $test
  $client.ApplyKeyboardLedProfile($test)
  $client.Abort(); $client = New-VendorClient
  $actual = Read-Profile ($client.GetCurrentKeyboardLedProfile())
  $result.writeVerified = Same-Profile $expected $actual
  if (-not $result.writeVerified) { throw 'Written keyboard profile did not fully read back' }
} catch {
  $result.error = $_.Exception.Message
} finally {
  if ($null -ne $original) {
    try {
      if ($client) { $client.Abort() }
      $client = New-VendorClient
      $client.ApplyKeyboardLedProfile($original)
      $client.Abort(); $client = New-VendorClient
      $restored = Read-Profile ($client.GetCurrentKeyboardLedProfile())
      $result.restored = Same-Profile $initial $restored
      if (-not $result.restored) { $result.error = "Restore readback mismatch. $($result.error)" }
    } catch { $result.error = "Restore failed: $($_.Exception.Message). $($result.error)" }
  }
  if ($client) { try { $client.Abort() } catch {} }
}
$result | ConvertTo-Json -Depth 4 -Compress
if (-not $result.writeVerified -or -not $result.restored) { exit 1 }
