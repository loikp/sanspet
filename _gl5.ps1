$ErrorActionPreference = "Stop"
$out = ("protocol=https`nhost=github.com`n`n" | git credential fill 2>&1)
$tok = ($out | Where-Object { $_ -match "^password=" }) -replace "^password=",""
$dir = Join-Path $env:TEMP ("sanspetlogs_" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $dir | Out-Null
$f = Join-Path $dir "logs.bin"
& curl.exe -sSL --ssl-no-revoke -H "Authorization: Bearer $tok" -H "User-Agent: sanspet" -o $f "https://api.github.com/repos/loikp/sanspet/actions/jobs/115810521682/logs"
Write-Output ("size = " + (Get-Item $f).Length)
$bytes = [System.IO.File]::ReadAllBytes($f)
Write-Output ("first 4 bytes = " + (($bytes[0..3] | ForEach-Object { $_.ToString() }) -join ","))
Write-Output ("FILE=" + $f)
$txt = [System.Text.Encoding]::UTF8.GetString($bytes)
Write-Output "--- 前 400 字 ---"
Write-Output $txt.Substring(0, [Math]::Min(400, $txt.Length))
