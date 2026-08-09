$ErrorActionPreference = 'Stop'

# Rebuild better-sqlite3 for the Electron runtime (ABI must match Electron 33)
$root = Split-Path -Parent $PSScriptRoot
Push-Location (Join-Path $root 'node_modules\better-sqlite3')
try {
  npx node-gyp rebuild --target=33.4.11 --arch=x64 --dist-url=https://electronjs.org/headers --runtime=electron
  if ($LASTEXITCODE -ne 0) { throw "node-gyp rebuild failed with exit code $LASTEXITCODE" }
  Write-Host 'better-sqlite3 rebuilt for Electron'
} finally {
  Pop-Location
}
