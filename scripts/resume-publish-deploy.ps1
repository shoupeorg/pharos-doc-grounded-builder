$ErrorActionPreference = 'Stop'
$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project
$env:XDG_CONFIG_HOME = Join-Path (Split-Path $Project -Parent) 'cloudflare-xdg'
$env:npm_config_cache = Join-Path (Split-Path $Project -Parent) 'npm-cache-audit'
$Name = 'pharos-doc-grounded-builder'
$Demo = 'https://pharos-doc-grounded-builder.shoupeorg.workers.dev'
$Repo = 'https://github.com/shoupeorg/pharos-doc-grounded-builder.git'

try {
  Write-Host 'Preparing reproducible dependencies and bundle...'
  npm.cmd ci --ignore-scripts
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
  npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }

  $Config = Join-Path $Project 'wrangler.jsonc'
  $ConfigText = Get-Content -Raw $Config
  if ($ConfigText.Contains('REPLACE_AFTER_CREATION')) {
    Write-Host 'Creating the isolated D1 database...'
    $Created = (& npx.cmd wrangler d1 create $Name 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) { throw $Created.Trim() }
    $Match = [regex]::Match($Created, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
    if (-not $Match.Success) { throw 'D1 creation succeeded but no database ID was returned.' }
    $ConfigText.Replace('REPLACE_AFTER_CREATION', $Match.Value) | Set-Content -NoNewline $Config
  }

  Write-Host 'Applying the D1 schema and deploying the application...'
  npx.cmd wrangler d1 migrations apply $Name --remote
  if ($LASTEXITCODE -ne 0) { throw 'Remote D1 migration failed.' }
  npx.cmd wrangler deploy --no-bundle
  if ($LASTEXITCODE -ne 0) { throw 'Cloudflare deployment failed.' }

  Write-Host 'Capturing the three live reads and the unsupported refusal...'
  $env:DEMO_URL = $Demo
  node scripts/capture-live-evidence.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Live evidence capture failed.' }

  Write-Host 'Publishing the newly captured evidence assets...'
  npx.cmd wrangler deploy --no-bundle
  if ($LASTEXITCODE -ne 0) { throw 'Evidence asset deployment failed.' }

  git add wrangler.jsonc evidence public/evidence scripts/resume-publish-deploy.ps1 STATUS.md
  git diff --cached --quiet
  if ($LASTEXITCODE -ne 0) {
    git commit -m 'Publish verified live Doc-Grounded Builder evidence'
    if ($LASTEXITCODE -ne 0) { throw 'Evidence commit failed.' }
  }

  $RepoApi = 'https://api.github.com/repos/shoupeorg/pharos-doc-grounded-builder'
  try { Invoke-RestMethod -Uri $RepoApi -Headers @{ Accept = 'application/vnd.github+json' } | Out-Null }
  catch {
    if ($_.Exception.Response.StatusCode.value__ -ne 404) { throw }
    Write-Host 'Creating the authorized public GitHub repository with Git Credential Manager...'
    $Filled = "protocol=https`nhost=github.com`n`n" | git credential fill
    if ($LASTEXITCODE -ne 0) { throw 'Git Credential Manager could not provide the existing GitHub credential.' }
    $Credential = @{}
    foreach ($Line in $Filled) { if ($Line -match '^([^=]+)=(.*)$') { $Credential[$Matches[1]] = $Matches[2] } }
    if (-not $Credential.password) { throw 'Git Credential Manager returned no GitHub token.' }
    $Headers = @{ Authorization = "Bearer $($Credential.password)"; Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28' }
    try { Invoke-RestMethod -Method Post -Uri 'https://api.github.com/orgs/shoupeorg/repos' -Headers $Headers -ContentType 'application/json' -Body (@{ name = $Name; private = $false; description = 'Docs MCP grounded plans, read-only Pharos Chain MCP execution, and on-chain verification.' } | ConvertTo-Json) | Out-Null }
    finally { $Credential.Clear(); $Filled = $null; $Headers = $null }
  }

  $Origin = git remote get-url origin 2>$null
  if ($LASTEXITCODE -ne 0) { git remote add origin $Repo }
  elseif ($Origin -ne $Repo) { throw "Unexpected origin: $Origin" }
  git push -u origin main
  if ($LASTEXITCODE -ne 0) { throw 'GitHub push failed.' }
  git fetch origin main
  if ($LASTEXITCODE -ne 0) { throw 'Remote verification fetch failed.' }
  $Local = git rev-parse HEAD
  $Remote = git rev-parse origin/main
  if ($Local -ne $Remote) { throw "Remote mismatch: local $Local remote $Remote" }
  $Worker = git ls-tree -r origin/main -- src/worker.js
  if (-not $Worker) { throw 'src/worker.js is absent from remote main.' }

  $Ui = Invoke-WebRequest -Uri $Demo -UseBasicParsing
  $Logo = Invoke-WebRequest -Uri "$Demo/pharos-logo.png" -UseBasicParsing
  $Manifest = Invoke-RestMethod -Uri "$Demo/evidence/manifest.json"
  if ($Ui.StatusCode -ne 200 -or $Logo.StatusCode -ne 200 -or $Logo.Headers.'Content-Type' -notlike 'image/png*') { throw 'Public UI or logo verification failed.' }
  if ($Manifest.runs.Count -ne 4) { throw 'Public evidence manifest does not contain four demonstrations.' }

  Write-Host ''
  Write-Host 'PUBLICATION VERIFIED' -ForegroundColor Green
  Write-Host "Demo:       $Demo"
  Write-Host "Repository: https://github.com/shoupeorg/pharos-doc-grounded-builder"
  Write-Host "Commit:     $Local"
  Write-Host "Evidence:   $Demo/evidence/manifest.json"
}
catch {
  Write-Error $_.Exception.Message
  exit 1
}
