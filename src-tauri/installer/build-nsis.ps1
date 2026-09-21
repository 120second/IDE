$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\tauri.conf.json') -Raw | ConvertFrom-Json
$version = $config.version
$appExe = Join-Path $PSScriptRoot '..\target\release\lightcp.exe'
$outputDirectory = Join-Path $projectRoot 'release'
$outputExe = Join-Path $outputDirectory "LightCP_$($version)_x64-setup.exe"
$makensis = Join-Path ${env:ProgramFiles(x86)} 'NSIS\makensis.exe'

if (!(Test-Path -LiteralPath $appExe)) { throw "Release executable was not found: $appExe" }
if (!(Test-Path -LiteralPath $makensis)) { throw 'NSIS was not found. Run: winget install --id NSIS.NSIS --exact' }
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

& $makensis "/DAPP_VERSION=$version" "/DAPP_EXE=$appExe" "/DOUTPUT_EXE=$outputExe" (Join-Path $PSScriptRoot 'LightCP.nsi')
if ($LASTEXITCODE -ne 0) { throw "NSIS packaging failed with exit code: $LASTEXITCODE" }
Get-Item -LiteralPath $outputExe | Select-Object FullName, Length, LastWriteTime
