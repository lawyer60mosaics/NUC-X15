# NUCtool

NUCtool 是面向 Intel NUC X15/X17 及兼容 Uniwill 平台的风扇、功耗、屏幕与外设控制工具。当前支持映射包括 LAPKC71E/LAPKC71F 和 LAPAC71H；未知机型会保持安全拒绝接管。桌面应用使用 Vue 3、Element Plus 和 Tauri v2，硬件逻辑由 Rust 对接 Windows WMI / Linux sysfs 与 Uniwill 厂商服务，并带有诊断、看门狗和独立进程哨兵。

## 当前能力

### 风扇控制

- 支持静音、平衡、性能三种风扇场景。
- 后端保留 CPU/GPU 独立温度曲线；当前界面提供恒速输出上限，曲线编辑界面仍在完善。
- 支持恒速接管模式。
- 支持配置保存、加载和启动后自动接管。
- 支持异常温度过滤、转速斜坡、滞后控制和过温保护。
- 支持风扇 Actor 后台运行，前端只负责发送策略和显示状态。

### 启动策略

首页“启动与日夜策略”里有两个不同开关：

- 程序开机自启动：通过 Tauri autostart 插件写入系统自启动项，让 Windows 登录后自动启动 NUCtool。
- 启动后接管风扇：写入 `fan_config.json`，程序启动时读取保存策略并自动启动风扇控制。

两者需要同时开启，才等于“开机后程序自动起来，并自动接管风扇”。

### 哨兵与诊断

- 内置风扇 Actor 看门狗，检测采样停滞、心跳过期和风扇异常。
- 支持手动触发“哨兵重启测试”，用于验证停止/启动链路是否可用。
- Windows 下会启动独立外部哨兵进程，主程序异常退出时尝试拉起主程序。
- 首页/诊断页显示最近诊断摘要、哨兵事件、看门狗重启次数和硬件忙状态。
- 诊断日志默认位于：

```text
C:\Users\<用户名>\AppData\Roaming\com.nuc.x15.fan.cyear.app\diagnostic.log
```

### 功耗与屏幕

- 支持 CPU/GPU TDP 读取、设置和锁定。
- 支持系统功耗模式快捷应用。
- 支持屏幕刷新率读取和设置。
- 支持阅读、视频、办公、游戏、标准等屏幕场景配置。
- 屏幕切换命令带超时保护，避免 Windows 显示切换阻塞前端。

### 厂商外设

- 支持 Uniwill vendor service 状态检测。
- 支持 Whisper 模式与 FPS 目标。
- 支持电池充电模式与充电阈值。
- 支持键盘背光、灯条亮度和灯效参数。

### 界面

- 前端为 Vue 3 + TypeScript + Element Plus；部分旧 React 文件仍留在源码树中，不参与当前应用入口构建。
- 使用 MiSans 本地字体，字体文件位于 `public/fonts/MiSans-Normal.ttf`。
- 支持白天、夜晚、自动三种日夜场景，并保存到配置文件。
- 当前 UI 采用卡片网格布局，白天模式为米白背景、黑色文字和细边框；夜晚模式提高了文本对比度。
- 前端动效已关闭，优先保证稳定、可读和不卡顿。

## 技术栈

- 前端：Vue 3、TypeScript、Element Plus、Vite、Chart.js
- 桌面壳：Tauri v2
- 后端：Rust
- Windows 硬件接口：WMI、PowerShell、Uniwill vendor service
- Linux 硬件接口：sysfs
- 打包：Tauri Windows NSIS/MSI、Linux AppImage/deb（由 CI 生成）

## 目录说明

```text
src/                  Vue 3 应用与尚存的旧前端源码
src/vue/              Vue 页面、硬件状态与交互逻辑
src/hooks/            旧前端状态与 Tauri IPC Hook
src/components/       页面组件和共享控件
src/styles/           全局主题与控制面板样式
src-tauri/src/        Rust 后端
src-tauri/src/plug/   风扇、TDP、诊断、哨兵、厂商服务实现
src-tauri/icons/      主程序和哨兵图标资源
public/fonts/         前端字体资源
dist/                 Vite 构建产物
```

Intel NUC Software Studio 功能对照与当前实现状态见
[`docs/studio-feature-parity.md`](docs/studio-feature-parity.md)。部分厂商功能仍受设备能力和硬件验证范围限制；对照表会标明接入与验收状态。

## 配置与日志

配置目录：

```text
C:\Users\<用户名>\AppData\Roaming\com.nuc.x15.fan.cyear.app
```

常用文件：

```text
fan_config.json              风扇策略、启动后接管、日夜场景
diagnostic.log               诊断日志
monitor_log.csv              监控采样导出源
external_sentinel.state.json 外部哨兵状态
```

从原作者 Beta.3 升级时，程序会尝试读取旧目录
`com.cyear.nuctool/fan_config.json`，迁移到当前目录，并保留一份
`fan_config.beta3.json` 备份。

`fan_config.json` 中和启动相关的关键字段：

```json
{
  "control": {
    "startup_takeover_enabled": true
  },
  "appearance": {
    "time_theme_mode": "auto"
  }
}
```

## 开发

安装依赖：

```bash
npm install
```

启动前端预览：

```bash
npm run dev
```

启动 Tauri 开发模式：

```bash
npm run tauri:dev
```

前端构建：

```bash
npm run build
```

Tauri 打包：

```bash
npm run tauri:build
```

按时间段生成安装包：

```bash
npm run package:time
```

## 验证

前端类型检查和构建：

```bash
npm run build
```

Rust 测试：

```bash
cargo test --manifest-path .\src-tauri\Cargo.toml
```

Rust Clippy：

```bash
cargo clippy --manifest-path .\src-tauri\Cargo.toml -- -D warnings
```

## 使用注意

- Windows 下建议以管理员权限运行，否则 WMI 可能返回 `0x80041003` 拒绝访问。
- 如果提示硬件暂不可用，请等待 30 秒冷却后重试，或关闭其他正在访问 WMI/Uniwill 服务的软件。
- 如果需要开机后自动接管风扇，请同时打开“程序开机自启动”和“启动后接管风扇”。
- 退出程序时会尝试恢复系统默认风扇模式。
- 调整 TDP、风扇曲线和恒速模式有硬件风险，请确认温度和转速正常后再长期使用。

## 许可证

Copyright © 2024 cyear.

Licensed under the MIT License.
