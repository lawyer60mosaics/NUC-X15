# 官方 Intel NUC Software Studio 的 EC 集成

当前扩展版本：0.1.3。验证日期：2026-10-25。

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
| EC 温度、RPM、三档温控、固定转速 | 新增 C# EC 模块 | 已接入静音/平衡/性能三档，实际写入需设备复测 |
| EC 三档切换 | 新增 C# EC 模块 | 保持 EC 接管，下一采样使用新曲线，CPU/GPU 每次采样使用同一档位 |
| EC 入口 | 扩展 UI | 系统监视器同款图标/文字快捷入口，只在主页显示；自动匹配图标尺寸、字号与间距 |
| EC 互斥遮罩 | 扩展 UI | 只覆盖并禁用性能调优卡片/详情页，红字“EC控制中”；键盘、灯光等保持可用 |
| 托盘互斥 | 扩展 UI | EC 接管期间仅禁用厂商性能预设，灯光、打开、退出可用 |
| 返回主页 | 扩展 UI | EC 继续运行，保留遮罩，可返回 EC 页或停止并解锁 |
| 交还失败 | 扩展 UI | 保持遮罩与官方控制锁定，允许重试 |
| 退出 | 扩展 UI | X、Alt+F4、EC 页和托盘出口统一先交还再退出；交还失败则保留程序 |

本机 `UniwillService` 的显示名称为 `Uniwill Service`，已确认运行状态为 Running、
自动启动，58594 端口监听。本次不修改、替换或重新安装该服务。

## 验证证据与范围

- 运行诊断确认原版 EXE 加载扩展，使用原版 App、MainWindow。
- 修复 WCF 配置后，原版五个主页模块与性能详情页恢复；观察到厂商服务的实际温度/RPM。
- 22 项自动测试全部通过，并分别以 X 与托盘退出两种入口运行。覆盖快捷入口样式、三档曲线边界、
  生产控制循环热切换、高温保护、无效参数/型号拒绝、恢复失败、局部遮罩及托盘菜单重建。
  生产循环使用内存 EC 传输边界，WPF 使用模拟控制器，不访问硬件。
- Release 编译无警告、无错误。打包核对除运行配置外 199 个官方文件均保持原哈希。
  完整记录随包保存在 `ec-integration-manifest.json`。
- 已通过官方窗口右上角 X 验证退出进程；新版本的交还顺序另由 WPF 失败/成功场景验证。
- 使用原版程序集的真实 `TrayApp.Exit_Click` 委托复现 `0x80073D54`；
  将其替换为扩展安全退出回调后，真实原版委托的退出回归通过，无需执行原版构造或入口。
- 0.1.3 官方程序启动日志确认从原版 Prism 容器取到托盘单例，并完成退出回调绑定。

不将编译、界面测试或服务温度读数等同于已完成真实 EC 调速验收。

三档复用仓库已有 EC 策略的 CPU/GPU 曲线（35–85°C，间隔 5°C）。静音以低噪声
为主，平衡兼顾日常负载，性能以散热响应为主。它们不修改官方的 CPU/GPU 性能档位。
高温保护独立于档位：78°C 起提高最低转速、88°C 起相应风扇满速、95°C 紧急双风扇满速。

## 已知边界

本版是官方程序的桌面副本。原代码读取 MSIX 包身份时仍可能走其异常回退逻辑，
包括版本显示、首次启动和许可确认保存；不代表整个 Store 包的安装注册流程已迁移。
强制结束进程或进程崩溃不会执行正常退出清理；本版尚无独立进程的 EC 看护程序。

0.1.3 的退出修复只替换官方托盘退出委托，并在菜单重建/打开时重新接入。
不会全局吞掉未知异常。原版 EXE 本身仍保持原哈希。

## 复现打包与测试

```powershell
rtk proxy dotnet build integrations/IntelNucStudio.Ec.Tests -c Release
rtk proxy integrations/IntelNucStudio.Ec.Tests/bin/Release/net48/IntelNucStudio.Ec.Tests.exe
rtk proxy integrations/IntelNucStudio.Ec.Tests/bin/Release/net48/IntelNucStudio.Ec.Tests.exe --exit-via-tray --official-dir 'C:\path\extracted\NucSoftwareStudio'
rtk proxy pwsh -NoProfile -File scripts/package-intel-nss-ec.ps1 -MsixPath 'C:\path\Intel NUC Software Studio.msix'
```

官方二进制只进入本地发布包，不纳入此分支的源码提交。
