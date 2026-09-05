Option Explicit

Dim shell, files, root, node, port, result, command, openBrowser, argument, quiet
Set shell = CreateObject("WScript.Shell")
quiet = shell.ExpandEnvironmentStrings("%PRIME_AGENT_GUI_NONINTERACTIVE%") = "1"
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root

node = FindNode()
If node = "" Then
  If Not quiet Then MsgBox "Node.js est introuvable. Installez Node.js 20 ou plus, puis relancez Prime Agent Studio." & vbCrLf & vbCrLf & "Vous pouvez aussi configurer PRIME_AGENT_GUI_NODE avec le chemin complet de node.exe.", vbCritical, "Prime Agent Studio"
  WScript.Quit 1
End If

port = shell.ExpandEnvironmentStrings("%PORT%")
If port = "%PORT%" Or port = "" Then port = "3088"
openBrowser = True
For Each argument In WScript.Arguments
  If LCase(argument) = "--no-browser" Then openBrowser = False
Next

command = Quote(node) & " " & Quote(files.BuildPath(root, "scripts\start-server.mjs"))
On Error Resume Next
result = shell.Run(command, 0, True)
If Err.Number <> 0 Then result = 1
On Error GoTo 0
If result <> 0 Then
  If Not quiet Then MsgBox "Impossible de lancer Prime Agent Studio." & vbCrLf & vbCrLf & "Consultez les journaux dans :" & vbCrLf & files.BuildPath(root, ".local\logs"), vbCritical, "Prime Agent Studio"
  WScript.Quit result
End If

If openBrowser Then shell.Run "http://127.0.0.1:" & CStr(CLng(port)), 1, False
WScript.Quit 0

Function Quote(value)
  Quote = Chr(34) & value & Chr(34)
End Function

Function FindNode()
  Dim candidate, folder, pathValue
  FindNode = ""
  candidate = shell.ExpandEnvironmentStrings("%PRIME_AGENT_GUI_NODE%")
  If candidate <> "%PRIME_AGENT_GUI_NODE%" And files.FileExists(candidate) Then
    FindNode = candidate
    Exit Function
  End If
  pathValue = shell.ExpandEnvironmentStrings("%PATH%")
  For Each folder In Split(pathValue, ";")
    folder = Trim(Replace(folder, Chr(34), ""))
    If folder <> "" Then
      candidate = files.BuildPath(folder, "node.exe")
      If files.FileExists(candidate) Then
        FindNode = candidate
        Exit Function
      End If
    End If
  Next
  candidate = shell.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe")
  If files.FileExists(candidate) Then FindNode = candidate
End Function
