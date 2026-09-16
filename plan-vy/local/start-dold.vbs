' Startar Plan-vy-servern utan fonster. 0 = dolt, False = vanta inte.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)

' Redan igang? Starta inte en till.
On Error Resume Next
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
If Err.Number = 0 Then
  Set lista = wmi.ExecQuery("SELECT CommandLine FROM Win32_Process WHERE Name = node.exe")
  For Each p In lista
    If Not IsNull(p.CommandLine) Then
      If InStr(LCase(p.CommandLine), "serve-local.mjs") > 0 Then WScript.Quit 0
    End If
  Next
End If
On Error Goto 0

sh.Run "node serve-local.mjs", 0, False
