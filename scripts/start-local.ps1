param([switch]$DatabaseOnly)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)
$root = (Get-Location).Path
$runtime = Join-Path $root ".runtime"
New-Item -ItemType Directory -Force $runtime | Out-Null
$settingsPath = Join-Path $runtime "local.json"
$pgData = Join-Path $runtime "postgres"
$port = 55432
$bin = $env:PG_BIN
if (!$bin) {
    $init = Get-Command initdb -ErrorAction SilentlyContinue
    if ($init) { $bin = Split-Path $init.Source }
    else { $bin = (Get-ChildItem "C:/Program Files/PostgreSQL/*/bin" -Directory | Sort-Object FullName -Descending | Select-Object -First 1).FullName }
}
if (!$bin) { throw "PostgreSQL bin not found. Set PG_BIN." }
function New-Password { return [Guid]::NewGuid().ToString("N") + [Guid]::NewGuid().ToString("N").Substring(0,8) }
if (!(Test-Path $settingsPath)) {
    $dbPassword = New-Password
    $settings = [ordered]@{
        database_url="postgresql://pax:${dbPassword}@127.0.0.1:${port}/phananh"
        admin_email="quantri@phananh.local"; admin_password="Demo1234"
        staff_email="canbo@phananh.local"; staff_password="Demo1234"
        citizen_email="nguoidan@phananh.local"; citizen_password="Demo1234"
    }
    $settings | ConvertTo-Json | Set-Content -Encoding utf8 $settingsPath
}
$settings = Get-Content $settingsPath -Raw | ConvertFrom-Json
$dbPassword = ([Uri]$settings.database_url).UserInfo.Split(':')[1]
if (!(Test-Path (Join-Path $pgData "PG_VERSION"))) {
    $pwFile = Join-Path $runtime "pg-init-pw"
    try {
        [IO.File]::WriteAllText($pwFile, $dbPassword)
        & "$bin/initdb.exe" -D $pgData -U pax "--pwfile=$pwFile" -A scram-sha-256 -E UTF8 --locale=C
        if ($LASTEXITCODE -ne 0) { throw "initdb failed" }
    } finally {
        if (Test-Path $pwFile) { Remove-Item -LiteralPath $pwFile }
    }
}
& "$bin/pg_ctl.exe" -D $pgData status *> $null
if ($LASTEXITCODE -ne 0) {
    & "$bin/pg_ctl.exe" -D $pgData -l (Join-Path $runtime "postgres.log") -o "-h 127.0.0.1 -p $port" -w start
    if ($LASTEXITCODE -ne 0) { throw "Cannot start project PostgreSQL. See .runtime/postgres.log." }
}
$oldPassword = $env:PGPASSWORD
try {
    $env:PGPASSWORD = $dbPassword
    $found = & "$bin/psql.exe" -At -h 127.0.0.1 -p $port -U pax -d postgres -c "SELECT 1 FROM pg_database WHERE datname='phananh'"
    if ($LASTEXITCODE -ne 0) { throw "Cannot connect to PostgreSQL" }
    if ($found -ne '1') {
        & "$bin/createdb.exe" -h 127.0.0.1 -p $port -U pax phananh
        if ($LASTEXITCODE -ne 0) { throw "Cannot create database" }
    }
} finally { $env:PGPASSWORD = $oldPassword }
if ($DatabaseOnly) { return }
$env:DATABASE_URL = $settings.database_url
if (!$env:DEPLOY_API_KEY -and $settings.deploy_api_key) { $env:DEPLOY_API_KEY = $settings.deploy_api_key }
if (!$env:GOONG_API_KEY -and $settings.goong_api_key) { $env:GOONG_API_KEY = $settings.goong_api_key }
if (!$env:GOONG_MAP_KEY -and $settings.goong_map_key) { $env:GOONG_MAP_KEY = $settings.goong_map_key }
if (!(Test-Path ".venv/Scripts/python.exe")) { python -m venv .venv }
$python = Join-Path $root ".venv/Scripts/python.exe"
foreach ($argsList in @(
    ,@("-m","pip","install","-r","backend/requirements.txt")
    ,@("-m","backend.prepare_models")
    ,@("-m","backend.seed")
)) {
    & $python @argsList
    if ($LASTEXITCODE -ne 0) { throw "Python setup failed" }
}
if (!(Test-Path "node_modules/vite")) { npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw "npm ci failed" } }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw "React build failed" }
Write-Host "Website: http://127.0.0.1:8010 - local accounts: .runtime/local.json"
& $python -m uvicorn backend.main:app --host 127.0.0.1 --port 8010

