/**
 * Gera instalar.php: um único arquivo que, enviado para a raiz do site,
 * escreve o backend PHP completo, o .htaccess e o .env, testa a conexão
 * e se apaga.
 *
 *   node scripts/gerar-instalador.mjs
 *
 * O conteúdo vem dos arquivos reais (php/api/*.php), então o que for
 * enviado é exatamente o que foi testado — sem transcrição manual.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ARQUIVOS = [
  { destino: 'api/bootstrap.php', origem: 'php/api/bootstrap.php' },
  { destino: 'api/core.php', origem: 'php/api/core.php' },
  { destino: 'api/rotas.php', origem: 'php/api/rotas.php' },
  { destino: 'api/index.php', origem: 'php/api/index.php' },
];

/** Escapa um arquivo PHP para ser embutido como string em base64. */
const conteudo = ARQUIVOS.map(({ destino, origem }) => {
  const bruto = readFileSync(path.join(raiz, origem));
  return `  '${destino}' => '${bruto.toString('base64')}',`;
}).join('\n');

const htaccess = readFileSync(path.join(raiz, 'php/.htaccess'));

// O .htaccess também vai em base64: o texto tem "$" e "{}", que o PHP
// interpretaria como interpolação dentro de uma string.
const htaccessB64 = Buffer.from(htaccess, 'utf8').toString('base64');

const gerador = `<?php
/**
 * LGRP · dados do instalador (gerado automaticamente)
 *
 * Gere com: node scripts/gerar-instalador.mjs
 * Nao edite a mao — edite php/ e regenere.
 *
 * ARQUIVOS  mapeia caminho de destino -> conteudo em base64.
 * _htaccess  e o .htaccess em base64: o texto tem "$" e "{}", que o PHP
 * interpretaria como interpolação dentro de uma string.
 *
 * É variável, e nao const, porque o _htaccess e atribuido depois.
 */

// phpcs:disable
$ARQUIVOS = [
${conteudo}
];

$ARQUIVOS['_htaccess'] = '${htaccessB64}';
`;

writeFileSync(path.join(raiz, 'php', 'instalador.dados.php'), gerador, 'utf8');
console.log('php/instalador.dados.php gerado com', ARQUIVOS.length, 'chaves.');
