/**
 * Seed do LGRP — popula o MySQL com dados de demonstração.
 *
 *   npm run seed
 *
 * Todas as senhas recebem a senha informada em SEED_SENHA (ou --senha).
 * O padrão é gerada e exibida ao final, para não haver senha fraca em silêncio.
 */
import crypto from 'node:crypto';
import db, { pool } from '../api/db-client.js';
import { hashSenha } from '../api/authz.js';

const args = process.argv.slice(2);
const arg = (nome, padrao = null) => {
  const i = args.indexOf(`--${nome}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : padrao;
};

const SENHA = arg('senha', process.env.SEED_SENHA) || crypto.randomBytes(6).toString('base64url');
const SENHA_PADRAO = !arg('senha', process.env.SEED_SENHA);
const ANO = new Date().getFullYear();

const LABS = [
  'Lab. de Química Analítica', 'Lab. de Química Orgânica', 'Lab. de Química Inorgânica',
  'Lab. de Físico-Química', 'Lab. de Bioquímica', 'Lab. de Microbiologia',
  'Lab. de Cromatografia', 'Lab. de Espectrometria de Massas', 'Lab. de Ensino de Graduação',
  'Central Analítica Multiusuária', 'Farmácia Universitária', 'Lab. de Toxicologia Ambiental',
];
const TIPOS = [
  'Solvente Orgânico Halogenado', 'Solvente Orgânico Não Halogenado', 'Ácido Inorgânico',
  'Base Inorgânica', 'Sal de Metal Pesado', 'Resíduo com Cianeto', 'Resíduo Orgânico Aquoso',
  'Óleo Lubrificante Usado', 'Reagente Vencido', 'Vidraria Contaminada', 'Resíduo Biológico (Grupo A)',
  'Resíduo Perfurocortante (Grupo E)', 'Lâmpadas Fluorescentes', 'Pilhas e Baterias',
];
const GRUPOS = ['Halogenados','Não Halogenados','Ácidos','Bases','Metais Pesados','Cianetos','Orgânicos Aquosos','Óleos e Graxas','Biológicos','Perfurocortantes','Especiais'];
const CLASSES = ['Classe I — Perigoso','Classe II-A — Não Inerte','Classe II-B — Inerte','Grupo A — Biológico','Grupo B — Químico','Grupo E — Perfurocortante'];
const EMB = ['Bombona plástica 20 L','Bombona plástica 50 L','Tambor metálico 200 L','Tambor plástico 200 L','Frasco de vidro âmbar 1 L','Caixa coletora perfurocortante 7 L','Saco branco leitoso 100 L'];
const STATUS_P = ['Solicitado','Agendado','Coletado','Em Tratamento','Destinado','Cancelado'];
const PRI = ['Baixa','Média','Alta','Crítica'];
const RISCOS = ['Inflamabilidade','Corrosividade','Toxicidade aguda','Toxicidade crônica','Reatividade com água','Liberação de gases tóxicos','Risco biológico','Nenhum risco relevante'];
const METODOS = ['Incineração','Neutralização Ácido-Base','Destilação / Recuperação','Precipitação Química','Oxidação Química','Encapsulamento / Solidificação','Coprocessamento','Aterro Classe I','Autoclavagem'];
const DESTINOS = ['Essencis Ambiental S.A.','Ambiental Santos Brasil Ltda.','Cetrei Resíduos Industriais','Hazard Control Destinação S.A.','Aterro Classe I — Unidade Campus','Recuperação Interna LGRP','Votorantim Cimentos (Coprocessamento)'];
const PESSOAS = ['Helena Vasconcelos Prado','Ricardo Almeida Nunes','Mariana Costa Ferreira','João Pedro Salgado','Beatriz Lopes Menezes','Carlos Eduardo Tavares','Ana Luísa Bergamaschi','Fernando Ribeiro Lima','Patrícia Nogueira Dias','Rafael Monteiro Sales'];
const LOCAIS = ['Abrigo de Resíduos Perigosos — Bloco A','Abrigo de Resíduos Perigosos — Bloco B','Central de Triagem LGRP','Sala de Solventes 104','Sala de Reagentes 112','Área de Descontaminação 07'];
const VEIC = ['Caminhonete LGRP-01','Carrinho hidráulico fechado','Veículo utilitário da Prefeitura do Campus','Transporte manual com contentor'];
const TIPOS_VID = ['Béquer','Erlenmeyer','Balão Volumétrico','Balão de Fundo Redondo','Proveta','Pipeta Volumétrica','Funil de Separação','Funil de Büchner','Placa de Petri','Tubo de Ensaio','Vidro de Relógio','Kitassato','Condensador','Frasco de Reagente'];
const CONTAM = ['Cromo hexavalente','Nitrato de prata','Fenol','Cloreto de metileno','Sulfato de cobre','Ácido nítrico concentrado','Solução de permanganato','Resíduo de extração com clorofórmio','Cianeto de potássio (traços)','Acetato de chumbo'];
const MET_DESC = ['Lavagem com detergente neutro','Banho ácido (HNO₃ 10%)','Banho de solução sulfocrômica','Enxágue com solvente orgânico','Autoclavagem (121 °C / 30 min)','Neutralização prévia','Descarte como resíduo químico'];
const ST_VID = ['Aguardando Descontaminação','Em Descontaminação','Descontaminada','Reaproveitada','Descartada'];
const NIV = ['Baixo','Médio','Alto','Crítico'];
const FABR = ['Merck / Sigma-Aldrich','Vetec','Dinâmica Química','Impex','Synth','Neon Comercial','J.T. Baker'];


const pick = (a) => a[Math.floor(Math.random() * a.length)];
const ri = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const rf = (a, b, dec = 1) => Number((Math.random() * (b - a) + a).toFixed(dec));
const d = (daysAgo, h = 12) => {
  const x = new Date();
  x.setUTCDate(x.getUTCDate() - daysAgo);
  x.setUTCHours(h, ri(0, 59), 0, 0);
  return x.toISOString();
};
const dFut = (days) => {
  const x = new Date();
  x.setUTCDate(x.getUTCDate() + days);
  return x.toISOString();
};

/**
 * Inserção em lote: o driver faz 1 round-trip por bloco, não por linha.
 * Devolve as linhas completas, pois os passos seguintes dependem de campos
 * como `status`, `codigo` e `data_solicitacao`.
 */
async function inserir(tabela, linhas) {
  if (!linhas.length) return [];
  const lote = 200;
  const out = [];
  for (let i = 0; i < linhas.length; i += lote) {
    const { data, error } = await db.from(tabela).insert(linhas.slice(i, i + lote)).select('*');
    if (error) throw new Error(`${tabela}: ${error.message}`);
    out.push(...(data || []));
  }
  return out;
}

async function main() {
  const { data: existentes } = await db.from('usuarios').select('id').limit(1);
  if ((existentes || []).length && !args.includes('--forcar')) {
    console.error(
      'O banco já contém usuários. O seed APAGA todos os dados.\n' +
        'Se realmente for isso, execute com --forcar.'
    );
    process.exit(1);
  }

  console.log('Limpando tabelas existentes...');
  const conn = await pool.getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ['historico','notificacoes','coletas','tratamentos','pedidos_coleta','solventes','reagentes','vidrarias','indicadores_mensais','usuarios']) {
      await conn.query(`TRUNCATE TABLE \`${t}\``);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    conn.release();
  }

  /* ---------- usuários ---------- */
  console.log('Inserindo usuários...');
  const senha_hash = await hashSenha(SENHA);
  const usuarios = [
    { nome: 'Isael Aparecido Rosa', email: 'isael.rosa@universidade.br', papel: 'Administrador', setor: 'Laboratório de Gestão de Resíduos Perigosos', crq: 'CRQ-IV 04352891', telefone: '(11) 3091-6402', ativo: true },
    { nome: 'Ricardo Almeida Nunes', email: 'ricardo.nunes@universidade.br', papel: 'Químico Responsável', setor: 'Central Analítica Multiusuária', crq: 'CRQ-IV 04219873', telefone: '(11) 3091-6418', ativo: true },
    { nome: 'Mariana Costa Ferreira', email: 'mariana.ferreira@universidade.br', papel: 'Gestor Ambiental', setor: 'Pró-Reitoria de Pesquisa', crq: '', telefone: '(11) 3091-6100', ativo: true },
    { nome: 'João Pedro Salgado', email: 'joao.salgado@universidade.br', papel: 'Técnico de Laboratório', setor: 'Lab. de Química Orgânica', crq: 'CRQ-IV 04498120', telefone: '(11) 3091-6455', ativo: true },
    { nome: 'Beatriz Lopes Menezes', email: 'beatriz.menezes@universidade.br', papel: 'Técnico de Laboratório', setor: 'Lab. de Química Analítica', crq: 'CRQ-IV 04512337', telefone: '(11) 3091-6461', ativo: true },
    { nome: 'Carlos Eduardo Tavares', email: 'carlos.tavares@universidade.br', papel: 'Técnico de Laboratório', setor: 'Lab. de Cromatografia', crq: 'CRQ-IV 04603221', telefone: '(11) 3091-6477', ativo: true },
    { nome: 'Ana Luísa Bergamaschi', email: 'ana.bergamaschi@universidade.br', papel: 'Químico Responsável', setor: 'Lab. de Toxicologia Ambiental', crq: 'CRQ-IV 04388114', telefone: '(11) 3091-6490', ativo: true },
    { nome: 'Fernando Ribeiro Lima', email: 'fernando.lima@universidade.br', papel: 'Consultor', setor: 'Auditoria Ambiental Externa', crq: '', telefone: '(11) 98812-4477', ativo: true },
    { nome: 'Patrícia Nogueira Dias', email: 'patricia.dias@universidade.br', papel: 'Gestor Ambiental', setor: 'Prefeitura do Campus', crq: '', telefone: '(11) 3091-6222', ativo: false },
    { nome: 'Rafael Monteiro Sales', email: 'rafael.sales@universidade.br', papel: 'Técnico de Laboratório', setor: 'Lab. de Ensino de Graduação', crq: 'CRQ-IV 04711908', telefone: '(11) 3091-6433', ativo: true },
  ].map((u) => ({ ...u, senha_hash }));

  const us = await inserir('usuarios', usuarios);
  console.log(`  ${us.length} usuários`);

  /* ---------- pedidos ---------- */
  const pedidos = [];
  for (let i = 0; i < 78; i++) {
    const dias = ri(0, 300);
    const status = dias > 60 ? pick(['Destinado','Destinado','Destinado','Em Tratamento','Cancelado']) : dias > 20 ? pick(['Destinado','Em Tratamento','Coletado','Coletado','Agendado']) : pick(STATUS_P);
    const tipo = pick(TIPOS);
    const un = tipo.includes('Solvente') || tipo.includes('Aquoso') || tipo.includes('Óleo') ? 'L' : tipo.includes('Vidraria') || tipo.includes('Lâmpadas') || tipo.includes('Perfurocortante') ? 'un' : 'kg';
    const coletado = ['Coletado','Em Tratamento','Destinado'].includes(status);
    pedidos.push({
      codigo: `PED-${ANO}-${String(i + 1).padStart(4, '0')}`,
      laboratorio: pick(LABS),
      solicitante: pick(PESSOAS),
      usuario_id: pick(us).id,
      tipo_residuo: tipo,
      grupo: pick(GRUPOS),
      classe: tipo.includes('Biológico') ? 'Grupo A — Biológico' : tipo.includes('Perfurocortante') ? 'Grupo E — Perfurocortante' : pick(CLASSES),
      quantidade_estimada: un === 'un' ? ri(4, 120) : rf(1.5, 180, 1),
      unidade: un,
      embalagem: pick(EMB),
      local_coleta: `Sala ${ri(101, 340)} — Bloco ${pick(['A','B','C','D'])}, Departamento de Química`,
      data_solicitacao: d(dias),
      data_prevista: d(Math.max(0, dias - ri(2, 9))),
      data_coleta: coletado ? d(Math.max(0, dias - ri(3, 12))) : null,
      status,
      prioridade: pick(PRI),
      responsavel: pick(PESSOAS),
      risco: pick(RISCOS),
      observacoes: Math.random() > 0.6 ? 'Resíduo segregado conforme procedimento operacional padrão POP-LGRP-04. Frascos identificados e lacrados.' : null,
    });
  }
  const pd = await inserir('pedidos_coleta', pedidos);
  console.log(`  ${pd.length} pedidos de coleta`);

  /* ---------- coletas ---------- */
  const coletaveis = pd.filter((p) => ['Coletado','Em Tratamento','Destinado'].includes(p.status));
  const coletas = coletaveis.map((p) => ({
    pedido_id: p.id,
    data_coleta: p.data_coleta || d(ri(1, 40)),
    coletor: p.responsavel || pick(PESSOAS),
    equipe: pick(['Equipe A — LGRP','Equipe B — LGRP','Equipe C — Turno Noturno']),
    peso_kg: p.unidade === 'kg' ? rf(1, 190, 2) : rf(0.4, 25, 2),
    volume_l: p.unidade === 'L' ? rf(2, 180, 2) : rf(0, 6, 2),
    unidades: ri(1, 12),
    destino_temporario: pick(LOCAIS),
    veiculo: pick(VEIC),
    mtr: `MTR-${ANO}-${String(ri(100000, 999999))}`,
    observacoes: Math.random() > 0.75 ? 'Conferência de lacres e identificação realizada no local.' : null,
  }));
  const cl = await inserir('coletas', coletas);
  console.log(`  ${cl.length} coletas`);

  /* ---------- tratamentos ---------- */
  const tratamentos = [];
  for (let i = 0; i < 54; i++) {
    const dias = ri(2, 290);
    const metodo = pick(METODOS);
    const destil = /Destila/.test(metodo);
    const un = destil ? 'L' : 'kg';
    const status = dias > 25 ? pick(['Concluído','Concluído','Concluído','Cancelado']) : pick(['Concluído','Em Andamento','Agendado']);
    const ent = rf(5, 220, 1);
    const sai = destil ? rf(ent * 0.55, ent * 0.88, 1) : rf(ent * 0.05, ent * 0.4, 1);
    tratamentos.push({
      codigo: `TRT-${ANO}-${String(i + 1).padStart(4, '0')}`,
      pedido_id: Math.random() > 0.5 ? pick(pd).id : null,
      residuo: destil ? pick(['Mistura de acetona e metanol','Clorofórmio contaminado','Mistura de solventes apolares','Etanol 96% contaminado','Diclorometano de extração']) : pick(['Resíduo ácido misto','Solução alcalina de hidróxido de sódio','Resíduo com cromo hexavalente','Solução contendo prata','Resíduo orgânico halogenado','Resíduo com cianeto','Óleo lubrificante usado','Resíduo biológico autoclavável']),
      grupo: pick(GRUPOS),
      metodo,
      quantidade_entrada: ent,
      unidade: un,
      quantidade_saida: status === 'Concluído' ? sai : null,
      eficiencia: status === 'Concluído' ? rf(62, 98, 1) : null,
      data_inicio: d(dias),
      data_conclusao: status === 'Concluído' ? d(Math.max(0, dias - ri(3, 20))) : null,
      operador: pick(PESSOAS),
      responsavel_tecnico: pick(['Ricardo Almeida Nunes','Ana Luísa Bergamaschi','Helena Vasconcelos Prado']),
      destino_final: destil ? 'Recuperação Interna LGRP' : pick(DESTINOS),
      cnpj_destinador: destil ? null : `${ri(10,99)}.${ri(100,999)}.${ri(100,999)}/0001-${ri(10,99)}`,
      mtr: `MTR-${ANO}-${ri(100000, 999999)}`,
      certificado: status === 'Concluído' && !destil ? `CDF-${ri(10000, 99999)}` : null,
      custo: status === 'Concluído' ? rf(180, 6800, 2) : null,
      status,
      observacoes: Math.random() > 0.7 ? 'Processo acompanhado com registro de temperatura e pH a cada 30 minutos.' : null,
    });
  }
  const tr = await inserir('tratamentos', tratamentos);
  console.log(`  ${tr.length} tratamentos`);

  /* ---------- solventes ---------- */
  const SOLV = [
    ['Acetona P.A.','C₃H₆O','67-64-1','Não Halogenado',99.5],
    ['Metanol grau HPLC','CH₄O','67-56-1','Não Halogenado',99.9],
    ['Etanol absoluto','C₂H₆O','64-17-5','Não Halogenado',99.5],
    ['Isopropanol P.A.','C₃H₈O','67-63-0','Não Halogenado',99.7],
    ['Clorofórmio estabilizado','CHCl₃','67-66-3','Halogenado',99.0],
    ['Diclorometano P.A.','CH₂Cl₂','75-09-2','Halogenado',99.8],
    ['Tetra-hidrofurano (THF)','C₄H₈O','109-99-9','Não Halogenado',99.5],
    ['Acetonitrila grau HPLC','C₂H₃N','75-05-8','Não Halogenado',99.9],
    ['n-Hexano P.A.','C₆H₁₄','110-54-3','Não Halogenado',99.0],
    ['Tolueno P.A.','C₇H₈','108-88-3','Não Halogenado',99.5],
    ['Éter etílico anidro','C₄H₁₀O','60-29-7','Não Halogenado',99.7],
    ['Acetato de etila P.A.','C₄H₈O₂','141-78-6','Não Halogenado',99.5],
    ['Clorobenzeno','C₆H₅Cl','108-90-7','Halogenado',99.0],
    ['Mistura de solventes de extração','—','—','Mistura de Solventes',null],
    ['Piridina anidra','C₅H₅N','110-86-1','Não Halogenado',99.8],
    ['Dimetilformamida (DMF)','C₃H₇NO','68-12-2','Não Halogenado',99.8],
  ];
  const solventes = SOLV.map((s, i) => {
    const total = rf(5, 200, 1);
    const rest = rf(0.5, total, 1);
    const vencido = i % 7 === 3;
    return {
      codigo: `SOL-${ANO}-${String(i + 1).padStart(4, '0')}`,
      nome: s[0], formula: s[1], cas: s[2], categoria: s[3], pureza: s[4],
      volume_total_l: total,
      volume_restante_l: rest,
      volume_recuperado_l: s[3] === 'Halogenado' || i % 3 === 0 ? rf(0, total * 0.4, 1) : 0,
      embalagem: pick(['Bombona plástica 20 L','Tambor metálico 200 L','Frasco de vidro âmbar 1 L','Bombona plástica 50 L']),
      laboratorio: pick(LABS),
      localizacao: pick(LOCAIS),
      data_recebimento: d(ri(20, 400)),
      data_validade: vencido ? d(ri(5, 90)) : dFut(ri(30, 700)),
      status: rest <= 0.5 ? 'Esgotado' : pick(['Em Estoque','Em Estoque','Em Uso','Enviado para Recuperação','Recuperado']),
      inflamavel: s[3] !== 'Halogenado',
      responsavel: pick(PESSOAS),
      observacoes: null,
    };
  });
  const so = await inserir('solventes', solventes);
  console.log(`  ${so.length} solventes`);

  /* ---------- reagentes ---------- */
  const REAG = [
    ['Ácido sulfúrico P.A.','H₂SO₄','7664-93-9','Corrosivo'],
    ['Ácido nítrico 65%','HNO₃','7697-37-2','Corrosivo'],
    ['Ácido clorídrico 37%','HCl','7647-01-0','Corrosivo'],
    ['Hidróxido de sódio P.A.','NaOH','1310-73-2','Corrosivo'],
    ['Nitrato de prata','AgNO₃','7761-88-8','Oxidante'],
    ['Dicromato de potássio','K₂Cr₂O₇','7778-50-9','Cancerígeno'],
    ['Cianeto de potássio','KCN','151-50-8','Tóxico'],
    ['Permanganato de potássio','KMnO₄','7722-64-7','Oxidante'],
    ['Sulfato de cobre pentaidratado','CuSO₄·5H₂O','7758-99-8','Nocivo'],
    ['Acetato de chumbo','Pb(C₂H₃O₂)₂','301-04-2','Tóxico'],
    ['Clorato de potássio','KClO₃','3811-04-9','Oxidante'],
    ['Fenol cristalizado','C₆H₅OH','108-95-2','Tóxico'],
    ['Formaldeído 37%','CH₂O','50-00-0','Cancerígeno'],
    ['Carbonato de sódio anidro','Na₂CO₃','497-19-8','Irritante'],
    ['Cloreto de sódio P.A.','NaCl','7647-14-5','Nocivo'],
    ['EDTA dissódico','C₁₀H₁₄N₂Na₂O₈','6381-92-6','Irritante'],
    ['Iodo sublimado','I₂','7553-56-2','Nocivo'],
    ['Peróxido de hidrogênio 30%','H₂O₂','7722-84-1','Oxidante'],
    ['Tiossulfato de sódio','Na₂S₂O₃','7772-98-7','Irritante'],
    ['Cloreto de mercúrio (II)','HgCl₂','7487-94-7','Tóxico'],
    ['Amônia 25%','NH₄OH','1336-21-6','Corrosivo'],
    ['Ácido acético glacial','C₂H₄O₂','64-19-7','Corrosivo'],
    ['Benzeno P.A.','C₆H₆','71-43-2','Cancerígeno'],
    ['Tricloroetileno','C₂HCl₃','79-01-6','Cancerígeno'],
    ['Sódio metálico','Na','7440-23-5','Reativo'],
  ];
  const reagentes = REAG.map((r, i) => {
    const vencido = i % 4 === 1;
    const aVencer = i % 5 === 2;
    const un = pick(['g','g','kg','mL','L','un']);
    return {
      codigo: `REA-${ANO}-${String(i + 1).padStart(4, '0')}`,
      nome: r[0], formula: r[1], cas: r[2], classe_risco: r[3],
      fabricante: pick(FABR),
      lote: `${pick(['SLBV','MK','VT','DN','IM'])}${ri(1000, 9999)}`,
      quantidade: rf(25, 5000, un === 'kg' || un === 'L' ? 1 : 0),
      unidade: un,
      laboratorio: pick(LABS),
      localizacao: pick(['Armário de corrosivos A-1','Armário de inflamáveis B-2','Armário de tóxicos C-3 (chave)','Prateleira D-4','Geladeira de reagentes E-1','Armário de oxidantes F-2']),
      data_aquisicao: d(ri(60, 900)),
      data_validade: vencido ? d(ri(3, 200)) : aVencer ? dFut(ri(2, 29)) : dFut(ri(40, 900)),
      status: vencido ? pick(['Vencido','Segregado para Coleta']) : pick(['Ativo','Ativo','Em Uso','Esgotado']),
      observacoes: null,
    };
  });
  const re = await inserir('reagentes', reagentes);
  console.log(`  ${re.length} reagentes`);

  /* ---------- vidrarias ---------- */
  const vidrarias = [];
  for (let i = 0; i < 42; i++) {
    const dias = ri(1, 240);
    const status = dias > 45 ? pick(['Descontaminada','Reaproveitada','Descartada','Descontaminada']) : pick(ST_VID);
    const feito = ['Descontaminada','Reaproveitada','Descartada'].includes(status);
    vidrarias.push({
      codigo: `VID-${ANO}-${String(i + 1).padStart(4, '0')}`,
      tipo: pick(TIPOS_VID),
      laboratorio: pick(LABS),
      contaminante: pick(CONTAM),
      classe_contaminante: pick(CLASSES),
      nivel_contaminacao: pick(NIV),
      quantidade: ri(1, 40),
      data_registro: d(dias),
      data_descontaminacao: feito ? d(Math.max(0, dias - ri(2, 25))) : null,
      metodo_descontaminacao: feito || status === 'Em Descontaminação' ? pick(MET_DESC) : null,
      responsavel: pick(PESSOAS),
      status,
      destino: feito ? pick(['Retorno ao laboratório de origem','Descarte como resíduo químico Classe I','Reaproveitamento em aulas práticas','Encaminhado à reciclagem de vidro']) : null,
      observacoes: Math.random() > 0.8 ? 'Peças inspecionadas individualmente; trincas descartadas.' : null,
    });
  }
  const vi = await inserir('vidrarias', vidrarias);
  console.log(`  ${vi.length} vidrarias`);

  /* ---------- indicadores (lançamentos manuais) ---------- */
  const ind = [];
  for (let m = 1; m <= 12; m++) {
    if (m > new Date().getMonth() + 1) break;
    ind.push({
      mes: m, ano: ANO,
      acidentes: m === 4 ? 1 : 0,
      treinamentos: ri(1, 4),
      custo_operacional: rf(400, 2600, 2),
      destinacao_correta_pct: null,
      observacoes: m === 4 ? 'Derramamento de 500 mL de ácido nítrico na bancada 3, contido com vermiculita. Nenhum ferimento.' : m === 7 ? 'Auditoria interna do SGA concluída sem não conformidades maiores.' : null,
    });
  }
  const iv = await inserir('indicadores_mensais', ind);
  console.log(`  ${iv.length} indicadores mensais`);

  /* ---------- histórico (eventos iniciais) ---------- */
  const hist = [];
  const emailDe = (nome) =>
    `${nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '.')}@universidade.br`;
  pd.slice(0, 40).forEach((p, i) => {
    hist.push({
      tabela: 'pedidos_coleta', registro_id: String(p.id), registro_codigo: p.codigo,
      acao: 'INSERT', descricao: `Pedido de coleta criado (${p.codigo})`,
      usuario: p.solicitante, usuario_email: emailDe(p.solicitante),
      dados_anteriores: null, dados_novos: { codigo: p.codigo, laboratorio: p.laboratorio, tipo_residuo: p.tipo_residuo, status: 'Solicitado' }, mudancas: null,
      criado_em: p.data_solicitacao,
    });
    if (i % 3 === 0) {
      hist.push({
        tabela: 'pedidos_coleta', registro_id: String(p.id), registro_codigo: p.codigo,
        acao: 'UPDATE', descricao: `Pedido de coleta atualizado (${p.codigo})`,
        usuario: pick(PESSOAS), usuario_email: 'lgrp@universidade.br',
        dados_anteriores: { status: 'Solicitado' }, dados_novos: { status: p.status },
        mudancas: { status: { antes: 'Solicitado', depois: p.status } },
        criado_em: p.data_coleta || p.data_solicitacao,
      });
    }
  });
  tr.slice(0, 25).forEach((t) => {
    hist.push({
      tabela: 'tratamentos', registro_id: String(t.id), registro_codigo: t.codigo,
      acao: 'INSERT', descricao: `Tratamento de resíduo registrado (${t.codigo})`,
      usuario: t.operador, usuario_email: 'lgrp@universidade.br',
      dados_anteriores: null, dados_novos: { codigo: t.codigo, metodo: t.metodo, status: t.status }, mudancas: null,
      criado_em: t.data_inicio,
    });
  });
  const hs = await inserir('historico', hist);
  console.log(`  ${hs.length} registros de auditoria`);

  console.log('\nSEED CONCLUÍDO');
  console.log('Acesso administrador: isael.rosa@universidade.br');
  console.log(`Senha para todos os usuários: ${SENHA}${SENHA_PADRAO ? '  (gerada; defina --senha para escolher)' : ''}`);
}

main()
  .catch((e) => {
    console.error('ERRO:', e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
