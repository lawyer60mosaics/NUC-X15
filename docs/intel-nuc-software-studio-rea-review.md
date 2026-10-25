# Intel NUC Software Studio MSIX：REA 静态检查

检查对象：`C:\Users\Developer\Downloads\nuc服务加控制台与最后超频BIOS\Intel NUC Software Studio.msix`，已安装版本 `1.44.25758.0`。以下是程序集元数据、CIL 调用边和实际界面观察，不等于硬件操作成功的证明。分析仅静态读取，未执行安装包代码或写入硬件。

## 代码结构

- 主程序是 .NET Framework 4.6.1 / WPF / Prism；首页由独立 summary 视图组合，不是左侧导航站点。详情页模块包括 `MobilePerformanceMgr.dll`、`MobileDisplayModeMgr.dll`、`MobileKeyboardLedMgr.dll`、`MobileLightBarLedMgr.dll`、`MobileBatterySettingsMgr.dll`、`SystemMonitorMgr.dll`。
- 核心桥接是 `UniwillSdkClient.dll` 的 `UniwillSdkClient.UniwillService.IUniwillService`。MSIX 中未发现 `NUCtool.dll`。当前项目的 `NUCtool.dll` 路线不是官方 MSIX 界面的原始调用链。
- `MobilePerformanceMgr.Models.MobilePerformanceSettingsMgr` 暴露 `SelectedProfile`、`CurrentProfiles`、`BenchmarkMode`、`PassiveCoolingMode`、`WhisperMode`；调用边可见 `ApplyProfile`、`UpdateProfile`、`GetDefaultProfiles`、`ApplyBenchmarkMode`。配置含 AC/DC 下的 CPU、dGPU、风扇模式，不能等同于当前项目单一全局档位。
- `MobileDisplayModeMgr.ViewModels.MobileDisplayModeSettingsMgr` 有 Standard / Gaming / Video / Reading / Custom，支持 AC/DC 亮度、对比度、色温、RGB 滑块；调用边可见 `SetDisplayMode`、`UpdateDisplayModeAsync`、`GetCurrentDisplayMode`。
- `MobileKeyboardLedMgr.Models.KeyboardProfileManager` 管理配置文件、灯效、颜色、方向、速度、逐键区域、AC/DC 亮度及闲置定时。光条管理器区分 AC/DC 颜色、彩虹/呼吸效果及延时。当前项目没有验证过的完整对应写入接口。
- `MobileBatterySettingsMgr.ViewModels.BatteryChargeLimitViewModel` 区分 `AcMode`、`Custom`、`BestBattery`，设置充电阈值只是其一。不能凭单个阈值接口宣称已实现“最佳电池健康”。
- `IUniwillService` 还列有 `GetFanCurve`、`SetFanTable`、`RestoreFanCurve`、`GetSupportedFeatures`、`GetBatteryState`、`GetCurrentKeyboardLedProfile`、`GetCurrentLightbarProfile` 等。当前项目坚持 EC 独立风扇控制，官方这部分服务逻辑没有被直接复用。

## 对当前界面的落实

按实际运行画面实现了首页上方“系统配置 / 性能调优”、下方“显示设置 / 键盘 / 光条”五块、系统监视器入口及五个详情页。已验证的当前项目操作才开放：全局 DLL 性能档位、EC 风扇策略、充电阈值、基础键盘开关/亮度、四个显示预设请求。官方存在但尚未验证的 AC/DC 独立配置、被动散热、WhisperMode、灯光颜色/效果、自定义显示滑块都置灰；不能读回的值标为“—”或“最近请求”。

## 证据定位

REA `inspect-managed-members`：`MobilePerformanceMgr.dll` 的 `MobilePerformanceMgr.Models.MobilePerformanceSettingsMgr`、`MobileDisplayModeMgr.dll` 的 `MobileDisplayModeMgr.ViewModels.MobileDisplayModeSettingsMgr`、`MobileKeyboardLedMgr.dll` 的 `MobileKeyboardLedMgr.Models.KeyboardProfileManager`、`MobileLightBarLedMgr.dll` 的 `MobileLightBarLedMgr.ViewModels.MobileLightbarSettingsMgr`、`MobileBatterySettingsMgr.dll` 的 `MobileBatterySettingsMgr.ViewModels.BatteryChargeLimitViewModel`、`UniwillSdkClient.dll` 的 `UniwillSdkClient.UniwillService.IUniwillService`。每个结论仍需在目标机器上做服务/硬件回读验证。
