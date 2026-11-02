$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$owner=[Diagnostics.Process]::GetProcessById([int]$env:CODEX_MONITOR_PARENT_PID)
Add-Type -Path (Join-Path $env:CODEX_MONITOR_ROOT 'process-network.cs')
$clock=[Diagnostics.Stopwatch]::StartNew()
while(!$owner.HasExited){
    $began=$clock.ElapsedMilliseconds
    try{$message=[CodexNetworkNative]::Read() | ConvertTo-Json -Compress -Depth 5}catch{$message='{"error":true}'}
    [Console]::Out.WriteLine($message)
    [Console]::Out.Flush()
    $remaining=250-($clock.ElapsedMilliseconds-$began)
    if($remaining -gt 0){Start-Sleep -Milliseconds $remaining}
    $owner.Refresh()
}
