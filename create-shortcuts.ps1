param([string]$AppRoot=$PSScriptRoot,[string]$DataPath,[int]$Port=4318,[string]$DesktopDirectory,[string]$ProgramsDirectory)
$ErrorActionPreference='Stop'
if(-not $DataPath){$DataPath=if($env:GP_DATA_DIR){$env:GP_DATA_DIR}elseif(Test-Path -LiteralPath (Join-Path $AppRoot 'runtime\node.exe')){Join-Path $env:LOCALAPPDATA 'GP-Product-Workbench'}else{Join-Path $AppRoot 'data'}}
if(-not $DesktopDirectory){$DesktopDirectory=[Environment]::GetFolderPath('DesktopDirectory')}
if(-not $ProgramsDirectory){$ProgramsDirectory=[Environment]::GetFolderPath('Programs')}
New-Item -ItemType Directory -Force -Path $DataPath | Out-Null
$gpEntry=@{root=[IO.Path]::GetFullPath($AppRoot);data=[IO.Path]::GetFullPath($DataPath);port=$Port}|ConvertTo-Json -Compress
[IO.File]::WriteAllText((Join-Path $DataPath 'desktop-entry.json'),$gpEntry,[Text.UTF8Encoding]::new($false))
Copy-Item -LiteralPath (Join-Path $AppRoot 'shortcut-launch.ps1') -Destination (Join-Path $DataPath 'desktop-launch.ps1') -Force
Copy-Item -LiteralPath (Join-Path $AppRoot 'playbatch.ico') -Destination (Join-Path $DataPath 'playbatch.ico') -Force
$gpShell=New-Object -ComObject WScript.Shell
foreach($gpFolder in @($DesktopDirectory,(Join-Path $ProgramsDirectory 'PlayBatch'))){
 New-Item -ItemType Directory -Force -Path $gpFolder | Out-Null
 $gpLink=$gpShell.CreateShortcut((Join-Path $gpFolder 'PlayBatch.lnk'))
 $gpLink.TargetPath=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
 $gpLink.Arguments='-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+(Join-Path $DataPath 'desktop-launch.ps1')+'"'
 $gpLink.WorkingDirectory=$DataPath
 $gpLink.IconLocation=(Join-Path $DataPath 'playbatch.ico')+',0'
 $gpLink.Description='Open PlayBatch Product Workbench'
 $gpLink.WindowStyle=7
 $gpLink.Save()
}
Write-Output 'Desktop and Start Menu shortcuts created.'
