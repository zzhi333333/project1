#!/usr/bin/env bash
# =========================================================
# 法律咨询助手（移动版）一键构建脚本 —— Git Bash / Linux / macOS
# 依赖：JDK 17+、Android SDK（build-tools + platforms/android-34）
#   默认安装位置：C:/Users/zz333/android/{jdk-*,sdk}
#   可用环境变量覆盖：JAVA_HOME、ANDROID_SDK
# 输出：dist/legal-assistant-mobile-v<version>.apk
# =========================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="$ROOT/app/src/main"
OUT="$ROOT/build"
DIST="$ROOT/dist"
KS="$ROOT/tools/debug.keystore"
KS_PASS="pass:legal123"
VERSION_NAME="1.2"
VERSION_CODE="3"

# ---------- 工具链定位 ----------
JDK="${JAVA_HOME:-}"
if [ -z "$JDK" ]; then
  JDK="$(ls -d /c/Users/zz333/android/jdk-* 2>/dev/null | sort -V | tail -1 || true)"
fi
SDK="${ANDROID_SDK:-/c/Users/zz333/android/sdk}"
BT="$(ls -d "$SDK"/build-tools/* 2>/dev/null | sort -V | tail -1)"
PLAT="$(ls -d "$SDK"/platforms/android-* 2>/dev/null | sort -V | tail -1)"

[ -n "$JDK" ] && [ -d "$JDK" ] || { echo "❌ 未找到 JDK（设置 JAVA_HOME 或安装到 C:/Users/zz333/android/jdk-*）"; exit 1; }
[ -n "$BT" ] && [ -d "$BT" ] || { echo "❌ 未找到 build-tools（SDK: $SDK）"; exit 1; }
[ -n "$PLAT" ] && [ -d "$PLAT" ] || { echo "❌ 未找到 platforms/android-*（SDK: $SDK）"; exit 1; }

export JAVA_HOME="$JDK"
export PATH="$JDK/bin:$PATH"
echo "🔧 JDK:          $JDK"
echo "🔧 build-tools:  $BT"
echo "🔧 platform:     $PLAT"

# ---------- 清理与准备 ----------
rm -rf "$OUT"; mkdir -p "$OUT/gen" "$OUT/obj" "$OUT/dex" "$DIST" "$ROOT/tools"

# 1. 资源打包 + R.java（含 assets/www 一并装入）
"$BT/aapt" package -f -m \
  -J "$OUT/gen" -M "$APP/AndroidManifest.xml" \
  -S "$APP/res" -A "$APP/assets" \
  -I "$PLAT/android.jar" -F "$OUT/unsigned.apk"

# 2. 编译 Java（argfile 需 Windows 正斜杠路径并对含空格路径加引号）
find "$APP/java" "$OUT/gen" -name "*.java" | while IFS= read -r f; do
  printf '"%s"\n' "$(cygpath -m "$f")"
done > "$OUT/sources.txt"
javac --release 8 -encoding UTF-8 -nowarn \
  -classpath "$(cygpath -w "$PLAT/android.jar")" \
  -d "$OUT/obj" @"$OUT/sources.txt"

# 3. dex（jar 归档后交给 d8，自动 desugar lambda）
jar cf "$OUT/classes.jar" -C "$OUT/obj" .
"$BT/d8.bat" --release --lib "$PLAT/android.jar" \
  --output "$OUT/dex" "$OUT/classes.jar" 2>/dev/null \
  || "$BT/d8" --release --lib "$PLAT/android.jar" --output "$OUT/dex" "$OUT/classes.jar"

# 4. classes.dex 放入 APK 根目录
(cd "$OUT/dex" && "$BT/aapt" add "$OUT/unsigned.apk" classes.dex) >/dev/null

# 5. 对齐
"$BT/zipalign" -f 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"

# 6. 签名密钥（首次自动生成，固定密钥以便覆盖安装）
if [ ! -f "$KS" ]; then
  echo "🔑 生成签名密钥 tools/debug.keystore（密码 legal123）"
  keytool -genkeypair -keystore "$KS" -storepass legal123 -keypass legal123 \
    -alias legalassistant -keyalg RSA -keysize 2048 -validity 10950 \
    -dname "CN=Legal Assistant, OU=Personal, O=zz333, C=CN" >/dev/null 2>&1
fi

APK="$DIST/legal-assistant-mobile-v$VERSION_NAME.apk"
"$BT/apksigner.bat" sign --ks "$KS" --ks-pass "$KS_PASS" --key-pass "$KS_PASS" \
  --out "$APK" "$OUT/aligned.apk" 2>/dev/null \
  || "$BT/apksigner" sign --ks "$KS" --ks-pass "$KS_PASS" --key-pass "$KS_PASS" --out "$APK" "$OUT/aligned.apk"
"$BT/apksigner" verify "$APK" 2>/dev/null || "$BT/apksigner.bat" verify "$APK"

echo ""
echo "✅ 构建完成：$APK"
ls -la "$APK"
