# Local CI (no GitHub workflow by design): typecheck, then the test suite.
# Prints a pass/fail table with durations and exits non-zero when any step fails.
#   powershell -File scripts\ci.ps1            per-commit run (PROP_RUNS default 80)
#   powershell -File scripts\ci.ps1 -Nightly   PROP_RUNS=1000, no practical per-test timeout
param([switch]$Nightly)

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$testArgs = @('test')
$oldRuns = $env:PROP_RUNS
if ($Nightly) {
    $env:PROP_RUNS = '1000'
    $testArgs = @('test', '--', '--testTimeout=3600000')
}

$steps = @(
    @{ Name = 'typecheck'; Args = @('run', 'typecheck') },
    @{ Name = $(if ($Nightly) { 'test (PROP_RUNS=1000)' } else { 'test' }); Args = $testArgs }
)

$results = @()
try {
    foreach ($s in $steps) {
        Write-Host ""
        Write-Host "== $($s.Name)"
        $sw = [Diagnostics.Stopwatch]::StartNew()
        & npm.cmd @($s.Args)
        $code = $LASTEXITCODE
        $sw.Stop()
        $results += [pscustomobject]@{
            Step    = $s.Name
            Result  = $(if ($code -eq 0) { 'PASS' } else { "FAIL ($code)" })
            Seconds = [math]::Round($sw.Elapsed.TotalSeconds, 1)
        }
    }
}
finally {
    $env:PROP_RUNS = $oldRuns
}

Write-Host ""
$results | Format-Table -AutoSize | Out-String | Write-Host
$failed = @($results | Where-Object { $_.Result -ne 'PASS' }).Count
if ($failed -gt 0) {
    Write-Host "CI FAILED: $failed step(s)" -ForegroundColor Red
    exit 1
}
Write-Host "CI PASSED" -ForegroundColor Green
exit 0
