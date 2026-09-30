[CmdletBinding()]
param(
  [switch]$Publish
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$coreInstaller = Join-Path $projectRoot 'dist/zodiak-core-setup.exe'
$shellProject = Join-Path $projectRoot 'native/installer-shell/ZodiakInstaller.csproj'
$payloadDirectory = Join-Path $projectRoot 'native/installer-shell/Payload'
$assetsDirectory = Join-Path $projectRoot 'native/installer-shell/Assets'
$shellOutput = Join-Path $projectRoot 'native/installer-shell/publish/zodiak-setup.exe'
$publicInstaller = Join-Path $projectRoot 'dist/zodiak-setup.exe'
$updateManifest = Join-Path $projectRoot 'dist/latest.yml'
$displayVersion = (Get-Content (Join-Path $projectRoot 'VERSION') -Raw).Trim()

Push-Location $projectRoot
try {
  npm run version:sync
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectRoot 'scripts/create-launch-artwork.ps1')
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not generate the Windows icon from build/icon.png.'
  }
  npm run build:system-audio-capture
  npm run build
  npx electron-builder --win nsis --publish never --config.nsis.artifactName=zodiak-core-setup.exe

  New-Item -ItemType Directory -Force -Path $payloadDirectory,$assetsDirectory | Out-Null
  Copy-Item -LiteralPath $coreInstaller -Destination (Join-Path $payloadDirectory 'zodiak-core-setup.exe') -Force
  # WPF does not natively render SVG; use the supplied raster counterpart of
  # build/logo.svg for the installer sidebar.
  Copy-Item -LiteralPath (Join-Path $projectRoot 'build/logo.png') -Destination (Join-Path $assetsDirectory 'logo.png') -Force
  Copy-Item -LiteralPath (Join-Path $projectRoot 'build/icon.ico') -Destination (Join-Path $assetsDirectory 'zodiak.ico') -Force

  dotnet publish $shellProject -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:Version=$displayVersion -p:InformationalVersion=$displayVersion -o (Join-Path $projectRoot 'native/installer-shell/publish')
  Copy-Item -LiteralPath $shellOutput -Destination $publicInstaller -Force

  $version = (Get-Content (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
  $hasher = [System.Security.Cryptography.SHA512]::Create()
  try {
    $sha512 = [Convert]::ToBase64String($hasher.ComputeHash([System.IO.File]::ReadAllBytes($publicInstaller)))
  }
  finally {
    $hasher.Dispose()
  }
  $releaseDate = [DateTime]::UtcNow.ToString('o')
  @"
version: $version
files:
  - url: zodiak-setup.exe
    sha512: $sha512
path: zodiak-setup.exe
sha512: $sha512
releaseDate: '$releaseDate'
"@ | Set-Content -LiteralPath $updateManifest -Encoding utf8

  if ($Publish) {
    $gh = Get-Command gh -ErrorAction SilentlyContinue
    if ($null -eq $gh) {
      throw 'GitHub CLI is required to publish the custom setup executable.'
    }
    $tag = "v$version"
    & gh release view $tag 2>$null
    if ($LASTEXITCODE -ne 0) {
      & gh release create $tag --title $tag --generate-notes
    }
    & gh release upload $tag $publicInstaller $updateManifest --clobber
    if ($LASTEXITCODE -ne 0) {
      throw 'GitHub release upload failed.'
    }
  }
}
finally {
  Pop-Location
}
