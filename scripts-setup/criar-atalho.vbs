' Criar atalho da Desktop para RODAR-AGORA.bat
' Execute: duplo clique neste arquivo
' Vai criar um atalho bonito na Desktop

Set oWS = WScript.CreateObject("WScript.Shell")
strDesktop = oWS.SpecialFolders("Desktop")
strPath = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)

Set oLink = oWS.CreateShortcut(strDesktop & "\EASYGESTION.lnk")
oLink.TargetPath = strPath & "\RODAR-AGORA.bat"
oLink.WorkingDirectory = strPath
oLink.Description = "EASYGESTION - Sistema de Gestão"
oLink.WindowStyle = 1
oLink.IconLocation = strPath & "\public\img\logo-ds.png"
oLink.Save

MsgBox "✅ Atalho criado na Desktop***REMOVED***", 64, "EASYGESTION"
