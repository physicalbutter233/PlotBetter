param(
  [string]$LauncherExe = (Join-Path $PSScriptRoot '..\PlotBetter.exe')
)

$ErrorActionPreference = 'Stop'

$launcher = (Resolve-Path -LiteralPath $LauncherExe).Path
$shell = New-Object -ComObject WScript.Shell

$locations = @(
  (Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'PlotBetter.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'PlotBetter.lnk')
)

foreach ($location in $locations) {
  $shortcut = $shell.CreateShortcut($location)
  $shortcut.TargetPath = $launcher
  $shortcut.WorkingDirectory = Split-Path -Parent $launcher
  $shortcut.IconLocation = "$launcher,0"
  $shortcut.Description = 'Launch PlotBetter'
  $shortcut.Save()
  Write-Host "Created $location"
}
