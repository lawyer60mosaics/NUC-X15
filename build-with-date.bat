@echo off
setlocal
cd /d "%~dp0"
node build-with-date.js %*
pause
