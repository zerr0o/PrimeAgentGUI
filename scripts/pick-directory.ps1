# Paths and labels arrive as data, never as executable PowerShell text.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$studioDialog = $null
$studioOwner = $null
try {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.Application]::EnableVisualStyles()
    $studioDialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $studioDialog.Description = $env:PRIME_STUDIO_PICK_TITLE
    $studioDialog.ShowNewFolderButton = $true
    if ($studioDialog.PSObject.Properties['UseDescriptionForTitle']) {
        $studioDialog.UseDescriptionForTitle = $true
        $studioDialog.AutoUpgradeEnabled = $true
    }
    if ($env:PRIME_STUDIO_PICK_DIRECTORY) {
        $studioDialog.SelectedPath = $env:PRIME_STUDIO_PICK_DIRECTORY
    }
    # The helper stays hidden, but its user-requested dialog must be foreground.
    $studioOwner = New-Object System.Windows.Forms.Form
    $studioOwner.ShowInTaskbar = $false
    $studioOwner.Opacity = 0
    $studioOwner.TopMost = $true
    $studioOwner.Show()
    $studioOwner.Activate()
    if ($studioDialog.ShowDialog($studioOwner) -eq [System.Windows.Forms.DialogResult]::OK) {
        @{ cwd = $studioDialog.SelectedPath } | ConvertTo-Json -Compress
    } else {
        Write-Output '{"cwd":null}'
    }
} catch {
    [Console]::Error.WriteLine('Folder picker failed.')
    exit 1
} finally {
    if ($null -ne $studioDialog) { $studioDialog.Dispose() }
    if ($null -ne $studioOwner) { $studioOwner.Dispose() }
}
