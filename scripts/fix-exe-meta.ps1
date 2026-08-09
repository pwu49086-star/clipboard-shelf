$ErrorActionPreference = 'Stop'

# Use rcedit from the electron-builder cache to write correct version metadata + icon
$cacheRoot = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\winCodeSign'
$rcedit = Get-ChildItem -LiteralPath $cacheRoot -Recurse -Filter 'rcedit-x64.exe' -Force -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $rcedit) {
  Write-Error 'rcedit-x64.exe not found in electron-builder cache'
  exit 1
}

$root = Split-Path -Parent $PSScriptRoot
$icon = Join-Path $root 'resources\icon.ico'
$targets = @(
  (Join-Path $root 'release\win-unpacked\Clipboard Shelf.exe'),
  (Join-Path $root 'release\Clipboard Shelf 1.0.0.exe')
)

foreach ($t in $targets) {
  if (Test-Path -LiteralPath $t) {
    & $rcedit.FullName $t `
      --set-version-string 'ProductName' 'Clipboard Shelf' `
      --set-version-string 'FileDescription' 'Clipboard Shelf' `
      --set-version-string 'CompanyName' 'Clipboard Shelf' `
      --set-file-version '1.0.0' `
      --set-product-version '1.0.0' `
      --set-icon $icon
    Write-Host "meta fixed: $t"
  }
}
