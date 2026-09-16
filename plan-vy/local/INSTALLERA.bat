@echo off
setlocal
cd /d "%~dp0"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

echo ==================================================
echo  Plan-vy Intelligence
echo  Installerar sidan sa den alltid finns pa localhost
echo ==================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js saknas. Hamta det fran nodejs.org och kor filen igen.
  echo.
  pause
  exit /b 1
)

if not exist "out\index.html" (
  echo FEL: hittar inte out\index.html
  echo INSTALLERA.bat maste ligga i samma mapp som out-mappen.
  echo.
  pause
  exit /b 1
)

echo [1/3] Startar servern i bakgrunden...
start "" wscript.exe "%~dp0start-dold.vbs"

echo [2/3] Satter igang den automatiskt vid inloggning...
> "%STARTUP%\Plan-vy Intelligence.vbs" echo CreateObject("WScript.Shell").Run "wscript.exe ""%~dp0start-dold.vbs""", 0, False
if exist "%STARTUP%\Plan-vy Intelligence.vbs" (echo       OK) else (echo       Gick inte - kor INSTALLERA.bat igen efter omstart.)

echo [3/3] Lagger en genvag pa skrivbordet...
> "%USERPROFILE%\Desktop\Plan-vy Intelligence.url" echo [InternetShortcut]
>>"%USERPROFILE%\Desktop\Plan-vy Intelligence.url" echo URL=http://localhost:4173
echo       OK

echo.
echo ==================================================
echo  Klart. Sidan finns nu pa http://localhost:4173
echo  Inget fonster behover vara oppet - stang det har.
echo.
echo  Oppna den via genvagen pa skrivbordet.
echo  Ta bort allt: kor AVINSTALLERA.bat
echo ==================================================
echo.
timeout /t 3 /nobreak >nul
start "" http://localhost:4173
pause
