@echo off
rem =========================================================
rem 构建单文件离线版（dist/legal-assistant-single.html）
rem 优先使用项目内 runtime\node.exe，其次系统 node
rem =========================================================
cd /d "%~dp0"
if exist "runtime\node.exe" (
  "runtime\node.exe" build-single.js
  goto :end
)
where node >nul 2>nul
if %errorlevel%==0 (
  node build-single.js
  goto :end
)
echo [WARN] 未找到 Node.js：单文件版需要 Node 来构建。
echo  - 如需全功能联网服务，请安装 Node.js 后运行 启动.bat
echo  - 或直接分发 压缩包/网页版目录（见 README.md 分发说明）
pause
:end
pause
