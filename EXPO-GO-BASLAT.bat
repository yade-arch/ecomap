@echo off
chcp 65001 >nul
cd /d "%~dp0"
title EcoMap - Expo Go
echo.
echo  Telefonda Expo Go ile asagidaki QR kodu okut.
echo  Telefon ve bilgisayar AYNI Wi-Fi aginda olmali.
echo  Bu pencere acik kaldigi surece uygulama calisir.
echo.
call npx expo start -c
pause
