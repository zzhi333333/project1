@echo off
if "%LA_SIGN_PASS%"=="" set "LA_SIGN_PASS=legal123"   
rem =========================================================
rem 法律咨询助手（移动版）一键构建脚本 —— Windows CMD
rem 依赖：JDK 17+、Android SDK（build-tools + platforms/android-34）
rem   默认安装位置：C:\Users\zz333\android\{jdk-*,sdk}
rem 输出：dist\legal-assistant-mobile-v1.0.apk
rem =========================================================
setlocal enabledelayedexpansion
chcp 65001 >nul

set "ROOT=%~dp0"
set "APP=%ROOT%app\src\main"
set "OUT=%ROOT%build"
set "DIST=%ROOT%dist"
set "KS=%ROOT%tools\debug.keystore"
set "VERSION_NAME=4.0.32"

if "%JAVA_HOME%"=="" (
  for /d %%D in ("C:\Users\zz333\android\jdk-*") do set "JAVA_HOME=%%D"
)
set "SDK=%ANDROID_SDK%"
if "%SDK%"=="" set "SDK=C:\Users\zz333\android\sdk"

for /d %%D in ("%SDK%\build-tools\*") do set "BT=%%D"
for /d %%D in ("%SDK%\platforms\android-*") do set "PLAT=%%D"

if not exist "%JAVA_HOME%" ( echo ❌ 未找到 JDK，请安装到 C:\Users\zz333\android\jdk-17.x 或设置 JAVA_HOME & exit /b 1 )
if not exist "%BT%"       ( echo ❌ 未找到 build-tools，请检查 %SDK% & exit /b 1 )
if not exist "%PLAT%"     ( echo ❌ 未找到 platforms\android-*，请检查 %SDK% & exit /b 1 )

set "PATH=%JAVA_HOME%\bin;%PATH%"
echo 🔧 JDK:         %JAVA_HOME%
echo 🔧 build-tools: %BT%
echo 🔧 platform:    %PLAT%

rd /s /q "%OUT%" 2>nul
mkdir "%OUT%\gen" "%OUT%\obj" "%OUT%\dex" "%DIST%" 2>nul
if not exist "%ROOT%tools" mkdir "%ROOT%tools"

rem 1. 资源打包 + R.java（含 assets/www）
"%BT%\aapt" package -f -m -J "%OUT%\gen" -M "%APP%\AndroidManifest.xml" -S "%APP%\res" -A "%APP%\assets" -I "%PLAT%\android.jar" -F "%OUT%\unsigned.apk"
if errorlevel 1 goto :fail

rem 2. 收集源码并编译（路径含空格，需逐行加引号）
dir /s /b "%APP%\java\*.java" > "%OUT%\sources-raw.txt"
dir /s /b "%OUT%\gen\*.java" >> "%OUT%\sources-raw.txt"
break > "%OUT%\sources.txt"
setlocal enabledelayedexpansion
for /f "usebackq delims=" %%F in ("%OUT%\sources-raw.txt") do (
  set "P=%%F"
  echo "!P:\=/!">>"%OUT%\sources.txt"
)
javac --release 8 -encoding UTF-8 -nowarn -classpath "%PLAT%\android.jar" -d "%OUT%\obj" @"%OUT%\sources.txt"
if errorlevel 1 goto :fail

rem 3. dex
jar cf "%OUT%\classes.jar" -C "%OUT%\obj" .
call "%BT%\d8.bat" --release --lib "%PLAT%\android.jar" --output "%OUT%\dex" "%OUT%\classes.jar"
if errorlevel 1 goto :fail

rem 4. classes.dex 放入 APK
pushd "%OUT%\dex"
"%BT%\aapt" add "%OUT%\unsigned.apk" classes.dex >nul
popd

rem 5. 对齐
"%BT%\zipalign" -f 4 "%OUT%\unsigned.apk" "%OUT%\aligned.apk"
if errorlevel 1 goto :fail

rem 6. 签名密钥（首次自动生成，固定密钥以便覆盖安装）
if not exist "%KS%" (
  echo 🔑 生成签名密钥 tools\debug.keystore（密码 %LA_SIGN_PASS%（可设环境变量 LA_SIGN_PASS 覆盖））
  keytool -genkeypair -keystore "%KS%" -storepass "%LA_SIGN_PASS%" -keypass "%LA_SIGN_PASS%" -alias legalassistant -keyalg RSA -keysize 2048 -validity 10950 -dname "CN=Legal Assistant, OU=Personal, O=zz333, C=CN" >nul 2>&1
)

set "APK=%DIST%\legal-assistant-mobile-v%VERSION_NAME%.apk"
call "%BT%\apksigner.bat" sign --ks "%KS%" --ks-pass pass:%LA_SIGN_PASS% --key-pass pass:%LA_SIGN_PASS% --out "%APK%" "%OUT%\aligned.apk"
if errorlevel 1 goto :fail
call "%BT%\apksigner.bat" verify "%APK%"
if errorlevel 1 goto :fail

echo.
echo ✅ 构建完成：%APK%
exit /b 0

:fail
echo ❌ 构建失败，请检查上方报错
exit /b 1
