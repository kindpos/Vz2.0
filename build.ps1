param(
    [Parameter(Mandatory=$true)]  [string]$CustomerKey,
    [Parameter(Mandatory=$true)]  [string]$StoreName,
    [Parameter(Mandatory=$false)] [string]$OutputName = "KINDpos-Setup"
)

Write-Host "Building KINDpos installer for: $StoreName" -ForegroundColor Green
Write-Host "Key: $CustomerKey"

# 1. Insert activation key into activate.py
(Get-Content activate.py) `
    -replace 'EMBEDDED_KEY = ".*"', "EMBEDDED_KEY = `"$CustomerKey`"" |
    Set-Content activate.py

# 2. Build activate.exe from venv
Write-Host "Building activate.exe..." -ForegroundColor Cyan
& ".venv\Scripts\pyinstaller.exe" `
    --onefile --name activate `
    --hidden-import=requests `
    activate.py

# 3. Build kindpos-backend.exe from spec
Write-Host "Building kindpos-backend.exe..." -ForegroundColor Cyan
& ".venv\Scripts\pyinstaller.exe" kindpos-backend.spec

# 4. Insert key into Inno Setup script + compile
Write-Host "Compiling installer..." -ForegroundColor Cyan
(Get-Content kindpos.iss) `
    -replace 'KIND-XXXX-XXXX-XXXX', $CustomerKey `
    -replace 'STORE_NAME_PLACEHOLDER', $StoreName |
    Set-Content kindpos_build.iss

& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" `
    kindpos_build.iss `
    /O"dist\installer" `
    /F"$OutputName"

Write-Host "Done: dist\installer\$OutputName.exe" -ForegroundColor Green

# 5. Register key in D1 via Cloudflare Worker
Write-Host "Registering key in D1..." -ForegroundColor Cyan
$body = @{ key=$CustomerKey; store=$StoreName } | ConvertTo-Json
Invoke-RestMethod `
    -Uri "https://kindpos-license.myers-alexanderk.workers.dev/admin/create" `
    -Method POST `
    -Body $body `
    -ContentType "application/json" `
    -Headers @{ "X-Admin-Secret" = $env:KINDPOS_ADMIN_SECRET }

Write-Host "Key registered. Send $OutputName.exe to $StoreName" -ForegroundColor Green
