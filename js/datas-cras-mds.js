/* ============================================================================
   DATAS DO CRAS CONFORME O MDS — arquivo de dados da agenda
   ----------------------------------------------------------------------------
   É o ÚNICO arquivo que você edita para atualizar essas datas. A agenda lê
   window.ARGO_MDS e mostra um marcador roxo "MDS" no dia, a lista "Neste mês",
   o cartão do dia e a exportação .ics. Entrada com erro de digitação é
   ignorada (nunca derruba a agenda).

   COMO ATUALIZAR
   1) Acrescente/edite linhas em "datas":  { d: 'AAAA-MM-DD', t: 'Texto curto', cat: 'rev', f: 'in2' }
        d    data no formato ISO (ano-mês-dia)
        t    texto que aparece na agenda
        cat  categoria (chave de "categorias" abaixo)
        f    (opcional) chave de "fontes" — de onde veio a data
        prev (opcional) true = data PREVISTA/sujeita a alteração (aparece com "~")
        obs  (opcional) observação mostrada no cartão do dia
   2) Troque "atualizadoEm" pela data da conferência.
   3) Para um ano novo basta acrescentar linhas com o ano novo; as de anos
      anteriores podem ficar. A agenda só mostra o ano corrente.
   Quando o MDS publicar nova edição da IN Conjunta / novo Informe, confira os
   links em "fontes" e ajuste as linhas marcadas com prev: true.
   ============================================================================ */
window.ARGO_MDS = {
  atualizadoEm: '2026-11-06',

  categorias: {
    rev:   'Revisão cadastral (REV26)',
    ave:   'Averiguação cadastral (AVE26)',
    base:  'Base do Cadastro Único',
    cond:  'Condicionalidades (Bolsa Família)',
    censo: 'Censo SUAS',
    outro: 'MDS'
  },

  fontes: {
    in2:   { nome: 'IN Conjunta nº 2/2026 — Anexos (edição de agosto)', url: 'https://www.gov.br/mds/pt-br/acesso-a-informacao/legislacao/instrucoes/in-ave-rev/AnexoINConjunta2_2026EdioAgosto.pdf' },
    inf88: { nome: 'Informe do Cadastro Único nº 88 (calendário da base mensal)', url: 'https://www.gov.br/mds/pt-br/acoes-e-programas/cadastro-unico/informes/informe-cadastro-unico-88' },
    inf105:{ nome: 'Informe do Bolsa Família nº 105 (IN Senarc nº 50/2025)', url: 'https://www.gov.br/mds/pt-br/acoes-e-programas/bolsa-familia/informes/informe-bolsa-familia-105' },
    cond:  { nome: 'Calendário 2026 de condicionalidades (MDS) — conferir no PDF oficial', url: 'https://p2saude.com.br/bolsa-familia-2026-governo-federal-publica-calendarios-de-saude-e-educacao/' },
    censo: { nome: 'Censo SUAS 2025 (prazo até 27/02/2026)', url: 'https://brasil61.com/n/aberto-o-prazo-para-preenchimento-do-censo-suas-2025-bras2615492' }
  },

  datas: [
    // ---- Fechamento de 2025 e Censo SUAS ----
    { d: '2026-01-31', t: 'Prazo: recursos de educação (4º bim/2025) no Sicon', cat: 'cond', f: 'inf105' },
    { d: '2026-02-27', t: 'Censo SUAS 2025: último dia de preenchimento', cat: 'censo', f: 'censo', obs: 'Municípios que não respondem podem ter repasses suspensos.' },

    // ---- Condicionalidades: educação (Sistema Presença) ----
    { d: '2026-03-31', t: 'Abre registro: educação (fev/mar)', cat: 'cond', f: 'cond' },
    { d: '2026-04-23', t: 'Fecha registro (fev/mar) e prazo de recursos', cat: 'cond', f: 'cond' },
    { d: '2026-05-29', t: 'Abre registro: educação (abr/mai)', cat: 'cond', f: 'cond' },
    { d: '2026-06-25', t: 'Fecha registro (abr/mai) e prazo de recursos', cat: 'cond', f: 'cond' },
    { d: '2026-07-31', t: 'Abre registro: educação (jun/jul)', cat: 'cond', f: 'cond' },
    { d: '2026-08-27', t: 'Fecha registro (jun/jul) e prazo de recursos', cat: 'cond', f: 'cond' },
    { d: '2026-09-30', t: 'Abre registro: educação (ago/set)', cat: 'cond', f: 'cond' },
    { d: '2026-10-29', t: 'Fecha registro (ago/set) e prazo de recursos (inclui saúde 1ª vigência)', cat: 'cond', f: 'cond' },
    { d: '2026-11-30', t: 'Abre registro: educação (out/nov)', cat: 'cond', f: 'cond' },
    { d: '2026-12-18', t: 'Fecha registro: educação (out/nov)', cat: 'cond', f: 'cond' },
    { d: '2027-01-31', t: 'Prazo de recursos: educação (ago/set/26) no Sicon', cat: 'cond', f: 'cond' },

    // ---- Condicionalidades: saúde (vigências semestrais, Sicon) ----
    { d: '2026-02-17', t: 'Abre registro de saúde: 1ª vigência/2026 (Sicon)', cat: 'cond', f: 'cond' },
    { d: '2026-07-10', t: 'Fecha registro de saúde: 1ª vigência/2026', cat: 'cond', f: 'cond' },
    { d: '2026-08-17', t: 'Abre registro de saúde: 2ª vigência/2026 (Sicon)', cat: 'cond', f: 'cond' },
    { d: '2027-01-16', t: 'Fecha registro de saúde: 2ª vigência/2026', cat: 'cond', f: 'cond' },

    // ---- Averiguação (AVE26) ----
    { d: '2026-05-11', t: 'AVE26: início da regularização (público 1)', cat: 'ave', f: 'in2' },
    { d: '2026-08-11', t: 'Reversão de cancelamento do PBF (regularizados após 10/07)', cat: 'ave', f: 'in2', obs: 'Efeito na folha de setembro/2026.' },
    { d: '2027-08-12', t: 'AVE26: exclusão lógica (data-limite)', cat: 'ave', f: 'in2', prev: true },

    // ---- Revisão cadastral (REV26): limites por público ----
    { d: '2026-01-12', t: 'REV26: início da regularização', cat: 'rev', f: 'in2' },
    { d: '2026-07-09', t: 'REV26: limite p/ evitar BLOQUEIO — públicos 1 e 4', cat: 'rev', f: 'in2' },
    { d: '2026-08-06', t: 'REV26: limite p/ evitar BLOQUEIO — públicos 2 e 5', cat: 'rev', f: 'in2' },
    { d: '2026-09-10', t: 'REV26: limite p/ evitar BLOQUEIO — públicos 3 e 6', cat: 'rev', f: 'in2' },
    { d: '2026-10-08', t: 'REV26: limite p/ evitar CANCELAMENTO — públicos 1 e 4; bloqueio — público 7', cat: 'rev', f: 'in2' },
    { d: '2026-11-12', t: 'REV26: limite CANCELAMENTO — públicos 2 e 5; bloqueio — público 8', cat: 'rev', f: 'in2' },
    { d: '2026-12-10', t: 'REV26: limite CANCELAMENTO — públicos 3 e 6; bloqueio — público 9', cat: 'rev', f: 'in2' },
    { d: '2027-01-07', t: 'REV26: limite CANCELAMENTO — público 7; bloqueio — público 10', cat: 'rev', f: 'in2', prev: true },
    { d: '2027-02-11', t: 'REV26: limite CANCELAMENTO — público 8; bloqueio — público 11', cat: 'rev', f: 'in2', prev: true },
    { d: '2027-03-11', t: 'REV26: limite CANCELAMENTO — público 9; bloqueio — público 12', cat: 'rev', f: 'in2', prev: true },
    { d: '2027-04-08', t: 'REV26: limite CANCELAMENTO — público 10; bloqueio — público 13', cat: 'rev', f: 'in2', prev: true },
    { d: '2027-05-06', t: 'REV26: limite CANCELAMENTO — público 11; bloqueio — público 14', cat: 'rev', f: 'in2', prev: true },
    { d: '2027-06-10', t: 'REV26: limite CANCELAMENTO — público 12; bloqueio — público 15', cat: 'rev', f: 'in2', prev: true },
    { d: '2027-07-01', t: 'Volta a obrigatoriedade da entrevista domiciliar', cat: 'rev', f: 'in2', prev: true },
    { d: '2027-07-08', t: 'REV26: limite CANCELAMENTO — público 13', cat: 'rev', f: 'in2', prev: true },
    { d: '2027-08-12', t: 'REV26: limite CANCELAMENTO — público 14', cat: 'rev', f: 'in2', prev: true },
    { d: '2027-09-09', t: 'REV26: limite CANCELAMENTO — público 15', cat: 'rev', f: 'in2', prev: true },

    // ---- Base mensal do Cadastro Único (extração às 19h; sistema fora do ar) ----
    { d: '2026-04-10', t: 'Extração da base do CadÚnico (sistema fora 09/04 19h–13/04 07h)', cat: 'base', f: 'inf88' },
    { d: '2026-05-08', t: 'Extração da base do CadÚnico (sistema fora 07/05 19h–11/05 07h)', cat: 'base', f: 'inf88' },
    { d: '2026-06-12', t: 'Extração da base do CadÚnico (sistema fora 11/06 19h–15/06 07h)', cat: 'base', f: 'inf88' },
    { d: '2026-07-10', t: 'Extração da base do CadÚnico (sistema fora 09/07 19h–13/07 07h)', cat: 'base', f: 'inf88' },
    { d: '2026-08-07', t: 'Extração da base do CadÚnico (sistema fora 06/08 19h–10/08 07h)', cat: 'base', f: 'inf88' },
    { d: '2026-09-11', t: 'Extração da base do CadÚnico (sistema fora 10/09 19h–14/09 07h)', cat: 'base', f: 'inf88' },
    { d: '2026-10-09', t: 'Extração da base do CadÚnico (sistema fora 08/10 19h–12/10 07h)', cat: 'base', f: 'inf88' },
    { d: '2026-11-13', t: 'Extração da base do CadÚnico (sistema fora 12/11 19h–16/11 07h)', cat: 'base', f: 'inf88' },
    { d: '2026-12-11', t: 'Extração da base do CadÚnico (sistema fora 10/12 19h–14/12 07h)', cat: 'base', f: 'inf88' }
  ]
};
