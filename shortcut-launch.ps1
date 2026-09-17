$ErrorActionPreference='Stop'
try {
 $gpEntry=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'desktop-entry.json') -Raw -Encoding UTF8 | ConvertFrom-Json
 $env:GP_DATA_DIR=[string]$gpEntry.data
 $env:GP_PORT=[string]$gpEntry.port
 $env:GP_NO_BROWSER='0'
 $env:GP_NO_TRAY='0'
 & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $gpEntry.root 'start.ps1')
 if($LASTEXITCODE -ne 0){throw 'PlayBatch could not start. Run start.cmd from the program folder for details.'}
}catch{
 Add-Type -AssemblyName System.Windows.Forms
 [Windows.Forms.MessageBox]::Show($_.Exception.Message,'PlayBatch') | Out-Null
}
