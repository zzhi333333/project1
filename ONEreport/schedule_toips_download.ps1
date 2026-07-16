# schedule_toips_download.ps1
# Register Windows scheduled task for TO IPS & Order Plan download.

$TaskName = "OneReport_toips_Download"
$TaskPath = "\OneReport\"
$ScriptPath = "D:\Py projects\onereport\OneReportdownload_toips.py"
$PythonPath = "C:\Users\zengzhi1\AppData\Local\Programs\Python\Python312\python.exe"
$WorkDir = "D:\Py projects\onereport"

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Please run this script as Administrator." -ForegroundColor Red
    pause
    exit 1
}

if (-not (Test-Path $PythonPath)) {
    Write-Host "Python not found: $PythonPath" -ForegroundColor Red
    pause
    exit 1
}

if (-not (Test-Path $ScriptPath)) {
    Write-Host "Script not found: $ScriptPath" -ForegroundColor Red
    pause
    exit 1
}

Unregister-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -Confirm:$false -ErrorAction SilentlyContinue

$Action = New-ScheduledTaskAction `
    -Execute $PythonPath `
    -Argument "`"$ScriptPath`" --auto --headless" `
    -WorkingDirectory $WorkDir

$Trigger = New-ScheduledTaskTrigger -Daily -At "11:30"

$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 45) `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 5)

$Principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType S4U `
    -RunLevel Highest

Register-ScheduledTask `
    -TaskName $TaskName `
    -TaskPath $TaskPath `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Description "Download TO IPS and Order Plan reports from OneReport daily at 11:30 in headless mode" `
    -Force

Write-Host ""
Write-Host "TO IPS scheduled task registered successfully." -ForegroundColor Green
Write-Host "Task name: $TaskPath$TaskName"
Write-Host "Command: $PythonPath `"$ScriptPath`" --auto --headless"
Write-Host "Working directory: $WorkDir"
Write-Host ""

$task = Get-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -ErrorAction SilentlyContinue
if ($task) {
    Write-Host "Task state: $($task.State)" -ForegroundColor Cyan
    Write-Host "Next run: $($task.Triggers[0].StartBoundary)" -ForegroundColor Cyan
}

pause
