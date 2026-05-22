@echo off
setlocal enabledelayedexpansion

:: 获取当前日期和时间
for /f "tokens=1-6 delims= " %%a in ('wmic os get localdatetime ^| find "."') do (
    set year=%%a
    set month=%%b
    set day=%%c
    set hour=%%d
    set minute=%%e
    set second=%%f
)

:: 格式化为 YYYY.MM.DD.HHMM
set VERSION=%year:~0,4%.%month:~0,2%.%day:~0,2%.%hour:~0,2%%minute:~0,2%
echo 构建版本: %VERSION%

:: 替换 tauri.conf.json 中的版本号
cd /d "%~dp0src-tauri"
powershell -Command "(Get-Content tauri.conf.json) -replace '__VERSION__', '%VERSION%' | Set-Content tauri.conf.json"

echo 版本号已更新为: %VERSION%

:: 执行 Tauri 构建
cd /d "%~dp0"
npm run build

:: 恢复原版本号（可选，如果不恢复则保留当前日期版本）
cd /d "%~dp0src-tauri"
powershell -Command "(Get-Content tauri.conf.json) -replace '%VERSION%', '__VERSION__' | Set-Content tauri.conf.json"

echo 构建完成
pause
