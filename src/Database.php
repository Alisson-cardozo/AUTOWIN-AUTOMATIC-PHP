<?php

declare(strict_types=1);

namespace App;

use PDO;
use PDOStatement;

final class Database
{
    private static ?PDO $pdo = null;

    public static function pdo(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }

        $host = env('DB_HOST', '127.0.0.1');
        $port = env('DB_PORT', '3306');
        $db = env('DB_DATABASE', 'autowin');
        $user = env('DB_USERNAME', 'root');
        $pass = (string) env('DB_PASSWORD', '');

        $dsn = "mysql:host={$host};port={$port};dbname={$db};charset=utf8mb4";
        self::$pdo = new PDO($dsn, $user, $pass, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);

        return self::$pdo;
    }

    public static function query(string $sql, array $params = []): PDOStatement
    {
        $stmt = self::pdo()->prepare($sql);
        $stmt->execute($params);
        return $stmt;
    }

    public static function fetch(string $sql, array $params = []): ?array
    {
        $row = self::query($sql, $params)->fetch();
        return $row === false ? null : $row;
    }

    public static function fetchAll(string $sql, array $params = []): array
    {
        return self::query($sql, $params)->fetchAll();
    }

    public static function insert(string $table, array $data): int
    {
        $cols = array_keys($data);
        $placeholders = array_map(fn ($c) => ':' . $c, $cols);
        $sql = sprintf(
            'INSERT INTO `%s` (`%s`) VALUES (%s)',
            $table,
            implode('`,`', $cols),
            implode(',', $placeholders)
        );
        self::query($sql, $data);
        return (int) self::pdo()->lastInsertId();
    }

    public static function update(string $table, array $data, string $where, array $whereParams = []): int
    {
        if (!$data) {
            return 0;
        }
        $sets = [];
        foreach (array_keys($data) as $col) {
            $sets[] = "`$col` = :$col";
        }
        $sql = sprintf('UPDATE `%s` SET %s WHERE %s', $table, implode(', ', $sets), $where);
        // whereParams não podem colidir com colunas do SET
        $params = $data;
        foreach ($whereParams as $k => $v) {
            $params[$k] = $v;
        }
        $stmt = self::query($sql, $params);
        return $stmt->rowCount();
    }

    public static function delete(string $table, string $where, array $params = []): int
    {
        $stmt = self::query("DELETE FROM `$table` WHERE $where", $params);
        return $stmt->rowCount();
    }

    public static function upsert(string $table, array $data, array $uniqueKeys, array $updateCols = []): int
    {
        $existing = null;
        $whereParts = [];
        $whereParams = [];
        foreach ($uniqueKeys as $key) {
            $whereParts[] = "`$key` = :uq_$key";
            $whereParams["uq_$key"] = $data[$key];
        }
        $existing = self::fetch(
            "SELECT * FROM `$table` WHERE " . implode(' AND ', $whereParts) . ' LIMIT 1',
            $whereParams
        );

        if ($existing) {
            $upd = $updateCols ? array_intersect_key($data, array_flip($updateCols)) : $data;
            foreach ($uniqueKeys as $key) {
                unset($upd[$key]);
            }
            if ($upd) {
                self::update($table, $upd, implode(' AND ', array_map(fn ($k) => "`$k` = :w_$k", $uniqueKeys)), array_combine(
                    array_map(fn ($k) => "w_$k", $uniqueKeys),
                    array_map(fn ($k) => $data[$k], $uniqueKeys)
                ));
            }
            return (int) $existing['id'];
        }

        return self::insert($table, $data);
    }
}
