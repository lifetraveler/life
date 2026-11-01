# Android env preflight: .\check-android-env.ps1  (start the emulator FIRST, then run this)
$ErrorActionPreference = 'Continue'
Set-Location -Path $PSScriptRoot
Start-Transcript -Path android-env.log -Force | Out-Null

Write-Host '=== java ==='
Get-Command java -ErrorAction SilentlyContinue | Select-Object Name, Source
java -version
Write-Host "JAVA_HOME = $env:JAVA_HOME"

Write-Host '=== adb ==='
Get-Command adb -ErrorAction SilentlyContinue | Select-Object Name, Source
adb version
adb devices

Write-Host '=== env vars ==='
Write-Host "ANDROID_HOME = $env:ANDROID_HOME"
Write-Host "ANDROID_SDK_ROOT = $env:ANDROID_SDK_ROOT"

Write-Host '=== common SDK dirs ==='
foreach ($p in @("$env:LOCALAPPDATA\Android\Sdk", 'C:\Android\Sdk')) {
  if (Test-Path $p) { Write-Host "exists: $p" }
}

Stop-Transcript
