<?php
/**
 * =====================================================================
 *  LGRP · Instalador automático do backend
 * =====================================================================
 *
 *  COMO USAR
 *    1. Envie ESTE arquivo para a raiz do seu site (junto do index.html)
 *    2. Abra no navegador:  https://SEU-DOMINIO/instalar.php
 *    3. Preencha os dados do MySQL e clique em Instalar
 *    4. Pronto. Este arquivo se apaga sozinho no final.
 *
 *  Apague o arquivo manualmente se o servidor não permitir.
 *
 *  Documentação: php/README.md
 */

declare(strict_types=1);

$RAIZ = __DIR__;
// Sem atribuir: o arquivo de dados define $ARQUIVOS no escopo deste
// arquivo, e atribuir aqui o valor do require a apagaria.
require __DIR__ . '/instalador.dados.php';

/* ------------------------------------------------------------------ */
/* Interface                                                           */
/* ------------------------------------------------------------------ */

function esc($t): string
{
    return htmlspecialchars((string) $t, ENT_QUOTES, 'UTF-8');
}

function pagina(string $titulo, string $corpo, bool $sucesso = null): void
{
    $cor = $sucesso === null ? '#0d5c3f' : ($sucesso ? '#0d5c3f' : '#b3261e');
    echo <<<HTML
<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LGRP · Instalador</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#f2f5f3;color:#1c2b26;
       font:15px/1.6 "Inter",system-ui,-apple-system,"Segoe UI",sans-serif;
       display:flex;justify-content:center;padding:40px 20px}
  .card{background:#fff;max-width:660px;width:100%;border-radius:14px;
        box-shadow:0 10px 40px rgba(8,32,26,.10);overflow:hidden}
  .top{background:linear-gradient(140deg,#08201a,#0d3d2b);color:#fff;padding:28px 30px}
  .top h1{margin:0;font-size:21px;letter-spacing:-.01em}
  .top p{margin:6px 0 0;color:#9dc4b4;font-size:13.5px}
  .body{padding:28px 30px}
  h2{font-size:14px;text-transform:uppercase;letter-spacing:.09em;
     color:#6b8079;margin:26px 0 12px;font-weight:600}
  label{display:block;margin:14px 0 5px;font-size:13px;font-weight:600}
  input{width:100%;padding:11px 13px;border:1px solid #d6e2dd;border-radius:9px;
        font:inherit;font-size:14px;background:#fbfdfc}
  input:focus{outline:none;border-color:#0d5c3f;box-shadow:0 0 0 3px rgba(13,92,63,.12)}
  button{margin-top:24px;width:100%;padding:14px;border:0;border-radius:10px;
         background:#0d5c3f;color:#fff;font:inherit;font-weight:600;font-size:15px;cursor:pointer}
  button:hover{background:#0a4a31}
  .msg{padding:13px 15px;border-radius:9px;margin:16px 0;font-size:13.5px;line-height:1.55}
  .erro{background:#fdecea;color:#8c1d18;border-left:3px solid #b3261e}
  .ok{background:#e7f5ee;color:#0b3d27;border-left:3px solid #0d5c3f}
  .info{background:#eef4f1;color:#37544a;border-left:3px solid #6b8079}
  .passos{counter-reset:p;list-style:none;padding:0;margin:14px 0 0}
  .passos li{counter-increment:p;position:relative;padding:5px 0 5px 30px;font-size:13.5px;color:#48605a}
  .passos li:before{content:counter(p);position:absolute;left:0;top:6px;width:20px;height:20px;
     background:#0d5c3f;color:#fff;border-radius:50%;font-size:11px;font-weight:700;
     display:flex;align-items:center;justify-content:center}
  code{background:#eef4f1;padding:1px 5px;border-radius:4px;font-size:12.5px;color:#0d5c3f}
  a.btn{display:block;text-align:center;margin-top:12px;padding:12px;background:#0d5c3f;
       color:#fff;border-radius:9px;text-decoration:none;font-weight:600;font-size:14px}
</style></head><body>
<div class="card">
  <div class="top">
    <h1>LGRP · Instalador do sistema</h1>
    <p>Laboratório de Gestão de Resíduos Perigosos</p>
  </div>
  <div class="body">$corpo</div>
</div>
</body></html>
HTML;
    exit;
}

/* ------------------------------------------------------------------ */
/* Instalação                                                          */
/* ------------------------------------------------------------------ */

function instalar(array $dados): array
{
    // Variáveis definidas no topo do arquivo: a função precisa do escopo global.
    global $RAIZ, $ARQUIVOS;

    $resultado = [];
    $falha = null;

    // 1. Chave secreta para assinar as sessões.
    $segredo = bin2hex(random_bytes(48));

    // 2. Arquivos do backend. A chave "_htaccess" carrega as regras em
    // base64 e nao e um arquivo: precisa ser pulada, senao o instalador
    // deixa um "_htaccess" solto na raiz do site.
    @mkdir($RAIZ . '/api', 0755, true);
    foreach ($ARQUIVOS as $destino => $base64) {
        if ($destino === '_htaccess') {
            continue;
        }
        $conteudo = base64_decode((string) $base64, true);
        if ($conteudo === false) {
            throw new RuntimeException("Falha ao decodificar {$destino}.");
        }
        if (file_put_contents($RAIZ . '/' . $destino, $conteudo) === false) {
            throw new RuntimeException("Não consegui escrever {$destino}. Verifique as permissões da pasta.");
        }
        $resultado[] = $destino;
    }

    // 3. .htaccess na raiz (reenvolve o que já existir).
    $regras = (string) base64_decode((string) ($ARQUIVOS['_htaccess'] ?? ''), true);
    $htaccessAtual = is_readable($RAIZ . '/.htaccess') ? (string) file_get_contents($RAIZ . '/.htaccess') : '';
    if (!str_contains($htaccessAtual, 'api/index.php')) {
        $novo = rtrim($htaccessAtual) . "\n\n# --- LGRP: reencaminha /api/* para o backend PHP ---\n"
            . $regras . "\n";
        if (file_put_contents($RAIZ . '/.htaccess', $novo) === false) {
            throw new RuntimeException('Não consegui escrever o .htaccess.');
        }
        $resultado[] = '.htaccess';
    } else {
        $resultado[] = '.htaccess (já existia)';
    }

    // 4. .env — nunca sobrescreve um existente, para não derrubar as sessões.
    $envPath = $RAIZ . '/.env';
    if (is_readable($envPath) && str_contains((string) file_get_contents($envPath), 'MYSQL_DATABASE')) {
        $resultado[] = '.env (mantido)';
    } else {
        $env = "MYSQL_HOST=" . addslashes($dados['host']) . "\n"
             . "MYSQL_PORT=" . (int) ($dados['porta'] ?: 3306) . "\n"
             . "MYSQL_DATABASE=" . addslashes($dados['banco']) . "\n"
             . "MYSQL_USER=" . addslashes($dados['usuario']) . "\n"
             . "MYSQL_PASSWORD=" . addslashes($dados['senha']) . "\n"
             . "MYSQL_CONNECTION_LIMIT=5\n"
             . "MYSQL_SSL=false\n\n"
             . "JWT_SECRET=" . $segredo . "\n"
             . "JWT_EXPIRES_IN=12h\n"
             . "APP_ENV=production\n";
        if (file_put_contents($envPath, $env) === false) {
            throw new RuntimeException('Não consegui escrever o .env.');
        }
        @chmod($envPath, 0640);
        $resultado[] = '.env';
    }

    // 5. Testar a conexão e criar o schema se faltar.
    $pdo = new PDO(
        "mysql:host={$dados['host']};port={$dados['porta']};dbname={$dados['banco']};charset=utf8mb4",
        $dados['usuario'],
        $dados['senha'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
    $versao = $pdo->query('SELECT VERSION()')->fetchColumn();
    $resultado[] = "MySQL conectado ({$versao})";

    $temUsuario = (int) $pdo->query(
        "SELECT COUNT(*) FROM information_schema.tables
         WHERE table_schema = " . $pdo->quote($dados['banco']) . " AND table_name = 'usuarios'"
    )->fetchColumn();

    if (!$temUsuario) {
        $sql = (string) file_get_contents($RAIZ . '/lgrp_mysql.sql');
        if ($sql === '') {
            throw new RuntimeException(
                'As tabelas não existem e o arquivo lgrp_mysql.sql não está no site. '
                . 'Importe o schema pelo phpMyAdmin e rode o instalador de novo.'
            );
        }
        foreach (array_filter(array_map('trim', explode(";\n", $sql))) as $comando) {
            $comando = preg_replace('/^--.*$/m', '', $comando);
            if (trim((string) $comando) !== '') {
                $pdo->exec($comando);
            }
        }
        $resultado[] = 'Tabelas criadas a partir do lgrp_mysql.sql';
    } else {
        $temHash = (int) $pdo->query(
            "SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = " . $pdo->quote($dados['banco'])
            . " AND table_name = 'usuarios' AND column_name = 'senha_hash'"
        )->fetchColumn();
        $resultado[] = $temHash ? 'Tabelas já existiam' : 'AVISO: falta a coluna senha_hash';
        if (!$temHash) {
            $pdo->exec("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS senha_hash VARCHAR(255) NULL");
            $resultado[] = 'Coluna senha_hash adicionada';
        }
    }

    return $resultado;
}

/* ------------------------------------------------------------------ */
/* Execução                                                            */
/* ------------------------------------------------------------------ */

$acao = $_POST['acao'] ?? '';

if ($acao !== 'instalar') {
    // Diagnóstico do ambiente antes de pedir qualquer coisa.
    $temPdo = extension_loaded('pdo_mysql') || extension_loaded('mysqli');
    $temRestrito = !@is_writable($RAIZ);

    $diagnostico = '';
    if (version_compare(PHP_VERSION, '8.0', '<')) {
        $diagnostico .= '<div class="msg erro">Este instalador precisa de PHP 8.0 ou superior. '
            . 'O servidor está na versão ' . esc(PHP_VERSION) . '.</div>';
    } elseif (!$temPdo) {
        $diagnostico .= '<div class="msg erro">A extensão pdo_mysql ou mysqli não está habilitada neste PHP.</div>';
    } elseif ($temRestrito) {
        $diagnostico .= '<div class="msg erro">A pasta do site não permite escrita. '
            . 'Envie o arquivo com permissão 644.</div>';
    } else {
        $diagnostico = '<div class="msg ok">Ambiente pronto: PHP ' . esc(PHP_VERSION) . '.</div>';
    }

    $corpo = $diagnostico . <<<HTML
      <p style="margin:0 0 6px;font-size:14px">
        Este instalador escreve o backend do LGRP no seu site: os arquivos da API,
        o <code>.htaccess</code> e o <code>.env</code> com a chave de sessão.
      </p>
      <ol class="passos">
        <li>Envie este arquivo para a <strong>raiz</strong> do site, junto do <code>index.html</code></li>
        <li>Abra <code>https://SEU-DOMINIO/instalar.php</code> no navegador</li>
        <li>Preencha os dados do MySQL e clique em <strong>Instalar</strong></li>
        <li>Este arquivo se apaga sozinho</li>
      </ol>

      <form method="post" style="margin-top:8px">
        <input type="hidden" name="acao" value="instalar">

        <h2>Banco de dados</h2>
        <label for="host">Host</label>
        <input id="host" name="host" value="localhost">

        <label for="porta">Porta</label>
        <input id="porta" name="porta" value="3306">

        <label for="banco">Nome do banco</label>
        <input id="banco" name="banco" placeholder="ex.: u315093330_LGRP" required>

        <label for="usuario">Usuário</label>
        <input id="usuario" name="usuario" placeholder="ex.: u315093330_LGRP" required>

        <label for="senha">Senha</label>
        <input id="senha" name="senha" type="text" placeholder="a senha criada no hPanel" required>

        <button type="submit">Instalar agora</button>
      </form>

      <p style="margin:18px 0 0;font-size:12.5px;color:#6b8079">
        Os dados ficam no arquivo <code>.env</code>, que não é acessível pelo navegador.
        Este instalador também se apaga: ele não guarda nada.
      </p>
HTML;
    pagina('Instalador', $corpo);
}

$dados = [
    'host' => trim($_POST['host'] ?? 'localhost'),
    'porta' => (int) (trim($_POST['porta'] ?? '3306')),
    'banco' => trim($_POST['banco'] ?? ''),
    'usuario' => trim($_POST['usuario'] ?? ''),
    'senha' => (string) ($_POST['senha'] ?? ''),
];

if ($dados['banco'] === '' || $dados['usuario'] === '' || $dados['senha'] === '') {
    pagina('Instalador', '<div class="msg erro">Preencha banco, usuário e senha.</div>');
}

try {
    $feito = instalar($dados);
} catch (PDOException $e) {
    $codigo = $e->getCode();
    $ajuda = match ($codigo) {
        '1045' => ' Usuário ou senha incorretos — confira em hPanel → Bancos de Dados.',
        '1044' => ' O banco informado não existe, ou o usuário não tem acesso a ele.',
        '2002', '2003' => ' O host não está acessível. Tente "localhost".',
        default => '',
    };
    pagina('Falha na instalação',
        '<div class="msg erro"><strong>Não consegui conectar ao MySQL.</strong><br>'
        . esc($e->getMessage()) . '<br><br>' . esc($ajuda) . '</div>'
        . '<p style="font-size:13.5px">Verifique os dados e rode o instalador novamente.</p>');
} catch (Throwable $e) {
    pagina('Falha na instalação',
        '<div class="msg erro">' . esc($e->getMessage()) . '</div>');
}

// 6. Apagar o instalador.
$destinos = [$RAIZ . '/instalar.php', __DIR__ . '/instalador.dados.php'];
$apagou = false;
foreach ($destinos as $arquivo) {
    if (is_file($arquivo) && @unlink($arquivo)) {
        $apagou = true;
    }
}

$lista = '';
foreach ($feito as $item) {
    $lista .= '<li>' . esc($item) . '</li>';
}

$aviso = $apagou
    ? '<div class="msg ok">O instalador se apagou. Nada sobrou no site além do sistema.</div>'
    : '<div class="msg info">Não consegui apagar o instalador automaticamente. '
      . 'Apague <code>instalar.php</code> e <code>instalador.dados.php</code> do site agora.</div>';

$corpo = <<<HTML
  <div class="msg ok"><strong>Instalação concluída.</strong></div>
  <h2>O que foi feito</h2>
  <ul style="font-size:13.5px;color:#48605a;margin:0;padding-left:18px">$lista</ul>
  $aviso

  <h2>Próximo passo</h2>
  <p style="font-size:14px;margin:0">
    Abra o site e clique em <strong>Cadastrar</strong> para criar sua conta.
    O primeiro usuário vira <strong>Administrador</strong> automaticamente.
  </p>
  <p style="font-size:13px;color:#6b8079">
    Ao cadastrar, use um e-mail e uma senha que você lembre — depois use
    <em>Usuários → editar</em> para trocar a senha.
  </p>
  <a class="btn" href="/">Ir para o sistema</a>

  <p style="margin:20px 0 0;font-size:12.5px;color:#6b8079">
    Se o login ainda falhar, confira <code>/api/health</code>: deve responder
    <code>{"ok":true,"banco":"conectado"}</code>.
  </p>
HTML;

pagina('Instalado', $corpo, true);
