param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$studioRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$studioLauncher = Join-Path $studioRoot 'Lancer Prime Agent.vbs'
$studioArguments = '"' + $studioLauncher + '"'
if ($NoBrowser) { $studioArguments += ' --no-browser' }
Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\wscript.exe') -ArgumentList $studioArguments -WorkingDirectory $studioRoot -WindowStyle Hidden
