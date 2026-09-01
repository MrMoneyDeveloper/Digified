param(
  [string]$Output = "digified-theme.zip",
  [string]$ReleaseVersion = "2028.2.7"
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($ReleaseVersion -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$') {
  throw "ReleaseVersion '$ReleaseVersion' is not valid Semantic Versioning 2.0.0."
}

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

$entries = @(
  "assets",
  "settings",
  "templates",
  "translations",
  "script.js",
  "style.css",
  "manifest.json",
  "settings_schema.json"
)

foreach ($entry in $entries) {
  if (-not (Test-Path $entry)) {
    throw "Missing required entry '$entry'. Run the script from the theme root."
  }
}

if (Test-Path $Output) {
  Remove-Item $Output -Force
}

# Build from a temporary staging directory so the release archive can carry a
# strictly newer Zendesk theme version without mutating a developer's working
# manifest in place.
$stagingRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("digified-theme-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $stagingRoot | Out-Null

try {
  foreach ($entry in $entries) {
    Copy-Item -Path (Join-Path $repoRoot $entry) -Destination $stagingRoot -Recurse -Force
  }

  $stagedManifestPath = Join-Path $stagingRoot "manifest.json"
  $manifest = Get-Content -Raw -Path $stagedManifestPath | ConvertFrom-Json
  $manifest.version = $ReleaseVersion
  $manifest | ConvertTo-Json -Depth 100 | Set-Content -Path $stagedManifestPath -Encoding utf8

  Push-Location $stagingRoot
  try {
    $tarArgs = @("-a", "-c", "-f", (Join-Path $repoRoot $Output)) + $entries
    $tarProcess = Start-Process -FilePath "tar" -ArgumentList $tarArgs -NoNewWindow -Wait -PassThru

    if ($tarProcess.ExitCode -ne 0) {
      throw "tar failed with exit code $($tarProcess.ExitCode)"
    }
  }
  finally {
    Pop-Location
  }
}
finally {
  if (Test-Path $stagingRoot) {
    Remove-Item -Path $stagingRoot -Recurse -Force
  }
}

Write-Host "Created $Output with theme version $ReleaseVersion"
