# schedule_psd_download.ps1
# 一键注册 Windows 定时任务：每天 19:00 自动运行 PSD 下载脚本

$TaskName = "OneReport_PSD_Download"
$ScriptPath = "D:\Py projects\onereport\OneReportdownload_refined_v2.py"

# ⚠️ 改成你电脑上 python.exe 的完整路径！
$PythonPath = "C:\Users\zengzhi1\AppData\Local\Programs\Python\Python311\python.exe"

$LogDir = "D:\Py projects\onereport\logs"

# 检查是否以管理员身份运行
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "请以管理员身份运行此脚本！" -ForegroundColor Red
    pause
    exit 1
}

# 检查 Python 是否存在
if (-not (Test-Path $PythonPath)) {
    Write-Host "找不到 Python: $PythonPath" -ForegroundColor Red
    Write-Host "请先用 'where python' 或 'Get-Command python' 查找正确路径" -ForegroundColor Yellow
    pause
    exit 1
}

# 检查脚本是否存在
if (-not (Test-Path $ScriptPath)) {
    Write-Host "找不到脚本: $ScriptPath" -ForegroundColor Red
    pause
    exit 1
}

# 删除已存在的同名任务
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

# 创建定时任务
$Action = New-ScheduledTaskAction `
    -Execute $PythonPath `
    -Argument "`"$ScriptPath`" --auto --headless" `
    -WorkingDirectory "D:\Py projects\onereport"

$Trigger = New-ScheduledTaskTrigger -Daily -At "19:00"

$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 5)

$Principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType S4U `
    -RunLevel Highest

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Description "每天 19:00 自动从 OneReport 下载 PSD 报表（无头模式）" `
    -Force

Write-Host ""
Write-Host "✅ 定时任务已注册成功！" -ForegroundColor Green
Write-Host "执行命令: $PythonPath `"$ScriptPath`" --auto --headless"
Write-Host ""

# 验证
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
    Write-Host "📋 任务状态: $($task.State)" -ForegroundColor Cyan
    Write-Host "⏰ 下次运行: $($task.Triggers[0].StartBoundary)" -ForegroundColor Cyan
}

pause