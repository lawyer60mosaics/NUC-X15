!macro NSIS_HOOK_PREUNINSTALL
  ; Remove both the elevated scheduled task used by current versions and the
  ; legacy HKCU Run entry used by older releases.
  nsExec::ExecToLog 'schtasks.exe /Delete /TN "NUCtool Autostart" /F'
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "NUCtool"
!macroend
