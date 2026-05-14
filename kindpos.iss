[Setup]
AppName=KINDpos
AppVersion=2.0
AppPublisher=KIND Technologies LLC
AppPublisherURL=https://kindpos.com
DefaultDirName={autopf}\KINDpos
DefaultGroupName=KINDpos
OutputBaseFilename=KINDpos-Setup
SetupIconFile=install\kindpos.ico
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=admin
WizardStyle=modern
CloseApplications=yes
CloseApplicationsFilter=kindpos-backend.exe

[Files]
Source: "dist\kindpos-backend.exe"; DestDir: "{app}"; Flags: ignoreversion replacesameversion
Source: "dist\activate.exe";         DestDir: "{app}"; Flags: ignoreversion
Source: "terminal\*";    DestDir: "{app}\terminal";    Flags: ignoreversion recursesubdirs
Source: "overseer\*";    DestDir: "{app}\overseer";    Flags: ignoreversion recursesubdirs
Source: "entomology\*";  DestDir: "{app}\entomology";  Flags: ignoreversion recursesubdirs
Source: "common\*";      DestDir: "{app}\common";      Flags: ignoreversion recursesubdirs
Source: "backend\data\*";DestDir: "{app}\data";        Flags: ignoreversion recursesubdirs

[Icons]
Name: "{group}\KINDpos";          Filename: "{app}\kindpos-backend.exe"
Name: "{commondesktop}\KINDpos";  Filename: "{app}\kindpos-backend.exe"

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
  ValueType: string; ValueName: "KINDpos"; \
  ValueData: """{app}\kindpos-backend.exe"""; Flags: uninsdeletevalue

[Run]
Filename: "{app}\activate.exe"; \
  Parameters: "KIND-XXXX-XXXX-XXXX"; \
  Flags: runhidden waitprocuntilterminated; \
  StatusMsg: "Activating license..."

Filename: "{app}\kindpos-backend.exe"; \
  Description: "Launch KINDpos now"; \
  Flags: postinstall nowait skipifsilent

[UninstallRun]
Filename: "{cmd}"; \
  Parameters: "/C schtasks /delete /tn KINDpos /f"; \
  Flags: runhidden
