param(
  [Parameter(Mandatory = $true)][int]$TestProcessId,
  [Parameter(Mandatory = $true)][string]$ExpectedExecutable,
  [ValidateSet('main', 'focus', 'inspect', 'select', 'cancel')][string]$Action = 'inspect',
  [long]$MainWindowHandle = 0,
  [string]$SelectedPath,
  [string]$ScreenshotPath
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$testProcess = [System.Diagnostics.Process]::GetProcessById($TestProcessId)
if (-not [StringComparer]::OrdinalIgnoreCase.Equals($testProcess.MainModule.FileName, [IO.Path]::GetFullPath($ExpectedExecutable))) {
  throw 'The target PID does not belong to the exact isolated test executable.'
}
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Drawing.Imaging;
public static class PickerTestWindows {
  public delegate bool EnumCallback(IntPtr hwnd, IntPtr state);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumCallback callback, IntPtr state);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hwnd, EnumCallback callback, IntPtr state);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsChild(IntPtr parent, IntPtr child);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr hwnd, uint message, IntPtr wParam, string lParam);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hwnd, uint command);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr hwnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rectangle);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  public static IntPtr[] OwnedByProcess(int expectedPid) {
    var list = new List<IntPtr>();
    EnumWindows((hwnd, state) => { uint pid; GetWindowThreadProcessId(hwnd, out pid); if(pid == expectedPid) list.Add(hwnd); return true; }, IntPtr.Zero);
    return list.ToArray();
  }
  public static string Title(IntPtr hwnd) { var value = new StringBuilder(1024); GetWindowText(hwnd, value, value.Capacity); return value.ToString(); }
  public static IntPtr[] Children(IntPtr parent, int expectedPid) {
    var list = new List<IntPtr>();
    EnumChildWindows(parent, (hwnd, state) => { uint pid; GetWindowThreadProcessId(hwnd, out pid); if(pid == expectedPid) list.Add(hwnd); return true; }, IntPtr.Zero);
    return list.ToArray();
  }
  public static string Class(IntPtr hwnd) { var value = new StringBuilder(256); GetClassName(hwnd, value, value.Capacity); return value.ToString(); }
  public static void ActivateTestWindow(IntPtr hwnd, int expectedPid) {
    uint pid; GetWindowThreadProcessId(hwnd, out pid);
    if(pid != expectedPid || Class(hwnd) != "Tauri Window") throw new Exception("Refused to activate a non-test window");
    if(SetForegroundWindow(hwnd)) return;
    // Windows rejects focus from hidden helper processes. Expose only the test
    // window, then click its title bar after attesting the exact window at that point.
    if(!SetWindowPos(hwnd, new IntPtr(-1), 0, 0, 0, 0, 0x13)) throw new Exception("Cannot expose test window");
    try {
      System.Threading.Thread.Sleep(150);
      RECT r; GetWindowRect(hwnd, out r);
      var point = new POINT { X=r.Left+200, Y=r.Top+12 };
      var underPoint = WindowFromPoint(point);
      GetWindowThreadProcessId(underPoint, out pid);
      if(pid != expectedPid || GetAncestor(underPoint, 2) != hwnd) throw new Exception("Refused click: title-bar point ("+point.X+","+point.Y+") is not inside the exact test HWND/PID; target="+hwnd+"/"+expectedPid+", actual="+underPoint+"/"+pid+", root="+GetAncestor(underPoint,2));
      if(!SetCursorPos(point.X, point.Y)) throw new Exception("Cannot target test title bar");
      mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
      mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
      for(var i=0; i<20 && GetForegroundWindow()!=hwnd; i++) System.Threading.Thread.Sleep(50);
    } finally {
      SetWindowPos(hwnd, new IntPtr(-2), 0, 0, 0, 0, 0x13);
    }
  }
  public static void Capture(IntPtr hwnd, string path) {
    RECT r; if(!GetWindowRect(hwnd, out r)) throw new Exception("No window rectangle");
    using(var bitmap = new Bitmap(r.Right-r.Left, r.Bottom-r.Top)) {
      using(var graphics = Graphics.FromImage(bitmap)) {
        var hdc = graphics.GetHdc();
        bool printed;
        try { printed = PrintWindow(hwnd, hdc, 2); } finally { graphics.ReleaseHdc(hdc); }
        if(!printed) throw new Exception("Native dialog capture failed");
      }
      bitmap.Save(path, ImageFormat.Png);
    }
  }
}
'@
[void][PickerTestWindows]::SetThreadDpiAwarenessContext([IntPtr](-4))
function Get-WindowInfo([IntPtr]$Handle) {
  $bounds = New-Object PickerTestWindows+RECT
  [void][PickerTestWindows]::GetWindowRect($Handle, [ref]$bounds)
  return [ordered]@{
    hwnd = $Handle.ToInt64()
    owner = [PickerTestWindows]::GetWindow($Handle, 4).ToInt64()
    title = [PickerTestWindows]::Title($Handle)
    className = [PickerTestWindows]::Class($Handle)
    visible = [PickerTestWindows]::IsWindowVisible($Handle)
    enabled = [PickerTestWindows]::IsWindowEnabled($Handle)
    foreground = [PickerTestWindows]::GetForegroundWindow() -eq $Handle
    foregroundHwnd = [PickerTestWindows]::GetForegroundWindow().ToInt64()
    bounds = @{ left=$bounds.Left; top=$bounds.Top; width=$bounds.Right-$bounds.Left; height=$bounds.Bottom-$bounds.Top }
  }
}
$windows = @([PickerTestWindows]::OwnedByProcess($TestProcessId) | ForEach-Object { Get-WindowInfo $_ })
if ($Action -eq 'main') {
  $main = @($windows | Where-Object { $_.visible -and $_.owner -eq 0 -and $_.className -ne '#32770' -and $_.bounds.width -gt 500 })
  if ($main.Count -ne 1) { throw "Expected one visible Tauri main window, found $($main.Count): $($windows | ConvertTo-Json -Depth 5 -Compress)" }
  $main[0] | ConvertTo-Json -Depth 5 -Compress
  exit 0
}
if ($MainWindowHandle -eq 0) { throw 'An attested main HWND is required for dialog access.' }
$mainStillValid = @($windows | Where-Object { $_.hwnd -eq $MainWindowHandle })
if ($mainStillValid.Count -ne 1) { throw 'The exact main HWND no longer belongs to the test PID.' }
if ($Action -eq 'focus') {
  [PickerTestWindows]::ActivateTestWindow([IntPtr]$MainWindowHandle, $TestProcessId)
  $focusDeadline = [DateTime]::UtcNow.AddSeconds(2)
  while ([PickerTestWindows]::GetForegroundWindow().ToInt64() -ne $MainWindowHandle -and [DateTime]::UtcNow -lt $focusDeadline) { Start-Sleep -Milliseconds 50 }
  Get-WindowInfo ([IntPtr]$MainWindowHandle) | ConvertTo-Json -Depth 5 -Compress
  exit 0
}
$deadline = [DateTime]::UtcNow.AddSeconds(10)
do {
  $windows = @([PickerTestWindows]::OwnedByProcess($TestProcessId) | ForEach-Object { Get-WindowInfo $_ })
  $dialogs = @($windows | Where-Object { $_.visible -and $_.className -eq '#32770' -and $_.owner -eq $MainWindowHandle })
  if ($dialogs.Count -eq 1) { break }
  Start-Sleep -Milliseconds 100
} while ([DateTime]::UtcNow -lt $deadline)
if ($dialogs.Count -ne 1) { throw "Expected one dialog owned by the test main HWND, found $($dialogs.Count): $($windows | ConvertTo-Json -Depth 5 -Compress)" }
$dialog = $dialogs[0]
$element = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$dialog.hwnd)
$descendants = $element.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$controls = @($descendants | ForEach-Object { [ordered]@{ id=$_.Current.AutomationId; name=$_.Current.Name; type=$_.Current.ControlType.ProgrammaticName; hwnd=$_.Current.NativeWindowHandle; enabled=$_.Current.IsEnabled; offscreen=$_.Current.IsOffscreen } })
$nativeControls = @([PickerTestWindows]::Children([IntPtr]$dialog.hwnd, $TestProcessId) | ForEach-Object { $info=Get-WindowInfo $_; $info.id=[PickerTestWindows]::GetDlgCtrlID($_); $info })
if ($ScreenshotPath) {
  [PickerTestWindows]::Capture([IntPtr]$dialog.hwnd, [IO.Path]::GetFullPath($ScreenshotPath))
}
if ($Action -eq 'select') {
  if (-not [IO.Directory]::Exists($SelectedPath)) { throw 'The selected fixture directory must exist.' }
  $edits = @($nativeControls | Where-Object { $_.className -eq 'Edit' -and $_.id -in @(1148, 1152) -and $_.visible })
  if ($edits.Count -ne 1) { throw "Expected one native folder-name editor: $($nativeControls | ConvertTo-Json -Depth 5 -Compress)" }
  [void][PickerTestWindows]::SendMessage([IntPtr]$edits[0].hwnd, 0x000C, [IntPtr]::Zero, $SelectedPath)
}
if ($Action -in @('select', 'cancel')) {
  $buttonId = if ($Action -eq 'select') { '1' } else { '2' }
  $buttons = @($nativeControls | Where-Object { $_.className -eq 'Button' -and $_.id -eq [int]$buttonId -and $_.enabled })
  if ($buttons.Count -ne 1) { throw "Expected exactly one native dialog button $buttonId" }
  if (-not [PickerTestWindows]::PostMessage([IntPtr]$buttons[0].hwnd, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)) { throw 'Cannot click the exact native dialog button' }
}
[ordered]@{ pid=$TestProcessId; dialog=$dialog; main=$mainStillValid[0]; action=$Action; controls=$controls; nativeControls=$nativeControls; screenshot=$ScreenshotPath } | ConvertTo-Json -Depth 6 -Compress
