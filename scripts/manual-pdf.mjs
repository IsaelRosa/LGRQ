/**
 * Gera o PDF da manual de usuário.
 *
 *   node scripts/manual-pdf.mjs
 *
 * Converte o MANUAL.md em HTML com a identidade visual do LGRP e usa o Chrome
 * headless para imprimir em PDF. Sem dependências externas.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entrada = path.join(root, 'MANUAL.md');
const saidaDir = path.join(root, 'docs');
const saidaHtml = path.join(saidaDir, 'manual.html');
const saidaPdf = path.join(saidaDir, 'MANUAL-LGRP.pdf');

/* ------------------------------------------------------------------ */
/* Conversão Markdown -> HTML (subconjunto usado pela manual)         */
/* ------------------------------------------------------------------ */

const escapar = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Formatação de dentro da linha: **negrito**, *itálico*, `código`. */
function inline(texto) {
  let s = escapar(texto);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/—/g, '&mdash;');
  return s;
}

function tabela(linhas) {
  const sep = linhas[1];
  const cabecalho = linhas[0]
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());
  const corpo = linhas
    .slice(2)
    .filter((l) => l.trim())
    .map((l) =>
      '<tr>' +
      l
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((c) => `<td>${inline(c.trim())}</td>`)
        .join('') +
      '</tr>'
    )
    .join('');
  if (!/^\|?\s*:?-+/.test(sep)) return null;
  return (
    '<table><thead><tr>' +
    cabecalho.map((c) => `<th>${inline(c)}</th>`).join('') +
    '</tr></thead><tbody>' +
    corpo +
    '</tbody></table>'
  );
}

function converter(md) {
  const linhas = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  let emCodigo = false;
  let lista = null; // 'ul' | 'ol'

  const fecharLista = () => {
    if (lista) {
      out.push(`</${lista}>`);
      lista = null;
    }
  };

  while (i < linhas.length) {
    const l = linhas[i];

    // Bloco de código
    if (l.trim().startsWith('```')) {
      fecharLista();
      if (emCodigo) {
        out.push('</code></pre>');
        emCodigo = false;
      } else {
        out.push('<pre><code>');
        emCodigo = true;
      }
      i++;
      continue;
    }
    if (emCodigo) {
      out.push(escapar(l));
      i++;
      continue;
    }

    // Tabela
    if (l.trim().startsWith('|') && linhas[i + 1]?.includes('|')) {
      fecharLista();
      const bloco = [];
      while (i < linhas.length && linhas[i].trim().startsWith('|')) {
        bloco.push(linhas[i]);
        i++;
      }
      const t = tabela(bloco);
      if (t) out.push(t);
      continue;
    }

    // Linha horizontal
    if (/^---+$/.test(l.trim())) {
      fecharLista();
      out.push('<hr>');
      i++;
      continue;
    }

    // Títulos
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) {
      fecharLista();
      const n = h[1].length;
      out.push(`<h${n}>${inline(h[2])}</h${n}>`);
      i++;
      continue;
    }

    // Citação
    if (l.trim().startsWith('>')) {
      fecharLista();
      out.push(`<blockquote>${inline(l.replace(/^>\s?/, ''))}</blockquote>`);
      i++;
      continue;
    }

    // Listas
    const item = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(l);
    if (item) {
      const tipo = /^\d/.test(item[2]) ? 'ol' : 'ul';
      if (lista !== tipo) {
        fecharLista();
        out.push(`<${tipo}>`);
        lista = tipo;
      }
      const nivel = Math.floor(item[1].length / 2) + 1;
      out.push(`<li data-n="${nivel}">${inline(item[3])}</li>`);
      i++;
      continue;
    }

    // Parágrafo (pula linhas vazias)
    if (l.trim() === '') {
      fecharLista();
      i++;
      continue;
    }

    fecharLista();
    out.push(`<p>${inline(l)}</p>`);
    i++;
  }
  fecharLista();
  return out.join('\n');
}

/* ------------------------------------------------------------------ */
/* Template com a identidade visual do LGRP                           */
/* ------------------------------------------------------------------ */

const CSS = `
  @page { size: A4; margin: 20mm 18mm 18mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Inter", "Segoe UI", system-ui, sans-serif;
    color: #1c2b26; line-height: 1.6; font-size: 10.5pt;
    margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  h1 { font-size: 24pt; color: #08201a; margin: 0 0 2mm; line-height: 1.15; letter-spacing: -0.02em; }
  h1 + p { color: #4a6b5f; font-size: 11pt; margin-top: 0; }
  h2 {
    font-size: 14pt; color: #08201a; margin: 9mm 0 3mm;
    padding-bottom: 1.5mm; border-bottom: 2px solid #0d5c3f; letter-spacing: -0.01em;
    break-after: avoid;
  }
  h3 { font-size: 11.5pt; color: #0d5c3f; margin: 6mm 0 2mm; break-after: avoid; }
  h4 { font-size: 10.5pt; color: #2c4a3f; margin: 4mm 0 1.5mm; break-after: avoid; }
  p { margin: 0 0 2.5mm; orphans: 2; widows: 2; }
  ul, ol { margin: 0 0 3mm; padding-left: 6mm; }
  li { margin-bottom: 1.2mm; }
  li[data-n="2"] { margin-left: 5mm; }
  code {
    background: #eef4f1; color: #0d5c3f; padding: 0.4mm 1.2mm;
    border-radius: 2px; font-family: "Consolas", monospace; font-size: 9pt;
  }
  pre { background: #08201a; color: #e6f2ec; padding: 3mm 4mm; border-radius: 3px; overflow-x: auto; break-inside: avoid; }
  pre code { background: none; color: inherit; padding: 0; font-size: 8.5pt; }
  table { width: 100%; border-collapse: collapse; margin: 3mm 0 4mm; font-size: 9pt; break-inside: avoid; }
  th { background: #0d5c3f; color: #fff; text-align: left; padding: 2mm 2.5mm; font-weight: 600; }
  td { padding: 1.8mm 2.5mm; border-bottom: 1px solid #dde7e2; vertical-align: top; }
  tr:nth-child(even) td { background: #f6faf8; }
  blockquote {
    margin: 3mm 0; padding: 2.5mm 4mm; background: #fff8e6;
    border-left: 3px solid #e0a63c; border-radius: 0 3px 3px 0; font-size: 9.5pt;
  }
  hr { border: none; border-top: 1px solid #dde7e2; margin: 6mm 0; }
  .capa {
    background: linear-gradient(150deg, #08201a, #0d3d2b); color: #fff;
    padding: 14mm 12mm; border-radius: 4px; margin-bottom: 8mm;
    break-inside: avoid;
  }
  .capa .marca { font-size: 9pt; letter-spacing: 0.2em; text-transform: uppercase; color: #7fd4b0; margin-bottom: 2mm; }
  .capa h1 { color: #fff; }
  .capa h1 + p { color: #b9d9cc; }
  .capa .rodape { margin-top: 6mm; padding-top: 3mm; border-top: 1px solid rgba(255,255,255,0.18); font-size: 8.5pt; color: #9dc4b4; }
  h2, h3 { break-after: avoid; }
  table, pre, blockquote { break-inside: avoid; }
`;

function capa() {
  return `
    <div class="capa">
      <div class="marca">LGRP &middot; Universidade P&uacute;blica Federal</div>
      <h1>Manual do Usu&aacute;rio</h1>
      <p>Laborat&oacute;rio de Gest&atilde;o de Res&iacute;duos Perigosos<br>Sistema de Gest&atilde;o de Res&iacute;duos Qu&iacute;micos</p>
      <div class="rodape">
        Vers&atilde;o 2.5 &middot; Documento de uso interno<br>
        Pedidos de coleta &middot; Tratamentos &middot; Solventes &middot; Reagentes &middot; Vidrarias &middot; Indicadores &middot; Rastreabilidade
      </div>
    </div>`;
}

function chrome() {
  const candidatos = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  return candidatos.find((p) => existsSync(p)) || null;
}

const md = readFileSync(entrada, 'utf8');
// O cabeçalho original (título + subtítulo) vira a capa; descarta-se tudo
// até o primeiro H2 para não deixar resíduo duplicado no corpo.
const corpoHtml = converter(md);
const corpo = corpoHtml.slice(corpoHtml.indexOf('<h2>'));

const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Manual do Usuário — LGRP</title>
<style>${CSS}</style></head>
<body>${capa()}${corpo}</body></html>`;

mkdirSync(saidaDir, { recursive: true });
writeFileSync(saidaHtml, html, 'utf8');

const exe = chrome();
if (!exe) {
  console.error('Chrome/Edge nao encontrado. Defina CHROME_PATH.');
  process.exit(1);
}

const perfil = path.join(saidaDir, '.chrome-profile');
execFileSync(
  exe,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--disable-extensions',
    `--user-data-dir=${perfil}`,
    '--print-to-pdf-no-header',
    '--print-to-pdf=' + saidaPdf,
    'file:///' + saidaHtml.replace(/\\/g, '/'),
  ],
  { stdio: 'inherit' }
);

console.log('PDF gerado em:', saidaPdf);
