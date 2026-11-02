@echo off
setlocal
set "CODEX_MONITOR_SCRIPT=%~dp0server.mjs"
powershell.exe -NoProfile -Command "try { $nodeExe = (Get-Command node.exe -ErrorAction Stop).Source; $monitorArgs = '--disable-warning=ExperimentalWarning ' + [char]34 + $env:CODEX_MONITOR_SCRIPT + [char]34 + ' --open'; Start-Process -FilePath $nodeExe -ArgumentList $monitorArgs -WindowStyle Hidden } catch { Write-Host $_.Exception.Message; Read-Host 'Press Enter to close' }"
endlocal
