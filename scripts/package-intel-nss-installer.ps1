param(
    [Parameter(Mandatory = $true)][string]$PayloadDirectory,
    [string]$OutputFile,
    [string]$NsisCompiler,
    [switch]$TestMode,
    [string]$TestInstallDirectory,
    [string]$TestId
)

$ErrorActionPreference = 'Stop'
$repoDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$PayloadDirectory = [IO.Path]::GetFullPath($PayloadDirectory)
$manifestPath = Join-Path $PayloadDirectory 'ec-integration-manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'Build the payload with package-intel-nss-ec.ps1 first.' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$appVersion = [version]$manifest.version
foreach ($item in @(@{ Name = 'IntelNucStudio.Ec.dll'; Hash = $manifest.extensionSha256 },
    @{ Name = 'NucSoftwareStudio.exe'; Hash = $manifest.originalExeSha256 },
    @{ Name = 'NUCtool.Studio.Launcher.exe'; Hash = $manifest.launcherSha256 })) {
    if ((Get-FileHash -LiteralPath (Join-Path $PayloadDirectory $item.Name) -Algorithm SHA256).Hash -ne $item.Hash) {
        throw "Payload hash mismatch: $($item.Name)"
    }
}
if (-not $NsisCompiler) {
    $compilerCommand = Get-Command makensis.exe -ErrorAction SilentlyContinue
    if ($compilerCommand) { $NsisCompiler = $compilerCommand.Source }
    else {
        $NsisCompiler = @("$env:LOCALAPPDATA/tauri/NSIS/makensis.exe", "${env:ProgramFiles(x86)}/NSIS/makensis.exe", "$env:ProgramFiles/NSIS/makensis.exe") |
            Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    }
}
if (-not $NsisCompiler -or -not (Test-Path -LiteralPath $NsisCompiler)) {
    throw 'NSIS compiler missing. Install explicitly with: winget install --id NSIS.NSIS -e'
}
$artifactRoot = [IO.Path]::GetFullPath((Join-Path $repoDir 'artifacts/nss-ec'))
if ($TestMode) {
    if (-not $TestInstallDirectory -or -not $TestId -or $TestId -notmatch '^[a-zA-Z0-9-]+$') { throw 'TestMode requires a private TestInstallDirectory and alphanumeric TestId.' }
    $TestInstallDirectory = [IO.Path]::GetFullPath($TestInstallDirectory)
    if (-not $TestInstallDirectory.StartsWith($artifactRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Installer test paths must stay inside artifacts/nss-ec.'
    }
    if (-not $OutputFile) { $OutputFile = Join-Path (Split-Path $TestInstallDirectory) 'InstallerSmoke.exe' }
}
elseif (-not $OutputFile) { $OutputFile = Join-Path $repoDir "releases/IntelNUCSoftwareStudio-EC-$appVersion-Setup.exe" }
$OutputFile = [IO.Path]::GetFullPath($OutputFile)
if ($OutputFile.StartsWith($PayloadDirectory + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Installer output must be outside its payload directory.'
}
if ($TestMode -and -not $OutputFile.StartsWith($artifactRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Test installers cannot be written into release directories.'
}
New-Item -ItemType Directory -Path (Split-Path $OutputFile) -Force | Out-Null
$buildDirectory = Join-Path $artifactRoot ('installer-build/' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $buildDirectory -Force | Out-Null
$productSource = Get-Content -LiteralPath (Join-Path $repoDir 'integrations/IntelNucStudio.Ec/InstallationTasks.cs') -Raw
$productId = [regex]::Match($productSource, 'const string ProductId = "([^"]+)"').Groups[1].Value
[void][guid]::Parse($productId)

function ConvertTo-NsisLiteral([string]$Value) { $Value.Replace('$', '$$') }
$files = @(Get-ChildItem -LiteralPath $PayloadDirectory -Recurse -File | Sort-Object FullName)
$install = [Collections.Generic.List[string]]::new()
$uninstall = [Collections.Generic.List[string]]::new()
$directories = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$lastDirectory = $null
foreach ($file in $files) {
    $relative = [IO.Path]::GetRelativePath($PayloadDirectory, $file.FullName)
    if ([IO.Path]::IsPathRooted($relative) -or $relative.StartsWith('..') -or $relative -in @('Uninstall.exe', 'installation-mode.ini')) {
        throw "Invalid payload path: $relative"
    }
    $directory = [IO.Path]::GetDirectoryName($relative)
    $target = '$INSTDIR' + $(if ($directory) { '\' + (ConvertTo-NsisLiteral $directory) })
    if ($directory -ne $lastDirectory) { $install.Add('SetOutPath "' + $target + '"'); $lastDirectory = $directory }
    $install.Add('File "/oname=' + (ConvertTo-NsisLiteral $file.Name) + '" "' + (ConvertTo-NsisLiteral $file.FullName) + '"')
    $installed = '$INSTDIR\' + (ConvertTo-NsisLiteral $relative)
    # Keep the maintenance helper usable if a noncritical file cannot be removed.
    if ($relative -notin @('NUCtool.Studio.Launcher.exe', 'NUCtool.Studio.Launcher.exe.config', 'IntelNucStudio.Ec.dll')) {
        $uninstall.Add('IfFileExists "' + $installed + '" 0 +2')
        $uninstall.Add('Delete "' + $installed + '"')
    }
    while ($directory) { [void]$directories.Add($directory); $directory = [IO.Path]::GetDirectoryName($directory) }
}
$installFile = Join-Path $buildDirectory 'install-files.nsh'
$uninstallFile = Join-Path $buildDirectory 'uninstall-files.nsh'
$uninstallDirs = Join-Path $buildDirectory 'uninstall-dirs.nsh'
$install | Set-Content -LiteralPath $installFile -Encoding utf8
$uninstall | Set-Content -LiteralPath $uninstallFile -Encoding utf8
@($directories | Sort-Object Length -Descending | ForEach-Object { 'RMDir "$INSTDIR\' + (ConvertTo-NsisLiteral $_) + '"' }) |
    Set-Content -LiteralPath $uninstallDirs -Encoding utf8

$iconPath = Join-Path $buildDirectory 'nuc.ico'
$assembly = [Reflection.Assembly]::LoadFile((Join-Path $PayloadDirectory 'NucSoftwareStudio.exe'))
$resource = $assembly.GetManifestResourceStream('NucSoftwareStudio.g.resources')
$reader = [Resources.ResourceReader]::new($resource)
try {
    $iterator = $reader.GetEnumerator()
    while ($iterator.MoveNext()) {
        if ($iterator.Key -eq 'nuc_icon.ico') {
            $iconOutput = [IO.File]::Create($iconPath)
            try { $iterator.Value.CopyTo($iconOutput) } finally { $iconOutput.Dispose() }
            break
        }
    }
} finally { $reader.Dispose(); $resource.Dispose() }
$arguments = @('/V3', '/INPUTCHARSET', 'UTF8', "/DAPP_VERSION=$appVersion", "/DPAYLOAD_DIR=$PayloadDirectory",
    "/DOUTPUT_FILE=$OutputFile", "/DPRODUCT_ID=$productId", "/DINSTALL_FILES=$installFile", "/DUNINSTALL_FILES=$uninstallFile",
    "/DUNINSTALL_DIRS=$uninstallDirs", "/DINSTALL_SIZE=$([int][math]::Ceiling(($files | Measure-Object Length -Sum).Sum / 1024))")
if (Test-Path -LiteralPath $iconPath) { $arguments += "/DAPP_ICON=$iconPath" }
if ($TestMode) { $arguments += @('/DINSTALLER_TEST_MODE', "/DTEST_ID=$TestId", "/DTEST_INSTALL_DIR=$TestInstallDirectory") }
$arguments += (Join-Path $repoDir 'scripts/installer/nuc-studio.nsi')
& rtk proxy $NsisCompiler @arguments
if ($LASTEXITCODE -ne 0) { throw "NSIS compilation failed: $LASTEXITCODE" }
[ordered]@{
    version = $appVersion.ToString()
    artifact = $OutputFile
    sha256 = (Get-FileHash -LiteralPath $OutputFile -Algorithm SHA256).Hash
    payloadFiles = $files.Count
    testMode = [bool]$TestMode
    originalFilesVerified = $manifest.originalFilesVerified
    originalExeSha256 = $manifest.originalExeSha256
} | ConvertTo-Json | Set-Content -LiteralPath ($OutputFile + '.json') -Encoding utf8
Write-Output "Installer: $OutputFile"
