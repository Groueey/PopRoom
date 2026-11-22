@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "WIFI_IP="
for /f "usebackq delims=" %%i in (`node -e "const nets=require('os').networkInterfaces();for(const [k,v] of Object.entries(nets)){if(/^(wi-?fi|wlan|wireless|无线)/i.test(k)&&!/direct|virtual/i.test(k)){for(const n of v||[]){if(n.family==='IPv4'&&!n.internal&&!n.address.startsWith('169.254.')&&!n.address.startsWith('198.18.')){console.log(n.address);process.exit(0);}}}}"`) do (
  set "WIFI_IP=%%i"
)

if "%WIFI_IP%"=="" (
  echo [错误] 未检测到有效的 Wi-Fi IPv4 地址，请检查电脑是否已连接 Wi-Fi。
  pause
  exit /b 1
)

echo ==================================================
echo   PopRoom Expo 一键启动 (强制真实 Wi-Fi IP)
echo   Wi-Fi IP : %WIFI_IP%
echo ==================================================
echo.

set "REACT_NATIVE_PACKAGER_HOSTNAME=%WIFI_IP%"
call npx expo start --host lan %*

if errorlevel 1 (
  echo.
  echo [提示] Expo 服务已退出，错误码: %errorlevel%
  pause
)
