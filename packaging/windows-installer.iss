#ifndef MyAppVersion
  #error MyAppVersion is required
#endif
#ifndef MyPackageDir
  #error MyPackageDir is required
#endif
#ifndef MyOutputDir
  #error MyOutputDir is required
#endif

[Setup]
AppId={code:ApplicationId}
UsePreviousLanguage=no
AppName=Node Tester
AppVersion={#MyAppVersion}
AppPublisher=Roger Gomez Martinez
AppPublisherURL=https://github.com/Roger08G/node-tester
AppSupportURL=https://github.com/Roger08G/node-tester/issues
AppUpdatesURL=https://github.com/Roger08G/node-tester/releases/latest
DefaultDirName={localappdata}\Programs\Node Tester
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible arm64
ArchitecturesInstallIn64BitMode=x64compatible arm64
OutputDir={#MyOutputDir}
OutputBaseFilename=node-tester-v{#MyAppVersion}-windows-setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ChangesEnvironment=yes
VersionInfoVersion={#MyAppVersion}
SetupLogging=yes
CloseApplications=no

[Tasks]
Name: "addtopath"; Description: "Add Node Tester to my user PATH (open a new terminal after installation)"; Flags: checkedonce

[Files]
Source: "{#MyPackageDir}\*"; DestDir: "{app}\package"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "node-tester.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "node-tester"; DestDir: "{app}"; Flags: ignoreversion
Source: "check-node.cjs"; DestName: "node-tester-check-node.cjs"; Flags: dontcopy

[UninstallDelete]
Type: files; Name: "{app}\path-owned.txt"

[Code]
function ApplicationId(Param: String): String;
begin
  if ExpandConstant('{param:SMOKETEST|0}') = '1' then
    Result := 'NodeTesterInstallerSmoke'
  else
    Result := 'Roger08G.NodeTester';
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  NodeExecutable: String;
  ResultCode: Integer;
  Output: TExecOutput;
begin
  Result := '';
  if Pos(';', WizardDirValue) <> 0 then begin
    Result := 'The installation directory must not contain a semicolon.';
    Exit;
  end;
  NodeExecutable := FileSearch('node.exe', GetEnv('PATH'));
  if NodeExecutable = '' then begin
    Result := 'Install Node.js 22.13.0 or newer (x64 or ARM64), add it to PATH, and run this installer again.';
    Exit;
  end;
  ExtractTemporaryFile('node-tester-check-node.cjs');
  try
    if not ExecAndCaptureOutput(NodeExecutable, ExpandConstant('"{tmp}\node-tester-check-node.cjs"'), '', SW_HIDE, ewWaitUntilTerminated, ResultCode, Output) then
      Result := 'Could not start the installed Node.js runtime.'
    else if (ResultCode <> 0) or Output.Error then
      Result := 'Node Tester requires Node.js 22.13.0 or newer, using the x64 or ARM64 runtime.';
  except
    Result := 'Could not verify the installed Node.js runtime.';
  end;
end;

function ExpandedPath(Value: String): String;
var
  StartPos, EndPos: Integer;
  Prefix, VariableName, VariableValue: String;
begin
  Result := '';
  while Value <> '' do begin
    StartPos := Pos('%', Value);
    if StartPos = 0 then begin
      Result := Result + Value;
      Break;
    end;
    Prefix := Copy(Value, 1, StartPos - 1);
    Delete(Value, 1, StartPos);
    EndPos := Pos('%', Value);
    if EndPos = 0 then begin
      Result := Result + Prefix + '%' + Value;
      Break;
    end;
    VariableName := Copy(Value, 1, EndPos - 1);
    Delete(Value, 1, EndPos);
    VariableValue := GetEnv(VariableName);
    if VariableValue = '' then
      VariableValue := '%' + VariableName + '%';
    Result := Result + Prefix + VariableValue;
  end;
end;

function NormalizedPath(Value: String): String;
begin
  Value := Trim(Value);
  if (Length(Value) >= 2) and (Value[1] = '"') and (Value[Length(Value)] = '"') then
    Value := Copy(Value, 2, Length(Value) - 2);
  Result := Lowercase(RemoveBackslashUnlessRoot(ExpandedPath(Value)));
end;

function PathContains(const Value, Directory: String): Boolean;
var
  Rest, Entry: String;
  Separator: Integer;
begin
  Result := False;
  Rest := Value + ';';
  while Rest <> '' do begin
    Separator := Pos(';', Rest);
    Entry := Copy(Rest, 1, Separator - 1);
    Delete(Rest, 1, Separator);
    if NormalizedPath(Entry) = NormalizedPath(Directory) then begin
      Result := True;
      Exit;
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  CurrentPath, Directory, Marker: String;
  Owner: TArrayOfString;
begin
  if (CurStep <> ssPostInstall) or not WizardIsTaskSelected('addtopath') then
    Exit;
  Directory := ExpandConstant('{app}');
  Marker := ExpandConstant('{app}\path-owned.txt');
  CurrentPath := '';
  RegQueryStringValue(HKCU, 'Environment', 'Path', CurrentPath);
  if PathContains(CurrentPath, Directory) then
    Exit;
  SetArrayLength(Owner, 1);
  Owner[0] := Directory;
  if not SaveStringsToUTF8File(Marker, Owner, False) then
    RaiseException('Cannot record ownership of the Node Tester PATH entry.');
  if CurrentPath = '' then
    CurrentPath := Directory
  else
    CurrentPath := CurrentPath + ';' + Directory;
  if not RegWriteExpandStringValue(HKCU, 'Environment', 'Path', CurrentPath) then begin
    DeleteFile(Marker);
    RaiseException('Cannot update the user PATH.');
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  CurrentPath, Rest, Entry, UpdatedPath, OwnedPath: String;
  Owner: TArrayOfString;
  Separator, Matches, Position, MatchPosition: Integer;
begin
  if CurUninstallStep <> usUninstall then
    Exit;
  if not LoadStringsFromFile(ExpandConstant('{app}\path-owned.txt'), Owner) then
    Exit;
  if GetArrayLength(Owner) <> 1 then
    Exit;
  OwnedPath := Owner[0];
  if OwnedPath <> ExpandConstant('{app}') then
    Exit;
  if not RegQueryStringValue(HKCU, 'Environment', 'Path', CurrentPath) then
    Exit;
  Rest := CurrentPath + ';';
  Matches := 0;
  Position := 1;
  MatchPosition := 0;
  while Rest <> '' do begin
    Separator := Pos(';', Rest);
    Entry := Copy(Rest, 1, Separator - 1);
    Delete(Rest, 1, Separator);
    if Entry = OwnedPath then begin
      Matches := Matches + 1;
      MatchPosition := Position;
    end;
    Position := Position + Separator;
  end;
  { Only remove the unique exact entry created by this installer. Preserve
    pre-existing entries, modified entries, and ambiguous duplicate entries. }
  if Matches = 1 then begin
    UpdatedPath := CurrentPath;
    if MatchPosition + Length(OwnedPath) <= Length(CurrentPath) then
      Delete(UpdatedPath, MatchPosition, Length(OwnedPath) + 1)
    else if MatchPosition > 1 then
      Delete(UpdatedPath, MatchPosition - 1, Length(OwnedPath) + 1)
    else
      UpdatedPath := '';
    if not RegWriteExpandStringValue(HKCU, 'Environment', 'Path', UpdatedPath) then
      Log('Could not remove the owned user PATH entry.');
  end;
end;
