param(
    [Parameter(Mandatory=$true)]  [string]$CustomerKey,
    [Parameter(Mandatory=$true)]  [string]$StoreName,
    [Parameter(Mandatory=$false)] [string]$OutputName = "KINDpos-Setup"
)

$env:PATH += ";C:\Program Files\Amazon\AWSCLIV2"

Write-Host "Building KINDpos installer for: $StoreName" -ForegroundColor Green
Write-Host "Key: $CustomerKey"

# 1. Insert activation key into activate.py
(Get-Content activate.py) `
    -replace 'EMBEDDED_KEY = ".*"', "EMBEDDED_KEY = `"$CustomerKey`"" |
    Set-Content activate.py

# Inject key into kindpos_setup.py
(Get-Content install\kindpos_setup.py) `
    -replace 'EMBEDDED_KEY = ".*"', "EMBEDDED_KEY = `"$CustomerKey`"" |
    Set-Content install\kindpos_setup.py

# 2. Build activate.exe from venv
Write-Host "Building activate.exe..." -ForegroundColor Cyan
& ".venv\Scripts\pyinstaller.exe" `
    --onefile --name activate `
    --hidden-import=requests `
    activate.py

(Get-Content activate.py) `
    -replace 'EMBEDDED_KEY = ".*"', 'EMBEDDED_KEY = "KIND-XXXX-XXXX-XXXX"' |
    Set-Content activate.py

Write-Host "Building KINDpos-Setup.exe..." -ForegroundColor Cyan
& ".venv\Scripts\pyinstaller.exe" `
    --onefile --noconsole `
    --name KINDpos-Setup `
    install\kindpos_setup.py

(Get-Content install\kindpos_setup.py) `
    -replace 'EMBEDDED_KEY = ".*"', 'EMBEDDED_KEY = "KIND-XXXX-XXXX-XXXX"' |
    Set-Content install\kindpos_setup.py

# 3. Build kindpos-backend.exe from spec
Write-Host "Building kindpos-backend.exe..." -ForegroundColor Cyan
# Force clean rebuild — delete cached artifacts
if (Test-Path "build\kindpos-backend") {
    Remove-Item -Recurse -Force "build\kindpos-backend"
}
if (Test-Path "dist\kindpos-backend.exe") {
    Remove-Item -Force "dist\kindpos-backend.exe"
}
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
try {
  $response = Invoke-RestMethod `
    -Uri "https://kindpos-license.myers-alexanderk.workers.dev/admin/create" `
    -Method POST `
    -Body $body `
    -ContentType "application/json" `
    -Headers @{ "X-Admin-Secret" = $env:KINDPOS_ADMIN_SECRET }
  Write-Host "Key registered." -ForegroundColor Green
  $response
} catch {
  Write-Host "Warning: D1 registration failed (key may already exist): $_" -ForegroundColor Yellow
}

# 6. Upload installer to R2 via S3-compatible API
#    (wrangler's R2 PUT trips a Node 24 / undici fault on large binaries)
Write-Host "Uploading installer to R2..." -ForegroundColor Cyan
$installerPath = "dist\installer\$OutputName.exe"
. "$PSScriptRoot\build.secrets.ps1"
$env:AWS_ACCESS_KEY_ID = $env:KINDPOS_R2_ACCESS_KEY_ID
$env:AWS_SECRET_ACCESS_KEY = $env:KINDPOS_R2_SECRET_ACCESS_KEY
.venv\Scripts\python upload_to_r2.py `
    "dist\KINDpos-Setup.exe" "$OutputName.exe"

# 7. Print download link
$downloadLink = "https://pub-959f0ae9542041fdbe3eaec229df9914.r2.dev/$OutputName.exe"
Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "READY TO SEND" -ForegroundColor Green
Write-Host "Store:    $StoreName" -ForegroundColor White
Write-Host "Key:      $CustomerKey" -ForegroundColor White
Write-Host "Download: $downloadLink" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Green

Write-Host "Key registered. Send $OutputName.exe to $StoreName" -ForegroundColor Green
