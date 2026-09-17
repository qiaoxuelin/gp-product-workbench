param([string]$DataPath,[int]$Port=4318,[switch]$SmokeTest)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$gpStrings=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'desktop-strings.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$gpHash=[BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes(([IO.Path]::GetFullPath($DataPath).ToLowerInvariant()+':'+$Port)))).Replace('-','')
$gpCreated=$false
$gpMutex=New-Object Threading.Mutex($true,('Local\PlayBatchTray-'+$gpHash),[ref]$gpCreated)
if(-not $gpCreated){$gpMutex.Dispose();exit 0}
$gpUrl='http://127.0.0.1:'+$Port
$gpOfflineSince=$null
$gpStateFile=Join-Path $DataPath 'tray-status.json'
$gpTestFile=Join-Path $DataPath 'tray-smoke.json'
$gpTestResult=@{menus=@();version='';diagnostics=$false;quit=$false;error=''}
function Invoke-Workbench([string]$Route){
 $gpSession=Invoke-RestMethod -Uri ($gpUrl+'/api/session') -TimeoutSec 2
 if($gpSession.application -ne 'gp-product-workbench'){throw 'Unexpected service on this port.'}
 Invoke-RestMethod -Uri ($gpUrl+'/api/'+$Route) -Method Post -ContentType 'application/json' -Headers @{'X-GP-Token'=$gpSession.token} -Body '{}' -TimeoutSec 5
}
function Show-TrayError($Failure){
 [IO.File]::AppendAllText((Join-Path $DataPath 'tray-error.log'),([DateTime]::UtcNow.ToString('o')+' '+[string]$Failure+[Environment]::NewLine),[Text.UTF8Encoding]::new($false))
 if($SmokeTest){$gpTestResult.error=[string]$Failure;return}
 [Windows.Forms.MessageBox]::Show([string]$Failure,'PlayBatch') | Out-Null
}
$gpIcon=New-Object Windows.Forms.NotifyIcon
$gpIcon.Icon=New-Object Drawing.Icon((Join-Path $PSScriptRoot 'playbatch.ico'))
$gpIcon.Text='PlayBatch'
$gpMenu=New-Object Windows.Forms.ContextMenuStrip
$gpVersionItem=$gpMenu.Items.Add('PlayBatch');$gpVersionItem.Enabled=$false
$gpOpen=$gpMenu.Items.Add($gpStrings.open)
$gpOpen.add_Click({Start-Process $gpUrl})
$gpIcon.add_DoubleClick({Start-Process $gpUrl})
$gpShortcuts=$gpMenu.Items.Add($gpStrings.shortcuts)
$gpShortcuts.add_Click({try{Invoke-Workbench 'system/shortcuts' | Out-Null;$gpIcon.ShowBalloonTip(3000,'PlayBatch',$gpStrings.created,[Windows.Forms.ToolTipIcon]::Info)}catch{Show-TrayError $_.Exception.Message}})
$gpDiagnostic=$gpMenu.Items.Add($gpStrings.diagnostics)
$gpDiagnostic.add_Click({
 try{
  $gpTarget=$null
  if($SmokeTest){$gpTarget=Join-Path $DataPath 'tray-diagnostics.json'}else{
   $gpSave=New-Object Windows.Forms.SaveFileDialog
   try{$gpSave.Title=$gpStrings.diagnosticsTitle;$gpSave.Filter='JSON (*.json)|*.json';$gpSave.FileName='PlayBatch-diagnostics-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.json';if($gpSave.ShowDialog() -eq 'OK'){$gpTarget=$gpSave.FileName}}finally{$gpSave.Dispose()}
  }
  if($gpTarget){$gpReport=Invoke-Workbench 'system/diagnostics';[IO.File]::WriteAllText($gpTarget,($gpReport|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false));$gpTestResult.diagnostics=$true}
 }catch{Show-TrayError $_.Exception.Message}
})
[void]$gpMenu.Items.Add((New-Object Windows.Forms.ToolStripSeparator))
$gpQuit=$gpMenu.Items.Add($gpStrings.quit)
$gpQuit.add_Click({
 if(-not $SmokeTest -and [Windows.Forms.MessageBox]::Show($gpStrings.quitPrompt,'PlayBatch','YesNo','Question') -ne 'Yes'){return}
 try{Invoke-Workbench 'system/quit' | Out-Null;$gpTestResult.quit=$true;[Windows.Forms.Application]::Exit()}catch{Show-TrayError $_.Exception.Message}
})
$gpIcon.ContextMenuStrip=$gpMenu;$gpIcon.Visible=$true
$gpTimer=New-Object Windows.Forms.Timer;$gpTimer.Interval=3000
$gpTimer.add_Tick({
 try{
  $gpState=Invoke-Workbench 'system/status'
  $script:gpOfflineSince=$null
  $gpVersionItem.Text='PlayBatch v'+$gpState.version
  $gpIcon.Text=$gpVersionItem.Text
  $gpQuit.Enabled=(-not $gpState.busy -and -not $gpState.update.locked -and $gpState.update.phase -notin @('checking','downloading','installing'))
  $gpShortcuts.Enabled=$gpQuit.Enabled
  $gpTestResult.version=$gpState.version
  [IO.File]::WriteAllText($gpStateFile,(@{pid=$PID;port=$Port;lastSeen=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
  if($SmokeTest){$gpTestResult.menus=@($gpMenu.Items | ForEach-Object {$_.Text});$gpDiagnostic.PerformClick();$gpQuit.PerformClick();if(-not $gpTestResult.quit){[Windows.Forms.Application]::Exit()}}
 }catch{
  $gpIcon.Text=$gpStrings.disconnected
  $gpQuit.Enabled=$false;$gpShortcuts.Enabled=$false
  if(-not $script:gpOfflineSince){$script:gpOfflineSince=Get-Date}
  $gpWait=if(Test-Path -LiteralPath (Join-Path $DataPath 'update.lock')){900}else{15}
  if(((Get-Date)-$script:gpOfflineSince).TotalSeconds -gt $gpWait){[Windows.Forms.Application]::Exit()}
  if($SmokeTest){$gpTestResult.error=$_.Exception.Message;[Windows.Forms.Application]::Exit()}
 }
})
try{$gpTimer.Start();[Windows.Forms.Application]::Run()}finally{
 $gpTimer.Stop();$gpTimer.Dispose();$gpIcon.Visible=$false;$gpIcon.Icon.Dispose();$gpIcon.Dispose();$gpMenu.Dispose()
 try{if((Get-Content -LiteralPath $gpStateFile -Raw|ConvertFrom-Json).pid -eq $PID){Remove-Item -LiteralPath $gpStateFile}}catch{}
 if($SmokeTest){[IO.File]::WriteAllText($gpTestFile,($gpTestResult|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))}
 $gpMutex.ReleaseMutex();$gpMutex.Dispose()
}
