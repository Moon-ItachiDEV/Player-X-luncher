@echo off
chcp 65001 >nul
title Publier une version de Player X
rem Double-clic : signe la version (mot de passe), range les 3 fichiers dans un dossier, ouvre ce dossier et la page GitHub.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js est introuvable. Installe-le depuis nodejs.org, puis recommence. & pause & exit /b 1)
if not exist package.json (echo Ce fichier doit rester dans le dossier de Player X, a cote de package.json. & pause & exit /b 1)
for /f "usebackq delims=" %%v in (`node -p "require('./package.json').version"`) do set VERSION=%%v
echo.
echo   Publication de Player X %VERSION%
echo.
node scripts\publier-maj.mjs
if errorlevel 1 (echo. & echo Rien n'a ete publie. Lis le message ci-dessus. & pause & exit /b 1)
for %%f in (dist\Player-X-*Setup-%VERSION%.exe) do copy /y "%%f" dist\maj\ >nul
explorer "%~dp0dist\maj"
start "" "https://github.com/Moon-ItachiDEV/player-x-luncher/releases/new?tag=v%VERSION%&title=Player%%20X%%20%VERSION%"
echo.
echo   Le dossier avec les 3 fichiers et la page GitHub sont ouverts.
echo   Glisse les 3 fichiers dans la page, puis clique sur « Publish release ».
echo.
pause
