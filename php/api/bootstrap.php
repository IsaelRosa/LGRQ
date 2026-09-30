<?php
/**
 * LGRP · base do backend em PHP
 *
 * Configuração, conexão MySQL e a camada de consultas que espelha a
 * interface usada pelo código JavaScript (from/select/eq/or/order/limit).
 */

declare(strict_types=1);

define('LGRP_ROOT', dirname(__DIR__));

/* ------------------------------------------------------------------ */
/* Configuração                                                        */
/* ------------------------------------------------------------------ */

/**
 * Lê o .env sem depender do parser do PHP (que ignora linhas em branco e
 * comentários). Também aceita variáveis já presentes no ambiente, para o
 * caso de o hPanel as exponha por outro meio.
 */
function lgrp_carregar_env(string $arquivo): void
{
    if (!is_readable($arquivo)) {
        return;
    }
    foreach (file($arquivo, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $linha) {
        $linha = trim($linha);
        if ($linha === '' || $linha[0] === '#') {
            continue;
        }
        $pos = strpos($linha, '=');
        if ($pos === false) {
            continue;
        }
        $chave = trim(substr($linha, 0, $pos));
        $valor = trim(substr($linha, $pos + 1));
        // Remove aspas envolventes, se houver.
        if (strlen($valor) >= 2
            && ($valor[0] === '"' || $valor[0] === "'")
            && $valor[strlen($valor) - 1] === $valor[0]) {
            $valor = substr($valor, 1, -1);
        }
        if ($chave !== '' && getenv($chave) === false) {
            putenv("$chave=$valor");
            $_ENV[$chave] = $valor;
        }
    }
}

lgrp_carregar_env(LGRP_ROOT . '/.env');

function env_chave(string $nome, ?string $padrao = null): ?string
{
    $v = getenv($nome);
    return ($v === false || $v === '') ? $padrao : $v;
}

function config(string $nome, ?string $padrao = null): ?string
{
    return env_chave($nome, $padrao);
}

/* ------------------------------------------------------------------ */
/* Conexão                                                             */
/* ------------------------------------------------------------------ */

function lgrp_pdo(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $host = env_chave('MYSQL_HOST', 'localhost');
    $porta = (int) (env_chave('MYSQL_PORT', '3306'));
    $banco = env_chave('MYSQL_DATABASE', '');
    $usuario = env_chave('MYSQL_USER', '');
    $senha = env_chave('MYSQL_PASSWORD', '');

    if ($banco === '' || $usuario === '') {
        throw new RuntimeException(
            'Banco não configurado. Defina MYSQL_DATABASE e MYSQL_USER no .env.'
        );
    }

    $dsn = "mysql:host={$host};port={$porta};dbname={$banco};charset=utf8mb4";

    try {
        $pdo = new PDO($dsn, $usuario, $senha, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            // Prepared statements nativos: evita concatenar valores no SQL.
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_STRINGIFY_FETCHES => false,
        ]);
    } catch (PDOException $e) {
        // Não vaza host/usuário/senha na resposta ao navegador.
        error_log('LGRP: falha ao conectar no MySQL: ' . $e->getMessage());
        throw new RuntimeException('Não foi possível falar com o banco de dados.', 503);
    }

    $pdo->exec("SET time_zone = '+00:00'");
    return $pdo;
}

/* ------------------------------------------------------------------ */
/* Normalização de tipos (MySQL -> JSON)                               */
/* ------------------------------------------------------------------ */

/**
 * Colunas de data por tabela, para converter o formato do MySQL
 * ('2026-03-05 14:30:00.000') no ISO que o frontend consome.
 */
const LGRP_COLUNAS_DATA = [
    'usuarios'           => ['criado_em', 'atualizado_em'],
    'pedidos_coleta'     => ['data_solicitacao', 'data_prevista', 'data_coleta', 'criado_em', 'atualizado_em'],
    'coletas'            => ['data_coleta', 'criado_em'],
    'tratamentos'        => ['data_inicio', 'data_conclusao', 'criado_em', 'atualizado_em'],
    'solventes'          => ['data_recebimento', 'data_validade', 'criado_em', 'atualizado_em'],
    'reagentes'          => ['data_aquisicao', 'data_validade', 'criado_em', 'atualizado_em'],
    'vidrarias'          => ['data_registro', 'data_descontaminacao', 'criado_em', 'atualizado_em'],
    'indicadores_mensais' => ['criado_em', 'atualizado_em'],
    'notificacoes'       => ['criado_em'],
    'historico'          => ['criado_em'],
];

/** Colunas TINYINT(1), que o frontend espera como booleano. */
const LGRP_COLUNAS_BOOL = [
    'usuarios'     => ['ativo'],
    'notificacoes' => ['lida'],
    'solventes'    => ['inflamavel'],
];

/**
 * Colunas JSON. O PDO devolve JSON como string; o frontend precisa do
 * objeto, senao a rastreabilidade exibiria o texto do JSON cru.
 */
const LGRP_COLUNAS_JSON = [
    'historico' => ['dados_anteriores', 'dados_novos', 'mudancas'],
];

function lgrp_hidratar(array $linha, string $tabela): array
{
    foreach (LGRP_COLUNAS_DATA[$tabela] ?? [] as $col) {
        if (!isset($linha[$col]) || $linha[$col] === null) {
            continue;
        }
        $v = (string) $linha[$col];
        if (preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/', $v)) {
            $linha[$col] = str_replace(' ', 'T', $v) . 'Z';
        } elseif (preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) {
            $linha[$col] = $v . 'T00:00:00.000Z';
        }
    }
    foreach (LGRP_COLUNAS_BOOL[$tabela] ?? [] as $col) {
        if (isset($linha[$col]) && $linha[$col] !== null) {
            $linha[$col] = (bool) (int) $linha[$col];
        }
    }
    foreach (LGRP_COLUNAS_JSON[$tabela] ?? [] as $col) {
        if (isset($linha[$col]) && is_string($linha[$col])) {
            $decodificado = json_decode($linha[$col], true);
            $linha[$col] = json_last_error() === JSON_ERROR_NONE ? $decodificado : null;
        }
    }
    // PDO com emulate=false devolve DECIMAL como string mesmo com
    // STRINGIFY_FETCHES false; converter é o que faz os gráficos funcionarem.
    foreach ($linha as $col => $val) {
        if (is_string($val) && preg_match('/^-?\d+\.\d+$/', $val)) {
            $linha[$col] = (float) $val;
        }
    }
    return $linha;
}

/* ------------------------------------------------------------------ */
/* Utilidades SQL                                                      */
/* ------------------------------------------------------------------ */

const LGRP_IDENTIFICADOR = '/^[A-Za-z_][A-Za-z0-9_]*$/';

function lgrp_identificador(string $nome): string
{
    if (!preg_match(LGRP_IDENTIFICADOR, $nome)) {
        throw new InvalidArgumentException("Identificador inválido: {$nome}");
    }
    return "`{$nome}`";
}

/** Escapa os curingas do LIKE para que o termo seja literal. */
function lgrp_escapar_like(string $termo): string
{
    return preg_replace('/([\\\\%_])/', '\\\\$1', $termo);
}

/** Converte ISO em literal DATETIME; devolve o valor intacto se não for data. */
function lgrp_data_sql($valor)
{
    if ($valor === null || $valor === '') {
        return null;
    }
    if (!is_string($valor)) {
        return $valor;
    }
    $s = trim($valor);
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $s)) {
        return $s . ' 00:00:00.000';
    }
    if (!preg_match('/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/', $s)) {
        return $valor;
    }
    $temOffset = (bool) preg_match('/(Z|[+-]\d{2}:?\d{2})$/', $s);
    $normalizado = str_replace(' ', 'T', $s);
    $ts = strtotime($temOffset ? $normalizado : $normalizado . 'Z');
    if ($ts === false) {
        return $valor;
    }
    return gmdate('Y-m-d H:i:s', $ts);
}

/** Serializa valor para gravação, respeitando booleanos e objetos. */
function lgrp_serializar($valor)
{
    if ($valor === null) {
        return null;
    }
    if (is_bool($valor)) {
        return $valor ? 1 : 0;
    }
    if (is_array($valor)) {
        return json_encode($valor, JSON_UNESCAPED_UNICODE);
    }
    return lgrp_data_sql($valor);
}

/* ------------------------------------------------------------------ */
/* Construtor de consultas                                             */
/* ------------------------------------------------------------------ */

class LgrpConsulta
{
    private string $tabela;
    private string $acao = 'select';
    private string $selecionar = '*';
    private array $filtros = [];
    private array $params = [];
    private ?string $ordenar = null;
    private ?int $limite = null;
    private bool $querLinhas = false;
    private bool $unica = false;
    private mixed $payload = null;

    public function __construct(string $tabela)
    {
        if (!preg_match(LGRP_IDENTIFICADOR, $tabela)) {
            throw new InvalidArgumentException("Tabela inválida: {$tabela}");
        }
        $this->tabela = $tabela;
    }

    public function select(string $campos = '*'): self
    {
        $this->selecionar = ($campos === '' || $campos === '*')
            ? '*'
            : implode(', ', array_map('lgrp_identificador', array_map('trim', explode(',', $campos))));
        $this->querLinhas = true;
        return $this;
    }

    public function insert($payload): self
    {
        $this->acao = 'insert';
        $this->payload = is_array($payload) && array_is_list($payload) ? $payload : [$payload];
        return $this;
    }

    public function update(array $payload): self
    {
        $this->acao = 'update';
        $this->payload = $payload;
        return $this;
    }

    public function delete(): self
    {
        $this->acao = 'delete';
        return $this;
    }

    private function filtrar(string $campo, string $operador, $valor): self
    {
        $this->filtros[] = lgrp_identificador($campo) . " {$operador} ?";
        $this->params[] = lgrp_serializar_param($valor);
        return $this;
    }

    public function eq(string $c, $v): self  { return $this->filtrar($c, '=', $v); }
    public function neq(string $c, $v): self { return $this->filtrar($c, '<>', $v); }
    public function gt(string $c, $v): self  { return $this->filtrar($c, '>', $v); }
    public function gte(string $c, $v): self { return $this->filtrar($c, '>=', $v); }
    public function lt(string $c, $v): self  { return $this->filtrar($c, '<', $v); }
    public function lte(string $c, $v): self { return $this->filtrar($c, '<=', $v); }
    public function like(string $c, $v): self  { return $this->filtrar($c, 'LIKE', $v); }
    public function ilike(string $c, $v): self { return $this->filtrar($c, 'LIKE', $v); }

    /** Interpreta `campo.operador.valor`, como no código JavaScript. */
    public function or(string $expressao): self
    {
        $partes = [];
        foreach (explode(',', $expressao) as $trecho) {
            if (!preg_match('/^([A-Za-z_][A-Za-z0-9_]*)\.(eq|neq|like|ilike|gt|gte|lt|lte)\.(.*)$/s', trim($trecho), $m)) {
                continue;
            }
            [, $campo, $op, $bruto] = $m;
            $valor = str_starts_with($bruto, '.') ? substr($bruto, 1) : $bruto;
            $sqlOp = ['eq' => '=', 'neq' => '<>', 'like' => 'LIKE', 'ilike' => 'LIKE',
                      'gt' => '>', 'gte' => '>=', 'lt' => '<', 'lte' => '<='][$op];
            $like = str_contains($valor, '%') ? $valor : '%' . lgrp_escapar_like($valor) . '%';
            $this->params[] = in_array($op, ['like', 'ilike'], true) ? $like : lgrp_serializar_param($valor);
            $partes[] = lgrp_identificador($campo) . " {$sqlOp} ?";
        }
        if ($partes) {
            $this->filtros[] = '(' . implode(' OR ', $partes) . ')';
        }
        return $this;
    }

    public function in(string $campo, array $valores): self
    {
        if (!$valores) {
            $this->filtros[] = '1 = 0';
            return $this;
        }
        $this->filtros[] = lgrp_identificador($campo) . ' IN (' . implode(',', array_fill(0, count($valores), '?')) . ')';
        foreach ($valores as $v) {
            $this->params[] = lgrp_serializar_param($v);
        }
        return $this;
    }

    public function order(string $campo, array $opcoes = []): self
    {
        $dir = (($opcoes['ascending'] ?? null) === false) ? 'DESC' : 'ASC';
        $this->ordenar = lgrp_identificador($campo) . " {$dir}";
        return $this;
    }

    public function limit(?int $n): self
    {
        $this->limite = $n !== null && $n >= 0 ? $n : null;
        return $this;
    }

    public function single(): self
    {
        $this->unica = true;
        $this->limite = 1;
        return $this;
    }

    private function where(): string
    {
        return $this->filtros ? ' WHERE ' . implode(' AND ', $this->filtros) : '';
    }

    public function execute(): array
    {
        $pdo = lgrp_pdo();

        if ($this->acao === 'select') {
            $sql = "SELECT {$this->selecionar} FROM " . lgrp_identificador($this->tabela) . $this->where();
            if ($this->ordenar !== null) {
                $sql .= " ORDER BY {$this->ordenar}";
            }
            if ($this->limite !== null) {
                $sql .= " LIMIT {$this->limite}";
            }
            $st = $pdo->prepare($sql);
            $st->execute($this->params);
            $linhas = array_map(
                fn($l) => lgrp_hidratar($l, $this->tabela),
                $st->fetchAll(PDO::FETCH_ASSOC)
            );
            return ['data' => $this->unica ? ($linhas[0] ?? null) : $linhas, 'error' => null];
        }

        if ($this->acao === 'insert') {
            if (!$this->payload) {
                return ['data' => [], 'error' => null, 'count' => 0];
            }
            $campos = array_keys($this->payload[0]);
            $sqlCampos = implode(', ', array_map('lgrp_identificador', $campos));
            $marcadores = [];
            $valores = [];
            foreach ($this->payload as $linha) {
                $marcadores[] = '(' . implode(',', array_fill(0, count($campos), '?')) . ')';
                foreach ($campos as $c) {
                    $valores[] = lgrp_serializar($linha[$c] ?? null);
                }
            }
            $sql = 'INSERT INTO ' . lgrp_identificador($this->tabela)
                 . " ({$sqlCampos}) VALUES " . implode(',', $marcadores);
            $st = $pdo->prepare($sql);
            $st->execute($valores);

            if (!$this->querLinhas) {
                return ['data' => null, 'error' => null, 'count' => $st->rowCount()];
            }
            $ultimoId = (int) $pdo->lastInsertId();
            $ids = range($ultimoId, $ultimoId + $st->rowCount() - 1);
            $marca = implode(',', array_fill(0, count($ids), '?'));
            $st = $pdo->prepare('SELECT ' . $this->selecionar . ' FROM '
                . lgrp_identificador($this->tabela) . " WHERE `id` IN ({$marca}) ORDER BY `id`");
            $st->execute($ids);
            $linhas = array_map(fn($l) => lgrp_hidratar($l, $this->tabela), $st->fetchAll(PDO::FETCH_ASSOC));
            return [
                'data' => $this->unica ? ($linhas[0] ?? null) : $linhas,
                'error' => null,
                'count' => count($ids),
            ];
        }

        if ($this->acao === 'update') {
            $campos = array_keys($this->payload);
            if (!$campos) {
                return ['data' => null, 'error' => null, 'count' => 0];
            }

            // Os ids são capturados ANTES do UPDATE: repetir o SELECT com os
            // filtros originais devolveria zero linhas quando o próprio
            // UPDATE altera a coluna filtrada.
            $alvos = null;
            if ($this->querLinhas) {
                $st = $pdo->prepare('SELECT `id` FROM ' . lgrp_identificador($this->tabela) . $this->where());
                $st->execute($this->params);
                $alvos = array_map('intval', array_column($st->fetchAll(PDO::FETCH_ASSOC), 'id'));
                if (!$alvos) {
                    return ['data' => $this->unica ? null : [], 'error' => null, 'count' => 0];
                }
            }

            $sets = [];
            $valores = [];
            foreach ($campos as $c) {
                $sets[] = lgrp_identificador($c) . ' = ?';
                $valores[] = lgrp_serializar($this->payload[$c]);
            }
            $sql = 'UPDATE ' . lgrp_identificador($this->tabela) . ' SET ' . implode(', ', $sets) . $this->where();
            $st = $pdo->prepare($sql);
            $st->execute(array_merge($valores, $this->params));

            if (!$this->querLinhas) {
                return ['data' => null, 'error' => null, 'count' => $st->rowCount()];
            }
            $marca = implode(',', array_fill(0, count($alvos), '?'));
            $st = $pdo->prepare('SELECT ' . $this->selecionar . ' FROM '
                . lgrp_identificador($this->tabela) . " WHERE `id` IN ({$marca})");
            $st->execute($alvos);
            $linhas = array_map(fn($l) => lgrp_hidratar($l, $this->tabela), $st->fetchAll(PDO::FETCH_ASSOC));
            return [
                'data' => $this->unica ? ($linhas[0] ?? null) : $linhas,
                'error' => null,
                'count' => $st->rowCount(),
            ];
        }

        $sql = 'DELETE FROM ' . lgrp_identificador($this->tabela) . $this->where();
        $st = $pdo->prepare($sql);
        $st->execute($this->params);
        return ['data' => null, 'error' => null, 'count' => $st->rowCount()];
    }
}

function lgrp_serializar_param($valor)
{
    if (is_bool($valor)) {
        return $valor ? 1 : 0;
    }
    if (is_array($valor)) {
        return json_encode($valor, JSON_UNESCAPED_UNICODE);
    }
    return lgrp_data_sql($valor);
}

function db(string $tabela): LgrpConsulta
{
    return new LgrpConsulta($tabela);
}
