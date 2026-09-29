$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$evalVenv = Join-Path $root ".eval-venv"
$venvPython = Join-Path $evalVenv "Scripts\python.exe"

if (-not (Test-Path $venvPython)) {
    $python = Get-Command python -ErrorAction Stop
    & $python.Source -m venv $evalVenv
}

& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -r (Join-Path $root "requirements-evaluation.txt")

Write-Output ""
Write-Output "ASSERT installation complete in .eval-venv."
Write-Output "Run .\run-evaluation.ps1 to compare baseline and governed modes."
