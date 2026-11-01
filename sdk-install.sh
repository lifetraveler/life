#!/usr/bin/env bash
# 切片1 step2: 安装 Android SDK cmdline-tools + 组件到 D:\Android\Sdk
# 用法: bash sdk-install.sh 2>&1 | tee sdk-install.log  (后台作业)
set -eu

export JAVA_HOME=/d/enviroment/java/jdk/oracle-jdk-17.0.10
export PATH="$JAVA_HOME/bin:$PATH"

echo "== [1/6] java check =="
java -version 2>&1 | head -1

echo "== [2/6] download cmdline-tools =="
mkdir -p /d/Android/Sdk/cmdline-tools
cd /d/Android
ZIP=commandlinetools-win-11076708_latest.zip
if [ ! -s "$ZIP" ]; then
  curl -fL --retry 3 -o "$ZIP" "https://dl.google.com/android/repository/$ZIP" \
    || curl -fL --retry 3 -o "$ZIP" "https://dl.google.com/android/repository/commandlinetools-win-13114758_latest.zip"
fi
ls -la "$ZIP"

echo "== [3/6] unzip to D:/Android/Sdk/cmdline-tools/latest =="
rm -rf /d/Android/Sdk/cmdline-tools/latest /d/Android/cmdline-tools
if command -v unzip >/dev/null 2>&1; then
  unzip -q "$ZIP" -d /d/Android/
elif [ -x /c/Windows/System32/tar.exe ]; then
  /c/Windows/System32/tar.exe -xf "$ZIP" -C /d/Android/
else
  powershell.exe -NoProfile -Command "Expand-Archive -Path 'D:\\Android\\$ZIP' -DestinationPath 'D:\\Android\\' -Force"
fi
mv /d/Android/cmdline-tools /d/Android/Sdk/cmdline-tools/latest
ls /d/Android/Sdk/cmdline-tools/latest/bin/

export ANDROID_HOME='D:\Android\Sdk'
SDKM=/d/Android/Sdk/cmdline-tools/latest/bin/sdkmanager.bat

echo "== [4/6] accept licenses =="
yes | "$SDKM" --licenses || true
"$SDKM" --licenses 2>/dev/null | grep -i "accepted" || true

echo "== [5/6] install platform-tools platforms;android-36 build-tools;36.0.0 ndk;27.1.12297006 cmake;3.22.1 =="
yes | "$SDKM" --install "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;27.1.12297006" "cmake;3.22.1" || true

echo "== [6/6] setx ANDROID_HOME + verify =="
setx ANDROID_HOME 'D:\Android\Sdk' || true
"$SDKM" --list_installed

echo "== SDK INSTALL DONE =="
