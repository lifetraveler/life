# Android env preflight v2: .\check-android-env2.ps1  (start the emulator FIRST, then run this)
$ErrorActionPreference = 'Continue'
Set-Location -Path $PSScriptRoot
$log = Join-Path $PSScriptRoot 'android-env2.log'
"Android env preflight v2 - $(Get-Date -Format s)" | Set-Content $log

function Log([string]$title, [scriptblock]$block) {
  "=== $title ===" | Add-Content $log
  $out = (& $block) 2>&1 | Out-String
  $out.TrimEnd() | Add-Content $log
  "" | Add-Content $log
}

Log 'java via JAVA_HOME bin' { & "$env:JAVA_HOME\bin\java.exe" -version }
Log 'java via PATH shim'     { java -version }
Log 'adb version'            { adb version }
Log 'adb devices'            { adb devices }
Log 'JAVA_HOME'              { $env:JAVA_HOME }
Log 'ANDROID env vars'       { "ANDROID_HOME=[$env:ANDROID_HOME] ANDROID_SDK_ROOT=[$env:ANDROID_SDK_ROOT]" }

Log 'running emulator processes' {
  Get-Process | Where-Object { $_.Name -match 'emulator|qemu|MuMu|LdBox|LdVBox|dnplayer|Nox|HD-Player' } |
    Select-Object Name, Id | Format-Table -AutoSize | Out-String
}

Log 'SDK candidate dirs' {
  $dirs = @(
    "$env:LOCALAPPDATA\Android\Sdk",
    'C:\Android\Sdk', 'D:\Android\Sdk',
    'D:\codeproject\Android\Sdk',
    "$env:USERPROFILE\AppData\Local\Android\Sdk"
  )
  foreach ($d in $dirs) {
    if ($d -and (Test-Path $d)) {
      "FOUND: $d"
      Get-ChildItem $d -Name | Select-Object -First 15
    } else { "missing: $d" }
  }
}

Log 'Android Studio install dirs' {
  $dirs = @("$env:LOCALAPPDATA\Programs\Android Studio", 'C:\Program Files\Android\Android Studio', 'D:\Android Studio')
  foreach ($d in $dirs) {
    if (Test-Path $d) { "FOUND: $d" } else { "missing: $d" }
  }
}

Get-Content $log
