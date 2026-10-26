Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "WordFunc.nsh"
!include "x64.nsh"
!include "WinVer.nsh"

!ifndef APP_VERSION
 !error "Build through package-intel-nss-installer.ps1"
!endif
!define APP_NAME "NUCtool Studio EC"
!ifdef INSTALLER_TEST_MODE
 RequestExecutionLevel user
 !define ROOT HKCU
 !define PRODUCT_KEY "Software\NUCtool\InstallerTests\${TEST_ID}"
 !define UNINSTALL_KEY "Software\NUCtool\InstallerTests\${TEST_ID}\Uninstall"
!else
 RequestExecutionLevel admin
 !define ROOT HKLM
 !define PRODUCT_KEY "Software\NUCtool\StudioEC"
 !define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\NUCtoolStudioEC"
!endif

Name "${APP_NAME}"
Caption "${APP_NAME} 安装向导"
OutFile "${OUTPUT_FILE}"
InstallDir "$PROGRAMFILES64\NUCtool Studio EC"
InstallDirRegKey ${ROOT} "${PRODUCT_KEY}" "InstallDir"
BrandingText "NUCtool · Intel NUC Software Studio / EC"
VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey /LANG=2052 "ProductName" "${APP_NAME}"
VIAddVersionKey /LANG=2052 "FileDescription" "NUCtool Studio EC 安装程序"
VIAddVersionKey /LANG=2052 "FileVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=2052 "ProductVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=2052 "LegalCopyright" "NUCtool Project"
SetCompressor /SOLID lzma
ShowInstDetails show
ShowUninstDetails show

!define MUI_ABORTWARNING
!ifdef APP_ICON
 !define MUI_ICON "${APP_ICON}"
 !define MUI_UNICON "${APP_ICON}"
!endif
!define MUI_WELCOMEPAGE_TITLE "安装 NUCtool Studio EC"
!define MUI_WELCOMEPAGE_TEXT "安装 Intel NUC Software Studio 界面与 EC 风扇扩展。$\r$\n$\r$\n安装前请交还 EC 自动控制，并从托盘退出正在运行的程序。安装器不会强制结束风扇控制进程。"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE ValidateDirectory
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\NUCtool.Studio.Launcher.exe"
!define MUI_FINISHPAGE_RUN_TEXT "运行 NUCtool Studio EC"
!define MUI_FINISHPAGE_RUN_NOTCHECKED
!define MUI_FINISHPAGE_TEXT "安装完成。可从开始菜单或桌面快捷方式启动，程序启动时会申请管理员权限。$\r$\n$\r$\n开机自启动请在程序的托盘菜单中设置。"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
!insertmacro MUI_LANGUAGE "SimpChinese"

Var PreviousInstDir
Var HelperExe
Var ShortcutRoot
Var DesktopLink
Var SetupMutex

!macro RunningGuard PREFIX
Function ${PREFIX}CheckRunning
 !ifndef INSTALLER_TEST_MODE
 retry:
  StrCpy $0 1
  ClearErrors
  ExecWait '$\"$HelperExe$\" --check-running' $0
  ${If} $0 == 0
   Return
  ${EndIf}
  ${If} $0 == 20
   MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Intel NUC Software Studio 仍在运行（可能已隐藏到托盘）。$\r$\n$\r$\n请先在 EC 页交还自动控制，再从托盘选择“退出”，然后重试。厂商服务不需要停止。" /SD IDCANCEL IDRETRY retry
  ${Else}
   MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "无法确认程序是否已退出。请检查安装文件完整性后重试。" /SD IDCANCEL IDRETRY retry
  ${EndIf}
  SetErrorLevel 1
  Abort
 !endif
FunctionEnd
!macroend
!insertmacro RunningGuard ""
!insertmacro RunningGuard "un."

!macro SetupLock PREFIX
Function ${PREFIX}AcquireSetupLock
 System::Call 'kernel32::CreateMutexW(p 0, i 0, w "NUCtoolStudioEC.Setup.${PRODUCT_ID}") p.r0 ?e'
 Pop $1
 StrCpy $SetupMutex $0
 ${If} $0 == 0
 ${OrIf} $1 == 183
  MessageBox MB_OK|MB_ICONSTOP "无法取得安装锁，或已有安装/卸载程序正在运行。请等待完成后重试。" /SD IDOK
  SetErrorLevel 1
  Abort
 ${EndIf}
FunctionEnd
!macroend
!insertmacro SetupLock ""
!insertmacro SetupLock "un."

Function .onInit
 SetRegView 64
 SetShellVarContext all
 ${IfNot} ${RunningX64}
  MessageBox MB_OK|MB_ICONSTOP "需要 64 位 Windows 10 或更新版本。" /SD IDOK
  SetErrorLevel 1
  Abort
 ${EndIf}
 ${IfNot} ${AtLeastWin10}
  MessageBox MB_OK|MB_ICONSTOP "需要 Windows 10 或更新版本。" /SD IDOK
  SetErrorLevel 1
  Abort
 ${EndIf}
 ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full" "Release"
 ${If} $0 < 528040
  MessageBox MB_OK|MB_ICONSTOP "请先安装 .NET Framework 4.8 或更新版本，再运行本安装程序。" /SD IDOK
  SetErrorLevel 1
  Abort
 ${EndIf}
 !ifdef INSTALLER_TEST_MODE
  StrCpy $INSTDIR "${TEST_INSTALL_DIR}"
 !endif
 Call AcquireSetupLock
 ReadRegStr $PreviousInstDir ${ROOT} "${PRODUCT_KEY}" "InstallDir"
 ${If} $PreviousInstDir != ""
  StrCpy $INSTDIR $PreviousInstDir
 ${EndIf}
 ReadRegStr $0 ${ROOT} "${PRODUCT_KEY}" "Version"
 ${If} $0 != ""
  ${VersionCompare} "${APP_VERSION}" "$0" $1
  ${If} $1 == 2
   MessageBox MB_OK|MB_ICONSTOP "已安装更新版本。若要安装旧版本，请先卸载。" /SD IDOK
   SetErrorLevel 1
   Abort
  ${EndIf}
 ${EndIf}
 InitPluginsDir
 SetOutPath "$PLUGINSDIR\NucStudioSetup"
 File "${PAYLOAD_DIR}\NUCtool.Studio.Launcher.exe"
 File "${PAYLOAD_DIR}\NUCtool.Studio.Launcher.exe.config"
 File "${PAYLOAD_DIR}\IntelNucStudio.Ec.dll"
 StrCpy $HelperExe "$PLUGINSDIR\NucStudioSetup\NUCtool.Studio.Launcher.exe"
 Call CheckRunning
FunctionEnd

Function ValidateDirectory
 ${If} $PreviousInstDir != ""
 ${AndIf} $INSTDIR != $PreviousInstDir
  MessageBox MB_OK|MB_ICONEXCLAMATION "覆盖升级请沿用原安装目录。若要更换目录，请先卸载旧版本。" /SD IDOK
  SetErrorLevel 1
  Abort
 ${EndIf}
 !ifdef INSTALLER_TEST_MODE
  StrCmp $INSTDIR "${TEST_INSTALL_DIR}" valid
 !else
  StrCpy $0 1
  ExecWait '$\"$HelperExe$\" --validate-directory $\"$INSTDIR$\"' $0
  ${If} $0 == 0
   Goto valid
  ${EndIf}
 !endif
 MessageBox MB_OK|MB_ICONEXCLAMATION "请选择新的空目录，或本程序以前的安装目录。不能选择磁盘根目录或其他软件所在目录。" /SD IDOK
 SetErrorLevel 1
 Abort
 valid:
FunctionEnd

Section "程序文件（必选）" MainFiles
 SectionIn RO
 Call ValidateDirectory
 Call CheckRunning
 SetOverwrite on
 !include "${INSTALL_FILES}"
 SetOutPath "$INSTDIR"
 WriteINIStr "$INSTDIR\installation-mode.ini" "Installation" "ProductId" "${PRODUCT_ID}"
 WriteINIStr "$INSTDIR\installation-mode.ini" "Installation" "Version" "${APP_VERSION}"
 !ifndef INSTALLER_TEST_MODE
  ExecWait '$\"$HelperExe$\" --update-startup $\"$INSTDIR$\" $\"$PreviousInstDir$\"' $0
  ${If} $0 != 0
   MessageBox MB_OK|MB_ICONEXCLAMATION "程序文件已安装，但未能更新已有自启动项。请启动程序后在托盘菜单重新设置“开机自启动”。" /SD IDOK
  ${EndIf}
 !endif
 !ifdef INSTALLER_TEST_MODE
  StrCpy $ShortcutRoot "$INSTDIR\.installer-test-shortcuts"
 !else
  StrCpy $ShortcutRoot "$SMPROGRAMS\NUCtool Studio EC"
 !endif
 CreateDirectory "$ShortcutRoot"
 CreateShortCut "$ShortcutRoot\NUCtool Studio EC.lnk" "$INSTDIR\NUCtool.Studio.Launcher.exe" "" "$INSTDIR\NucSoftwareStudio.exe" 0
 WriteUninstaller "$INSTDIR\Uninstall.exe"
 CreateShortCut "$ShortcutRoot\卸载 NUCtool Studio EC.lnk" "$INSTDIR\Uninstall.exe"
 WriteRegStr ${ROOT} "${PRODUCT_KEY}" "InstallDir" "$INSTDIR"
 WriteRegStr ${ROOT} "${PRODUCT_KEY}" "Version" "${APP_VERSION}"
 WriteRegStr ${ROOT} "${UNINSTALL_KEY}" "DisplayName" "${APP_NAME}"
 WriteRegStr ${ROOT} "${UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
 WriteRegStr ${ROOT} "${UNINSTALL_KEY}" "Publisher" "NUCtool Project"
 WriteRegStr ${ROOT} "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
 WriteRegStr ${ROOT} "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\NucSoftwareStudio.exe"
 WriteRegStr ${ROOT} "${UNINSTALL_KEY}" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
 WriteRegStr ${ROOT} "${UNINSTALL_KEY}" "QuietUninstallString" '$\"$INSTDIR\Uninstall.exe$\" /S'
 WriteRegDWORD ${ROOT} "${UNINSTALL_KEY}" "NoModify" 1
 WriteRegDWORD ${ROOT} "${UNINSTALL_KEY}" "NoRepair" 1
 WriteRegDWORD ${ROOT} "${UNINSTALL_KEY}" "EstimatedSize" ${INSTALL_SIZE}
SectionEnd

Section "创建桌面快捷方式" DesktopShortcut
 !ifdef INSTALLER_TEST_MODE
  StrCpy $DesktopLink "$ShortcutRoot\Desktop.lnk"
 !else
  StrCpy $DesktopLink "$DESKTOP\NUCtool Studio EC.lnk"
 !endif
 CreateShortCut "$DesktopLink" "$INSTDIR\NUCtool.Studio.Launcher.exe" "" "$INSTDIR\NucSoftwareStudio.exe" 0
SectionEnd

Function un.onInit
 SetRegView 64
 SetShellVarContext all
 Call un.AcquireSetupLock
 !ifdef INSTALLER_TEST_MODE
  StrCmp $INSTDIR "${TEST_INSTALL_DIR}" +3
  SetErrorLevel 1
  Abort
 !endif
 ReadINIStr $0 "$INSTDIR\installation-mode.ini" "Installation" "ProductId"
 ${If} $0 != "${PRODUCT_ID}"
  MessageBox MB_OK|MB_ICONSTOP "无法确认安装目录归属，已停止卸载。请重新安装本程序后再卸载。" /SD IDOK
  SetErrorLevel 1
  Abort
 ${EndIf}
 StrCpy $HelperExe "$INSTDIR\NUCtool.Studio.Launcher.exe"
 Call un.CheckRunning
FunctionEnd

Section "Uninstall"
 Call un.CheckRunning
 !ifndef INSTALLER_TEST_MODE
 retry_cleanup:
  StrCpy $0 1
  ExecWait '$\"$HelperExe$\" --remove-startup $\"$INSTDIR$\"' $0
  ${If} $0 != 0
   MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "未能清理本安装目录的自启动任务。请检查 Windows 任务计划程序服务后重试。程序文件尚未删除。" /SD IDCANCEL IDRETRY retry_cleanup
   SetErrorLevel 1
   Abort
  ${EndIf}
 !endif
 ClearErrors
 !include "${UNINSTALL_FILES}"
 ${If} ${Errors}
  MessageBox MB_OK|MB_ICONEXCLAMATION "部分程序文件未能删除。请关闭占用这些文件的程序后重新卸载。" /SD IDOK
  SetErrorLevel 1
  Abort
 ${EndIf}
 Delete /REBOOTOK "$INSTDIR\NUCtool.Studio.Launcher.exe"
 Delete /REBOOTOK "$INSTDIR\NUCtool.Studio.Launcher.exe.config"
 Delete /REBOOTOK "$INSTDIR\IntelNucStudio.Ec.dll"
 !ifdef INSTALLER_TEST_MODE
  StrCpy $ShortcutRoot "$INSTDIR\.installer-test-shortcuts"
  StrCpy $DesktopLink "$ShortcutRoot\Desktop.lnk"
 !else
  StrCpy $ShortcutRoot "$SMPROGRAMS\NUCtool Studio EC"
  StrCpy $DesktopLink "$DESKTOP\NUCtool Studio EC.lnk"
 !endif
 Delete "$DesktopLink"
 Delete "$ShortcutRoot\NUCtool Studio EC.lnk"
 Delete "$ShortcutRoot\卸载 NUCtool Studio EC.lnk"
 RMDir "$ShortcutRoot"
 DeleteRegKey ${ROOT} "${PRODUCT_KEY}"
 DeleteRegKey ${ROOT} "${UNINSTALL_KEY}"
 Delete "$INSTDIR\installation-mode.ini"
 Delete /REBOOTOK "$INSTDIR\Uninstall.exe"
 !include "${UNINSTALL_DIRS}"
 RMDir "$INSTDIR"
SectionEnd
