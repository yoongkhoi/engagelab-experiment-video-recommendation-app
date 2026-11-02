$ErrorActionPreference = "Stop"
$android = Join-Path $PSScriptRoot "..\android"
$wrapper = Join-Path $android "gradlew.bat"
if (-not (Test-Path $wrapper)) {
    Write-Error "gradlew.bat is missing. Run scripts/bootstrap-android.ps1 first."
}
if (-not $env:JAVA_HOME) {
    $portable = Get-ChildItem "D:\engagelab\.tools" -Directory -Filter "jdk-17*" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($portable) { $env:JAVA_HOME = $portable.FullName }
}
if (-not $env:ANDROID_HOME -and (Test-Path "$env:LOCALAPPDATA\Android\Sdk")) {
    $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
}
if (-not $env:ANDROID_HOME -and (Test-Path "D:\engagelab\.tools\android-sdk")) {
    $env:ANDROID_HOME = "D:\engagelab\.tools\android-sdk"
}
if (-not $env:JAVA_HOME) { Write-Error "JAVA_HOME is not set and no portable JDK 17 was found." }
if (-not $env:ANDROID_HOME) { Write-Error "ANDROID_HOME is not set. Install Android SDK platform 35 and build-tools." }
Push-Location $android
try {
    & $wrapper assembleDebug test
} finally {
    Pop-Location
}
