$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot\..
Write-Host 'Building frontend...'
& cmd /c "cd client && npm run build"
Write-Host 'Bundling backend...'
& cmd /c "node scripts/build-server.js"
Write-Host 'Packaging desktop app (installer + portable exe)...'
& cmd /c "npm run dist"
Write-Host 'Done. Output is in dist-electron\'
