; HybridSlicer — Inno Setup installer script
; Build with: ISCC.exe installer\HybridSlicer.iss
; Output:     dist\HybridSlicer-Setup.exe

#define AppName    "HybridSlicer"
#define AppVersion "1.0"
#define AppExe     "HybridSlicer.exe"

[Setup]
AppName                = {#AppName}
AppVersion             = {#AppVersion}
AppPublisherURL        = http://localhost:5000
DefaultDirName         = {autopf}\{#AppName}
DefaultGroupName       = {#AppName}
OutputDir              = ..\dist
OutputBaseFilename     = HybridSlicer-Setup
Compression            = lzma2/ultra64
SolidCompression       = yes
WizardStyle            = modern
PrivilegesRequired     = lowest
PrivilegesRequiredOverridesAllowed = dialog
ArchitecturesInstallIn64BitMode = x64compatible
UninstallDisplayName   = {#AppName}
CloseApplications      = yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional icons:"; Flags: checked

[Files]
; All published app files (self-contained .NET — no runtime needed on target machine)
Source: "..\publish\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\{#AppName}";          Filename: "{app}\{#AppExe}"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{commondesktop}\{#AppName}";  Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; \
  Description: "Launch {#AppName} now"; \
  Flags: nowait postinstall skipifsilent

[Code]
// Warn if no CuraEngine installation is detected
function InitializeSetup(): Boolean;
var
  CuraPath: String;
  Found: Boolean;
begin
  Result := True;
  Found  := False;

  if RegQueryStringValue(HKLM, 'SOFTWARE\UltiMaker\Cura', 'InstallLocation', CuraPath) then
    Found := FileExists(CuraPath + '\CuraEngine.exe');

  if not Found then
    Found := FileExists('C:\Program Files\UltiMaker Cura 5.12.0\CuraEngine.exe');

  if not Found then
  begin
    MsgBox(
      'UltiMaker Cura was not detected on this machine.' + #13#10 +
      #13#10 +
      'HybridSlicer requires CuraEngine for slicing. Please install' + #13#10 +
      'UltiMaker Cura (5.10 or later) from https://ultimaker.com/software/ultimaker-cura/' + #13#10 +
      'before running HybridSlicer.' + #13#10 +
      #13#10 +
      'You can continue the installation — HybridSlicer will detect' + #13#10 +
      'CuraEngine automatically once Cura is installed.',
      mbInformation, MB_OK);
  end;
end;
