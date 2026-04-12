# Smoke test for winmux-daemon. Starts daemon, runs RPC calls, reports, kills.
$ErrorActionPreference = 'Stop'
$DaemonExe = 'D:\Projects\winmux\src-tauri\target\debug\winmux-daemon.exe'

if (!(Test-Path $DaemonExe)) {
    Write-Host "FAIL: daemon binary missing at $DaemonExe"
    exit 1
}

Write-Host "Starting daemon..."
$daemon = Start-Process -FilePath $DaemonExe -PassThru -WindowStyle Hidden -RedirectStandardOutput "$env:TEMP\winmux-daemon-stdout.log" -RedirectStandardError "$env:TEMP\winmux-daemon-stderr.log"
Start-Sleep -Milliseconds 500

try {
    $p = New-Object System.IO.Pipes.NamedPipeClientStream('.', 'winmux-daemon', 'InOut')
    $p.Connect(3000)
    $w = New-Object System.IO.StreamWriter($p)
    $w.AutoFlush = $true
    $r = New-Object System.IO.StreamReader($p)

    function Call($req) {
        $w.WriteLine($req)
        $r.ReadLine()
    }

    Write-Host "PING:     $(Call '{\"id\":1,\"method\":\"daemon.ping\"}')"
    Write-Host "CAPS:     $(Call '{\"id\":2,\"method\":\"daemon.capabilities\"}')"
    $create = Call '{"id":3,"method":"daemon.create_session","params":{"shell":"powershell.exe","cwd":null,"cols":80,"rows":24}}'
    Write-Host "CREATE:   $create"
    $sid = (ConvertFrom-Json $create).result.id
    Write-Host "SID:      $sid"

    # Attach to the session so we receive output notifications
    Write-Host "ATTACH:   $(Call ('{\"id\":4,\"method\":\"daemon.attach_session\",\"params\":{\"id\":\"' + $sid + '\"}}'))"

    # Write a command to the PTY (base64 of 'echo hello`r`n')
    $cmd = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes("echo hello`r`n"))
    Write-Host "WRITE:    $(Call ('{\"id\":5,\"method\":\"daemon.write_session\",\"params\":{\"id\":\"' + $sid + '\",\"data_b64\":\"' + $cmd + '\"}}'))"

    # Drain up to 5 notification/response lines to see output
    Start-Sleep -Milliseconds 800
    for ($i = 0; $i -lt 5; $i++) {
        if ($r.Peek() -ge 0) {
            $line = $r.ReadLine()
            if ($line.Length -gt 160) { $line = $line.Substring(0,160) + '...' }
            Write-Host "PUSH[$i]:  $line"
        } else {
            break
        }
    }

    Write-Host "SHUTDOWN: $(Call '{\"id\":6,\"method\":\"daemon.shutdown\"}')"
    $p.Close()
    Write-Host "OK"
} finally {
    Start-Sleep -Milliseconds 300
    if (!$daemon.HasExited) {
        $daemon | Stop-Process -Force -ErrorAction SilentlyContinue
    }
}
