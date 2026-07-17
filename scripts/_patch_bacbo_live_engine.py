# -*- coding: utf-8 -*-
from pathlib import Path

p = Path("src/Bot/Games/BacBoEngine.php")
t = p.read_text(encoding="utf-8")

old = """    private int $userId;
    private bool $forceReset;
    private bool $isDemo;
    private ?BlazeAPI $api;
    private bool $running = false;"""

new = """    private int $userId;
    private bool $forceReset;
    private bool $isDemo;
    private ?BlazeAPI $api;
    /** @var 'bacbo'|'bacbo_live' sala Blaze (dados e mesa separados) */
    private string $room;
    private string $gameTypeCode;
    private string $roomLabel;
    private bool $running = false;"""

if old not in t:
    raise SystemExit("fields block not found")
t = t.replace(old, new, 1)

old = """    public function __construct(
        int $userId,
        bool $forceReset = false,
        ?BlazeAPI $api = null,
        bool $isDemo = true
    ) {
        $this->userId = $userId;
        $this->forceReset = $forceReset;
        $this->api = $api;
        $this->isDemo = $isDemo || $api === null || $api->getToken() === null || $api->getToken() === '';
    }

    public function start(): void"""

new = """    public function __construct(
        int $userId,
        bool $forceReset = false,
        ?BlazeAPI $api = null,
        bool $isDemo = true,
        string $room = 'bacbo'
    ) {
        $this->userId = $userId;
        $this->forceReset = $forceReset;
        $this->api = $api;
        $this->isDemo = $isDemo || $api === null || $api->getToken() === null || $api->getToken() === '';
        $this->room = ($room === 'bacbo_live' || $room === 'bacbo-live' || $room === 'BACBO_LIVE')
            ? 'bacbo_live'
            : 'bacbo';
        $this->gameTypeCode = $this->room === 'bacbo_live' ? 'BACBO_LIVE' : 'BACBO';
        $this->roomLabel = $this->room === 'bacbo_live' ? 'Bac Bo Ao Vivo' : 'Bac Bo';
    }

    /** Tabela isolada por sala. */
    private function tbl(string $suffix): string
    {
        return $this->room === 'bacbo_live' ? 'bacbo_live_' . $suffix : 'bacbo_' . $suffix;
    }

    private function resultsGameKey(): string
    {
        return $this->room === 'bacbo_live' ? 'bacbo-live' : 'bacbo';
    }

    private function blazePlaySlug(): string
    {
        return $this->room === 'bacbo_live' ? 'bac-bo-ao-vivo' : 'bac-bo';
    }

    public function start(): void"""

if old not in t:
    raise SystemExit("constructor block not found")
t = t.replace(old, new, 1)

# Start messages
t = t.replace(
    "$this->msg('🟢 Bot Bac Bo iniciado (DEMO) — entradas simuladas · ' . $stype);",
    "$this->msg('🟢 Bot ' . $this->roomLabel . ' iniciado (DEMO) — entradas simuladas · ' . $stype);",
)
t = t.replace(
    "$this->msg('🟢 Bot Bac Bo iniciado (REAL) — sessão Evolution isolada · ' . $stype);",
    "$this->msg('🟢 Bot ' . $this->roomLabel . ' iniciado (REAL) — sessão Evolution isolada · ' . $stype);",
)
t = t.replace(
    "$this->msg('⚠️ COPIAR SALA DE SINAL: Telegram não configurado. Conecte o grupo em Estratégias (aba Bac Bo).');",
    "$this->msg('⚠️ COPIAR SALA DE SINAL: Telegram não configurado. Conecte o grupo em Estratégias (aba ' . $this->roomLabel . ').');",
)
t = t.replace(
    "$this->msg('⚠️ Launch Bac Bo: ' . $e->getMessage() . ' — modo REAL mantido.');",
    "$this->msg('⚠️ Launch ' . $this->roomLabel . ': ' . $e->getMessage() . ' — modo REAL mantido.');",
)

# Table name replacements in SQL strings
replacements = [
    ("FROM bacbo_settings", "FROM ' . $this->tbl('settings') . '"),
    ("FROM bacbo_strategies", "FROM ' . $this->tbl('strategies') . '"),
    ("FROM bacbo_results", "FROM ' . $this->tbl('results') . '"),
    ("FROM bacbo_variables", "FROM ' . $this->tbl('variables') . '"),
    ("'bacbo_variables'", "$this->tbl('variables')"),
    ("'bacbo_bot_entries'", "$this->tbl('bot_entries')"),
    ("'bacbo_settings'", "$this->tbl('settings')"),
    ("'bacbo_strategies'", "$this->tbl('strategies')"),
    ("'bacbo_results'", "$this->tbl('results')"),
]

# Careful: only replace string literals used as table names
# Database::update('bacbo_variables' -> Database::update($this->tbl('variables')
t = t.replace("Database::update('bacbo_variables'", "Database::update($this->tbl('variables')")
t = t.replace("Database::insert('bacbo_variables'", "Database::insert($this->tbl('variables')")
t = t.replace("Database::insert('bacbo_bot_entries'", "Database::insert($this->tbl('bot_entries')")
t = t.replace("Database::fetch('SELECT * FROM bacbo_settings WHERE ownerId = ?'", "Database::fetch('SELECT * FROM ' . $this->tbl('settings') . ' WHERE ownerId = ?'")
t = t.replace("Database::fetchAll('SELECT * FROM bacbo_strategies WHERE ownerId = ?'", "Database::fetchAll('SELECT * FROM ' . $this->tbl('strategies') . ' WHERE ownerId = ?'")
t = t.replace("Database::fetchAll('SELECT * FROM bacbo_results ORDER BY id DESC LIMIT 14')", "Database::fetchAll('SELECT * FROM ' . $this->tbl('results') . ' ORDER BY id DESC LIMIT 14')")
t = t.replace("Database::fetch('SELECT * FROM bacbo_variables WHERE ownerId = ?'", "Database::fetch('SELECT * FROM ' . $this->tbl('variables') . ' WHERE ownerId = ?'")

# BacBoSource calls
t = t.replace("BacBoSource::fetchSource()", "BacBoSource::fetchSource($this->resultsGameKey())")
t = t.replace("BacBoSource::persistNew($results)", "BacBoSource::persistNew($results, $this->resultsGameKey())")

# playBacBo
t = t.replace("$this->api->playBacBo('BRL')", "$this->api->playBacBo('BRL', $this->blazePlaySlug())")

# BotEntryLogger game type
t = t.replace(
    """        \\App\\Bot\\BotEntryLogger::log(
            $this->userId,
            $type,
            'BACBO',
            'BLAZE',""",
    """        \\App\\Bot\\BotEntryLogger::log(
            $this->userId,
            $type,
            $this->gameTypeCode,
            'BLAZE',""",
)

# PatternAccuracy - pass results table if supported later; keep default for now
# log_msg bacbo: tags
t = t.replace("[bacbo:{$this->userId}]", "[{$this->gameTypeCode}:{$this->userId}]")
t = t.replace("[bacbo-bet:{$this->userId}]", "[{$this->gameTypeCode}-bet:{$this->userId}]")

p.write_text(t, encoding="utf-8")
print("patched", p)
# sanity
for s in ["tbl(", "bacbo_live", "resultsGameKey", "blazePlaySlug"]:
    print(s, t.count(s))
print("remaining bacbo_settings string", t.count("bacbo_settings"))
print("remaining Database bacbo_variables", t.count("'bacbo_variables'"))
