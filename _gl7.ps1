$ErrorActionPreference = "Stop"
$out = ("protocol=https`nhost=github.com`n`n" | git credential fill 2>&1)
$tok = ($out | Where-Object { $_ -match "^password=" }) -replace "^password=",""
$dir = Join-Path $env:TEMP ("sanspetlogs_" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $dir | Out-Null
$f = Join-Path $dir "logs.txt"
& curl.exe -sSL --ssl-no-revoke -H "Authorization: Bearer $tok" -H "User-Agent: sanspet" -o $f "https://api.github.com/repos/loikp/sanspet/actions/jobs/115810521682/logs"
$lines = Get-Content $f -Encoding UTF8
Write-Output ("总行数 = " + $lines.Count)
Write-Output "===== 含 error / FAILURE / went wrong 的行 ====="
$lines | Where-Object { $_ -match "error|FAILURE|went wrong|Exception|e: " } | Select-Object -First 40
Write-Output "===== 最后 25 行 ====="
$lines | Select-Object -Last 25
