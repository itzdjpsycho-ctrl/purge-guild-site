' Launches the Purge Bot Control panel with NO visible console/terminal
' window at all — not even briefly. start-control-panel.bat still shows a
' console for its Node/dependency checks when run directly (useful if
' something's wrong and you need to see why); this wraps that same script
' but runs it hidden, so there's never a window to linger afterward
' regardless of your terminal app's "close on exit" setting.
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.Run """" & scriptDir & "\start-control-panel.bat""", 0, False
