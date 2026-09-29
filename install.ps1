$ErrorActionPreference = "Stop"

$python = Get-Command python -ErrorAction Stop
$root = $PSScriptRoot
$venvPython = Join-Path $root ".venv\Scripts\python.exe"
$wheels = @(Get-ChildItem `
    -Path (Join-Path $root "wheels") `
    -Filter "agent_control_specification-0.4.0b0-*-win_amd64.whl")

if ($wheels.Count -ne 1) {
    throw "Place one ACS 0.4.0b0 Windows x64 wheel in .\wheels before installing."
}
$wheel = $wheels[0]

& $python.Source -c @"
import platform
import struct
import sys

if sys.version_info < (3, 11):
    raise SystemExit("Python 3.11 or newer is required.")
if platform.system() != "Windows" or struct.calcsize("P") * 8 != 64:
    raise SystemExit("This bundle requires 64-bit Windows Python.")
"@

if (-not (Test-Path $venvPython)) {
    & $python.Source -m venv (Join-Path $root ".venv")
}

& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install $wheel.FullName
& $venvPython -m pip install -r (Join-Path $root "requirements.txt")

Write-Output ""
Write-Output "Installation complete."
Write-Output "Run .\run.ps1 to start the Bank Manager Policy Chat."
