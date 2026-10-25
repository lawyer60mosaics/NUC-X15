# 官方 Intel NUC Software Studio 的 EC 集成

当前扩展版本：0.1.1。验证日期：2026-10-25。

## 程序与接入方式

启动入口为原版 `NucSoftwareStudio.exe`，实际窗口类型为
`NucSoftwareStudio.Views.MainWindow`，应用类型为 `NucSoftwareStudio.App`。
原版 EXE、WPF/BAML 资源、Prism 模块及 Uniwill 客户端均保留；C# EC 扩展在
同一进程中增加控件，不调用 Rust/Tauri，也不创建另一个 EC 窗口。

运行配置增加 .NET Framework 4.8、`netHttpBinding` 显式注册和
`IntelNucStudio.Ec.EcDomainManager`。原来的配置会备份为
`NucSoftwareStudio.exe.config.original`。

## 功能对照

| 功能 | 实现归属 | 本次状态 |
| --- | --- | --- |
| 系统配置、系统键、电池设置 | 官方 MobileKeyboardSettingsMgr / MobileBatterySettingsMgr | 原程序集保留，主页恢复显示 |
| 性能调优、AC/DC 配置、基准、被动散热、WhisperMode | 官方 MobilePerformanceMgr | 原页面保留，实际性能详情页已显示 |
| 标准/游戏/视频/阅读/自定义显示 | 官方 MobileDisplayModeMgr | 原页面与服务逻辑保留 |
| 键盘灯与光条 | 官方 MobileKeyboardLedMgr / MobileLightBarLedMgr | 原页面与服务逻辑保留 |
| 系统监视器 | 官方 SystemMonitorMgr | 原程序集保留，主页已有温度与 RPM 服务读数 |
| EC 温度、RPM、温控曲线、固定转速 | 新增 C# EC 模块 | 已接入官方窗口，实际写入需设备复测 |
| EC 入口 | 扩展 UI | 仅官方主页显示；详情页、设置页和 EC 页隐藏 |
| EC 互斥遮罩 | 扩展 UI | 接管期间红字“EC控制中”，禁用官方设备内容区 |
| 返回主页 | 扩展 UI | EC 继续运行，保留遮罩，可返回 EC 页或停止并解锁 |
| 交还失败 | 扩展 UI | 保持遮罩与官方控制锁定，允许重试 |
| 退出 | 扩展 UI | X、Alt+F4、EC 页退出入口先交还再退出；交还失败则保留程序 |

本机 `UniwillService` 的显示名称为 `Uniwill Service`，已确认运行状态为 Running、
自动启动，58594 端口监听。本次不修改、替换或重新安装该服务。

## 验证证据与范围

- 运行诊断确认原版 EXE 加载扩展，使用原版 App、MainWindow。
- 修复 WCF 配置后，原版五个主页模块与性能详情页恢复；观察到厂商服务的实际温度/RPM。
- 新增 WPF 界面测试覆盖七项导航、遮罩、交还失败和退出场景，全部通过。
  测试运行真实 WPF 控件与 dispatcher，EC 边界使用模拟实现，不访问硬件。
- Release 编译无警告、无错误。打包核对除运行配置外 199 个官方文件均保持原哈希。
  完整记录随包保存在 `ec-integration-manifest.json`。
- 已通过官方窗口右上角 X 验证退出进程；新版本的交还顺序另由 WPF 失败/成功场景验证。

不将编译、界面测试或服务温度读数等同于已完成真实 EC 调速验收。

## 已知边界

本版是官方程序的桌面副本。原代码读取 MSIX 包身份时仍可能走其异常回退逻辑，
包括版本显示、首次启动和许可确认保存；不代表整个 Store 包的安装注册流程已迁移。
强制结束进程或进程崩溃不会执行正常退出清理；本版尚无独立进程的 EC 看护程序。

## 复现打包与测试

```powershell
rtk proxy dotnet build integrations/IntelNucStudio.Ec.Tests -c Release
rtk proxy integrations/IntelNucStudio.Ec.Tests/bin/Release/net48/IntelNucStudio.Ec.Tests.exe
rtk proxy pwsh -NoProfile -File scripts/package-intel-nss-ec.ps1 -MsixPath 'C:\path\Intel NUC Software Studio.msix'
```

官方二进制只进入本地发布包，不纳入此分支的源码提交。
