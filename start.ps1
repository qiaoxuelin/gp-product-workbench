param([switch]$Direct)
$ErrorActionPreference = 'Stop'
$gpRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$gpPort = if ($env:GP_PORT) { $env:GP_PORT } else { '4318' }
$gpUrl = 'http://127.0.0.1:' + $gpPort
$gpBundled = Join-Path $gpRoot 'runtime\node.exe'
if (-not $env:GP_DATA_DIR -and (Test-Path -LiteralPath $gpBundled)) { $env:GP_DATA_DIR = Join-Path $env:LOCALAPPDATA 'GP-Product-Workbench' }
$gpData = if ($env:GP_DATA_DIR) { $env:GP_DATA_DIR } else { Join-Path $gpRoot 'data' }
if (-not $Direct) {
  . (Join-Path $gpRoot 'launch-target.ps1')
  $gpTarget=Get-PlayBatchTarget $gpRoot $gpData
  if ($gpTarget) {
    $env:GP_DATA_DIR=$gpData
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $gpTarget 'start.ps1') -Direct
    exit $LASTEXITCODE
  }
}
$gpNode = if (Test-Path -LiteralPath $gpBundled) { $gpBundled } else { (Get-Command node.exe -ErrorAction Stop).Source }
$gpVersion = ((& $gpNode --version).TrimStart('v').Split('.'))[0]
if ([int]$gpVersion -lt 22) { throw 'Node.js 22 or newer is required.' }
$gpRunning = $false
try {
  $gpHealth = Invoke-RestMethod -Uri "$gpUrl/api/session" -TimeoutSec 2
  if ($gpHealth.application -ne 'gp-product-workbench') { throw 'Port 4318 is used by another app.' }
  $gpRunning = $true
} catch {
  $gpListener = Get-NetTCPConnection -LocalPort $gpPort -State Listen -ErrorAction SilentlyContinue
  if ($gpListener) { throw 'Port 4318 is occupied. Stop the other app first.' }
}
if (-not $gpRunning) {
  New-Item -ItemType Directory -Force -Path $gpData | Out-Null
  $gpServer = Join-Path $gpRoot 'server.js'
  $gpProcess = Start-Process -FilePath $gpNode -ArgumentList ('"' + $gpServer + '"') -WorkingDirectory $gpRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $gpData 'server.log') -RedirectStandardError (Join-Path $gpData 'server-error.log')
  $gpProcess.Id | Set-Content (Join-Path $gpData 'server.pid')
  for ($gpAttempt=0; $gpAttempt -lt 30; $gpAttempt++) {
    Start-Sleep -Milliseconds 200
    try {
      $gpHealth = Invoke-RestMethod -Uri "$gpUrl/api/session" -TimeoutSec 1
      if ($gpHealth.application -eq 'gp-product-workbench') { $gpRunning=$true; break }
    } catch {}
  }
  if (-not $gpRunning) { throw 'Startup failed. See data\server-error.log.' }
}
if ($env:GP_NO_TRAY -ne '1') {
  $gpTrayArgs='-NoProfile -ExecutionPolicy Bypass -STA -File "'+(Join-Path $gpRoot 'tray.ps1')+'" -DataPath "'+$gpData+'" -Port '+$gpPort
  try { Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -ArgumentList $gpTrayArgs -WindowStyle Hidden }
  catch { [IO.File]::AppendAllText((Join-Path $gpData 'tray-error.log'),($_.Exception.Message+[Environment]::NewLine)) }
}
if ($env:GP_NO_BROWSER -ne '1') { Start-Process $gpUrl }
Write-Host "GP Product Workbench is running at $gpUrl"
