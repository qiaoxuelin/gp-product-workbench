param([Parameter(Mandatory=$true)][string]$JobFile)
$ErrorActionPreference='Stop'
$gpJob=Get-Content -LiteralPath $JobFile -Raw -Encoding UTF8 | ConvertFrom-Json
$gpData=[IO.Path]::GetFullPath($gpJob.data)
$gpStatus=Join-Path $gpData 'update-status.json'
$gpLock=Join-Path $gpData 'update.lock'
$gpCandidate=$null
$gpStopped=$false
$gpPointer=Join-Path $gpData 'active-install.json'
$gpPreviousPointer=if(Test-Path -LiteralPath $gpPointer){[IO.File]::ReadAllText($gpPointer)}else{$null}
$gpPointerChanged=$false
function Set-UpdateStatus([string]$Phase,[string]$Message) {
  $gpJson=@{phase=$Phase;message=$Message;version=$gpJob.version;updatedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($gpStatus+'.tmp',$gpJson,[Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath ($gpStatus+'.tmp') -Destination $gpStatus -Force
}
function Stop-ExactServer([int]$ProcessId,[string]$AppRoot) {
  $gpProc=Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId"
  if (-not $gpProc) { return }
  $gpScript=Join-Path $AppRoot 'server.js'
  if ($gpProc.Name -ne 'node.exe' -or $gpProc.ExecutablePath -ne (Join-Path $AppRoot 'runtime\node.exe') -or -not $gpProc.CommandLine.Contains('"'+$gpScript+'"')) { throw 'Server identity changed; refusing to stop.' }
  Stop-Process -Id $ProcessId -PassThru | Wait-Process -Timeout 15
}
function Start-ExactServer([string]$AppRoot) {
  $env:GP_DATA_DIR=$gpData
  $env:GP_PORT=[string]$gpJob.port
  $env:GP_NO_BROWSER='1'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $AppRoot 'start.ps1') -Direct
  if ($LASTEXITCODE -ne 0) { throw 'Could not start application.' }
  $gpHealth=Invoke-RestMethod -Uri ('http://127.0.0.1:'+$gpJob.port+'/api/session') -TimeoutSec 3
  $gpExpected=(Get-Content -LiteralPath (Join-Path $AppRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
  if ($gpHealth.application -ne 'gp-product-workbench' -or $gpHealth.version -ne $gpExpected) { throw 'Updated version health check failed.' }
}
try {
  [IO.File]::WriteAllText($gpLock,[string]$PID)
  if ((Get-FileHash -LiteralPath $gpJob.zip -Algorithm SHA256).Hash.ToLower() -ne $gpJob.sha256) { throw 'SHA256 verification failed.' }
  $gpVersions=Join-Path $gpData 'versions'
  New-Item -ItemType Directory -Force -Path $gpVersions | Out-Null
  $gpCandidate=Join-Path $gpVersions ('v'+$gpJob.version+'-'+[guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $gpCandidate | Out-Null
  if ((Get-Item -LiteralPath $gpVersions).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Update directory must not be a junction or symlink.' }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $gpArchive=[IO.Compression.ZipFile]::OpenRead($gpJob.zip)
  try {
    $gpSeen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $gpTotal=0L
    if ($gpArchive.Entries.Count -gt 500) { throw 'Too many archive entries.' }
    foreach($gpEntry in $gpArchive.Entries) {
      $gpName=$gpEntry.FullName.Replace('\','/')
      if ($gpName.EndsWith('/')) { continue }
      if ($gpName -match '(^/|:|(^|/)\.\.?(/|$)|[<>|?*\x00-\x1f])' -or ($gpName.Split('/') | Where-Object { -not $_ -or $_.EndsWith('.') -or $_.EndsWith(' ') -or $_ -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)' })) { throw 'Unsafe archive path.' }
      if (-not $gpSeen.Add($gpName)) { throw 'Duplicate archive path.' }
      $gpDest=[IO.Path]::GetFullPath((Join-Path $gpCandidate $gpName))
      if (-not $gpDest.StartsWith($gpCandidate+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Archive path escapes installation.' }
      $gpTotal+=$gpEntry.Length
      if ($gpTotal -gt 1GB) { throw 'Expanded archive too large.' }
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $gpDest) | Out-Null
      [IO.Compression.ZipFileExtensions]::ExtractToFile($gpEntry,$gpDest,$false)
    }
  } finally { $gpArchive.Dispose() }
  foreach($gpRequired in @('package.json','server.js','start.ps1','stop.ps1','launch-target.ps1','runtime\node.exe','public\app.js','public\index.html')) {
    if (-not (Test-Path -LiteralPath (Join-Path $gpCandidate $gpRequired) -PathType Leaf)) { throw ('Missing application file: '+$gpRequired) }
  }
  $gpPackage=Get-Content -LiteralPath (Join-Path $gpCandidate 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($gpPackage.name -ne 'gp-product-workbench' -or $gpPackage.version -ne $gpJob.version) { throw 'Application version mismatch.' }
  Set-UpdateStatus 'installing' 'Restarting application'
  Start-Sleep -Milliseconds 800
  Stop-ExactServer ([int]$gpJob.pid) $gpJob.root
  $gpStopped=$true
  Start-Sleep -Milliseconds 700
  Start-ExactServer $gpCandidate
  $gpPointer=Join-Path $gpData 'active-install.json'
  [IO.File]::WriteAllText($gpPointer+'.tmp',(@{root=$gpCandidate;version=$gpJob.version}|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath ($gpPointer+'.tmp') -Destination $gpPointer -Force
  $gpPointerChanged=$true
  Set-UpdateStatus 'complete' 'Update complete'
} catch {
  $gpFailure=$_.Exception.Message
  if ($gpPointerChanged) {
    if ($null -eq $gpPreviousPointer) { Remove-Item -LiteralPath $gpPointer }
    else { [IO.File]::WriteAllText($gpPointer,$gpPreviousPointer,[Text.UTF8Encoding]::new($false)) }
  }
  if ($gpStopped) {
    try {
      $gpPidFile=Join-Path $gpData 'server.pid'
      if (Test-Path -LiteralPath $gpPidFile) { Stop-ExactServer ([int](Get-Content -LiteralPath $gpPidFile)) $gpCandidate }
      Start-ExactServer $gpJob.root
      $gpFailure+='; previous version restarted'
    } catch { $gpFailure+='; restart failed: '+$_.Exception.Message+'; please run the original start.cmd' }
  }
  Set-UpdateStatus 'failed' $gpFailure
} finally {
  if (Test-Path -LiteralPath $gpLock) { Remove-Item -LiteralPath $gpLock }
}
