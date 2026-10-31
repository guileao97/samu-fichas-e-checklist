@echo off
setlocal
chcp 65001 >nul
title SAMU 192 Orlandia - Atualizar Google Apps Script v4

set "GS_FILE=%~dp0Codigo_Google_Apps_Script.gs"
if not exist "%GS_FILE%" (
    echo [ERRO] Arquivo Codigo_Google_Apps_Script.gs nao encontrado em:
    echo "%GS_FILE%"
    echo.
    pause
    exit /b 1
)

echo ============================================================================
echo   SAMU 192 - ORLANDIA-SP ^| ATUALIZADOR RAPIDO DO GOOGLE APPS SCRIPT (v4)
echo ============================================================================
echo.
echo Copiando todo o codigo de Codigo_Google_Apps_Script.gs para o Ctrl+V...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$c = Get-Content -LiteralPath $env:GS_FILE -Raw -Encoding UTF8; Set-Clipboard -Value $c; Write-Host ('[OK] Codigo v4 copiado para a Area de Transferencia (' + $c.Length + ' caracteres)!') -ForegroundColor Green"

if errorlevel 1 (
    echo [AVISO] Nao foi possivel copiar automaticamente. Abra o arquivo Codigo_Google_Apps_Script.gs no Bloco de Notas e copie manualmente.
) else (
    echo.
    echo Abrindo https://script.google.com no seu navegador...
    start "" "https://script.google.com"
)

echo.
echo ============================================================================
echo   SIGA ESTES 4 PASSOS RAPIDOS NO NAVEGADOR (MANTEM A MESMA URL /exec!):
echo ============================================================================
echo   1. Abra o projeto do SAMU 192 no Google Apps Script.
echo   2. Clique dentro do editor, aperte Ctrl+A (selecionar tudo) e Ctrl+V (colar).
echo   3. Aperte Ctrl+S para salvar.
echo   4. No topo direito, clique em:
echo      Implantar ^> Gerenciar implantacoes ^> icone de Lapis (Editar)
echo      Em "Versao", escolha "Nova versao" e clique em "Implantar".
echo ============================================================================
echo   IMPORTANTE: Ao usar "Gerenciar implantacoes -> Editar -> Nova versao",
echo   a URL /exec continua EXATAMENTE A MESMA em todos os celulares e na Base!
echo ============================================================================
echo.
pause
