param(
  [string]$Output = "digified-theme.zip"
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

$entries = @(
  "assets",
  "settings",
  "templates",
  "translations",
  "script.js",
  "style.css",
  "manifest.json"
)

foreach ($entry in $entries) {
  if (-not (Test-Path $entry)) {
    throw "Missing required entry '$entry'. Run the script from the theme root."
  }
}

if (Test-Path $Output) {
  Remove-Item $Output
}

$tarArgs = @("-a", "-c", "-f", $Output) + $entries
$tarProcess = Start-Process -FilePath "tar" -ArgumentList $tarArgs -NoNewWindow -Wait -PassThru

if ($tarProcess.ExitCode -ne 0) {
  throw "tar failed with exit code $($tarProcess.ExitCode)"
}

Write-Host "Created $Output"
