; Instalador Inno Setup para EASYGESTION
; Baixe Inno Setup em: https://jrsoftware.org/isdl.php
; Depois: clique direito no arquivo > Compile with Inno Setup

[Setup]
AppName=EASYGESTION
AppVersion=1.0
AppPublisher=DS Store
AppPublisherURL=https://dsstore.com.br
AppSupportURL=https://dsstore.com.br
AppUpdatesURL=https://dsstore.com.br
DefaultDirName={autopf}\EASYGESTION
DefaultGroupName=EASYGESTION
AllowNoIcons=yes
LicenseFile=LICENSE.txt
OutputDir=dist
OutputBaseFilename=EASYGESTION-Instalador
Compression=lzma
SolidCompression=yes
PrivilegesRequired=lowest
WizardStyle=modern
ShowLanguageDialog=no
LanguageDetectionMethod=none

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "public\*"; DestDir: "{app}\public"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "routes\*"; DestDir: "{app}\routes"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "middleware\*"; DestDir: "{app}\middleware"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "lib\*"; DestDir: "{app}\lib"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "scripts\*"; DestDir: "{app}\scripts"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "server.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "license.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "package-lock.json"; DestDir: "{app}"; Flags: ignoreversion
Source: ".env.example"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\EASYGESTION"; Filename: "{app}\RODAR.bat"; WorkingDir: "{app}"
Name: "{commondesktop}\EASYGESTION"; Filename: "{app}\RODAR.bat"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""cd '{app}' && npm install"""; Description: "Instalando dependências..."; Flags: runascurrentuser waituntilterminated
Filename: "{app}\RODAR.bat"; Description: "Iniciar EASYGESTION"; Flags: nowait postinstall skipifsilent
