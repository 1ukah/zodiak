; Preserve the application's own data folder when an installer upgrades zodiak.
; The updater invokes this uninstaller before placing the new application files.
!macro customRemoveFiles
  ${If} ${isUpdated}
    ; This is a sibling of $INSTDIR, so Rename stays on the user's selected drive.
    RMDir /r "$INSTDIR\..\.zodiak-update-data"
    IfFileExists "$INSTDIR\data\*.*" 0 +2
      Rename "$INSTDIR\data" "$INSTDIR\..\.zodiak-update-data"
  ${EndIf}
  SetOutPath $TEMP
  RMDir /r "$INSTDIR"
!macroend

!macro customInstall
  ; Restore server, audio and other preferences after new application files are installed.
  IfFileExists "$INSTDIR\..\.zodiak-update-data\*.*" 0 +3
    RMDir /r "$INSTDIR\data"
    Rename "$INSTDIR\..\.zodiak-update-data" "$INSTDIR\data"
!macroend
