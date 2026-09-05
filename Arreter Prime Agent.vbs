Option Explicit

Dim shell, files, root, node, candidate, folder, result, command, quiet
Set shell = CreateObject("WScript.Shell")
quiet = shell.ExpandEnvironmentStrings("%PRIME_AGENT_GUI_NONINTERACTIVE%") = "1"
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root
node = shell.ExpandEnvironmentStrings("%PRIME_AGENT_GUI_NODE%")
If Not files.FileExists(node) Then node = ""
If node = "" Then
  For Each folder In Split(shell.ExpandEnvironmentStrings("%PATH%"), ";")
    folder = Trim(Replace(folder, Chr(34), ""))
    If folder <> "" Then
      candidate = files.BuildPath(folder, "node.exe")
      If files.FileExists(candidate) Then
        node = candidate
        Exit For
      End If
    End If
  Next
End If
If node = "" Then
  candidate = shell.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe")
  If files.FileExists(candidate) Then node = candidate
End If
If node = "" Then
  If Not quiet Then MsgBox "Node.js est introuvable. Configurez PRIME_AGENT_GUI_NODE avec le chemin complet de node.exe.", vbCritical, "Prime Agent Studio"
  WScript.Quit 1
End If

command = Chr(34) & node & Chr(34) & " " & Chr(34) & files.BuildPath(root, "scripts\stop-server.mjs") & Chr(34)
On Error Resume Next
result = shell.Run(command, 0, True)
If Err.Number <> 0 Then result = 1
On Error GoTo 0
If result <> 0 Then
  If Not quiet Then MsgBox "Impossible d'arreter Prime Agent Studio." & vbCrLf & vbCrLf & "Consultez les journaux dans :" & vbCrLf & files.BuildPath(root, ".local\logs"), vbCritical, "Prime Agent Studio"
  WScript.Quit result
End If
WScript.Quit 0
