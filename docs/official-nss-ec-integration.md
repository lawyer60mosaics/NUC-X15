# 官方 Intel NUC Software Studio 的 EC 集成

当前扩展版本：0.1.6。验证日期：2026-10-26。

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
| 主界面及控件工业主题 | 运行时 WPF 资源/样式扩展 | 保留五块布局，统一深蓝面板、细边框、标题分隔线、字体与控件外观 |
| EC 温度、RPM、三档温控、固定转速 | 新增 C# EC 模块 | 已接入静音/平衡/性能三档，实际写入需设备复测 |
| EC 三档切换 | 新增 C# EC 模块 | 保持 EC 接管，下一采样使用新曲线，CPU/GPU 每次采样使用同一档位 |
| EC 入口 | 扩展 UI | 系统监视器同款图标/文字快捷入口，只在主页显示；跟随图标与字号缩放，按自身文字宽度布局，字号不低于 12 DIP，避免长文字裁切 |
| EC 互斥遮罩 | 扩展 UI | 只覆盖并禁用性能调优卡片/详情页，红字“EC控制中”；键盘、灯光等保持可用 |
| 托盘互斥 | 扩展 UI | EC 接管期间仅禁用厂商性能预设，灯光、打开、退出可用 |
| 开机自启动 | 扩展托盘菜单 | 当前用户登录后延迟 15 秒，以管理员权限启动到托盘；不自动接管 EC，可关闭并删除本程序任务 |
| 返回主页 | 扩展 UI | EC 继续运行，保留遮罩，可返回 EC 页或停止并解锁 |
| 交还失败 | 扩展 UI | 保持遮罩与官方控制锁定，允许重试 |
| 隐藏窗口 | 扩展 UI | 右上角 X、Alt+F4 隐藏到托盘；程序及 EC 控制继续运行，恢复窗口时保留原状态 |
| 退出 | 扩展 UI | EC 页“退出程序”或托盘“退出”先交还 EC，再退出；交还失败则保留程序 |

本机 `UniwillService` 的显示名称为 `Uniwill Service`，已确认运行状态为 Running、
自动启动，58594 端口监听。本次不修改、替换或重新安装该服务。

## 验证证据与范围

- 运行诊断确认原版 EXE 加载扩展，使用原版 App、MainWindow。
- 修复 WCF 配置后，原版五个主页模块与性能详情页恢复；观察到厂商服务的实际温度/RPM。
- 39 项自动检查全部通过，并分别以 EC 页“退出程序”与托盘“退出”两种入口运行。覆盖快捷入口样式、三档曲线边界、
  生产控制循环热切换、高温保护、无效参数/型号拒绝、恢复失败、局部遮罩及托盘菜单重建。
  生产循环使用内存 EC 传输边界，WPF 使用模拟控制器，不访问硬件。
- 入口布局回归覆盖 640 / 1000 / 1600 DIP 窗口宽度与 75% / 100% / 125% / 150% / 200%
  主页布局缩放的 15 种组合，检查完整文字宽度、上下左右边界、可读字号和图标对齐。
  该测试使用模拟主页控件，并非在五种 Windows DPI 设置下运行官方程序的实机验收。
- Release 编译无警告、无错误。打包核对除运行配置外 199 个官方文件均保持原哈希。
  完整记录随包保存在 `ec-integration-manifest.json`。
- 0.1.4 的窗口 X、Enter/Space、无障碍 Click、Alt+F4 和系统关闭由 WPF 场景验证：
  仅隐藏窗口，保留 EC 运行状态与性能互斥，重新显示时保留页面；显式退出才交还 EC。
- 使用原版程序集的真实 `TrayApp.Exit_Click` 委托复现 `0x80073D54`；
  将其替换为扩展安全退出回调后，真实原版委托的退出回归通过，无需执行原版构造或入口。
- 0.1.3 官方程序启动日志确认从原版 Prism 容器取到托盘单例，并完成退出回调绑定。
- 自启动测试覆盖默认关闭、开启/删除/重复设置、旧路径更新、外部停用、权限不足、任务归属、
  路径含空格/中文/XML 特殊字符、并发点击、写入和读回失败、菜单重建，以及托盘启动的不可见窗口初始化。
  配置写入使用内存替身；本机 Windows Task Scheduler 接受任务定义并正确识别不存在的任务。
  当前测试进程未提升权限，没有实际创建自启动任务，也没有进行注销或重启后的启动验收。
- 工业主题检查包含原版五个主页 BAML 视图的空模型渲染，以及原版控件样式换肤后的命令、
  双向绑定、下拉框编辑/弹出、不可用状态、键盘步进；EC 页面在四种桌面宽度下重排并可滚动到交还按钮。
  主界面测试使用空数据，不连接厂商服务；完整管理员窗口的设备操作另需本机确认。

工业主题的视觉规范和实现边界见 `docs/industrial-ui-design.md`。

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

## 开机自启动

首次使用默认关闭。先把完整程序解压到长期保留的位置，以管理员身份启动，右键托盘图标，
勾选“开机自启动”。菜单勾选来自任务实际配置读回；权限不足或写入失败会显示原因，允许重试。
取消勾选会删除本程序为当前用户创建的任务，不影响其他程序的启动项。

实现使用 Windows 自带 `schtasks.exe` 建立任务 `NUCtool.IntelNucStudio.EC.<当前用户 SID>`，
仅当前用户登录触发，延迟 15 秒，以当前用户交互式令牌和最高可用权限运行，不保存密码。
动作直接指向当前 `NucSoftwareStudio.exe`，参数为原版支持的 `tray`，工作目录为程序目录。
允许电池供电、禁止同一个计划任务重复运行、不设置后台运行时限。这里的重复运行保护限于计划任务，
不等于对用户手动启动的其他副本施加全局单实例限制。

自启动只启动程序；EC 风扇仍需手动开启。升级或移动程序后，在新位置重新开启一次以更新任务路径。
删除程序前请先取消勾选，避免留下指向不存在文件的任务。不可见初始化会加载官方 WPF 模板以便接入
托盘扩展，但不会主动显示窗口或开启 EC 控制。

## 复现打包与测试

```powershell
rtk proxy dotnet build integrations/IntelNucStudio.Ec.Tests -c Release
rtk proxy integrations/IntelNucStudio.Ec.Tests/bin/Release/net48/IntelNucStudio.Ec.Tests.exe
rtk proxy integrations/IntelNucStudio.Ec.Tests/bin/Release/net48/IntelNucStudio.Ec.Tests.exe --exit-via-tray --official-dir 'C:\path\extracted\NucSoftwareStudio' --task-scheduler-check
rtk proxy pwsh -NoProfile -File scripts/package-intel-nss-ec.ps1 -MsixPath 'C:\path\Intel NUC Software Studio.msix'
```

官方二进制只进入本地发布包，不纳入此分支的源码提交。
