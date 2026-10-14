$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$out = ("protocol=https`nhost=github.com`n`n" | git credential fill 2>&1)
$tok = ($out | Where-Object { $_ -match "^password=" }) -replace "^password=",""
$dir = Join-Path $env:TEMP ("sanspetlogs_" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $dir | Out-Null
$zip = Join-Path $dir "logs.zip"
& curl.exe -sSL --ssl-no-revoke -H "Authorization: Bearer $tok" -H "User-Agent: sanspet" -o $zip "https://api.github.com/repos/loikp/sanspet/actions/jobs/115810521682/logs"
$z = [System.IO.Compression.ZipFile]::OpenRead($zip)
foreach ($e in $z.Entries) {
  if ($e.FullName -like "*Build release APK*") {
    Write-Output ("=== ENTRY: " + $e.FullName)
    $sr = New-Object System.IO.StreamReader($e.Open())
    $txt = $sr.ReadToEnd()
    $sr.Close()
    Set-Content -Path (Join-Path $dir "build.txt") -Value $txt -Encoding UTF8
    Write-Output ("DIR=" + $dir)
  }
}
$z.Dispose()
