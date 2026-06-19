; NSIS Installer Script para EASYGESTION
; Baixe NSIS em: https://nsis.sourceforge.io/Main_Page
; Depois: clique direito em installer.nsi > Compile with NSIS

***REMOVED***include "MUI2.nsh"

; Configuracoes basicas
Name "EASYGESTION"
OutFile "dist\EASYGESTION-Setup.exe"
InstallDir "$PROGRAMFILES\EASYGESTION"
InstallDirRegKey HKCU "Software\EASYGESTION" ""

; MUI Settings
***REMOVED***insertmacro MUI_PAGE_WELCOME
***REMOVED***insertmacro MUI_PAGE_DIRECTORY
***REMOVED***insertmacro MUI_PAGE_INSTFILES
***REMOVED***insertmacro MUI_PAGE_FINISH

***REMOVED***insertmacro MUI_LANGUAGE "Portuguese"

; Installer sections
Section "EASYGESTION" SecMain
  SetOutPath "$INSTDIR"

  ; Copiar arquivos
  File "package.json"
  File "package-lock.json"
  File "server.js"
  File "license.js"
  File ".env.example"

  SetOutPath "$INSTDIR\public"
  File /r "public\*.*"

  SetOutPath "$INSTDIR\routes"
  File /r "routes\*.*"

  SetOutPath "$INSTDIR\middleware"
  File /r "middleware\*.*"

  SetOutPath "$INSTDIR\lib"
  File /r "lib\*.*"

  ; Salvar path no registro
  WriteRegStr HKCU "Software\EASYGESTION" "" "$INSTDIR"

  ; Instalar dependencias
  SetOutPath "$INSTDIR"
  ExecWait 'cmd.exe /C "npm install"'

  ; Criar atalho na Desktop
  CreateDirectory "$SMPROGRAMS\EASYGESTION"
  CreateShortCut "$SMPROGRAMS\EASYGESTION\EASYGESTION.lnk" "cmd.exe" "/k cd /d $\"$INSTDIR$\" && npm start" "$INSTDIR\public\img\logo-ds.png"
  CreateShortCut "$DESKTOP\EASYGESTION.lnk" "cmd.exe" "/k cd /d $\"$INSTDIR$\" && npm start" "$INSTDIR\public\img\logo-ds.png"

SectionEnd

Section "Uninstall"
  RMDir /r "$INSTDIR"
  RMDir /r "$SMPROGRAMS\EASYGESTION"
  Delete "$DESKTOP\EASYGESTION.lnk"
  DeleteRegKey HKCU "Software\EASYGESTION"
SectionEnd
