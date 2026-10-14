$ErrorActionPreference = "Stop"
$out = ("protocol=https`nhost=github.com`n`n" | git credential fill 2>&1)
$tok = ($out | Where-Object { $_ -match "^password=" }) -replace "^password=",""
$dir = Join-Path $env:TEMP ("sanspetlogs_" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $dir | Out-Null
$f = Join-Path $dir "logs.txt"
& curl.exe -sSL --ssl-no-revoke -H "Authorization: Bearer $tok" -H "User-Agent: sanspet" -o $f "https://api.github.com/repos/loikp/sanspet/actions/jobs/115810521682/logs"
$lines = Get-Content $f -Encoding UTF8
$hit = $false
foreach ($l in $lines) {
  if ($l -like "*Build release APK*") { $hit = $true }
  if ($hit) { Write-Output $l }
}
