#!/usr/bin/env bash
# 切片1 step4: expo run:android 首次构建（prebuild 已完成，直接 gradle + 安装 + Metro 长驻）
set -u
export JAVA_HOME='D:\enviroment\java\jdk\oracle-jdk-17.0.10'
export ANDROID_HOME='D:\Android\Sdk'
export ANDROID_SDK_ROOT='D:\Android\Sdk'
export PATH="/d/enviroment/java/jdk/oracle-jdk-17.0.10/bin:/d/Android/Sdk/platform-tools:$PATH"

echo "== env =="
java -version 2>&1 | head -1
adb devices

echo "== expo run:android (first build, 10-30min) =="
npx expo run:android 2>&1 | tee gradle-build.log
echo "== expo run:android exited with code $? =="
