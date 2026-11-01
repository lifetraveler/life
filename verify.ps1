# Slice-1 verify script (run with pwsh 7): .\verify.ps1
$ErrorActionPreference = 'Continue'
Set-Location -Path $PSScriptRoot

Write-Host '=== [1/4] npm install ===' -ForegroundColor Cyan
npm install *>&1 | Tee-Object -FilePath npm-install.log
Write-Host "--- exit code: $LASTEXITCODE ---"

Write-Host '=== [2/4] npx expo install --fix (align deps to SDK 54) ===' -ForegroundColor Cyan
npx expo install --fix *>&1 | Tee-Object -FilePath expo-install-fix.log
Write-Host "--- exit code: $LASTEXITCODE ---"

Write-Host '=== [3/4] npx tsc --noEmit ===' -ForegroundColor Cyan
npx tsc --noEmit *>&1 | Tee-Object -FilePath tsc.log
Write-Host "--- exit code: $LASTEXITCODE ---"

Write-Host '=== [4/4] npx expo-doctor ===' -ForegroundColor Cyan
npx expo-doctor *>&1 | Tee-Object -FilePath expo-doctor.log
Write-Host "--- exit code: $LASTEXITCODE ---"

Write-Host '=== DONE. Logs: npm-install.log / expo-install-fix.log / tsc.log / expo-doctor.log ===' -ForegroundColor Green
