@echo off
powershell.exe -NoProfile -Command "try { Invoke-RestMethod -Uri 'http://127.0.0.1:47831/api/shutdown' -Method Post -Headers @{ Origin='http://127.0.0.1:47831'; 'X-Monitor-Action'='shutdown' } -TimeoutSec 3 | Out-Null } catch { Write-Host 'Monitor is not running or is unavailable.' }"
