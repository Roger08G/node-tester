#requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
    [Parameter(Mandatory)][string]$PackagePath,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [string]$CompilerPath,
    [switch]$SmokeTest
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows) { throw 'The Windows installer must be built on Windows.' }
$archivePath = (Resolve-Path -LiteralPath $PackagePath).Path
if ([IO.Path]::GetExtension($archivePath) -ne '.tgz') { throw 'PackagePath must be an npm .tgz archive.' }
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$outputPath = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null
$tempParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$buildRoot = Join-Path $tempParent ('node-tester-installer-build-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $buildRoot | Out-Null

function Invoke-HiddenProcess([string]$FilePath, [string[]]$Arguments) {
    $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -WindowStyle Hidden -PassThru
    if (-not $process.WaitForExit(120000)) {
        $process.Kill($true)
        throw "Process exceeded two-minute limit: $([IO.Path]::GetFileName($FilePath))"
    }
    if ($process.ExitCode -ne 0) { throw "Process failed ($($process.ExitCode)): $([IO.Path]::GetFileName($FilePath))" }
}

try {
    $extractRoot = Join-Path $buildRoot 'extracted'
    New-Item -ItemType Directory -Path $extractRoot | Out-Null
    $archiveStream = [IO.File]::OpenRead($archivePath)
    $gzip = [IO.Compression.GZipStream]::new($archiveStream, [IO.Compression.CompressionMode]::Decompress)
    $reader = [System.Formats.Tar.TarReader]::new($gzip)
    try {
        $entries = 0
        $totalBytes = 0L
        while ($null -ne ($entry = $reader.GetNextEntry())) {
            $entries++
            $name = $entry.Name.TrimEnd('/')
            $parts = $name.Split('/')
            if ($entries -gt 10000 -or $parts[0] -ne 'package' -or $name -match '[\\:\x00-\x1f]' -or @($parts | Where-Object { $_ -in @('', '.', '..') }).Count -gt 0) {
                throw "Unsafe npm archive entry: $name"
            }
            if ($entry.EntryType -notin @([System.Formats.Tar.TarEntryType]::RegularFile, [System.Formats.Tar.TarEntryType]::V7RegularFile, [System.Formats.Tar.TarEntryType]::Directory)) {
                throw "Unsupported npm archive entry type: $($entry.EntryType)"
            }
            $totalBytes += $entry.Length
            if ($entry.Length -gt 134217728 -or $totalBytes -gt 536870912) { throw 'npm archive exceeds installer input limits.' }
            $destination = [IO.Path]::GetFullPath((Join-Path $extractRoot $name))
            if (-not $destination.StartsWith($extractRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'npm archive escaped the extraction directory.' }
            if ($entry.EntryType -eq [System.Formats.Tar.TarEntryType]::Directory) {
                New-Item -ItemType Directory -Force -Path $destination | Out-Null
            } else {
                New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($destination)) | Out-Null
                $entry.ExtractToFile($destination, $false)
            }
        }
    } finally {
        $reader.Dispose()
        $gzip.Dispose()
        $archiveStream.Dispose()
    }
    $packageDirectory = Join-Path $extractRoot 'package'
    $manifest = Get-Content -Raw -LiteralPath (Join-Path $packageDirectory 'package.json') | ConvertFrom-Json
    if ($manifest.name -ne '@rogergomezm/node-tester' -or $manifest.version -ne $Version) { throw 'npm package identity/version mismatch.' }
    foreach ($target in @('win32-x64-msvc', 'win32-arm64-msvc', 'linux-x64-gnu', 'linux-arm64-gnu', 'darwin-x64', 'darwin-arm64')) {
        if (-not (Test-Path -LiteralPath (Join-Path $packageDirectory "native/node-tester-engine.$target.node") -PathType Leaf)) { throw "Missing assembled native target: $target" }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $packageDirectory 'dist/cli.js') -PathType Leaf)) { throw 'npm package does not contain its built CLI.' }

    $innoVersion = '6.5.3'
    $expectedSha256 = '9345ee029faa0b7aed0818c3d5b227699ef9a496cce79e20c19eb9d6ef2e2c2d'
    # ISCC.exe from the checksum-verified, signed Inno Setup 6.5.3 installer.
    $expectedCompilerSha256 = 'bee85a645a2c4e1be05024815cf80dbf0b52343eaad1f8330c85f63df0d0fb1e'
    $compiler = $CompilerPath
    if (-not $compiler) {
        foreach ($registryPath in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Inno Setup 6_is1', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Inno Setup 6_is1', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Inno Setup 6_is1')) {
            if (Test-Path -LiteralPath $registryPath) {
                $installed = Get-ItemProperty -LiteralPath $registryPath
                $candidate = Join-Path $installed.InstallLocation 'ISCC.exe'
                if ($installed.DisplayVersion -eq $innoVersion -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { $compiler = $candidate; break }
            }
        }
    }
    if (-not $compiler) {
        if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Install verified Inno Setup 6.5.3 or supply -CompilerPath. Automatic bootstrap is restricted to disposable CI runners.' }
        $innoInstaller = Join-Path $buildRoot "innosetup-$innoVersion.exe"
        Invoke-WebRequest -Uri "https://github.com/jrsoftware/issrc/releases/download/is-6_5_3/innosetup-$innoVersion.exe" -OutFile $innoInstaller -TimeoutSec 120
        if ((Get-FileHash -LiteralPath $innoInstaller -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedSha256) { throw 'Inno Setup checksum mismatch.' }
        $compilerDirectory = Join-Path $tempParent 'node-tester-inno-6.5.3\compiler'
        Invoke-HiddenProcess $innoInstaller @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CURRENTUSER', "/DIR=`"$compilerDirectory`"")
        $compiler = Join-Path $compilerDirectory 'ISCC.exe'
    }
    if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) { throw 'Pinned Inno Setup compiler was not installed.' }
    if ((Get-FileHash -LiteralPath $compiler -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedCompilerSha256) { throw 'Inno Setup 6.5.3 compiler checksum mismatch.' }
    & $compiler "/DMyAppVersion=$Version" "/DMyPackageDir=$packageDirectory" "/DMyOutputDir=$outputPath" (Join-Path $repoRoot 'packaging/windows-installer.iss')
    if ($LASTEXITCODE -ne 0) { throw 'Inno Setup compilation failed.' }
    $setup = Join-Path $outputPath "node-tester-v$Version-windows-setup.exe"
    if (-not (Test-Path -LiteralPath $setup -PathType Leaf)) { throw 'Windows installer was not produced.' }

    if ($SmokeTest) {
        $smokeDirectory = Join-Path $buildRoot 'smoke-app'
        $beforePath = [Environment]::GetEnvironmentVariable('Path', 'User')
        try {
            Invoke-HiddenProcess $setup @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CURRENTUSER', '/SMOKETEST=1', '/TASKS=""', "/DIR=`"$smokeDirectory`"")
            $installedCli = Join-Path $smokeDirectory 'package/dist/cli.js'
            $actualVersion = & node $installedCli --version
            if ($LASTEXITCODE -ne 0 -or $actualVersion -ne $Version) { throw 'Installed CLI version check failed.' }
            & node $installedCli (Join-Path $repoRoot 'test/fixtures/passing.test.mjs') --no-color
            if ($LASTEXITCODE -ne 0) { throw 'Installed package fixture failed.' }
            $launcher = Join-Path $smokeDirectory 'node-tester.cmd'
            if (-not (Test-Path -LiteralPath $launcher)) { throw 'Installed command launcher is absent.' }
            $launcherVersion = & $launcher --version
            if ($LASTEXITCODE -ne 0 -or $launcherVersion -ne $Version) { throw 'Installed command launcher version failed.' }
            $passingReport = & $launcher (Join-Path $repoRoot 'test/fixtures/passing.test.mjs') --no-color
            if ($LASTEXITCODE -ne 0 -or ($passingReport -join "`n") -notmatch '1 tests \| 1 passed') { throw 'Installed command launcher passing fixture failed.' }
            $failingReport = & $launcher (Join-Path $repoRoot 'test/fixtures/mixed.test.mjs') --no-color
            if ($LASTEXITCODE -ne 1 -or ($failingReport -join "`n") -notmatch 'FAIL') { throw 'Installed command launcher did not preserve failing-test exit status.' }
            $git = Get-Command git.exe -ErrorAction SilentlyContinue
            if ($git) {
                $gitDirectory = Split-Path -Parent $git.Source
                $bash = @((Join-Path $gitDirectory 'bash.exe'), (Join-Path (Split-Path -Parent $gitDirectory) 'bin/bash.exe')) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
                if ($bash) {
                    $bashVersion = & $bash --noprofile --norc (Join-Path $smokeDirectory 'node-tester') --version
                    if ($LASTEXITCODE -ne 0 -or $bashVersion -ne $Version) { throw 'Installed Git Bash launcher version failed.' }
                }
            }
        } finally {
            $uninstaller = Join-Path $smokeDirectory 'unins000.exe'
            if (Test-Path -LiteralPath $uninstaller -PathType Leaf) { Invoke-HiddenProcess $uninstaller @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART') }
        }
        if (Test-Path -LiteralPath (Join-Path $smokeDirectory 'node-tester.cmd')) { throw 'Uninstall left the command launcher behind.' }
        if ([Environment]::GetEnvironmentVariable('Path', 'User') -ne $beforePath) { throw 'PATH changed during installer smoke testing.' }
    }
    Get-Item -LiteralPath $setup
} finally {
    $resolvedBuildRoot = (Resolve-Path -LiteralPath $buildRoot).Path
    if (-not $resolvedBuildRoot.StartsWith($tempParent, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolvedBuildRoot) -notmatch '^node-tester-installer-build-[0-9a-f]{32}$') { throw 'Refusing to remove an unexpected installer build directory.' }
    Remove-Item -LiteralPath $resolvedBuildRoot -Recurse -Force
}
