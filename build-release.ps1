param([string]$NodeVersion='v22.23.2')
$ErrorActionPreference='Stop'
$gpRoot=$PSScriptRoot
$gpDist=Join-Path $gpRoot 'dist'
New-Item -ItemType Directory -Force -Path $gpDist | Out-Null
$gpVersion=(Get-Content (Join-Path $gpRoot 'package.json') -Raw | ConvertFrom-Json).version
$gpName="PlayBatch-$gpVersion-Windows-x64"
$gpStage=Join-Path $gpDist ($gpName+'-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $gpStage | Out-Null
$gpArchive="node-$NodeVersion-win-x64.zip"
$gpCache=Join-Path $gpDist $gpArchive
$gpSums=(Invoke-WebRequest "https://nodejs.org/dist/$NodeVersion/SHASUMS256.txt" -UseBasicParsing).Content
$gpExpected=($gpSums -split "\n" | Where-Object { $_.Trim().EndsWith("  $gpArchive") }).Trim().Split(' ')[0]
if (-not $gpExpected -or $gpExpected.Length -ne 64) { throw 'Missing official SHA256' }
if (-not (Test-Path -LiteralPath $gpCache)) { Invoke-WebRequest "https://nodejs.org/dist/$NodeVersion/$gpArchive" -OutFile $gpCache -UseBasicParsing }
if ((Get-FileHash -LiteralPath $gpCache -Algorithm SHA256).Hash -ne $gpExpected) { throw 'Node.js archive checksum mismatch' }
$gpExtract=Join-Path $gpStage '_node'
Expand-Archive -LiteralPath $gpCache -DestinationPath $gpExtract
$gpRuntime=Join-Path $gpStage 'runtime'
New-Item -ItemType Directory -Path $gpRuntime | Out-Null
Copy-Item -LiteralPath (Join-Path $gpExtract "node-$NodeVersion-win-x64\node.exe") -Destination $gpRuntime
Copy-Item -LiteralPath (Join-Path $gpExtract "node-$NodeVersion-win-x64\LICENSE") -Destination (Join-Path $gpRuntime 'NODE-LICENSE.txt')
# Delete only the known extraction directory inside this newly created staging folder.
$gpResolved=(Resolve-Path -LiteralPath $gpExtract).Path
if (-not $gpResolved.StartsWith($gpStage+[IO.Path]::DirectorySeparatorChar)) { throw 'Unsafe extraction path' }
Remove-Item -LiteralPath $gpResolved -Recurse -Force
$gpFiles=@('server.js','core.js','credentials.js','finance.js','review-monitor.js','feishu-notifications.js','listings-workbook.js','updater.js','update-install.ps1','launch-target.ps1','google-api-discovery.json','package.json','README.md','GOOGLE_AUTH_GUIDE.html','start.ps1','stop.ps1','start.cmd','stop.cmd','启动工具.cmd','停止工具.cmd','使用说明.txt')
foreach ($gpFile in $gpFiles) { Copy-Item -LiteralPath (Join-Path $gpRoot $gpFile) -Destination $gpStage }
New-Item -ItemType Directory -Path (Join-Path $gpStage 'public') | Out-Null
foreach ($gpFile in @('app.js','index.html','style.css')) { Copy-Item -LiteralPath (Join-Path $gpRoot "public\$gpFile") -Destination (Join-Path $gpStage 'public') }
New-Item -ItemType Directory -Path (Join-Path $gpStage 'vendor') | Out-Null
foreach ($gpFile in @('xlsx.full.min.js','SHEETJS-LICENSE.txt','README.md')) { Copy-Item -LiteralPath (Join-Path $gpRoot "vendor\$gpFile") -Destination (Join-Path $gpStage 'vendor') }
$gpZip=Join-Path $gpDist ($gpName+'.zip')
if (Test-Path -LiteralPath $gpZip) { throw 'Release archive already exists; increment version or archive it first.' }
Compress-Archive -Path (Join-Path $gpStage '*') -DestinationPath $gpZip -CompressionLevel Optimal
$gpHash=(Get-FileHash -LiteralPath $gpZip -Algorithm SHA256).Hash.ToLower()
[IO.File]::WriteAllText((Join-Path $gpDist 'SHA256SUMS.txt'),$gpHash+'  '+[IO.Path]::GetFileName($gpZip)+[Environment]::NewLine)
Write-Output "STAGE=$gpStage"
Write-Output "ZIP=$gpZip"
