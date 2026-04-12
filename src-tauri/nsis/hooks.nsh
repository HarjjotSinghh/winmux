; NSIS installer hooks for WinMux.
;
; The daemon (winmux-daemon.exe) runs in the background and holds its own exe
; handle, which blocks NSIS from overwriting it during install/update. Same
; risk with the main UI (winmux.exe) if the user leaves it open. Kill both
; before extraction (install) and before removal (uninstall).

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping any running WinMux processes..."
  nsExec::Exec `"$SYSDIR\taskkill.exe" /F /IM winmux-daemon.exe /T`
  Pop $0
  nsExec::Exec `"$SYSDIR\taskkill.exe" /F /IM winmux.exe /T`
  Pop $0
  nsExec::Exec `"$SYSDIR\taskkill.exe" /F /IM winmux-cli.exe /T`
  Pop $0
  ; Let Windows fully release file handles before we start writing.
  Sleep 800
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Stopping any running WinMux processes..."
  nsExec::Exec `"$SYSDIR\taskkill.exe" /F /IM winmux-daemon.exe /T`
  Pop $0
  nsExec::Exec `"$SYSDIR\taskkill.exe" /F /IM winmux.exe /T`
  Pop $0
  nsExec::Exec `"$SYSDIR\taskkill.exe" /F /IM winmux-cli.exe /T`
  Pop $0
  Sleep 800
!macroend
