@echo off
chcp 65001 >nul
cd /d "%~dp0"
title EcoMap - APK olusturma
set EAS_NO_VCS=1
set EXPO_NO_TELEMETRY=1
if exist expo-token.txt set /p EXPO_TOKEN=<expo-token.txt

echo.
echo  ============================================
echo   EcoMap - telefona kurulacak APK olusturma
echo  ============================================
echo.

echo [1/3] Yeni harita bileseni kuruluyor...
call npx --yes expo install react-native-webview
if errorlevel 1 goto hata

echo.
echo [2/3] Proje Expo hesabina baglaniyor...
call npx --yes eas-cli@latest init --non-interactive --force
if errorlevel 1 goto hata

echo.
echo [3/3] APK derleniyor. Bu 10-20 dakika surer, pencereyi KAPATMA.
echo.
call npx --yes eas-cli@latest build -p android --profile preview --non-interactive --wait
if errorlevel 1 goto hata

if exist expo-token.txt del /q expo-token.txt
echo.
echo  ============================================
echo   BITTI! Yukaridaki linki telefonla ac,
echo   APK'yi indir ve kur.
echo  ============================================
pause
exit /b 0

:hata
echo.
echo  !!! Bir hata oldu. Bu pencerenin ekran goruntusunu Claude'a gonder.
pause
exit /b 1
