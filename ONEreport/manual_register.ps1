# 直接复制以下全部内容到管理员 PowerShell 执行
$TaskName = "OneReport_PSD_Download"
$ScriptPath = "D:\Py projects\onereport\OneReportdownload_refined_v2.py"

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$Action = New-ScheduledTaskAction -Execute "python" -Argument '"D:\Py projects\onereport\OneReportdownload_refined_v2.py" --auto --headless' -WorkingDirectory "D:\Py projects\onereport"
$Trigger = New-ScheduledTaskTrigger -Daily -At "19:00"
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Force
Write-Host "任务已创建成功！" -ForegroundColor Green
