$ErrorActionPreference = "Stop"
$out = ("protocol=https`nhost=github.com`n`n" | git credential fill 2>&1)
$tok = ($out | Where-Object { $_ -match "^password=" }) -replace "^password=",""
$h = @{ Authorization = "Bearer $tok"; "User-Agent" = "sanspet" }
$j = Invoke-RestMethod -Headers $h -Uri "https://api.github.com/repos/loikp/sanspet/actions/runs/38551568549/jobs"
$jid = $j.jobs[0].id
Write-Output "job_id=$jid"
$dir = Join-Path $env:TEMP ("sanspetlogs_" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $dir | Out-Null
$zip = Join-Path $dir "logs.zip"
Invoke-WebRequest -Headers $h -Uri "https://api.github.com/repos/loikp/sanspet/actions/jobs/$jid/logs" -OutFile $zip
Expand-Archive -Path $zip -DestinationPath (Join-Path $dir "x") -Force
Get-ChildItem (Join-Path $dir "x") -Recurse -File | ForEach-Object { Write-Output ("=== " + $_.Name) }
