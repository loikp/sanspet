$ErrorActionPreference = "Stop"
$out = ("protocol=https`nhost=github.com`n`n" | git credential fill 2>&1)
$tok = ($out | Where-Object { $_ -match "^password=" }) -replace "^password=",""
$dir = Join-Path $env:TEMP ("sanspetlogs_" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $dir | Out-Null
$zip = Join-Path $dir "logs.zip"
& curl.exe -sSL --ssl-no-revoke -H "Authorization: Bearer $tok" -H "User-Agent: sanspet" -o $zip "https://api.github.com/repos/loikp/sanspet/actions/jobs/115810521682/logs"
Write-Output ("zip size = " + (Get-Item $zip).Length)
Expand-Archive -Path $zip -DestinationPath (Join-Path $dir "x") -Force
Get-ChildItem (Join-Path $dir "x") -Recurse -File | ForEach-Object { Write-Output ("LOG: " + $_.FullName) }
