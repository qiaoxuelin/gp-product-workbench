param([switch]$Direct)
$ErrorActionPreference = 'Stop'
$gpRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$gpData = if ($env:GP_DATA_DIR) { $env:GP_DATA_DIR } elseif (Test-Path -LiteralPath (Join-Path $gpRoot 'runtime\node.exe')) { Join-Path $env:LOCALAPPDATA 'GP-Product-Workbench' } else { Join-Path $gpRoot 'data' }
if (-not $Direct) {
  . (Join-Path $gpRoot 'launch-target.ps1')
  $gpTarget=Get-PlayBatchTarget $gpRoot $gpData
  if ($gpTarget) {
    $env:GP_DATA_DIR=$gpData
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $gpTarget 'stop.ps1') -Direct
    exit $LASTEXITCODE
  }
}
$gpPidFile = Join-Path $gpData 'server.pid'
if (-not (Test-Path -LiteralPath $gpPidFile)) { Write-Host 'No managed server process.'; exit 0 }
$gpPid = [int](Get-Content -LiteralPath $gpPidFile)
$gpProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $gpPid"
$gpServer = Join-Path $gpRoot 'server.js'
if ($gpProcess -and $gpProcess.Name -eq 'node.exe' -and $gpProcess.CommandLine.Contains($gpServer)) {
  Stop-Process -Id $gpPid -PassThru | Wait-Process -Timeout 10
  Write-Host 'GP Product Workbench stopped.'
} elseif ($gpProcess) { throw 'Process identity differs; refusing to stop it.' }
Remove-Item -LiteralPath $gpPidFile
