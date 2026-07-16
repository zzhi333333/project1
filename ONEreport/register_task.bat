@echo off
chcp 65001 >nul
title 注册 OneReport PSD 定时任务
echo ==========================================
echo  OneReport PSD 定时任务注册工具
echo ==========================================
echo.

:: 检查是否以管理员身份运行
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 请以管理员身份运行此脚本！
    echo.
    echo 操作方法：
    echo   1. 右键点击此文件
echo   2. 选择"以管理员身份运行"
echo.
    pause
    exit /b 1
)

echo [1/4] 正在检查文件路径...
set "ScriptPath=D:\Py projects\onereport\OneReportdownload_refined_v2.py"
set "PythonPath=python"
set "TaskName=OneReport_PSD_Download"

if not exist "%ScriptPath%" (
    echo [错误] 找不到脚本: %ScriptPath%
    pause
    exit /b 1
)
echo       文件路径检查通过
echo.

echo [2/4] 正在删除已存在的同名任务...
schtasks /delete /tn "%TaskName%" /f >nul 2>&1
echo       清理完成
echo.

echo [3/4] 正在创建定时任务...
:: 创建 XML 任务定义文件
set "TaskXml=%TEMP%\OneReport_Task.xml"
(
echo ^<?xml version="1.0" encoding="UTF-16"?^>
echo ^<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"^>
echo   ^<RegistrationInfo^>
echo     ^<Description^>每天 19:00 自动从 OneReport 下载 PSD 报表^</Description^>
echo   ^</RegistrationInfo^>
echo   ^<Triggers^>
echo     ^<CalendarTrigger^>
echo       ^<StartBoundary^>2024-01-01T19:00:00^</StartBoundary^>
echo       ^<ScheduleByDay^>
echo         ^<DaysInterval^>1^</DaysInterval^>
echo       ^</ScheduleByDay^>
echo     ^</CalendarTrigger^>
echo   ^</Triggers^>
echo   ^<Principals^>
echo     ^<Principal id="Author"^>
echo       ^<UserId^>%USERNAME%^</UserId^>
echo       ^<LogonType^>S4U^</LogonType^>
echo       ^<RunLevel^>HighestAvailable^</RunLevel^>
echo     ^</Principal^>
echo   ^</Principals^>
echo   ^<Settings^>
echo     ^<MultipleInstancesPolicy^>IgnoreNew^</MultipleInstancesPolicy^>
echo     ^<DisallowStartIfOnBatteries^>false^</DisallowStartIfOnBatteries^>
echo     ^<StopIfGoingOnBatteries^>false^</StopIfGoingOnBatteries^>
echo     ^<AllowHardTerminate^>true^</AllowHardTerminate^>
echo     ^<StartWhenAvailable^>true^</StartWhenAvailable^>
echo     ^<RunOnlyIfNetworkAvailable^>false^</RunOnlyIfNetworkAvailable^>
echo     ^<IdleSettings^>
echo       ^<StopOnIdleEnd^>true^</StopOnIdleEnd^>
echo       ^<RestartOnIdle^>false^</RestartOnIdle^>
echo     ^</IdleSettings^>
echo     ^<AllowStartOnDemand^>true^</AllowStartOnDemand^>
echo     ^<Enabled^>true^</Enabled^>
echo     ^<Hidden^>false^</Hidden^>
echo     ^<RunOnlyIfIdle^>false^</RunOnlyIfIdle^>
echo     ^<WakeToRun^>false^</WakeToRun^>
echo     ^<ExecutionTimeLimit^>PT30M^</ExecutionTimeLimit^>
echo     ^<Priority^>7^</Priority^>
echo   ^</Settings^>
echo   ^<Actions Context="Author"^>
echo     ^<Exec^>
echo       ^<Command^>%PythonPath%^</Command^>
echo       ^<Arguments^>"%ScriptPath%" --auto --headless^</Arguments^>
echo       ^<WorkingDirectory^>D:\Py projects\onereport^</WorkingDirectory^>
echo     ^</Exec^>
echo   ^</Actions^>
echo ^</Task^>
) > "%TaskXml%"

:: 导入任务
schtasks /create /tn "%TaskName%" /xml "%TaskXml%" /f
if %errorlevel% neq 0 (
    echo [错误] 任务创建失败！
    del "%TaskXml%" >nul 2>&1
    pause
    exit /b 1
)

del "%TaskXml%" >nul 2>&1
echo       任务创建成功
echo.

echo [4/4] 正在验证任务状态...
schtasks /query /tn "%TaskName%" /fo list | findstr "任务名称"
echo.

echo ==========================================
echo  ✅ 定时任务注册成功！
echo ==========================================
echo.
echo 任务名称: %TaskName%
echo 执行时间: 每天 19:00
echo 执行命令: python "%ScriptPath%" --auto --headless
echo 日志目录: D:\Py projects\onereport\logs
echo.
echo 注意事项:
echo   1. 请先手动运行一次脚本完成登录以保存 Cookie
echo   2. Cookie 过期后需再次手动运行刷新
echo   3. 确保电脑 19:00 时处于开机且未休眠状态
echo   4. 可按 Win+R 输入 taskschd.msc 查看/修改任务
echo.
pause
