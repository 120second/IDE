Unicode true

!ifndef APP_VERSION
  !error "APP_VERSION must be supplied"
!endif
!ifndef APP_EXE
  !error "APP_EXE must be supplied"
!endif
!ifndef OUTPUT_EXE
  !error "OUTPUT_EXE must be supplied"
!endif

Name "LightCP ${APP_VERSION}"
OutFile "${OUTPUT_EXE}"
InstallDir "$LOCALAPPDATA\Programs\LightCP"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
ShowUninstDetails show

Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Section "Install"
  SetOutPath "$INSTDIR"
  File /oname=LightCP.exe "${APP_EXE}"
  WriteUninstaller "$INSTDIR\Uninstall LightCP.exe"

  CreateDirectory "$SMPROGRAMS\LightCP"
  CreateShortcut "$SMPROGRAMS\LightCP\LightCP.lnk" "$INSTDIR\LightCP.exe"
  CreateShortcut "$SMPROGRAMS\LightCP\Uninstall LightCP.lnk" "$INSTDIR\Uninstall LightCP.exe"
  CreateShortcut "$DESKTOP\LightCP.lnk" "$INSTDIR\LightCP.exe"

  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LightCP" "DisplayName" "LightCP"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LightCP" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LightCP" "DisplayIcon" "$INSTDIR\LightCP.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LightCP" "UninstallString" "$\"$INSTDIR\Uninstall LightCP.exe$\""
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LightCP" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LightCP" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\LightCP.lnk"
  Delete "$SMPROGRAMS\LightCP\LightCP.lnk"
  Delete "$SMPROGRAMS\LightCP\Uninstall LightCP.lnk"
  RMDir "$SMPROGRAMS\LightCP"
  Delete "$INSTDIR\LightCP.exe"
  Delete "$INSTDIR\Uninstall LightCP.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LightCP"
SectionEnd
