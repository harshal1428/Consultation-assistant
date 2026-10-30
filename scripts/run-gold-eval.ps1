# Regenerate the real parse and live-decision fixtures, then write the ignored
# gold report. Does not update the committed baseline.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root ".venv\Scripts\python.exe"

Push-Location (Join-Path $root "backend")
try {
  & $python -m app.eval.cli --export
} finally {
  Pop-Location
}

Push-Location (Join-Path $root "frontend")
try {
  npx vitest run tests/goldLiveDecisions.test.ts
} finally {
  Pop-Location
}

Push-Location (Join-Path $root "backend")
try {
  & $python -m app.eval.cli --check
  & $python -m app.eval.cli --write-report
  & $python tests\gold\validate_gold.py
} finally {
  Pop-Location
}
