# Windows 安装版

版本 0.1.7，2026-10-26。发布入口为 `IntelNUCSoftwareStudio-EC-0.1.7-Setup.exe`。

## 使用

1. 先在旧版 EC 页面交还自动控制，再从托盘“退出”程序。
2. 运行安装包并允许管理员权限，首次安装可选择目录，默认 `C:\Program Files\NUCtool Studio EC`。
3. 从开始菜单或桌面快捷方式启动。新增启动器申请管理员权限后，在安装目录启动原版
   `NucSoftwareStudio.exe`；原版程序、工业主题和 EC 页仍在同一个官方程序进程中运行。
4. 开机自启动仍由托盘菜单设置。首次安装不会自动开启 EC 或新增自启动任务。
5. 可在 Windows“已安装的应用”或开始菜单中卸载。

系统要求为 64 位 Windows 10 / 11、.NET Framework 4.8 或更新版本，以及已安装的 Uniwill Service。
本安装包不安装或替换厂商服务、驱动和 BIOS。安装包与新增启动器尚未进行代码签名。

## 安装与升级

- 使用现有 NSIS 3.11 编译中文 Modern UI 安装向导。安装文件、快捷方式和卸载登记使用
  独立产品标识，不覆盖已安装的官方 MSIX 应用登记。
- 安装位置拒绝磁盘根目录、相对路径和不属于本程序的非空目录。
- 升级沿用原安装目录，拒绝直接降级。要改变目录，先卸载再安装，避免留下旧副本。
- 安装和卸载使用同一进程互斥锁。检查发现官方界面仍在运行时，只允许用户退出后重试或取消；
  不杀进程、不停止服务，也不替用户发送风扇交还请求。
- 对本用户原有便携版自启动，更新到安装路径；其他用户的任务仅在指向以前登记的安装目录时更新。
  保留任务的用户、启用/停用、触发条件等设置。没有原有任务时不创建新任务。
- 路径迁移失败会显示提示，程序文件仍可安装，用户可从托盘重新设置自启动。

## 卸载边界

- 先确认 GUI 已退出，再删除本产品标识且指向本安装目录的自启动任务。
  自启动清理失败则停止删除程序文件，允许重试。
- 删除文件清单由打包时的有效载荷生成，只删除确切的安装文件和本程序快捷方式；目录只在空时移除，
  不使用递归删除安装目录。用户自行放入目录的文件保留。
- 维护启动器和 EC DLL 在其他文件删除成功后才清理；必要时这几个确切路径可进入 Windows 重启删除队列。
- 厂商服务、其他软件任务、其他便携版以及用户原有设置不由本卸载器删除。

## 构建

```powershell
rtk proxy pwsh -NoProfile -File scripts/package-intel-nss-ec.ps1 -NssSourceDir 'C:\path\NucSoftwareStudio' -OutputDirectory 'D:\path\payload'
rtk proxy pwsh -NoProfile -File scripts/package-intel-nss-installer.ps1 -PayloadDirectory 'D:\path\payload'
```

编译器优先使用本机 `makensis.exe`，其次使用已存在的 Tauri NSIS 缓存或标准 NSIS 安装路径；
缺失时仅给出安装命令，不自动下载安装工具。构建先校验有效载荷中原版 EXE、扩展 DLL 和启动器的哈希。
NSIS 输出旁的 `.exe.json` 记录版本、文件数、原版哈希、安装包哈希及测试模式标识。

## 已验证与待验证

- 43 项 WPF / 控制逻辑自动场景通过。新增安装场景验证自启动迁移、权限/写入失败、任务归属、
  清理范围、升级幂等性和安装目录安全。
- 使用 NSIS 的隔离测试版本完成安装 → 覆盖升级/修复 → 卸载三阶段；逐个校验全部安装文件哈希，
  验证快捷方式与登记创建/删除、版本更新，并验证目录内自建文件在升级和卸载后保留。
- 隔离测试安装目录位于 `artifacts/nss-ec/installer-smoke/<随机 ID>/app`，登记在 HKCU 的专用测试键，
  快捷方式也只在测试目录内；不启动主程序、不写真实自启动任务、不写 Program Files 或公共快捷方式。
- 生产安装包使用管理员权限、HKLM 和公共快捷方式；当前非提升测试环境尚未进行生产安装包的
  管理员安装/卸载及真实任务迁移验收。这里不把隔离测试等同于该实机验收。

隔离测试复现：

```powershell
rtk proxy pwsh -NoProfile -File scripts/test-intel-nss-installer.ps1 -PayloadDirectory 'D:\path\payload'
```
