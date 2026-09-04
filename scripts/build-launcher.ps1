param(
  [string]$Icon = (Join-Path $PSScriptRoot '..\assets\PlotBetter.ico'),
  [string]$OutputExe = (Join-Path $PSScriptRoot '..\PlotBetter.exe')
)

$ErrorActionPreference = 'Stop'

$candidates = @(
  "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
  "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)
$csc = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $csc) {
  throw 'csc.exe not found; .NET Framework 4.x compiler is required.'
}

$icon = (Resolve-Path -LiteralPath $Icon).Path
$source = Join-Path $PSScriptRoot '..\launcher\PlotBetter.cs'
$outputExe = [System.IO.Path]::GetFullPath($OutputExe)

& $csc `
  /nologo `
  /target:winexe `
  /optimize+ `
  /codepage:65001 `
  "/win32icon:$icon" `
  "/out:$outputExe" `
  /r:System.dll `
  /r:System.Core.dll `
  /r:System.Drawing.dll `
  /r:System.Windows.Forms.dll `
  $source

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Write-Host "Built $outputExe"
