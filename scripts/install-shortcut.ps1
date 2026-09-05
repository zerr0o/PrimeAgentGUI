param([string]$Destination = [Environment]::GetFolderPath('Desktop'))
$ErrorActionPreference = 'Stop'
$studioRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$studioLauncher = Join-Path $studioRoot 'Lancer Prime Agent.vbs'
$studioIcon = Join-Path $studioRoot 'assets\prime-agent.ico'
if (-not (Test-Path -LiteralPath $studioLauncher -PathType Leaf)) {
  throw 'Le lanceur Prime Agent Studio est introuvable.'
}
if (-not (Test-Path -LiteralPath $Destination -PathType Container)) {
  throw 'Le dossier de destination est introuvable.'
}
if (-not (Test-Path -LiteralPath $studioIcon -PathType Leaf)) {
  throw 'L''icone Prime Agent Studio est introuvable dans le dossier assets.'
}
$studioShortcutPath = Join-Path $Destination 'Prime Agent Studio.lnk'
$studioShell = New-Object -ComObject WScript.Shell
$studioShortcut = $studioShell.CreateShortcut($studioShortcutPath)
$studioShortcut.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
$studioShortcut.Arguments = '"' + $studioLauncher + '"'
$studioShortcut.WorkingDirectory = $studioRoot
$studioShortcut.Description = 'Prime Agent Studio - projets et sessions, sans console'
$studioShortcut.WindowStyle = 7
$studioShortcut.IconLocation = $studioIcon + ',0'
$studioShortcut.Save()
Write-Output "Raccourci installe : $studioShortcutPath"
