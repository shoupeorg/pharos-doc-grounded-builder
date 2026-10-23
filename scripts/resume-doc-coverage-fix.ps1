$ErrorActionPreference = 'Stop'
$Project = Split-Path -Parent $PSScriptRoot
$SafeProject = $Project.Replace('\', '/')
$Demo = 'https://pharos-doc-grounded-builder.shoupeorg.workers.dev'
$ExpectedEngine = 'doc-grounded-builder/1.1.0-doc-coverage'

Set-Location -LiteralPath $Project
git config --global --add safe.directory $SafeProject
if ($LASTEXITCODE -ne 0) { throw 'Could not configure safe.directory.' }

$env:XDG_CONFIG_HOME = Join-Path (Split-Path $Project -Parent) 'cloudflare-xdg'
$env:DEMO_URL = $Demo

$DeployedEngine = $null
try { $DeployedEngine = (Invoke-RestMethod -Uri "$Demo/api/meta" -TimeoutSec 20).engineVersion } catch {}
if ($DeployedEngine -ne $ExpectedEngine) {
  Write-Host 'Deploying the already tested documentation-coverage correction once...'
  npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
  npx.cmd wrangler deploy --no-bundle
  if ($LASTEXITCODE -ne 0) { throw 'Cloudflare deployment failed.' }
}

$Verified = $false
for ($Attempt = 1; $Attempt -le 3; $Attempt++) {
  try {
    $Meta = Invoke-RestMethod -Uri "$Demo/api/meta" -TimeoutSec 20
    if ($Meta.engineVersion -eq $ExpectedEngine) { $Verified = $true; break }
  } catch {}
  if ($Attempt -lt 3) { Start-Sleep -Seconds (2 * $Attempt) }
}
if (-not $Verified) { throw "Deployed engine did not become $ExpectedEngine after three bounded checks." }

$ManifestPath = Join-Path $Project 'evidence\manifest-v1.1.json'
if (-not (Test-Path -LiteralPath $ManifestPath)) {
  Write-Host 'Capturing only the corrected affected workflows...'
  node scripts/capture-corrected-evidence.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Corrected evidence capture failed.' }
}

$Manifest = Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json
$Expected = @{
  'native' = 'VERIFIED'
  'contract-code' = 'VERIFIED'
  'transaction' = 'VERIFIED'
  'erc20-refusal' = 'DOCS_NOT_COVERED'
}
foreach ($Run in $Manifest.runs) {
  if ($Expected[$Run.name] -ne $Run.status) { throw "Unexpected evidence status for $($Run.name): $($Run.status)" }
}
$Refusal = $Manifest.runs | Where-Object name -eq 'erc20-refusal'
if (-not $Refusal -or $Refusal.toolCalls -ne 0 -or -not $Refusal.refused) { throw 'ERC-20 refusal did not remain non-executing.' }

git add evidence public/evidence scripts/resume-doc-coverage-fix.ps1
if ($LASTEXITCODE -ne 0) { throw 'Git staging failed.' }
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  git commit -m 'Record corrected documentation-grounded evidence'
  if ($LASTEXITCODE -ne 0) { throw 'Evidence commit failed.' }
}

git push origin main
if ($LASTEXITCODE -ne 0) { throw 'Git push failed.' }
git fetch origin main
if ($LASTEXITCODE -ne 0) { throw 'Git fetch failed.' }
$Local = (git rev-parse HEAD).Trim()
$Remote = (git rev-parse origin/main).Trim()
if (-not $Local -or $Local -ne $Remote) { throw "Remote mismatch: local=$Local remote=$Remote" }

Write-Host ''
Write-Host 'DOC COVERAGE CORRECTION VERIFIED' -ForegroundColor Green
Write-Host "Engine:     $ExpectedEngine"
Write-Host "Commit:     $Remote"
Write-Host "Demo:       $Demo"
Write-Host "Repository: https://github.com/shoupeorg/pharos-doc-grounded-builder"
Write-Host "Evidence:   evidence/manifest-v1.1.json"
