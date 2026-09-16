function Get-PlayBatchTarget([string]$CurrentRoot,[string]$DataPath) {
  $gpPointer=Join-Path $DataPath 'active-install.json'
  if (-not (Test-Path -LiteralPath $gpPointer)) { return $null }
  $gpActive=Get-Content -LiteralPath $gpPointer -Raw -Encoding UTF8 | ConvertFrom-Json
  $gpVersions=[IO.Path]::GetFullPath((Join-Path $DataPath 'versions'))+[IO.Path]::DirectorySeparatorChar
  $gpTarget=[IO.Path]::GetFullPath([string]$gpActive.root)
  if (-not $gpTarget.StartsWith($gpVersions,[StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid update installation path.' }
  if (-not (Test-Path -LiteralPath (Join-Path $gpTarget 'runtime\node.exe'))) { throw 'Updated runtime is missing.' }
  $gpPackage=Get-Content -LiteralPath (Join-Path $gpTarget 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($gpPackage.name -ne 'gp-product-workbench') { throw 'Invalid update application.' }
  $gpLocalPackage=Get-Content -LiteralPath (Join-Path $CurrentRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  # A manually downloaded newer package must not be redirected to an older installation.
  if ([version]$gpLocalPackage.version -gt [version]$gpPackage.version) { return $null }
  if ($gpTarget.TrimEnd('\') -eq $CurrentRoot.TrimEnd('\')) { return $null }
  return $gpTarget
}
