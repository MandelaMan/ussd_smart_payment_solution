# Restore ussd_smart_payment_solution data from XAMPP MariaDB files into Docker MySQL.
# Usage: pwsh scripts/restore-from-xampp.ps1
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$XamppData = "C:/xampp/mysql/data"
$RecoveryName = "xampp-mysql-recovery"
$DumpFile = Join-Path $Root ".tmp-xampp-restore.sql"
$DbName = "ussd_smart_payment_solution"
$TargetPort = if ($env:MYSQL_PORT) { $env:MYSQL_PORT } else { "3307" }
$TargetPassword = if ($env:MYSQL_PASSWORD) { $env:MYSQL_PASSWORD } else { "root" }

if (-not (Test-Path $XamppData)) {
  throw "XAMPP data folder not found: $XamppData"
}

Write-Host "Starting temporary XAMPP recovery MariaDB on port 3308..."
docker rm -f $RecoveryName 2>$null | Out-Null
docker run -d --name $RecoveryName -p 3308:3306 -v "${XamppData}:/var/lib/mysql" mariadb:10.4 --skip-grant-tables | Out-Null

Write-Host "Waiting for recovery database..."
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 2
  $null = docker exec $RecoveryName mysql -u root -e "SELECT 1" 2>$null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
}
if (-not $ready) {
  docker logs $RecoveryName | Select-Object -Last 20
  throw "Recovery MariaDB did not become ready."
}

Write-Host "Dumping $DbName from XAMPP data..."
docker exec $RecoveryName mysqldump -u root --single-transaction --routines --triggers $DbName | Set-Content -Path $DumpFile -Encoding utf8

$lineCount = (Get-Content $DumpFile | Measure-Object -Line).Lines
if ($lineCount -lt 10) {
  throw "Dump looks empty ($lineCount lines). Aborting import."
}

Write-Host "Importing into Docker MySQL on port $TargetPort..."
Get-Content $DumpFile | docker exec -i ussd_smart_payment_solution-mysql-1 mysql -uroot -p$TargetPassword $DbName

Write-Host "Verifying row counts..."
docker exec ussd_smart_payment_solution-mysql-1 mysql -uroot -p$TargetPassword -e "
  SELECT 'customers' AS tbl, COUNT(*) AS c FROM $DbName.customers
  UNION ALL SELECT 'payment_transactions', COUNT(*) FROM $DbName.payment_transactions
  UNION ALL SELECT 'products', COUNT(*) FROM $DbName.products
  UNION ALL SELECT 'agencies', COUNT(*) FROM $DbName.agencies;
"

Write-Host "Cleaning up recovery container..."
docker rm -f $RecoveryName | Out-Null
Remove-Item $DumpFile -ErrorAction SilentlyContinue
Write-Host "Restore complete. Restart yarn dev if the dashboard still looks empty."
