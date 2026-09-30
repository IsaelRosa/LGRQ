# Manual do Usuário — LGRP

**Laboratório de Gestão de Resíduos Perigosos**
Sistema de Gestão de Resíduos Químicos · Universidade Pública Federal

---

## 1. Entrando no sistema

Abra o endereço do sistema no navegador. Você será levado à tela de login.

| Campo | O que preencher |
|-------|-----------------|
| **E-mail** | Seu e-mail institucional |
| **Senha** | A senha definida por você ou pelo administrador |

Clique em **Entrar no sistema**.

### Primeiro acesso

Se ainda não tem conta, clique em **Cadastrar** e preencha nome, e-mail e senha (mínimo 6 caracteres).

> **Importante:** o **primeiro usuário** cadastrado no sistema recebe automaticamente o perfil de **Administrador**. Todos os seguintes entram como **Consultor** (somente leitura) e precisam ser promovidos por um administrador.

### Ao entrar pela primeira vez em um sistema novo

1. Faça login com um perfil de Administrador.
2. Vá em **Usuários** e cadastre os colleagues, definindo uma senha inicial para cada um.
3. Peça a cada pessoa que troque a senha inicial no primeiro acesso.

---

## 2. Perfis de acesso e o que cada um pode fazer

| Perfil | Lê | Edita | Gerencia usuários |
|--------|:---:|:-----:|:-----------------:|
| **Administrador** | ✓ | ✓ | ✓ |
| **Coordenador** | ✓ | ✓ | — |
| **Químico Responsável** | ✓ | ✓ | — |
| **Gestor Ambiental** | ✓ | ✓ | — |
| **Técnico de Laboratório** | ✓ | ✓ | — |
| **Consultor** | ✓ | — | — |

**Consultor é somente leitura.** Ele não vê botões de criar, editar ou excluir — e, mesmo que tente chamar a API diretamente, o servidor recusa a operação. Essa regra é aplicada no servidor, não só na tela.

---

## 3. Conhecendo o menu

Na barra lateral:

| Módulo | Para quê |
|--------|----------|
| **Dashboard** | Visão geral: indicadores, gráficos dos últimos 12 meses, alertas e atividade recente |
| **Pedidos & Coletas** | Solicitações de coleta e os registros de coleta efetuadas |
| **Tratamento de Resíduos** | Métodos de tratamento, eficiência, custos e destinação final |
| **Controle de Solventes** | Estoque, volume restante e recuperação |
| **Banco de Reagentes** | Validade, lote e classe de risco |
| **Vidrarias Contaminadas** | Descontaminação e reaproveitamento |
| **Indicadores Mensais** | Série histórica e metas mensais |
| **Relatórios** | Gerador personalizável com exportação |
| **Rastreabilidade** | Trilha de auditoria completa |
| **Notificações** | Central de alertas |
| **Usuários** | Perfis e permissões (só administradores) |

**Busca rápida:** o campo no topo da barra lateral localiza um módulo pelo nome ou por palavra-chave. Digite "vencido" e ele encontra o Banco de Reagentes; digite "MTR" e ele encontra Pedidos & Coletas.

---

## 4. Como usar qualquer módulo de cadastro

Todos os módulos de registro (Pedidos, Tratamentos, Solventes, Reagentes, Vidrarias, Usuários) funcionam da mesma forma.

### Localizar um registro

- **Buscar** — digite no campo de busca. A busca cobre todos os campos relevantes do módulo (código, nome, laboratório, e assim por diante).
- **Filtrar** — use os seletores acima da tabela para restringir por status, período, prioridade, laboratório.
- **Limpar filtros** — clique em **Limpar** para voltar a ver tudo.

### Criar

1. Clique em **Novo registro** (canto superior direito).
2. Preencha o formulário. Os campos com **asterisco** são obrigatórios.
3. Clique em **Salvar**.

Nos pedidos, tratamentos, solventes, reagentes e vidrarias o **código é gerado automaticamente** (ex.: `PED-2026-0001`) — você não precisa digitar.

### Editar

Clique no ícone de **lápis** na linha desejada. As mudanças ficam registradas na trilha de auditoria.

### Excluir

Clique no ícone de **lixeira**. O sistema pede confirmação — a exclusão é definitiva e não pode ser desfeita pela interface.

> **Antes de excluir**, prefira alterar o **status** quando o registro ainda faz sentido no histórico. Excluir um pedido já destinado apaga a evidência de que o resíduo foi corretamente destinado.

### Exportar

O botão **Exportar CSV** gera uma planilha com os dados **já filtrados** — se você filtrou por período e status, o CSV respeita isso. Útil para alimentar relatórios e prestações de contas.

---

## 5. Os módulos em detalhe

### Pedidos & Coletas

O **Pedido de Coleta** é a solicitação feita pelo laboratório gerador. O fluxo de status é:

```
Solicitado → Agendado → Coletado → Em Tratamento → Destinado
                                    (ou Cancelado, a qualquer momento)
```

- **Prioridade** — Baixa, Média, Alta ou **Crítica**. Pedidos críticos em tratamento geram alerta automático.
- **Unidade** — kg, L ou unidades (un). Define como a quantidade é interpretada e somada nos indicadores.
- **MTR** — o número do Manifesto de Transporte de Resíduos, gerado na **Coleta** correspondente.

Ao registrar uma **Coleta** vinculada a um pedido, o sistema preenche o laboratório, o tipo de resíduo e o peso automaticamente a partir do pedido.

**Destino correto:** o indicador de rastreabilidade compara pedidos encerrados (Destinado/Cancelado) com os efetivamente destinados. Quanto mais alto o percentual, melhor a conformidade.

### Tratamento de Resíduos

Registra o processo de tratamento e a destinação final.

- **Método** — Incineração, Neutralização Ácido-Base, Destilação/Recuperação, Precipitação, Oxidação, Encapsulamento, Coprocessamento, Aterro Classe I, Autoclavagem.
- **Quantidade de saída** e **eficiência** — só se aplicam a tratamentos concluídos.
- **CDF** — o Certificado de Destinação Final, para tratamentos concluídos em que o resíduo foi para destinação externa.
- Ao concluir um tratamento com método **Destilação**, o volume recuperado entra automaticamente nos indicadores de solventes recuperados.

### Controle de Solventes

Acompanha o estoque e calcula a situação de cada solvente:

| Situação | Quando aparece |
|----------|----------------|
| **Vencido** | Validade expirada |
| **A vencer** | Vence em até 30 dias |
| **Estoque baixo** | Restam 15% ou menos do volume total |
| **Esgotado** | Volume restante zerado |
| **Regular** | Dentro do esperado |

### Banco de Reagentes

Idem para reagentes, com alerta automático para **vencidos** e **a vencer em até 30 dias**. Reagente vencido deve ser **segregado e encaminhado para coleta** — atualize o status para "Segregado para Coleta" e abra um pedido.

### Vidrarias Contaminadas

Controla o ciclo de descontaminação: Aguardando → Em Descontaminação → Descontaminada / Reaproveitada / Descartada.

Vidraria **Aguardando Descontaminação** com nível de contaminação **Crítico** gera alerta automático.

### Indicadores Mensais

Consolida mês a mês: pedidos recebidos, coletas realizadas, kg/L coletados e tratados, reagentes vencidos, vidrarias descontaminadas, percentual de destinação correta, custo total, acidentes e treinamentos.

A maior parte é **calculada automaticamente** a partir dos registros. Você só lança manualmente o que o sistema não consegue deduzir:

- **Acidentes** do mês
- **Treinamentos** realizados
- **Custo operacional** (mão de obra, insumos)
- **Destinação correta (%)** — se você tiver o dado oficial, ele sobrescreve o cálculo automático
- **Observações**

### Notificações

A central de alertas. Os avisos são gerados por regras automáticas a cada 5 minutos:

| Tipo | Severidade | Dispara quando |
|------|-----------|----------------|
| Reagente vencido | crítica | Validade passou |
| Reagente a vencer | aviso | Vence em até 30 dias |
| Solvente vencido | crítica | Validade passou |
| Estoque baixo | aviso | Restam ≤ 15% |
| Coleta atrasada | crítica | Data prevista passou com pedido aberto |
| Pedido pendente | aviso | Mais de 7 dias sem agendamento |
| Prioridade crítica | aviso | Pedido crítico em tratamento |
| Contaminação crítica | crítica | Vidraria crítica aguardando |
| Tratamento prolongado | aviso | Mais de 30 dias em andamento |

Você pode **marcar como lida**, **marcar todas como lidas** e **excluir as lidas**. Alertas já notificados não são duplicados.

Também é possível registrar comunicados manuais (aviso de manutenção, mudança de procedimento).

### Rastreabilidade

Toda operação — criação, alteração, exclusão — fica registrada com **quem**, **quando**, **o que era** e **o que passou a ser**.

Use os filtros por módulo, ação, usuário, registro e período. O botão **Exportar auditoria** gera o CSV para apresentação institucional ou auditoria externa.

> Este registro **não pode ser apagado pela interface** — é a memória do sistema.

### Relatórios

Monte o relatório escolhendo:

- **Módulos** — combine pedidos, coletas, tratamentos, solventes, reagentes e vidrarias
- **Período** — data inicial e final
- **Agrupamento** — por laboratório, status, método, categoria, nível de risco, etc.
- **Colunas** — marque as que quiser ver

O painel de resumo mostra o total de registros e as somas das quantidades. **Exportar CSV** baixa tudo que está filtrado.

### Usuários

Visível e editável apenas por **Administradores**.

Ao cadastrar alguém, **defina uma senha inicial** — ela é obrigatória. Ao alterar o e-mail de um usuário, o sistema exige uma nova senha junto, porque o e-mail é a chave de login.

**Proteções ativas:**
- Não é possível rebaixar ou desativar o último administrador ativo do sistema
- Não é possível desativar ou rebaixar a própria conta
- **Desativar** um usuário bloqueia o login dele; os dados que ele criou continuam na trilha de auditoria

---

## 6. Dicas de uso

- **Comece pelos pedidos.** Tudo o mais se articula em torno deles: coletas, tratamentos e indicadores derivam dos pedidos.
- **Mantenha os status atualizados.** O motor de alertas e os indicadores dependem disso. Pedido que fica em "Solicitado" para de aparecer como pendência.
- **Use a busca antes de criar.** Evita cadastro duplicado, que atrapalha a contagem.
- **Registre a coleta com MTR.** É o documento que comprova o transporte legal do resíduo.
- **Exporte CSV com frequência.** Os dados estão no banco, mas o CSV é o que você apresenta.
- **Não compartilhe a senha.** Cada pessoa deve ter a própria conta: é o que dá rastreabilidade.

---

## 7. Problemas comuns

**Esqueci minha senha**
Fale com o administrador. Ele redefine pelo módulo **Usuários**. A senha antiga deixa de funcionar imediatamente.

**Aparece "Sessão expirada"**
A sessão dura 12 horas por padrão e é encerrada ao fechar. Entre novamente com e-mail e senha.

**Aparece "Sua conta está inativa"**
Seu usuário foi desativado por um administrador. Procure o responsável pelo LGRP.

**Aparece "Acesso somente leitura"**
Seu perfil é Consultor. Peça a um administrador para alterá-lo em **Usuários**.

**Meu navegador voltou sozinho para a tela de login**
Sessão expirada, ou o servidor foi reiniciado e a chave de assinatura mudou. Entre novamente.

**Aparece "Não foi possível falar com o banco de dados"**
O servidor está sem conexão com o MySQL. Isso é caso do suporte de TI — tente novamente em alguns minutos.

**Só consigo ler, os botões sumiram**
Esperado para Consultor. Confirme seu perfil com um administrador.

**Um alerta não apareceu**
Os alertas são recalculados a cada 5 minutos. Se os dados foram alterados nesse intervalo, o novo alerta entra no próximo ciclo. Alertas já existentes não são duplicados.

---

## 8. Requisitos e privacidade

- Navegador atualizado (Chrome, Edge ou Firefox recentes)
- Conexão com a internet — o sistema é acessado pelo endereço da instituição
- A sessão é guardada **no seu navegador**. Em computador compartilhado, **encerre a sessão** ao terminar

Toda operação é registrada em nome do usuário. Os dados de resíduos químicos, solventes e reagentes são informações institucionais sensíveis: **não compartilhe capturas de tela ou relatórios fora dos canais oficiais**.

---

## 9. Encaminhamentos

| Assunto | Para quem |
|---------|-----------|
| Acesso, permissões, senha | Administrador do LGRP |
| Problema de conexão / sistema fora do ar | Suporte de TI |
| Dúvida sobre classificação de resíduo | Responsável técnico pelo LGRP |
| Correção de dado já registrado | Administrador (com registro em auditoria) |

---

## Apêndice — Acesso de demonstração

Estas são as contas criadas pelo seed de demonstração (`npm run seed`). **Todas usam a mesma senha.**

> ⚠️ São dados fictícios, para treinamento e demonstração. **Troque a senha ou apague as contas antes de usar em produção.**

| E-mail | Perfil | O que demonstra |
|--------|--------|------------------|
| `helena.prado@universidade.br` | Administrador | Acesso total, incluindo gestão de usuários |
| `ricardo.nunes@universidade.br` | Químico Responsável | Tratamentos e destinação |
| `mariana.ferreira@universidade.br` | Gestor Ambiental | Indicadores e conformidade |
| `joao.salgado@universidade.br` | Técnico de Laboratório | Registro operacional |
| `fernando.lima@universidade.br` | Consultor | Somente leitura |
| `patricia.dias@universidade.br` | Gestor Ambiental | Conta **desativada** — mostra o bloqueio de login |

Para gerar a senha de demonstração com um valor escolhido:

```bash
npm run seed -- --senha SUA_SENHA
```

Para começar do zero, sem os dados de exemplo: use **Cadastrar** na tela de login. O primeiro usuário cadastrado vira Administrador.
