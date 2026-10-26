param([Parameter(Mandatory = $true)][string]$PayloadDirectory)

$ErrorActionPreference = 'Stop'
$repoDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$artifactRoot = [IO.Path]::GetFullPath((Join-Path $repoDir 'artifacts/nss-ec'))
$testId = [guid]::NewGuid().ToString('N')
$testRoot = Join-Path $artifactRoot "installer-smoke/$testId"
$installPath = Join-Path $testRoot 'app'
$installer = Join-Path $testRoot 'InstallerSmoke.exe'
$registry = "HKCU:\Software\NUCtool\InstallerTests\$testId"
if (-not [IO.Path]::GetFullPath($installPath).StartsWith($artifactRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Unsafe smoke-test installation path.'
}
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
& rtk proxy pwsh -NoProfile -File (Join-Path $PSScriptRoot 'package-intel-nss-installer.ps1') -PayloadDirectory $PayloadDirectory `
    -OutputFile $installer -TestMode -TestInstallDirectory $installPath -TestId $testId
if ($LASTEXITCODE -ne 0) { throw 'Test installer build failed.' }

function Invoke-TestSetup {
    $process = Start-Process -FilePath $installer -ArgumentList '/S' -PassThru -Wait -WindowStyle Hidden
    if ($process.ExitCode -ne 0) { throw "Smoke installer failed: $($process.ExitCode)" }
}
function Assert-Payload {
    foreach ($file in Get-ChildItem -LiteralPath $PayloadDirectory -Recurse -File) {
        $relative = [IO.Path]::GetRelativePath([IO.Path]::GetFullPath($PayloadDirectory), $file.FullName)
        $installed = Join-Path $installPath $relative
        if (-not (Test-Path -LiteralPath $installed) -or (Get-FileHash -LiteralPath $file.FullName).Hash -ne (Get-FileHash -LiteralPath $installed).Hash) {
            throw "Installed file differs from payload: $relative"
        }
    }
}

Invoke-TestSetup
Assert-Payload
if (-not (Test-Path -LiteralPath (Join-Path $installPath '.installer-test-shortcuts/NUCtool Studio EC.lnk')) -or
    -not (Test-Path -LiteralPath (Join-Path $installPath 'Uninstall.exe')) -or -not (Test-Path -LiteralPath $registry)) {
    throw 'Installer did not create isolated shortcuts/uninstaller/registration.'
}
Write-Output 'PASS Installer file copy, isolated shortcuts and registration'
$note = Join-Path $installPath 'user-note.txt'
Set-Content -LiteralPath $note -Value 'KEEP-USER-FILE' -Encoding utf8
Set-Content -LiteralPath (Join-Path $installPath 'IntelNucStudio.Ec.dll') -Value 'simulated older or damaged payload'
Set-ItemProperty -LiteralPath $registry -Name Version -Value '0.1.6'
Invoke-TestSetup
Assert-Payload
if ((Get-ItemProperty -LiteralPath $registry).Version -ne (Get-Content -LiteralPath (Join-Path $PayloadDirectory 'ec-integration-manifest.json') -Raw | ConvertFrom-Json).version) {
    throw 'Upgrade failed to update installed version metadata.'
}
if ((Get-Content -LiteralPath $note -Raw).Trim() -ne 'KEEP-USER-FILE') { throw 'Upgrade changed a user file.' }
Write-Output 'PASS Covering upgrade repairs the payload and preserves unrelated user files'

$process = Start-Process -FilePath (Join-Path $installPath 'Uninstall.exe') -ArgumentList '/S' -PassThru -Wait -WindowStyle Hidden
if ($process.ExitCode -ne 0) { throw "Smoke uninstaller failed: $($process.ExitCode)" }
$deadline = [DateTime]::UtcNow.AddSeconds(20)
while ((Test-Path -LiteralPath $registry) -or (Test-Path -LiteralPath (Join-Path $installPath 'Uninstall.exe'))) {
    if ([DateTime]::UtcNow -gt $deadline) { throw 'Uninstaller did not complete its isolated cleanup.' }
    Start-Sleep -Milliseconds 100
}
foreach ($file in Get-ChildItem -LiteralPath $PayloadDirectory -Recurse -File) {
    $relative = [IO.Path]::GetRelativePath([IO.Path]::GetFullPath($PayloadDirectory), $file.FullName)
    if (Test-Path -LiteralPath (Join-Path $installPath $relative)) { throw "Installed file left after uninstall: $relative" }
}
if (-not (Test-Path -LiteralPath $note) -or (Get-Content -LiteralPath $note -Raw).Trim() -ne 'KEEP-USER-FILE') {
    throw 'Uninstaller removed an unrelated user file.'
}
Write-Output 'PASS Uninstall removes only installed files and its own isolated registry/shortcuts'
[ordered]@{
    passed = 3
    testRoot = $testRoot
    mode = 'Unprivileged NSIS lifecycle fixture; no real startup-task writes, protected directories or public shortcuts'
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $testRoot 'smoke-result.json') -Encoding utf8
