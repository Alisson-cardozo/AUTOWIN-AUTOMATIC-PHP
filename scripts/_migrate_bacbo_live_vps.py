import os
import paramiko

PASS = os.environ.get("VPS_PASS", "")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(
    "187.77.33.118",
    username="root",
    password=PASS,
    timeout=30,
    allow_agent=False,
    look_for_keys=False,
)

# Use PHP PDO with individual CREATE TABLE statements
php = r'''
<?php
require "/var/www/autowin/vendor/autoload.php";
App\Bootstrap::init();
$pdo = App\Database::pdo();
$tables = [
"bacbo_live_results" => "CREATE TABLE IF NOT EXISTS bacbo_live_results (
  id INT NOT NULL AUTO_INCREMENT,
  externalId VARCHAR(50) NOT NULL,
  winner VARCHAR(20) NOT NULL,
  playerTotal INT NOT NULL,
  bankerTotal INT NOT NULL,
  player1 INT NOT NULL DEFAULT 0,
  player2 INT NOT NULL DEFAULT 0,
  banker1 INT NOT NULL DEFAULT 0,
  banker2 INT NOT NULL DEFAULT 0,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY bacbo_live_results_externalId_unique (externalId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
"bacbo_live_strategies" => "CREATE TABLE IF NOT EXISTS bacbo_live_strategies (
  id INT NOT NULL AUTO_INCREMENT,
  sequence VARCHAR(500) NOT NULL,
  color VARCHAR(20) NOT NULL,
  strategyType VARCHAR(30) NOT NULL DEFAULT 'SEQUÊNCIA',
  ownerId INT NOT NULL,
  PRIMARY KEY (id),
  KEY bacbo_live_strategies_ownerId_idx (ownerId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
"bacbo_live_settings" => "CREATE TABLE IF NOT EXISTS bacbo_live_settings (
  id INT NOT NULL AUTO_INCREMENT,
  strategyType VARCHAR(50) NOT NULL DEFAULT 'SEQUÊNCIA',
  enterType VARCHAR(20) NOT NULL DEFAULT 'VALOR',
  enterPercent DOUBLE NOT NULL DEFAULT 0,
  enterValue DOUBLE NOT NULL DEFAULT 0,
  stopType VARCHAR(20) NOT NULL DEFAULT 'VALOR',
  stopGain VARCHAR(20) NOT NULL DEFAULT '0',
  stopLoss VARCHAR(20) NOT NULL DEFAULT '0',
  protectionHand VARCHAR(5) NOT NULL DEFAULT 'NÃO',
  protectionValue DOUBLE NOT NULL DEFAULT 0,
  whiteMultiplier DOUBLE NOT NULL DEFAULT 2,
  martingale INT NOT NULL DEFAULT 1,
  martingaleMultiplier DOUBLE NOT NULL DEFAULT 2,
  whiteEntryGaleEnabled TINYINT(1) NOT NULL DEFAULT 0,
  whiteEntryGale INT NOT NULL DEFAULT 1,
  whiteEntryGaleMultiplier DOUBLE NOT NULL DEFAULT 2,
  whiteEntryType VARCHAR(20) NOT NULL DEFAULT 'VALOR',
  whiteEntryValue DOUBLE NOT NULL DEFAULT 0,
  whiteEntryPercent DOUBLE NOT NULL DEFAULT 0,
  quantityCycles INT NOT NULL DEFAULT 1,
  skipFirstEntry TINYINT(1) NOT NULL DEFAULT 0,
  skipEntryAfterLoss TINYINT(1) NOT NULL DEFAULT 0,
  ownerId INT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY bacbo_live_settings_ownerId_unique (ownerId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
"bacbo_live_variables" => "CREATE TABLE IF NOT EXISTS bacbo_live_variables (
  id INT NOT NULL AUTO_INCREMENT,
  countLoss INT NOT NULL DEFAULT 0,
  countWin INT NOT NULL DEFAULT 0,
  countMartingale INT NOT NULL DEFAULT 0,
  profit DOUBLE NOT NULL DEFAULT 0,
  balance DOUBLE NOT NULL DEFAULT 0,
  firstBalance DOUBLE NOT NULL DEFAULT 0,
  firstBalanceDate DATETIME NULL,
  monthStartBalance DOUBLE NOT NULL DEFAULT 0,
  monthStartDate DATETIME NULL,
  monthCountWin INT NOT NULL DEFAULT 0,
  monthCountLoss INT NOT NULL DEFAULT 0,
  isGale TINYINT(1) NOT NULL DEFAULT 0,
  lastCycleWasLoss TINYINT(1) NOT NULL DEFAULT 0,
  ownerId INT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY bacbo_live_variables_ownerId_unique (ownerId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
"bacbo_live_bot_entries" => "CREATE TABLE IF NOT EXISTS bacbo_live_bot_entries (
  id INT NOT NULL AUTO_INCREMENT,
  type VARCHAR(20) NOT NULL,
  signalColor VARCHAR(20) NULL,
  resultColor VARCHAR(20) NULL,
  pattern VARCHAR(200) NULL,
  betAmount DOUBLE NULL,
  profit DOUBLE NULL,
  galeLevel INT NULL,
  ownerId INT NOT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY bacbo_live_bot_entries_ownerId_idx (ownerId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
];
foreach ($tables as $name => $sql) {
  try {
    $pdo->exec($sql);
    echo "OK $name\n";
  } catch (Throwable $e) {
    echo "ERR $name: ".$e->getMessage()."\n";
  }
}
$chk = $pdo->query("SHOW TABLES LIKE 'bacbo_live_%'")->fetchAll(PDO::FETCH_COLUMN);
echo "TABLES: ".implode(",", $chk)."\n";
'''

sftp = c.open_sftp()
with sftp.file("/tmp/migrate_bacbo_live.php", "w") as f:
    f.write(php)
sftp.close()

_i, o, e = c.exec_command("php /tmp/migrate_bacbo_live.php", timeout=60)
print(o.read().decode())
print(e.read().decode())
c.close()
