param(
  [string]$ReleaseVersion = "2029.0.0",
  [string]$Output = ""
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($ReleaseVersion -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$') {
  throw "ReleaseVersion '$ReleaseVersion' is not valid Semantic Versioning 2.0.0."
}

if ([string]::IsNullOrWhiteSpace($Output)) {
  $Output = "digified-theme-$ReleaseVersion.zip"
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

$archivePath = Join-Path $repoRoot $Output
if (Test-Path $archivePath) {
  Remove-Item $archivePath -Force
}

$stagingRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("digified-theme-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $stagingRoot | Out-Null

try {
  foreach ($entry in $entries) {
    Copy-Item -Path (Join-Path $repoRoot $entry) -Destination $stagingRoot -Recurse -Force
  }

  $stagedManifestPath = Join-Path $stagingRoot "manifest.json"
  $manifest = Get-Content -Raw -Path $stagedManifestPath | ConvertFrom-Json
  $manifest.version = $ReleaseVersion

  # Zendesk is fussy about manifest parsing. Write UTF-8 without a BOM so the
  # imported archive contains plain JSON with an unambiguous SemVer.
  $manifestJson = $manifest | ConvertTo-Json -Depth 100
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($stagedManifestPath, $manifestJson, $utf8NoBom)

  # Use .NET ZIP support rather than an external tar executable. This avoids
  # Git Bash resolving /usr/bin/tar on Windows and interpreting C:\ paths as
  # remote-host syntax, while still producing standard forward-slash ZIP entries.
  try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
  }
  catch {
    # PowerShell Core already exposes ZipFile on platforms where this assembly
    # is folded into the runtime, so an Add-Type failure is not fatal by itself.
  }

  if (-not ("System.IO.Compression.ZipFile" -as [type])) {
    throw "System.IO.Compression.ZipFile is unavailable in this PowerShell runtime."
  }

  [System.IO.Compression.ZipFile]::CreateFromDirectory(
    $stagingRoot,
    $archivePath,
    [System.IO.Compression.CompressionLevel]::Optimal,
    $false
  )
}
finally {
  if (Test-Path $stagingRoot) {
    Remove-Item -Path $stagingRoot -Recurse -Force
  }
}

if (-not (Test-Path $archivePath)) {
  throw "Theme archive was not created: $archivePath"
}

Write-Host "Created $Output with theme version $ReleaseVersion"
