@echo off
chcp 65001 >nul
title Publier une version de Player X
rem Double-clic : signe la version et l'envoie sur GitHub. La première fois, une mise en place (mot de passe + jeton GitHub).
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js est introuvable. Installe-le depuis nodejs.org, puis recommence. & pause & exit /b 1)
if not exist package.json (echo Ce fichier doit rester dans le dossier de Player X, a cote de package.json. & pause & exit /b 1)
for /f "usebackq delims=" %%v in (`node -p "require('./package.json').version"`) do set VERSION=%%v
echo.
echo   Publication de Player X %VERSION%
echo.
if exist "%USERPROFILE%\.player-x\cle-maj.coffre" goto publier
echo   Premiere fois sur ce PC : mise en place (une seule fois).
echo.
echo   1. Une page GitHub s'ouvre pour creer un jeton :
echo        - Token name : Player X
echo        - Expiration : No expiration (ou 1 an)
echo        - Repository access : Only select repositories, puis player-x-luncher
echo        - Permissions, Repository permissions, Contents : Read and write
echo        - Generate token, puis copie le jeton (github_pat_...)
echo   2. Reviens ici : tape ton mot de passe, puis colle le jeton (clic droit) et Entree.
echo.
start "" "https://github.com/settings/personal-access-tokens/new"
node scripts\publier-maj.mjs --coffre
if errorlevel 1 (echo. & echo La mise en place n'est pas finie. Lis le message ci-dessus, puis relance Publier.bat. & pause & exit /b 1)
echo.
:publier
node scripts\publier-maj.mjs
if errorlevel 10 if not errorlevel 11 goto manuel
if errorlevel 1 (echo. & echo Rien n'a ete publie. Lis le message ci-dessus. & pause & exit /b 1)
echo.
echo   C'est fait. Tu peux fermer cette fenetre.
echo.
pause
exit /b 0
:manuel
for %%f in (dist\Player-X-*Setup-%VERSION%.exe) do copy /y "%%f" dist\maj\ >nul
for %%f in (dist\Player-X-*Installer-%VERSION%.exe) do copy /y "%%f" dist\maj\ >nul
explorer "%~dp0dist\maj"
start "" "https://github.com/Moon-ItachiDEV/player-x-luncher/releases/new?tag=v%VERSION%&title=Player%%20X%%20%VERSION%"
echo.
echo   Pas de jeton GitHub : glisse les fichiers du dossier ouvert dans la page GitHub, puis « Publish release ».
echo.
pause
