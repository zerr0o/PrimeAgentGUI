# The folder is data, never interpolated into a PowerShell command or argument string.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

try {
    $studioPath = $env:PRIME_STUDIO_OPEN_DIRECTORY
    if ([string]::IsNullOrWhiteSpace($studioPath) -or -not (Test-Path -LiteralPath $studioPath -PathType Container)) {
        throw 'Folder is unavailable.'
    }
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class StudioExplorerWindow {
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr window, int command);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
}
'@
    $studioShell = New-Object -ComObject Shell.Application
    $studioFolder = $studioShell.NameSpace($studioPath)
    if ($null -eq $studioFolder) { throw 'Folder is unavailable to Explorer.' }
    $studioTarget = [IO.Path]::GetFullPath($studioFolder.Self.Path).TrimEnd('\')

    function Find-StudioFolderWindow {
        $studioMatches = @($studioShell.Windows()) | Where-Object {
            try {
                [IO.Path]::GetFileName($_.FullName) -ieq 'explorer.exe' -and
                    [string]::Equals([IO.Path]::GetFullPath($_.Document.Folder.Self.Path).TrimEnd('\'), $studioTarget, [StringComparison]::OrdinalIgnoreCase)
            } catch { $false }
        }
        # Reuse existing windows, including those hidden by older Studio versions.
        $studioMatches | Sort-Object { -[int][StudioExplorerWindow]::IsWindowVisible([IntPtr]$_.HWND) } | Select-Object -First 1
    }

    $studioWindow = Find-StudioFolderWindow
    if ($null -eq $studioWindow) {
        # SW_SHOWNORMAL is intentional: the user explicitly requested a visible folder.
        $studioShell.ShellExecute($studioPath, '', '', 'open', 1)
    }
    $studioDeadline = [DateTime]::UtcNow.AddSeconds(8)
    do {
        if ($null -eq $studioWindow) { $studioWindow = Find-StudioFolderWindow }
        if ($null -ne $studioWindow) {
            $studioHandle = [IntPtr]$studioWindow.HWND
            if (-not [StudioExplorerWindow]::IsWindowVisible($studioHandle) -or [StudioExplorerWindow]::IsIconic($studioHandle)) {
                [void][StudioExplorerWindow]::ShowWindowAsync($studioHandle, 9) # SW_RESTORE
            }
            [void][StudioExplorerWindow]::SetForegroundWindow($studioHandle)
            if ([StudioExplorerWindow]::IsWindowVisible($studioHandle) -and -not [StudioExplorerWindow]::IsIconic($studioHandle)) {
                Write-Output '{"opened":true,"visible":true}'
                exit 0
            }
        }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $studioDeadline)
    throw 'Explorer did not display the folder.'
} catch {
    [Console]::Error.WriteLine('Explorer did not confirm a visible folder window.')
    exit 1
}
