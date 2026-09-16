@echo off
setlocal
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

echo Stanger av Plan-vy Intelligence...
echo.

echo [1/3] Tar bort automatisk start...
del "%STARTUP%\Plan-vy Intelligence.vbs" >nul 2>nul
schtasks /delete /f /tn "Plan-vy Intelligence" >nul 2>nul

echo [2/3] Stoppar servern...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq node.exe -and $_.CommandLine -like *serve-local.mjs* } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>nul

echo [3/3] Tar bort genvagen...
del "%USERPROFILE%\Desktop\Plan-vy Intelligence.url" >nul 2>nul

echo.
echo Klart. Mappen ligger kvar - kor INSTALLERA.bat nar du vill ha tillbaka den.
echo.
pause
