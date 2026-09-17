$ErrorActionPreference='Stop'
$gpRoot=Split-Path -Parent $PSScriptRoot
$gpData=Join-Path $gpRoot ('dist\desktop-smoke-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $gpData | Out-Null
$gpDesktop=Join-Path $gpData 'Desktop';$gpPrograms=Join-Path $gpData 'Programs'
& (Join-Path $gpRoot 'create-shortcuts.ps1') -AppRoot $gpRoot -DataPath $gpData -Port 14352 -DesktopDirectory $gpDesktop -ProgramsDirectory $gpPrograms
$gpShell=New-Object -ComObject WScript.Shell
foreach($gpLinkFile in @((Join-Path $gpDesktop 'PlayBatch.lnk'),(Join-Path $gpPrograms 'PlayBatch\PlayBatch.lnk'))){
 if(-not(Test-Path -LiteralPath $gpLinkFile)){throw 'Shortcut missing'}
 $gpLink=$gpShell.CreateShortcut($gpLinkFile)
 if($gpLink.Arguments -notlike '*desktop-launch.ps1*' -or $gpLink.IconLocation -notlike '*playbatch.ico*'){throw 'Invalid shortcut target or icon'}
}
Write-Output 'PASS: real Desktop and Start Menu .lnk files point to the stable launcher'
$env:GP_DATA_DIR=$gpData;$env:GP_PORT='14352';$env:GP_NO_BROWSER='1';$env:GP_NO_TRAY='1'
try{
 & (Join-Path $gpRoot 'start.ps1')
 $gpBaseArgs='-NoProfile -ExecutionPolicy Bypass -STA -File "'+(Join-Path $gpRoot 'tray.ps1')+'" -DataPath "'+$gpData+'" -Port 14352'
 $gpFirst=Start-Process powershell.exe -ArgumentList $gpBaseArgs -WindowStyle Hidden -PassThru
 for($gpTry=0;$gpTry -lt 30;$gpTry++){if(Test-Path -LiteralPath (Join-Path $gpData 'tray-status.json')){break};Start-Sleep -Milliseconds 250}
 if(-not(Test-Path -LiteralPath (Join-Path $gpData 'tray-status.json'))){throw 'Tray did not report running status'}
 $gpSecond=Start-Process powershell.exe -ArgumentList ($gpBaseArgs+' -SmokeTest') -WindowStyle Hidden -PassThru
 if(-not $gpSecond.WaitForExit(5000) -or (Test-Path -LiteralPath (Join-Path $gpData 'tray-smoke.json'))){throw 'Duplicate tray instance was not rejected'}
 & (Join-Path $gpRoot 'stop.ps1')
 if(-not $gpFirst.WaitForExit(30000)){throw 'Tray did not exit after service stopped'}
 Write-Output 'PASS: duplicate tray rejected and tray exited after stop.cmd'
 & (Join-Path $gpRoot 'start.ps1')
 $gpArgs='-NoProfile -ExecutionPolicy Bypass -STA -File "'+(Join-Path $gpRoot 'tray.ps1')+'" -DataPath "'+$gpData+'" -Port 14352 -SmokeTest'
 $gpTray=Start-Process powershell.exe -ArgumentList $gpArgs -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $gpData 'tray-test.log') -RedirectStandardError (Join-Path $gpData 'tray-test.err')
 if(-not $gpTray.WaitForExit(30000)){throw 'Tray smoke timed out'}
 if($null -ne $gpTray.ExitCode -and $gpTray.ExitCode -ne 0){throw ('Tray failed: '+[IO.File]::ReadAllText((Join-Path $gpData 'tray-test.err')))}
 $gpResult=Get-Content -LiteralPath (Join-Path $gpData 'tray-smoke.json') -Raw -Encoding UTF8 | ConvertFrom-Json
 if($gpResult.error -or -not $gpResult.quit -or -not $gpResult.diagnostics){throw ($gpResult|ConvertTo-Json)}
 $gpExpected=(Get-Content (Join-Path $gpRoot 'package.json') -Raw|ConvertFrom-Json).version
 if($gpResult.version -ne $gpExpected){throw 'Tray version mismatch'}
 $gpReport=Get-Content -LiteralPath (Join-Path $gpData 'tray-diagnostics.json') -Raw | ConvertFrom-Json
 if($gpReport.format -ne 'playbatch-diagnostics-v1'){throw 'Invalid tray diagnostic report'}
 Start-Sleep -Milliseconds 700
 try{Invoke-RestMethod -Uri 'http://127.0.0.1:14352/api/session' -TimeoutSec 2 | Out-Null;throw 'Service stayed running after quit'}catch{if($_.Exception.Message -eq 'Service stayed running after quit'){throw}}
 Write-Output 'PASS: real NotifyIcon initialized, menu exported diagnostics, quit stopped service'
 Write-Output ('ARTIFACTS='+$gpData)
}finally{& (Join-Path $gpRoot 'stop.ps1')}
