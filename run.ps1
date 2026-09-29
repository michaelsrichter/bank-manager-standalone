$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$venvPython = Join-Path $root ".venv\Scripts\python.exe"
$app = Join-Path $root "app\chat_app.py"

if (-not (Test-Path $venvPython)) {
    throw "The local environment is missing. Run .\install.ps1 first."
}

& $venvPython -m streamlit run $app
