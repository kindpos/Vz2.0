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

# 6. Upload installer to R2 via S3-compatible API
#    (wrangler's R2 PUT trips a Node 24 / undici fault on large binaries)
Write-Host "Uploading installer to R2..." -ForegroundColor Cyan
$installerPath = "dist\installer\$OutputName.exe"
$env:AWS_ACCESS_KEY_ID = $env:KINDPOS_R2_ACCESS_KEY_ID
$env:AWS_SECRET_ACCESS_KEY = $env:KINDPOS_R2_SECRET_ACCESS_KEY
aws s3 cp "$installerPath" `
  "s3://kindpos-installers/$OutputName.exe" `
  --endpoint-url https://e676e34c04ae97499018af663941cca0.r2.cloudflarestorage.com `
  --region auto `
  --expected-size (Get-Item $installerPath).Length

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
