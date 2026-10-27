param(
    [string]$MsixPath,
    [string]$NssSourceDir,
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$repoDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $repoDir 'releases/IntelNUCSoftwareStudio-EC' }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)

if (-not $NssSourceDir) {
    if (-not $MsixPath -or -not (Test-Path -LiteralPath $MsixPath)) {
        throw 'Specify -MsixPath for the original Intel MSIX, or -NssSourceDir for its extracted NucSoftwareStudio directory.'
    }
    $sourceHash = (Get-FileHash -LiteralPath $MsixPath -Algorithm SHA256).Hash.Substring(0, 16)
    $extractDir = Join-Path $repoDir "artifacts/nss-ec/source/$sourceHash"
    $NssSourceDir = Join-Path $extractDir 'NucSoftwareStudio'
    if (-not (Test-Path -LiteralPath (Join-Path $NssSourceDir 'NucSoftwareStudio.exe'))) {
        if (Test-Path -LiteralPath $extractDir) { throw "Incomplete extraction exists: $extractDir" }
        New-Item -ItemType Directory -Path (Split-Path $extractDir) -Force | Out-Null
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [IO.Compression.ZipFile]::ExtractToDirectory([IO.Path]::GetFullPath($MsixPath), $extractDir)
    }
}
$NssSourceDir = [IO.Path]::GetFullPath($NssSourceDir)
$originalExe = Join-Path $NssSourceDir 'NucSoftwareStudio.exe'
if (-not (Test-Path -LiteralPath $originalExe)) { throw "Official executable missing: $originalExe" }
if ($OutputDirectory.Equals($NssSourceDir, [StringComparison]::OrdinalIgnoreCase) -or
    $OutputDirectory.StartsWith($NssSourceDir + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
    $NssSourceDir.StartsWith($OutputDirectory + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Source and output must be separate, non-nested directories.'
}

& rtk proxy dotnet build (Join-Path $repoDir 'integrations/IntelNucStudio.Ec/IntelNucStudio.Ec.csproj') -c Release --ignore-failed-sources
if ($LASTEXITCODE -ne 0) { throw 'EC extension build failed.' }
& rtk proxy dotnet build (Join-Path $repoDir 'integrations/NUCtool.Studio.Launcher/NUCtool.Studio.Launcher.csproj') -c Release --ignore-failed-sources
if ($LASTEXITCODE -ne 0) { throw 'Elevated launcher build failed.' }
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
Get-ChildItem -LiteralPath $NssSourceDir -Force | Copy-Item -Destination $OutputDirectory -Recurse -Force
$extensionDll = Join-Path $repoDir 'integrations/IntelNucStudio.Ec/bin/Release/net48/IntelNucStudio.Ec.dll'
Copy-Item -LiteralPath $extensionDll -Destination $OutputDirectory -Force
$launcherDirectory = Join-Path $repoDir 'integrations/NUCtool.Studio.Launcher/bin/Release/net48'
foreach ($launcherFile in @('NUCtool.Studio.Launcher.exe', 'NUCtool.Studio.Launcher.exe.config')) {
    Copy-Item -LiteralPath (Join-Path $launcherDirectory $launcherFile) -Destination $OutputDirectory -Force
}
$extensionIdentity = [Reflection.AssemblyName]::GetAssemblyName($extensionDll)
$extensionVersion = $extensionIdentity.Version.ToString(3)

$configPath = Join-Path $OutputDirectory 'NucSoftwareStudio.exe.config'
Copy-Item -LiteralPath $configPath -Destination ($configPath + '.original') -Force
$config = New-Object System.Xml.XmlDocument
$config.PreserveWhitespace = $true
$config.Load($configPath)
$startup = $config.SelectSingleNode('/configuration/startup')
if (-not $startup) { $startup = $config.DocumentElement.AppendChild($config.CreateElement('startup')) }
$supported = $startup.SelectSingleNode('supportedRuntime')
if (-not $supported) { $supported = $startup.AppendChild($config.CreateElement('supportedRuntime')) }
$supported.SetAttribute('version', 'v4.0')
$supported.SetAttribute('sku', '.NETFramework,Version=v4.8')
# The Store package relies on WCF configuration supplied by its runtime context.
# Register this collection explicitly when running the official desktop EXE locally.
$serviceModel = $config.SelectSingleNode('/configuration/system.serviceModel')
if (-not $serviceModel) { throw 'Original WCF service configuration missing.' }
$extensions = $serviceModel.SelectSingleNode('extensions')
if (-not $extensions) { $extensions = $serviceModel.AppendChild($config.CreateElement('extensions')) }
$bindingExtensions = $extensions.SelectSingleNode('bindingExtensions')
if (-not $bindingExtensions) { $bindingExtensions = $extensions.AppendChild($config.CreateElement('bindingExtensions')) }
foreach ($node in @($bindingExtensions.SelectNodes('*[@name="netHttpBinding"]'))) { [void]$bindingExtensions.RemoveChild($node) }
$addBinding = $config.CreateElement('add')
$addBinding.SetAttribute('name', 'netHttpBinding')
$addBinding.SetAttribute('type', 'System.ServiceModel.Configuration.NetHttpBindingCollectionElement, System.ServiceModel, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089')
[void]$bindingExtensions.AppendChild($addBinding)
$runtime = $config.SelectSingleNode('/configuration/runtime')
if (-not $runtime) { $runtime = $config.DocumentElement.AppendChild($config.CreateElement('runtime')) }
foreach ($node in @('appDomainManagerAssembly', 'appDomainManagerType')) {
    if ($runtime.SelectSingleNode($node)) { throw "Original configuration already contains $node; refusing to replace another runtime extension." }
}
$assembly = $config.CreateElement('appDomainManagerAssembly')
$assembly.SetAttribute('value', $extensionIdentity.FullName)
[void]$runtime.AppendChild($assembly)
$type = $config.CreateElement('appDomainManagerType')
$type.SetAttribute('value', 'IntelNucStudio.Ec.EcDomainManager')
[void]$runtime.AppendChild($type)
$config.Save($configPath)

$sourceExeHash = (Get-FileHash -LiteralPath $originalExe -Algorithm SHA256).Hash
$outputExeHash = (Get-FileHash -LiteralPath (Join-Path $OutputDirectory 'NucSoftwareStudio.exe') -Algorithm SHA256).Hash
if ($sourceExeHash -ne $outputExeHash) { throw 'Original EXE identity was not preserved.' }
$originalFiles = @(Get-ChildItem -LiteralPath $NssSourceDir -Recurse -File | ForEach-Object {
    $relative = [IO.Path]::GetRelativePath($NssSourceDir, $_.FullName)
    if ($relative -ne 'NucSoftwareStudio.exe.config') {
        $sourceFileHash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
        $outputFileHash = (Get-FileHash -LiteralPath (Join-Path $OutputDirectory $relative) -Algorithm SHA256).Hash
        if ($sourceFileHash -ne $outputFileHash) { throw "Original file changed: $relative" }
        [ordered]@{ path = $relative; sha256 = $sourceFileHash }
    }
})
$manifest = [ordered]@{
    target = 'Intel NUC Software Studio (official WPF application)'
    entryPoint = 'NucSoftwareStudio.exe'
    originalExeSha256 = $sourceExeHash
    extensionSha256 = (Get-FileHash -LiteralPath $extensionDll -Algorithm SHA256).Hash
    launcher = 'NUCtool.Studio.Launcher.exe'
    launcherSha256 = (Get-FileHash -LiteralPath (Join-Path $OutputDirectory 'NUCtool.Studio.Launcher.exe') -Algorithm SHA256).Hash
    integration = '.NET Framework AppDomainManager configured in the official EXE config; EC WPF controls run in the official process/window'
    version = $extensionVersion
    originalFilesVerified = $originalFiles.Count
    originalFiles = $originalFiles
    createdUtc = [DateTime]::UtcNow.ToString('O')
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'ec-integration-manifest.json') -Encoding UTF8
@'
Intel NUC Software Studio · EC 扩展版

启动的是官方程序 NucSoftwareStudio.exe。
1. 正常退出已打开的 Intel NUC Software Studio 和其他正在接管 EC 的工具。
2. 安装版从开始菜单或桌面快捷方式启动；便携版运行 NUCtool.Studio.Launcher.exe，自动申请管理员权限。
3. 在官方主界面底部点击“EC 风扇控制”。

EC 模块提供：CPU/显卡温度与双风扇 RPM、静音/平衡/性能三档温控、固定转速、交还固件自动控制。
点击三档按钮即可启用或切换；运行中切换不会释放 EC，转速会逐步调整。
静音优先低噪声，平衡适合日常，性能优先散热。三档只控制风扇，不修改官方设备性能档位。
EC 入口只在官方主页显示，采用系统监视器同款的无边框“图标在上、文字在下”样式，详情页与设置页不显示。
主界面五大模块使用哑光深蓝工业配色；保留原版按钮标签模板，不再叠加全局卡片描边。
许可协议首次需亲自同意，之后在当前用户本地目录保存确认，避免每次启动重复提示。
EC 页在窄窗口下自动改为单列，交还控制按钮可通过滚动到达；性能遮罩文字换行显示。
进入 EC 页面只读取硬件。点击控制操作后才会写入。
EC 接管时，仅性能调优模块加遮罩并显示红色“EC控制中”；系统配置、显示、键盘、灯光仍可使用。
性能调优详情页及托盘性能预设同步锁定；其他详情页和托盘灯光功能保持可用。
在遮罩上可“返回 EC 控制”或“停止 EC 并解锁”。交还失败时保持性能调优锁定，其他模块仍可使用。
点击右上角 X 或按 Alt+F4，只隐藏到托盘，程序与 EC 控制继续运行；从托盘打开可恢复窗口。
EC 页“退出程序”或托盘“退出”才会先交还 EC 自动控制，再退出进程。
主页底部操作行预留独立空间，系统监视器、EC、自启动不再按窗口坐标浮动；窄窗口时自启动换行。
开机自启动：主页底部直接操作“开机自启动”开关，显示实际状态及失败原因；托盘菜单也保留相同入口。
安装版请从开始菜单快捷方式运行；便携版请先解压到长期保留的位置，以管理员身份运行。
勾选后仅当前用户登录时延迟 15 秒启动到托盘，不会自动接管 EC；取消勾选会移除本程序的任务。
升级或移动目录后，请从新位置重新开启自启动以更新路径；删除程序前先取消勾选。
托盘退出已替换原版依赖 MSIX 包设置的回调，避免 0x80073D54 错误；菜单重建后仍自动接入。
固定转速带最低转速与温度保护。风扇请求值无法独立读回，实际转速以 RPM 为准。
EC 功能仅支持 LAPKC71E、LAPKC71F、LAPAC71H。

原版 EXE、界面资源和厂商服务程序集保持原样。运行配置新增 EC 扩展和本地 WCF netHttpBinding 注册。
文件哈希核对记录在 ec-integration-manifest.json 中。
官方服务继续使用本机已经安装的服务；本包不安装、替换服务或更新 BIOS。
需要 Windows 与 .NET Framework 4.8。

如需停用 EC 扩展：退出程序后，把 NucSoftwareStudio.exe.config.original 复制为 NucSoftwareStudio.exe.config。
'@ | Set-Content -LiteralPath (Join-Path $OutputDirectory 'EC扩展使用说明.txt') -Encoding UTF8
Copy-Item -LiteralPath (Join-Path $repoDir 'docs/official-nss-ec-integration.md') -Destination (Join-Path $OutputDirectory '功能与验收说明.md') -Force
Copy-Item -LiteralPath (Join-Path $repoDir 'docs/industrial-ui-design.md') -Destination (Join-Path $OutputDirectory '工业界面设计说明.md') -Force
Copy-Item -LiteralPath (Join-Path $repoDir 'docs/windows-installer.md') -Destination (Join-Path $OutputDirectory '安装版使用说明.md') -Force

$zipPath = $OutputDirectory + '.zip'
Remove-Item -LiteralPath (Join-Path $OutputDirectory '.ec-diagnostics') -Force -ErrorAction SilentlyContinue
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Compress-Archive -Path (Join-Path $OutputDirectory '*') -DestinationPath $zipPath -CompressionLevel Optimal
Write-Output "Official EXE SHA-256 preserved: $sourceExeHash"
Write-Output "Original files verified unchanged: $($originalFiles.Count)"
Write-Output "Application directory: $OutputDirectory"
Write-Output "Package: $zipPath"
