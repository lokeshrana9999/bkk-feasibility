# Deploys the web app and the MCP server to Vercel production, then smoke-tests /mcp.
#   powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1            # checks, deploy, smoke test
#   powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -SkipTests # skip the MCP test suite
# Windows PowerShell 5.1. Vercel builds remotely (project setting Node 26.x), so the local Node
# version does not matter. Needs the Vercel CLI, logged in (vercel whoami).

param(
  [switch]$SkipTests,
  # run the checks only, no deploy
  [switch]$DryRun,
  [string]$ProdUrl = 'https://bkk-feasibility.vercel.app'
)

# native tools (git, npm, vercel) write progress to stderr: judge them by exit code, not by stderr
$ErrorActionPreference = 'Continue'
Set-Location (Join-Path $PSScriptRoot '..')

function Step($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "STOP: $msg" -ForegroundColor Red; exit 1 }

Step 'git: committed and pushed'
$dirty = git status --porcelain --untracked-files=no
if ($dirty) { Fail "uncommitted changes to tracked files:`n$dirty" }
git fetch -q origin
$head = git rev-parse HEAD
$remote = git rev-parse origin/main
if ($head -ne $remote) { Fail "HEAD ($($head.Substring(0,7))) is not origin/main ($($remote.Substring(0,7))); push or pull first" }
Write-Host "deploying $($head.Substring(0,7)): $(git log -1 --format=%s)"

Step 'MCP bundle up to date'
node scripts/build-mcp.mjs --check
if ($LASTEXITCODE -ne 0) { Fail 'api/mcp.js is stale: run npm run build:mcp, commit, push' }

if (-not $SkipTests) {
  Step 'MCP tests'
  npm run --silent test:mcp
  if ($LASTEXITCODE -ne 0) { Fail 'MCP tests failed' }
}

if ($DryRun) { Write-Host "`nDry run: checks passed, nothing deployed." -ForegroundColor Green; exit 0 }

Step 'vercel deploy --prod'
vercel deploy --prod --yes
if ($LASTEXITCODE -ne 0) { Fail 'vercel deploy failed (see above)' }

Step "smoke test $ProdUrl/mcp"
node scripts/mcp-smoke.mjs "$ProdUrl/mcp"
if ($LASTEXITCODE -ne 0) { Fail 'deployed, but the smoke test failed (see above)' }

Write-Host "`nDone: $ProdUrl (app) and $ProdUrl/mcp (MCP)" -ForegroundColor Green
