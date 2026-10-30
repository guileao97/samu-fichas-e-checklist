@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ====================================================================
echo   SAMU 192 - ORLANDIA-SP ^| PUBLICAR ATUALIZACAO E COMPILAR APK
echo   Repositorio: https://github.com/guileao97/samu-fichas-e-checklist
echo ====================================================================
echo.
echo [1] Publicar Atualizacao Rapida (Telas/Fichas/PDF - atualiza direto no app via OTA)
echo [2] Publicar Nova Versao Completa do Instalador .APK + JA INICIAR COMPILACAO
echo [3] Publicar Atualizacao Rapida (OTA) + JA INICIAR COMPILACAO DO .APK
echo [4] Apenas Iniciar Compilacao do SAMU_192_Orlandia.apk agora (sem mudar versao)
echo.
set /p OPCAO="Escolha 1, 2, 3 ou 4 (Enter = 3): "
if "%OPCAO%"=="1" (
    python PUBLICAR_NO_GITHUB.py --perguntar-compilar
) else if "%OPCAO%"=="2" (
    python PUBLICAR_NO_GITHUB.py --novo-apk --compilar
) else if "%OPCAO%"=="4" (
    python PUBLICAR_NO_GITHUB.py --apenas-compilar
) else (
    python PUBLICAR_NO_GITHUB.py --compilar
)
echo.
pause
