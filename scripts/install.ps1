$ErrorActionPreference = "Stop"

$RepoUrl = if ($env:TARAE_REPO_URL) { $env:TARAE_REPO_URL } else { "https://github.com/InsightFrom/tarae.git" }
$Ref = if ($env:TARAE_REF) { $env:TARAE_REF } else { "main" }
$InstallDir = if ($env:TARAE_INSTALL_DIR) { $env:TARAE_INSTALL_DIR } else { Join-Path $HOME ".tarae\src\tarae" }
$BinDir = if ($env:TARAE_BIN_DIR) { $env:TARAE_BIN_DIR } else { Join-Path $HOME ".tarae\bin" }

function Require-Command($Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name"
  }
}

Require-Command git
Require-Command node
Require-Command npm
Require-Command cargo

Write-Host "Installing Tarae from $RepoUrl ($Ref)"
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path $InstallDir) | Out-Null

if (Test-Path (Join-Path $InstallDir ".git")) {
  git -C $InstallDir fetch --tags origin
  git -C $InstallDir checkout $Ref
  try {
    git -C $InstallDir pull --ff-only origin $Ref
  } catch {
    Write-Host "Skipping pull for detached or tag ref: $Ref"
  }
} else {
  git clone --branch $Ref $RepoUrl $InstallDir
}

Write-Host "Building topa"
cargo build --release --manifest-path (Join-Path $InstallDir "packages\watcher\Cargo.toml")

Write-Host "Installing CLI dependencies"
npm install --omit=dev --prefix (Join-Path $InstallDir "packages\cli")

Write-Host "Preparing local binaries"
$env:TARAE_DEV = "true"
node (Join-Path $InstallDir "packages\cli\bin\index.js") init

$Shim = Join-Path $BinDir "tarae.ps1"
@"
& node "$InstallDir\packages\cli\bin\index.js" @args
"@ | Set-Content -Encoding UTF8 $Shim

$CmdShim = Join-Path $BinDir "tarae.cmd"
@"
@echo off
node "$InstallDir\packages\cli\bin\index.js" %*
"@ | Set-Content -Encoding ASCII $CmdShim

Write-Host ""
Write-Host "Tarae installed."
Write-Host "Add this directory to PATH if needed:"
Write-Host "  $BinDir"
Write-Host ""
Write-Host "Next:"
Write-Host "  & `"$BinDir\tarae.ps1`" install --agent codex --project-root (Get-Location)"
