/* ===================== Autenticação (Tela de Login) =====================
   AVISO DE SEGURANÇA: esta tela de login é uma barreira de acesso *local*,
   no navegador, não uma autenticação de servidor. Como o app é um site
   estático (HTML + JS), o código-fonte e a estrutura da página são
   entregues ao navegador antes de qualquer senha ser digitada — quem tiver
   o arquivo do site sempre vai poder ler o CÓDIGO (Ctrl+U / DevTools).

   Isso NÃO significa mais, porém, que os DADOS de atendidos fiquem
   expostos: nome, endereço, NIS, anotações técnicas e anexos (chaves
   attach_/img_/note_/userdata_/nota_geral_encaminhamento) são gravados no
   localStorage já CIFRADOS com uma chave derivada da própria senha do app
   (ver deriveSessionKey/encryptForStorage/decryptFromStorage abaixo). Sem
   digitar a senha correta nesta tela, abrir o DevTools e olhar o
   localStorage mostra apenas texto cifrado (prefixo "enc1:"), não os dados
   em si. A chave só existe na memória da aba enquanto o app está
   desbloqueado; ela nunca é salva em disco e é apagada ao trancar/sair.

   Limitações importantes, para quem for avaliar isso com espírito crítico:
   - Não é criptografia de nível bancário/auditado (não usa WebCrypto/AES,
     para poder cifrar e decifrar de forma síncrona durante a renderização
     dos cards); é um cifrador de fluxo (stream cipher) próprio, com chave
     de 256 bits derivada por SHA-256 da senha. Ainda assim é uma cifra de
     verdade (dados diferentes a cada vez, nonce aleatório por valor), não
     apenas ofuscação/base64.
   - Qualquer pessoa que souber a senha da equipe também consegue decifrar
     os dados — a proteção é contra quem NÃO tem a senha (ex.: alguém que
     só tenha acesso ao arquivo do site ou a um HD/backup do navegador).
   - Se a senha do app (APP_PASSWORD_HASH) for trocada, os dados já
     cifrados com a senha antiga deixam de poder ser lidos com a senha
     nova. O arquivo de "Backup de anotações" (exportData) também é
     cifrado com a senha em uso no momento da exportação — antes de trocar
     a senha, gere o backup, troque a senha e só depois restaure o backup
     (importData), já com a senha nova digitada no login; tentar restaurar
     com uma senha diferente da usada na exportação falha (o app avisa em
     vez de importar dados corrompidos).
   - Para proteção completa (inclusive do código-fonte da página), ainda é
     necessário publicar o site atrás de autenticação no servidor/
     hospedagem (ex.: Cloudflare Access, Basic Auth no proxy, um backend
     com login). Em computador compartilhado, use "Apagar dados salvos
     neste dispositivo" no rodapé antes de emprestar/devolver o aparelho.

   A senha do app não fica mais em texto puro no código: comparamos o hash
   SHA-256 dela, e o campo tenta pouco a pouco travar após várias
   tentativas erradas seguidas. */
const APP_PASSWORD_HASH = '0a94e7ea0d2d585c64b206eeadaf4327045bc5398774fe04d8b9605b299e7431'; // para trocar a senha, rode setAppPassword('nova-senha') no console e cole o resultado aqui
const AUTH_MAX_ATTEMPTS = 5;
const AUTH_LOCKOUT_MS = 30000;
let authFailedAttempts = 0;
let authLockedUntil = 0;

// Chave de cifragem da sessão atual (Uint8Array de 32 bytes), derivada da
// senha digitada no login. Só existe na memória da aba enquanto o app
// estiver desbloqueado — nunca é persistida em disco/localStorage. Sem ela,
// decryptFromStorage() não consegue ler os dados sensíveis salvos.
let sessionEncKey = null;

async function sha256Hex(text) {
  const enc = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Deriva a chave de cifragem dos dados sensíveis a partir da senha digitada
// no login. Usa um "tempero" (prefixo) diferente do hash usado para
// conferir a senha (APP_PASSWORD_HASH), para que os dois valores nunca
// coincidam mesmo sendo derivados da mesma senha.
async function deriveSessionKey(password) {
  const enc = new TextEncoder().encode('argo-suas-enc-v1:' + password);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  return new Uint8Array(digest);
}

// Utilitário de uso único (rodar no console) para gerar o hash de uma nova
// senha e colar em APP_PASSWORD_HASH acima, em vez de guardar a senha em
// texto puro no arquivo.
async function setAppPassword(newPassword) {
  const hash = await sha256Hex(newPassword);
  console.log('Cole isto em APP_PASSWORD_HASH:', hash);
  return hash;
}

function unlockApp() {
  _attachCache.clear();
  const appRoot = document.getElementById('appRoot');
  const loginScreen = document.getElementById('loginScreen');
  if (appRoot) appRoot.dataset.locked = 'false';
  if (loginScreen) loginScreen.hidden = true;
  document.body.style.overflow = '';
  // A lista completa (374 fichas) só é montada por render() logo em seguida
  // (ver comentário no submit do login, mais abaixo), o que leva uma fração
  // de segundo. Mostra um aviso simples nesse intervalo em vez de deixar a
  // tela em branco, para o desbloqueio parecer imediato mesmo enquanto o
  // grid ainda está sendo construído.
  const grid = document.getElementById('grid');
  if (grid && !grid.innerHTML.trim()) {
    grid.innerHTML = '<div class="empty-state" id="unlockLoadingHint"><strong>Carregando diretório…</strong></div>';
  }
}

function lockApp() {
  // Ao trancar (inclusive ao carregar a página, antes do login), a chave de
  // cifragem sai da memória — os dados sensíveis salvos ficam ilegíveis até
  // a senha correta ser digitada de novo.
  sessionEncKey = null;
  _attachCache.clear();
  const appRoot = document.getElementById('appRoot');
  const loginScreen = document.getElementById('loginScreen');
  if (appRoot) appRoot.dataset.locked = 'true';
  if (loginScreen) {
    loginScreen.hidden = false;
    const pwField = document.getElementById('loginPassword');
    if (pwField) {
      pwField.value = '';
      setTimeout(() => pwField.focus(), 50);
    }
  }
  document.body.style.overflow = 'hidden';
  // Havia uma versão nova esperando (ver controllerchange): ao trancar, é o
  // momento seguro para recarregar sem atrapalhar ninguém.
  if (window.__argoUpdatePending) window.location.reload();
}

function initAuth() {
  lockApp();

  const form = document.getElementById('loginForm');
  const pwField = document.getElementById('loginPassword');
  const errorEl = document.getElementById('loginError');
  const errorTextEl = document.getElementById('loginErrorText');
  const toggleBtn = document.getElementById('loginToggleVisibility');
  const submitBtn = form ? form.querySelector('button[type="submit"]') : null;

  function showError(msg) {
    if (errorTextEl && msg) errorTextEl.textContent = msg;
    errorEl.classList.add('visible');
    errorEl.classList.remove('shake');
    void errorEl.offsetWidth;
    errorEl.classList.add('shake');
  }

  if (form) {
    form.addEventListener('submit', async function(e) {
      e.preventDefault();

      const now = Date.now();
      if (now < authLockedUntil) {
        const secs = Math.ceil((authLockedUntil - now) / 1000);
        showError(`Muitas tentativas erradas. Aguarde ${secs}s.`);
        return;
      }

      const value = (pwField.value || '').trim();
      if (!value) return;

      if (submitBtn) submitBtn.disabled = true;
      const valueHash = await sha256Hex(value);
      if (submitBtn) submitBtn.disabled = false;

      if (valueHash === APP_PASSWORD_HASH) {
        authFailedAttempts = 0;
        errorEl.classList.remove('visible');
        sessionEncKey = await deriveSessionKey(value);
        unlockApp();
        // Monta a lista de 374 fichas (render()) só DEPOIS que o navegador
        // já pintou a tela desbloqueada (ver comentário em unlockApp) —
        // antes, esse processamento pesado rodava competindo com o próprio
        // clique em "Entrar" (já que é síncrono e trava a thread principal
        // por um instante), dando a impressão de que o clique demorava para
        // responder. O duplo requestAnimationFrame garante que o quadro com
        // a tela desbloqueada/aviso de carregamento já foi desenhado antes
        // de começar o trabalho pesado.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (typeof render === 'function') render();
            if (typeof syncCategoryToggleLabel === 'function') syncCategoryToggleLabel();
            // Notificação de abertura do Argo (saudação do horário + resumo
            // da semana da agenda + estado da sincronização; ver bloco
            // "Notificação de Abertura" mais abaixo). Só é agendada DEPOIS
            // do render() acima: ele trava a thread por um instante, e se o
            // cartão já estivesse animando nesse momento a entrada dele
            // ficaria travada/pulando. Assim a lista aparece primeiro e o
            // cartão entra por cima, com a animação inteira e fluida.
            setTimeout(() => {
              const alreadyMutedToday = (typeof argoGreetingMutedToday === 'function') && argoGreetingMutedToday();
              if (!alreadyMutedToday && typeof argoShowGreeting === 'function') argoShowGreeting();
            }, 250);
          });
        });
      } else {
        authFailedAttempts++;
        if (authFailedAttempts >= AUTH_MAX_ATTEMPTS) {
          authLockedUntil = Date.now() + AUTH_LOCKOUT_MS;
          authFailedAttempts = 0;
          showError(`Muitas tentativas erradas. Aguarde ${Math.ceil(AUTH_LOCKOUT_MS/1000)}s.`);
        } else {
          showError('Senha incorreta. Tente novamente.');
        }
        pwField.value = '';
        pwField.focus();
      }
    });
  }

  if (toggleBtn && pwField) {
    const eyeIcon = toggleBtn.querySelector('.icon-eye');
    const eyeOffIcon = toggleBtn.querySelector('.icon-eye-off');
    toggleBtn.addEventListener('click', function() {
      const isPassword = pwField.type === 'password';
      pwField.type = isPassword ? 'text' : 'password';
      toggleBtn.setAttribute('aria-label', isPassword ? 'Ocultar senha' : 'Mostrar senha');
      toggleBtn.setAttribute('aria-pressed', String(isPassword));
      if (eyeIcon && eyeOffIcon) {
        eyeIcon.hidden = isPassword;
        eyeOffIcon.hidden = !isPassword;
      }
      pwField.focus();
    });
  }
}

function logout() {
  lockApp();
}

/* ===================== Notificação de Abertura (Argo) =====================
   Ao desbloquear o app, o Argo aparece num cartão de boas-vindas com:
     • a saudação do horário (bom dia / boa tarde / boa noite) e a data;
     • o resumo da semana da agenda (hoje em destaque + próximos dias) —
       já visível na própria notificação, sem precisar de um "sim" antes;
     • o estado da sincronização entre aparelhos (Firebase), que é iniciada
       em segundo plano assim que o cartão abre e se atualiza sozinha:
       sincronizando → sincronizado às HH:MM (ou erro / não configurada);
     • um botão que LEVA direto à aba "Agenda Boa Vista 2026" (onde fica o
       card de sincronização) — ou, se ainda não há código de sincronização
       neste aparelho, abre a tela de configuração dele.

   Os dados vêm da MESMA fonte do card da agenda: agendaBuildWeekSummary
   (feriados/pagamentos fixos de AGENDA_DATA_INFO + anotações sincronizadas
   em agendaNotesCache), definida mais abaixo neste arquivo. */

let argoGreetingShownAt = 0;
let argoGreetingSlowTimer = null;

function argoGreetingWord() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Bom dia';
  if (hour >= 12 && hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

// Ilustração do Argo Navis: céu noturno com constelação, o navio (proa em
// dragão, vela, escudos) balançando e três camadas de ondas em movimento.
// SVG inline (sem imagem externa), então funciona offline e nos dois temas.
// As animações são em CSS e desligam com "reduzir movimento" do sistema.
function argoSceneSvg() {
  const wave = (cls, y, amp, fill, op) =>
    `<path class="argo-wave ${cls}" fill="${fill}" fill-opacity="${op}" d="M0 ${y} q30 -${amp} 60 0` + ' t60 0'.repeat(11) + ' V172 H0Z"/>';
  const star = (x, y, s, d) =>
    `<g transform="translate(${x} ${y})"><g class="argo-twinkle" style="animation-delay:${d}s"><use href="#argoStar" fill="#f3d58a" transform="scale(${s})"/></g></g>`;
  return `
  <svg class="argo-scene-svg" viewBox="0 -20 360 192" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="argoSky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#050f22"/><stop offset=".55" stop-color="#0c2946"/><stop offset="1" stop-color="#14496d"/>
      </linearGradient>
      <linearGradient id="argoSail" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#9fcbcc"/><stop offset=".45" stop-color="#efe8cf"/><stop offset="1" stop-color="#fdf2d4"/>
      </linearGradient>
      <linearGradient id="argoHull" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#21606f"/><stop offset="1" stop-color="#0a2233"/>
      </linearGradient>
      <linearGradient id="argoGold" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#f6dc95"/><stop offset="1" stop-color="#b8894f"/>
      </linearGradient>
      <radialGradient id="argoGlow" cx=".5" cy=".55" r=".55">
        <stop offset="0" stop-color="#f3d58a" stop-opacity=".30"/><stop offset="1" stop-color="#f3d58a" stop-opacity="0"/>
      </radialGradient>
      <path id="argoStar" d="M0-5L1.3-1.3L5 0L1.3 1.3L0 5L-1.3 1.3L-5 0L-1.3-1.3Z"/>
    </defs>

    <rect y="-20" width="360" height="192" fill="url(#argoSky)"/>
    <circle cx="180" cy="100" r="92" fill="url(#argoGlow)"/>
    <circle cx="180" cy="100" r="84" fill="none" stroke="#f3d58a" stroke-opacity=".38" stroke-width=".8" stroke-dasharray="1.5 4.5" stroke-linecap="round"/>
    <circle cx="180" cy="100" r="70" fill="none" stroke="#f3d58a" stroke-opacity=".16" stroke-width=".6"/>

    <g stroke="#f3d58a" stroke-opacity=".45" stroke-width=".7" fill="none">
      <path d="M52 44 L86 26 L112 34 L128 18"/>
      <path d="M246 30 L278 20 L300 40 L326 30 L338 52"/>
    </g>
    <g fill="#f3d58a" fill-opacity=".85">
      <circle cx="52" cy="44" r="1.5"/><circle cx="86" cy="26" r="1.7"/><circle cx="112" cy="34" r="1.4"/><circle cx="128" cy="18" r="1.6"/>
      <circle cx="246" cy="30" r="1.5"/><circle cx="278" cy="20" r="1.7"/><circle cx="300" cy="40" r="1.4"/><circle cx="326" cy="30" r="1.6"/><circle cx="338" cy="52" r="1.3"/>
    </g>
    ${star(214, 6, 1.9, 0)}${star(30, 78, 1.1, .8)}${star(334, 96, 1.2, 1.5)}${star(64, 118, .8, 2.1)}${star(152, 26, .8, 1.1)}${star(292, 70, .9, .4)}${star(22, 22, .9, 1.9)}${star(150, -6, 1, .6)}${star(96, -10, .8, 1.7)}${star(330, 8, 1.3, 1.2)}

    <g transform="translate(180 104) scale(1.12) translate(-180 -104)"><g class="argo-ship">
      <g stroke="#f3d58a" stroke-opacity=".55" stroke-width=".7" fill="none">
        <path d="M178 27 L94 82"/><path d="M178 27 L266 83"/>
      </g>
      <path d="M130 45.5 C129 66 141 83 157 92 Q183 102 210 90 C224 77 231 56 231.5 35 Z" fill="url(#argoSail)"/>
      <g fill="none" stroke="#a89566" stroke-opacity=".38" stroke-width=".9" stroke-linecap="round">
        <path d="M150 47 C150 68 160 84 172 94"/><path d="M176 43 C177 66 185 83 191 96"/><path d="M204 39 C207 61 209 78 205 92"/>
      </g>
      <line x1="126" y1="46.8" x2="236" y2="34.6" stroke="#5a4630" stroke-width="2.4" stroke-linecap="round"/>
      <circle cx="126" cy="46.8" r="1.8" fill="url(#argoGold)"/><circle cx="236" cy="34.6" r="1.8" fill="url(#argoGold)"/>
      <line x1="178" y1="27" x2="178" y2="104" stroke="#4a3a28" stroke-width="2.6"/>
      <circle cx="178" cy="25.5" r="2.5" fill="url(#argoGold)"/>

      <path d="M95 89 C83 81 80 68 87 58" fill="none" stroke="url(#argoGold)" stroke-width="7.6" stroke-linecap="round"/>
      <path d="M95 89 C83 81 80 68 87 58" fill="none" stroke="#164556" stroke-width="4.8" stroke-linecap="round"/>
      <path d="M91 55 C88 50 79 51 72 58 C76 60 80 59 83 61 C87 62 90 60 91 55Z" fill="#164556" stroke="url(#argoGold)" stroke-width="1.3" stroke-linejoin="round"/>
      <path transform="translate(-3 7)" d="M92 54 C85 46 92 38 101 41 C95 43 95 47 97 51 C99 47 104 46 106 48 C100 49 98 52 97 56Z" fill="url(#argoGold)"/>
      <circle cx="84.5" cy="55.5" r="1.1" fill="#f6dc95"/>

      <path d="M263 88 C273 80 277 68 272 61" fill="none" stroke="url(#argoGold)" stroke-width="7" stroke-linecap="round"/>
      <path d="M263 88 C273 80 277 68 272 61" fill="none" stroke="#164556" stroke-width="4.2" stroke-linecap="round"/>
      <path d="M272 61 C270 55 263 58 266 63 C267 66 271 65 270 62" fill="none" stroke="url(#argoGold)" stroke-width="2.2" stroke-linecap="round"/>

      <path d="M92 86 C110 128 250 128 268 84 Q180 106 92 86 Z" fill="url(#argoHull)"/>
      <path d="M92 86 Q180 106 268 84" fill="none" stroke="url(#argoGold)" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M101 98 Q180 119 259 96" fill="none" stroke="url(#argoGold)" stroke-opacity=".7" stroke-width=".9" stroke-linecap="round"/>
      <g stroke="url(#argoGold)" stroke-width="1">
        <circle cx="118" cy="97" r="5.2" fill="#2d6f5e"/><circle cx="145" cy="100" r="5.2" fill="#2d6f5e"/>
        <circle cx="171" cy="101.5" r="5.2" fill="#2d6f5e"/><circle cx="198" cy="101" r="5.2" fill="#2d6f5e"/>
        <circle cx="224" cy="98.5" r="5.2" fill="#2d6f5e"/><circle cx="250" cy="94" r="5.2" fill="#2d6f5e"/>
      </g>
      <g fill="url(#argoGold)">
        <circle cx="118" cy="97" r="1.6"/><circle cx="145" cy="100" r="1.6"/><circle cx="171" cy="101.5" r="1.6"/>
        <circle cx="198" cy="101" r="1.6"/><circle cx="224" cy="98.5" r="1.6"/><circle cx="250" cy="94" r="1.6"/>
      </g>
    </g></g>

    ${wave('argo-wave-a', 116, 7, '#1d6b6e', .9)}
    ${wave('argo-wave-b', 126, 8, '#15575f', 1)}
    <g class="argo-glint" fill="#f6dc95">
      <rect x="112" y="139" width="16" height="1.4" rx=".7"/><rect x="196" y="145" width="22" height="1.4" rx=".7"/><rect x="250" y="136" width="12" height="1.4" rx=".7"/>
    </g>
    ${wave('argo-wave-c', 140, 9, '#0a3345', 1)}
  </svg>`;
}

function argoEnsureGreetingUI() {
  if (document.getElementById('argoGreetingModal')) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div id="argoGreetingModal" class="argo-greeting-overlay" role="dialog" aria-modal="true" aria-labelledby="argoGreetingTitle" onclick="if(event.target==this) argoDismissGreeting()">
      <div class="argo-greeting-box">
        <div class="argo-scene">
          ${argoSceneSvg()}
          <span class="argo-scene-pill"><span aria-hidden="true">🔔</span> Notificação</span>
          <button type="button" class="argo-greeting-x" onclick="argoDismissGreeting()" aria-label="Fechar notificação">✕</button>
        </div>
        <div class="argo-greeting-content">
          <p class="argo-greeting-date" id="argoGreetingDate"></p>
          <h3 id="argoGreetingTitle">Olá! Eu sou o Argo</h3>

          <div class="argo-week" id="argoGreetingWeek"></div>

          <div class="argo-sync-row" id="argoGreetingSync" data-state="none" role="status" aria-live="polite" aria-atomic="true">
          <span class="argo-sync-dot" aria-hidden="true"></span>
          <span class="argo-sync-text"></span>
          <button type="button" class="argo-sync-retry" id="argoGreetingSyncRetry" onclick="argoGreetingSyncRetry()">Tentar de novo</button>
        </div>

          <div class="argo-greeting-btns">
            <button type="button" id="argoGreetingYes" class="argo-greeting-yes" onclick="argoOpenAgendaFromGreeting()">
              <span class="argo-yes-label">Ver agenda e sincronização</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </button>
            <button type="button" class="argo-greeting-no" onclick="argoDismissGreeting()">Agora não</button>
          </div>

          <label class="argo-greeting-mute">
            <input type="checkbox" id="argoGreetingMuteToday">
            <span>Não mostrar de novo hoje</span>
          </label>
        </div>
      </div>
    </div>
    <style>
      .argo-greeting-overlay { display:none; position:fixed; inset:0; background:rgba(4,10,22,0.62); -webkit-backdrop-filter:blur(3px); backdrop-filter:blur(3px); z-index:1200; align-items:center; justify-content:center; padding:18px; }
      .argo-greeting-overlay.visible { display:flex; }
      .argo-greeting-box { overscroll-behavior:contain; position:relative; background:var(--bg-card,#fff); color:var(--text-main,#1e293b); width:100%; max-width:392px; max-height:calc(100vh - 36px); max-height:calc(100dvh - 36px); overflow-y:auto; border-radius:20px; box-shadow:0 30px 64px -12px rgba(0,0,0,0.6), 0 0 0 1px rgba(184,137,79,0.4); animation:argoGreetingPop .4s cubic-bezier(.2,.8,.2,1); }
      @keyframes argoGreetingPop { from { transform:translateY(16px) scale(.96); opacity:0; } to { transform:none; opacity:1; } }

      .argo-scene { position:relative; height:188px; background:#050f22; overflow:hidden; }
      .argo-scene-svg { display:block; width:100%; height:100%; }
      .argo-scene::after { content:''; position:absolute; left:0; right:0; bottom:0; height:2px; background:linear-gradient(90deg, transparent, #f3d58a, transparent); opacity:.7; }
      .argo-scene-pill { position:absolute; top:12px; left:12px; display:inline-flex; align-items:center; gap:6px; padding:5px 11px; border-radius:999px; font-size:11px; font-weight:700; letter-spacing:.04em; color:#f6e7bd; background:rgba(5,15,34,0.55); border:1px solid rgba(243,213,138,0.4); -webkit-backdrop-filter:blur(4px); backdrop-filter:blur(4px); }
      .argo-greeting-x { position:absolute; top:10px; right:10px; width:28px; height:28px; border-radius:50%; border:1px solid rgba(243,213,138,0.35); background:rgba(5,15,34,0.55); color:#f6e7bd; font-size:12px; line-height:1; cursor:pointer; display:flex; align-items:center; justify-content:center; }
      .argo-greeting-x:hover { background:rgba(5,15,34,0.85); }

      .argo-ship { transform-origin:180px 114px; animation:argoBob 5s ease-in-out infinite; }
      @keyframes argoBob { 0%,100% { transform:translateY(0) rotate(-1.3deg); } 50% { transform:translateY(-3.5px) rotate(1.3deg); } }
      .argo-wave { will-change:transform; }
      .argo-wave-a { animation:argoWaveL 11s linear infinite; }
      .argo-wave-b { animation:argoWaveR 8s linear infinite; }
      .argo-wave-c { animation:argoWaveL 6s linear infinite; }
      @keyframes argoWaveL { from { transform:translateX(0); } to { transform:translateX(-120px); } }
      @keyframes argoWaveR { from { transform:translateX(-120px); } to { transform:translateX(0); } }
      .argo-twinkle { transform-box:fill-box; transform-origin:center; animation:argoTwinkle 3.2s ease-in-out infinite; }
      @keyframes argoTwinkle { 0%,100% { opacity:.35; transform:scale(.7); } 50% { opacity:1; transform:scale(1.15); } }
      .argo-glint { animation:argoGlint 4s ease-in-out infinite; }
      @keyframes argoGlint { 0%,100% { opacity:.15; } 50% { opacity:.7; } }

      .argo-greeting-content { padding:18px 22px 22px; }
      .argo-greeting-date { margin:0 0 4px 0; font-size:11px; font-weight:800; letter-spacing:.09em; text-transform:uppercase; color:#b8894f; }
      .argo-greeting-box h3 { margin:0 0 14px 0; font-family:var(--font-serif,'Lora',Georgia,serif); font-size:23px; font-weight:500; line-height:1.2; color:var(--text-main,#1e293b); }

      .argo-week { background:rgba(0,145,194,0.07); border:1px solid var(--border-ui,#e2e8f0); border-radius:14px; padding:12px 14px; font-size:13px; line-height:1.5; }
      .argo-week-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; font-size:11px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; color:var(--text-muted,#475569); }
      .argo-week-count { background:var(--brand-primary,#0091C2); color:#fff; border-radius:999px; padding:2px 9px; font-size:10.5px; letter-spacing:.02em; }
      .argo-week-today { display:flex; align-items:flex-start; gap:8px; font-weight:600; }
      .argo-week-tag { flex-shrink:0; background:#b8894f; color:#fff; border-radius:6px; padding:1px 8px; font-size:10.5px; font-weight:800; letter-spacing:.05em; text-transform:uppercase; margin-top:2px; }
      .argo-week-label { margin:10px 0 3px 0; font-size:10.5px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; color:var(--text-muted,#475569); }
      .argo-week-list { list-style:none; margin:0; padding:0; }
      .argo-week-list li { display:flex; gap:8px; padding:4px 0; border-top:1px solid var(--border-ui,#e2e8f0); }
      .argo-week-list li:first-child { border-top:none; }
      .argo-week-day { flex-shrink:0; min-width:64px; font-weight:700; color:var(--text-main,#1e293b); }
      .argo-week-more { color:var(--text-muted,#475569); font-style:italic; }
      .argo-entry { flex:1 1 auto; min-width:0; }
      .argo-chip { display:inline-flex; align-items:center; gap:6px; font-weight:700; }
      .argo-chip::before { content:''; flex-shrink:0; width:8px; height:8px; border-radius:50%; background:var(--chip,#94a3b8); }
      .argo-chip-feriado { --chip:#c0463d; }
      .argo-chip-facultativo { --chip:#d99a2b; }
      .argo-chip-pagamento { --chip:#3f9d6b; }
      .argo-chip-extra { --chip:#2f7fb8; }
      .argo-note { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; overflow-wrap:anywhere; font-weight:500; color:var(--text-muted,#475569); }
      .argo-chip + .argo-note { margin-top:1px; }
      .argo-when { margin-left:8px; font-size:12px; color:var(--text-muted,#475569); }
      .argo-week-empty { margin-top:6px; color:var(--text-muted,#475569); }

      .argo-sync-row { display:flex; align-items:center; flex-wrap:wrap; gap:9px; margin:12px 2px 0 2px; font-size:12.5px; color:var(--text-muted,#475569); line-height:1.4; }
      .argo-sync-text { flex:1 1 auto; }
      .argo-sync-dot { flex-shrink:0; width:9px; height:9px; border-radius:50%; background:#94a3b8; }
      .argo-sync-row[data-state="ok"] .argo-sync-dot { background:#3f9d6b; box-shadow:0 0 0 3px rgba(63,157,107,0.2); }
      .argo-sync-row[data-state="connecting"] .argo-sync-dot { background:#d99a2b; animation:argoPulse 1.1s ease-in-out infinite; }
      .argo-sync-row[data-state="slow"] .argo-sync-dot { background:#d99a2b; }
      .argo-sync-row[data-state="error"] .argo-sync-dot { background:#c0463d; }
      @keyframes argoPulse { 0%,100% { box-shadow:0 0 0 0 rgba(217,154,43,0.55); } 50% { box-shadow:0 0 0 6px rgba(217,154,43,0); } }

      .argo-sync-retry { display:none; flex-shrink:0; align-items:center; padding:4px 11px; border-radius:999px; border:1px solid rgba(192,70,61,0.35); background:rgba(192,70,61,0.08); color:#c0463d; font-size:11px; font-weight:800; letter-spacing:.01em; cursor:pointer; font-family:inherit; }
      .argo-sync-row[data-state="error"] .argo-sync-retry, .argo-sync-row[data-state="slow"] .argo-sync-retry { display:inline-flex; }
      .argo-sync-retry:hover:not(:disabled) { background:rgba(192,70,61,0.16); }
      .argo-sync-retry:disabled { opacity:.55; cursor:not-allowed; }

      .argo-greeting-mute { display:flex; align-items:center; gap:7px; margin-top:14px; font-size:12px; color:var(--text-muted,#475569); cursor:pointer; user-select:none; }
      .argo-greeting-mute input { accent-color:var(--brand-primary,#0091C2); cursor:pointer; flex-shrink:0; }

      .argo-greeting-btns { display:flex; flex-direction:column; gap:9px; margin-top:18px; }
      .argo-greeting-yes { display:flex; align-items:center; justify-content:center; gap:8px; background:linear-gradient(135deg, var(--brand-primary-light,#29ABE2), var(--brand-primary,#0091C2)); color:#fff; border:none; padding:13px; border-radius:12px; font-weight:700; cursor:pointer; font-size:14px; font-family:inherit; box-shadow:0 8px 18px -8px rgba(0,145,194,0.8); transition:transform .15s ease, filter .15s ease; }
      .argo-greeting-yes:hover { filter:brightness(1.07); transform:translateY(-1px); }
      .argo-greeting-no { background:transparent; color:var(--text-muted,#475569); border:1px solid var(--border-ui,#e2e8f0); padding:11px; border-radius:12px; font-weight:600; cursor:pointer; font-size:13.5px; font-family:inherit; }
      .argo-greeting-no:hover { background:rgba(148,163,184,0.12); }
      .argo-greeting-yes:focus-visible, .argo-greeting-no:focus-visible, .argo-greeting-x:focus-visible { outline:3px solid var(--brand-primary-light,#29ABE2); outline-offset:2px; }

      @media (max-width: 420px) { .argo-greeting-content { padding:16px 18px 20px; } .argo-scene { height:172px; } }
      @media (prefers-reduced-motion: reduce) {
        .argo-greeting-box, .argo-ship, .argo-wave, .argo-twinkle, .argo-glint, .argo-sync-row .argo-sync-dot { animation:none !important; }
      }
    </style>
  `;
  document.body.appendChild(wrap);
  // Se a internet cair/voltar enquanto o cartão está aberto, atualiza a
  // mensagem de sincronização na hora (argoRefreshGreeting já verifica
  // sozinho se o cartão está visível antes de mexer em qualquer coisa).
  window.addEventListener('online', argoRefreshGreeting);
  window.addEventListener('offline', argoRefreshGreeting);
  document.addEventListener('keydown', function (e) {
    const modal = document.getElementById('argoGreetingModal');
    if (!modal || !modal.classList.contains('visible')) return;
    if (e.key === 'Escape') { argoDismissGreeting(); return; }
    if (e.key === 'Tab') {
      const items = Array.from(modal.querySelectorAll('button, input[type="checkbox"]')).filter(b => b.offsetParent !== null && !b.disabled);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (!modal.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
}

// Nomes por extenso das etiquetas abreviadas de AGENDA_DATA_INFO (as
// abreviações cabem na grade do calendário, mas no cartão há espaço e ficam
// mais claras por extenso). Etiqueta sem nome aqui aparece como está.
const ARGO_AGENDA_LABEL_NAMES = {
  'CONF.': 'Confraternização Universal', 'FAC.': 'Ponto facultativo', 'S. SEB.': 'São Sebastião',
  'PAG.': 'Pagamento', 'CAR.': 'Carnaval', 'CIN.': 'Quarta-feira de Cinzas', 'PAIX.': 'Sexta-feira da Paixão',
  'TIR.': 'Tiradentes', 'TRAB.': 'Dia do Trabalho', 'CORP.': 'Corpus Christi', '13º SAL.': '13º salário',
  'S. PED.': 'São Pedro', 'B. VIST.': 'Aniversário de Boa Vista', 'IND.': 'Independência',
  'ROR.': 'Dia de Roraima', 'APAR.': 'N. Sra. Aparecida', 'SERV.': 'Dia do Servidor',
  'FIN.': 'Finados', 'REP.': 'Proclamação da República', 'C. NEG.': 'Consciência Negra',
  'CONC.': 'Imaculada Conceição', 'NATAL': 'Natal'
};

function argoAgendaKind(info) {
  const t = (info && info.type) || '';
  if (t.indexOf('feriado') > -1) return 'feriado';
  if (t.indexOf('facultativo') > -1) return 'facultativo';
  if (t.indexOf('pagamento') > -1) return 'pagamento';
  return 'extra';
}

// Etiqueta do dia: bolinha colorida por tipo (feriado / facultativo /
// pagamento / outros) + nome por extenso. Só a cor da bolinha muda, então
// o texto continua legível nos temas claro e escuro.
function argoChipHtml(info) {
  if (!info) return '';
  const name = ARGO_AGENDA_LABEL_NAMES[info.label] || info.label;
  return `<span class="argo-chip argo-chip-${argoAgendaKind(info)}">${escapeHtml(name)}</span>`;
}

function argoEntryHtml(info, note) {
  const chip = argoChipHtml(info);
  const noteHtml = note ? `<div class="argo-note">${escapeHtml(note)}</div>` : '';
  return `<div class="argo-entry">${chip}${noteHtml}</div>`;
}

// Próxima data marcada em AGENDA_DATA_INFO depois de hoje (feriado,
// facultativo, pagamento…). Usada quando o resto da semana está vazio,
// para o cartão não terminar em "nada marcado" sem dizer o que vem depois.
function argoNextMilestone(now) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const keys = Object.keys(AGENDA_DATA_INFO).sort();
  for (const key of keys) {
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const days = Math.round((date - today) / 86400000);
    if (days > 0) return { key, date, days, info: AGENDA_DATA_INFO[key] };
  }
  return null;
}

function argoDayLabel(date, days) {
  const base = AGENDA_WEEKDAY_ABBR[date.getDay()] + ' ' + String(date.getDate()).padStart(2, '0') + '/' + String(date.getMonth() + 1).padStart(2, '0');
  return days === 1 ? 'Amanhã' : base;
}

// Resumo da semana (mesma fonte do card da agenda). Hoje sempre aparece;
// os próximos dias com algo marcado vêm em lista curta (máx. 3). Se o resto
// da semana estiver vazio, mostra o próximo marco do ano com contagem de dias.
function argoGreetingWeekHtml() {
  const now = new Date();
  const summary = (typeof agendaBuildWeekSummary === 'function') ? agendaBuildWeekSummary(now) : null;
  if (!summary) {
    const y = now.getFullYear();
    const msg = y > AGENDA_YEAR
      ? `A agenda de ${AGENDA_YEAR} já terminou e as datas de ${y} ainda não foram cadastradas.`
      : `A agenda ainda não tem datas de ${y} (cobre apenas ${AGENDA_YEAR}).`;
    return `<div class="argo-week-empty" style="margin-top:0;">${msg}</div>`;
  }
  const total = summary.weekEntries.length;
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // "Próximos dias" = só o que ainda vem pela frente; dias da semana que já
  // passaram continuam contando no resumo, mas não são listados como próximos.
  const rest = summary.restEntries.filter(e => e.date > today0);

  const countBadge = total ? `<span class="argo-week-count">${total} ${total === 1 ? 'item' : 'itens'}</span>` : '';
  let html = `<div class="argo-week-head"><span>Resumo da semana</span>${countBadge}</div>`;

  const te = summary.todayEntry;
  html += `<div class="argo-week-today"><span class="argo-week-tag">Hoje</span>` +
    (te ? argoEntryHtml(te.info, te.note) : `<span class="argo-week-empty" style="margin:0;">nada marcado</span>`) +
    `</div>`;

  if (rest.length) {
    const rows = rest.slice(0, 3).map(e => {
      const days = Math.round((e.date - today0) / 86400000);
      return `<li><span class="argo-week-day">${escapeHtml(argoDayLabel(e.date, days))}</span>${argoEntryHtml(e.info, e.note)}</li>`;
    }).join('');
    const more = rest.length > 3 ? `<li class="argo-week-more">+ ${rest.length - 3} na agenda</li>` : '';
    html += `<div class="argo-week-label">Próximos dias</div><ul class="argo-week-list">${rows}${more}</ul>`;
  } else {
    const next = argoNextMilestone(now);
    if (next) {
      const when = next.days === 1 ? 'amanhã' : `em ${next.days} dias`;
      html += `<div class="argo-week-label">Próximo marco</div><ul class="argo-week-list"><li><span class="argo-week-day">${escapeHtml(argoDayLabel(next.date, next.days))}</span><div class="argo-entry">${argoChipHtml(next.info)}<span class="argo-when">${when}</span></div></li></ul>`;
    } else if (!total) {
      html += `<div class="argo-week-empty">Nada marcado para esta semana.</div>`;
    }
  }
  return html;
}

// Estado da sincronização entre aparelhos, a partir das variáveis da agenda.
function argoGreetingSyncState() {
  if (!agendaSyncCode) {
    return { key: 'none', text: 'Sincronização ainda não configurada neste aparelho.' };
  }
  // Sem internet, a sincronização nunca vai responder — antes o cartão ficava
  // preso em "Sincronizando…" e só depois de 8s avisava "está demorando",
  // uma mensagem que soa como se fosse voltar sozinha a qualquer momento.
  // Checar aqui deixa isso claro na hora, sem esperar o timer.
  if (navigator.onLine === false) {
    return { key: 'error', text: 'Você está offline — a sincronização volta assim que a internet voltar.' };
  }
  if (agendaSyncState === 'error') {
    return { key: 'error', text: 'Sem conexão com a sincronização. Confira a internet.' };
  }
  if (agendaSyncState === 'ok' && agendaLastSyncAt) {
    const hh = String(agendaLastSyncAt.getHours()).padStart(2, '0');
    const mm = String(agendaLastSyncAt.getMinutes()).padStart(2, '0');
    return { key: 'ok', text: 'Sincronizado às ' + hh + ':' + mm + ' · anotações em dia' };
  }
  if (Date.now() - argoGreetingShownAt > 8000) {
    return { key: 'slow', text: 'A sincronização está demorando — verifique a internet.' };
  }
  return { key: 'connecting', text: 'Sincronizando anotações…' };
}

// Botão "Tentar de novo" do cartão — só aparece quando a sincronização
// falhou ou está demorando (ver CSS .argo-sync-retry). Reconecta ao mesmo
// código de sincronização já salvo neste aparelho e reinicia a janela de
// espera de 8s antes de voltar a marcar como "demorando".
function argoGreetingSyncRetry() {
  if (!agendaSyncCode || typeof agendaConnectSync !== 'function') return;
  const btn = document.getElementById('argoGreetingSyncRetry');
  if (btn) { btn.disabled = true; btn.textContent = 'Tentando…'; }
  argoGreetingShownAt = Date.now();
  agendaConnectSync(agendaSyncCode, true);
  argoRefreshGreeting();
  clearTimeout(argoGreetingSlowTimer);
  argoGreetingSlowTimer = setTimeout(argoRefreshGreeting, 8100);
  setTimeout(() => {
    if (btn) { btn.disabled = false; btn.textContent = 'Tentar de novo'; }
  }, 2500);
}

// Redesenha o conteúdo do cartão (se estiver aberto). Chamada ao abrir, a
// cada mudança de status da sincronização (agendaSetSyncStatus) e 8s depois
// de abrir, para trocar "Sincronizando…" por um aviso se nada respondeu.
function argoRefreshGreeting() {
  const modal = document.getElementById('argoGreetingModal');
  if (!modal || !modal.classList.contains('visible')) return;

  const week = document.getElementById('argoGreetingWeek');
  if (week) week.innerHTML = argoGreetingWeekHtml();

  const st = argoGreetingSyncState();
  const row = document.getElementById('argoGreetingSync');
  if (row) {
    row.dataset.state = st.key;
    const txt = row.querySelector('.argo-sync-text');
    if (txt) txt.textContent = st.text;
  }

  const label = document.querySelector('#argoGreetingYes .argo-yes-label');
  if (label) label.textContent = agendaSyncCode ? 'Ver agenda e sincronização' : 'Configurar sincronização';
}

// "Não mostrar de novo hoje" — quando marcado, some com o cartão nas
// próximas vezes que o app for desbloqueado no mesmo dia (guardado só
// como uma data em texto simples, sem dado sensível). Reaparece sozinho
// no dia seguinte. O checkbox some desmarcado toda vez que o cartão abre.
function argoGreetingMutedToday() {
  try {
    return localStorage.getItem('argo_greeting_muted_date') === new Date().toDateString();
  } catch (e) {
    return false;
  }
}

function argoGreetingPersistMuteChoice() {
  const chk = document.getElementById('argoGreetingMuteToday');
  if (!chk) return;
  try {
    if (chk.checked) {
      localStorage.setItem('argo_greeting_muted_date', new Date().toDateString());
    } else {
      localStorage.removeItem('argo_greeting_muted_date');
    }
  } catch (e) { /* localStorage indisponível — ignora silenciosamente */ }
}

// Mostra o cartão. Chamada uma vez a cada desbloqueio bem-sucedido (ver
// submit do loginForm, em initAuth).
function argoShowGreeting() {
  // Se o app foi trancado no intervalo entre o login e a abertura do cartão
  // (ex.: "Sair" logo em seguida), não mostra a notificação por cima do login.
  const appRoot = document.getElementById('appRoot');
  if (appRoot && appRoot.dataset.locked === 'true') return;
  argoEnsureGreetingUI();
  const modal = document.getElementById('argoGreetingModal');
  const title = document.getElementById('argoGreetingTitle');
  const dateEl = document.getElementById('argoGreetingDate');
  if (!modal || !title) return;

  title.textContent = argoGreetingWord() + '! Eu sou o Argo';
  if (dateEl) {
    const d = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    dateEl.textContent = d.charAt(0).toUpperCase() + d.slice(1);
  }
  const muteChk = document.getElementById('argoGreetingMuteToday');
  if (muteChk) muteChk.checked = false;

  argoGreetingShownAt = Date.now();
  modal.classList.add('visible');
  argoRefreshGreeting();

  // Já existe um código salvo neste aparelho: conecta a sincronização agora,
  // em segundo plano, para o resumo já sair com as anotações dos outros
  // aparelhos (antes só conectava depois de abrir a aba da agenda).
  if (agendaSyncCode && !agendaUnsubscribe && typeof agendaConnectSync === 'function') {
    agendaConnectSync(agendaSyncCode);
  }
  clearTimeout(argoGreetingSlowTimer);
  argoGreetingSlowTimer = setTimeout(argoRefreshGreeting, 8100);

  const yes = document.getElementById('argoGreetingYes');
  if (yes) setTimeout(() => yes.focus(), 60);
}

function argoDismissGreeting() {
  argoGreetingPersistMuteChoice();
  clearTimeout(argoGreetingSlowTimer);
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  const modal = document.getElementById('argoGreetingModal');
  if (modal) modal.classList.remove('visible');
  if (window.__argoUpdatePending && typeof argoShowUpdateToast === 'function') argoShowUpdateToast();
}

// Botão principal: leva à aba "Agenda Boa Vista 2026" (onde está o card de
// sincronização). Sem código de sincronização, já abre a tela para defini-lo.
function argoOpenAgendaFromGreeting() {
  argoDismissGreeting();
  const chip = document.querySelector('.filter-chip[data-cat="agenda"]');
  if (chip && !chip.classList.contains('active')) chip.click();
  requestAnimationFrame(() => {
    const book = document.getElementById('agendaBook') || document.getElementById('agendaCalendarGrid');
    if (book) {
      // A barra de busca/controles fica fixa no topo; sem essa margem ela
      // cobriria o início do calendário e o card de sincronização.
      const ctrl = document.querySelector('.controls');
      const stuck = ctrl && getComputedStyle(ctrl).position === 'sticky';
      book.style.scrollMarginTop = (stuck ? Math.ceil(ctrl.getBoundingClientRect().height) + 12 : 12) + 'px';
      book.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (!agendaSyncCode && typeof agendaOpenSyncModal === 'function') {
      setTimeout(agendaOpenSyncModal, 350);
    }
  });
}

// Lista única de onde ficam os dados pessoais de usuários atendidos
// (nome, endereço, NIS, fotos e PDFs anexados, anotações de encaminhamento).
// Usada tanto para apagar quanto para fazer backup/restaurar esses dados —
// mantendo as duas operações sempre em sincronia.
const SENSITIVE_DATA_PREFIXES = ['attach_', 'img_', 'note_', 'userdata_', 'gnote_'];
const SENSITIVE_DATA_EXACT_KEYS = ['nota_geral_encaminhamento', 'gnotes_index'];

function isSensitiveDataKey(key) {
  return SENSITIVE_DATA_EXACT_KEYS.includes(key) || SENSITIVE_DATA_PREFIXES.some(p => key.startsWith(p));
}

// Usa safeStorage.get (não localStorage.getItem direto) para que os valores
// aqui já venham DECIFRADOS: tanto para clearAllLocalData() (que só precisa
// das chaves) quanto para exportData(), que cifra o conjunto inteiro de
// novo antes de gravar o arquivo .json de backup (ver exportData).
function collectSensitiveData() {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && isSensitiveDataKey(key)) {
      const value = safeStorage.get(key);
      if (value !== null && value !== undefined) data[key] = value;
    }
  }
  return data;
}

// Apaga do localStorage tudo o que possa conter dados pessoais de usuários
// atendidos (nome, endereço, NIS, fotos e PDFs anexados, anotações de
// encaminhamento). Útil antes de emprestar/devolver um computador
// compartilhado, já que a tela de login NÃO protege esses dados.
function clearAllLocalData() {
  const toRemove = Object.keys(collectSensitiveData());
  if (toRemove.length === 0) {
    alert('Não há dados sensíveis salvos neste navegador.');
    return;
  }
  const ok = confirm(`Isso vai apagar ${toRemove.length} item(ns) salvos neste navegador (nomes, endereços, NIS, anotações e anexos de usuários atendidos).\n\nDica: se ainda não fez backup, use "Backup de anotações" no rodapé antes de apagar. Esta ação não pode ser desfeita.\n\nDeseja continuar?`);
  if (!ok) return;
  toRemove.forEach(key => safeStorage.remove(key));
  alert('Dados sensíveis apagados deste dispositivo.');
  if (typeof render === 'function') render();
}

// A base de dados dos equipamentos (const DATA) foi movida para o
// arquivo data.js, carregado antes deste script (ver index.html) --
// mantida disponivel aqui globalmente, igual a EQUIPE_CRAS_CRISTIANA
// (equipe-cras-cristiana.js). Para editar equipamentos, mexa em data.js.

const ICONS = {
  map: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
  clock: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  phone: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
  star: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  image: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
  info: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  team: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  car: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>',
  folder: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  pen: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  badge: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.9 19.9a9 9 0 1 0-17.8 0"/><circle cx="12" cy="10" r="4"/><rect x="5" y="4" width="14" height="18" rx="2"/></svg>',
  form: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M9 15h6"/><path d="M9 11h6"/></svg>',
  table: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>',
  external: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
  building: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="2" width="16" height="20" rx="1"/><line x1="9" y1="6" x2="9" y2="6.01"/><line x1="15" y1="6" x2="15" y2="6.01"/><line x1="9" y1="10" x2="9" y2="10.01"/><line x1="15" y1="10" x2="15" y2="10.01"/><line x1="9" y1="14" x2="9" y2="14.01"/><line x1="15" y1="14" x2="15" y2="14.01"/><line x1="9" y1="18" x2="15" y2="18"/></svg>',
  layers: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
  activity: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
  filebinary: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><text x="7" y="17" font-size="6" fill="currentColor" stroke="none">10</text><text x="7" y="20" font-size="6" fill="currentColor" stroke="none">01</text></svg>',
  kanban: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>',
  bank: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="3" y1="21" x2="21" y2="21"/><line x1="5" y1="21" x2="5" y2="10"/><line x1="19" y1="21" x2="19" y2="10"/><line x1="12" y1="21" x2="12" y2="10"/><polygon points="12 2 21 8 3 8"/></svg>',
  shield: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><rect x="10" y="12" width="4" height="4" rx="0.5"/><path d="M12 12v-2"/></svg>',
  idcard: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="12" r="2"/><line x1="14" y1="10" x2="19" y2="10"/><line x1="14" y1="14" x2="19" y2="14"/></svg>',
  database: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/></svg>',
  wallet: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>',
  cash: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 9v0"/><path d="M18 15v0"/></svg>',
  barchart: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
  excel: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><line x1="8" y1="13" x2="12" y2="18"/><line x1="12" y1="13" x2="8" y2="18"/></svg>',
  cloud: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>',
  pdf: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><text x="6.5" y="17.5" font-size="6.5" fill="currentColor" stroke="none" font-family="Inter, sans-serif" font-weight="800">PDF</text></svg>',
  police: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="M9.5 12.5l1.8 1.8 3.2-3.6"/></svg>',
  home: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/></svg>',
  tag: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.59 13.41 11 3.83A2 2 0 0 0 9.59 3.24L3 3v6.59a2 2 0 0 0 .59 1.41l9.59 9.59a2 2 0 0 0 2.82 0l4.59-4.59a2 2 0 0 0 0-2.82Z"/><circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" stroke="none"/></svg>',
  food: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 2v7c0 1.1.9 2 2 2h0a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>',
  translate: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h9"/><path d="M9.5 5.5v3.2c0 3.2-2 5.9-4.5 7.3"/><path d="M6.5 12c1.3 1.5 3.3 2.7 6 3.4"/><path d="M12.5 21l4-9 4 9"/><path d="M13.9 18h5.2"/></svg>',
  volume: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  swap: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
  whatsapp: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>',
  calendar: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  mic: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
  copy: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
  plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  trashSmall: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>'
};

// ---------------------------------------------------------------------
// Favoritos / atalhos pessoais: cada técnico marca os equipamentos que
// mais usa no dia a dia, para não precisar navegar pelas categorias
// toda vez. Guardado em localStorage puro (não é dado sensível do
// usuário atendido, então não passa pelo safeStorage cifrado).
// ---------------------------------------------------------------------
const FAVORITES_KEY = 'argo_favorites';

function getFavoriteIds() {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch (e) {
    return new Set();
  }
}

function isFavorite(id) {
  return getFavoriteIds().has(id);
}

function toggleFavorite(id) {
  const set = getFavoriteIds();
  if (set.has(id)) set.delete(id); else set.add(id);
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...set]));
  } catch (e) {
    showImageError(id, 'Não foi possível salvar o favorito (armazenamento indisponível).');
  }
  render();
}

// ---------------------------------------------------------------------
// Ordenar por proximidade: usa a geolocalização do navegador (posição
// atual do dispositivo) e compara com a localização de cada equipamento,
// obtida por geocodificação do endereço cadastrado via Nominatim
// (OpenStreetMap, serviço público e gratuito). Os resultados são
// guardados em cache local, então cada endereço só precisa de internet
// para ser localizado uma vez; depois disso a ordenação funciona mesmo
// offline. É uma ordenação aproximada (depende da precisão do endereço
// cadastrado e do serviço de geocodificação), útil para priorizar rotas
// da Equipe Volante e visitas domiciliares.
// ---------------------------------------------------------------------
const GEOCODE_CACHE_KEY = 'argo_geocode_cache_v1';
let proximityState = { active: false, lat: null, lon: null, loading: false };

// Guardado em memória: renderDistanceBadge() chamava isto uma vez POR CARD
// (JSON.parse do cache inteiro, ~400 vezes por render no modo proximidade).
let _geocodeCacheMemo = null;
function getGeocodeCache() {
  if (_geocodeCacheMemo) return _geocodeCacheMemo;
  try {
    _geocodeCacheMemo = JSON.parse(localStorage.getItem(GEOCODE_CACHE_KEY) || '{}') || {};
  } catch (e) {
    _geocodeCacheMemo = {};
  }
  return _geocodeCacheMemo;
}

function setGeocodeCacheEntry(id, lat, lon) {
  const cache = getGeocodeCache();
  cache[id] = { lat, lon };
  try {
    localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    // Cache é apenas uma otimização; se não puder salvar, segue sem ele.
  }
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function geocodeAddress(address) {
  const q = encodeURIComponent(address.replace(/\s+/g, ' ').trim() + ', Roraima, Brasil');
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${q}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('Falha ao consultar o serviço de geocodificação.');
  const data = await res.json();
  if (!data || !data[0]) return null;
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
}

async function ensureGeocodedFor(items, onProgress) {
  const cache = getGeocodeCache();
  const pending = items.filter(i => !cache[i.id] && i.address);
  for (let idx = 0; idx < pending.length; idx++) {
    const item = pending[idx];
    if (onProgress) onProgress(idx + 1, pending.length);
    try {
      const coords = await geocodeAddress(item.address);
      if (coords) setGeocodeCacheEntry(item.id, coords.lat, coords.lon);
    } catch (e) {
      // Ignora falha pontual num endereço e segue para o próximo.
    }
    // Respeita o limite de uso do Nominatim (no máximo ~1 requisição por segundo).
    if (idx < pending.length - 1) await new Promise(r => setTimeout(r, 1100));
  }
}

function setProximityButtonLabel(text) {
  const btn = document.getElementById('proximityBtn');
  if (!btn) return;
  const label = btn.querySelector('.proximity-label');
  if (label) label.textContent = text;
}

function toggleProximitySort() {
  const btn = document.getElementById('proximityBtn');

  if (proximityState.active) {
    proximityState = { active: false, lat: null, lon: null, loading: false };
    if (btn) {
      btn.setAttribute('aria-pressed', 'false');
      btn.classList.remove('is-active');
    }
    setProximityButtonLabel('Ordenar por proximidade');
    render();
    return;
  }

  if (!navigator.geolocation) {
    alert('Este navegador não permite obter a localização atual.');
    return;
  }

  if (btn) btn.disabled = true;
  setProximityButtonLabel('Localizando...');

  navigator.geolocation.getCurrentPosition(async (pos) => {
    proximityState = { active: true, lat: pos.coords.latitude, lon: pos.coords.longitude, loading: true };

    const activeChip = document.querySelector('.filter-chip.active');
    const cat = activeChip ? activeChip.dataset.cat : 'all';
    const visible = DATA.filter(i => (cat === 'all' || i.cat.includes(cat)) &&
      !i.cat.includes('cas') && !i.cat.includes('cras'));

    await ensureGeocodedFor(visible, (done, total) => {
      setProximityButtonLabel(`Localizando (${done}/${total})...`);
    });

    proximityState.loading = false;
    if (btn) {
      btn.disabled = false;
      btn.setAttribute('aria-pressed', 'true');
      btn.classList.add('is-active');
    }
    setProximityButtonLabel('Mais próximos primeiro');
    render();
  }, () => {
    if (btn) btn.disabled = false;
    setProximityButtonLabel('Ordenar por proximidade');
    alert('Não foi possível obter sua localização. Verifique se a permissão de localização foi concedida ao navegador.');
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
}

function renderDistanceBadge(id) {
  if (!proximityState.active) return '';
  const cache = getGeocodeCache();
  const coords = cache[id];
  if (!coords) return `<span class="distance-badge distance-badge-unknown" title="Não foi possível localizar o endereço cadastrado">${ICONS.map} local não encontrado</span>`;
  const km = haversineKm(proximityState.lat, proximityState.lon, coords.lat, coords.lon);
  const label = km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
  return `<span class="distance-badge">${ICONS.map} ${label}</span>`;
}

const MAX_ATTACH_BYTES = 3.5 * 1024 * 1024;

/* ===================== Cifragem dos dados sensíveis em repouso =====================
   Tudo aqui embaixo cifra/decifra, de forma síncrona (sem depender de
   Promises), o conteúdo salvo sob as chaves sensíveis (attach_/img_/note_/
   userdata_/nota_geral_encaminhamento) antes de gravar no localStorage e ao
   lê-lo de volta. A chave de cifragem (sessionEncKey) é derivada da senha
   do login — ver bloco de Autenticação, no topo do arquivo. */

function bytesToBase64(bytes) {
  // Em blocos: montar a string byte a byte era muito lento em anexos de MB.
  let bin = '';
  const BLOCK = 0x8000;
  for (let i = 0; i < bytes.length; i += BLOCK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + BLOCK));
  }
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// PRNG determinístico e rápido (mulberry32): a partir de uma semente de 32
// bits, gera um fluxo de números pseudoaleatórios sempre igual para a mesma
// semente — é o que transforma "chave + nonce" em um fluxo de bytes de
// cifragem (keystream), de forma totalmente síncrona.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function() {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Mistura um array de bytes numa única semente de 32 bits (hash simples,
// estilo FNV) — usado para combinar a chave da sessão com o nonce de cada
// valor cifrado.
function seedFromBytes(bytes) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Gera "length" bytes pseudoaleatórios a partir da chave da sessão + de um
// nonce aleatório específico deste valor salvo (para que o mesmo texto
// nunca produza o mesmo resultado cifrado duas vezes).
function keystream(length, keyBytes, nonceBytes) {
  const combined = new Uint8Array(keyBytes.length + nonceBytes.length);
  combined.set(keyBytes, 0);
  combined.set(nonceBytes, keyBytes.length);
  // mulberry32 inline. Produz EXATAMENTE os mesmos bytes de antes
  // (Math.floor(rnd() * 256) == os 8 bits mais altos de cada saída de 32
  // bits), então os dados já salvos continuam decifrando normalmente — só
  // que sem uma chamada de função + divisão de ponto flutuante por byte.
  let a = seedFromBytes(combined) >>> 0;
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    out[i] = (t ^ (t >>> 14)) >>> 24;
  }
  return out;
}

function xorBytes(a, b) {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i % b.length];
  return out;
}

// Cifra um texto para guardar no localStorage. Formato salvo:
// "enc1:<nonce em base64>:<texto cifrado em base64>".
function encryptForStorage(plainText) {
  if (!sessionEncKey) {
    console.warn('Argo SUAS: tentativa de salvar dado sensível sem chave de sessão (app trancado?). Dado NÃO foi cifrado.');
    return plainText;
  }
  const nonce = crypto.getRandomValues(new Uint8Array(16));
  const plainBytes = new TextEncoder().encode(plainText == null ? '' : String(plainText));
  const cipherBytes = xorBytes(plainBytes, keystream(plainBytes.length, sessionEncKey, nonce));
  return 'enc1:' + bytesToBase64(nonce) + ':' + bytesToBase64(cipherBytes);
}

// Decifra um valor lido do localStorage. Valores antigos, salvos antes desta
// cifragem existir (ou sem o prefixo "enc1:"), são devolvidos como estão —
// isso permite migrar dados antigos automaticamente: eles continuam sendo
// lidos normalmente e passam a ser salvos já cifrados na próxima edição.
function decryptFromStorage(stored) {
  if (typeof stored !== 'string' || !stored.startsWith('enc1:')) return stored;
  if (!sessionEncKey) return ''; // trancado: sem a senha, não dá para decifrar
  const parts = stored.split(':');
  if (parts.length !== 3) return '';
  try {
    const nonce = base64ToBytes(parts[1]);
    const cipherBytes = base64ToBytes(parts[2]);
    const plainBytes = xorBytes(cipherBytes, keystream(cipherBytes.length, sessionEncKey, nonce));
    return new TextDecoder().decode(plainBytes);
  } catch (e) {
    return '';
  }
}

// Anexos (fotos/PDFs de até 3,5 MB) eram lidos e DECIFRADOS de novo, um por
// um, a cada render() — ou seja, a cada tecla digitada na busca. Agora ficam
// na memória (só enquanto o app está destrancado; lockApp/unlockApp limpam)
// e são descartados sempre que safeStorage.set/remove mexe na chave deles.
const _attachCache = new Map();
function invalidateAttachCache(key) {
  if (typeof key !== 'string') return;
  if (key.startsWith('attach_')) _attachCache.delete(key.slice(7));
  else if (key.startsWith('img_')) _attachCache.delete(key.slice(4));
}

const safeStorage = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      if (v === null) return fallback;
      return isSensitiveDataKey(key) ? decryptFromStorage(v) : v;
    } catch (e) {
      return fallback;
    }
  },
  getJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      const text = isSensitiveDataKey(key) ? decryptFromStorage(raw) : raw;
      if (!text) return fallback;
      return JSON.parse(text);
    } catch (e) {
      return fallback;
    }
  },
  set(key, value) {
    try {
      const toStore = isSensitiveDataKey(key) ? encryptForStorage(value) : value;
      localStorage.setItem(key, toStore);
      invalidateAttachCache(key);
      return true;
    } catch (e) {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
      invalidateAttachCache(key);
      return true;
    } catch (e) {
      return false;
    }
  }
};

// --- Tema claro/escuro ---
// Sem preferência salva, o app segue o tema do sistema operacional
// (nenhum atributo data-theme é aplicado, e o CSS reage via
// prefers-color-scheme). Ao usar o botão de alternância, a escolha
// fica salva e passa a valer mesmo que o sistema mude de tema depois.
const THEME_KEY = 'argo_theme_pref';

function systemPrefersDark() {
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

function getEffectiveTheme() {
  const stored = safeStorage.get(THEME_KEY, null);
  if (stored === 'light' || stored === 'dark') return stored;
  return systemPrefersDark() ? 'dark' : 'light';
}

function updateThemeToggleUI() {
  const btn = document.getElementById('themeToggleBtn');
  if (!btn) return;
  const effective = getEffectiveTheme();
  const sunIcon = btn.querySelector('.icon-sun');
  const moonIcon = btn.querySelector('.icon-moon');
  if (sunIcon) sunIcon.hidden = effective === 'dark';
  if (moonIcon) moonIcon.hidden = effective !== 'dark';
  btn.setAttribute('aria-pressed', effective === 'dark' ? 'true' : 'false');
  btn.title = effective === 'dark' ? 'Mudar para modo claro' : 'Mudar para modo escuro';
}

function applyStoredTheme() {
  const stored = safeStorage.get(THEME_KEY, null);
  if (stored === 'light' || stored === 'dark') {
    document.documentElement.setAttribute('data-theme', stored);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  updateThemeToggleUI();
}

function toggleTheme() {
  const next = getEffectiveTheme() === 'dark' ? 'light' : 'dark';
  safeStorage.set(THEME_KEY, next);
  applyStoredTheme();
}

const BF_HIGHLIGHT_HTML = `
  <div style="margin-top:0.75rem; padding:0.75rem; border-left:3px solid var(--brand-primary); background:rgba(17,94,89,0.06); border-radius:6px; font-size:0.8rem;">
    <strong style="color:var(--brand-primary);">Condicionalidades do Bolsa Família:</strong>
    Frequência escolar: crianças e adolescentes entre 6 e 18 anos incompletos devem ter, no mínimo, 75% de presença nas aulas.
    Educação infantil: para crianças de 4 a 6 anos, a exigência mínima de frequência é de 60%.
  </div>
`;

function stripHtml(html) {
  return String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatInformeDesc(desc) {
  let html = String(desc);

  const labels = [
    '⚠️ Observações técnicas:',
    'Atividades por idade:',
    'Requisitos:',
    'Atividades:',
    'Benefícios:',
    'Canais para solicitação:',
    'Documentos necessários:',
    'Duas formas de solicitação:',
    'Gerar ID Jovem e mais informações:',
    'Link para solicitação:',
    'Site:'
  ];
  labels.forEach(l => {
    html = html.split(l).join('<br><strong>' + l + '</strong>');
  });

  html = html.replace(/\s*•\s*/g, '<br>• ');

  html = html.replace(/(\d+\))\s+/g, '<br>$1 ');

  html = html.replace(/(https?:\/\/[^\s<]+)/g, function(match) {
    const trailingMatch = match.match(/[).,;:!?\]]+$/);
    let url = match;
    let suffix = '';
    if (trailingMatch) {
      suffix = trailingMatch[0];
      url = match.slice(0, match.length - suffix.length);
    }
    return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>' + suffix;
  });

  html = html.replace(/^(<br>)+/, '').replace(/(<br>){2,}/g, '<br>');

  return html;
}

function informeMetaRow(icon, label, value) {
  const raw = value || '';
  let clean = stripHtml(raw).trim();
  if (!clean) return '';

  const naPrefixMatch = raw.match(/^\s*n\/a\s*[-–]\s*([\s\S]+)$/i);
  const display = naPrefixMatch ? naPrefixMatch[1] : raw;

  clean = stripHtml(display).trim();
  if (!clean || clean.toUpperCase() === 'N/A') return '';
  return `<div class="info-group"><span class="info-icon">${icon}</span><div><span class="label-tech">${label}</span>${display}</div></div>`;
}

const CATEGORY_LABELS_PRINT = {
  hospitalar: 'Rede Hospitalar e Atenção Básica', saude: 'Rede de Atenção Psicossocial (RAPS)', tea: 'Rede de Atenção à Pessoa com Deficiência e TEA', social: 'Proteção Social Básica e Especial (SUAS)', educacao: 'Educação Básica',
  juridico: 'Poder Judiciário', conselho: 'Conselho Tutelar (Proteção à Criança e ao Adolescente)', delegacias: 'Segurança Pública (Distritos Policiais)', bancos: 'Rede Bancária e Correspondentes',
  previdencia: 'Previdência Social (INSS)', trabalho: 'Trabalho, Emprego e Renda', habitacao: 'Habitação e Moradia', mobilidade: 'Mobilidade Urbana', interior: 'CRAS/CREAS Interior', informes: 'Programas, Projetos e Serviços',
  cas: 'Registro de Atendimento (CAS)', cras: 'Registro de Atendimento (CRAS)', documentacao: 'Documentação Civil e Fiscal', idoso: 'Pessoa Idosa',
  migracao: 'Serviço de Migração (Política Migratória e Rede de Apoio ao Migrante)', alimentar: 'Segurança Alimentar e Nutricional',
  mulher: 'Rede de Enfrentamento à Violência contra a Mulher', cultura: 'Cultura, Esporte e Lazer', defesacivil: 'Defesa Civil e Situações de Emergência', conselhosdireitos: 'Conselhos Municipais de Direitos'
};

/* IDs dos cards de BPC que usam um guia de impressão próprio, voltado ao
   usuário/família (passo a passo, requisitos, documentos), em vez da Ficha
   de Encaminhamento Técnico padrão (que é voltada ao profissional). Esse
   guia também pode ser gerado em espanhol, por causa do público migrante
   atendido pelo CRAS. */
const BPC_GUIDE_IDS = ['bpc-idoso', 'bpc-pcd', 'recuperacao-senha-inss'];

const BPC_IDOSO_LOGIN_IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAA8oAAAD6CAYAAAB5/b4EAABUhUlEQVR42u3de3hU1aH+8e/ak0wgEEATgwQQApQg1YCaFJsIbSIW0Eq0B9AK2gracmkVbQGPBPorYAvYKtgD4lGwamgVaDV4FKwYqhCqDVYJVgkKQYGgaSIhAwkzyez1+2MmNwj34PX9PA8PZmbP2muv2YN5Z92MtdYiIiIiIiIiIgA4agIRERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERUVAWERERERERUVAWERERERERUVAWEREREREROTkRaoIQC2Bts88ZYwCLtWBCD6jBREREREREFJS/AmG4mSBsQxEZY0PhN/SXG4rOJvSAa13AgwGMtYDBxWIadcibzyU8ByjftY29FYAnhs5JicR6T6cYH8UfFOMLADGd6dMzFu+X5U0NlFP4+hbKAkB0Z/qlJDW0ga+Eol1l+Imic88kYqNPvlhfSRHFpX4gipjuiSR2OE6LVJVTvGsnxbuKKfFFERefQMIFnUnslEDMyZ6zJcoQEREREREF5ZMLxjaUea0F9yC1hysJVpdgDx8kWLUPanzYmkM4tT6sG4CaGrBBMBZwMHiwEZEQ2QYb0QbH2xYnKg7Tpiue6Fg8reMxniisdTBOXRD/jEa0B8p45f7xzH8jAEDyHctZckvSKYbcAMUvzGbsfXn4AC6ezMpFY0j8soSzii2smDWVtRVAQhYLn5xBergBfEU5TBm/ghIgdsgcHv/VUBJOpnGCPrY9PYUJfyoBYsi8bznzhyQcdUxxfi45f3qK3M3lxywqIWMsk2+/mczeMc2e54zLEBERERERBeUTB+O6H1xs8CDBQ6UEygrx/+ctOLCTiNoarA2AYzDGASwGF7c+3IbDNQCGI/ugXQuuCQXTgDHURJyLk9CfNvHpRLTvDRFtMU4ExjrhcdqfncIn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yNdKi/Yo12dOC7XW8rf33+KOvKfYVVmOay3Ylh23bByDDbq0j4ji91fdTFbfFM6JbI1jQvseB12XT6qDBF23fifk81tHEeU5fg+xMS0Z6kVERERERORrH5TruNZSWn2Ql3e+w6I31lBQugvXhBNraC3pMxqZbZxQmLWuJcIxfDOuMyP7DGBsypXERbYCYxqtSx3aCqphUW7bZPS10R5PIiIiIiIicraDMoALmKAlgMuGvR/wxL/y2PKfjyj2/YfD/gBBc3K9zM1Vsy4oN1wMYF1aOx4Gdk1idN90MnpeTKc2HcJx2YIBF4MTjugKyCIiIiIiIvKZBuUjg26NdamqqaG8+iCbPipiRdFmNn20jQOBaoLY0HDqusrRMADaurYu6jZwQr3SxoIJukRHeekZn8DghL5c0eObXBrbhXNbRdM60hsaTm0NGKtwLCIiIiIiIp9/UG4amusSr8Uaw8GaAHsOHaDsQDm7Du2n/FAl+6sPURmo5rBbG5pjbC0RjkOE4yE6wks7byvaR7WhY5t2dGzbgfh2HegU3Z62kZF4rCEYHtptjA3/rXAsIiIiIiIiX9CgfHRotme0dpZCsIiIiIiIiHxlgrKIiIiIiIjIF4mjJhARERERERFRUBYRERERERFRUBYRERERERFRUBYRERERERFRUBYRERERERFRUBYRERERERFRUBYRERERERFRUBYRERERERFRUBYRERERERFRUBYRERERERFRUBYRERERERFRUBYRERERERFRUBYRERERERFRUBYRERERERFRUBYRERERERFRUBYRERERERFRUBYRERERERFRUBYRERERERFRUBYRERERERFRUBYRERERERFRUBYRERERERFRUBYRERERERFRUBYRERERERFRUBYRERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERBWURERERERERUVAWERERERERUVAWERERERERUVAWERERERERUVAWERERERERUVAWERERERERUVAWERERERERUVAWERERERERUVAWERERERERUVAWERERERERUVAWERERERERUVAWERERERERUVAWERERERERUVAWERERERERUVAWERERERERUVAWERERERER+VKIUBOIiIiIiHwx7CmrZtM7n/LWBxVs2+3jo9Jqyg4EqPLXYq3aR756jIHoqAji2nu5IL41fbrGcEmvDqRddC5d4lp/fvWyVh85EREREZHPy6e+AE+v30Pupn28ub1CDSISdlnvDmSldeLGjC6cG+NVUBYRERER+arbU1bNoud28tiaXeotFjleaDVw27DuTLqux2fWy6ygLCIiIiLyGfvdyveZ9/R2BWSRUwzM027szS9HfkNBWURERETkq2LLjgNMffQdDbEWOQOX9e7A/Nsvol/P9grKIiIiIiJfZiv+vpdJf3hbvcgiLRFkDSz6eX9GfbezgrKIiIiIyJfR4tU7mfnH99QQIi1s1o8vZOLwHi1ervZRFhERERFRSBb5Upr5x/dYvHqngrKIiIiIyJfFir/vVUgW+QzC8oq/723RMjX0WkRERETkLNiy4wCDp27UnGSRz4AxsG7+FS22wJd6lEVEREREzoKpj76jkCzyGbE29JlrKQrKIiIiIiIt7Hcr39cWUCKfsTe3V/C7le+3SFkaei0iIiIi0oL2lFVzyU/z1Jss8jkwBt56JJMuca3PqBz1KIuIiIiItKBFz+1USBb5nFgb+gyeKQVlEREREZEW8qkvwGNrdqkhRD5Hj63Zxae+gIKyiIiIiMgXwdPr96g3WeRzZm3os6igLCIiIiLyBZC7aZ8aQeQr8FlUUBYRERERaQF7yqq10rXIF8Sb2yvYU1atoCwiIiIi8nna9M6nagSRr8hnMkLNJyIiIiJy5t76oOJrcqU9ePapCxnodfEHj3iqsoyZ4wtYeqIirr2cHaPg9ze/zmLdOmfAIXVoX34xoDUfF3zAr17czwE1SpPP5KjvdlZQFhERERH5vGzb7fsaXW0NG3L+xvXP633/fHlo3+kcBvZry4ele+mAgnJLfSY19FpEREREpAV8VFqtRhD5inwm1aMsIiIiItICyg4E1AhhE2d9j1/wAVP3nM/s77YnPtIBXzkzp7/O4ktSeXNMLO0jYfqfhjFu67tc9tsPWfCH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rJpN73zKWx9UsG23j49Kqyk7EKDKX6teZ/lKMgaioyKIa+/lgvjW9OkawyW9OpB20bmfWe+xgrKIiIiIiIjICWgfZREREREREREFZREREREREREFZREREREREREFZREREREREREFZREREREREREFZREREREREREFZREREREREREFZREREREREREFZREREREREREFZREREREREREFZREREREREREFZREREREREREFZRERERGRr4iSJ0eTNng4w4c3+vNAwfFftDuH0TPz1XjNtEv2kyVfpHeXnJk5fPY1ClC4aDRDrh7OyLn5BL7M7+lr2Yw+rfc0n+ybPvu2j9CnUERERESkZWTOXM2cQWoHaSkFrNh1M8+/OBSvGuMzpR5lEREREZGzKtQbWbh5AWNHjGT41UOY8EwJUMKKuUspWpfN8OELKADyZ2aTu3kxY0fcyYoSoCKfBbeNZOTw4YwcMZYFm3zNlO+j8MmpjAz3Yo+dm0d5ECBA8armHg+fZ2sOU28ZyZDBw8l+qRzf5sVMuGEkQ64eyfxNR/dd+t7OIfvWkaGe8lsXUNBMVXybFzC2rjd90mIKw8f4NoWvffhIRt62gPyKhnrk7cpl6i2hdhl5f+Ne0zIKFk1g5IghZFw/m3zfydcDXyE5d49kyPDhjLxtMflvL2vooQ4Us2JK+PXDxzJ/fXkoks6dQM7uRmVsns+dq8qbFFu2eTFjRwxn+NUjufPJQnz17+8y8p6dyugRofexwbHeg6N7qPNnZpN/xH2z4o5s8vLnMWL4cBa8cZxr9xWS08w1UVFIzvSx4fOPZcHm5hrr2PdJE6V5zL81/N7eMJWcrT4gQMm6+Uy4IXTukVNyKQ421Gnx+CEMGT6SkZMWU1Bx4nupufun4IFs8nYs5dbh4c/Ea9lkry5g8W0juXNVyTHfzzNmRURERETkjO194ib73VHj7fif1v1ZareEnrFP/fR79o7lO0MH1v7TzvvhIrvNWms/esreNGNjfRkbZ3zP3vHX8HF2m11671N2Z23ds36789EpdlFR0/P6X55ib3p0p/WHf67MW2SXvuW3/len2/FNHp9ub/2fbQ3nWRl+rvafdt4PR9jpdfWrfM7e8cs19a+rP8+hRo/8e5G9af6WI1vAPjXtQbulrr6Vlbay1lpbtNROf2Jno4J22qXTQte/ccb37Ijfb7SV1lpr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';

const BPC_PCD_ACESSIBILIDADE_IMG = 'data:image/png;base64,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';
const RECUPERACAO_SENHA_GOVBR_IMG = 'data:image/png;base64,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H+1Nqwjf08zleUcyi/jT+/Hl3usY7eeZwk0nx44c5NhZTGr4tCbP4wOdzoZByMj7ecMVwnvfrmFzzDK+t/gS1a471z15A78ZFoVX4Q3ct/oIn64/zIbVVlqN9FRF7bSZ8Cgft1rE9O+WsTJhN+tTnNgCw+kx+nJumDKRS1scf2pTLetpbcY1Tz9L4IxvmbF4K7u2xJDi3ZTW3S9l6u3XMjbna74HikuclNR6OTdz1U1P8lGbX/jq53XEJCezYnsBJdjxD4mg86hJjJ90BeM6BZ7s0vbqyT1/nMDBdxex5chO4grDGTL8bDq866sdAGy0mvAYn7ReXLp9tm5kTqwTm28QUe0Gc9vYK7hpTHua6uqgiDQAY/3WveXORv27tmyoutRYSmo2AOHBnu9ZWrDxCHe8FOPxcj3h5fu7c8vo6IauhoiISJ04UjYgtEVEUAPX5OxtSNhX7rXGYFVjbL/w83JQ+rDuwUwZpXAlIiJyPlPAOo2X7uvODSObN3Q1ThjeI4S3H+xFY3w+qYiIyMVEY7BOw9fbyhsP9GB0nzA+m7+XpH25ZOeVnHlGD/L3sdGphT83j4pmyqhohSsREZFGQAHrLFw9JJKrh0Q2dDVERESkkdAlQhEREREPU8ASERER8TAFLBEREREPU8ASERER8TAFLBEREREPU8ASERER8TAFLBEREREPU8ASERER8TAFLBEREREPU8ASERER8TAFLBEREREPU8ASERER8TAFLBEREREPU8ASERER8TAFLBEREREPU8ASERER8TAFLBEREREPU8ASERER8TAFLBEREREPU8ASERER8TAFLBEREREPU8ASERER8TAFLBEREREPU8ASERER8TAFLBEREREPU8ASERER8TAFLBEREREPU8ASERER8TAFLBEREREPszV0BRor04TpC1P4evF+tu3PJb/QdU7lBfra6NIqgNvGtGDy8GYYhocqKiIiIvVOAasWUjMLefCtOFZtPeqxMo/lO1mbmMnaxExmrTjI+4/2xs9bm0dERKQx0iXCGnKbJn/wcLiqaPHmdKZ+sLXOyhcREZG6pYBVQ9N/TWF1HYar475feYgFG4/U+XJERETE83QNqoZmLDlQ7vWYvmG8dn93Qpt4nVO5+9MLuO/VTcTuOnbivQ/n7GFsv/BzKldERETqn3qwaih5f1651696IFwBRIf68K+H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';

const BPC_GUIDE_CONTENT = {
  'bpc-idoso': {
    pt: {
      badge: 'BPC IDOSO',
      title: 'Benefício de Prestação Continuada — Pessoa Idosa',
      intro: 'O BPC Idoso paga 1 salário mínimo por mês a idosos de baixa renda. Não é aposentadoria: não é preciso ter contribuído ao INSS para ter direito.',
      reqLabel: 'Quem tem direito',
      requirements: [
        'Ter 65 anos de idade ou mais',
        'Renda de até ¼ de salário mínimo por pessoa da família (R$ 405,25 em 2026)',
        'Estar inscrito no Cadastro Único (CadÚnico), atualizado há menos de 2 anos',
        'Ter biometria cadastrada (de preferência na Carteira de Identidade Nacional - CIN, ou no Título de Eleitor)'
      ],
      stepsLabel: 'Passo a passo',
      steps: [
        { title: '1. Peça o benefício', desc: 'Acesse o Meu INSS (meu.inss.gov.br ou aplicativo) e toque em "Entrar com gov.br" — ou ligue para a Central 135 (gov.br/inss, ligação gratuita, todos os dias das 7h às 22h). Informe o CPF e responda às perguntas sobre a composição e a renda da família.' },
        { title: '2. Acompanhe o pedido', desc: 'Acompanhe o andamento pela opção "Acompanhar Pedido" no Meu INSS. O INSS pode pedir algum documento complementar dentro de um prazo determinado — fique atento às notificações do aplicativo para não perder o pedido por falta de resposta.' },
        { title: '3. Receba o resultado', desc: 'Se aprovado, o pagamento é feito pelo banco. Se negado, há 30 dias a partir da ciência da decisão para pedir recurso administrativo, pelo próprio Meu INSS ou numa agência do INSS (Conselho de Recursos do Seguro Social - CRPS).' }
      ],
      channelsTitle: 'Como dar entrada',
      channels: [
        { icon: '📱', label: 'Pelo Meu INSS (app ou site)', steps: [
          'Acesse meu.inss.gov.br ou o app Meu INSS',
          'Toque em "Entrar com gov.br"',
          'Informe o CPF',
          'Responda sobre a família e envie'
        ] },
        { icon: '☎️', label: 'Pela Central 135', steps: [
          'Ligue para 135 (grátis, todos os dias, 7h–22h)',
          'Informe o CPF',
          'Responda sobre a família',
          'Anote o número do protocolo'
        ] }
      ],
      channelsNote: 'Depois de pedir: acompanhe pelo "Acompanhar Pedido" no Meu INSS. Aprovado → pagamento pelo Banco. Negado → recurso em até 30 dias.',
      valueLabel: 'Valor e Pagamento',
      value: '1 salário mínimo por mês (R$ 1.621,00 em 2026), pago por por meio de um cartão magnético que é usado apenas para o BPC. O cartão é gratuito e o beneficiário não precisa comprar nenhum serviço ou produto do banco. É possível também receber o pagamento do BPC por meio de conta corrente ou conta-poupança.',
      denialLabel: 'Se o pedido for negado',
      denial: 'É possível recorrer em até 30 dias pelo Meu INSS ou em uma agência do INSS. Persistindo a negativa, procure orientação jurídica gratuita na Defensoria Pública da União (DPU), endereço R. Gen. Penha Brasil, 1262 - São Francisco, Boa Vista - RR',
      contactLabel: 'Onde buscar ajuda',
      crasClarificationLabel: '⚖️ Papel do CRAS x INSS',
      crasClarification: 'O CRAS não analisa, não concede e não paga o BPC — essa é uma atribuição exclusiva do INSS (Instituto Nacional do Seguro Social), por delegação do MDS, conforme o art. 29 da Lei nº 8.742/1993 (LOAS) e o art. 39 do Decreto nº 6.214/2007. O papel do CRAS (art. 6º-C da LOAS; Decreto nº 6.135/2007) é fazer a inclusão e a atualização da família no Cadastro Único (CadÚnico) e orientar sobre o BPC — nunca decidir sobre o benefício.',
      familyComposition: {
        title: 'Composição Familiar e Renda',
        includedLabel: '👨‍👩‍👧‍👦 Quem entra no cálculo da renda per capita',
        includedIntro: 'Art. 20, §1º da Lei 8.742/93 (LOAS) — desde que vivam sob o mesmo teto:',
        included: ['Requerente', 'Cônjuge ou companheiro(a)', 'Pais (ou madrasta/padrasto na ausência deles)', 'Irmãos solteiros', 'Filhos e enteados solteiros', 'Menores tutelados'],
        excludedLabel: 'Quem NÃO entra no cálculo',
        excluded: 'Netos, avós, tios, sobrinhos, primos, genros/noras, cunhados, nem filhos/irmãos/enteados casados, em união estável, divorciados, separados de fato ou viúvos, mesmo que morem na mesma casa.',
        incomeExclusionsLabel: '💵 O que NÃO entra na renda familiar',
        incomeExclusions: 'Outro BPC; benefício previdenciário de até 1 salário mínimo recebido por idoso (65+) ou pessoa com deficiência da família (se houver mais de um, apenas um pode ser descontado); valores de contrato de aprendizagem; bolsa de estágio supervisionado; auxílio financeiro temporário ou indenização por rompimento/colapso de barragem; e o valor do Auxílio-Inclusão e da remuneração de quem o recebe. Qualquer outro valor recebido pela família entra na conta.',
        accumulationLabel: '🔗 Acumulação com outros benefícios',
        accumulation: 'O BPC não pode ser acumulado com outros benefícios da Seguridade Social (ex.: aposentadoria, pensão, seguro-desemprego), mas PODE ser recebido junto com o Bolsa Família — nesse caso, o valor do Bolsa Família entra no cálculo da renda per capita da família, que não pode ultrapassar ¼ do salário mínimo por pessoa.',
        cancellationLabel: '🚫 Cancelamento',
        cancellation: 'Pode ser solicitado voluntariamente pelo próprio beneficiário (ou representante legal) pelo Meu INSS, aplicativo ou telefone 135, quando não desejar mais receber o benefício ou quando a família não atender mais aos critérios; o INSS também pode suspender/cessar de ofício em revisões bienais, por óbito, superação de renda ou irregularidades no CadÚnico.'
      }
    },
    es: {
      badge: 'BPC ANCIANO',
      title: 'Beneficio de Prestación Continuada — Persona Mayor',
      intro: 'El BPC Anciano paga 1 salario mínimo por mes a personas mayores de bajos ingresos. No es una jubilación: no es necesario haber contribuido al INSS para tener derecho.',
      reqLabel: 'Quién tiene derecho',
      requirements: [
        'Tener 65 años de edad o más',
        'Ingreso de hasta ¼ del salario mínimo por persona de la familia (R$ 405,25 en 2026)',
        'Estar inscrito en el Cadastro Único (CadÚnico), actualizado hace menos de 2 años',
        'Tener biometría registrada (preferentemente en la Carteira de Identidade Nacional - CIN, o en el Título de Eleitor)'
      ],
      stepsLabel: 'Paso a paso',
      steps: [
        { title: '1. Solicite el beneficio', desc: 'Acceda al Meu INSS (meu.inss.gov.br o aplicación) y toque en "Entrar com gov.br" — o llame a la Central 135 (gov.br/inss, llamada gratuita, todos los días de 7h a 22h). Informe el CPF, si no sabe el número) y responda a las preguntas sobre la composición y el ingreso familiar.' },
        { title: '2. Siga la solicitud', desc: 'Siga el trámite por la opción "Acompanhar Pedido" en el Meu INSS. El INSS puede pedir algún documento complementario dentro de un plazo determinado — esté atento a las notificaciones de la aplicación para no perder la solicitud por falta de respuesta.' },
        { title: '3. Reciba el resultado', desc: 'Si es aprobado, el pago el Banco. Si es negado, hay 30 días desde la notificación para pedir recurso administrativo, por el propio Meu INSS o en una agencia del INSS (Conselho de Recursos do Seguro Social - CRPS).' }
      ],
      channelsTitle: 'Cómo solicitarlo',
      channels: [
        { icon: '📱', label: 'Por el Meu INSS (app o sitio)', steps: [
          'Acceda a meu.inss.gov.br o la app Meu INSS',
          'Toque en "Entrar com gov.br"',
          'Informe el CPF',
          'Responda sobre la familia y envíe'
        ] },
        { icon: '☎️', label: 'Por la Central 135', steps: [
          'Llame al 135 (gratis, todos los días, 7h–22h)',
          'Informe el CPF',
          'Responda sobre la familia',
          'Anote el número de protocolo'
        ] }
      ],
      channelsNote: 'Después de solicitar: siga el trámite por "Acompanhar Pedido" en el Meu INSS. Aprobado → pago por la Caixa. Negado → recurso en hasta 30 días.',
      valueLabel: 'Valor y Pago',
      value: '1 salario mínimo por mes (R$ 1.621,00 en 2026), sin aguinaldo (13º salário).',
      denialLabel: 'Si la solicitud es negada',
      denial: 'Es posible recurrir dentro de 30 días por el Meu INSS o en una agencia del INSS. Si persiste la negativa, busque orientación jurídica gratuita en la Defensoria Pública da União (DPU), endereço R. Gen. Penha Brasil, 1262 - São Francisco, Boa Vista - RR, 69305-130',
      contactLabel: 'Dónde buscar ayuda',
      crasClarificationLabel: '⚖️ Rol del CRAS x INSS',
      crasClarification: 'El CRAS no analiza, no concede ni paga el BPC — esa es una atribución exclusiva del INSS (Instituto Nacional do Seguro Social), por delegación del MDS, conforme el art. 29 de la Ley nº 8.742/1993 (LOAS) y el art. 39 del Decreto nº 6.214/2007. El papel del CRAS (art. 6º-C de la LOAS; Decreto nº 6.135/2007) es hacer la inclusión y actualización de la familia en el Cadastro Único (CadÚnico) y orientar sobre el BPC — nunca decidir sobre el beneficio.',
    }
  },
  'bpc-pcd': {
    pt: {
      badge: 'BPC PESSOA COM DEFICIÊNCIA',
      title: 'Benefício de Prestação Continuada — Pessoa com Deficiência',
      intro: 'O BPC PCD paga 1 salário mínimo por mês a pessoas com deficiência de baixa renda, de qualquer idade. Não é aposentadoria: não é preciso ter contribuído ao INSS para ter direito.',
      reqLabel: 'Quem tem direito',
      requirements: [
        'Ter deficiência de longo prazo (física, mental, intelectual ou sensorial), de pelo menos 2 anos, que dificulte a participação plena na sociedade',
        'Não há idade mínima',
        'Renda de até ¼ de salário mínimo por pessoa da família (R$ 405,25 em 2026)',
        'Estar inscrito no Cadastro Único (CadÚnico), atualizado há menos de 2 anos',
        'Passar por avaliação médica e social do INSS (perícia biopsicossocial)',
        'Ter biometria cadastrada (de preferência na Carteira de Identidade Nacional - CIN, ou no Título de Eleitor)'
      ],
      stepsLabel: 'Passo a passo',
      steps: [
        { title: '1. Atualize o CadÚnico', desc: 'Vá ao CRAS do seu bairro levando RG ou CIN e CPF de todos os moradores da casa, comprovante de residência atualizado (últimos 3 meses), certidão de nascimento ou casamento e comprovantes de renda de quem trabalha (ou declaração de quem não trabalha). O cadastro precisa estar atualizado há menos de 2 anos — sem isso, o pedido do benefício não avança.' },
        { title: '2. Providencie o laudo médico', desc: 'Peça ao médico um laudo com o CID e a descrição das limitações no dia a dia da pessoa. Quanto mais detalhado o laudo, menor o risco de a perícia do INSS considerar a documentação genérica e pedir complementação.' },
        { title: '3. Peça o benefício', desc: 'Pelo aplicativo ou site Meu INSS (gov.br/meuinss), com login gov.br, ou pelo telefone 135 (ligação gratuita, todos os dias, das 7h às 22h). Informe o CPF e, se possível, anexe o laudo médico digitalizado no próprio Meu INSS.' },
        { title: '4. Compareça à avaliação', desc: 'O INSS agenda uma avaliação médica e social (perícia biopsicossocial), geralmente em datas separadas. Leve o laudo médico original e todos os documentos da família a cada uma das avaliações.' },
        { title: '5. Acompanhe o pedido', desc: 'Acompanhe o andamento pela opção "Acompanhar Pedido" no Meu INSS, respondendo a qualquer exigência dentro do prazo informado, para o pedido não ser arquivado por falta de resposta.' },
        { title: '6. Receba o resultado', desc: 'Se aprovado, o pagamento é feito por meio de um cartão magnético que é usado apenas para o BPC. O cartão é gratuito e o beneficiário não precisa comprar nenhum serviço ou produto do banco. É possível também receber o pagamento do BPC por meio de conta corrente ou conta-poupança. Se negado, há 30 dias a partir da ciência da decisão para pedir recurso administrativo, pelo próprio Meu INSS ou numa agência do INSS (Conselho de Recursos do Seguro Social - CRPS).' }
      ],
      channelsTitle: 'Como dar entrada',
      channelsIntro: 'Antes: CadÚnico atualizado + laudo médico com CID em mãos.',
      channels: [
        { icon: '📱', label: 'Pelo Meu INSS (app ou site)', steps: [
          'Acesse meu.inss.gov.br ou o app Meu INSS',
          'Toque em "Entrar com gov.br"',
          'Informe o CPF',
          'Anexe o laudo médico digitalizado'
        ] },
        { icon: '☎️', label: 'Pela Central 135', steps: [
          'Ligue para 135 (grátis, todos os dias, 7h–22h)',
          'Informe o CPF',
          'Informe que já tem laudo médico',
          'Anote o número do protocolo'
        ] }
      ],
      channelsNote: 'Depois: compareça à avaliação médica e social agendada pelo INSS. Aprovado → pagamento por Banco. Negado → recurso em até 30 dias.',
      valueLabel: 'Valor e Pagamento',
      value: '1 salário mínimo por mês (R$ 1.621,00 em 2026), sem 13º salário. Não é permitido trabalhar formalmente e receber o BPC ao mesmo tempo: quem consegue emprego formal tem direito ao Auxílio-Inclusão (metade do salário mínimo) ou, se não se enquadrar, tem o BPC suspenso enquanto durar o trabalho — nos dois casos, o benefício não é cancelado.',
      denialLabel: 'Se o pedido for negado',
      denial: 'É possível recorrer em até 30 dias pelo Meu INSS ou em uma agência do INSS. Persistindo a negativa, procure orientação jurídica gratuita na Defensoria Pública da União (DPU), endereço: R. Gen. Penha Brasil, 1262 - São Francisco, Boa Vista - RR.',
      contactLabel: 'Onde buscar ajuda',
      crasClarificationLabel: '⚖️ Papel do CRAS x INSS',
      crasClarification: 'O CRAS não analisa, não concede e não paga o BPC — essa é uma atribuição exclusiva do INSS (Instituto Nacional do Seguro Social), por delegação do MDS, conforme o art. 29 da Lei nº 8.742/1993 (LOAS) e o art. 39 do Decreto nº 6.214/2007. O papel do CRAS (art. 6º-C da LOAS; Decreto nº 6.135/2007) é fazer a inclusão e a atualização da família no Cadastro Único (CadÚnico) e orientar sobre o BPC — nunca decidir sobre o benefício.',
      familyComposition: {
        title: 'Composição Familiar e Renda',
        includedLabel: '👨‍👩‍👧‍👦 Quem entra no cálculo da renda per capita',
        includedIntro: 'Art. 20, §1º da Lei 8.742/93 (LOAS) — desde que vivam sob o mesmo teto:',
        included: ['Requerente', 'Cônjuge ou companheiro(a)', 'Pais (ou madrasta/padrasto na ausência deles)', 'Irmãos solteiros', 'Filhos e enteados solteiros', 'Menores tutelados'],
        excludedLabel: 'Quem NÃO entra no cálculo',
        excluded: 'Netos, avós, tios, sobrinhos, primos, genros/noras, cunhados, nem filhos/irmãos/enteados casados, em união estável, divorciados, separados de fato ou viúvos, mesmo que morem na mesma casa.',
        incomeExclusionsLabel: '💵 O que NÃO entra na renda familiar',
        incomeExclusions: 'Outro BPC; benefício previdenciário de até 1 salário mínimo recebido por idoso (65+) ou pessoa com deficiência da família (se houver mais de um, apenas um pode ser descontado); valores de contrato de aprendizagem; bolsa de estágio supervisionado; auxílio financeiro temporário ou indenização por rompimento/colapso de barragem; e o valor do Auxílio-Inclusão e da remuneração de quem o recebe. Qualquer outro valor recebido pela família entra na conta.',
        accumulationLabel: '🔗 Acumulação com outros benefícios',
        accumulation: 'O BPC não pode ser acumulado com outros benefícios da Seguridade Social (ex.: aposentadoria, pensão, seguro-desemprego), mas PODE ser recebido junto com o Bolsa Família — nesse caso, o valor do Bolsa Família entra no cálculo da renda per capita da família, que não pode ultrapassar ¼ do salário mínimo por pessoa.',
        cancellationLabel: '🚫 Cancelamento',
        cancellation: 'Pode ser solicitado voluntariamente pelo próprio beneficiário (ou representante legal) pelo Meu INSS, aplicativo ou telefone 135, quando não desejar mais receber o benefício ou quando a família não atender mais aos critérios; o INSS também pode suspender/cessar de ofício em revisões bienais, por óbito, superação de renda ou irregularidades no CadÚnico.'
      }
    },
    es: {
      badge: 'BPC PERSONA CON DISCAPACIDAD',
      title: 'Beneficio de Prestación Continuada — Persona con Discapacidad',
      intro: 'El BPC PCD paga 1 salario mínimo por mes a personas con discapacidad de bajos ingresos, de cualquier edad. No es una jubilación: no es necesario haber contribuido al INSS para tener derecho.',
      reqLabel: 'Quién tiene derecho',
      requirements: [
        'Tener discapacidad de largo plazo (física, mental, intelectual o sensorial), de al menos 2 años, que dificulte la participación plena en la sociedad',
        'No hay edad mínima',
        'Ingreso de hasta ¼ del salario mínimo por persona de la familia (R$ 405,25 en 2026)',
        'Estar inscrito en el Cadastro Único (CadÚnico), actualizado hace menos de 2 años',
        'Pasar por una evaluación médica y social del INSS (pericia biopsicosocial)',
        'Tener biometría registrada (preferentemente en la Carteira de Identidade Nacional - CIN, o en el Título de Eleitor)'
      ],
      stepsLabel: 'Paso a paso',
      steps: [
        { title: '1. Actualice el CadÚnico', desc: 'Vaya al CRAS de su barrio con el RG o CIN y el CPF de todos los que viven en la casa, comprobante de domicilio actualizado (últimos 3 meses), certificado de nacimiento o matrimonio y comprobantes de ingresos de quien trabaja (o declaración de quien no trabaja). El registro debe estar actualizado hace menos de 2 años — sin eso, la solicitud del beneficio no avanza.' },
        { title: '2. Consiga el informe médico', desc: 'Pida al médico un informe con el CID y la descripción de las limitaciones en el día a día de la persona. Cuanto más detallado el informe, menor el riesgo de que la pericia del INSS lo considere genérico y pida más documentación.' },
        { title: '3. Solicite el beneficio', desc: 'Por la aplicación o sitio Meu INSS (gov.br/meuinss), con inicio de sesión gov.br, o por el teléfono 135 (llamada gratuita, todos los días, de 7h a 22h). Informe el CPF y, si es posible, adjunte el informe médico digitalizado en el propio Meu INSS.' },
        { title: '4. Asista a la evaluación', desc: 'El INSS programa una evaluación médica y social (pericia biopsicosocial), generalmente en fechas separadas. Lleve el informe médico original y todos los documentos de la familia a cada evaluación.' },
        { title: '5. Siga la solicitud', desc: 'Siga el trámite por la opción "Acompanhar Pedido" en el Meu INSS, respondiendo a cualquier exigencia dentro del plazo informado, para que la solicitud no sea archivada por falta de respuesta.' },
        { title: '6. Reciba el resultado', desc: 'Si es aprobado, el pago lo hace el banco. Si es negado, hay 30 días desde la notificación para pedir recurso administrativo, por el propio Meu INSS o en una agencia del INSS (Conselho de Recursos do Seguro Social - CRPS).' }
      ],
      channelsTitle: 'Cómo solicitarlo',
      channelsIntro: 'Antes: CadÚnico actualizado + informe médico con CID a mano.',
      channels: [
        { icon: '📱', label: 'Por el Meu INSS (app o sitio)', steps: [
          'Acceda a meu.inss.gov.br o la app Meu INSS',
          'Toque en "Entrar com gov.br"',
          'Informe el CPF',
          'Adjunte el informe médico digitalizado'
        ] },
        { icon: '☎️', label: 'Por la Central 135', steps: [
          'Llame al 135 (gratis, todos los días, 7h–22h)',
          'Informe el CPF',
          'Informe que ya tiene informe médico',
          'Anote el número de protocolo'
        ] }
      ],
      channelsNote: 'Después: asista a la evaluación médica y social programada por el INSS. Aprobado → pago por el Banco. Negado → recurso en hasta 30 días.',
      valueLabel: 'Valor y Pago',
      value: '1 salario mínimo por mes (R$ 1.621,00 en 2026), sin aguinaldo (13º salário). No está permitido trabajar de forma registrada y recibir el BPC al mismo tiempo: quien consigue empleo formal tiene derecho al Auxílio-Inclusão (mitad del salario mínimo) o, si no cumple los requisitos, tiene el BPC suspendido mientras dure el trabajo — en ambos casos, el beneficio no se cancela.',
      denialLabel: 'Si la solicitud es negada',
      denial: 'Es posible recurrir dentro de 30 días por el Meu INSS o en una agencia del INSS. Si persiste la negativa, busque orientación jurídica gratuita en la Defensoria Pública da União (DPU), endereço: R. Gen. Penha Brasil, 1262 - São Francisco, Boa Vista - RR.',
      contactLabel: 'Dónde buscar ayuda',
      footer: 'Esta guía es solo informativa y no sustituye la atención en el CRAS o en el INSS. Las reglas y valores pueden cambiar — confirme siempre en el CRAS o por el Meu INSS/135.',
      crasClarificationLabel: '⚖️ Rol del CRAS x INSS',
      crasClarification: 'El CRAS no analiza, no concede ni paga el BPC — esa es una atribución exclusiva del INSS (Instituto Nacional do Seguro Social), por delegación del MDS, conforme el art. 29 de la Ley nº 8.742/1993 (LOAS) y el art. 39 del Decreto nº 6.214/2007. El papel del CRAS (art. 6º-C de la LOAS; Decreto nº 6.135/2007) es hacer la inclusión y actualización de la familia en el Cadastro Único (CadÚnico) y orientar sobre el BPC — nunca decidir sobre el beneficio.',
    }
  }
};

BPC_GUIDE_CONTENT['recuperacao-senha-inss'] = {
  pt: {
    badge: 'RECUPERAÇÃO DE SENHA',
    title: 'Recuperação de Senha — Meu INSS / gov.br',
    intro: 'Para acessar o Meu INSS é preciso ter uma conta gov.br. Se você esqueceu a senha, a recuperação é feita diretamente pelo site ou aplicativo gov.br, sem necessidade de ir a uma agência.',
    reqLabel: 'O que ter em mãos',
    requirements: [
      'Número do CPF',
      'Acesso a pelo menos um canal de verificação: e-mail cadastrado, celular cadastrado (SMS), conta em banco credenciado ou o aplicativo gov.br com reconhecimento facial'
    ],
    stepsLabel: 'Passo a passo',
    steps: [
      { title: '1. Acesse o Meu INSS', desc: 'Pelo site meu.inss.gov.br ou pelo aplicativo Meu INSS, baixado na loja de aplicativos do celular.' },
      { title: '2. Clique em "Entrar com gov.br"', desc: 'Essa é a porta de entrada única do governo federal; o Meu INSS não tem login próprio, separado do gov.br.' },
      { title: '3. Digite o CPF e clique em "Avançar"', desc: 'Informe o número do CPF do titular da conta gov.br e avance para a tela de senha.' },
      { title: '4. Clique em "Esqueci minha senha"', desc: 'A opção aparece logo abaixo do campo de senha, na tela de login do gov.br.' },
      { title: '5. Confirme "Não sou um robô"', desc: 'Na tela seguinte (Recuperação de Conta), marque essa verificação de segurança e avance para ver as opções disponíveis.' },
      { title: '6. Escolha a forma de recuperação', desc: 'E-mail cadastrado, SMS para o celular cadastrado, reconhecimento facial pelo aplicativo gov.br, ou validação por conta em banco credenciado.' },
      { title: '7. Crie uma nova senha', desc: 'Siga as instruções apresentadas na tela até concluir a criação da nova senha e conseguir acessar o Meu INSS normalmente.' }
    ],
    channelsTitle: 'Como recuperar a senha',
    channels: [
      { icon: '🌐', label: 'Online (gov.br)', steps: [
        'Acesse gov.br e toque em "Entrar com gov.br"',
        'Informe o CPF e clique em "Avançar"',
        'Clique em "Esqueci minha senha"',
        'Confirme "Não sou um robô" e escolha e-mail, SMS, facial ou banco'
      ] },
      { icon: '🏢', label: 'Presencial (sem nenhum canal cadastrado)', steps: [
        'Vá a uma agência do INSS (Av. Glaycon de Paiva, 86, Mecejana)',
        'Leve documento oficial com foto',
        'Peça a atualização dos dados de contato da conta gov.br',
        'Depois disso, a recuperação online passa a funcionar'
      ] }
    ],
    channelsNote: 'Depois de recuperar, crie uma nova senha e acesse o Meu INSS normalmente.',
    valueLabel: 'Atenção',
    value: 'Sem e-mail, celular cadastrado, banco credenciado ou aplicativo com biometria, a recuperação online não é possível — é necessário atualizar esses dados presencialmente.',
    denialLabel: 'Caso não consiga recuperar online',
    denial: 'Utilize o formulário de atendimento do gov.br ou compareça a uma agência do INSS (Av. Glaycon de Paiva, 86, Mecejana) com documento oficial com foto, para atualizar os dados de contato da conta gov.br.',
    contactLabel: 'Onde buscar ajuda',
    footer: 'Este guia é apenas informativo e não substitui o atendimento no CRAS ou no INSS. Regras e valores podem mudar — confirme sempre no CRAS ou pelo Meu INSS/135.',
    crasClarificationLabel: '⚠️ O CRAS não recupera sua senha',
    crasClarification: 'A senha do Meu INSS/gov.br é administrada exclusivamente pelo governo federal (gov.br) e pelo INSS — órgão responsável pela análise e concessão do BPC e demais benefícios (art. 29 da Lei nº 8.742/1993 – LOAS; art. 39 do Decreto nº 6.214/2007). O CRAS não tem acesso a esse sistema e não pode recuperar ou alterar sua senha; seu papel se limita à inclusão/atualização do Cadastro Único e à orientação sobre direitos (art. 6º-C da LOAS).',
  },
  es: {
    badge: 'RECUPERACIÓN DE CONTRASEÑA',
    title: 'Recuperación de Contraseña — Meu INSS / gov.br',
    intro: 'Para acceder al Meu INSS es necesario tener una cuenta gov.br. Si olvidó la contraseña, la recuperación se hace directamente por el sitio o la aplicación gov.br, sin necesidad de ir a una agencia.',
    reqLabel: 'Qué tener a mano',
    requirements: [
      'Número de CPF',
      'Acceso a por lo menos un canal de verificación: correo electrónico registrado, celular registrado (SMS), cuenta en banco acreditado o la aplicación gov.br con reconocimiento facial'
    ],
    stepsLabel: 'Paso a paso',
    steps: [
      { title: '1. Acceda al Meu INSS', desc: 'Por el sitio meu.inss.gov.br o por la aplicación Meu INSS, descargada en la tienda de aplicaciones del celular.' },
      { title: '2. Haga clic en "Entrar com gov.br"', desc: 'Esa es la puerta de entrada única del gobierno federal; el Meu INSS no tiene inicio de sesión propio, separado del gov.br.' },
      { title: '3. Digite el CPF y haga clic en "Avançar"', desc: 'Informe el número de CPF del titular de la cuenta gov.br y avance a la pantalla de contraseña.' },
      { title: '4. Haga clic en "Esqueci minha senha"', desc: 'La opción aparece justo debajo del campo de contraseña, en la pantalla de inicio de sesión del gov.br.' },
      { title: '5. Confirme "Não sou um robô"', desc: 'En la pantalla siguiente (Recuperación de Cuenta), marque esa verificación de seguridad y avance para ver las opciones disponibles.' },
      { title: '6. Elija la forma de recuperación', desc: 'Correo electrónico registrado, SMS al celular registrado, reconocimiento facial por la aplicación gov.br, o validación por cuenta en banco acreditado.' },
      { title: '7. Cree una nueva contraseña', desc: 'Siga las instrucciones presentadas en la pantalla hasta concluir la creación de la nueva contraseña y poder acceder al Meu INSS normalmente.' }
    ],
    channelsTitle: 'Cómo recuperar la contraseña',
    channels: [
      { icon: '🌐', label: 'En línea (gov.br)', steps: [
        'Acceda a gov.br y toque en "Entrar com gov.br"',
        'Informe el CPF y haga clic en "Avançar"',
        'Haga clic en "Esqueci minha senha"',
        'Confirme "Não sou um robô" y elija correo, SMS, facial o banco'
      ] },
      { icon: '🏢', label: 'Presencial (sin ningún canal registrado)', steps: [
        'Vaya a una agencia del INSS (Av. Glaycon de Paiva, 86, Mecejana)',
        'Lleve documento oficial con foto',
        'Pida la actualización de los datos de contacto de la cuenta gov.br',
        'Después de eso, la recuperación en línea vuelve a funcionar'
      ] }
    ],
    channelsNote: 'Después de recuperarla, cree una nueva contraseña y acceda al Meu INSS normalmente.',
    valueLabel: 'Atención',
    value: 'Sin correo electrónico, celular registrado, banco acreditado o aplicación con biometría, la recuperación en línea no es posible — es necesario actualizar esos datos presencialmente.',
    denialLabel: 'Si no logra recuperarla en línea',
    denial: 'Utilice el formulario de atención del gov.br o comparezca a una agencia del INSS (Av. Glaycon de Paiva, 86, Mecejana) con documento oficial con foto, para actualizar los datos de contacto de la cuenta gov.br.',
    contactLabel: 'Dónde buscar ayuda',
    footer: 'Esta guía es solo informativa y no sustituye la atención en el CRAS o en el INSS. Las reglas y valores pueden cambiar — confirme siempre en el CRAS o por el Meu INSS/135.',
    crasClarificationLabel: '⚠️ El CRAS no recupera su contraseña',
    crasClarification: 'La contraseña del Meu INSS/gov.br es administrada exclusivamente por el gobierno federal (gov.br) y por el INSS — órgano responsable del análisis y la concesión del BPC y demás beneficios (art. 29 de la Ley nº 8.742/1993 – LOAS; art. 39 del Decreto nº 6.214/2007). El CRAS no tiene acceso a ese sistema y no puede recuperar ni cambiar su contraseña; su papel se limita a la inclusión/actualización del Cadastro Único y a la orientación sobre derechos (art. 6º-C de la LOAS).',
  }
};

function cleanPrintField(value, fallback) {
  const raw = value || '';
  const naPrefixMatch = raw.match(/^\s*n\/a\s*[-–]\s*([\s\S]+)$/i);
  const display = naPrefixMatch ? naPrefixMatch[1] : raw;
  const clean = stripHtml(display).trim();
  if (!clean || clean.toUpperCase() === 'N/A') {
    return fallback;
  }
  return display;
}

// Cartão de atalho em destaque (título + descrição + tipo de destino),
// usado pelos painéis CRAS (RMA) e CAS (registros e planilhas).
function renderRegistroTile(l) {
  const url = l.url || '';
  let meta = l.meta;
  if (!meta) {
    if (!/^https?:/i.test(url)) meta = 'Abre sem internet';
    else if (/docs\.google\.com\/forms/i.test(url)) meta = 'Formulário do Google';
    else if (/docs\.google\.com\/spreadsheets/i.test(url)) meta = 'Planilha do Google';
    else if (/drive\.google\.com/i.test(url)) meta = 'Google Drive';
    else meta = 'Link externo';
  }
  return `
    <a class="cras-rma-tile" href="${url}" target="_blank" rel="noopener noreferrer">
      <span class="cras-rma-icon" aria-hidden="true">${ICONS[l.icon] || ICONS.form}</span>
      <span class="cras-rma-text">
        <span class="cras-rma-title">${l.label}</span>
        ${l.desc ? `<span class="cras-rma-desc">${l.desc}</span>` : ''}
        <span class="cras-rma-meta">${meta}</span>
      </span>
      <span class="cras-link-arrow" aria-hidden="true">${ICONS.external}</span>
    </a>
  `;
}

function renderCasCard(i, query) {
  const q = (query || '').toLowerCase();

  function linkRow(label, url, icon) {
    return `
      <a class="cas-link-item" href="${url}" target="_blank" rel="noopener noreferrer">
        ${icon}
        <span>${label}</span>
        <span class="cas-link-arrow" aria-hidden="true">${ICONS.external}</span>
      </a>
    `;
  }

  // Se a busca bater em algum atalho do grupo, mostra só os que baterem
  // (ajuda a achar rápido). Se não bater em nenhum atalho deste grupo —
  // mas o card apareceu porque a busca bateu em outro campo (endereço,
  // descrição, outro grupo de atalhos) — mostra todos os atalhos do
  // grupo em vez de "Nenhum atalho encontrado", que seria enganoso.
  function buildGroup(links) {
    const all = links || [];
    if (!q) return all;
    const matched = all.filter(l => l.label.toLowerCase().includes(q) || (l.desc || '').toLowerCase().includes(q));
    return matched.length ? matched : all;
  }

  const adminRows = buildGroup(i.adminLinks).map(l => linkRow(l.label, l.url, ICONS[l.icon] || ICONS.form)).join('');
  const systemTiles = buildGroup(i.systemLinks).map(renderRegistroTile).join('');
  const driveRows = buildGroup(i.driveLinks).map(l => linkRow(l.label, l.url, ICONS.folder)).join('');
  const mapTiles = buildGroup(i.mapLinks).map(renderRegistroTile).join('');

  const emptyRow = `<div style="padding:0.9rem 1.1rem; color:var(--text-muted); font-size:0.8rem;">Nenhum atalho encontrado.</div>`;

  return `
    <div class="tech-card cas-card">
      <div class="card-top">
        <div style="display:flex; justify-content:space-between; align-items:start;">
          <div style="display:flex; align-items:center; gap:0.55rem;">
            <span class="cas-badge">${ICONS.folder}</span>
            <h2 style="margin:0;">${i.name}</h2>
          </div>
        </div>
        <span class="subtitle">🗂️ Atendimento CAS · Acesso Rápido a Sistemas e Arquivos</span>
      </div>
      <div class="card-body">
        <div class="cas-section-title">${ICONS.map} Informações Gerais</div>
        <div class="info-group"><span class="info-icon">${ICONS.map}</span><div><span class="label-tech">Localização</span>${i.address}</div></div>
        <div class="info-group"><span class="info-icon">${ICONS.clock}</span><div><span class="label-tech">Disponibilidade</span>${i.hours}</div></div>
        <div class="desc-box">
          <span class="label-tech">Escopo do Painel</span>
          ${i.desc}
        </div>

        <div class="cas-section-title">${ICONS.table} Registros e Planilhas (2026)</div>
        <div class="cras-rma-grid cras-rma-grid-pairs">
          ${systemTiles || emptyRow}
        </div>

        <div class="cas-section-title">${ICONS.map} Território</div>
        <div class="cras-rma-grid">
          ${mapTiles || emptyRow}
        </div>

        <div class="cas-section-title">${ICONS.folder} Atalhos</div>
        <div class="cas-groups">
          <div class="cas-group">
            <div class="cas-group-header">Administrativo</div>
            <div class="cas-link-list">
              ${adminRows || emptyRow}
            </div>
          </div>

          <div class="cas-group">
            <div class="cas-group-header">Pastas da Equipe (Google Drive)</div>
            <div class="cas-link-list">
              ${driveRows || emptyRow}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------
// Localizador "Quem atende este bairro?" (aba Registro de Atendimento
// CRAS). Lê a mesma fonte de dados da equipe (EQUIPE_CRAS_CRISTIANA, via
// DATA), ignora acentos e maiúsculas e cobre as duas equipes: técnicos de
// referência (fixedTeam) e Equipe Volante (volanteCoverage).
// ---------------------------------------------------------------------
function crasNormalize(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function crasLookupHtml(raw) {
  const cras = DATA.find(x => x.id === 'atendimento-cras');
  if (!cras) return '';
  const q = crasNormalize(raw);
  // Exige 3+ letras (ou só números, como em "13 de Setembro") para não
  // listar meio mundo enquanto a pessoa ainda está começando a digitar.
  if (!(q.length >= 3 || (q.length >= 2 && /^\d+$/.test(q)))) return '';

  const fixed = (cras.fixedTeam || []).filter(t =>
    String(t.bairros).split(/,| e /).some(b => crasNormalize(b).includes(q))
  );
  const inVolante = crasNormalize(cras.volanteCoverage).includes(q);
  const inCoverage = (cras.fixedCoverage || []).some(b => crasNormalize(b).includes(q));

  const rows = fixed.map(t => `
    <div class="cras-result-row">
      <span class="team-name">${escapeHtml(t.name)}</span>
      <span class="team-role-badge">${escapeHtml(t.role)}</span>
      <span class="cras-result-where">${escapeHtml(t.bairros)}</span>
    </div>`);

  if (inVolante) {
    const names = (cras.volanteTeam || []).map(t => escapeHtml(t.name)).join(', ');
    rows.push(`
    <div class="cras-result-row">
      <span class="team-name">Equipe Volante</span>
      <span class="team-role-badge volante">Itinerante</span>
      <span class="cras-result-where">${names}</span>
    </div>`);
  }

  if (rows.length) return rows.join('');

  return inCoverage
    ? `<div class="cras-lookup-note">Este bairro está na abrangência do CRAS, mas nenhum técnico de referência foi cadastrado para ele. Confirme com a coordenação.</div>`
    : `<div class="cras-lookup-note">Nenhum bairro com esse nome na abrangência deste CRAS. Confira a grafia ou toque em um dos bairros da lista.</div>`;
}

function renderCrasCard(i, query) {
  const q = (query || '').toLowerCase();

  function linkRow(label, url, icon) {
    return `
      <a class="cras-link-item" href="${url}" target="_blank" rel="noopener noreferrer">
        ${icon}
        <span>${label}</span>
        <span class="cras-link-arrow" aria-hidden="true">${ICONS.external}</span>
      </a>
    `;
  }

  // Mesmo princípio do card CAS: se a busca bater em algum atalho do
  // grupo, filtra; se não bater em nenhum (mas o card apareceu por outro
  // motivo), mostra todos em vez de dizer que o grupo está vazio.
  function buildGroup(links) {
    const all = links || [];
    if (!q) return all;
    const matched = all.filter(l => l.label.toLowerCase().includes(q) || (l.desc || '').toLowerCase().includes(q));
    return matched.length ? matched : all;
  }

  // Atalhos de RMA (destaque)
  const municipalRows = buildGroup(i.municipalLinks).map(l => linkRow(l.label, l.url, ICONS[l.icon] || ICONS.form)).join('');
  const federalRows = buildGroup(i.federalLinks).map(l => linkRow(l.label, l.url, ICONS[l.icon] || ICONS.form)).join('');
  // Registro mensal (RMA): atalhos de uso diário ganham destaque próprio,
  // com uma linha explicando o que cada um faz e se abre sem internet.
  const rmaTiles = buildGroup(i.rmaLinks).map(renderRegistroTile).join('');

  // Telefone com toque para ligar (o app desliga a detecção automática
  // de números no iOS via meta format-detection, então o link é explícito).
  const phoneHtml = (i.phones || []).map(p => {
    const digits = String(p).replace(/\D/g, '');
    return digits.length >= 10 ? `<a href="tel:${digits}">${p}</a>` : p;
  }).join(' · ');

  const bairroChips = (i.fixedCoverage || []).map(b =>
    `<button type="button" class="cras-chip" data-bairro="${escapeHtml(b)}" aria-pressed="false">${escapeHtml(b)}</button>`
  ).join('');
  const driveRows = buildGroup(i.driveLinks).map(l => linkRow(l.label, l.url, ICONS.cloud)).join('');

  const emptyRow = `<div style="padding:0.9rem 1.1rem; color:var(--text-muted); font-size:0.8rem;">Nenhum atalho encontrado.</div>`;

  // Mesma lógica de fallback para a equipe técnica: se ninguém bater com
  // a busca, mostra a equipe inteira em vez de "Nenhum técnico encontrado".
  function buildTeam(team, matchFn) {
    const all = team || [];
    if (!q) return all;
    const matched = all.filter(matchFn);
    return matched.length ? matched : all;
  }

  const fixedRows = buildTeam(i.fixedTeam, t =>
    t.name.toLowerCase().includes(q) || t.role.toLowerCase().includes(q) || t.bairros.toLowerCase().includes(q)
  ).map(t => `
    <tr>
      <td><span class="team-name">${t.name}</span></td>
      <td><span class="team-role-badge">${t.role}</span></td>
      <td>${t.bairros}</td>
    </tr>
  `).join('');

  const volanteRows = buildTeam(i.volanteTeam, t =>
    t.name.toLowerCase().includes(q) || t.role.toLowerCase().includes(q)
  ).map(t => `
    <tr>
      <td>
        <span class="team-name">${t.name}</span>
        <small style="color:var(--text-muted); font-size:0.72rem;">${t.note}</small>
      </td>
      <td><span class="team-role-badge volante">${t.role}</span></td>
    </tr>
  `).join('');

  const fixedEmpty = !fixedRows ? `<tr><td colspan="3" style="color:var(--text-muted); text-align:center; padding:1.25rem;">Nenhum técnico encontrado.</td></tr>` : '';
  const volanteEmpty = !volanteRows ? `<tr><td colspan="2" style="color:var(--text-muted); text-align:center; padding:1.25rem;">Nenhum técnico encontrado.</td></tr>` : '';

  const hasTeam = (i.fixedTeam || []).length > 0 || (i.volanteTeam || []).length > 0;

  const teamSection = hasTeam ? `
        <div class="cras-lookup" role="search" aria-label="Buscar técnico por bairro">
          <label class="cras-lookup-label" for="crasBairroInput">Quem atende este bairro?</label>
          <input id="crasBairroInput" class="cras-lookup-input" type="search" placeholder="Digite o bairro, por exemplo: Caimbé" autocomplete="off" autocapitalize="words" enterkeyhint="search">
          <div class="cras-lookup-chips">${bairroChips}</div>
          <div class="cras-lookup-result" id="crasBairroResult" role="status" aria-live="polite"></div>
        </div>

        <div class="team-tables">
          <div class="team-subcard">
            <div class="team-subcard-header fixa">${ICONS.map} Equipe de Referência Territorial</div>
            <div style="overflow-x:auto;">
              <table class="team-table">
                <thead>
                  <tr>
                    <th>Técnico(a)</th>
                    <th>Formação</th>
                    <th>Bairros de Referência</th>
                  </tr>
                </thead>
                <tbody>
                  ${fixedRows || fixedEmpty}
                </tbody>
              </table>
            </div>
          </div>

          <div class="team-subcard">
            <div class="team-subcard-header volante">${ICONS.car} Equipe Volante</div>
            <div class="team-subcard-note" style="border-bottom:none;">${i.volanteDesc || ''}</div>
            <div style="overflow-x:auto;">
              <table class="team-table">
                <thead>
                  <tr>
                    <th>Técnico(a)</th>
                    <th>Formação</th>
                  </tr>
                </thead>
                <tbody>
                  ${volanteRows || volanteEmpty}
                </tbody>
              </table>
            </div>
            <div class="team-subcard-note">
              <strong style="display:block; margin-bottom:0.3rem; color:var(--text-main); font-size:0.7rem; text-transform:uppercase;">Território Volante</strong>
              ${i.volanteCoverage || ''}
            </div>
          </div>
        </div>
  ` : '';

  return `
    <div class="tech-card cras-card">
      <div class="card-top">
        <div style="display:flex; justify-content:space-between; align-items:start;">
          <div style="display:flex; align-items:center; gap:0.55rem;">
            <span class="cras-badge">${ICONS.building}</span>
            <h2 style="margin:0;">${i.name}</h2>
          </div>
        </div>
        <span class="subtitle">🏢 Equipe Técnica e Atendimento CRAS · Sistemas Municipais, Federais e RMA</span>
      </div>
      <div class="card-body">
        <div class="cras-section-title">${ICONS.map} Informações Gerais</div>
        <div class="info-group"><span class="info-icon">${ICONS.map}</span><div><span class="label-tech">Localização</span>${i.address}</div></div>
        <div class="info-group"><span class="info-icon">${ICONS.clock}</span><div><span class="label-tech">Disponibilidade</span>${i.hours}</div></div>
        <div class="info-group"><span class="info-icon">${ICONS.phone}</span><div><span class="label-tech">Contato Técnico</span>${phoneHtml}</div></div>
        <div class="desc-box">
          <span class="label-tech">Escopo do Painel</span>
          ${i.desc}
        </div>

        <div class="cras-section-title">${ICONS.barchart} Registro Mensal (RMA)</div>
        <div class="cras-rma-grid">
          ${rmaTiles || emptyRow}
        </div>

        ${hasTeam ? `<div class="cras-section-title">${ICONS.building} Equipe Técnica</div>` : ''}
        ${teamSection}
        ${i.teamPanelLink ? `<div class="cras-link-list" style="margin-top:0.6rem;">${linkRow(i.teamPanelLink.label, i.teamPanelLink.url, ICONS[i.teamPanelLink.icon] || ICONS.form)}</div>` : ''}

        <div class="cras-section-title">${ICONS.folder} Atalhos e Sistemas</div>
        <div class="cras-groups">
          <div class="cras-group">
            <div class="cras-group-header">Sistemas Municipais e Gestão</div>
            <div class="cras-link-list">
              ${municipalRows || emptyRow}
            </div>
          </div>

          <div class="cras-group">
            <div class="cras-group-header">Sistemas Federais e Bolsa Família</div>
            <div class="cras-link-list">
              ${federalRows || emptyRow}
            </div>
          </div>

          <div class="cras-group">
            <div class="cras-group-header">Nuvens de Arquivos (Google Drive)</div>
            <div class="cras-link-list">
              ${driveRows || emptyRow}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// Contagem por categoria (para os números nos chips da barra lateral) é
// recalculada em TODO render() — ou seja, a cada tecla digitada na busca e a
// cada troca de aba. Como o conjunto de categorias de cada unidade (i.cat)
// nunca muda depois que o app carrega, a varredura das ~370 unidades × ~24
// categorias é sempre o mesmo resultado, refeita à toa. Agora ela roda uma
// única vez (cacheada em _staticChipCounts) e só o total de favoritos, que
// realmente muda com a interação da pessoa, é recalculado a cada chamada.
let _staticChipCounts = null;
function updateChipCounts() {
  if (!_staticChipCounts) {
    const counts = {
      all: DATA.length, hospitalar: 0, saude: 0, tea: 0, social: 0, educacao: 0, juridico: 0,
      conselho: 0, delegacias: 0, bancos: 0, previdencia: 0, trabalho: 0, documentacao: 0, habitacao: 0, mobilidade: 0, informes: 0, cas: 0,
      cras: 0, migracao: 0, alimentar: 0, mulher: 0, cultura: 0, defesacivil: 0, conselhosdireitos: 0
    };
    DATA.forEach(i => {
      if (i.cat.includes('hospitalar')) counts.hospitalar++;
      if (i.cat.includes('saude')) counts.saude++;
      if (i.cat.includes('tea')) counts.tea++;
      if (i.cat.includes('social') || i.cat.includes('idoso')) counts.social++;
      if (i.cat.includes('educacao')) counts.educacao++;
      if (i.cat.includes('juridico')) counts.juridico++;
      if (i.cat.includes('conselho')) counts.conselho++;
      if (i.cat.includes('delegacias')) counts.delegacias++;
      if (i.cat.includes('bancos')) counts.bancos++;
      if (i.cat.includes('previdencia')) counts.previdencia++;
      if (i.cat.includes('trabalho')) counts.trabalho++;
      if (i.cat.includes('documentacao')) counts.documentacao++;
      if (i.cat.includes('migracao')) counts.migracao++;
      if (i.cat.includes('habitacao')) counts.habitacao++;
      if (i.cat.includes('mobilidade')) counts.mobilidade++;
      if (i.cat.includes('informes')) counts.informes++;
      if (i.cat.includes('cas')) counts.cas++;
      if (i.cat.includes('cras')) counts.cras++;
      if (i.cat.includes('alimentar')) counts.alimentar++;
      if (i.cat.includes('mulher')) counts.mulher++;
      if (i.cat.includes('cultura')) counts.cultura++;
      if (i.cat.includes('defesacivil')) counts.defesacivil++;
      if (i.cat.includes('conselhosdireitos')) counts.conselhosdireitos++;
    });
    _staticChipCounts = counts;
  }
  const counts = _staticChipCounts;
  counts.favoritos = getFavoriteIds().size;
  counts.anotacoes = getNotesIndex().length;

  const setCount = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  setCount('count-all', counts.all);
  setCount('count-hospitalar', counts.hospitalar);
  setCount('count-saude', counts.saude);
  setCount('count-tea', counts.tea);
  setCount('count-social', counts.social);
  setCount('count-educacao', counts.educacao);
  setCount('count-juridico', counts.juridico);
  setCount('count-conselho', counts.conselho);
  setCount('count-delegacias', counts.delegacias);
  setCount('count-bancos', counts.bancos);
  setCount('count-previdencia', counts.previdencia);
  setCount('count-trabalho', counts.trabalho);
  setCount('count-documentacao', counts.documentacao);
  setCount('count-migracao', counts.migracao);
  setCount('count-habitacao', counts.habitacao);
  setCount('count-mobilidade', counts.mobilidade);
  setCount('count-informes', counts.informes);
  setCount('count-cas', counts.cas);
  setCount('count-cras-panel', counts.cras);
  setCount('count-mulher', counts.mulher);
  setCount('count-cultura', counts.cultura);
  setCount('count-defesacivil', counts.defesacivil);
  setCount('count-conselhosdireitos', counts.conselhosdireitos);
  setCount('count-favoritos', counts.favoritos);
  setCount('count-anotacoes', counts.anotacoes);
}

// Liga/desliga a busca principal conforme a aba aberta. Ao desligar, limpa o
// texto para que uma pesquisa antiga não volte filtrando a lista quando o
// usuário retornar para uma aba de equipamentos.
const MAIN_SEARCH_PLACEHOLDER = 'Pesquisar por unidade, bairro ou serviço técnico...';
function setMainSearchEnabled(enabled) {
  const input = document.getElementById('mainSearch');
  if (!input) return;
  if (input.disabled === !enabled) return;
  input.disabled = !enabled;
  input.style.opacity = enabled ? '' : '0.55';
  if (enabled) {
    input.placeholder = MAIN_SEARCH_PLACEHOLDER;
  } else {
    input.value = '';
    input.placeholder = 'Busca disponível nas abas de equipamentos';
    const clearBtn = document.getElementById('searchClearBtn');
    if (clearBtn) clearBtn.classList.remove('visible');
  }
}

// --- Montagem da lista em lotes ("rolagem infinita") -----------------------
// Antes, cada render() montava os ~430 cards de uma vez (HTML gigante +
// milhares de campos). Agora só o primeiro lote entra na hora e os demais
// vão sendo anexados conforme a pessoa rola a página (IntersectionObserver).
const GRID_CHUNK_SIZE = 16;
let _gridChunkToken = 0;
let _gridChunkObserver = null;

function cancelPendingGridChunks() {
  _gridChunkToken++;
  if (_gridChunkObserver) { _gridChunkObserver.disconnect(); _gridChunkObserver = null; }
}

function getGridSentinel(grid) {
  let s = document.getElementById('gridSentinel');
  if (!s) {
    s = document.createElement('div');
    s.id = 'gridSentinel';
    s.setAttribute('aria-hidden', 'true');
    s.style.cssText = 'height:1px;width:100%;pointer-events:none;';
    grid.insertAdjacentElement('afterend', s);
  }
  return s;
}

function hydrateAttachImages(root) {
  root.querySelectorAll('img[data-attach-src]:not([src])').forEach(img => {
    const attachId = img.getAttribute('data-attach-src');
    const savedAttach = getAttachment(attachId);
    if (savedAttach && savedAttach.data) img.src = savedAttach.data;
  });
}

function render() {
  cancelPendingGridChunks();
  const query = document.getElementById('mainSearch').value.toLowerCase();
  const cat = document.querySelector('.filter-chip.active').dataset.cat;
  const grid = document.getElementById('grid');
  const resultsInfo = document.getElementById('resultsInfo');

  updateChipCounts();

  const clearBtn = document.getElementById('searchClearBtn');
  if (clearBtn) clearBtn.classList.toggle('visible', query.length > 0);

  if (cat === 'anotacoes') {
    if (resultsInfo) resultsInfo.style.display = 'none';
    const infoBannerEarly = document.getElementById('categoryInfoBanner');
    if (infoBannerEarly) { infoBannerEarly.style.display = 'none'; infoBannerEarly.innerHTML = ''; }
    // Só remonta o painel se ele ainda não estiver na tela. Sem isso, digitar
    // na busca principal (que dispara render() a cada tecla) apagava o texto
    // sendo escrito na anotação e desfazia a anotação selecionada a cada
    // pequena pausa — mesmo problema já corrigido nas abas de painel abaixo.
    if (!document.getElementById('notesRoot')) {
      grid.innerHTML = renderNotesCard();
    }
    return;
  }

  // Abas de painel (ferramentas, e não listas de equipamentos). Cada uma tem um
  // elemento-raiz próprio; se ele JÁ estiver na tela, o painel não é remontado.
  //
  // Correção: antes, qualquer chamada de render() — inclusive a disparada a
  // cada tecla digitada na busca principal — refazia o innerHTML do painel
  // aberto. Isso apagava o texto já digitado no tradutor, zerava a fila de
  // arquivos do "Unificar PDF", destruía e recriava o mapa (piscando a tela e
  // perdendo o zoom) e reiniciava a busca de notícias. Agora a montagem só
  // acontece na primeira vez que a aba é aberta.
  const PANEL_TABS = {
    pdftools: { rootId: 'pdftoolsMergeList', render: renderPdfToolsCard, init: initPdfToolsPanel },
    tradutor: { rootId: 'tradutorInput',     render: renderTranslatorCard, init: initTranslatorPanel },
    noticias: { rootId: 'noticiasList',      render: renderNewsCard,       init: initNewsPanel },
    mapa:     { rootId: 'mapaRedeMapContainer', render: renderMapCard,     init: initMapPanel },
    agenda:   { rootId: 'agendaCalendarGrid', render: renderAgendaCard,    init: initAgendaPanel }
  };

  if (PANEL_TABS[cat]) {
    const panel = PANEL_TABS[cat];
    if (resultsInfo) resultsInfo.style.display = 'none';
    const infoBannerEarly = document.getElementById('categoryInfoBanner');
    if (infoBannerEarly) { infoBannerEarly.style.display = 'none'; infoBannerEarly.innerHTML = ''; }
    // A busca principal procura equipamentos; nas abas de ferramenta ela não
    // tem o que filtrar, então fica desligada em vez de aceitar texto e não
    // fazer nada (cada aba que precisa de filtro tem o seu próprio campo).
    setMainSearchEnabled(false);
    if (!document.getElementById(panel.rootId)) {
      grid.innerHTML = panel.render();
      panel.init();
    }
    return;
  }

  setMainSearchEnabled(true);

  const infoBanner = document.getElementById('categoryInfoBanner');
  if (infoBanner) {
    if (cat === 'saude') {
      infoBanner.style.display = '';
      infoBanner.innerHTML = `
        <span class="cib-title">📘 Rede de Atenção Psicossocial (RAPS) — base legal</span>
        A RAPS foi instituída pela Portaria GM/MS n.º 3.088/2011 (hoje consolidada na Portaria de Consolidação n.º 3/2017, Anexo V), com alterações da Portaria n.º 3.588/2017, para dar efeito à <strong>Lei n.º 10.216/2001</strong>, que protege os direitos das pessoas com transtornos mentais e redirecionou o modelo assistencial para uma lógica comunitária, territorial e antimanicomial.
        <details>
          <summary>Ver os 7 componentes da RAPS e os direitos garantidos por lei</summary>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Componentes da RAPS</strong> (Instrutivo Técnico RAPS/SUS, Ministério da Saúde, 2022):</p>
          <ul>
            <li>Atenção Básica em Saúde (UBS, eSF, Consultório na Rua)</li>
            <li>Atenção Psicossocial Especializada (CAPS e Equipes Multiprofissionais de Saúde Mental)</li>
            <li>Atenção de Urgência e Emergência (SAMU 192, UPA, Sala de Estabilização, Pronto-Socorro)</li>
            <li>Atenção Residencial de Caráter Transitório (Unidades de Acolhimento e Comunidades Terapêuticas)</li>
            <li>Atenção Hospitalar (leitos de saúde mental em Hospital Geral e em hospitais psiquiátricos)</li>
            <li>Estratégias de Desinstitucionalização (Serviços Residenciais Terapêuticos e Programa De Volta para Casa)</li>
            <li>Reabilitação Psicossocial (geração de trabalho e renda)</li>
          </ul>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Direitos garantidos pela Lei n.º 10.216/2001 (art. 2º)</strong>, entre outros: acesso ao melhor tratamento disponível; tratamento com humanidade e respeito; proteção contra abuso e exploração; sigilo das informações; direito à presença médica a qualquer tempo para esclarecer internação involuntária; tratamento pelos meios menos invasivos possíveis; preferência por serviços comunitários de saúde mental.</p>
          <p style="margin:0.6rem 0 0;">A internação psiquiátrica só é indicada quando os recursos extra-hospitalares se mostram insuficientes (art. 4º) e pode ser <em>voluntária</em>, <em>involuntária</em> (a pedido de terceiro, com comunicação obrigatória ao Ministério Público em até 72h) ou <em>compulsória</em> (determinada pela Justiça) — art. 6º.</p>
        </details>
      `;
    } else if (cat === 'hospitalar') {
      infoBanner.style.display = '';
      infoBanner.innerHTML = `
        <span class="cib-title">📘 Fluxo de Atenção à Saúde no SUS — como funciona o encaminhamento (base legal)</span>
        O SUS é organizado em <strong>redes regionalizadas e hierarquizadas</strong> por níveis de complexidade (Lei n.º 8.080/1990, art. 7º, e Decreto n.º 7.508/2011), com a <strong>Rede de Atenção à Saúde - RAS</strong> (Portaria GM/MS n.º 4.279/2010) organizando o cuidado em torno da Atenção Básica como <strong>coordenadora do cuidado</strong> e ordenadora do acesso aos demais serviços.
        <details>
          <summary>Ver os níveis de atenção, o fluxo de referência/contrarreferência e quando procurar cada serviço</summary>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>1) Atenção Primária/Básica (porta de entrada preferencial):</strong> UBS e Equipes de Saúde da Família (eSF). Realiza acolhimento, consultas de rotina, pré-natal, vacinação, curativos, dispensação de medicamentos básicos e acompanhamento de doenças crônicas (hipertensão, diabetes). É aqui que o cidadão deve buscar atendimento em primeiro lugar, exceto em urgência/emergência.</p>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>2) Atenção Secundária (média complexidade):</strong> especialidades médicas (cardiologia, ortopedia, ginecologia etc.), exames de apoio diagnóstico e CAPS. O acesso normalmente depende de <strong>encaminhamento (referência)</strong> feito pela UBS, regulado pela <strong>Central de Regulação</strong> do município/estado, que agenda a vaga conforme fila e prioridade clínica.</p>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>3) Atenção Terciária (alta complexidade):</strong> hospitais de referência, UTI, cirurgias de alta complexidade, oncologia, hemodiálise. O acesso é feito por encaminhamento da atenção secundária ou, em casos graves, direto pela urgência/emergência.</p>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>4) Urgência e Emergência:</strong> <strong>SAMU 192</strong> (atendimento móvel, remoções e primeiros socorros no local); <strong>UPA 24h</strong> (casos de urgência que não exigem internação); <strong>Pronto-Socorro Hospitalar</strong> (casos graves, com possível internação). Nesses pontos não é necessário encaminhamento prévio - o acesso é direto, mediante classificação de risco (Protocolo de Manchester), que define a ordem de atendimento pela gravidade, não por ordem de chegada.</p>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Referência e contrarreferência:</strong> ao encaminhar um paciente para um serviço de maior complexidade (referência), a unidade de origem deve receber de volta as informações do atendimento realizado (contrarreferência), garantindo que a UBS continue coordenando o cuidado. Esse fluxo é formalizado por guias de encaminhamento e, cada vez mais, por prontuário eletrônico integrado (e-SUS APS/PEC).</p>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Cartão Nacional de Saúde (CNS/Cartão SUS):</strong> documento obrigatório para qualquer atendimento no SUS, gerado no primeiro cadastro em uma UBS; identifica o usuário em todos os pontos da rede e viabiliza a regulação e o histórico de atendimentos.</p>
          <p style="margin:0.6rem 0;"><strong>Princípios que orientam o fluxo</strong> (Lei n.º 8.080/1990, art. 7º): <em>universalidade</em> (acesso para todos, sem custo), <em>equidade</em> (prioridade a quem tem maior necessidade, não a quem chega primeiro), <em>integralidade</em> (atendimento das necessidades em todos os níveis) e <em>regionalização/hierarquização</em> (organização por território e complexidade crescente).</p>
        </details>
      `;
    } else if (cat === 'delegacias') {
      infoBanner.style.display = '';
      infoBanner.innerHTML = `
        <span class="cib-title">📘 Segurança Pública — quem procurar em cada situação (base legal)</span>
        A Segurança Pública é dever do Estado e responsabilidade de todos (<strong>Constituição Federal, art. 144</strong>), exercida por órgãos com atribuições distintas: <strong>Polícia Militar</strong> (policiamento ostensivo e preservação da ordem), <strong>Polícia Civil</strong> (investigação e apuração de infrações penais, por meio das Delegacias), <strong>Corpo de Bombeiros Militar</strong> (emergências, incêndios e resgates) e <strong>Guarda Civil Municipal</strong> (proteção de bens, serviços e instalações do município).
        <details>
          <summary>Ver quando ligar para cada número, a diferença entre Distrito Policial e Delegacia Especializada, e como registrar um Boletim de Ocorrência</summary>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Números de emergência (gratuitos, 24h):</strong></p>
          <ul>
            <li><strong>190</strong> - Polícia Militar (ocorrência em andamento, flagrante, pedido de socorro imediato)</li>
            <li><strong>193</strong> - Corpo de Bombeiros (incêndio, resgate, acidente, emergência com risco à vida)</li>
            <li><strong>192</strong> - SAMU (emergência médica)</li>
            <li><strong>180</strong> - Central de Atendimento à Mulher (denúncia de violência doméstica, orientação, sigiloso)</li>
            <li><strong>181</strong> - Disque-Denúncia (denúncia anônima de crimes)</li>
            <li><strong>100</strong> - Disque Direitos Humanos (violações contra crianças, idosos, LGBTQIA+, entre outros)</li>
          </ul>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Distrito Policial (DP) - atendimento por território:</strong> cada DP tem uma circunscrição de bairros definida (ver descrição de cada unidade) e é responsável pelo registro do Boletim de Ocorrência (B.O.) e pela investigação de crimes gerais (furto, roubo, estelionato etc.) cometidos naquele território. Fora do horário de expediente, os casos em flagrante são encaminhados à <strong>Central de Flagrantes</strong>, que funciona 24h.</p>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Delegacia Especializada - atendimento por tipo de crime, não por bairro:</strong> concentra a investigação de um tipo específico de crime, independente de onde ele ocorreu na cidade. Exemplos: <strong>DEAM</strong> (violência doméstica e crimes sexuais contra mulheres), <strong>DPCA/DDIJ</strong> (crimes contra crianças/adolescentes e ato infracional), <strong>DGH</strong> (homicídios e feminicídios). Use a Delegacia Especializada quando o caso se encaixa no seu tipo de atuação; caso contrário, procure o DP do bairro onde o fato ocorreu.</p>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Como registrar um B.O.:</strong> compareça ao DP da circunscrição onde ocorreu o fato (ou à Delegacia Especializada, se for o caso) com documento de identificação; leve, se possível, provas, testemunhas e objetos relacionados ao caso. Em Roraima, o registro também pode ser feito pela <strong>Delegacia Eletrônica</strong> (site da Polícia Civil de RR) para ocorrências sem autor conhecido, como furtos e perda de documentos.</p>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Flagrante x Inquérito:</strong> quando o crime está em andamento ou acabou de ocorrer, a prisão em flagrante pode ser feita por qualquer pessoa (art. 301 do CPP) e formalizada pela Central de Flagrantes; quando o fato já ocorreu e depende de apuração, é instaurado um <strong>inquérito policial</strong>, conduzido pelo delegado, com prazo legal para conclusão e posterior encaminhamento ao Ministério Público.</p>
          <p style="margin:0.6rem 0;"><strong>Quando não é caso de polícia:</strong> conflitos entre vizinhos, cobrança de dívidas e pequenas causas cíveis são resolvidos nos <strong>Juizados Especiais</strong> ou por mediação; violência contra criança/adolescente sem crime consumado pode ser levada primeiro ao <strong>Conselho Tutelar</strong>; emergências médicas sem indício de crime devem acionar o <strong>SAMU (192)</strong> diretamente.</p>
        </details>
      `;
    } else if (cat === 'educacao') {
      infoBanner.style.display = '';
      infoBanner.innerHTML = `
        <span class="cib-title">📘 Bolsa Família — condicionalidade de Educação (base legal)</span>
        O Programa Bolsa Família (PBF), instituído pela <strong>Lei n.º 14.601/2023</strong> e regulamentado pelo <strong>Decreto n.º 12.064/2024</strong>, condiciona a permanência da família no Programa ao cumprimento de compromissos de frequência escolar, além dos de saúde. A gestão das condicionalidades é regulada pela <strong>Portaria MDS n.º 1.058/2025</strong>.
        <details>
          <summary>Ver os percentuais exigidos, o fluxo de acompanhamento e as consequências do descumprimento</summary>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Frequência escolar mínima exigida</strong> (Lei n.º 14.601/2023, art. 10, e Portaria MDS n.º 1.058/2025):</p>
          <ul>
            <li><strong>60%</strong> da carga horária escolar mensal — beneficiários de 4 a 6 anos incompletos</li>
            <li><strong>75%</strong> da carga horária escolar mensal — beneficiários de 6 a 18 anos incompletos que ainda não concluíram a educação básica</li>
          </ul>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Como é acompanhado:</strong> a escola registra a frequência a cada dois meses no <em>Sistema Presença</em> (MEC), a partir da lista de estudantes beneficiários enviada pelo MDS com base no Cadastro Único. As informações são consolidadas no Sistema de Condicionalidades (Sicon) para a gestão do PBF (Portaria Interministerial MEC/MDS n.º 3.789/2004).</p>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Descumprimento não gera corte imediato:</strong> a família é notificada e passa por efeitos graduais (advertência, bloqueio, suspensão e, por fim, cancelamento em caso de reincidência), conforme a Lei n.º 14.601/2023. Famílias em descumprimento devem ser priorizadas para acompanhamento pela rede do SUAS (CRAS/CREAS), com Trabalho Social com Famílias e Territórios voltado a superar as vulnerabilidades que afastam a criança ou adolescente da escola.</p>
        </details>
      `;
    } else if (cat === 'social') {
      infoBanner.style.display = '';
      infoBanner.innerHTML = `
        <span class="cib-title">📘 Proteção Social Básica e Especial — estrutura do SUAS (base legal: LOAS e PNAS)</span>
        A Assistência Social é organizada, desde a <strong>LOAS (Lei n.º 8.742/1993)</strong>, como política de Seguridade Social <strong>não contributiva</strong>, direito do cidadão e dever do Estado. A <strong>PNAS - Política Nacional de Assistência Social (Resolução CNAS n.º 145/2004)</strong> e a <strong>Tipificação Nacional de Serviços Socioassistenciais (Resolução CNAS n.º 109/2009)</strong> organizam a oferta do SUAS em dois níveis de proteção, hierarquizados pela gravidade da situação: a <strong>Proteção Social Básica (PSB)</strong>, ofertada pelo CRAS, e a <strong>Proteção Social Especial (PSE)</strong>, ofertada pelo CREAS e pela rede de acolhimento.
        <details>
          <summary>Ver a diferença entre Proteção Básica e Especial, os serviços de cada uma e como o SUAS é financiado</summary>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Proteção Social Básica (PSB) — unidade de referência: CRAS</strong></p>
          <p style="margin:0.6rem 0 0.3rem 0;">Destinada a famílias e indivíduos em situação de <em>vulnerabilidade social</em> decorrente de pobreza, privação (de renda, acesso a serviços públicos etc.) e/ou fragilização de vínculos afetivos, relacionais e de pertencimento social - mas cujos direitos ainda <strong>não foram violados</strong>, apenas ameaçados. O objetivo é prevenir situações de risco por meio do desenvolvimento de potencialidades e do fortalecimento de vínculos familiares e comunitários. O <strong>CRAS (Centro de Referência de Assistência Social)</strong> é a "porta de entrada" do SUAS: unidade pública estatal, de base municipal, organizada por território de abrangência (bairros de referência), com atendimento gratuito e sem necessidade de encaminhamento formal.</p>
          <ul>
            <li><strong>PAIF</strong> (Serviço de Proteção e Atendimento Integral à Família) - trabalho social com famílias, de oferta obrigatória e continuada em todo CRAS</li>
            <li><strong>SCFV</strong> (Serviço de Convivência e Fortalecimento de Vínculos) - grupos por ciclo de vida: crianças, adolescentes, jovens e idosos</li>
            <li>Serviço de Proteção Social Básica no domicílio para pessoas com deficiência e pessoas idosas</li>
            <li>Cadastro Único e acesso a benefícios e programas (Bolsa Família, BPC, Tarifa Social etc.)</li>
          </ul>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Proteção Social Especial (PSE) — unidades de referência: CREAS e rede de acolhimento</strong></p>
          <p style="margin:0.6rem 0 0.3rem 0;">Destinada a famílias e indivíduos cujos direitos <strong>já foram violados</strong>: violência física, psicológica ou sexual, negligência, abandono, situação de rua, trabalho infantil, cumprimento de medida socioeducativa, entre outras violações. Diferente da PSB, pressupõe que o dano já ocorreu, exigindo acompanhamento especializado, e se subdivide em dois graus conforme o rompimento (ou não) dos vínculos familiares:</p>
          <ul>
            <li><strong>Média Complexidade</strong> (vínculo familiar ainda não rompido) - ofertada pelo <strong>CREAS (Centro de Referência Especializado de Assistência Social)</strong>, com o <strong>PAEFI</strong> (Serviço de Proteção e Atendimento Especializado a Famílias e Indivíduos), abordagem social a pessoas em situação de rua, Serviço de Proteção Social a Adolescentes em Cumprimento de Medida Socioeducativa (Liberdade Assistida e Prestação de Serviços à Comunidade) e o Centro Pop</li>
            <li><strong>Alta Complexidade</strong> (vínculo familiar rompido ou pessoa sem referência familiar) - acolhimento institucional (abrigos, casas-lares, casas de passagem) ou acolhimento familiar, garantindo proteção integral fora do núcleo de origem; conforme o ECA e a NOB-SUAS, é sempre medida <strong>excepcional e provisória</strong>, com prioridade para reintegração familiar</li>
          </ul>
          <p style="margin:0.6rem 0;"><strong>Gestão e financiamento:</strong> o SUAS é cofinanciado de forma tripartite entre União, Estados e Municípios, por meio de pisos de proteção (Piso Básico para a PSB; Pisos de Média e Alta Complexidade para a PSE), regulados pela <strong>NOB-SUAS (Resolução CNAS n.º 33/2012)</strong>. A rede atua de forma <em>intersetorial</em>, articulada com saúde, educação, Conselho Tutelar, Vara da Infância e Juventude, Ministério Público e Defensoria Pública, sempre respeitando o território de abrangência de cada equipamento.</p>
        </details>
        <span class="cib-title" style="margin-top:1rem;">📘 Programa Bolsa Família — regras, benefícios e Regra de Proteção (base legal)</span>
        O PBF, instituído pela <strong>Lei n.º 14.601/2023</strong> e regulamentado pelo <strong>Decreto n.º 12.064/2024</strong>, atende famílias inscritas no <strong>Cadastro Único</strong> com renda mensal por pessoa de até <strong>R$ 218,00</strong> (situação de pobreza), condicionada ao cumprimento dos compromissos de saúde e educação. A entrada não é automática: depende do limite orçamentário do Programa.
        <details>
          <summary>Ver a composição do benefício, o calendário de pagamento e a Regra de Proteção</summary>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Composição do benefício</strong> (Portaria MDS n.º 897/2023):</p>
          <ul>
            <li><strong>Benefício de Renda de Cidadania (BRC):</strong> R$ 142,00 por pessoa da família</li>
            <li><strong>Benefício Primeira Infância (BPI):</strong> + R$ 150,00 por criança de 0 a 7 anos incompletos</li>
            <li><strong>Benefício Variável Familiar (BVF):</strong> + R$ 50,00 por gestante, nutriz (bebê até 6 meses) ou criança/adolescente de 7 a 18 anos incompletos</li>
            <li><strong>Benefício Complementar (BCO):</strong> completa o valor até o piso mínimo de R$ 600,00 por família</li>
          </ul>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Pagamento:</strong> depositado mensalmente pela Caixa Econômica Federal (conta poupança social digital, se a família não tiver conta), em período de 10 dias definido pelo último dígito do NIS do Responsável Familiar. Saque sem taxas, via agências, lotéricas, CAIXA Aqui ou app CAIXA Tem.</p>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Regra de Proteção:</strong> se a renda familiar por pessoa ultrapassa R$ 218,00 mas permanece até <strong>R$ 706,00</strong>, a família não é excluída de imediato — continua recebendo <strong>50% do benefício</strong> por até <strong>18 meses</strong>. Esgotado esse prazo (ou em caso de desligamento voluntário), a família tem <strong>Retorno Garantido</strong> por até 3 anos, caso a renda volte a cair, bastando atualizar o Cadastro Único junto à gestão municipal.</p>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Cadastro sempre atualizado:</strong> mudanças de renda, endereço, telefone ou composição familiar devem ser informadas ao Cadastro Único, que precisa ser atualizado no máximo a cada 2 anos para evitar bloqueios.</p>
          <p style="margin:1rem 0 0.3rem 0;"><strong>📋 Cadastro Único (CadÚnico) — porta de entrada dos programas sociais</strong></p>
          <p style="margin:0.6rem 0 0.3rem 0;">O CadÚnico identifica e caracteriza as famílias de baixa renda do Brasil e é pré-requisito obrigatório para acesso ao Bolsa Família, BPC, Tarifa Social de Energia, Minha Casa Minha Vida, isenção em concursos, ID Jovem, Pé-de-Meia, entre outros. A inscrição e a atualização são gratuitas e feitas presencialmente no CRAS ou posto de atendimento do município.</p>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Faixas de renda per capita mensal</strong> (MDS/SAGICAD, Instrução Normativa SAGICAD n.º 1/2023):</p>
          <ul>
            <li><strong>Pobreza:</strong> até R$ 218,00 por pessoa — faixa prioritária para o Bolsa Família</li>
            <li><strong>Baixa renda:</strong> de R$ 218,01 até meio salário mínimo por pessoa</li>
            <li><strong>Acima de meio salário mínimo:</strong> cadastro permitido apenas quando vinculado a programa ou serviço que exija o CadÚnico (ex.: BPC, Tarifa Social, isenção de taxas)</li>
          </ul>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Identificação e atualização:</strong> desde a Lei n.º 14.534/2023, o CPF é o identificador único do cidadão no Cadastro Único, integrado a bases como Receita Federal e CNIS/INSS. A família deve atualizar o cadastro a cada <strong>2 anos</strong> ou em até <strong>30 dias</strong> após mudanças relevantes (nascimento, óbito, mudança de renda, endereço ou composição familiar), sob pena de bloqueio dos benefícios vinculados.</p>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Consulta pelo cidadão:</strong> o titular pode consultar NIS, código familiar, situação cadastral e datas de atualização pelo app ou site do Cadastro Único (<a href="https://cadunico.dataprev.gov.br/" target="_blank" rel="noopener noreferrer">cadunico.dataprev.gov.br</a>), por Consulta Simples (sem login, com nome completo, data de nascimento, nome da mãe e UF/município) ou por Consulta Completa (com login gov.br nível Bronze, Prata ou Ouro). Dúvidas: Central 121 (ligação gratuita).</p>
          <p style="margin:0.6rem 0;"><strong>Indicadores públicos:</strong> o painel <em>Vis Data</em> (MDS/Cidadania) permite consultar e baixar, por estado, ano e mês, a quantidade de famílias e pessoas cadastradas por faixa de renda no CadÚnico e os dados do Bolsa Família por município.</p>
        </details>
      `;
    } else if (cat === 'conselho') {
      infoBanner.style.display = '';
      infoBanner.innerHTML = `
        <span class="cib-title">📘 Conselho Tutelar — o que é e como atua (base legal: ECA)</span>
        O Conselho Tutelar é um <strong>órgão permanente e autônomo, não jurisdicional</strong>, criado pelo <strong>Estatuto da Criança e do Adolescente (Lei n.º 8.069/1990, arts. 131 a 136)</strong> para zelar pelo cumprimento dos direitos de crianças e adolescentes. Não é um órgão de polícia nem de justiça: ele age em nome da sociedade para proteger, orientar e encaminhar - não julga nem prende ninguém.
        <details>
          <summary>Ver composição, atribuições, o que ele pode fazer e quando procurar</summary>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Composição e mandato</strong> (art. 132 do ECA): cada município deve ter pelo menos um Conselho Tutelar, formado por <strong>5 membros escolhidos pela população local</strong> (não são servidores nomeados) para mandato de <strong>4 anos</strong>, com direito a reconduções ilimitadas mediante novo processo de escolha (redação da Lei n.º 13.824/2019). Para ser conselheiro(a), é preciso ter mais de 21 anos, reconhecida idoneidade moral e residir no município.</p>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Atribuições principais</strong> (art. 136 e art. 95 do ECA): atender crianças, adolescentes e famílias em situação de direitos ameaçados ou violados; aconselhar e orientar pais ou responsáveis; requisitar serviços públicos de saúde, educação, assistência social, previdência, trabalho e segurança quando necessário; encaminhar ao Ministério Público casos que configurem infração administrativa ou penal contra os direitos da criança/adolescente; encaminhar à autoridade judiciária os casos de sua competência; e fiscalizar entidades de atendimento (abrigos, acolhimento institucional etc.).</p>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Medidas que pode aplicar</strong> (art. 101, incisos I a VII, do ECA): encaminhamento aos pais ou responsável mediante termo de responsabilidade; orientação, apoio e acompanhamento temporários; matrícula e frequência obrigatória em escola; inclusão em programas de auxílio à família, criança e adolescente; requisição de tratamento médico, psicológico ou psiquiátrico; inclusão em programa de acolhimento familiar; e, apenas como medida excepcional e provisória, acolhimento institucional. Já em relação aos pais/responsáveis (art. 129), pode determinar encaminhamento a programa de proteção à família, tratamento a usuários de álcool e outras drogas, ou encaminhamento a cursos/programas de orientação.</p>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Quando procurar:</strong> suspeita ou confirmação de violência física, psicológica ou sexual contra criança/adolescente; negligência, abandono ou exploração (inclusive trabalho infantil); evasão escolar; conflitos familiares graves envolvendo menores; adolescente em conflito com a lei que precise de encaminhamento; e qualquer situação em que os direitos previstos no ECA estejam ameaçados ou violados. O atendimento é <strong>gratuito, sigiloso e não exige agendamento</strong> em casos de urgência - por isso os Conselhos Tutelares mantêm plantão 24 horas.</p>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Quando é outro órgão:</strong> crimes já consumados contra crianças/adolescentes (abuso sexual, maus-tratos graves) também devem ser levados à Delegacia de Proteção à Criança e ao Adolescente (DPCA/DDIJ) ou à Polícia; a aplicação de penas ou a decisão sobre guarda, adoção e destituição do poder familiar cabe à Vara da Infância e da Juventude, para onde o Conselho Tutelar encaminha os casos que exigem decisão judicial.</p>
          <p style="margin:0.6rem 0;"><strong>Território de atuação em Boa Vista:</strong> a cidade é dividida em 3 territórios de referência (Conselho Tutelar I, II e III), cada um responsável pelos bairros listados no card correspondente - procure sempre o Conselho do território onde a criança/adolescente mora.</p>
        </details>
      `;
    } else if (cat === 'tea') {
      infoBanner.style.display = '';
      infoBanner.innerHTML = `
        <span class="cib-title">📘 Direitos da Pessoa com Deficiência e do Autista — base legal</span>
        A <strong>Lei Brasileira de Inclusão (LBI, Lei n.º 13.146/2015)</strong> garante o exercício pleno dos direitos das pessoas com deficiência, e a <strong>Lei n.º 12.764/2012 (Lei Berenice Piana)</strong> institui a Política Nacional de Proteção dos Direitos da Pessoa com Transtorno do Espectro Autista, reconhecendo a pessoa com TEA como pessoa com deficiência para todos os efeitos legais - com direito a diagnóstico precoce, atendimento multiprofissional e prioridade de atendimento na rede de serviços listada nesta aba.
      `;
    } else if (cat === 'juridico') {
      infoBanner.style.display = '';
      infoBanner.innerHTML = `
        <span class="cib-title">📘 Acesso à Justiça — base legal</span>
        O acesso à Justiça é direito fundamental (<strong>art. 5º, XXXV, da Constituição Federal</strong>) e, para quem não pode pagar advogado, é garantido gratuitamente pela <strong>Defensoria Pública (art. 134 da CF/88 e Lei Complementar n.º 80/1994)</strong>. Causas de menor complexidade e menor valor podem ser resolvidas de forma mais simples, rápida e sem custas pelos <strong>Juizados Especiais (Lei n.º 9.099/1995)</strong>.
      `;
    } else if (cat === 'documentacao') {
      infoBanner.style.display = '';
      infoBanner.innerHTML = `
        <span class="cib-title">📘 Registro Civil e Documentação — base legal</span>
        A <strong>Lei de Registros Públicos (Lei n.º 6.015/1973)</strong> garante a todo cidadão o direito ao registro civil de nascimento, casamento e óbito, base para obtenção dos demais documentos (RG, CPF, título de eleitor). A 1ª via da certidão de nascimento é <strong>gratuita (Lei n.º 9.534/1997)</strong>, e o CPF é hoje o identificador único do cidadão nas bases dos programas sociais (Lei n.º 14.534/2023).
      `;
    } else if (cat === 'migracao') {
      infoBanner.style.display = '';
      infoBanner.innerHTML = `
        <span class="cib-title">📘 Serviço de Migração — política pública e base legal</span>
        A <strong>Lei de Migração (Lei nº 13.445/2017)</strong> garante à pessoa migrante, em condição de igualdade com o brasileiro, acesso a serviços, programas e benefícios sociais, bens públicos, educação e assistência jurídica integral, vedando qualquer discriminação por nacionalidade. Em Roraima, o atendimento à população migrante e refugiada (majoritariamente venezuelana) é coordenado pela <strong>Operação Acolhida</strong> - resposta federal interministerial instituída pela <strong>Lei nº 13.684/2018</strong> e coordenada pelo Comitê Federal de Assistência Emergencial, que atua em três eixos: <em>Ordenamento</em> (fronteira e documentação), <em>Abrigamento</em> (acolhimento em abrigos) e <em>Interiorização</em> (deslocamento voluntário para outras cidades do país, ampliando acesso a trabalho e reduzindo a pressão sobre os serviços em Roraima).
        <details>
          <summary>Ver os equipamentos específicos, o Cadastro Único para migrantes e a rede de abrigos</summary>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>PTRIG (Posto de Triagem):</strong> unidade de referência para o primeiro atendimento de quem acabou de cruzar a fronteira, reunindo em um só espaço a Polícia Federal (protocolo do Registro Nacional Migratório - CRNM, base do processo de refúgio ou de residência), agências da ONU (ACNUR, OIM, UNICEF, UNFPA) e organizações parceiras (ex.: Fundação Pan-Americana para o Desenvolvimento - PADF). Desde 2023, o PTRIG também conta com posto de atendimento do <strong>Cadastro Único</strong>, permitindo que a família migrante já entre no cadastro que dá acesso ao Bolsa Família, BPC e demais programas sociais antes mesmo de se instalar na cidade. Existem unidades de PTRIG tanto em Boa Vista quanto em Pacaraima (município de fronteira com a Venezuela).</p>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Rede de abrigos:</strong> apoiada pelo ACNUR e geridos por organizações parceiras (ex.: AVSI Brasil, Fraternidade), oferece acomodação, três refeições diárias, saúde básica e apoio à documentação para famílias e indígenas (venezuelanos, em especial dos povos Warao e E'ñepá) enquanto aguardam a interiorização ou a estruturação de vida própria em Boa Vista. O ingresso não é por procura espontânea: acontece por triagem de vulnerabilidade feita no PTRIG, com prioridade para famílias, gestantes, idosos, pessoas com deficiência e crianças/adolescentes desacompanhados.</p>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Interiorização e Centro de Coordenação e Interiorização (CCI):</strong> estratégia de realocação voluntária e segura para outras cidades do país, com quatro modalidades (Institucional, Reunificação Familiar, Reunião Social e Vaga de Emprego Sinalizada). A inscrição e o acompanhamento são feitos no CCI, que reúne também o SINE e cursos de português e qualificação profissional no mesmo espaço.</p>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Base da Operação Acolhida (FT Log Hum):</strong> sede de comando e coordenação logística das Forças Armadas na Operação Acolhida, que planeja as ações executadas nos PTRIGs, nos abrigos e no CCI - não é unidade de atendimento espontâneo ao público.</p>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Encaminhamento a partir do CRAS:</strong> famílias migrantes atendidas no território (com ou sem CRNM definitivo) podem ser inscritas no Cadastro Único e acompanhadas pelo PAIF como qualquer outra família em vulnerabilidade; casos que exijam regularização documental, reunião familiar ou proteção específica devem ser encaminhados ao PTRIG, à Polícia Federal (documentação civil) ou à Defensoria Pública da União (assistência jurídica em migração e refúgio).</p>
        </details>
      `;
    } else if (cat === 'bancos') {
      infoBanner.style.display = '';
      infoBanner.innerHTML = `
        <span class="cib-title">📘 Rede Bancária e Correspondentes — o que são</span>
        Correspondentes bancários e lotéricas são autorizados pelo <strong>Banco Central do Brasil</strong> a prestar, em nome de instituições financeiras, serviços como recebimento de contas, saque de benefícios sociais e abertura de conta simplificada, ampliando o acesso a serviços financeiros em bairros e localidades sem agência bancária própria.
      `;
    } else if (cat === 'previdencia') {
      infoBanner.style.display = '';
      infoBanner.innerHTML = `
        <span class="cib-title">📘 Previdência Social (INSS) — base legal</span>
        O <strong>Regime Geral de Previdência Social (RGPS)</strong>, regulado pela <strong>Lei n.º 8.213/1991</strong>, garante benefícios como aposentadoria, auxílio-doença e pensão por morte a quem contribui. Já o <strong>Benefício de Prestação Continuada (BPC/LOAS)</strong>, previsto no <strong>art. 20 da Lei n.º 8.742/1993</strong>, é assistencial - não exige contribuição - e garante um salário mínimo mensal a idosos (65 anos ou mais) e pessoas com deficiência em situação de baixa renda, mediante avaliação social e médica realizada pelo INSS.
      `;
    } else if (cat === 'trabalho') {
      infoBanner.style.display = '';
      infoBanner.innerHTML = `
        <span class="cib-title">📘 Trabalho, Emprego e Renda — base legal</span>
        A <strong>Consolidação das Leis do Trabalho (CLT, Decreto-Lei n.º 5.452/1943)</strong> regula as relações de trabalho no Brasil, e o <strong>Sistema Nacional de Emprego (SINE), instituído pela Lei n.º 7.998/1990</strong>, oferece à população intermediação de mão de obra, seguro-desemprego e qualificação profissional gratuita.
      `;
    } else if (cat === 'habitacao') {
      infoBanner.style.display = '';
      infoBanner.innerHTML = `
        <span class="cib-title">📘 Habitação e Moradia — base legal</span>
        A moradia é um <strong>direito social garantido pelo art. 6º da Constituição Federal</strong>. O atual Programa Minha Casa, Minha Vida foi reinstituído pela <strong>Lei n.º 14.620/2023</strong>, oferecendo financiamento habitacional com subsídio para famílias de baixa e média renda, organizado em faixas de renda com percentuais de subsídio diferentes para cada faixa - valores e regras são reajustados periodicamente pelo Governo Federal.
      `;
    } else if (cat === 'mobilidade') {
      infoBanner.style.display = '';
      infoBanner.innerHTML = `
        <span class="cib-title">📘 Mobilidade Urbana — base legal</span>
        A <strong>Política Nacional de Mobilidade Urbana (Lei n.º 12.587/2012)</strong> estabelece os princípios e diretrizes para a organização do transporte público e da circulação de pessoas e cargas nas cidades, priorizando os modos coletivos e não motorizados e o direito ao deslocamento com segurança e acessibilidade.
      `;
    } else if (cat === 'alimentar') {
      infoBanner.style.display = '';
      infoBanner.innerHTML = `
        <span class="cib-title">📘 Segurança Alimentar e Nutricional — base legal e como encaminhar</span>
        A alimentação adequada é <strong>direito social (art. 6º da Constituição Federal, incluído pela EC n.º 64/2010)</strong>, regulamentado pela <strong>Lei Orgânica de Segurança Alimentar e Nutricional - LOSAN (Lei n.º 11.346/2006)</strong>, que instituiu o SISAN (Sistema Nacional de Segurança Alimentar e Nutricional) e o CONSEA.
        <details>
          <summary>Ver como funciona o Restaurante Cidadão em Boa Vista e como encaminhar uma família</summary>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Restaurante Cidadão (SETRABES):</strong> programa estadual lançado em julho de 2024 para substituir os antigos Restaurantes Populares, inativos havia mais de dez anos em Roraima. Conta com <strong>6 unidades em Boa Vista</strong>, oferecendo almoço <strong>gratuito</strong>, de segunda a sexta-feira, das 11h às 13h30 (encerra quando as refeições do dia se esgotam), totalizando até 3.500 refeições diárias na capital.</p>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Público prioritário:</strong> pessoas em situação de extrema pobreza, trabalhadores informais e "pequenos trabalhadores" que passam o dia fora de casa, pessoas em situação de rua, idosos e mulheres chefes de família que não conseguem, por algum motivo, alcançar o direito à alimentação saudável.</p>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Como funciona o acesso:</strong> não é balcão de porta aberta - a família precisa passar por um <strong>cadastro prévio junto à SETRABES</strong> (Secretaria do Trabalho e Bem-Estar Social), que analisa o perfil socioeconômico e vincula a pessoa à unidade mais próxima do seu bairro. Cada unidade atende um conjunto específico de bairros de referência (ver em cada card abaixo).</p>
          <p style="margin:0.6rem 0;"><strong>Papel do CRAS:</strong> como o programa é estadual (SETRABES), o encaminhamento técnico do CRAS costuma se dar por orientação e, quando necessário, contato com a coordenação do Restaurante Cidadão ou com o CEAC (Centro de Atendimento ao Cidadão, aba Assistência Social), que reúne outros benefícios eventuais da SETRABES (Cesta da Família, Colo de Mãe) - úteis como complemento em casos de insegurança alimentar mais estrutural, além do encaminhamento ao Cadastro Único.</p>
          <p style="margin:0.4rem 0 0; font-size:0.72rem; color:var(--text-muted);">Fontes: SETRABES Roraima (setrabes.rr.gov.br) e Folha BV (folhabv.com.br), 2024-2025.</p>
        </details>
        <details>
          <summary>Ver o PAA e os equipamentos de abastecimento popular (feiras e mercados)</summary>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>PAA (Programa de Aquisição de Alimentos):</strong> executado em Boa Vista pela Secretaria Municipal de Agricultura e Assuntos Indígenas (SMAAI) em parceria com a Conab e o MDS, compra alimentos de agricultores familiares e doa a entidades socioassistenciais cadastradas pelo Conselho Municipal de Assistência Social - não é atendimento direto ao cidadão, e sim apoio a instituições da rede.</p>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Feiras e mercados públicos</strong> (Feira do Produtor Rural, Feira do Passarão e Mercado Municipal Romeu Caldas de Magalhães) não são programas de assistência social, mas funcionam como equipamentos de abastecimento popular, ampliando o acesso a alimentos frescos a preços mais baixos - úteis como referência de orientação técnica em quadros de insegurança alimentar leve ou moderada.</p>
          <p style="margin:0.4rem 0 0; font-size:0.72rem; color:var(--text-muted);">Fontes: Prefeitura de Boa Vista (SMAAI/Semuc), Governo de Roraima (Seadi) e Conab, 2023-2026.</p>
        </details>
      `;
    } else if (cat === 'informes') {
      infoBanner.style.display = '';
      infoBanner.innerHTML = `
        <span class="cib-title">📘 Programas, Projetos e Serviços — o que reúne esta aba</span>
        Esta aba reúne benefícios, tarifas sociais, projetos municipais e serviços que complementam o trabalho do CRAS dentro do SUAS: não são, isoladamente, "a" Política de Assistência Social, mas sim <strong>portas de acesso a direitos</strong> que o técnico pode identificar durante o atendimento e encaminhar a família para buscar, cada um com regras, órgão responsável e documentação próprios.
        <details>
          <summary>Ver os tipos de programas, projetos e serviços reunidos nesta aba</summary>
          <ul>
            <li><strong>Benefícios assistenciais e de transferência de renda:</strong> BPC Idoso, BPC Pessoa com Deficiência, BPC na Escola.</li>
            <li><strong>Tarifas e descontos sociais:</strong> Tarifa Social de Energia, Tarifa Social de Água (CAER), Siga Antenado.</li>
            <li><strong>Acesso a bens e insumos básicos:</strong> Cadeiras de Rodas, Muletas e Próteses, Farmácia Popular, Dignidade Menstrual, Gás do Povo (ex-Auxílio Gás).</li>
            <li><strong>Serviços de convivência e projetos municipais:</strong> SCFV, Projeto ArtCanto, Programa Dedo Verde, Programa Rumo Certo, Projeto Cabelos de Prata.</li>
            <li><strong>Acompanhamento especializado:</strong> Primeira Infância no SUAS / Criança Feliz, Acessuas Trabalho.</li>
            <li><strong>Documentos e carteiras de direito:</strong> Carteira do Idoso, Carteira do Autista (CIPTEA).</li>
          </ul>
          <p style="margin:0.6rem 0 0;">Cada card traz os critérios de acesso, onde solicitar e a documentação exigida, para orientar a família com precisão já no momento do atendimento.</p>
        </details>
      `;
    } else if (cat === 'mulher') {
      infoBanner.style.display = '';
      infoBanner.innerHTML = `
        <span class="cib-title">📘 Rede de Enfrentamento à Violência contra a Mulher — base legal e fluxo</span>
        A <strong>Lei Maria da Penha (Lei n.º 11.340/2006)</strong> criou mecanismos para coibir a violência doméstica e familiar contra a mulher, prevendo medidas protetivas de urgência, atendimento policial especializado e uma rede intersetorial de acolhimento e proteção.
        <details>
          <summary>Ver a rede de atendimento em Boa Vista e como funciona o fluxo de proteção</summary>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Casa da Mulher Brasileira:</strong> equipamento de referência que reúne, num só local, acolhimento e triagem, apoio psicossocial, alojamento de passagem, promoção de autonomia econômica, DEAM, Juizado Especializado, Ministério Público e Defensoria Pública — a mulher pode comparecer diretamente, sem agendamento, 24 horas por dia.</p>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>DEAM (Delegacia Especializada de Atendimento à Mulher):</strong> investiga e registra ocorrências de violência doméstica, familiar e crimes contra a dignidade sexual, funcionando na própria sede da Casa da Mulher Brasileira.</p>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>180 - Central de Atendimento à Mulher:</strong> canal gratuito e sigiloso para denúncia e orientação, disponível 24h (ver também a aba Segurança Pública).</p>
          <p style="margin:0.6rem 0 0.3rem 0;">A rede também conta com a <strong>Patrulha Maria da Penha</strong> (Guarda Civil Municipal), que fiscaliza o cumprimento de medidas protetivas de urgência, e com o <strong>Núcleo de Defesa da Mulher</strong> da Defensoria Pública e a <strong>Promotoria de Defesa da Mulher</strong> do Ministério Público, ambos referenciados na aba Poder Judiciário.</p>
          <p style="margin:0.6rem 0;">No atendimento do CRAS, identificado o risco, a orientação é sempre priorizar o acolhimento imediato na Casa da Mulher Brasileira ou o acionamento do 180/190, além do encaminhamento para acompanhamento do PAIF/PAEFI.</p>
        </details>
      `;
    } else if (cat === 'cultura') {
      infoBanner.style.display = '';
      infoBanner.innerHTML = `
        <span class="cib-title">📘 Cultura, Esporte e Lazer — apoio ao fortalecimento de vínculos</span>
        Atividades culturais, esportivas e de lazer são parte reconhecida do <strong>Serviço de Convivência e Fortalecimento de Vínculos (SCFV)</strong> e da Proteção Social Básica, ajudando a prevenir situações de risco e a fortalecer vínculos familiares e comunitários (Tipificação Nacional de Serviços Socioassistenciais - Resolução CNAS n.º 109/2009).
        <details>
          <summary>Ver os equipamentos e projetos reunidos nesta aba</summary>
          <ul>
            <li><strong>SESI e SESC:</strong> entidades do "Sistema S" com atividades culturais, esportivas e de lazer abertas à comunidade, além de cursos de qualificação.</li>
            <li><strong>Projeto ArtCanto:</strong> canto coral infantojuvenil com acompanhamento social, pedagógico e musical para crianças e adolescentes em vulnerabilidade social.</li>
            <li><strong>SCFV:</strong> oficinas, esporte e lazer, e orientação psicossocial e pedagógica para crianças, adolescentes e famílias.</li>
            <li><strong>Projeto Cabelos de Prata:</strong> atividades recreativas voltadas ao envelhecimento saudável da pessoa idosa.</li>
          </ul>
          <p style="margin:0.6rem 0 0;">Esses encaminhamentos costumam funcionar como contraturno escolar ou atividade complementar ao acompanhamento técnico do CRAS - vale conferir os requisitos de cada um na aba "Programas, Projetos e Serviços" ou em "Trabalho, Emprego e Renda".</p>
        </details>
      `;
    } else if (cat === 'defesacivil') {
      infoBanner.style.display = '';
      infoBanner.innerHTML = `
        <span class="cib-title">📘 Defesa Civil e Situações de Emergência — quando acionar</span>
        Boa Vista enfrenta cheias sazonais dos rios Branco e Cauamé, que podem exigir remoção emergencial de famílias em áreas de risco. A Defesa Civil atua na prevenção, no monitoramento e na resposta a esses e outros desastres (Lei n.º 12.608/2012 - Política Nacional de Proteção e Defesa Civil).
        <details>
          <summary>Ver quando acionar cada nível de Defesa Civil</summary>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Defesa Civil Municipal:</strong> primeira referência para ocorrências dentro do município - alagamentos, deslizamentos, risco de queda de árvores/imóveis e remoção de famílias em área de risco. Aciona-se pela <strong>Central 156</strong> da Prefeitura de Boa Vista.</p>
          <p style="margin:0.6rem 0 0.3rem 0;"><strong>Coordenadoria Estadual de Proteção e Defesa Civil (CEPDC-RR):</strong> apoia o município em desastres de maior porte e em ações do Corpo de Bombeiros Militar.</p>
          <p style="margin:0.6rem 0;">Para o CRAS, o papel costuma ser de apoio no acompanhamento psicossocial das famílias removidas ou desabrigadas e na atualização do CadÚnico para acesso a benefícios emergenciais - a Defesa Civil é quem determina e formaliza a situação de risco ou de calamidade.</p>
        </details>
      `;
    } else if (cat === 'conselhosdireitos') {
      infoBanner.style.display = '';
      infoBanner.innerHTML = `
        <span class="cib-title">📘 Conselhos Municipais de Direitos — o que são e para que servem</span>
        Os Conselhos de Direitos são órgãos <strong>paritários</strong> (metade poder público, metade sociedade civil), deliberativos e de controle social, previstos na LOAS e nos estatutos setoriais (ECA, Estatuto do Idoso), responsáveis por formular e fiscalizar as políticas públicas de cada área e gerir os respectivos Fundos Municipais de Direitos.
        <details>
          <summary>Ver os conselhos de Boa Vista reunidos nesta aba</summary>
          <ul>
            <li><strong>CMAS - Conselho Municipal de Assistência Social:</strong> define as prioridades da Política de Assistência Social, inscreve e fiscaliza entidades socioassistenciais e acompanha o BPC e o Bolsa Família no município (LOAS, art. 16).</li>
            <li><strong>CMDCA-BV - Conselho Municipal dos Direitos da Criança e do Adolescente:</strong> delibera sobre a política de atendimento à infância e adolescência, registra entidades e gere o Fundo Municipal dos Direitos da Criança e do Adolescente (ECA, arts. 88 e 260).</li>
            <li><strong>CMDPI/BV-RR - Conselho Municipal dos Direitos da Pessoa Idosa:</strong> acompanha a política municipal de proteção à pessoa idosa (Estatuto do Idoso, Lei n.º 10.741/2003).</li>
          </ul>
          <p style="margin:0.6rem 0 0;">Os três funcionam com apoio administrativo da Secretaria Municipal de Assistência e Desenvolvimento Social (SEMADS). Podem existir outros conselhos setoriais (ex.: Pessoa com Deficiência, Segurança Alimentar) - confirme diretamente com a SEMADS a composição e o calendário de reuniões vigentes.</p>
        </details>
      `;
    } else {
      infoBanner.style.display = 'none';
      infoBanner.innerHTML = '';
    }
  }

  if (resultsInfo) resultsInfo.style.display = '';

  let filtered = DATA.filter(i => {
    // Índice de busca (todos os campos pesquisáveis, já em minúsculas)
    // calculado uma única vez por unidade e reaproveitado nas buscas
    // seguintes, em vez de remontar essas strings a cada tecla digitada —
    // isso era uma causa real de lentidão com a lista grande de unidades.
    if (!i._searchIdx) {
      const isCas = i.cat.includes('cas');
      const isCras = i.cat.includes('cras');
      let parts;
      if (isCas) {
        parts = [
          i.name, i.fullName, i.address, i.desc,
          ...(i.phones || []), i.hours,
          ...(i.adminLinks || []).map(l => l.label),
          ...(i.systemLinks || []).flatMap(l => [l.label, l.desc || '']),
          ...(i.mapLinks || []).flatMap(l => [l.label, l.desc || '']),
          ...(i.driveLinks || []).map(l => l.label)
        ];
      } else if (isCras) {
        parts = [
          i.name, i.fullName, i.address, i.desc,
          ...(i.phones || []), i.hours,
          ...(i.municipalLinks || []).map(l => l.label),
          ...(i.federalLinks || []).map(l => l.label),
          ...(i.rmaLinks || []).flatMap(l => [l.label, l.desc || '']),
          ...(i.driveLinks || []).map(l => l.label),
          i.teamPanelLink ? i.teamPanelLink.label : '',
          ...(i.fixedTeam || []).flatMap(t => [t.name, t.role, t.bairros]),
          ...(i.volanteTeam || []).flatMap(t => [t.name, t.role])
        ];
      } else {
        parts = [
          i.name, i.fullName, i.address, i.desc,
          ...(Array.isArray(i.services) ? i.services : [i.services || '']),
          ...(i.phones || []),
          i.group || ''
        ];
      }
      i._searchIdx = parts.join(' ').toLowerCase();
    }

    const matchSearch = i._searchIdx.includes(query);
    const matchCat = cat === 'all' ||
                     (cat === 'social' ? (i.cat.includes('social') || i.cat.includes('idoso')) :
                     i.cat.includes(cat));
    return matchSearch && matchCat;
  });

  // "Ordenar por proximidade": o botão (toggleProximitySort) só geocodificava
  // os endereços e guardava a distância em cache, mas a lista nunca era
  // realmente reordenada por distância nem o card mostrava o quão perto
  // cada equipamento estava — a função renderDistanceBadge existia, porém
  // não era chamada em lugar nenhum. Corrigido: com o modo ativo, os itens
  // com localização já conhecida (cache de geocodificação) vêm primeiro, do
  // mais perto para o mais longe; os sem localização conhecida ficam por
  // último, na ordem em que já estavam. Os agrupamentos por seção (interior/
  // por grupo) não fazem sentido junto com essa ordenação, então são
  // ignorados enquanto o modo estiver ativo.
  if (proximityState.active) {
    const geoCache = getGeocodeCache();
    filtered = filtered
      .map((item, originalIndex) => ({ item, originalIndex }))
      .sort((a, b) => {
        const ca = geoCache[a.item.id];
        const cb = geoCache[b.item.id];
        if (!ca && !cb) return a.originalIndex - b.originalIndex;
        if (!ca) return 1;
        if (!cb) return -1;
        const da = haversineKm(proximityState.lat, proximityState.lon, ca.lat, ca.lon);
        const db = haversineKm(proximityState.lat, proximityState.lon, cb.lat, cb.lon);
        return da - db;
      })
      .map(x => x.item);
  }

  // Em qualquer aba, mantém os equipamentos do interior como um
  // segmento à parte, sempre exibido por último, depois dos
  // equipamentos de Boa Vista.
  const INTERIOR_SECTION_LABELS = {
    hospitalar: 'Unidades Hospitalares do Interior',
    saude: 'Unidades de Saúde do Interior',
    educacao: 'Escolas do Interior',
    social: 'CRAS e CREAS do Interior'
  };
  let socialDividerIndex = -1;
  let interiorSectionLabel = INTERIOR_SECTION_LABELS[cat] || 'Interior de Roraima';
  // Aplicado em qualquer aba (inclusive "Todos"): tabs sem itens do
  // interior (CAS, CRAS, Anotações, etc.) simplesmente não sofrem alteração,
  // pois "interior" fica vazio e a condição abaixo não entra em ação.
  if (!proximityState.active && cat !== 'cas' && cat !== 'cras' && cat !== 'anotacoes') {
    const boaVista = filtered.filter(i => !i.cat.includes('interior'));
    const interior = filtered.filter(i => i.cat.includes('interior'));
    if (boaVista.length && interior.length) {
      socialDividerIndex = boaVista.length;
      filtered = [...boaVista, ...interior];
    }
  }

  document.getElementById('counter').textContent = filtered.length;

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <span class="empty-state-icon" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </span>
        <strong>Nenhum registro encontrado</strong>
        Tente ajustar os termos da busca ou selecionar outra categoria.
      </div>`;
    return;
  }

  const buildCardHtml = (i, idx) => {
    const sectionDivider = (idx === socialDividerIndex) ? `
      <div class="social-section-divider" style="grid-column:1/-1; display:flex; align-items:center; gap:12px; margin:1.5rem 0 0.25rem;">
        <span style="display:inline-flex; align-items:center; gap:8px; font-size:0.75rem; font-weight:800; text-transform:uppercase; letter-spacing:0.04em; color:#B48506; background:rgba(180,133,6,0.1); padding:6px 14px; border-radius:999px;">
          ${ICONS.home} ${interiorSectionLabel}
        </span>
        <span style="flex:1; height:1px; background:linear-gradient(to right, rgba(180,133,6,0.35), transparent);"></span>
      </div>
    ` : '';

    // Sub-seção por grupo (ex.: Distritos Policiais / Delegacias Especializadas,
    // ou por município no interior) sempre que o campo "group" do item mudar
    // em relação ao anterior na lista já filtrada.
    const prevItem = filtered[idx - 1];
    const groupChanged = !proximityState.active && i.group && i.group !== (prevItem ? prevItem.group : undefined) && !i.cat.includes('cas') && !i.cat.includes('cras');
    const groupDivider = groupChanged ? `
      <div class="group-section-divider" style="grid-column:1/-1; display:flex; align-items:center; gap:10px; margin:${idx === socialDividerIndex ? '0.6rem' : '1.25rem'} 0 0.15rem;">
        <span style="display:inline-flex; align-items:center; gap:6px; font-size:0.68rem; font-weight:800; text-transform:uppercase; letter-spacing:0.04em; color:var(--brand-primary); background:rgba(0,145,194,0.08); padding:5px 12px; border-radius:999px;">
          ${ICONS.map} ${escapeHtml(i.group)}
        </span>
        <span style="flex:1; height:1px; background:linear-gradient(to right, rgba(0,145,194,0.25), transparent);"></span>
      </div>
    ` : '';

    const dividers = sectionDivider + groupDivider;

    if (i.cat.includes('cas')) {
      return dividers + renderCasCard(i, query);
    }

    if (i.cat.includes('cras')) {
      return dividers + renderCrasCard(i, query);
    }

    const attach = getAttachment(i.id);
    // Para os três guias do BPC (Idoso, PCD e Recuperação de Senha), o anexo
    // é restrito a PDF — pensado especificamente para a Folha Resumo do
    // Cadastro Único, que a família costuma levar junto do guia impresso.
    const isBpcGuideCard = BPC_GUIDE_IDS.includes(i.id);
    const attachUploadLabel = isBpcGuideCard
      ? `${ICONS.pdf} Anexar Folha Resumo do CadÚnico (PDF)`
      : `${ICONS.image} Anexar Imagem ou PDF`;
    const attachAccept = isBpcGuideCard ? 'application/pdf' : 'image/*,application/pdf';
    const attachHint = isBpcGuideCard
      ? 'PDF da Folha Resumo do Cadastro Único, até 3,5MB'
      : 'Imagem ou PDF, até 3,5MB';
    const imageBlock = attach
      ? (attach.type === 'pdf'
          ? `<div class="pdf-preview">
               <span class="pdf-icon-box" aria-hidden="true">${ICONS.pdf}</span>
               <div class="pdf-info">
                 <span class="pdf-filename" title="${escapeHtml(attach.name || 'documento.pdf')}">${escapeHtml(attach.name || 'documento.pdf')}</span>
                 <button type="button" class="pdf-open-link" onclick="openAttachedPdf('${i.id}')">Abrir PDF</button>
               </div>
               <div class="pdf-actions">
                 <button type="button" class="image-remove-btn" title="Remover anexo" aria-label="Remover anexo de ${escapeHtml(i.name)}" onclick="removeAttachment('${i.id}')">✕</button>
               </div>
             </div>`
          : `<div class="image-preview">
               <img data-attach-src="${i.id}" alt="Anexo de ${escapeHtml(i.name)}" loading="lazy" decoding="async">
               <button type="button" class="image-remove-btn" title="Remover imagem" aria-label="Remover imagem de ${escapeHtml(i.name)}" onclick="removeAttachment('${i.id}')">✕</button>
             </div>`)
      : `<label class="btn-tech btn-secondary image-upload-label">
           ${attachUploadLabel}
           <input type="file" accept="${attachAccept}" style="display:none" onchange="handleAttachUpload(event, '${i.id}')">
         </label>
         <div class="image-attach-hint">${attachHint}</div>`;

    const isInforme = i.cat.includes('informes');
    const isPolice = i.cat.includes('delegacias');
    const isInterior = i.cat.includes('interior');

    if (isInforme) {
      const metaRows = [
        informeMetaRow(ICONS.map, 'Localização', i.address),
        informeMetaRow(ICONS.clock, 'Disponibilidade', i.hours),
        informeMetaRow(ICONS.phone, 'Contato Técnico', i.phones.join(' · '))
      ].filter(Boolean).join('');

      return dividers + `
      <div class="tech-card informe-card">
        <div class="card-top">
          <div style="display:flex; align-items:center; gap:0.55rem;">
            <span class="informe-badge">${ICONS.info}</span>
            <h2 style="margin:0;">${i.name}</h2>
          </div>
          <span class="subtitle">📋 Programa/Serviço · ${i.fullName}</span>
          ${renderDistanceBadge(i.id)}
        </div>
        <div class="card-body">
          ${metaRows}
          <div class="informe-box">
            <span class="label-tech" style="color:var(--brand-info-light);">O que é</span>
            ${Array.isArray(i.services) ? i.services.join(', ') : i.services}
            ${formatInformeDesc(i.desc)}
          </div>
          ${renderUserDataFields(i.id)}
          <div class="notes-box">
            <label for="notes-${i.id}" class="label-tech">Anotações Técnicas / Conduta</label>
            <textarea id="notes-${i.id}" class="tech-notes" placeholder="Registre aqui a avaliação, conduta ou observações técnicas..." oninput="saveNote('${i.id}', this.value)">${escapeHtml(safeStorage.get('note_'+i.id, ''))}</textarea>
          </div>
          ${BPC_GUIDE_IDS.includes(i.id) ? '' : renderSecondUnitField(i.id, i.name)}
          <div class="image-attach-wrapper" id="img-wrap-${i.id}">
            ${imageBlock}
            <div class="image-error-msg" id="img-error-${i.id}" role="alert" style="display:none;"></div>
          </div>
        </div>
        <div class="card-actions"${BPC_GUIDE_IDS.includes(i.id) ? ' style="grid-template-columns: 1fr 1fr 1fr;"' : ''}>
          ${renderWhatsappButton(i.id, i.name)}
          ${BPC_GUIDE_IDS.includes(i.id)
            ? `<button class="btn-tech btn-primary" onclick="printBpcGuide('${i.id}','pt')">📄 Guia do Benefício (PT)</button>
               <button class="btn-tech btn-primary" onclick="printBpcGuide('${i.id}','es')">📄 Guía del Beneficio (ES)</button>`
            : `<button class="btn-tech btn-primary" onclick="printGuide('${i.id}')">Gerar Guia</button>`
          }
        </div>
      </div>
    `;
    }

    return dividers + `
    <div class="tech-card${isPolice ? ' police-card' : ''}${isInterior ? ' interior-card' : ''}">
      <div class="card-top">
        <div style="display:flex; align-items:center; gap:0.55rem;">
          ${isPolice ? `<span class="police-badge">${ICONS.police}</span>` : ''}
          ${isInterior ? `<span class="interior-badge">${ICONS.home}</span>` : ''}
          <h2>${i.name}</h2>
        </div>
        <span class="subtitle">${i.fullName}</span>
        ${isPolice && i.group ? `<span class="police-group-tag">${ICONS.shield} ${i.group}</span>` : ''}
        ${isInterior && i.group ? `<span class="interior-group-tag">${ICONS.home} Município: ${i.group}</span>` : ''}
        ${renderDistanceBadge(i.id)}
      </div>
      <div class="card-body">
        <div class="info-group"><span class="info-icon">${ICONS.map}</span><div><span class="label-tech">Localização</span>${i.address}</div></div>
        <div class="info-group"><span class="info-icon">${ICONS.clock}</span><div><span class="label-tech">Disponibilidade</span>${i.hours}</div></div>
        <div class="info-group"><span class="info-icon">${ICONS.phone}</span><div><span class="label-tech">Contato Técnico</span>${i.phones.join(' · ')}</div></div>
        <div class="desc-box">
          <span class="label-tech">Escopo de Atuação</span>
          ${i.desc}
          <div style="margin-top:0.5rem; font-weight:600; color:var(--brand-primary); font-size:0.75rem;">SERVIÇOS: ${Array.isArray(i.services) ? i.services.join(', ') : i.services}</div>
          ${i.cat.includes('educacao') ? BF_HIGHLIGHT_HTML : ''}
        </div>
        ${BPC_GUIDE_IDS.includes(i.id) ? '' : renderUserDataFields(i.id)}
        ${BPC_GUIDE_IDS.includes(i.id) ? '' : `
        <div class="notes-box">
          <label for="notes-${i.id}" class="label-tech">Anotações Técnicas / Conduta</label>
          <textarea id="notes-${i.id}" class="tech-notes" placeholder="Registre aqui a avaliação, conduta ou observações técnicas..." oninput="saveNote('${i.id}', this.value)">${escapeHtml(safeStorage.get('note_'+i.id, ''))}</textarea>
        </div>`}
        ${BPC_GUIDE_IDS.includes(i.id) ? '' : renderSecondUnitField(i.id, i.name)}
        <div class="image-attach-wrapper" id="img-wrap-${i.id}">
          ${imageBlock}
          <div class="image-error-msg" id="img-error-${i.id}" role="alert" style="display:none;"></div>
        </div>
      </div>
      <div class="card-actions" ${(i.website || BPC_GUIDE_IDS.includes(i.id)) ? 'style="grid-template-columns: 1fr 1fr 1fr;"' : ''}>
        ${i.website ? `<a class="btn-tech btn-secondary btn-link" href="${i.website}" target="_blank" rel="noopener noreferrer">Site Oficial</a>` : ''}
        ${renderWhatsappButton(i.id, i.name)}
        ${BPC_GUIDE_IDS.includes(i.id)
          ? `<button class="btn-tech btn-primary" onclick="printBpcGuide('${i.id}','pt')">📄 Guia do Benefício (PT)</button>
             <button class="btn-tech btn-primary" onclick="printBpcGuide('${i.id}','es')">📄 Guía del Beneficio (ES)</button>`
          : `<button class="btn-tech btn-primary" onclick="printGuide('${i.id}')">Gerar Guia</button>`
        }
      </div>
    </div>
  `;
  };

  // Anexos de imagem: os cards recebem só um placeholder (data-attach-src) e
  // a imagem real é atribuída via DOM (hydrateAttachImages), apenas para os
  // cards que realmente entraram na tela — em vez de embutir o base64 de
  // cada foto no HTML (o que travava a busca com vários anexos salvos).
  const myToken = _gridChunkToken;
  let nextIdx = 0;
  const takeChunk = () => {
    const end = Math.min(nextIdx + GRID_CHUNK_SIZE, filtered.length);
    let html = '';
    for (; nextIdx < end; nextIdx++) html += buildCardHtml(filtered[nextIdx], nextIdx);
    return html;
  };

  grid.innerHTML = takeChunk();
  hydrateAttachImages(grid);

  if (nextIdx < filtered.length) {
    const appendMore = () => {
      if (myToken !== _gridChunkToken) return false;
      grid.insertAdjacentHTML('beforeend', takeChunk());
      hydrateAttachImages(grid);
      return nextIdx < filtered.length;
    };
    if ('IntersectionObserver' in window) {
      const sentinel = getGridSentinel(grid);
      _gridChunkObserver = new IntersectionObserver(entries => {
        if (myToken !== _gridChunkToken || !entries.some(e => e.isIntersecting)) return;
        const hasMore = appendMore();
        if (hasMore && _gridChunkObserver) {
          // Reobserva para o navegador avaliar de novo se o sentinela ainda
          // está perto da tela (telas grandes precisam de vários lotes).
          _gridChunkObserver.unobserve(sentinel);
          _gridChunkObserver.observe(sentinel);
        } else if (_gridChunkObserver) {
          _gridChunkObserver.disconnect();
          _gridChunkObserver = null;
        }
      }, { rootMargin: '1500px 0px' });
      _gridChunkObserver.observe(sentinel);
    } else {
      // Navegador antigo sem IntersectionObserver: completa a lista aos poucos.
      const step = () => { if (appendMore()) setTimeout(step, 40); };
      setTimeout(step, 40);
    }
  }
}

function showImageError(id, msg) {
  const el = document.getElementById('img-error-'+id);
  if (el) {
    el.textContent = msg;
    el.style.display = 'block';
  }
}

function getAttachment(id) {
  if (_attachCache.has(id)) return _attachCache.get(id);
  let result = null;
  const raw = safeStorage.get('attach_'+id);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.data) result = parsed;
    } catch (e) {
    }
  }
  if (!result) {
    const legacyImg = safeStorage.get('img_'+id);
    if (legacyImg) result = { type: 'image', data: legacyImg, name: null };
  }
  _attachCache.set(id, result);
  return result;
}

function setAttachment(id, type, data, name) {
  return safeStorage.set('attach_'+id, JSON.stringify({ type, data, name: name || null }));
}

// Converte a dataURL (base64) salva em Blob binário. Precisamos disso porque
// alguns navegadores (Firefox, em especial) bloqueiam a navegação direta da
// página para uma URL "data:" por motivos de segurança — o link "Abrir PDF"
// simplesmente falhava nesses casos, mesmo com o anexo salvo corretamente.
// Abrindo a partir de um Blob/URL de objeto o PDF abre de forma confiável em
// qualquer navegador.
function dataUrlToBlob(dataUrl) {
  const commaIndex = dataUrl.indexOf(',');
  const header = dataUrl.slice(0, commaIndex);
  const base64 = dataUrl.slice(commaIndex + 1);
  const mimeMatch = /data:([^;]+);base64/.exec(header);
  const mime = mimeMatch ? mimeMatch[1] : 'application/pdf';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function openAttachedPdf(id) {
  const attach = getAttachment(id);
  if (!attach || !attach.data) return;
  try {
    const blob = dataUrlToBlob(attach.data);
    const url = URL.createObjectURL(blob);
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    // Se o navegador bloquear o pop-up, ao menos avisa em vez de falhar em silêncio.
    if (!opened) {
      showImageError(id, 'O navegador bloqueou a abertura do PDF em nova aba. Permita pop-ups para este site e tente novamente.');
    }
    // Libera a memória do Blob depois de um tempo (a aba já aberta não é afetada).
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    showImageError(id, 'Não foi possível abrir o PDF anexado. O arquivo salvo pode estar corrompido — tente remover e anexar novamente.');
  }
}

function handleAttachUpload(event, id) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const errorEl = document.getElementById('img-error-'+id);
  if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }

  const isImage = file.type.startsWith('image/');
  const isPdf = file.type === 'application/pdf';

  if (!isImage && !isPdf) {
    showImageError(id, 'Selecione uma imagem ou um arquivo PDF válido.');
    event.target.value = '';
    return;
  }

  if (BPC_GUIDE_IDS.includes(id) && !isPdf) {
    showImageError(id, 'Este campo aceita apenas arquivos PDF (Folha Resumo do CadÚnico).');
    event.target.value = '';
    return;
  }

  if (file.size > MAX_ATTACH_BYTES) {
    const sizeMb = (file.size / (1024*1024)).toFixed(1);
    showImageError(id, `Arquivo muito grande (${sizeMb}MB). O limite é 3,5MB.`);
    event.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = function() {
    const type = isPdf ? 'pdf' : 'image';
    if (setAttachment(id, type, reader.result, file.name)) {
      render();
    } else {
      showImageError(id, 'Não foi possível salvar o anexo (limite de armazenamento do navegador atingido).');
    }
  };
  reader.onerror = function() {
    showImageError(id, 'Falha ao ler o arquivo.');
  };
  reader.readAsDataURL(file);
}

function removeAttachment(id) {
  safeStorage.remove('attach_'+id);
  safeStorage.remove('img_'+id);
  render();
}

function saveNote(id, value) {
  if (!safeStorage.set('note_'+id, value)) {
    showImageError(id, 'Não foi possível salvar a anotação (armazenamento indisponível ou cheio).');
  }
}

function getUserData(id) {
  return safeStorage.getJSON('userdata_'+id, {nome:'', endereco:'', nis:'', unidadeOrigem:'', cpf:'', dataNascimento:''});
}

function saveUserDataField(id, field, value) {
  const data = getUserData(id);
  data[field] = value;
  safeStorage.set('userdata_'+id, JSON.stringify(data));
}

function renderUserDataFields(id) {
  const d = getUserData(id);
  return `
    <div class="user-data-fields">
      <div class="user-data-field">
        <label for="origem-${id}">Unidade de Origem</label>
        <input type="text" id="origem-${id}" value="${escapeHtml(d.unidadeOrigem)}" placeholder="Ex.: CRAS Cristiana Vicente Nunes" oninput="saveUserDataField('${id}','unidadeOrigem',this.value)">
      </div>
      <div class="user-data-field">
        <label for="nome-${id}">Nome Completo</label>
        <input type="text" id="nome-${id}" value="${escapeHtml(d.nome)}" placeholder="Nome completo do(a) usuário(a)" oninput="saveUserDataField('${id}','nome',this.value)">
      </div>
      <div class="user-data-field">
        <label for="endereco-${id}">Endereço / Bairro</label>
        <input type="text" id="endereco-${id}" value="${escapeHtml(d.endereco)}" placeholder="Endereço ou bairro" oninput="saveUserDataField('${id}','endereco',this.value)">
      </div>
      <div class="user-data-field">
        <label for="nis-${id}">Nº NIS</label>
        <input type="text" id="nis-${id}" value="${escapeHtml(d.nis)}" placeholder="NIS" oninput="saveUserDataField('${id}','nis',this.value)">
      </div>
      <div class="user-data-field">
        <label for="cpf-${id}">CPF</label>
        <input type="text" id="cpf-${id}" value="${escapeHtml(d.cpf)}" placeholder="000.000.000-00" inputmode="numeric" maxlength="14" oninput="saveUserDataField('${id}','cpf',formatCpfInput(this))">
      </div>
      <div class="user-data-field">
        <label for="nasc-${id}">Data de Nascimento</label>
        <input type="date" id="nasc-${id}" value="${escapeHtml(d.dataNascimento)}" placeholder="Data de nascimento" oninput="saveUserDataField('${id}','dataNascimento',this.value)">
      </div>
    </div>
  `;
}

// Formata o CPF digitado como 000.000.000-00 conforme o usuário digita,
// mantendo só os números internamente (o valor exibido no campo já sai
// formatado, e é esse valor formatado que é salvo em saveUserDataField).
function formatCpfInput(inputEl) {
  const digits = inputEl.value.replace(/\D/g, '').slice(0, 11);
  let formatted = digits;
  if (digits.length > 9) {
    formatted = `${digits.slice(0,3)}.${digits.slice(3,6)}.${digits.slice(6,9)}-${digits.slice(9)}`;
  } else if (digits.length > 6) {
    formatted = `${digits.slice(0,3)}.${digits.slice(3,6)}.${digits.slice(6)}`;
  } else if (digits.length > 3) {
    formatted = `${digits.slice(0,3)}.${digits.slice(3)}`;
  }
  inputEl.value = formatted;
  return formatted;
}

// Converte a data salva pelo <input type="date"> (formato ISO "AAAA-MM-DD")
// para o formato brasileiro "DD/MM/AAAA" usado nas fichas impressas.
function formatBirthDateDisplay(isoDate) {
  if (!isoDate) return '';
  const parts = String(isoDate).split('-');
  if (parts.length !== 3) return isoDate;
  const [y, m, d] = parts;
  return `${d}/${m}/${y}`;
}

// --- Segunda unidade no mesmo encaminhamento --------------------------------
// Permite marcar, dentro do card de UMA unidade, uma SEGUNDA unidade/serviço
// para constar como página extra da Ficha de Encaminhamento Técnico (ver
// printGuide). Nessa página extra só aparecem nome, endereço e horário da
// segunda unidade — os demais dados (usuário, motivo, protocolo etc.) já
// estão na 1ª página e não precisam se repetir. A página entra logo depois
// da 1ª quando não há anexo, ou depois do(s) anexo(s) quando há (ver ordem
// de montagem em printGuide: firstPage + secondPage + pdfPage + secondUnitPage).
// Não é dado sensível do(a) atendido(a) (só liga dois IDs de unidades já
// públicas do diretório), por isso a chave não entra em SENSITIVE_DATA_PREFIXES
// e sobrevive a "Apagar dados salvos neste dispositivo".
let _printableUnitsCache = null;
function getPrintableUnitsSorted() {
  if (!_printableUnitsCache) {
    _printableUnitsCache = DATA
      .filter(x => !x.cat.includes('cas') && !x.cat.includes('cras') && !BPC_GUIDE_IDS.includes(x.id) && x.address && x.address !== 'N/A')
      .slice()
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'pt-BR'));
  }
  return _printableUnitsCache;
}

function getSecondUnit(id) {
  return safeStorage.get('second_unit_' + id, '') || '';
}

function setSecondUnit(id, secondId) {
  if (secondId) {
    safeStorage.set('second_unit_' + id, secondId);
  } else {
    safeStorage.remove('second_unit_' + id);
  }
}

// Antes, TODO card trazia um <select> com as ~428 unidades: na aba "Todos"
// eram ~183 mil <option> (~25 MB de HTML) a cada render — a principal causa
// do travamento. Agora o card nasce só com "Nenhuma" (+ a unidade já
// escolhida, se houver) e a lista completa é preenchida na primeira vez que
// a pessoa toca/foca o campo (ver listeners logo abaixo).
let _secondUnitOptionsHtml = null;
function populateSecondUnitSelect(sel) {
  if (!sel || sel.dataset.filled === '1') return;
  sel.dataset.filled = '1';
  const ownId = sel.getAttribute('data-own-id');
  const current = sel.value;
  if (_secondUnitOptionsHtml === null) {
    _secondUnitOptionsHtml = getPrintableUnitsSorted()
      .map(x => `<option value="${x.id}">${escapeHtml(x.name)} — ${escapeHtml(x.fullName)}</option>`)
      .join('');
  }
  while (sel.options.length > 1) sel.remove(1); // mantém só "Nenhuma"
  sel.insertAdjacentHTML('beforeend', _secondUnitOptionsHtml);
  for (let k = 0; k < sel.options.length; k++) {
    if (sel.options[k].value === ownId) { sel.remove(k); break; } // não oferece a própria unidade
  }
  sel.value = current;
}
['pointerdown', 'touchstart', 'focusin', 'keydown'].forEach(evt => {
  document.addEventListener(evt, e => {
    const t = e.target;
    if (t && t.classList && t.classList.contains('second-unit-select')) populateSecondUnitSelect(t);
  }, true);
});

function renderSecondUnitField(id, name) {
  const current = getSecondUnit(id);
  let currentOption = '';
  if (current) {
    const cu = getPrintableUnitsSorted().find(x => x.id === current);
    if (cu) currentOption = `<option value="${cu.id}" selected>${escapeHtml(cu.name)} — ${escapeHtml(cu.fullName)}</option>`;
  }
  const options = currentOption;
  return `
    <div class="second-unit-box">
      <label for="second-unit-${id}" class="label-tech">📄 Incluir 2ª unidade neste encaminhamento (opcional)</label>
      <select id="second-unit-${id}" class="second-unit-select" data-own-id="${id}" onchange="setSecondUnit('${id}', this.value)">
        <option value="">Nenhuma — encaminhar só para ${escapeHtml(name)}</option>
        ${options}
      </select>
      <div class="second-unit-hint">Na ficha impressa, essa unidade entra em uma página extra só com nome, endereço e horário — sem repetir usuário, motivo ou protocolo.</div>
    </div>
  `;
}


// Botão "WhatsApp" reutilizado em todos os tipos de card (CAS, CRAS,
// programas/informes e equipamentos), para ficar igual em toda a lista.
function renderWhatsappButton(id, name) {
  const safeName = escapeHtml(name || '');
  return `<button type="button" class="btn-tech btn-whatsapp" onclick="share('${id}')" title="Enviar os dados desta unidade por WhatsApp" aria-label="Enviar os dados de ${safeName} por WhatsApp">${ICONS.whatsapp} WhatsApp</button>`;
}

function share(id) {
  const i = DATA.find(x => x.id === id);
  if (!i) return; // segurança: item não encontrado (ex.: dado alterado entre a renderização e o clique)
  const t = `*UNIDADE:* ${i.fullName || i.name}\n*ENDEREÇO:* ${stripHtml(i.address)}\n*HORÁRIO:* ${stripHtml(i.hours || 'Não informado')}\n*CONTATO:* ${stripHtml((i.phones || []).join(' / ') || 'Não informado')}${i.website ? `\n*SITE:* ${i.website}` : ''}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(t)}`, '_blank', 'noopener,noreferrer');
}

async function fitPrintNote() {
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch (e) { }
  }
  const noteBox = document.getElementById('printNoteBox');
  if (!noteBox) return;

  let fontSize = 15;
  noteBox.style.fontSize = fontSize + 'px';
  while (noteBox.scrollHeight > noteBox.clientHeight && fontSize > 7) {
    fontSize -= 0.5;
    noteBox.style.fontSize = fontSize + 'px';
  }

  // Última garantia: se mesmo na fonte mínima o texto ainda não couber
  // (nota muito longa), corta o texto com reticências para que a caixa
  // jamais estoure os limites da folha impressa.
  if (noteBox.scrollHeight > noteBox.clientHeight) {
    const textEl = noteBox.querySelector('span') || noteBox;
    const fullText = textEl.textContent;
    let lo = 0, hi = fullText.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      textEl.textContent = fullText.slice(0, mid).trimEnd() + '…';
      if (noteBox.scrollHeight > noteBox.clientHeight) {
        hi = mid - 1;
      } else {
        lo = mid;
      }
    }
    textEl.textContent = lo > 0 ? fullText.slice(0, lo).trimEnd() + '…' : '…';
  }
}

function truncateForPrint(text, maxLen) {
  const clean = stripHtml(text).trim();
  if (!clean) return '';
  if (clean.length <= maxLen) return escapeHtml(clean);
  let cut = clean.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > maxLen * 0.6) cut = cut.slice(0, lastSpace);
  return escapeHtml(cut) + '…';
}

const GENERAL_NOTE_KEY = 'nota_geral_encaminhamento';

// --- Aba "Minhas Anotações": múltiplas anotações -----------------------------
// Antes só existia UMA anotação geral (chave GENERAL_NOTE_KEY). Agora o
// técnico pode criar, nomear e guardar quantas anotações precisar — uma por
// caso/atendimento, por exemplo. GNOTES_INDEX_KEY guarda a LISTA (id, título,
// data da última edição); o texto de cada anotação fica em uma chave própria
// 'gnote_<id>' (dados sensíveis: ver SENSITIVE_DATA_PREFIXES acima, o que já
// cobre backup/restauração e "apagar dados salvos" automaticamente).
//
// Os dados do usuário encaminhado (nome, endereço, NIS, CPF, nascimento) já
// eram salvos por 'id' via getUserData/renderUserDataFields — aqui cada
// anotação usa o próprio id da anotação como 'id', então cada uma tem seus
// próprios dados de usuário, independentes das outras.
const GNOTES_INDEX_KEY = 'gnotes_index';

// ID em memória da anotação aberta no momento (não precisa persistir: ao
// reabrir o app, mostramos a anotação mais recente da lista).
let activeNoteId = null;

// Roda uma única vez: se ainda não existe a lista nova (gnotes_index), cria a
// partir da antiga anotação geral única, SE ela tiver algum conteúdo ou
// algum dado de usuário preenchido (nome, endereço etc.) — assim ninguém
// perde o que já tinha escrito. Reaproveita o id 'geral' de propósito, para
// que 'userdata_geral' (já existente) continue vinculado automaticamente,
// sem precisar copiar nada.
function migrateLegacyGeneralNote() {
  const existing = safeStorage.getJSON(GNOTES_INDEX_KEY, null);
  if (existing) return existing;

  const legacyContent = safeStorage.get(GENERAL_NOTE_KEY, '');
  const legacyUserData = safeStorage.getJSON('userdata_geral', null);
  const hasLegacyUserData = !!(legacyUserData && Object.values(legacyUserData).some(v => v && String(v).trim()));

  let index = [];
  if (legacyContent || hasLegacyUserData) {
    const id = 'geral';
    if (legacyContent) safeStorage.set('gnote_' + id, legacyContent);
    index = [{ id, title: 'Anotação Geral', updatedAt: Date.now() }];
  }
  saveNotesIndex(index);
  return index;
}

function getNotesIndex() {
  return migrateLegacyGeneralNote();
}

function saveNotesIndex(list) {
  safeStorage.set(GNOTES_INDEX_KEY, JSON.stringify(list));
}

function getNoteContent(id) {
  return safeStorage.get('gnote_' + id, '');
}

function generateNoteId() {
  return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// "Hoje 14:32", "Ontem 09:10" ou "03/04/2026" — pensado para a listinha de
// anotações, onde a hora exata importa menos que saber "foi hoje?".
function formatNoteTimestamp(ts) {
  if (!ts) return '';
  const date = new Date(ts);
  const now = new Date();
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return 'Hoje ' + time;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Ontem ' + time;
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  });
}

function refreshNotesPanel() {
  const grid = document.getElementById('grid');
  if (grid) grid.innerHTML = renderNotesCard();
}

function createNote() {
  const notes = getNotesIndex();
  const id = generateNoteId();
  notes.unshift({ id, title: `Anotação ${notes.length + 1}`, updatedAt: Date.now() });
  saveNotesIndex(notes);
  safeStorage.set('gnote_' + id, '');
  activeNoteId = id;
  refreshNotesPanel();
  updateChipCounts();
  // Foca o título para o técnico já poder nomear a anotação (ex.: o nome do
  // caso ou do usuário atendido) antes de começar a escrever.
  requestAnimationFrame(() => {
    const titleInput = document.getElementById('noteTitleInput');
    if (titleInput) { titleInput.focus(); titleInput.select(); }
  });
}

function selectNote(id) {
  if (id === activeNoteId) return;
  activeNoteId = id;
  refreshNotesPanel();
}

function renameNote(id, value) {
  const notes = getNotesIndex();
  const note = notes.find(n => n.id === id);
  if (!note) return;
  note.title = value;
  saveNotesIndex(notes);
  // Atualiza só o título na listinha, sem remontar tudo — assim o cursor não
  // pula do campo enquanto o técnico ainda está digitando o nome.
  const titleEl = document.querySelector(`.note-list-item[data-note-id="${CSS.escape(id)}"] .note-list-item-title`);
  if (titleEl) titleEl.textContent = value.trim() || 'Sem título';
}

function deleteNote(id) {
  const notes = getNotesIndex();
  const note = notes.find(n => n.id === id);
  if (!note) return;
  const ok = confirm(`Excluir a anotação "${note.title || 'Sem título'}"? Isso apaga o texto e os dados do usuário preenchidos nela. Esta ação não pode ser desfeita.`);
  if (!ok) return;
  const remaining = notes.filter(n => n.id !== id);
  saveNotesIndex(remaining);
  safeStorage.remove('gnote_' + id);
  safeStorage.remove('userdata_' + id);
  if (activeNoteId === id) activeNoteId = remaining.length ? remaining[0].id : null;
  refreshNotesPanel();
  updateChipCounts();
}

let noteMetaDebounceTimer = null;

// Salva o texto da anotação a cada tecla (para nunca perder nada), mas só
// atualiza a data/prévia na listinha lateral com um pequeno atraso — refazer
// isso a cada tecla seria trabalho desnecessário durante a digitação.
function saveGeneralNote(id, value) {
  const statusEl = document.getElementById('generalNoteStatus');
  const statusTextEl = document.getElementById('generalNoteStatusText');
  const ok = safeStorage.set('gnote_' + id, value);

  if (!ok) {
    if (statusEl) statusEl.innerHTML = `${ICONS.info}<span style="color:#DC2626;">Não foi possível salvar (armazenamento indisponível ou cheio).</span>`;
    return;
  }

  if (statusTextEl) {
    statusTextEl.textContent = `${value.length} caractere${value.length === 1 ? '' : 's'} · salvando…`;
  }

  clearTimeout(noteMetaDebounceTimer);
  noteMetaDebounceTimer = setTimeout(() => {
    const notes = getNotesIndex();
    const note = notes.find(n => n.id === id);
    if (note) {
      note.updatedAt = Date.now();
      saveNotesIndex(notes);
    }
    updateNoteListItemPreview(id, value, note);
    if (statusTextEl) {
      statusTextEl.textContent = `${value.length} caractere${value.length === 1 ? '' : 's'} · salva automaticamente`;
    }
  }, 500);
}

function updateNoteListItemPreview(id, value, note) {
  const item = document.querySelector(`.note-list-item[data-note-id="${CSS.escape(id)}"]`);
  if (!item) return;
  const metaEl = item.querySelector('.note-list-item-meta');
  if (!metaEl) return;
  const preview = stripHtml(value).trim().replace(/\s+/g, ' ').slice(0, 60);
  const ts = note ? formatNoteTimestamp(note.updatedAt) : '';
  metaEl.textContent = preview ? (ts ? `${ts} · ${preview}` : preview) : ts;
}

function renderPdfToolsCard() {
  return `
    <div class="tech-card pdftools-card">
      <div class="card-top">
        <div style="display:flex; align-items:center; gap:0.55rem;">
          <span class="pdftools-badge">${ICONS.pdf}</span>
          <h2 style="margin:0;">Ferramentas de Arquivo</h2>
        </div>
        <span class="subtitle">🗂️ Unificar, converter e transformar arquivos PDF</span>
      </div>
      <div class="card-body">
        <div class="pdftools-privacy">
          ${ICONS.info}
          <span>Tudo acontece aqui no seu navegador — nenhum arquivo é enviado a servidor algum. Na primeira vez que usar cada função, o app baixa uma pequena biblioteca (leva poucos segundos e precisa de internet só nesse momento).</span>
        </div>

        <div class="pdftools-tool" style="margin-bottom:1.1rem;">
          <div class="pdftools-tool-header">
            <span class="pdftools-tool-icon">${ICONS.layers}</span>
            <div>
              <div class="pdftools-tool-title">Unificar PDFs e fotos</div>
              <div class="pdftools-tool-limit">Até 20 arquivos · total de 50 MB</div>
            </div>
          </div>
          <p class="pdftools-tool-desc">Junte PDFs e fotos (JPG ou PNG) em um único documento, na ordem que você escolher (arraste os itens ou use as setas). Em cada PDF você pode usar só algumas páginas, e qualquer item pode ser girado.</p>

          <label class="pdftools-dropzone" for="pdftoolsMergeInput" ondragover="event.preventDefault(); this.classList.add('dragover')" ondragleave="this.classList.remove('dragover')" ondrop="pdftoolsHandleDrop(event, 'merge')">
            <input type="file" id="pdftoolsMergeInput" accept=".pdf,application/pdf,image/jpeg,image/png,.jpg,.jpeg,.png" multiple onchange="pdftoolsAddMergeFiles(this.files)">
            <div class="pdftools-dropzone-icon">${ICONS.folder}</div>
            <div class="pdftools-dropzone-text">Toque para escolher PDFs e fotos</div>
            <div class="pdftools-dropzone-hint">ou arraste os arquivos até aqui</div>
          </label>

          <div class="pdftools-filelist-toolbar" id="pdftoolsMergeToolbar" style="display:none;">
            <span id="pdftoolsMergeSummary"></span>
            <button type="button" class="pdftools-sort-btn" id="pdftoolsMergeSortBtn" onclick="pdftoolsSortMergeFilesAlpha()" title="Ordenar arquivos por nome (A-Z)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h6"/><path d="M3 12h4"/><path d="M3 18h2"/><path d="M17 4v16"/><path d="M13 8l4-4 4 4"/></svg>
              Ordenar A-Z
            </button>
          </div>

          <ul class="pdftools-filelist" id="pdftoolsMergeList"></ul>

          <div class="pdftools-capacity" id="pdftoolsMergeCapacity" role="img" aria-label="Espaço usado do limite de 50 MB">
            <div class="pdftools-capacity-fill" id="pdftoolsMergeCapacityFill"></div>
          </div>

          <div class="pdftools-filename-field">
            <label for="pdftoolsMergeFilename">Nome do arquivo final</label>
            <input type="text" id="pdftoolsMergeFilename" placeholder="${pdftoolsDefaultMergeName()}" maxlength="80" aria-describedby="pdftoolsMergeFilenameSuffix">
            <span class="pdftools-filename-suffix" id="pdftoolsMergeFilenameSuffix">.pdf</span>
          </div>

          <div class="pdftools-actions">
            <button type="button" class="pdftools-btn" id="pdftoolsMergeBtn" disabled onclick="pdftoolsMergePdfs()">${ICONS.layers} Unificar e baixar</button>
            <button type="button" class="pdftools-btn-ghost" id="pdftoolsMergeClearBtn" disabled onclick="pdftoolsClearMergeFiles()">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              Limpar lista
            </button>
          </div>
          <div class="pdftools-progress" id="pdftoolsMergeProgress"><div class="pdftools-progress-fill" id="pdftoolsMergeProgressFill"></div></div>
          <div class="pdftools-status is-info" id="pdftoolsMergeStatus"></div>
        </div>

        <div class="pdftools-grid">
          <div class="pdftools-tool">
            <div class="pdftools-tool-header">
              <span class="pdftools-tool-icon">${ICONS.filebinary}</span>
              <div>
                <div class="pdftools-tool-title">PDF → Word</div>
                <div class="pdftools-tool-limit">Gera um .docx editável</div>
              </div>
            </div>
            <p class="pdftools-tool-desc">Extrai o texto do PDF para um documento Word (.docx) que você pode editar depois.</p>
            <label class="pdftools-dropzone" for="pdftoolsPdfWordInput" ondragover="event.preventDefault(); this.classList.add('dragover')" ondragleave="this.classList.remove('dragover')" ondrop="pdftoolsHandleDrop(event, 'pdfword')">
              <input type="file" id="pdftoolsPdfWordInput" accept=".pdf,application/pdf" onchange="pdftoolsRunPdfToWord(this.files[0], this)">
              <div class="pdftools-dropzone-icon">${ICONS.pdf}</div>
              <div class="pdftools-dropzone-text">Escolher um PDF</div>
              <div class="pdftools-dropzone-hint">conversão baseada no texto do arquivo</div>
            </label>
            <div class="pdftools-progress" id="pdftoolsPdfWordProgress"><div class="pdftools-progress-fill" id="pdftoolsPdfWordProgressFill"></div></div>
            <div class="pdftools-status is-info" id="pdftoolsPdfWordStatus"></div>
          </div>

          <div class="pdftools-tool">
            <div class="pdftools-tool-header">
              <span class="pdftools-tool-icon">${ICONS.form}</span>
              <div>
                <div class="pdftools-tool-title">Word → PDF</div>
                <div class="pdftools-tool-limit">A partir de um .docx</div>
              </div>
            </div>
            <p class="pdftools-tool-desc">Converte um documento Word (.docx) em um arquivo PDF pronto para impressão.</p>
            <label class="pdftools-dropzone" for="pdftoolsWordPdfInput" ondragover="event.preventDefault(); this.classList.add('dragover')" ondragleave="this.classList.remove('dragover')" ondrop="pdftoolsHandleDrop(event, 'wordpdf')">
              <input type="file" id="pdftoolsWordPdfInput" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onchange="pdftoolsRunWordToPdf(this.files[0], this)">
              <div class="pdftools-dropzone-icon">${ICONS.form}</div>
              <div class="pdftools-dropzone-text">Escolher um .docx</div>
              <div class="pdftools-dropzone-hint">mantém títulos e parágrafos</div>
            </label>
            <div class="pdftools-progress" id="pdftoolsWordPdfProgress"><div class="pdftools-progress-fill" id="pdftoolsWordPdfProgressFill"></div></div>
            <div class="pdftools-status is-info" id="pdftoolsWordPdfStatus"></div>
          </div>

          <div class="pdftools-tool">
            <div class="pdftools-tool-header">
              <span class="pdftools-tool-icon">${ICONS.image}</span>
              <div>
                <div class="pdftools-tool-title">PDF → JPG</div>
                <div class="pdftools-tool-limit">Uma imagem por página</div>
              </div>
            </div>
            <p class="pdftools-tool-desc">Transforma cada página do PDF em uma imagem JPG (baixa tudo junto em .zip quando houver mais de uma página).</p>
            <label class="pdftools-dropzone" for="pdftoolsPdfJpgInput" ondragover="event.preventDefault(); this.classList.add('dragover')" ondragleave="this.classList.remove('dragover')" ondrop="pdftoolsHandleDrop(event, 'pdfjpg')">
              <input type="file" id="pdftoolsPdfJpgInput" accept=".pdf,application/pdf" onchange="pdftoolsRunPdfToJpg(this.files[0], this)">
              <div class="pdftools-dropzone-icon">${ICONS.pdf}</div>
              <div class="pdftools-dropzone-text">Escolher um PDF</div>
              <div class="pdftools-dropzone-hint">boa qualidade de imagem</div>
            </label>
            <div class="pdftools-progress" id="pdftoolsPdfJpgProgress"><div class="pdftools-progress-fill" id="pdftoolsPdfJpgProgressFill"></div></div>
            <div class="pdftools-status is-info" id="pdftoolsPdfJpgStatus"></div>
          </div>

          <div class="pdftools-tool">
            <div class="pdftools-tool-header">
              <span class="pdftools-tool-icon">${ICONS.image}</span>
              <div>
                <div class="pdftools-tool-title">JPG → PDF</div>
                <div class="pdftools-tool-limit">Até 20 imagens · total de 40 MB</div>
              </div>
            </div>
            <p class="pdftools-tool-desc">Junta uma ou mais imagens (JPG ou PNG) em um único arquivo PDF, na ordem escolhida.</p>
            <label class="pdftools-dropzone" for="pdftoolsJpgPdfInput" ondragover="event.preventDefault(); this.classList.add('dragover')" ondragleave="this.classList.remove('dragover')" ondrop="pdftoolsHandleDrop(event, 'jpgpdf')">
              <input type="file" id="pdftoolsJpgPdfInput" accept="image/jpeg,image/png" multiple onchange="pdftoolsAddJpgPdfFiles(this.files)">
              <div class="pdftools-dropzone-icon">${ICONS.image}</div>
              <div class="pdftools-dropzone-text">Escolher imagens</div>
              <div class="pdftools-dropzone-hint">JPG ou PNG</div>
            </label>
            <ul class="pdftools-filelist" id="pdftoolsJpgPdfList"></ul>
            <div class="pdftools-actions">
              <button type="button" class="pdftools-btn" id="pdftoolsJpgPdfBtn" disabled onclick="pdftoolsRunJpgToPdf()">${ICONS.pdf} Converter e baixar</button>
            </div>
            <div class="pdftools-status is-info" id="pdftoolsJpgPdfStatus"></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

const TRADUTOR_LANGS = {
  pt: { label: 'Português', voice: 'pt-BR', flag: '🇧🇷' },
  es: { label: 'Espanhol', voice: 'es-ES', flag: '🇪🇸' },
  en: { label: 'Inglês', voice: 'en-US', flag: '🇺🇸' },
  fr: { label: 'Francês', voice: 'fr-FR', flag: '🇫🇷' }
};

const TRADUTOR_PHRASES = [
  'Bom dia! Qual é o seu nome completo?',
  'Você já tem o Cadastro Único (CadÚnico)?',
  'Você tem algum documento de identificação, como passaporte ou cédula?',
  'Por favor, aguarde um momento, vou chamar alguém para te ajudar.',
  'Quantas pessoas moram na sua casa?',
  'Você precisa de ajuda com alimentação, moradia ou documentos?',
  'Volte aqui na próxima sexta-feira, das 8h às 12h.',
  'Traga um comprovante de endereço na próxima visita.'
];

/* Aba "Tradutor" — comunicação em texto e voz com estrangeiros
   (espanhol, inglês e francês), muito usada no atendimento a
   venezuelanos. A tradução de texto usa a API pública e gratuita do
   MyMemory (api.mymemory.translated.net); a voz usa a síntese de fala
   nativa do navegador (Web Speech API), que não envia áudio a
   servidor algum. O microfone (entrada de voz) usa o reconhecimento
   de fala nativo do navegador (Web Speech API), processado no próprio
   aparelho ou pelo serviço de voz do navegador — não é gravado nem
   fica salvo em lugar nenhum. */
let tradutorRecognition = null;
let tradutorListening = false;

// O serviço gratuito MyMemory limita cada tradução a ~500 caracteres; acima
// disso ele devolve um aviso de limite em vez de traduzir. Avisamos antes de
// enviar, em vez de deixar o técnico descobrir isso só depois pelo erro.
const TRADUTOR_MAX_CHARS = 480;

// Cache simples em memória (dura enquanto a aba estiver aberta): evita
// reenviar ao serviço externo um texto que acabou de ser traduzido (ex.:
// o técnico traduz, edita e volta ao texto original, ou reusa uma frase
// rápida várias vezes no mesmo atendimento) — resposta instantânea e um
// pedido a menos na cota diária gratuita do serviço.
const tradutorCache = new Map();
const TRADUTOR_CACHE_MAX = 100;

const TRADUTOR_CUSTOM_KEY = 'argo_tradutor_custom_phrases';
let tradutorCustomPhrases = [];

function renderTranslatorCard() {
  const langOptions = (selected) => Object.entries(TRADUTOR_LANGS).map(([code, l]) =>
    `<option value="${code}" ${code === selected ? 'selected' : ''}>${l.flag} ${l.label}</option>`
  ).join('');

  return `
    <div class="tech-card tradutor-card">
      <div class="card-top">
        <div style="display:flex; align-items:center; gap:0.55rem;">
          <span class="tradutor-badge">${ICONS.translate}</span>
          <h2 style="margin:0;">Tradutor</h2>
        </div>
        <span class="subtitle">🌎 Comunicação com estrangeiros · texto e voz (Espanhol, Inglês e Francês)</span>
      </div>
      <div class="card-body">
        <div class="tradutor-privacy">
          ${ICONS.info}
          <span>Digite ou fale o texto, toque em "Traduzir" e depois no alto-falante para ouvir em voz alta — útil para se comunicar com pessoas que não falam português, principalmente venezuelanos e outros estrangeiros em atendimento. A tradução do texto usa um serviço online gratuito (precisa de internet); a voz e o microfone são processados pelo próprio aparelho. <strong>Evite digitar ou falar nome, endereço, NIS ou outro dado que identifique a pessoa atendida</strong> — o texto traduzido é enviado a esse serviço externo. Prefira frases genéricas ou use as frases prontas abaixo.</span>
        </div>

        <div class="tradutor-langbar">
          <select id="tradutorFrom" onchange="tradutorSyncSpeakLabels()" aria-label="Idioma de origem">
            ${langOptions('pt')}
          </select>
          <button type="button" class="tradutor-swap-btn" onclick="tradutorSwapLangs()" title="Inverter idiomas" aria-label="Inverter idiomas">${ICONS.swap}</button>
          <select id="tradutorTo" onchange="tradutorSyncSpeakLabels()" aria-label="Idioma de destino">
            ${langOptions('es')}
          </select>
        </div>

        <div class="tradutor-panes">
          <div class="tradutor-pane">
            <div class="tradutor-pane-head">
              <span id="tradutorFromLabel">Português</span>
              <div class="tradutor-pane-tools">
                <button type="button" class="tradutor-icon-btn" id="tradutorMicBtn" onclick="tradutorToggleMic()" title="Falar para digitar" aria-label="Falar para digitar">${ICONS.mic}</button>
                <button type="button" class="tradutor-icon-btn" id="tradutorCopyFrom" onclick="tradutorCopy('from')" title="Copiar texto" aria-label="Copiar texto">${ICONS.copy}</button>
                <button type="button" class="tradutor-speak-btn" id="tradutorSpeakFrom" onclick="tradutorSpeak('from')">${ICONS.volume} Ouvir</button>
              </div>
            </div>
            <textarea id="tradutorInput" placeholder="Digite ou fale aqui o texto em português..." oninput="tradutorHandleInput()" onkeydown="tradutorHandleInputKey(event)" maxlength="${TRADUTOR_MAX_CHARS}"></textarea>
            <div class="tradutor-charcount" id="tradutorCharCount">0/${TRADUTOR_MAX_CHARS}</div>
          </div>
          <div class="tradutor-pane">
            <div class="tradutor-pane-head">
              <span id="tradutorToLabel">Espanhol</span>
              <div class="tradutor-pane-tools">
                <button type="button" class="tradutor-icon-btn" id="tradutorCopyTo" onclick="tradutorCopy('to')" title="Copiar tradução" aria-label="Copiar tradução">${ICONS.copy}</button>
                <button type="button" class="tradutor-speak-btn" id="tradutorSpeakTo" onclick="tradutorSpeak('to')" disabled>${ICONS.volume} Ouvir</button>
              </div>
            </div>
            <textarea id="tradutorOutput" placeholder="A tradução aparece aqui..." readonly></textarea>
          </div>
        </div>

        <div class="tradutor-actions">
          <div class="tradutor-actions-left">
            <button type="button" class="tradutor-btn" id="tradutorGoBtn" onclick="tradutorTranslate()">${ICONS.translate} Traduzir</button>
            <button type="button" class="tradutor-btn-ghost" onclick="tradutorClear()">Limpar</button>
          </div>
          <label class="tradutor-rate-toggle" title="A voz fala mais devagar, para ajudar quem tem dificuldade de entender">
            <input type="checkbox" id="tradutorSlowSpeech">
            <span>Falar devagar</span>
          </label>
          <span class="tradutor-status" id="tradutorStatus"></span>
        </div>

        <div class="tradutor-phrases">
          <div class="tradutor-phrases-head">
            <h3>Frases rápidas de atendimento</h3>
            <input type="text" class="tradutor-phrase-search" id="tradutorPhraseSearch" placeholder="Filtrar frases..." oninput="tradutorFilterPhrases(this.value)" aria-label="Filtrar frases rápidas">
          </div>
          <div class="tradutor-phrase-add">
            <input type="text" id="tradutorNewPhrase" placeholder="Escrever uma frase própria em português e salvar aqui..." maxlength="200" onkeydown="if(event.key==='Enter'){event.preventDefault();tradutorAddPhrase();}">
            <button type="button" onclick="tradutorAddPhrase()" title="Salvar como frase rápida" aria-label="Salvar como frase rápida">${ICONS.plus} Salvar frase</button>
          </div>
          <div class="tradutor-phrase-list" id="tradutorPhraseList"></div>
        </div>
      </div>
    </div>
  `;
}

function tradutorSyncSpeakLabels() {
  const fromSel = document.getElementById('tradutorFrom');
  const toSel = document.getElementById('tradutorTo');
  if (!fromSel || !toSel) return;
  if (tradutorListening && tradutorRecognition) tradutorRecognition.stop();
  const from = fromSel.value;
  const to = toSel.value;
  const fromLabelEl = document.getElementById('tradutorFromLabel');
  const toLabelEl = document.getElementById('tradutorToLabel');
  if (fromLabelEl) fromLabelEl.textContent = TRADUTOR_LANGS[from].label;
  if (toLabelEl) toLabelEl.textContent = TRADUTOR_LANGS[to].label;
  const inputEl = document.getElementById('tradutorInput');
  if (inputEl) inputEl.placeholder = `Digite ou fale aqui o texto em ${TRADUTOR_LANGS[from].label.toLowerCase()}...`;
  tradutorSaveLangPref();
}

function tradutorSaveLangPref() {
  const fromSel = document.getElementById('tradutorFrom');
  const toSel = document.getElementById('tradutorTo');
  if (!fromSel || !toSel) return;
  try {
    localStorage.setItem('argo_tradutor_langs', JSON.stringify({ from: fromSel.value, to: toSel.value }));
  } catch (e) { /* localStorage indisponível — ignora silenciosamente */ }
}

function tradutorLoadLangPref() {
  const fromSel = document.getElementById('tradutorFrom');
  const toSel = document.getElementById('tradutorTo');
  if (!fromSel || !toSel) return;
  try {
    const saved = JSON.parse(localStorage.getItem('argo_tradutor_langs') || 'null');
    if (saved && TRADUTOR_LANGS[saved.from] && TRADUTOR_LANGS[saved.to]) {
      fromSel.value = saved.from;
      toSel.value = saved.to;
    }
  } catch (e) { /* preferência ausente ou corrompida — usa o padrão */ }
}

function tradutorSwapLangs() {
  const fromSel = document.getElementById('tradutorFrom');
  const toSel = document.getElementById('tradutorTo');
  const inputEl = document.getElementById('tradutorInput');
  const outputEl = document.getElementById('tradutorOutput');
  if (!fromSel || !toSel || !inputEl || !outputEl) return;

  const tmpLang = fromSel.value;
  fromSel.value = toSel.value;
  toSel.value = tmpLang;

  const tmpText = inputEl.value;
  inputEl.value = outputEl.value;
  outputEl.value = tmpText;

  tradutorSyncSpeakLabels();
  const speakTo = document.getElementById('tradutorSpeakTo');
  if (speakTo) speakTo.disabled = !outputEl.value.trim();
  tradutorClearStatus();
  tradutorUpdateCharCount();
}

function tradutorSetStatus(msg, kind) {
  const el = document.getElementById('tradutorStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'tradutor-status' + (kind ? ' is-' + kind : '');
}

function tradutorClearStatus() {
  tradutorSetStatus('', '');
}

function tradutorUpdateCharCount() {
  const inputEl = document.getElementById('tradutorInput');
  const countEl = document.getElementById('tradutorCharCount');
  if (!inputEl || !countEl) return;
  const len = inputEl.value.length;
  countEl.textContent = `${len}/${TRADUTOR_MAX_CHARS}`;
  countEl.classList.toggle('is-near-limit', len >= TRADUTOR_MAX_CHARS * 0.9 && len < TRADUTOR_MAX_CHARS);
  countEl.classList.toggle('is-over-limit', len >= TRADUTOR_MAX_CHARS);
}

function tradutorHandleInput() {
  tradutorClearStatus();
  tradutorUpdateCharCount();
}

function tradutorHandleInputKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    tradutorTranslate();
  }
}

function tradutorClear() {
  const inputEl = document.getElementById('tradutorInput');
  const outputEl = document.getElementById('tradutorOutput');
  const speakTo = document.getElementById('tradutorSpeakTo');
  if (tradutorListening && tradutorRecognition) tradutorRecognition.stop();
  if (inputEl) { inputEl.value = ''; inputEl.focus(); }
  if (outputEl) outputEl.value = '';
  if (speakTo) speakTo.disabled = true;
  tradutorClearStatus();
  tradutorUpdateCharCount();
}

async function tradutorTranslate() {
  const input = document.getElementById('tradutorInput');
  const output = document.getElementById('tradutorOutput');
  const from = document.getElementById('tradutorFrom').value;
  const to = document.getElementById('tradutorTo').value;
  const text = input.value.trim();
  const btn = document.getElementById('tradutorGoBtn');
  const speakTo = document.getElementById('tradutorSpeakTo');

  if (!text) {
    tradutorSetStatus('Digite um texto para traduzir.', 'error');
    return;
  }
  if (text.length > TRADUTOR_MAX_CHARS) {
    tradutorSetStatus(`Texto muito longo (${text.length} caracteres) — o serviço de tradução aceita até ${TRADUTOR_MAX_CHARS}. Divida em partes menores.`, 'error');
    return;
  }
  if (from === to) {
    output.value = text;
    if (speakTo) speakTo.disabled = false;
    tradutorSetStatus('Os idiomas são iguais — nada para traduzir.', '');
    return;
  }

  const cacheKey = `${from}|${to}|${text}`;
  const cached = tradutorCache.get(cacheKey);
  if (cached) {
    output.value = cached;
    if (speakTo) speakTo.disabled = false;
    tradutorSetStatus('Tradução concluída.', 'success');
    return;
  }

  btn.disabled = true;
  tradutorSetStatus('Traduzindo...', '');
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from}|${to}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('network');
    const data = await res.json();
    const translated = data && data.responseData && data.responseData.translatedText;
    const status = data && data.responseStatus ? Number(data.responseStatus) : 200;
    if (!translated || status >= 400) throw new Error('bad response');
    // O MyMemory às vezes devolve status 200 mas com um aviso de cota
    // esgotada dentro do próprio texto traduzido, em vez de um erro HTTP —
    // sem esse tratamento, esse aviso em inglês seria mostrado ao técnico
    // e ao estrangeiro atendido como se fosse a tradução de verdade.
    if (/MYMEMORY WARNING/i.test(translated)) {
      tradutorSetStatus('O serviço de tradução gratuito atingiu o limite diário de uso. Tente novamente mais tarde ou em outro horário.', 'error');
      return;
    }
    output.value = translated;
    if (speakTo) speakTo.disabled = false;
    tradutorSetStatus('Tradução concluída.', 'success');
    if (tradutorCache.size >= TRADUTOR_CACHE_MAX) {
      tradutorCache.delete(tradutorCache.keys().next().value);
    }
    tradutorCache.set(cacheKey, translated);
  } catch (e) {
    tradutorSetStatus('Não foi possível traduzir agora. Verifique a internet e tente novamente.', 'error');
  } finally {
    btn.disabled = false;
  }
}

// Em alguns navegadores (principalmente Chrome no primeiro uso da página),
// a lista de vozes do speechSynthesis carrega de forma assíncrona: chamar
// falar antes dela estar pronta silenciosamente não emitia nenhum som. Esta
// função espera o evento "voiceschanged" (com um tempo limite de segurança)
// antes da primeira fala.
let tradutorVoicesReadyPromise = null;
function tradutorEnsureVoices() {
  if (window.speechSynthesis.getVoices().length) return Promise.resolve();
  if (tradutorVoicesReadyPromise) return tradutorVoicesReadyPromise;
  tradutorVoicesReadyPromise = new Promise(resolve => {
    const done = () => resolve();
    window.speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1200);
  });
  return tradutorVoicesReadyPromise;
}

async function tradutorSpeak(which) {
  if (!('speechSynthesis' in window)) {
    tradutorSetStatus('Este navegador não tem suporte a voz.', 'error');
    return;
  }
  const langCode = which === 'from' ? document.getElementById('tradutorFrom').value : document.getElementById('tradutorTo').value;
  const text = which === 'from' ? document.getElementById('tradutorInput').value : document.getElementById('tradutorOutput').value;
  if (!text || !text.trim()) return;
  await tradutorEnsureVoices();
  const slow = document.getElementById('tradutorSlowSpeech');
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = TRADUTOR_LANGS[langCode].voice;
  utter.rate = (slow && slow.checked) ? 0.7 : 1;
  utter.onerror = () => tradutorSetStatus('Não foi possível reproduzir o áudio.', 'error');
  window.speechSynthesis.speak(utter);
}

/* Entrada de voz: transcreve a fala direto no campo de origem, no
   idioma selecionado em "tradutorFrom". Some com o botão (fica
   desabilitado) em navegadores sem suporte, como Firefox desktop. */
function tradutorToggleMic() {
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognitionCtor) {
    tradutorSetStatus('Este navegador não tem suporte a reconhecimento de voz.', 'error');
    return;
  }
  const micBtn = document.getElementById('tradutorMicBtn');

  if (tradutorListening) {
    if (tradutorRecognition) tradutorRecognition.stop();
    return;
  }

  const fromSel = document.getElementById('tradutorFrom');
  const inputEl = document.getElementById('tradutorInput');
  if (!fromSel || !inputEl) return;

  const baseText = inputEl.value.trim() ? inputEl.value.trim() + ' ' : '';
  tradutorRecognition = new SpeechRecognitionCtor();
  tradutorRecognition.lang = TRADUTOR_LANGS[fromSel.value].voice;
  tradutorRecognition.interimResults = true;
  tradutorRecognition.continuous = true;

  tradutorRecognition.onstart = () => {
    tradutorListening = true;
    if (micBtn) micBtn.classList.add('is-listening');
    tradutorSetStatus('Ouvindo... fale agora.', '');
  };

  tradutorRecognition.onresult = (event) => {
    let finalChunk = '';
    let interimChunk = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalChunk += transcript + ' ';
      else interimChunk += transcript;
    }
    inputEl.value = baseText + finalChunk + interimChunk;
    tradutorUpdateCharCount();
  };

  tradutorRecognition.onerror = () => {
    tradutorSetStatus('Não foi possível captar o áudio. Tente novamente.', 'error');
  };

  tradutorRecognition.onend = () => {
    tradutorListening = false;
    if (micBtn) micBtn.classList.remove('is-listening');
    tradutorClearStatus();
  };

  try {
    tradutorRecognition.start();
  } catch (e) {
    tradutorSetStatus('Não foi possível ativar o microfone.', 'error');
  }
}

function tradutorCopy(which) {
  const el = which === 'from' ? document.getElementById('tradutorInput') : document.getElementById('tradutorOutput');
  const btn = which === 'from' ? document.getElementById('tradutorCopyFrom') : document.getElementById('tradutorCopyTo');
  if (!el || !el.value.trim()) return;

  const showCopied = () => {
    if (!btn) return;
    const original = btn.innerHTML;
    btn.innerHTML = ICONS.check;
    btn.disabled = true;
    setTimeout(() => { btn.innerHTML = original; btn.disabled = false; }, 1400);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(el.value).then(showCopied).catch(() => {
      el.select();
      document.execCommand('copy');
      showCopied();
    });
  } else {
    el.select();
    document.execCommand('copy');
    showCopied();
  }
}

// Frases próprias do técnico, salvas em localStorage (somente neste
// aparelho/navegador) e somadas às frases fixas do app — cada CRAS/técnico
// acaba tendo perguntas de rotina diferentes das oito frases padrão.
function tradutorLoadCustomPhrases() {
  try {
    const saved = JSON.parse(localStorage.getItem(TRADUTOR_CUSTOM_KEY) || '[]');
    tradutorCustomPhrases = Array.isArray(saved) ? saved.filter(p => typeof p === 'string' && p.trim()) : [];
  } catch (e) {
    tradutorCustomPhrases = [];
  }
}

function tradutorSaveCustomPhrases() {
  try {
    localStorage.setItem(TRADUTOR_CUSTOM_KEY, JSON.stringify(tradutorCustomPhrases));
  } catch (e) { /* localStorage indisponível — ignora silenciosamente */ }
}

function tradutorAllPhrases() {
  return TRADUTOR_PHRASES.map((p, i) => ({ text: p, custom: false, idx: i }))
    .concat(tradutorCustomPhrases.map((p, i) => ({ text: p, custom: true, idx: i })));
}

function tradutorAddPhrase() {
  const input = document.getElementById('tradutorNewPhrase');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  const exists = tradutorAllPhrases().some(p => p.text.toLowerCase() === text.toLowerCase());
  if (exists) {
    tradutorSetStatus('Essa frase já está na lista.', 'warn');
    return;
  }
  tradutorCustomPhrases.push(text);
  tradutorSaveCustomPhrases();
  input.value = '';
  tradutorRenderPhrases(document.getElementById('tradutorPhraseSearch')?.value || '');
}

function tradutorRemoveCustomPhrase(idx) {
  tradutorCustomPhrases.splice(idx, 1);
  tradutorSaveCustomPhrases();
  tradutorRenderPhrases(document.getElementById('tradutorPhraseSearch')?.value || '');
}

// Guarda o texto de cada frase mostrada na tela atual, na mesma ordem dos
// botões renderizados — o clique manda só a posição nesta lista (evita ter
// que colocar o texto da frase, com aspas e acentos, dentro do atributo
// onclick do HTML).
let tradutorPhraseRenderCache = [];

function tradutorRenderPhrases(filter) {
  const list = document.getElementById('tradutorPhraseList');
  if (!list) return;
  const term = (filter || '').trim().toLowerCase();
  const items = tradutorAllPhrases().filter(({ text }) => !term || text.toLowerCase().includes(term));
  tradutorPhraseRenderCache = items.map(({ text }) => text);

  if (!items.length) {
    list.innerHTML = '<div class="tradutor-phrase-empty">Nenhuma frase encontrada.</div>';
    return;
  }

  list.innerHTML = items.map(({ text, custom, idx }, pos) => `
    <div class="tradutor-phrase-item${custom ? ' is-custom' : ''}">
      <span>${escapeHtml(text)}</span>
      <span class="tradutor-phrase-item-btns">
        ${custom ? `<button type="button" class="tradutor-phrase-remove" onclick="tradutorRemoveCustomPhrase(${idx})" title="Remover frase" aria-label="Remover frase">${ICONS.trashSmall}</button>` : ''}
        <button type="button" onclick="tradutorUsePhrase(${pos})">${ICONS.translate} Traduzir</button>
      </span>
    </div>
  `).join('');
}

function tradutorFilterPhrases(term) {
  tradutorRenderPhrases(term);
}

function tradutorUsePhrase(pos) {
  const phrase = tradutorPhraseRenderCache[pos];
  if (!phrase) return;
  const fromSel = document.getElementById('tradutorFrom');
  const inputEl = document.getElementById('tradutorInput');
  if (fromSel) fromSel.value = 'pt';
  if (inputEl) inputEl.value = phrase;
  tradutorSyncSpeakLabels();
  tradutorUpdateCharCount();
  tradutorTranslate();
}

function initTranslatorPanel() {
  tradutorLoadLangPref();
  tradutorSyncSpeakLabels();
  tradutorLoadCustomPhrases();
  tradutorRenderPhrases();
  tradutorUpdateCharCount();
  const micBtn = document.getElementById('tradutorMicBtn');
  if (micBtn && !(window.SpeechRecognition || window.webkitSpeechRecognition)) {
    micBtn.disabled = true;
    micBtn.title = 'Reconhecimento de voz não disponível neste navegador';
  }
}

/* ============================================================
   MAPA DA REDE — mapa Leaflet com "minha localização" e pins dos
   equipamentos, reaproveitando o mesmo cache de geocodificação e a
   mesma lógica de distância já usados pelo botão "Ordenar por
   proximidade" da lista. O Leaflet (JS + CSS) só é baixado do cdnjs
   na primeira vez que essa aba é aberta — mesmo princípio das
   Ferramentas de Arquivo (PDF) — por isso não entra no cache
   offline do Service Worker.
   ============================================================ */
const MAPA_REDE_CDN = {
  leafletJs: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  leafletCss: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  clusterJs: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/leaflet.markercluster.js',
  clusterCss: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.css',
  clusterCssDefault: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.Default.css'
};

const mapaRedeScriptPromises = {};
function mapaRedeLoadScript(url) {
  if (mapaRedeScriptPromises[url]) return mapaRedeScriptPromises[url];
  mapaRedeScriptPromises[url] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = () => resolve();
    s.onerror = () => { delete mapaRedeScriptPromises[url]; reject(new Error('Falha ao carregar ' + url)); };
    document.head.appendChild(s);
  });
  return mapaRedeScriptPromises[url];
}
function mapaRedeLoadCss(url) {
  if (document.querySelector(`link[href="${url}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = url;
  document.head.appendChild(l);
}
async function ensureLeaflet() {
  mapaRedeLoadCss(MAPA_REDE_CDN.leafletCss);
  mapaRedeLoadCss(MAPA_REDE_CDN.clusterCss);
  mapaRedeLoadCss(MAPA_REDE_CDN.clusterCssDefault);
  if (!window.L) await mapaRedeLoadScript(MAPA_REDE_CDN.leafletJs);
  if (!window.L.markerClusterGroup) await mapaRedeLoadScript(MAPA_REDE_CDN.clusterJs);
  return window.L;
}

// Centro padrão do mapa: Boa Vista - RR (usado até a localização do
// usuário ou o primeiro equipamento geocodificado estarem disponíveis).
const MAPA_REDE_DEFAULT_CENTER = { lat: 2.8235, lon: -60.6758 };

let mapaRedeMap = null;
let mapaRedeMarkersLayer = null;
let mapaRedeUserMarker = null;

/* ------------------------------------------------------------------------
   UNIDADES DE CRAS E CREAS DE BOA VISTA — coordenadas exatas
   ------------------------------------------------------------------------
   Fonte: projeto irmão "Rede SUAS Boa Vista" (data.js, objeto UNITS), que
   mantém as 11 unidades da rede socioassistencial de Boa Vista já com
   latitude/longitude conferidas manualmente. Diferente dos demais itens do
   Mapa da Rede — que dependem de geocodificação automática do endereço via
   Nominatim/OpenStreetMap, podendo levar alguns segundos e ocasionalmente
   errar —, essas coordenadas aparecem no mapa imediatamente, sem consulta
   de rede.
   As entradas de categoria "cras"/"cas" do DATA principal (equipe-cras-
   cristiana.js) são cartões de acesso a ferramentas internas do CRAS
   Cristiana Vicente Nunes (RMA, equipe técnica etc.), não uma lista de
   unidades — por isso continuam fora do mapa e esta lista completa a rede.
   Para atualizar uma unidade (endereço, telefone, bairros, coordenada),
   edite apenas o array abaixo. */
const UNITS_CRAS_CREAS = {
  cras: [
    { name: "CRAS Cristiana Vicente Nunes", lat: 2.794228, lng: -60.715304, color: "red", address: "Rua Santo Agostinho, 193 - Centenário", phone: "(95) 98402-6617", bairros: "13 de Setembro, Asa Branca, Buritis, Caimbé, Cambará, Centenário, Cinturão Verde, Jóquei Clube, Liberdade, Marechal Rondon, Nova Canaã, Olímpico, Pricumã, Professora Araceli Souto Maior, Tancredo Neves" },
    { name: "CRAS Pintolândia", lat: 2.8105851871073004, lng: -60.74498923145661, color: "blue", address: "R. Sólon Rodrigues Pessoa, 615 - Nova Canaã (Sede do FQA)", phone: "(95) 98407-3680", bairros: "Dr. Silvio Botelho, Jardim Tropical, Pintolândia, Santa Luzia, Senador Hélio Campos" },
    { name: "CRAS Nova Cidade", lat: 2.763968, lng: -60.730548, color: "green", address: "Rua Curitiba, 336 - Nova Cidade", phone: "(95) 98403-0174", bairros: "Bela Vista, Dr. Airton Rocha, Conjunto Pérola, Ajuricaba, Governador Aquilino Mota Duarte, Jardim Copaíbas, Distrito Industrial, Nova Cidade, Operário, Raiar do Sol, São Bento" },
    { name: "CRAS Dr. Silvio Leite", lat: 2.824589, lng: -60.744222, color: "purple", address: "R. Marieta de Mello Marquês, 869 - Dr. Silvio Leite", phone: "(95) 98403-1682", bairros: "Alvorada, Dr. Silvio Leite, Equatorial, Nova Esperança, Conjunto Cruviana, Jardim Primavera, Laura Moreira, Conjunto Cidadão, Conjunto Manaíra" },
    { name: "CRAS União", lat: 2.844086, lng: -60.727368, color: "orange", address: "R. Hilda Sobral Guedes, 81 - Bairro União", phone: "(95) 98405-9001", bairros: "Cidade Satélite, Conjunto Universitário, Vila Jardim, João de Barro, Murilo Teixeira, Piscicultura, Santa Tereza, Jardim Caranã, União" },
    { name: "CRAS Cauamé", lat: 2.828707, lng: -60.699579, color: "darkred", address: "Av. Carlos Pereira de Melo, 207 - Jardim Floresta", phone: "(95) 98410-1337", bairros: "Aeroporto, Monte das Oliveiras, Cauamé, Caranã, Jardim Floresta, Said Salomão, Pedra Pintada" },
    { name: "CRAS São Francisco", lat: 2.817229, lng: -60.666111, color: "darkblue", address: "R. Floriano Peixoto, 140 - Centro", phone: "(95) 98410-4092", bairros: "31 de Março, Caçari, Calungá, Canarinho, Centro, Dos Estados, Mecejana, Nossa Senhora de Aparecida, Paraviana, São Francisco, São Pedro, São Vicente" },
    { name: "CRAS Itinerante", lat: 2.829942, lng: -60.678552, color: "cadetblue", address: "R. Maj. Manoel Corrêa, 620 - São Francisco", phone: "N/A", bairros: "Comunidades Indígenas e Zona Rural de Boa Vista" }
  ],
  creas: [
    { name: "CREAS Centenário", lat: 2.7973795, lng: -60.718835, color: "blue", address: "R. Turin, 282 - Centenário", phone: "(95) 98412-1829", bairros: "Alvorada, Cambará, Centenário, Cinturão Verde, Cruviana, Dr. Airton Rocha, Dr. Sílvio Botelho, Dr. Sílvio Leite, Equatorial, Governador Aquilo da Mota Duarte, Jardim Bela Vista, Jardim das Copaíbas, Jóquei Clube, Nova Canaã, Olímpico, Araceli, Jardim Primavera, Tropical, Laura Moreira, Rondon, Manaíra, Murilo Teixeira, Operário, Pintolândia, Piscicultura, Raiar do Sol, São Bento, Santa Luzia, Hélio Campos" },
    { name: "CREAS Centro", lat: 2.8217647, lng: -60.678314, color: "darkblue", address: "Av. Mário Homem de Melo, 514 - Centro", phone: "(95) 98404-5621", bairros: "13 de Setembro, 31 de Março, Aeroporto, Aparecida, Área Rural e Indígena, Asa Branca, Buritis, Caçari, Caetano Filho, Caimbé, Calungá, Canarinho, Caranã, Cauamé, Centro, Cidade Satélite, Estados, Jardim Caranã, Jardim Floresta, João de Barro, Liberdade, Mecejana, Monte das Oliveiras, Paraviana, Pedra Pintada, Pricumã, Salomão, São Francisco, São Pedro, São Vicente, Tancredo Neves, União" },
    { name: "Abrigo Infantil Pedra Pintada", lat: 2.7961607, lng: -60.703623, color: "green", address: "R. Interna, 182 - Centenário", phone: "Atendimento Direto", bairros: "Crianças de até 12 anos incompleto em situação de vulnerabilidade social" }
  ]
};

// Cores nomeadas (mesmo padrão do projeto Rede SUAS Boa Vista) convertidas
// para hexadecimal, usadas no pino colorido de cada unidade no mapa.
const MAPA_REDE_COLOR_HEX = {
  red: '#d63e2a', blue: '#38aadd', green: '#72b026', purple: '#d252b9',
  orange: '#f69730', darkred: '#a23336', darkblue: '#0067a3', cadetblue: '#436978'
};

// Pino em formato de gota, colorido por unidade — mesma ideia visual do
// marcador padrão do Leaflet, mas sem depender de imagens externas (o pino
// é desenhado em SVG, então funciona mesmo offline, diferente dos ícones
// padrão do Leaflet que vêm de arquivos de imagem).
function mapaRedeCrasCreasIcon(colorHex) {
  return L.divIcon({
    className: 'mapa-rede-crascreas-icon',
    html: `
      <svg width="30" height="42" viewBox="0 0 30 42" xmlns="http://www.w3.org/2000/svg">
        <path d="M15 0C6.7 0 0 6.7 0 15c0 11 15 27 15 27s15-16 15-27C30 6.7 23.3 0 15 0z" fill="${colorHex}" stroke="#fff" stroke-width="2"/>
        <circle cx="15" cy="15" r="6" fill="#fff"/>
      </svg>`,
    iconSize: [30, 42],
    iconAnchor: [15, 40],
    popupAnchor: [0, -36]
  });
}

// Cor "dominante" de um cluster: conta a cor de cada marcador agrupado nele
// (guardada em marker.options.categoryColor, ver abaixo) e usa a mais
// frequente. Sem isso, o círculo do cluster ficava sempre cinza/verde/laranja
// genérico (estilo padrão do plugin), sem nenhuma relação com a cor da
// categoria — a cor por categoria só aparecia quando o pino estava sozinho,
// sem se agrupar, o que é raro na maioria dos zooms.
function mapaRedeClusterIcon(cluster) {
  const counts = {};
  cluster.getAllChildMarkers().forEach(m => {
    const c = (m.options && m.options.categoryColor) || MAP_CATEGORY_FALLBACK_COLOR;
    counts[c] = (counts[c] || 0) + 1;
  });
  const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  return L.divIcon({
    className: 'mapa-rede-cluster',
    html: `<div style="background:${dominant};">${cluster.getChildCount()}</div>`,
    iconSize: [38, 38]
  });
}

let mapaRedeCrasCreasLayer = null;

// Uma cor por categoria (mesma lista usada no filtro do Mapa da Rede,
// CATEGORY_LABELS_PRINT sem "cas"/"cras"/"interior"), para os pinos dos
// equipamentos do diretório principal — que até aqui usavam todos o mesmo
// marcador azul padrão do Leaflet, dificultando identificar de longe o tipo
// de equipamento quando várias categorias aparecem juntas no mapa (opção
// "Todas as categorias").
const MAP_CATEGORY_COLORS = {
  hospitalar:        '#e63946', // Rede Hospitalar e Atenção Básica
  saude:              '#9b5de5', // Rede de Atenção Psicossocial (RAPS)
  tea:                '#118ab2', // Rede de Atenção à Pessoa com Deficiência e TEA
  social:             '#2a9d8f', // Proteção Social Básica e Especial (SUAS)
  educacao:           '#f4a261', // Educação Básica
  juridico:           '#264653', // Poder Judiciário
  conselho:           '#e76f51', // Conselho Tutelar
  delegacias:         '#023e8a', // Segurança Pública
  bancos:             '#40916c', // Rede Bancária e Correspondentes
  previdencia:        '#7209b7', // Previdência Social (INSS)
  trabalho:           '#bc6c25', // Trabalho, Emprego e Renda
  habitacao:          '#6a4c93', // Habitação e Moradia
  mobilidade:         '#457b9d', // Mobilidade Urbana
  informes:           '#ffb703', // Programas, Projetos e Serviços
  documentacao:       '#8338ec', // Documentação Civil e Fiscal
  idoso:              '#ff6b6b', // Pessoa Idosa
  migracao:           '#06a77d', // Serviço de Migração
  alimentar:          '#f77f00', // Segurança Alimentar e Nutricional
  mulher:             '#d90429', // Enfrentamento à Violência contra a Mulher
  cultura:            '#c9184a', // Cultura, Esporte e Lazer
  defesacivil:        '#fb8500', // Defesa Civil e Situações de Emergência
  conselhosdireitos:  '#583d72'  // Conselhos Municipais de Direitos
};
const MAP_CATEGORY_FALLBACK_COLOR = '#4363d8';

// Cor de um item: pega a primeira categoria dele que já tem cor definida
// (um item pode ter mais de uma categoria); se nenhuma tiver, usa o azul
// padrão acima.
function mapaRedeItemColor(item) {
  const cat = (item.cat || []).find(c => MAP_CATEGORY_COLORS[c]);
  return cat ? MAP_CATEGORY_COLORS[cat] : MAP_CATEGORY_FALLBACK_COLOR;
}

// Mesmo desenho de pino em gota usado para CRAS/CREAS, reaproveitado para os
// equipamentos do diretório principal, cada um na cor da sua categoria.
function mapaRedeCategoryIcon(colorHex) {
  return L.divIcon({
    className: 'mapa-rede-item-icon',
    html: `
      <svg width="26" height="36" viewBox="0 0 30 42" xmlns="http://www.w3.org/2000/svg">
        <path d="M15 0C6.7 0 0 6.7 0 15c0 11 15 27 15 27s15-16 15-27C30 6.7 23.3 0 15 0z" fill="${colorHex}" stroke="#fff" stroke-width="2"/>
        <circle cx="15" cy="15" r="5.5" fill="#fff"/>
      </svg>`,
    iconSize: [26, 36],
    iconAnchor: [13, 34],
    popupAnchor: [0, -30]
  });
}

/* ==========================================================================
   ABA "NOTÍCIAS DO MDS"
   --------------------------------------------------------------------------
   Lê os feeds RSS públicos do Ministério do Desenvolvimento e Assistência
   Social (MDS), do Ministério da Educação (MEC) e do Ministério da Saúde
   (MS) e lista as publicações mais recentes de todos juntos: notícias,
   instruções normativas e portarias — com uma etiqueta indicando de qual
   ministério cada publicação veio.

   O portal gov.br não envia o cabeçalho Access-Control-Allow-Origin, então o
   navegador bloqueia a leitura direta do feed a partir de outro domínio
   (CORS). Por isso tentamos, nesta ordem, para cada feed:
     1) buscar o feed direto (funciona se o gov.br um dia liberar CORS, e
        funciona hoje quando o app é aberto como arquivo local em alguns
        navegadores);
     2) reler o mesmo endereço através de um repassador público (allorigins,
        depois corsproxy), que apenas copia o XML e devolve com CORS liberado.
   Nenhum dado de atendido sai do aparelho: a única coisa pedida é a lista
   pública de notícias de cada ministério.

   O resultado fica guardado em localStorage, sem criptografia (é conteúdo
   público), para que a aba abra instantaneamente e continue mostrando a
   última lista baixada mesmo sem internet.
   ========================================================================== */

// Um "source" por ministério: id (usado no filtro e no cache), rótulo
// mostrado na etiqueta de cada publicação, feed(s) RSS (o segundo de cada
// lista é um reforço — se sair do ar, é simplesmente ignorado) e o link do
// site para o botão "Abrir o site". Para incluir mais um ministério no
// futuro, basta acrescentar um item aqui.
const NEWS_SOURCES = [
  {
    id: 'mds',
    label: 'MDS',
    fullLabel: 'Ministério do Desenvolvimento e Assistência Social, Família e Combate à Fome',
    feeds: ['https://www.gov.br/mds/RSS', 'https://www.gov.br/mds/pt-br/noticias/RSS'],
    siteUrl: 'https://www.gov.br/mds/pt-br'
  },
  {
    id: 'mec',
    label: 'MEC',
    fullLabel: 'Ministério da Educação',
    feeds: ['https://www.gov.br/mec/RSS', 'https://www.gov.br/mec/pt-br/noticias/RSS'],
    siteUrl: 'https://www.gov.br/mec/pt-br'
  },
  {
    id: 'saude',
    label: 'Saúde',
    fullLabel: 'Ministério da Saúde',
    feeds: ['https://www.gov.br/saude/RSS', 'https://www.gov.br/saude/pt-br/noticias/RSS'],
    siteUrl: 'https://www.gov.br/saude/pt-br'
  }
];
const NEWS_CACHE_KEY = 'argo_noticias_mds_v2';
const NEWS_MAX_ITEMS = 45;

// Repassadores tentados em ordem. O primeiro é a tentativa direta.
const NEWS_FETCHERS = [
  { label: 'direto', build: url => url },
  { label: 'allorigins', build: url => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url) },
  { label: 'corsproxy', build: url => 'https://corsproxy.io/?url=' + encodeURIComponent(url) }
];

function newsReadCache() {
  try {
    const raw = localStorage.getItem(NEWS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items) || !parsed.items.length) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

function newsWriteCache(items) {
  try {
    localStorage.setItem(NEWS_CACHE_KEY, JSON.stringify({ ts: Date.now(), items }));
  } catch (e) {
    // Sem espaço no navegador: a aba continua funcionando, só não guarda offline.
  }
}

// Lê um campo de um <item> sem depender do prefixo de namespace (o feed do
// gov.br é RSS 1.0/RDF e usa dc:date, dc:type etc.).
function newsField(item, tag) {
  const found = item.getElementsByTagNameNS('*', tag);
  return found && found.length ? (found[0].textContent || '').trim() : '';
}

function newsParseFeed(xmlText, sourceId) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('XML inválido');

  const nodes = Array.from(doc.getElementsByTagNameNS('*', 'item'));
  return nodes
    .map(item => ({
      title: newsField(item, 'title'),
      link: newsField(item, 'link') || item.getAttribute('rdf:about') || '',
      desc: newsField(item, 'description'),
      date: newsField(item, 'date') || newsField(item, 'pubDate'),
      type: newsField(item, 'type'),
      source: sourceId
    }))
    // O feed traz também PDFs e imagens soltas do portal (dc:type "File" e
    // "Image"), que não interessam aqui. Ficam só os conteúdos editoriais
    // (notícias, instruções normativas, portarias) com título preenchido.
    .filter(it => it.title && it.link && it.type !== 'File' && it.type !== 'Image')
    .slice(0, NEWS_MAX_ITEMS);
}

// Busca UM feed, tentando o acesso direto e depois os repassadores.
async function newsFetchOne(feedUrl, sourceId) {
  let lastError = null;
  for (const fetcher of NEWS_FETCHERS) {
    try {
      const resp = await fetch(fetcher.build(feedUrl), { cache: 'no-store' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const items = newsParseFeed(await resp.text(), sourceId);
      if (items.length) return items;
      throw new Error('feed vazio');
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('falha ao buscar o feed');
}

// Busca os feeds de um único ministério (principal + reforço), juntando e
// tirando repetidos pelo endereço.
async function newsFetchSource(source) {
  const results = await Promise.allSettled(source.feeds.map(url => newsFetchOne(url, source.id)));
  const merged = new Map();
  results.forEach(r => {
    if (r.status !== 'fulfilled') return;
    r.value.forEach(it => { if (!merged.has(it.link)) merged.set(it.link, it); });
  });
  if (!merged.size) {
    const firstError = results.find(r => r.status === 'rejected');
    throw (firstError && firstError.reason) || new Error('falha ao buscar o feed');
  }
  return Array.from(merged.values());
}

// Busca os feeds de todos os ministérios em paralelo, junta tudo e ordena do
// mais novo para o mais antigo. Só dá erro se NENHUM ministério responder;
// se só alguns falharem, a lista sai só com os que responderam e o aviso
// deixa claro quais faltaram.
async function newsFetchFeed() {
  const results = await Promise.allSettled(NEWS_SOURCES.map(newsFetchSource));
  const merged = new Map();
  const failedSources = [];

  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      r.value.forEach(it => { if (!merged.has(it.link)) merged.set(it.link, it); });
    } else {
      failedSources.push(NEWS_SOURCES[i].label);
    }
  });

  if (!merged.size) {
    const firstError = results.find(r => r.status === 'rejected');
    throw (firstError && firstError.reason) || new Error('falha ao buscar os feeds');
  }

  const items = Array.from(merged.values())
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    .slice(0, NEWS_MAX_ITEMS);

  return { items, failedSources };
}

function newsFormatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function newsFormatUpdated(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// "há 2 dias", "há 3h" etc., para facilitar a leitura rápida ao lado da
// data completa. Fica em branco além de ~30 dias (a data completa basta).
function newsRelativeTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return '';
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'agora há pouco';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const dias = Math.floor(h / 24);
  if (dias === 1) return 'há 1 dia';
  if (dias <= 30) return `há ${dias} dias`;
  return '';
}

// Classifica o item só pelo título, para dar uma etiqueta visual útil.
function newsKind(item) {
  const t = item.title.toLowerCase();
  if (t.startsWith('instrução normativa') || t.startsWith('instrucao normativa')) return 'Instrução Normativa';
  if (t.startsWith('portaria')) return 'Portaria';
  if (t.startsWith('resolução') || t.startsWith('resolucao')) return 'Resolução';
  if (t.startsWith('decreto')) return 'Decreto';
  if (t.startsWith('lei ')) return 'Lei';
  return 'Notícia';
}

// Cor de destaque por ministério, só para diferenciar rapidamente a
// etiqueta de origem de cada publicação na lista.
const NEWS_SOURCE_COLORS = {
  mds: { bg: '#e8f1f9', fg: '#0f4a41' },
  mec: { bg: '#fef3e2', fg: '#92400e' },
  saude: { bg: '#e7f7ec', fg: '#065f46' }
};

function newsSourceInfo(sourceId) {
  return NEWS_SOURCES.find(s => s.id === sourceId) || NEWS_SOURCES[0];
}

function renderNewsCard() {
  const sourceChips = NEWS_SOURCES.map(s => `
    <label class="noticias-source-chip" title="${escapeHtml(s.fullLabel)}">
      <input type="checkbox" class="noticias-source-checkbox" value="${s.id}" checked onchange="renderNewsList()">
      <span>${escapeHtml(s.label)}</span>
      <span class="noticias-source-count" id="noticiasCount-${s.id}"></span>
    </label>
  `).join('');

  const siteLinks = NEWS_SOURCES.map(s => `
    <a class="tradutor-btn-ghost" href="${s.siteUrl}" target="_blank" rel="noopener noreferrer"
       style="text-decoration:none; display:inline-flex; align-items:center; gap:0.4rem;">
      ${ICONS.external} ${escapeHtml(s.label)}
    </a>
  `).join('');

  return `
    <div class="tech-card noticias-card">
      <div class="card-top">
        <div style="display:flex; align-items:center; gap:0.55rem;">
          <span class="tradutor-badge">${ICONS.form}</span>
          <h2 style="margin:0;">Notícias do MDS, MEC e Saúde</h2>
        </div>
        <span class="subtitle">📰 Últimas publicações do Ministério do Desenvolvimento e Assistência Social, do Ministério da Educação e do Ministério da Saúde</span>
      </div>
      <div class="card-body">
        <div class="tradutor-privacy">
          ${ICONS.info}
          <span>A lista vem dos feeds públicos dos três ministérios (gov.br/mds, gov.br/mec e gov.br/saude). Como o portal não libera leitura direta por outros sites, o app pode buscar o mesmo endereço por um repassador público (allorigins/corsproxy) — só o endereço do feed é enviado, nenhum dado de atendido. A última lista baixada fica salva neste navegador e continua visível offline.</span>
        </div>

        <div class="noticias-source-filter" role="group" aria-label="Filtrar por ministério">
          ${sourceChips}
        </div>

        <div style="display:flex; flex-wrap:wrap; gap:0.6rem; align-items:center; margin:0.85rem 0;">
          <input type="search" id="noticiasFilter" placeholder="Filtrar por palavra (ex.: Bolsa Família, CadÚnico, SUAS)…"
                 aria-label="Filtrar notícias por palavra"
                 oninput="renderNewsList()"
                 style="flex:1; min-width:220px; padding:0.55rem 0.75rem; border-radius:8px; border:1px solid #dbe3ea; font:inherit;">
          <button type="button" class="tradutor-btn" id="noticiasRefreshBtn" onclick="refreshNews()">
            ${ICONS.cloud} Atualizar
          </button>
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:0.5rem; margin-bottom:0.85rem;">
          ${siteLinks}
        </div>

        <div id="noticiasStatus" style="font-size:0.85rem; color:var(--text-muted, #64748b); margin-bottom:0.6rem;"></div>
        <div id="noticiasList"></div>
      </div>
    </div>
  `;
}

// Lista atualmente carregada em memória (preenchida pelo cache e pela rede).
let newsState = { items: [], ts: 0, loading: false };

// Guarda quando a aba foi vista pela última vez, só para destacar com a
// etiqueta "Novo" as publicações mais recentes que essa marca. Atualizada
// no fim de initNewsPanel, depois que a lista já foi lida/renderizada.
const NEWS_LAST_SEEN_KEY = 'argo_noticias_last_seen_v1';
let newsLastSeenTs = 0;

function newsSetStatus(msg) {
  const el = document.getElementById('noticiasStatus');
  if (el) el.innerHTML = msg || '';
}

function newsSelectedSources() {
  const boxes = document.querySelectorAll('.noticias-source-checkbox');
  if (!boxes.length) return null; // painel ainda não montado: não filtra
  return new Set(Array.from(boxes).filter(b => b.checked).map(b => b.value));
}

// Atualiza o numerozinho de publicações ao lado de cada chip de ministério,
// sempre com base na lista completa (não no filtro de palavra atual), para
// o usuário saber de onde vêm as publicações antes mesmo de marcar/desmarcar.
function newsUpdateSourceCounts() {
  NEWS_SOURCES.forEach(s => {
    const el = document.getElementById(`noticiasCount-${s.id}`);
    if (!el) return;
    const n = newsState.items.filter(it => it.source === s.id).length;
    el.textContent = n ? `(${n})` : '';
  });
}

function newsClearFilters() {
  const filterEl = document.getElementById('noticiasFilter');
  if (filterEl) filterEl.value = '';
  document.querySelectorAll('.noticias-source-checkbox').forEach(b => { b.checked = true; });
  renderNewsList();
}

function newsSkeletonHtml() {
  return Array.from({ length: 3 }).map(() => `
    <div class="noticias-item noticias-skeleton" aria-hidden="true">
      <div class="noticias-skeleton-line" style="width:35%;"></div>
      <div class="noticias-skeleton-line" style="width:85%; height:1rem; margin-top:0.5rem;"></div>
      <div class="noticias-skeleton-line" style="width:60%;"></div>
    </div>
  `).join('');
}

function renderNewsList() {
  const list = document.getElementById('noticiasList');
  if (!list) return;

  newsUpdateSourceCounts();

  const filterEl = document.getElementById('noticiasFilter');
  const filter = filterEl ? filterEl.value.trim().toLowerCase() : '';
  const selectedSources = newsSelectedSources();

  let items = newsState.items;
  if (selectedSources) items = items.filter(it => selectedSources.has(it.source));
  if (filter) items = items.filter(it => (it.title + ' ' + it.desc).toLowerCase().includes(filter));

  if (!items.length) {
    if (newsState.loading && !newsState.items.length) {
      list.innerHTML = newsSkeletonHtml();
      return;
    }
    const hasActiveFilter = !!filter || (selectedSources && selectedSources.size < NEWS_SOURCES.length);
    list.innerHTML = `
      <div class="noticias-empty">
        <p>${newsState.items.length
          ? 'Nenhuma publicação corresponde a esse filtro.'
          : 'Nenhuma publicação carregada ainda.'}</p>
        ${hasActiveFilter ? `<button type="button" class="tradutor-btn-ghost" onclick="newsClearFilters()">Limpar filtros</button>` : ''}
      </div>`;
    return;
  }

  list.innerHTML = items.map(it => {
    const src = newsSourceInfo(it.source);
    const color = NEWS_SOURCE_COLORS[it.source] || NEWS_SOURCE_COLORS.mds;
    const isNew = newsLastSeenTs && it.date && new Date(it.date).getTime() > newsLastSeenTs;
    const rel = newsRelativeTime(it.date);
    return `
    <article class="noticias-item">
      <div class="noticias-item-tags">
        <span class="noticias-tag" title="${escapeHtml(src.fullLabel)}" style="--tag-bg:${color.bg}; --tag-fg:${color.fg};">${escapeHtml(src.label)}</span>
        <span class="noticias-tag noticias-tag-kind">${escapeHtml(newsKind(it))}</span>
        ${isNew ? `<span class="noticias-tag noticias-tag-new">Novo</span>` : ''}
        <span class="noticias-date">${escapeHtml(newsFormatDate(it.date))}${rel ? ` · ${escapeHtml(rel)}` : ''}</span>
      </div>
      <h3 class="noticias-title">
        <a href="${escapeHtml(it.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(it.title)} ${ICONS.external}</a>
      </h3>
      ${it.desc ? `<p class="noticias-desc">${escapeHtml(it.desc)}</p>` : ''}
    </article>
  `;
  }).join('');
}

async function refreshNews() {
  const btn = document.getElementById('noticiasRefreshBtn');
  if (btn) btn.disabled = true;
  newsState.loading = true;
  newsSetStatus(newsState.items.length ? 'Buscando publicações mais recentes…' : 'Carregando publicações…');
  if (!newsState.items.length) renderNewsList(); // sem lista salva ainda: mostra o skeleton

  try {
    const { items, failedSources } = await newsFetchFeed();
    newsState.items = items;
    newsState.ts = Date.now();
    newsWriteCache(items);
    const base = `${items.length} publicações · atualizado em ${escapeHtml(newsFormatUpdated(newsState.ts))}`;
    newsSetStatus(failedSources.length
      ? `${base} — não foi possível buscar: ${escapeHtml(failedSources.join(', '))}.`
      : base);
  } catch (e) {
    if (newsState.items.length) {
      newsSetStatus(`Não foi possível atualizar agora. Mostrando a lista salva em ${escapeHtml(newsFormatUpdated(newsState.ts))}.`);
    } else {
      newsSetStatus('Não foi possível carregar as publicações. Verifique a conexão e toque em “Atualizar”, ou abra o site de um dos ministérios acima direto no navegador.');
    }
  } finally {
    newsState.loading = false;
    if (btn) btn.disabled = false;
    renderNewsList();
  }
}

function initNewsPanel() {
  // Lê a marca de "última vez visto" ANTES de sobrescrevê-la, para que as
  // publicações mais novas que a visita anterior ganhem a etiqueta "Novo".
  newsLastSeenTs = Number(localStorage.getItem(NEWS_LAST_SEEN_KEY)) || 0;
  try { localStorage.setItem(NEWS_LAST_SEEN_KEY, String(Date.now())); } catch (e) { /* ignora */ }

  const cached = newsReadCache();
  if (cached) {
    newsState.items = cached.items;
    newsState.ts = cached.ts;
    newsSetStatus(`${cached.items.length} publicações · lista salva em ${escapeHtml(newsFormatUpdated(cached.ts))}`);
    renderNewsList();
  }

  // Sem internet: fica só com o que estiver salvo.
  if (navigator.onLine === false) {
    if (!cached) newsSetStatus('Você está offline e ainda não há publicações salvas neste aparelho.');
    renderNewsList();
    return;
  }

  // Com cache recente (menos de 2 horas), não refaz a busca automaticamente.
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  if (cached && Date.now() - cached.ts < TWO_HOURS) {
    renderNewsList();
    return;
  }

  refreshNews();
}

function renderMapCard() {
  const categoryOptions = ['<option value="all">Todas as categorias</option>']
    .concat(Object.entries(CATEGORY_LABELS_PRINT)
      .filter(([cat]) => cat !== 'cas' && cat !== 'cras' && cat !== 'interior')
      .map(([cat, label]) => `<option value="${escapeHtml(cat)}">${escapeHtml(label)}</option>`))
    .join('');

  return `
    <style>
      /* O Leaflet aplica fundo branco + borda cinza por padrão em todo
         L.divIcon (classe .leaflet-div-icon). Nossos ícones (pino colorido
         de CRAS/CREAS e o marcador azul de "você está aqui") já desenham o
         próprio contorno em SVG, então essa caixa padrão só aparece atrás
         deles como um quadrado branco indesejado — por isso é removida
         aqui, com seletor mais específico para vencer o CSS do Leaflet. */
      .leaflet-div-icon.mapa-rede-crascreas-icon,
      .leaflet-div-icon.mapa-rede-item-icon,
      .leaflet-div-icon.mapa-rede-cluster,
      .leaflet-div-icon.mapa-rede-user-icon { background: transparent; border: none; }
      .mapa-rede-cluster div {
        width: 38px; height: 38px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        color: #fff; font-weight: 800; font-size: 0.82rem;
        border: 2px solid #fff; box-shadow: 0 1px 5px rgba(0,0,0,0.35);
      }
    </style>
    <div class="tech-card mapa-rede-card">
      <div class="card-top">
        <div style="display:flex; align-items:center; gap:0.55rem;">
          <span class="tradutor-badge">${ICONS.map}</span>
          <h2 style="margin:0;">Mapa da Rede</h2>
        </div>
        <span class="subtitle">🗺️ Visualize os equipamentos no mapa e encontre os mais próximos de você</span>
      </div>
      <div class="card-body">
        <div class="tradutor-privacy">
          ${ICONS.info}
          <span>O mapa não procura endereços sozinho. Os pinos de equipamentos usam endereços que já foram localizados e ficam guardados neste navegador (o serviço gratuito Nominatim/OpenStreetMap só é consultado quando você usa "Ordenar por proximidade" na lista). As unidades de CRAS e CREAS de Boa Vista aparecem sempre, com coordenadas exatas. Cada categoria tem uma cor própria, e pinos próximos se agrupam em um número — toque no número para abrir o grupo. Toque em um pino para ver os detalhes do equipamento no painel ao lado.</span>
        </div>

        <div style="display:flex; flex-wrap:wrap; gap:0.6rem; align-items:center; margin:0.75rem 0;">
          <select id="mapaRedeCatSelect" onchange="renderMapaRedeMarkers()" aria-label="Filtrar categoria no mapa" style="flex:1; min-width:200px; padding:0.5rem 0.7rem; border-radius:8px; border:1px solid #dbe3ea;">
            ${categoryOptions}
          </select>
          <button type="button" id="mapaRedeLocateBtn" class="tradutor-btn" onclick="mapaRedeLocateMe()">
            ${ICONS.map} Minha localização
          </button>
        </div>

        <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.85rem; margin:0 0 0.6rem;">
          <input type="checkbox" id="mapaRedeShowCrasCreas" checked onchange="renderMapaRedeMarkers()">
          Mostrar unidades de CRAS e CREAS de Boa Vista (${UNITS_CRAS_CREAS.cras.length + UNITS_CRAS_CREAS.creas.length} unidades, coordenadas exatas)
        </label>

        <div id="mapaRedeStatus" style="font-size:0.85rem; color:var(--text-muted, #64748b); margin-bottom:0.5rem;"></div>

        <div class="mapa-rede-layout">
          <div id="mapaRedeMapContainer" style="border-radius:12px; overflow:hidden; border:1px solid #dbe3ea; background:#eef2f5;"></div>

          <aside id="mapaRedeDetailPanel" class="mapa-rede-detail-panel" aria-live="polite">
            ${mapaRedeDetailPlaceholder()}
          </aside>
        </div>

        <div id="mapaRedeLegend" style="display:flex; flex-wrap:wrap; gap:0.5rem 0.9rem; margin-top:0.7rem; font-size:0.78rem; color:#475569;"></div>

        <div id="mapaRedeNearbyList" style="margin-top:0.85rem;"></div>
      </div>
    </div>
  `;
}

// ------------------------------------------------------------------------
// Painel de detalhes (caixa lateral) do Mapa da Rede: mostra as informações
// completas do equipamento ou da unidade de CRAS/CREAS assim que o técnico
// toca em um pino no mapa. Em telas largas fica ao lado do mapa; em telas
// estreitas passa a aparecer abaixo dele (ver .mapa-rede-layout no CSS).
// ------------------------------------------------------------------------
function mapaRedeDetailPlaceholder() {
  return `
    <div class="mapa-rede-detail-empty">
      <span class="mapa-rede-detail-empty-icon">${ICONS.map}</span>
      <p>Toque em um pino no mapa para ver aqui o endereço, telefone e demais informações do equipamento.</p>
    </div>
  `;
}

function mapaRedeClearDetail() {
  const panel = document.getElementById('mapaRedeDetailPanel');
  if (!panel) return;
  panel.classList.remove('has-selection');
  panel.innerHTML = mapaRedeDetailPlaceholder();
}

// Distância formatada (m/km) a partir da localização atual do usuário, ou
// string vazia se "Minha localização" ainda não foi usada.
function mapaRedeDetailDistanceHtml(lat, lon) {
  if (!proximityState.active || lat == null || lon == null) return '';
  const km = haversineKm(proximityState.lat, proximityState.lon, lat, lon);
  const label = km < 1 ? Math.round(km * 1000) + ' m' : km.toFixed(1) + ' km';
  return `<div class="mapa-rede-detail-distance">${ICONS.map} <strong>${label}</strong> da sua localização atual</div>`;
}

// Mostra, na caixa lateral, os detalhes de um equipamento do diretório
// principal (objeto DATA). `coords` são as coordenadas já geocodificadas
// usadas para colocar o pino no mapa (necessárias para o link de rota e
// para o cálculo de distância).
function mapaRedeShowItemDetail(item, coords) {
  const panel = document.getElementById('mapaRedeDetailPanel');
  if (!panel) return;

  const catLabels = (item.cat || [])
    .map(c => CATEGORY_LABELS_PRINT[c] || null)
    .filter(Boolean);
  const catColor = mapaRedeItemColor(item);

  const phonesHtml = (item.phones || [])
    .filter(p => p && p.trim() && p.trim().toUpperCase() !== 'N/A')
    .map(p => `<a class="mapa-rede-detail-link" href="tel:${escapeHtml(p.replace(/[^\d+]/g, ''))}">${ICONS.phone}<span>${escapeHtml(p)}</span></a>`)
    .join('');

  const routeHref = coords
    ? `https://www.google.com/maps/dir/?api=1&destination=${coords.lat},${coords.lon}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.address || item.name || '')}`;

  panel.innerHTML = `
    <div class="mapa-rede-detail-head">
      <div class="mapa-rede-detail-cats">
        ${catLabels.map(l => `<span class="mapa-rede-detail-badge" style="background:${catColor}1a; color:${catColor};">${escapeHtml(l)}</span>`).join('')}
      </div>
      <button type="button" class="mapa-rede-detail-close" onclick="mapaRedeClearDetail()" aria-label="Fechar detalhes">✕</button>
    </div>
    <h3 class="mapa-rede-detail-title">${escapeHtml(item.fullName || item.name || '')}</h3>
    ${mapaRedeDetailDistanceHtml(coords ? coords.lat : null, coords ? coords.lon : null)}
    <div class="mapa-rede-detail-row">${ICONS.map}<span>${escapeHtml(item.address || 'Endereço não informado')}</span></div>
    ${item.hours ? `<div class="mapa-rede-detail-row">${ICONS.clock}<span>${escapeHtml(item.hours)}</span></div>` : ''}
    ${phonesHtml ? `<div class="mapa-rede-detail-phones">${phonesHtml}</div>` : ''}
    ${item.services ? `<div class="mapa-rede-detail-block"><strong>Serviços</strong><p>${escapeHtml(item.services)}</p></div>` : ''}
    ${item.desc ? `<div class="mapa-rede-detail-block mapa-rede-detail-desc"><p>${escapeHtml(item.desc)}</p></div>` : ''}
    <div class="mapa-rede-detail-actions">
      <a class="btn-tech btn-secondary btn-link" href="${routeHref}" target="_blank" rel="noopener noreferrer">${ICONS.map} Traçar rota</a>
    </div>
  `;
  panel.classList.add('has-selection');
}

// Mesma ideia acima, mas para as unidades de CRAS/CREAS (coordenadas
// exatas, ver UNITS_CRAS_CREAS), que têm campos próprios (tipo, bairros).
function mapaRedeShowUnitDetail(unit) {
  const panel = document.getElementById('mapaRedeDetailPanel');
  if (!panel) return;

  const unitColor = MAPA_REDE_COLOR_HEX[unit.color] || '#0067a3';
  const routeHref = `https://www.google.com/maps/dir/?api=1&destination=${unit.lat},${unit.lng}`;

  panel.innerHTML = `
    <div class="mapa-rede-detail-head">
      <div class="mapa-rede-detail-cats">
        <span class="mapa-rede-detail-badge" style="background:${unitColor}1a; color:${unitColor};">${escapeHtml(unit.tipo)}</span>
      </div>
      <button type="button" class="mapa-rede-detail-close" onclick="mapaRedeClearDetail()" aria-label="Fechar detalhes">✕</button>
    </div>
    <h3 class="mapa-rede-detail-title">${escapeHtml(unit.name)}</h3>
    ${mapaRedeDetailDistanceHtml(unit.lat, unit.lng)}
    <div class="mapa-rede-detail-row">${ICONS.map}<span>${escapeHtml(unit.address)}</span></div>
    ${unit.phone && unit.phone.trim().toUpperCase() !== 'N/A' ? `<div class="mapa-rede-detail-phones"><a class="mapa-rede-detail-link" href="tel:${escapeHtml(unit.phone.replace(/[^\d+]/g, ''))}">${ICONS.phone}<span>${escapeHtml(unit.phone)}</span></a></div>` : ''}
    <div class="mapa-rede-detail-block"><strong>Bairros de referência</strong><p>${escapeHtml(unit.bairros)}</p></div>
    <div class="mapa-rede-detail-actions">
      <a class="btn-tech btn-secondary btn-link" href="${routeHref}" target="_blank" rel="noopener noreferrer">${ICONS.map} Traçar rota</a>
    </div>
  `;
  panel.classList.add('has-selection');
}

function mapaRedeSetStatus(msg) {
  const el = document.getElementById('mapaRedeStatus');
  if (el) el.textContent = msg || '';
}

async function initMapPanel() {
  mapaRedeSetStatus('Carregando mapa…');
  let L;
  try {
    L = await ensureLeaflet();
  } catch (e) {
    mapaRedeSetStatus('Não foi possível carregar o mapa. Verifique sua conexão com a internet e tente novamente.');
    return;
  }

  const container = document.getElementById('mapaRedeMapContainer');
  // O usuário pode ter trocado de aba enquanto o Leaflet carregava.
  if (!container) return;

  if (mapaRedeMap) {
    mapaRedeMap.remove();
    mapaRedeMap = null;
  }

  const center = proximityState.active
    ? [proximityState.lat, proximityState.lon]
    : [MAPA_REDE_DEFAULT_CENTER.lat, MAPA_REDE_DEFAULT_CENTER.lon];

  mapaRedeMap = L.map(container).setView(center, proximityState.active ? 13 : 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">colaboradores do OpenStreetMap</a>'
  }).addTo(mapaRedeMap);

  mapaRedeMarkersLayer = L.markerClusterGroup({
    maxClusterRadius: 55,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    iconCreateFunction: mapaRedeClusterIcon
  }).addTo(mapaRedeMap);
  mapaRedeCrasCreasLayer = L.markerClusterGroup({
    maxClusterRadius: 55,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    iconCreateFunction: mapaRedeClusterIcon
  }).addTo(mapaRedeMap);

  if (proximityState.active) {
    mapaRedeShowUserMarker(L, proximityState.lat, proximityState.lon);
  }

  mapaRedeSetStatus('');
  await renderMapaRedeMarkers();
}

function mapaRedeShowUserMarker(L, lat, lon) {
  if (!mapaRedeMap) return;
  if (mapaRedeUserMarker) mapaRedeMap.removeLayer(mapaRedeUserMarker);
  const userIcon = L.divIcon({
    className: 'mapa-rede-user-icon',
    html: `<div style="width:16px; height:16px; border-radius:50%; background:#0091c2; border:3px solid #fff; box-shadow:0 0 0 2px #0091c2;"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });
  mapaRedeUserMarker = L.marker([lat, lon], { icon: userIcon, zIndexOffset: 1000 })
    .bindPopup('Você está aqui')
    .addTo(mapaRedeMap);
}

function mapaRedeLocateMe() {
  const btn = document.getElementById('mapaRedeLocateBtn');
  if (!navigator.geolocation) {
    alert('Este navegador não permite obter a localização atual.');
    return;
  }
  if (btn) btn.disabled = true;
  mapaRedeSetStatus('Localizando...');

  navigator.geolocation.getCurrentPosition(async (pos) => {
    proximityState = { active: true, lat: pos.coords.latitude, lon: pos.coords.longitude, loading: false };

    const proximityBtn = document.getElementById('proximityBtn');
    if (proximityBtn) {
      proximityBtn.setAttribute('aria-pressed', 'true');
      proximityBtn.classList.add('is-active');
    }
    setProximityButtonLabel('Mais próximos primeiro');

    if (mapaRedeMap && window.L) {
      mapaRedeMap.setView([proximityState.lat, proximityState.lon], 13);
      mapaRedeShowUserMarker(window.L, proximityState.lat, proximityState.lon);
    }
    if (btn) btn.disabled = false;
    mapaRedeSetStatus('');
    await renderMapaRedeMarkers();
  }, () => {
    if (btn) btn.disabled = false;
    mapaRedeSetStatus('Não foi possível obter sua localização. Verifique se a permissão de localização foi concedida ao navegador.');
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
}

async function renderMapaRedeMarkers() {
  if (!mapaRedeMap || !mapaRedeMarkersLayer || !window.L) return;
  const L = window.L;
  const catSelect = document.getElementById('mapaRedeCatSelect');
  const cat = catSelect ? catSelect.value : 'all';

  // Ao trocar a categoria ou mostrar/esconder CRAS/CREAS os pinos são
  // refeitos do zero, então o item que estava selecionado na caixa lateral
  // pode nem existir mais no mapa — evita mostrar um detalhe "órfão".
  mapaRedeClearDetail();

  const items = DATA.filter(i =>
    i.address &&
    !i.cat.includes('cas') && !i.cat.includes('cras') &&
    (cat === 'all' || i.cat.includes(cat))
  );

  // O mapa NÃO busca mais endereços sozinho. Antes, ao abrir a aba (e a cada
  // troca de categoria/checkbox), ele consultava o Nominatim um endereço por
  // vez (~1,1 s cada, até ~430 endereços), regravando o cache no localStorage
  // a cada resposta — isso travava o aplicativo e ainda atrasava o desenho do
  // mapa até o fim da fila. Agora só entram os pinos cujas coordenadas JÁ
  // estão no cache do aparelho (nenhuma requisição de rede é feita aqui).
  mapaRedeMarkersLayer.clearLayers();
  if (mapaRedeCrasCreasLayer) mapaRedeCrasCreasLayer.clearLayers();
  const cache = getGeocodeCache();
  const bounds = [];
  // Lista unificada usada tanto para o cálculo de "mais próximos" quanto
  // para o enquadramento do mapa (fitBounds) — mistura equipamentos do
  // diretório principal (coordenadas por geocodificação) com as unidades de
  // CRAS/CREAS (coordenadas exatas, sem precisar consultar nada).
  const nearbySource = [];
  const legendCatsSeen = new Set();

  items.forEach(item => {
    const coords = cache[item.id];
    if (!coords) return;
    nearbySource.push({ name: item.name, lat: coords.lat, lon: coords.lon });
    bounds.push([coords.lat, coords.lon]);
    const itemCat = (item.cat || []).find(c => MAP_CATEGORY_COLORS[c]);
    if (itemCat) legendCatsSeen.add(itemCat);
    const itemColor = mapaRedeItemColor(item);
    const marker = L.marker([coords.lat, coords.lon], { icon: mapaRedeCategoryIcon(itemColor), categoryColor: itemColor });
    // Ao tocar no pino, as informações completas abrem na caixa lateral
    // (#mapaRedeDetailPanel) em vez de um popup — cabe mais informação
    // (telefone, horário, serviços, descrição) e fica mais fácil de ler,
    // principalmente no celular.
    marker.on('click', () => mapaRedeShowItemDetail(item, coords));
    marker.addTo(mapaRedeMarkersLayer);
  });

  // Unidades de CRAS e CREAS de Boa Vista (checkbox "Mostrar unidades de
  // CRAS e CREAS"), com coordenadas exatas — não passam pela geocodificação.
  const showCrasCreas = document.getElementById('mapaRedeShowCrasCreas');
  if (mapaRedeCrasCreasLayer && (!showCrasCreas || showCrasCreas.checked)) {
    [...UNITS_CRAS_CREAS.cras.map(u => ({ ...u, tipo: 'CRAS' })), ...UNITS_CRAS_CREAS.creas.map(u => ({ ...u, tipo: 'CREAS' }))]
      .forEach(unit => {
        nearbySource.push({ name: unit.name, lat: unit.lat, lon: unit.lng });
        bounds.push([unit.lat, unit.lng]);
        const unitColor = MAPA_REDE_COLOR_HEX[unit.color] || '#0067a3';
        const marker = L.marker([unit.lat, unit.lng], { icon: mapaRedeCrasCreasIcon(unitColor), categoryColor: unitColor });
        // Mesma ideia dos pinos de equipamentos: os detalhes completos
        // (endereço, telefone, bairros de referência) abrem na caixa
        // lateral ao tocar no pino, em vez de um popup.
        marker.on('click', () => mapaRedeShowUnitDetail(unit));
        marker.addTo(mapaRedeCrasCreasLayer);
      });
  }

  mapaRedeSetStatus('');

  const legendEl = document.getElementById('mapaRedeLegend');
  if (legendEl) {
    const swatch = (colorHex, label) => `
      <span style="display:inline-flex; align-items:center; gap:0.3rem;">
        <span style="width:0.8rem; height:0.8rem; border-radius:50%; background:${colorHex}; border:1px solid rgba(0,0,0,0.15); display:inline-block;"></span>
        ${escapeHtml(label)}
      </span>`;
    const multiSwatch = (colorsHex, label) => `
      <span style="display:inline-flex; align-items:center; gap:0.25rem;">
        <span style="display:inline-flex; gap:1px;">
          ${colorsHex.map(c => `<span style="width:0.5rem; height:0.8rem; border-radius:2px; background:${c}; border:1px solid rgba(0,0,0,0.15); display:inline-block;"></span>`).join('')}
        </span>
        ${escapeHtml(label)}
      </span>`;
    const chips = [...legendCatsSeen]
      .sort((a, b) => (CATEGORY_LABELS_PRINT[a] || a).localeCompare(CATEGORY_LABELS_PRINT[b] || b, 'pt-BR'))
      .map(c => swatch(MAP_CATEGORY_COLORS[c], CATEGORY_LABELS_PRINT[c] || c));
    if (mapaRedeCrasCreasLayer && (!showCrasCreas || showCrasCreas.checked) && (UNITS_CRAS_CREAS.cras.length + UNITS_CRAS_CREAS.creas.length)) {
      chips.push(multiSwatch(['#d63e2a', '#38aadd', '#72b026'], 'CRAS/CREAS (cor varia por unidade)'));
    }
    legendEl.innerHTML = chips.join('');
  }

  if (proximityState.active) bounds.push([proximityState.lat, proximityState.lon]);
  if (bounds.length) {
    mapaRedeMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
  }

  const nearbyList = document.getElementById('mapaRedeNearbyList');
  if (nearbyList) {
    if (!proximityState.active) {
      nearbyList.innerHTML = nearbySource.length
        ? `<p style="font-size:0.85rem; color:var(--text-muted, #64748b);">${nearbySource.length} ponto(s) no mapa. Toque em "Minha localização" para ver os mais próximos.</p>`
        : '';
    } else {
      const sorted = nearbySource
        .map(({ name, lat, lon }) => ({ name, km: haversineKm(proximityState.lat, proximityState.lon, lat, lon) }))
        .sort((a, b) => a.km - b.km)
        .slice(0, 5);
      nearbyList.innerHTML = sorted.length
        ? `<h3 style="margin:0.5rem 0;">Mais próximos</h3><div class="tradutor-phrase-list">${sorted.map(({ name, km }) => `
            <div class="tradutor-phrase-item">
              <span>${escapeHtml(name || '')} — ${km < 1 ? Math.round(km * 1000) + ' m' : km.toFixed(1) + ' km'}</span>
            </div>
          `).join('')}</div>`
        : '';
    }
  }
}

function renderNotesCard() {
  const notes = getNotesIndex();

  if (!activeNoteId || !notes.some(n => n.id === activeNoteId)) {
    activeNoteId = notes.length ? notes[0].id : null;
  }
  const activeNote = notes.find(n => n.id === activeNoteId) || null;
  const content = activeNote ? getNoteContent(activeNote.id) : '';

  const listHtml = notes.length ? notes.map(n => {
    const isActive = n.id === activeNoteId;
    const preview = stripHtml(getNoteContent(n.id)).trim().replace(/\s+/g, ' ').slice(0, 60);
    const meta = [formatNoteTimestamp(n.updatedAt), preview].filter(Boolean).join(' · ');
    return `
      <button type="button" class="note-list-item ${isActive ? 'active' : ''}" data-note-id="${escapeHtml(n.id)}" onclick="selectNote('${n.id}')" aria-current="${isActive ? 'true' : 'false'}">
        <span class="note-list-item-title">${escapeHtml(n.title || 'Sem título')}</span>
        <span class="note-list-item-meta">${escapeHtml(meta)}</span>
      </button>
    `;
  }).join('') : `<p class="notes-empty-hint">Nenhuma anotação ainda.<br>Toque em "Nova Anotação" para começar.</p>`;

  const editorHtml = activeNote ? `
      <div class="note-editor" id="noteEditorPane">
        <div class="note-editor-header">
          <label for="noteTitleInput" class="sr-only">Título da anotação</label>
          <input type="text" id="noteTitleInput" class="note-title-input" value="${escapeHtml(activeNote.title)}" placeholder="Título da anotação (ex.: nome do caso)" maxlength="80" oninput="renameNote('${activeNote.id}', this.value)">
          <button type="button" class="btn-icon-danger" onclick="deleteNote('${activeNote.id}')" title="Excluir esta anotação" aria-label="Excluir esta anotação">${ICONS.trashSmall}</button>
        </div>
        ${renderUserDataFields(activeNote.id)}
        <label for="generalNoteArea" class="sr-only">Texto da anotação</label>
        <textarea id="generalNoteArea" class="notes-textarea" placeholder="Escreva aqui um encaminhamento, resumo do caso ou observações..." oninput="saveGeneralNote('${activeNote.id}', this.value)">${escapeHtml(content)}</textarea>
        <div class="notes-save-status" id="generalNoteStatus" aria-live="polite">
          ${ICONS.info}
          <span id="generalNoteStatusText">${content.length} caractere${content.length === 1 ? '' : 's'} · salva automaticamente</span>
        </div>
        <div class="card-actions">
          <button type="button" class="btn-tech btn-whatsapp" onclick="shareGeneralNote('${activeNote.id}')" title="Enviar esta anotação por WhatsApp" aria-label="Enviar esta anotação por WhatsApp">${ICONS.whatsapp} WhatsApp</button>
          <button class="btn-tech btn-primary" onclick="printGeneralNote('${activeNote.id}')">Gerar Guia</button>
        </div>
      </div>
    ` : `
      <div class="note-editor note-editor-empty">
        <p>Selecione uma anotação na lista ao lado ou crie uma nova para começar a escrever.</p>
      </div>
    `;

  return `
    <div class="tech-card notes-card" id="notesRoot">
      <div class="card-top">
        <div style="display:flex; align-items:center; gap:0.55rem;">
          <span class="notes-badge">${ICONS.form}</span>
          <h2 style="margin:0;">Minhas Anotações</h2>
        </div>
        <span class="subtitle">📝 Crie quantas anotações precisar — uma para cada caso ou atendimento</span>
      </div>
      <div class="card-body notes-layout">
        <div class="notes-list-pane">
          <button type="button" class="btn-tech btn-primary notes-new-btn" onclick="createNote()">${ICONS.plus} Nova Anotação</button>
          <div class="notes-list" id="notesList">${listHtml}</div>
        </div>
        ${editorHtml}
      </div>
    </div>
  `;
}

function shareGeneralNote(id) {
  const note = getNoteContent(id).trim();
  if (!note) {
    alert('Escreva uma anotação antes de compartilhar.');
    return;
  }
  const notes = getNotesIndex();
  const title = (notes.find(n => n.id === id) || {}).title || 'Anotação';
  const t = `*${title.toUpperCase()}*\n\n${note}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(t)}`, '_blank', 'noopener,noreferrer');
}

async function printGeneralNote(id) {
  const note = getNoteContent(id).trim() || 'Nenhuma anotação registrada.';
  const date = new Date().toLocaleDateString('pt-BR', {day:'numeric', month:'long', year:'numeric'});
  const userData = getUserData(id);
  const watermark = buildPrintWatermark();

  const firstPage = `
    <div class="print-page" style="padding:0; position:relative; font-family:'Inter', sans-serif; color:#0F172A; box-sizing:border-box; display:flex; flex-direction:column; background:white; border:2px solid #0F172A;">
      ${watermark}

      <div style="position:absolute; inset:0.25cm; border:1px solid #94A3B8; z-index:0; pointer-events:none;"></div>

      <div style="position:relative; z-index:1; display:flex; flex-direction:column; height:100%; padding:0.7cm 0.9cm; box-sizing:border-box;">

        <table style="width:100%; border-collapse:collapse; margin-bottom:8px; table-layout:fixed;">
          <tr>
            <td style="border:1.5px solid #0F172A; padding:8px 14px; vertical-align:middle;">
              <div style="display:flex; align-items:center; gap:10px;">
                <svg width="40" height="40" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;" aria-hidden="true">
                  <defs>
                    <linearGradient id="argoPrintBoatGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stop-color="#29ABE2"/>
                      <stop offset="50%" stop-color="#0091C2"/>
                      <stop offset="100%" stop-color="#009739"/>
                    </linearGradient>
                  </defs>
                  <path d="M50,20 L50,64" stroke="url(#argoPrintBoatGrad2)" stroke-width="4" stroke-linecap="round"/>
                  <path d="M50,23 C50,23 76,34 78,60 C68,55 58,52 50,52 Z" fill="url(#argoPrintBoatGrad2)"/>
                  <path d="M50,30 C50,30 34,40 30,58 C38,54 44,52 50,52 Z" fill="url(#argoPrintBoatGrad2)" opacity="0.65"/>
                  <path d="M14,70 C14,70 32,84 50,84 C68,84 86,70 86,70 C80,80 66,90 50,90 C34,90 20,80 14,70 Z" fill="url(#argoPrintBoatGrad2)"/>
                  <path d="M8,72 C20,66 34,72 50,72 C66,72 80,66 92,72" stroke="url(#argoPrintBoatGrad2)" stroke-width="3" fill="none" opacity="0.45" stroke-linecap="round"/>
                </svg>
                <div>
                  <div style="font-size:0.7rem; font-weight:800; letter-spacing:0.04em; color:#0091C2; text-transform:uppercase;">Sistema Único de Assistência Social (SUAS)</div>
                  <div style="font-size:0.62rem; font-weight:700; color:#475569; text-transform:uppercase; letter-spacing:0.03em; margin-top:2px;">Proteção Social Básica</div>
                  <div style="font-size:1.15rem; font-weight:800; letter-spacing:0.02em; color:#0F172A; margin-top:4px;">ENCAMINHAMENTO GERAL</div>
                </div>
              </div>
            </td>
            <td style="border:1.5px solid #0F172A; padding:5px 14px; text-align:center; width:320px;">
              <div style="display:flex; align-items:center; justify-content:center; gap:8px;">
                <svg width="40" height="40" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;" aria-hidden="true">
                  <defs>
                    <linearGradient id="psiHeaderGradGeral" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stop-color="#29ABE2"/>
                      <stop offset="50%" stop-color="#0091C2"/>
                      <stop offset="100%" stop-color="#075985"/>
                    </linearGradient>
                  </defs>
                  <circle cx="50" cy="50" r="46" fill="none" stroke="url(#psiHeaderGradGeral)" stroke-width="4"/>
                  <rect x="39" y="16" width="22" height="7" rx="3.5" fill="url(#psiHeaderGradGeral)"/>
                  <rect x="46" y="20" width="8" height="21" fill="url(#psiHeaderGradGeral)"/>
                  <path d="M48,42 C36,41 25,34 22,23 C21,19 23,16 27,16" fill="none" stroke="url(#psiHeaderGradGeral)" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M52,42 C64,41 75,34 78,23 C79,19 77,16 73,16" fill="none" stroke="url(#psiHeaderGradGeral)" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M50,39 C49,54 47,68 44,83 C47,86 53,86 56,83 C53,68 51,54 50,39 Z" fill="url(#psiHeaderGradGeral)"/>
                </svg>
                <div style="font-size:0.72rem; font-weight:700; font-style:italic; color:#075985; letter-spacing:0.01em; line-height:1.2; text-align:left;">SUAS: direito do cidadão e dever do Estado</div>
              </div>
            </td>
          </tr>
        </table>

        <table style="width:100%; border-collapse:collapse; margin-bottom:8px; table-layout:fixed;">
          <tr>
            <td colspan="3" style="border:1.5px solid #0F172A; border-bottom:none; background:#F1F5F9; padding:4px 12px; font-size:0.6rem; font-weight:800; text-transform:uppercase; letter-spacing:0.03em; color:#0F172A;">Dados do(a) Usuário(a) Encaminhado(a)</td>
          </tr>
          <tr>
            <td style="border:1.5px solid #0F172A; padding:8px 12px; width:44%; vertical-align:top;">
              <div style="font-size:0.6rem; font-weight:800; color:#475569; text-transform:uppercase; letter-spacing:0.02em; margin-bottom:12px;">Nome Completo</div>
              <div style="border-bottom:1px solid #94A3B8; font-size:0.85rem; font-weight:700; color:#0F172A; min-height:1.2em;">${userData.nome ? escapeHtml(userData.nome) : '&nbsp;'}</div>
            </td>
            <td style="border:1.5px solid #0F172A; border-left:none; padding:8px 12px; width:36%; vertical-align:top;">
              <div style="font-size:0.6rem; font-weight:800; color:#475569; text-transform:uppercase; letter-spacing:0.02em; margin-bottom:12px;">Endereço / Bairro</div>
              <div style="border-bottom:1px solid #94A3B8; font-size:0.85rem; font-weight:700; color:#0F172A; min-height:1.2em;">${userData.endereco ? escapeHtml(userData.endereco) : '&nbsp;'}</div>
            </td>
            <td style="border:1.5px solid #0F172A; border-left:none; padding:8px 12px; width:20%; vertical-align:top;">
              <div style="font-size:0.6rem; font-weight:800; color:#475569; text-transform:uppercase; letter-spacing:0.02em; margin-bottom:12px;">Nº NIS</div>
              <div style="border-bottom:1px solid #94A3B8; font-size:0.85rem; font-weight:700; color:#0F172A; min-height:1.2em;">${userData.nis ? escapeHtml(userData.nis) : '&nbsp;'}</div>
            </td>
          </tr>
          <tr>
            <td style="border:1.5px solid #0F172A; border-top:none; padding:8px 12px; width:44%; vertical-align:top;">
              <div style="font-size:0.6rem; font-weight:800; color:#475569; text-transform:uppercase; letter-spacing:0.02em; margin-bottom:12px;">CPF</div>
              <div style="border-bottom:1px solid #94A3B8; font-size:0.85rem; font-weight:700; color:#0F172A; min-height:1.2em;">${userData.cpf ? escapeHtml(userData.cpf) : '&nbsp;'}</div>
            </td>
            <td colspan="2" style="border:1.5px solid #0F172A; border-top:none; border-left:none; padding:8px 12px; width:56%; vertical-align:top;">
              <div style="font-size:0.6rem; font-weight:800; color:#475569; text-transform:uppercase; letter-spacing:0.02em; margin-bottom:12px;">Data de Nascimento</div>
              <div style="border-bottom:1px solid #94A3B8; font-size:0.85rem; font-weight:700; color:#0F172A; min-height:1.2em;">${userData.dataNascimento ? escapeHtml(formatBirthDateDisplay(userData.dataNascimento)) : '&nbsp;'}</div>
            </td>
          </tr>
        </table>

        <table style="width:100%; border-collapse:collapse; margin-bottom:8px; table-layout:fixed;">
          <tr>
            <td style="border:1.5px solid #0F172A; padding:8px 12px; vertical-align:top;">
              <div style="font-size:0.6rem; font-weight:800; color:#475569; text-transform:uppercase; letter-spacing:0.02em; margin-bottom:12px;">Unidade de Origem</div>
              <div style="border-bottom:1px solid #94A3B8; font-size:0.85rem; font-weight:700; color:#0F172A; min-height:1.2em;">${userData.unidadeOrigem ? escapeHtml(userData.unidadeOrigem) : '&nbsp;'}</div>
            </td>
          </tr>
        </table>

        <div style="flex-grow:1; display:flex; flex-direction:column; min-height:0; border:1.5px solid #0F172A; border-top:none; padding:16px;">
          <span style="font-size:0.65rem; font-weight:800; color:#475569; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:8px; display:block;">Observações e Encaminhamento</span>
          <div id="printNoteBox" style="flex-grow:1; padding:14px 16px; border:1.5px solid #0F172A; border-radius:4px; font-size:15px; line-height:1.5; background:rgba(17,94,89,0.02); overflow:hidden; white-space:pre-wrap; text-align:justify;">${escapeHtml(note)}</div>
        </div>

        <div style="margin-top:10px; display:flex; justify-content:space-between; align-items:flex-end; flex-shrink:0;">
          <div>
            <span style="display:block; font-size:0.55rem; font-weight:800; color:#94A3B8; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:3px;">Local e Data</span>
            <p style="margin:0; font-size:0.98rem; font-weight:700; font-style:italic; color:#0F172A; font-family:'Lora', serif;">Boa Vista, Roraima, ${date}.</p>
          </div>
          <div style="text-align:center; width:280px;">
            <div style="border-top:2px solid #0F172A; margin-bottom:6px;"></div>
            <p style="margin:0; font-size:1rem; font-weight:800; color:#0F172A;">Paulo Xavier</p>
            <p style="margin:0; font-size:0.85rem; color:#475569; font-weight:700;">Psicólogo · CRP-20/09816</p>
          </div>
        </div>
      </div>
    </div>
  `;

  const printArea = document.getElementById('print-area');
  printArea.innerHTML = firstPage;

  printArea.style.cssText = 'display:block; position:fixed; top:-10000px; left:-10000px; visibility:hidden;';

  await fitPrintNote();

  printArea.style.cssText = '';

  window.print();
}

function buildPrintWatermark() {
  return `
    <div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; z-index:0; opacity:0.07; pointer-events:none;">
      <svg viewBox="0 0 320 230" width="640" height="460" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <linearGradient id="argoPrintGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#0091C2"/>
            <stop offset="50%" stop-color="#29ABE2"/>
            <stop offset="100%" stop-color="#009739"/>
          </linearGradient>
        </defs>
        <path d="M0,178 C40,164 70,192 110,178 C150,164 180,192 220,178 C250,167 285,186 320,175" stroke="url(#argoPrintGradient)" stroke-width="6" fill="none" stroke-linecap="round"/>
        <path d="M0,196 C45,183 80,208 125,195 C165,183 200,208 240,196 C270,186 300,202 320,193" stroke="url(#argoPrintGradient)" stroke-width="6" fill="none" stroke-linecap="round" opacity="0.85"/>
        <path d="M0,212 C50,200 90,222 135,210 C175,199 215,222 255,211 C280,203 305,215 320,209" stroke="url(#argoPrintGradient)" stroke-width="6" fill="none" stroke-linecap="round" opacity="0.5"/>
        <path d="M42,86 C58,132 100,178 152,190 C165,193 175,193 168,193 C205,193 250,150 278,86" fill="url(#argoPrintGradient)"/>
        <path d="M60,92 C76,128 112,164 160,174 C204,164 240,128 260,92" fill="#FFFFFF" opacity="0.4"/>
        <path d="M42,86 C36,72 34,58 40,44" stroke="url(#argoPrintGradient)" stroke-width="4" fill="none" stroke-linecap="round"/>
        <path d="M55,74 C51,60 51,48 58,36" stroke="url(#argoPrintGradient)" stroke-width="4" fill="none" stroke-linecap="round" opacity="0.5"/>
        <path d="M278,86 C284,72 286,58 280,44" stroke="url(#argoPrintGradient)" stroke-width="4" fill="none" stroke-linecap="round"/>
        <path d="M265,74 C269,60 269,48 262,36" stroke="url(#argoPrintGradient)" stroke-width="4" fill="none" stroke-linecap="round" opacity="0.5"/>
        <circle cx="160" cy="46" r="11" fill="url(#argoPrintGradient)"/>
        <line x1="160" y1="18" x2="160" y2="6" stroke="url(#argoPrintGradient)" stroke-width="4" stroke-linecap="round"/>
        <line x1="136" y1="28" x2="126" y2="18" stroke="url(#argoPrintGradient)" stroke-width="4" stroke-linecap="round"/>
        <line x1="184" y1="28" x2="194" y2="18" stroke="url(#argoPrintGradient)" stroke-width="4" stroke-linecap="round"/>
      </svg>
    </div>
  `;
}

/* Guia de impressão do BPC (Idoso / Pessoa com Deficiência), voltado ao
   usuário/família — diferente da Ficha de Encaminhamento Técnico gerada por
   printGuide(). É impresso em A4 retrato (a Ficha usa A4 paisagem), por isso
   troca temporariamente a regra @page antes de chamar window.print() e
   desfaz a troca depois (evento 'afterprint'). Pode ser gerado em português
   ou espanhol, conforme o parâmetro lang. */
function setTempPageOrientation(size) {
  let styleTag = document.getElementById('tempPageOrientation');
  if (!styleTag) {
    styleTag = document.createElement('style');
    styleTag.id = 'tempPageOrientation';
    document.head.appendChild(styleTag);
  }
  styleTag.textContent = size ? `@media print { @page { size: ${size}; margin: 1cm; } }` : '';
}

/* Realça termos-chave que a pessoa precisa localizar rapidamente na folha
   impressa (o número da Central 135 e o nome "Meu INSS"), deixando-os em
   negrito e um pouco maiores dentro do próprio texto corrido. Usado em
   todo o conteúdo do guia (introdução, requisitos, passos, valor,
   indeferimento, contato e rodapé) para que o destaque seja consistente
   em qualquer trecho onde esses termos apareçam. \b135\b evita casar
   dentro de outros números (ex.: "1.621,00"). */
function hlGuideTerms(text) {
  if (!text) return text;
  return String(text)
    .replace(/Meu INSS/g, '<strong style="font-size:1.08em;">Meu INSS</strong>')
    .replace(/\b135\b/g, '<strong style="font-size:1.25em;">135</strong>');
}

async function printBpcGuide(id, lang) {
  const content = (BPC_GUIDE_CONTENT[id] && BPC_GUIDE_CONTENT[id][lang]) || null;
  if (!content) return;

  const i = DATA.find(x => x.id === id);
  const now = new Date();
  const dateLong = now.toLocaleDateString(lang === 'es' ? 'es-ES' : 'pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
  const watermark = buildPrintWatermark();

  // Anexo em PDF (pensado para a Folha Resumo do Cadastro Único), incluído
  // como página(s) extra no fim desta impressão — mesmo mecanismo já usado
  // na Ficha de Encaminhamento Técnico (printGuide/pdfDataUrlToImages).
  const attach = getAttachment(id);
  const pdfAttach = (attach && attach.type === 'pdf') ? attach : null;
  const attachNoteLabel = lang === 'es'
    ? 'Anexo digital en PDF'
    : 'Anexo digital em PDF';
  const attachNoteSuffix = lang === 'es'
    ? '(incluido en las páginas siguientes de esta impresión)'
    : '(incluído nas páginas seguintes desta impressão)';

  // Escala dinâmica de tamanhos: em vez de um fator fixo calculado só pelo
  // número de itens (que podia deixar o texto grande demais e "vazar" para
  // uma segunda página, como acontecia nos guias de BPC Idoso, BPC PCD e
  // Recuperação de Senha), o guia agora é montado, medido e, se necessário,
  // reduzido em escala até caber inteiramente em uma única folha A4.
  // buildGuidePageHtml(scale) monta o HTML completo do guia (página 1) para
  // um fator de escala qualquer — é chamada mais de uma vez pelo laço de
  // ajuste logo abaixo.
  function buildGuidePageHtml(scale) {
    const grem = (n) => (n * scale).toFixed(3) + 'rem';
    const gpx = (n) => Math.round(n * scale) + 'px';

    // Lista de requisitos: com poucos itens (até 3, ex.: Recuperação de Senha)
    // fica em coluna única, mais legível; com listas mais longas (BPC Idoso e
    // BPC PCD) usa duas colunas para equilibrar melhor o espaço da folha.
    const reqColumns = content.requirements.length > 3 ? 2 : 1;
    const reqItems = content.requirements.map(r => `
    <li style="margin:0 0 ${gpx(6)} 0; display:flex; gap:${gpx(8)}; align-items:flex-start; break-inside:avoid;">
      <span style="flex-shrink:0; width:${gpx(16)}; height:${gpx(16)}; border-radius:5px; background:#0091C2; color:#fff; font-size:${grem(0.7)}; font-weight:800; line-height:${gpx(16)}; text-align:center; margin-top:1px;">✓</span>
      <span>${hlGuideTerms(r)}</span>
    </li>`).join('');

    // A ilustração (print screen do gov.br/Meu INSS) não entra mais embutida
    // no corpo do guia (página 1) — ela agora forma uma página 2 dedicada,
    // maior, com a legenda passo a passo (ver illustrationPage mais abaixo).
    // Isso libera espaço na página 1 para o texto do guia caber inteiro nela.

    const stepItems = content.steps.map((s, idx) => {
      // Os títulos já vêm no formato "1. Texto do passo" — separa o número
      // para desenhar um selo circular, mantendo o texto do título ao lado.
      const m = /^(\d+)\.\s*(.*)$/.exec(s.title || '');
      const stepNum = m ? m[1] : String(idx + 1);
      const stepTitleText = m ? m[2] : (s.title || '');
      return `
    <div style="display:flex; gap:${gpx(10)}; align-items:flex-start; padding:${gpx(5)} 0; ${idx > 0 ? 'border-top:1px solid #E2E8F0;' : ''} break-inside:avoid;">
      <div style="flex-shrink:0; width:${gpx(22)}; height:${gpx(22)}; border-radius:50%; background:#0F172A; color:#fff; font-size:${grem(0.84)}; font-weight:800; display:flex; align-items:center; justify-content:center; margin-top:1px;">${stepNum}</div>
      <div style="flex:1; min-width:0;">
        <div style="font-weight:800; color:#0F172A; font-size:${grem(0.92)}; line-height:1.22;">${hlGuideTerms(stepTitleText)}</div>
        <div style="color:#334155; font-size:${grem(0.8)}; line-height:1.35; margin-top:2px;">${hlGuideTerms(s.desc)}</div>
      </div>
    </div>`;
    }).join('');

    return `
    <div class="print-page guide-measure-page" style="position:relative; padding:0; box-sizing:border-box; display:flex; flex-direction:column; background:white; border:2px solid #0F172A; width:100%; height:27.7cm; overflow:hidden;">
      ${watermark}
      <div style="position:absolute; inset:0.25cm; border:1px solid #94A3B8; z-index:0; pointer-events:none;"></div>

      <div style="position:relative; z-index:1; padding:${gpx(13)} ${gpx(19)} ${gpx(15)} ${gpx(19)}; font-family:'Inter', sans-serif; color:#0F172A;">

        <table style="width:100%; border-collapse:collapse; margin-bottom:${gpx(11)};">
          <tr>
            <td style="border:1.5px solid #0F172A; border-left:8px solid #0091C2; border-radius:3px; padding:${gpx(10)} ${gpx(16)}; vertical-align:middle;">
              <div style="font-size:${grem(0.64)}; font-weight:800; letter-spacing:0.05em; color:#0091C2; text-transform:uppercase;">CRAS Cristiana Vicente Nunes · SEMADS · Prefeitura de Boa Vista</div>
              <div style="display:inline-block; font-size:${grem(0.74)}; font-weight:800; letter-spacing:0.04em; color:#fff; background:#0F172A; padding:${gpx(3)} ${gpx(11)}; border-radius:20px; margin-top:${gpx(5)};">${content.badge}</div>
              <div style="font-size:${grem(1.08)}; color:#0F172A; font-weight:800; margin-top:${gpx(6)};">${content.title}</div>
            </td>
          </tr>
        </table>

        <div style="font-size:${grem(0.88)}; line-height:1.4; color:#334155; padding:2px 2px ${gpx(11)} 2px; border-bottom:1px dashed #CBD5E1; margin-bottom:${gpx(11)};">
          ${hlGuideTerms(content.intro)}
        </div>

        <div style="border:1.5px solid #0F172A; border-radius:7px; padding:${gpx(11)} ${gpx(18)}; margin-bottom:${gpx(11)};">
          <div style="font-size:${grem(0.76)}; font-weight:800; text-transform:uppercase; letter-spacing:0.04em; color:#0091C2; margin-bottom:${gpx(7)};">✅ ${content.reqLabel}</div>
          <ul style="margin:0; padding:0; list-style:none; font-size:${grem(0.83)}; line-height:1.35; color:#0F172A; ${reqColumns === 2 ? 'columns:2; column-gap:22px;' : ''}">${reqItems}</ul>
        </div>

        <div style="border:1.5px solid #0F172A; border-radius:7px; padding:${gpx(11)} ${gpx(18)}; margin-bottom:${gpx(11)}; background:rgba(0,145,194,0.04);">
          <div style="font-size:${grem(0.76)}; font-weight:800; text-transform:uppercase; letter-spacing:0.04em; color:#0091C2; margin-bottom:3px;">🧭 ${content.stepsLabel}</div>
          ${stepItems}
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:${gpx(14)}; margin-bottom:${gpx(11)};">
          <div style="border:1px solid #CBD5E1; border-radius:7px; padding:${gpx(10)} ${gpx(14)};">
            <div style="font-size:${grem(0.68)}; font-weight:800; text-transform:uppercase; letter-spacing:0.04em; color:#475569; margin-bottom:${gpx(5)};">💰 ${content.valueLabel}</div>
            <div style="font-size:${grem(0.81)}; line-height:1.35; color:#0F172A;">${hlGuideTerms(content.value)}</div>
          </div>
          <div style="border:1px solid #CBD5E1; border-radius:7px; padding:${gpx(10)} ${gpx(14)};">
            <div style="font-size:${grem(0.68)}; font-weight:800; text-transform:uppercase; letter-spacing:0.04em; color:#475569; margin-bottom:${gpx(5)};">⚖️ ${content.denialLabel}</div>
            <div style="font-size:${grem(0.81)}; line-height:1.35; color:#0F172A;">${hlGuideTerms(content.denial)}</div>
          </div>
        </div>

        ${(!content.familyComposition && content.crasClarification) ? `
        <div style="border:1.5px solid #B45309; border-radius:7px; padding:${gpx(10)} ${gpx(18)}; margin-bottom:${gpx(11)}; background:rgba(180,83,9,0.06);">
          <div style="font-size:${grem(0.72)}; font-weight:800; text-transform:uppercase; letter-spacing:0.04em; color:#B45309; margin-bottom:${gpx(4)};">${content.crasClarificationLabel || ''}</div>
          <div style="font-size:${grem(0.81)}; line-height:1.4; color:#0F172A;">${hlGuideTerms(content.crasClarification)}</div>
        </div>` : ''}

        <div style="border:1.5px dashed #94A3B8; border-radius:7px; padding:${gpx(10)} ${gpx(18)}; margin-bottom:${gpx(11)};">
          <div style="font-size:${grem(0.72)}; font-weight:800; text-transform:uppercase; letter-spacing:0.04em; color:#0091C2; margin-bottom:${gpx(4)};">📍 ${content.contactLabel}</div>
          <div style="font-size:${grem(0.81)}; line-height:1.4; color:#0F172A;">
            <strong>INSS</strong> — Av. Glaycon de Paiva, 86, Mecejana, Boa Vista-RR<br>
            Central <strong style="font-size:1.2em;">135</strong> (gov.br/inss/pt-br/canais_atendimento/central-135) · <strong style="font-size:1.05em;">Meu INSS</strong> (meu.inss.gov.br)
          </div>
          ${pdfAttach ? `<div style="margin-top:${gpx(5)}; font-size:${grem(0.7)}; font-weight:700; color:#475569;">📎 ${attachNoteLabel}: ${escapeHtml(pdfAttach.name || 'documento.pdf')} ${attachNoteSuffix}.</div>` : ''}
        </div>
      </div>
    </div>
  `;
  }

  // Página 2 dedicada à composição familiar considerada no cálculo da renda
  // per capita do BPC (art. 20, §1º da Lei 8.742/93 - LOAS), ao que NÃO
  // entra nessa renda, à possibilidade de acumulação com outros benefícios
  // e ao cancelamento — conteúdo já existente em content.familyComposition,
  // mas que ainda não tinha uma página própria na impressão. Só é gerada
  // quando o guia tem esse conteúdo (bpc-idoso e bpc-pcd); guias sem ele
  // (ex.: recuperação de senha) seguem sem essa página extra.
  function buildFamilyCompositionPageHtml() {
    const fc = content.familyComposition;
    if (!fc) return '';
    const includedItems = (fc.included || []).map(item => `
      <li style="margin:0 0 4px 0; display:flex; gap:8px; align-items:flex-start; break-inside:avoid;">
        <span style="flex-shrink:0; width:16px; height:16px; border-radius:5px; background:#0091C2; color:#fff; font-size:0.7rem; font-weight:800; line-height:16px; text-align:center; margin-top:1px;">✓</span>
        <span>${hlGuideTerms(item)}</span>
      </li>`).join('');
    return `
    <div class="print-page" style="position:relative; padding:0; box-sizing:border-box; display:flex; flex-direction:column; background:white; border:2px solid #0F172A; width:100%; height:27.7cm; overflow:hidden;">
      ${watermark}
      <div style="position:absolute; inset:0.25cm; border:1px solid #94A3B8; z-index:0; pointer-events:none;"></div>
      <div style="position:relative; z-index:1; padding:19px 27px 21px 27px; font-family:'Inter', sans-serif; color:#0F172A;">

        <table style="width:100%; border-collapse:collapse; margin-bottom:15px;">
          <tr>
            <td style="border:1.5px solid #0F172A; border-left:8px solid #0091C2; border-radius:3px; padding:10px 16px; vertical-align:middle;">
              <div style="font-size:0.64rem; font-weight:800; letter-spacing:0.05em; color:#0091C2; text-transform:uppercase;">CRAS Cristiana Vicente Nunes · SEMADS · Prefeitura de Boa Vista</div>
              <div style="display:inline-block; font-size:0.74rem; font-weight:800; letter-spacing:0.04em; color:#fff; background:#0F172A; padding:3px 11px; border-radius:20px; margin-top:5px;">${content.badge}</div>
              <div style="font-size:1.08rem; color:#0F172A; font-weight:800; margin-top:6px;">${fc.title || content.title}</div>
            </td>
          </tr>
        </table>

        <div style="border:1.5px solid #0F172A; border-radius:7px; padding:11px 18px; margin-bottom:11px;">
          <div style="font-size:0.76rem; font-weight:800; text-transform:uppercase; letter-spacing:0.04em; color:#0091C2; margin-bottom:5px;">${fc.includedLabel}</div>
          ${fc.includedIntro ? `<div style="font-size:0.78rem; line-height:1.35; color:#334155; margin-bottom:7px;">${hlGuideTerms(fc.includedIntro)}</div>` : ''}
          <ul style="margin:0; padding:0; list-style:none; font-size:0.83rem; line-height:1.35; color:#0F172A; columns:2; column-gap:22px;">${includedItems}</ul>
          <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; letter-spacing:0.04em; color:#475569; margin-top:10px; margin-bottom:4px;">${fc.excludedLabel}</div>
          <div style="font-size:0.81rem; line-height:1.4; color:#0F172A;">${hlGuideTerms(fc.excluded)}</div>
        </div>

        <div style="border:1px solid #CBD5E1; border-radius:7px; padding:10px 14px; margin-bottom:11px;">
          <div style="font-size:0.76rem; font-weight:800; text-transform:uppercase; letter-spacing:0.04em; color:#0091C2; margin-bottom:5px;">${fc.incomeExclusionsLabel}</div>
          <div style="font-size:0.81rem; line-height:1.4; color:#0F172A;">${hlGuideTerms(fc.incomeExclusions)}</div>
        </div>

        <div style="border:1px solid #CBD5E1; border-radius:7px; padding:10px 14px; margin-bottom:11px;">
          <div style="font-size:0.76rem; font-weight:800; text-transform:uppercase; letter-spacing:0.04em; color:#0091C2; margin-bottom:5px;">${fc.accumulationLabel}</div>
          <div style="font-size:0.81rem; line-height:1.4; color:#0F172A;">${hlGuideTerms(fc.accumulation)}</div>
        </div>

        <div style="border:1.5px dashed #94A3B8; border-radius:7px; padding:10px 18px; margin-bottom:11px;">
          <div style="font-size:0.76rem; font-weight:800; text-transform:uppercase; letter-spacing:0.04em; color:#0091C2; margin-bottom:5px;">${fc.cancellationLabel}</div>
          <div style="font-size:0.81rem; line-height:1.4; color:#0F172A;">${hlGuideTerms(fc.cancellation)}</div>
        </div>

        ${content.crasClarification ? `
        <div style="border:1.5px solid #B45309; border-radius:7px; padding:10px 18px; margin-bottom:11px; background:rgba(180,83,9,0.06);">
          <div style="font-size:0.76rem; font-weight:800; text-transform:uppercase; letter-spacing:0.04em; color:#B45309; margin-bottom:5px;">${content.crasClarificationLabel || ''}</div>
          <div style="font-size:0.81rem; line-height:1.4; color:#0F172A;">${hlGuideTerms(content.crasClarification)}</div>
        </div>` : ''}

        <div style="font-size:0.64rem; line-height:1.35; color:#94A3B8; text-align:center; padding-top:7px; border-top:1px dashed #CBD5E1;">
          ${lang === 'es' ? 'Documento generado el' : 'Documento gerado em'} ${dateLong} · Argo SUAS — ${i ? i.fullName : ''}
        </div>
      </div>
    </div>
  `;
  }

  // Página 2 dedicada ao passo a passo ilustrado: mostra o print screen do
  // gov.br/Meu INSS ampliado, com a legenda explicando o que fazer naquela
  // tela. Substitui a versão pequena que antes ficava embutida na página 1.
  const stepByStepTitle = lang === 'es' ? 'Paso a paso ilustrado' : 'Passo a passo ilustrado';
  // gpx/grem locais (escala 1): os de buildGuidePageHtml não existem aqui fora.
  const gpx = (n) => Math.round(n) + 'px';
  const grem = (n) => n.toFixed(3) + 'rem';
  const illustrationPage = content.illustration ? `
    <div class="print-page" style="position:relative; padding:0; box-sizing:border-box; display:flex; flex-direction:column; background:white; border:2px solid #0F172A; width:100%; min-height:27.7cm; height:auto; overflow:visible;">
      ${watermark}
      <div style="position:absolute; inset:0.25cm; border:1px solid #94A3B8; z-index:0; pointer-events:none;"></div>
      <div style="position:relative; z-index:1; padding:${gpx(18)} ${gpx(24)}; font-family:'Inter', sans-serif; color:#0F172A; display:flex; flex-direction:column; align-items:center; justify-content:center; flex-grow:1;">
        <div style="font-size:${grem(0.74)}; font-weight:800; letter-spacing:0.04em; color:#fff; background:#0091C2; padding:${gpx(4)} ${gpx(14)}; border-radius:20px; margin-bottom:${gpx(16)};">🧭 ${stepByStepTitle}</div>
        <img src="${content.illustration}" alt="${escapeHtml(content.illustrationCaption || '')}" style="max-width:80%; max-height:60vh; width:auto; height:auto; border:1px solid #CBD5E1; border-radius:10px; box-shadow:0 4px 14px rgba(15,23,42,0.16);">
        ${content.illustrationCaption ? `<div style="font-size:${grem(0.88)}; line-height:1.4; color:#334155; font-style:italic; text-align:center; margin-top:${gpx(16)}; max-width:70%;">${escapeHtml(content.illustrationCaption)}</div>` : ''}
      </div>
    </div>
  ` : '';

  // Página(s) extra com o PDF anexado (ex.: Folha Resumo do CadÚnico),
  // convertido em imagem por página — mesmo mecanismo do anexo em PDF da
  // Ficha de Encaminhamento Técnico (ver pdfDataUrlToImages).
  const attachPages = pdfAttach ? await (async () => {
    try {
      const pdfImages = await pdfDataUrlToImages(pdfAttach.data);
      const pageTitle = lang === 'es' ? 'ANEXO EN PDF' : 'ANEXO EM PDF';
      return pdfImages.map((imgSrc, idx) => `
        <div class="print-page" style="position:relative; padding:0.9cm 1.1cm; box-sizing:border-box; display:flex; flex-direction:column; background:white; border:2px solid #0F172A; width:100%; height:27.7cm; overflow:hidden;">
          <div style="position:absolute; inset:0.25cm; border:1px solid #94A3B8; pointer-events:none;"></div>
          <div style="position:relative; z-index:1; display:flex; flex-direction:column; height:100%;">
            <table style="width:100%; border-collapse:collapse; margin-bottom:10px; table-layout:fixed;">
              <tr>
                <td style="border:1.5px solid #0F172A; padding:8px 14px;">
                  <div style="font-size:1rem; font-weight:800; color:#0F172A;">${pageTitle}${pdfImages.length > 1 ? ` — Página ${idx + 1} de ${pdfImages.length}` : ''}</div>
                  <div style="font-size:0.68rem; font-weight:700; color:#475569; text-transform:uppercase;">${escapeHtml(pdfAttach.name || 'documento.pdf')} — ${i ? i.fullName : ''}</div>
                </td>
              </tr>
            </table>
            <div style="flex-grow:1; display:flex; align-items:center; justify-content:center; border:1.5px solid #0F172A; border-radius:4px; overflow:hidden; background:#F8FAFC;">
              <img src="${imgSrc}" alt="Página ${idx + 1} do anexo em PDF" style="max-width:100%; max-height:100%; object-fit:contain;">
            </div>
          </div>
        </div>
      `).join('');
    } catch (err) {
      const failMsg = lang === 'es'
        ? 'No fue posible cargar el archivo PDF adjunto para la impresión.<br>Verifique la conexión a internet e intente nuevamente.'
        : 'Não foi possível carregar o anexo em PDF para impressão.<br>Verifique a conexão com a internet e tente novamente.';
      return `
        <div class="print-page" style="position:relative; padding:0.9cm 1.1cm; box-sizing:border-box; display:flex; flex-direction:column; align-items:center; justify-content:center; background:white; border:2px solid #0F172A; width:100%; height:27.7cm; overflow:hidden;">
          <div style="font-size:1rem; font-weight:800; color:#0F172A; text-align:center;">${failMsg}</div>
        </div>
      `;
    }
  })() : '';

  const printArea = document.getElementById('print-area');

  // Monta o guia numa escala inicial conservadora (nunca maior que 1, ou
  // seja, nunca maior que o tamanho-base já calibrado) e então mede a
  // altura realmente renderizada, reduzindo a escala em até 4 tentativas
  // até o conteúdo caber inteiramente dentro de uma única folha A4
  // (27.7cm de área útil, mesmo valor usado no height do .print-page).
  // Isso corrige o "vazamento" para uma segunda folha que acontecia em
  // guias mais longos (BPC PCD, Recuperação de Senha) — agora tudo sai
  // sempre numa única folha, com o texto reduzido o quanto for preciso.
  const totalGuideItems = content.requirements.length + content.steps.length;
  let guideScale = Math.max(0.6, Math.min(1, 1 + (9 - totalGuideItems) * 0.04));

  function measureA4HeightPx() {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute; visibility:hidden; height:27.7cm; width:0; pointer-events:none;';
    document.body.appendChild(probe);
    const px = probe.offsetHeight;
    document.body.removeChild(probe);
    return px || 0;
  }
  const targetHeightPx = measureA4HeightPx();
  const familyCompositionPage = buildFamilyCompositionPageHtml();

  let guidePage = buildGuidePageHtml(guideScale);
  printArea.innerHTML = guidePage + familyCompositionPage + illustrationPage + attachPages;

  for (let attempt = 0; attempt < 4; attempt++) {
    const guideEl = printArea.querySelector('.guide-measure-page');
    if (!guideEl) break;
    const renderedHeight = guideEl.scrollHeight || 0;
    if (!targetHeightPx || renderedHeight <= targetHeightPx || guideScale <= 0.55) break;
    const ratio = targetHeightPx / renderedHeight;
    const nextScale = Math.max(0.55, guideScale * ratio * 0.985);
    if (nextScale >= guideScale) break;
    guideScale = nextScale;
    guidePage = buildGuidePageHtml(guideScale);
    printArea.innerHTML = guidePage + familyCompositionPage + illustrationPage + attachPages;
  }

  setTempPageOrientation('A4 portrait');
  window.addEventListener('afterprint', function clearOrientation() {
    setTempPageOrientation(null);
    window.removeEventListener('afterprint', clearOrientation);
  });

  window.print();
}

/* Converte o PDF anexado em imagens (uma por página) para que a impressão
   siga exatamente o mesmo mecanismo já usado para o anexo de foto (<img>
   dentro de um .print-page). O <embed type="application/pdf"> antigo não
   é renderizado pelo motor de impressão de vários navegadores/dispositivos
   e resultava em página em branco — convertendo para imagem, o anexo em
   PDF passa a imprimir de forma confiável, igual à foto. */
/* Loader unificado: usa o mesmo ensurePdfJs()/pdftoolsLoadScript() das
   Ferramentas de Arquivo (definidos mais abaixo, mas já disponíveis aqui
   em tempo de execução, já que funções async só rodam depois do script
   inteiro ser avaliado). Antes havia um segundo loader independente
   (pdfJsLoadingPromise) que baixava a mesma pdf.js de novo caso o usuário
   usasse as duas funcionalidades na mesma sessão — desperdício de dados
   em conexão fraca, cenário típico deste app. */
async function pdfDataUrlToImages(dataUrl) {
  await ensurePdfJs();
  // Importante: usar { data: bytes } (bytes decodificados aqui, na própria
  // aba) em vez de { url: dataUrl }. Passar a dataURL como "url" faz o
  // pdf.js buscá-la via fetch() internamente, o que é bloqueado pela
  // Content-Security-Policy da página (connect-src não inclui "data:"),
  // fazendo TODO anexo em PDF cair silenciosamente no aviso de erro
  // ("Não foi possível carregar o anexo em PDF para impressão") mesmo com
  // o anexo salvo corretamente. Decodificando o base64 aqui, não há
  // nenhuma requisição de rede envolvida — só leitura de memória — então a
  // CSP não entra em jogo e a conversão funciona também offline.
  const commaIndex = dataUrl.indexOf(',');
  const binary = atob(dataUrl.slice(commaIndex + 1));
  const pdfBytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) pdfBytes[i] = binary.charCodeAt(i);
  const pdf = await window.pdfjsLib.getDocument({ data: pdfBytes }).promise;
  const images = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 2.2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    images.push(canvas.toDataURL('image/jpeg', 0.92));
    canvas.width = 0;
    canvas.height = 0;
  }
  return images;
}

async function printGuide(id) {
  const i = DATA.find(x => x.id === id);
  const note = safeStorage.get('note_'+id) || 'Avaliação técnica e conduta especializada indicadas.';
  const attach = getAttachment(id);
  const imgData = (attach && attach.type === 'image') ? attach.data : null;
  const pdfAttach = (attach && attach.type === 'pdf') ? attach : null;
  const userData = getUserData(id);
  const secondUnitId = getSecondUnit(id);
  const secondUnitItem = secondUnitId ? DATA.find(x => x.id === secondUnitId) : null;

  // Dados do equipamento/serviço da 2ª unidade, para exibir na página extra
  // do encaminhamento — mesmos campos (categoria, serviços, descrição,
  // contato) já usados no quadro "Dados do Equipamento / Serviço" da 1ª
  // página, só que referentes à unidade marcada em renderSecondUnitField.
  let secondUnitCatDisplay = '', secondUnitServicesDisplay = '', secondUnitDescDisplay = '',
      secondUnitSummaryLine = '', secondUnitPhonesDisplay = '';
  if (secondUnitItem) {
    secondUnitCatDisplay = (secondUnitItem.cat || []).map(c => CATEGORY_LABELS_PRINT[c] || c).join(' · ');
    const secondUnitServicesRaw = Array.isArray(secondUnitItem.services) ? secondUnitItem.services.join(', ') : secondUnitItem.services;
    secondUnitServicesDisplay = cleanPrintField(secondUnitServicesRaw, '');
    const secondUnitDescRaw = cleanPrintField(secondUnitItem.desc, '');
    secondUnitDescDisplay = secondUnitDescRaw ? formatInformeDesc(secondUnitDescRaw) : '';
    secondUnitSummaryLine = [truncateForPrint(secondUnitServicesDisplay, 100), truncateForPrint(secondUnitDescDisplay, 140)]
      .filter(Boolean).join(' — ');
    secondUnitPhonesDisplay = cleanPrintField((secondUnitItem.phones || []).join('<br>'), '—');
  }

  // Protocolo e data/hora de emissão da ficha (antes ausentes, o que
  // quebrava a impressão com "protocolCode/emissionDisplay is not defined").
  const now = new Date();
  const shortUnitCode = (i.id || 'UN').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  const protocolCode = `FE-${shortUnitCode}-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
  const emissionDisplay = now.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
  const dateLong = now.toLocaleDateString('pt-BR', { day:'numeric', month:'long', year:'numeric' });

  // Em ~46 dos 374 cadastros, "name" (mostrado como selo colorido, ex.:
  // "HCSA") é igual ou é apenas o começo de "fullName" (ex.: "Hospital da
  // Criança Santo Antônio" vs "Hospital da Criança Santo Antônio (HCSA)"),
  // então o selo e o título ficavam colados repetindo o mesmo texto duas
  // vezes na ficha impressa. Só mostra o selo quando ele agrega alguma
  // informação (é de fato uma sigla/abreviação diferente do nome completo).
  const destUnitName = escapeHtml(i.name);
  const destUnitFullName = escapeHtml(i.fullName);
  const showDestUnitBadge = i.name && i.fullName &&
    !i.fullName.toLowerCase().startsWith(i.name.toLowerCase().replace(/\.$/, ''));

  const addressDisplay = cleanPrintField(i.address, 'Endereço não informado — consultar coordenação.');
  const hoursDisplay = cleanPrintField(i.hours, 'A confirmar diretamente com a unidade.');
  const phonesDisplay = cleanPrintField(i.phones.join('<br>'), '—');
  const servicesRaw = Array.isArray(i.services) ? i.services.join(', ') : i.services;
  const servicesDisplay = cleanPrintField(servicesRaw, '');
  const descRaw = cleanPrintField(i.desc, '');
  const descDisplay = descRaw ? formatInformeDesc(descRaw) : '';
  const catDisplay = (i.cat || []).map(c => CATEGORY_LABELS_PRINT[c] || c).join(' · ');

  // Resumo compacto de serviços + descrição (uma linha só, para sobrar espaço)
  const summaryLine = [truncateForPrint(servicesDisplay, 100), truncateForPrint(descDisplay, 140)]
    .filter(Boolean).join(' — ');

  // Alguns cadastros têm vários endereços/telefones (ex.: unidades com mais
  // de uma sede, contatos por setor) ou um único campo muito extenso (ex.:
  // "rede de farmácias" listando vários endereços numa única linha, sem
  // <br>). Cramar tudo na ficha, mesmo reduzindo a fonte ao mínimo, ainda
  // estoura o quadro de Dados do Equipamento. Para esses casos, mostramos só
  // os primeiros itens/caracteres na ficha impressa e indicamos que o
  // restante deve ser consultado na unidade/app.
  const capSegmentsForPrint = (txt, maxSegments, maxCharsPerSegment, moreLabel) => {
    const segments = String(txt).split(/<br\s*\/?>/i).map(s => s.trim()).filter(Boolean);
    const shown = segments.slice(0, maxSegments).map(seg => {
      const plain = stripHtml(seg).trim();
      if (plain.length <= maxCharsPerSegment) return seg;
      let cut = plain.slice(0, maxCharsPerSegment);
      const lastSpace = cut.lastIndexOf(' ');
      if (lastSpace > maxCharsPerSegment * 0.6) cut = cut.slice(0, lastSpace);
      return cut.trimEnd() + '…';
    });
    let result = shown.join('<br>');
    if (segments.length > maxSegments) {
      const rest = segments.length - maxSegments;
      result += `<br><span style="font-style:italic; font-weight:600; opacity:0.75;">+ ${rest} ${moreLabel}</span>`;
    }
    return result;
  };
  const addressPrint = capSegmentsForPrint(addressDisplay, 2, 110, 'endereço(s) — consulte a unidade');
  const phonesPrint = capSegmentsForPrint(phonesDisplay, 3, 70, 'contato(s) — consulte a unidade');

  // Mesmo corte de segurança acima, agora para a 2ª unidade (evita que um
  // cadastro com muitos endereços/telefones estoure a página extra do
  // encaminhamento — antes só a 1ª página tinha essa proteção).
  let secondUnitAddressPrint = '', secondUnitPhonesPrint = '';
  if (secondUnitItem) {
    secondUnitAddressPrint = capSegmentsForPrint(
      cleanPrintField(secondUnitItem.address, 'Endereço não informado — consultar coordenação.'),
      2, 110, 'endereço(s) — consulte a unidade'
    );
    secondUnitPhonesPrint = capSegmentsForPrint(secondUnitPhonesDisplay, 3, 70, 'contato(s) — consulte a unidade');
  }

  // Estima quantas linhas visuais um texto vai ocupar na coluna direita,
  // considerando tanto quebras explícitas (<br>) quanto o provável
  // "wrap" de segmentos longos (ex.: "Ouvidoria-Geral: 0800 095 3621 /
  // WhatsApp (95) 98400-8801"), que antes não eram contabilizados e
  // podiam estourar a caixa de Contato/Endereço silenciosamente.
  const countWrappedLines = (txt, charsPerLine = 34) => {
    const segments = String(txt).split(/<br\s*\/?>/i);
    return segments.reduce((sum, seg) => {
      const len = stripHtml(seg).trim().length;
      return sum + Math.max(1, Math.ceil(len / charsPerLine));
    }, 0);
  };
  const addressLines = countWrappedLines(addressPrint);
  const phoneLines = countWrappedLines(phonesPrint);
  const addressFontSize = addressLines <= 2 ? 13 : addressLines <= 4 ? 10.5 : addressLines <= 6 ? 8.5 : 7.5;
  const phoneFontSize = phoneLines <= 1 ? 16 : phoneLines <= 3 ? 11.5 : phoneLines <= 6 ? 9 : 7.5;

  const watermark = buildPrintWatermark();

  // Rodapé (Local e Data + assinatura) em escala variável: como ele fica
  // logo abaixo do grid onde está a caixa "Motivo do Encaminhamento" (que
  // cresce via flex-grow dentro da mesma coluna), reduzir o rodapé quando
  // a nota é longa libera altura extra para essa caixa crescer um pouco
  // para baixo antes de fitPrintNote() precisar diminuir a fonte da nota
  // ou cortá-la com reticências. Quanto maior a nota, menor o rodapé.
  // O espaçamento (margens/altura da linha de assinatura) encolhe mais do
  // que o tamanho das letras, para o rodapé continuar legível mesmo no
  // menor tamanho — só o "ar" ao redor dele é que cede espaço à nota.
  const noteLenForFooter = stripHtml(note).length;
  const footerSpaceScale = noteLenForFooter > 500 ? 0.55
    : noteLenForFooter > 320 ? 0.72
    : noteLenForFooter > 180 ? 0.88
    : 1;
  const footerFontScale = Math.max(0.85, footerSpaceScale);
  const fpx = (n) => Math.max(1, Math.round(n * footerSpaceScale));
  const frem = (n) => (n * footerFontScale).toFixed(3) + 'rem';

  const firstPage = `
    <div class="print-page" style="padding:0; position:relative; font-family:'Inter', sans-serif; color:#0F172A; box-sizing:border-box; display:flex; flex-direction:column; background:white; border:2px solid #0F172A;">
      ${watermark}

      <div style="position:absolute; inset:0.25cm; border:1px solid #94A3B8; z-index:0; pointer-events:none;"></div>

      <div style="position:relative; z-index:1; display:flex; flex-direction:column; height:100%; padding:0.7cm 0.9cm; box-sizing:border-box;">

        <table style="width:100%; border-collapse:collapse; margin-bottom:6px; table-layout:fixed;">
          <tr>
            <td style="border:1.5px solid #0F172A; padding:5px 12px; vertical-align:middle;">
              <div style="display:flex; align-items:center; gap:8px;">
                <svg width="32" height="32" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;" aria-hidden="true">
                  <defs>
                    <linearGradient id="argoPrintBoatGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stop-color="#29ABE2"/>
                      <stop offset="50%" stop-color="#0091C2"/>
                      <stop offset="100%" stop-color="#009739"/>
                    </linearGradient>
                  </defs>
                  <path d="M50,20 L50,64" stroke="url(#argoPrintBoatGrad)" stroke-width="4" stroke-linecap="round"/>
                  <path d="M50,23 C50,23 76,34 78,60 C68,55 58,52 50,52 Z" fill="url(#argoPrintBoatGrad)"/>
                  <path d="M50,30 C50,30 34,40 30,58 C38,54 44,52 50,52 Z" fill="url(#argoPrintBoatGrad)" opacity="0.65"/>
                  <path d="M14,70 C14,70 32,84 50,84 C68,84 86,70 86,70 C80,80 66,90 50,90 C34,90 20,80 14,70 Z" fill="url(#argoPrintBoatGrad)"/>
                  <path d="M8,72 C20,66 34,72 50,72 C66,72 80,66 92,72" stroke="url(#argoPrintBoatGrad)" stroke-width="3" fill="none" opacity="0.45" stroke-linecap="round"/>
                </svg>
                <div>
                  <div style="font-size:0.6rem; font-weight:800; letter-spacing:0.04em; color:#0091C2; text-transform:uppercase;">Sistema Único de Assistência Social (SUAS)</div>
                  <div style="font-size:0.54rem; font-weight:700; color:#475569; text-transform:uppercase; letter-spacing:0.03em; margin-top:1px;">Proteção Social Básica</div>
                  <div style="font-size:0.95rem; font-weight:800; letter-spacing:0.02em; color:#0F172A; margin-top:2px;">FICHA DE ENCAMINHAMENTO TÉCNICO</div>
                </div>
              </div>
            </td>
            <td style="border:1.5px solid #0F172A; padding:5px 12px; text-align:center; width:310px;">
              <div style="display:flex; align-items:center; justify-content:center; gap:6px;">
                <svg width="38" height="38" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;">
                  <defs>
                    <linearGradient id="psiHeaderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stop-color="#29ABE2"/>
                      <stop offset="50%" stop-color="#0091C2"/>
                      <stop offset="100%" stop-color="#075985"/>
                    </linearGradient>
                  </defs>
                  <circle cx="50" cy="50" r="46" fill="none" stroke="url(#psiHeaderGrad)" stroke-width="4"/>
                  <rect x="39" y="16" width="22" height="7" rx="3.5" fill="url(#psiHeaderGrad)"/>
                  <rect x="46" y="20" width="8" height="21" fill="url(#psiHeaderGrad)"/>
                  <path d="M48,42 C36,41 25,34 22,23 C21,19 23,16 27,16" fill="none" stroke="url(#psiHeaderGrad)" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M52,42 C64,41 75,34 78,23 C79,19 77,16 73,16" fill="none" stroke="url(#psiHeaderGrad)" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M50,39 C49,54 47,68 44,83 C47,86 53,86 56,83 C53,68 51,54 50,39 Z" fill="url(#psiHeaderGrad)"/>
                </svg>
                <div style="font-size:0.72rem; font-weight:700; font-style:italic; color:#075985; letter-spacing:0.01em; line-height:1.2; text-align:left;">SUAS: direito do cidadão e dever do Estado</div>
              </div>
            </td>
          </tr>
        </table>

        <div style="display:grid; grid-template-columns: 1fr 300px; grid-template-rows: minmax(0, 1fr); flex-grow:1; min-height:0; border:1.5px solid #0F172A;">

          <div style="display:flex; flex-direction:column; min-height:0; border-right:1.5px solid #0F172A; padding:10px 14px;">
            <span style="font-size:0.58rem; font-weight:800; color:#475569; text-transform:uppercase; letter-spacing:0.03em;">Unidade de Origem</span>
            <div style="border-bottom:1px solid #CBD5E1; padding-bottom:4px; margin:2px 0 6px 0; font-size:0.8rem; font-weight:700; color:#0F172A; min-height:1.1em;">${userData.unidadeOrigem ? escapeHtml(userData.unidadeOrigem) : '&nbsp;'}</div>

            <span style="font-size:0.58rem; font-weight:800; color:#475569; text-transform:uppercase; letter-spacing:0.03em;">Unidade de Destino</span>

            <!-- Sigla em destaque + Nome completo -->
            <div style="display:flex; align-items:baseline; gap:8px; margin:2px 0 6px 0; border-bottom:1px solid #CBD5E1; padding-bottom:6px;">
              ${showDestUnitBadge ? `<span style="flex-shrink:0; display:inline-flex; align-items:center; justify-content:center; padding:2px 8px; border-radius:5px; background:#0091C2; color:#fff; font-weight:800; font-size:0.78rem; letter-spacing:0.02em; white-space:nowrap;">${destUnitName}</span>` : ''}
              <h2 style="margin:0; font-size:1.02rem; line-height:1.2; color:#0F172A; font-family:'Lora', serif; font-weight:700;">${destUnitFullName}</h2>
            </div>

            <div style="border:1.5px solid #0F172A; border-radius:4px; overflow:hidden; margin-bottom:6px;">
              <div style="background:#F1F5F9; padding:3px 10px; font-size:0.55rem; font-weight:800; text-transform:uppercase; letter-spacing:0.03em; color:#0F172A; border-bottom:1px solid #0F172A;">Dados do(a) Usuário(a) Encaminhado(a)</div>
              <div style="display:flex;">
                <div style="flex:1.5; padding:5px 10px; border-right:1px solid #CBD5E1;">
                  <div style="font-size:0.55rem; font-weight:800; color:#475569; text-transform:uppercase; letter-spacing:0.02em;">Nome Completo</div>
                  <div style="font-size:0.8rem; font-weight:700; color:#0F172A; min-height:1.1em;">${userData.nome ? escapeHtml(userData.nome) : '&nbsp;'}</div>
                </div>
                <div style="flex:1.2; padding:5px 10px; border-right:1px solid #CBD5E1;">
                  <div style="font-size:0.55rem; font-weight:800; color:#475569; text-transform:uppercase; letter-spacing:0.02em;">Endereço / Bairro</div>
                  <div style="font-size:0.8rem; font-weight:700; color:#0F172A; min-height:1.1em;">${userData.endereco ? escapeHtml(userData.endereco) : '&nbsp;'}</div>
                </div>
                <div style="flex:0.7; padding:5px 10px;">
                  <div style="font-size:0.55rem; font-weight:800; color:#475569; text-transform:uppercase; letter-spacing:0.02em;">Nº NIS</div>
                  <div style="font-size:0.8rem; font-weight:700; color:#0F172A; min-height:1.1em;">${userData.nis ? escapeHtml(userData.nis) : '&nbsp;'}</div>
                </div>
              </div>
              <div style="display:flex; border-top:1px solid #CBD5E1;">
                <div style="flex:1; padding:5px 10px; border-right:1px solid #CBD5E1;">
                  <div style="font-size:0.55rem; font-weight:800; color:#475569; text-transform:uppercase; letter-spacing:0.02em;">CPF</div>
                  <div style="font-size:0.8rem; font-weight:700; color:#0F172A; min-height:1.1em;">${userData.cpf ? escapeHtml(userData.cpf) : '&nbsp;'}</div>
                </div>
                <div style="flex:1; padding:5px 10px;">
                  <div style="font-size:0.55rem; font-weight:800; color:#475569; text-transform:uppercase; letter-spacing:0.02em;">Data de Nascimento</div>
                  <div style="font-size:0.8rem; font-weight:700; color:#0F172A; min-height:1.1em;">${userData.dataNascimento ? escapeHtml(formatBirthDateDisplay(userData.dataNascimento)) : '&nbsp;'}</div>
                </div>
              </div>
            </div>

            <span style="font-size:0.58rem; font-weight:800; color:#475569; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:4px; display:block;">Informações da Unidade</span>
            ${summaryLine ? `<div style="margin-bottom:6px; padding:6px 10px; border:1.5px solid #0F172A; border-radius:4px; font-size:0.74rem; line-height:1.35; color:#475569; background:rgba(17,94,89,0.02);"><strong style="color:#0091C2;">Unidade:</strong> ${summaryLine}</div>` : ''}
            <div style="flex-grow:1; min-height:0; display:flex; flex-direction:column; border:1.5px solid #0F172A; border-radius:4px; overflow:hidden;">
              <div style="background:#F1F5F9; padding:3px 10px; font-size:0.55rem; font-weight:800; text-transform:uppercase; letter-spacing:0.03em; color:#0F172A; border-bottom:1px solid #0F172A; flex-shrink:0;">Motivo do Encaminhamento</div>
              <div id="printNoteBox" style="flex-grow:1; min-height:0; padding:12px 14px; font-size:15px; line-height:1.4; background:rgba(17,94,89,0.02); overflow:hidden; text-align:justify;">
                <span style="white-space:pre-wrap;">${escapeHtml(note)}</span>
              </div>
            </div>
            ${pdfAttach ? `<div style="margin-top:6px; font-size:0.68rem; font-weight:700; color:#475569;">📎 Anexo digital em PDF: ${escapeHtml(pdfAttach.name || 'documento.pdf')} (incluído nas páginas seguintes desta impressão).</div>` : ''}
          </div>

          <div style="display:flex; flex-direction:column; height:100%; min-height:0; overflow:hidden; padding:16px 14px 8px 14px; box-sizing:border-box;">
            <span style="font-size:0.6rem; font-weight:800; color:#475569; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:6px; display:block;">Dados do Equipamento / Serviço</span>
            <div style="border:1.5px solid #0F172A; border-radius:6px; overflow:hidden; display:flex; flex-direction:column; min-height:0; flex-shrink:1;">
              ${catDisplay ? `<div style="padding:10px 14px; border-bottom:1px solid #CBD5E1; background:rgba(0,145,194,0.05);">
                <div style="display:flex; align-items:center; gap:6px; font-size:0.6rem; font-weight:800; text-transform:uppercase; letter-spacing:0.04em; color:#0091C2; margin-bottom:4px;"><span style="display:inline-flex; color:#0091C2;">${ICONS.tag}</span>Categoria</div>
                <div style="font-size:0.9rem; line-height:1.3; color:#0F172A; font-weight:700;">${catDisplay}</div>
              </div>` : ''}
              <div style="padding:10px 14px; border-bottom:1px solid #CBD5E1;">
                <div style="display:flex; align-items:center; gap:6px; font-size:0.6rem; font-weight:800; text-transform:uppercase; letter-spacing:0.04em; color:#475569; margin-bottom:4px;"><span style="display:inline-flex; color:#64748B;">${ICONS.map}</span>Endereço</div>
                <div style="font-size:${addressFontSize + 1}px; line-height:1.4; color:#0F172A; font-weight:700;">${addressPrint}</div>
              </div>
              <div style="padding:10px 14px; border-bottom:1px solid #CBD5E1;">
                <div style="display:flex; align-items:center; gap:6px; font-size:0.6rem; font-weight:800; text-transform:uppercase; letter-spacing:0.04em; color:#475569; margin-bottom:4px;"><span style="display:inline-flex; color:#64748B;">${ICONS.clock}</span>Horário</div>
                <div style="font-size:0.86rem; line-height:1.4; color:#0F172A; font-weight:700;">${hoursDisplay}</div>
              </div>
              <div style="padding:10px 14px; background:rgba(17,94,89,0.04);">
                <div style="display:flex; align-items:center; gap:6px; font-size:0.6rem; font-weight:800; text-transform:uppercase; letter-spacing:0.04em; color:#475569; margin-bottom:4px;"><span style="display:inline-flex; color:#0091C2;">${ICONS.phone}</span>Contato</div>
                <div style="font-size:${phoneFontSize + 1}px; line-height:1.3; color:#0091C2; font-weight:800;">${phonesPrint}</div>
              </div>
            </div>

            <div style="border:1px dashed #94A3B8; border-radius:6px; padding:7px 12px; margin-top:8px; background:rgba(148,163,184,0.06); display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-shrink:0;">
              <div style="min-width:0; flex:1;">
                <span style="font-size:0.52rem; font-weight:800; color:#64748B; text-transform:uppercase; letter-spacing:0.04em; white-space:nowrap;">Protocolo</span>
                <div style="font-size:0.68rem; font-weight:800; color:#0F172A; letter-spacing:0.01em; word-break:break-all; margin-top:1px;">${protocolCode}</div>
              </div>
              <div style="text-align:right; flex-shrink:0;">
                <span style="font-size:0.52rem; font-weight:800; color:#64748B; text-transform:uppercase; letter-spacing:0.04em; white-space:nowrap;">Emissão</span>
                <div style="font-size:0.72rem; font-weight:700; color:#334155; margin-top:1px; white-space:nowrap;">${emissionDisplay}</div>
              </div>
            </div>

            <div style="font-size:0.56rem; line-height:1.4; color:#94A3B8; text-align:center; padding-top:6px; margin-top:6px; border-top:1px dashed #CBD5E1; flex-shrink:0;">
              Documento gerado eletronicamente pelo sistema Argo SUAS.<br>Válido mediante assinatura do(a) profissional responsável.
            </div>
          </div>
        </div>

        <div style="margin-top:${fpx(8)}px; display:flex; justify-content:space-between; align-items:flex-end; flex-shrink:0;">
          <div>
            <span style="display:block; font-size:${frem(0.5)}; font-weight:800; color:#94A3B8; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:${fpx(3)}px;">Local e Data</span>
            <p style="margin:0; font-size:${frem(0.85)}; font-weight:700; font-style:italic; color:#0F172A; font-family:'Lora', serif;">Boa Vista, Roraima, ${dateLong}.</p>
          </div>
          <div style="text-align:center; width:280px;">
            <div style="height:${fpx(22)}px;"></div>
            <div style="border-top:2px solid #0F172A; margin-bottom:${fpx(6)}px;"></div>
            <p style="margin:0; font-size:${frem(0.72)}; font-weight:800; color:#0F172A;">Paulo Xavier</p>
            <p style="margin:0; font-size:${frem(0.6)}; color:#475569; font-weight:700;">Psicólogo · CRP-20/09816</p>
          </div>
        </div>
      </div>
    </div>
  `;

  const secondPage = imgData ? `
    <div class="print-page" style="position:relative; padding:0.9cm 1.1cm; box-sizing:border-box; display:flex; flex-direction:column; background:white; border:2px solid #0F172A;">
      <div style="position:absolute; inset:0.25cm; border:1px solid #94A3B8; pointer-events:none;"></div>
      <div style="position:relative; z-index:1; display:flex; flex-direction:column; height:100%;">
        <table style="width:100%; border-collapse:collapse; margin-bottom:10px; table-layout:fixed;">
          <tr>
            <td style="border:1.5px solid #0F172A; padding:8px 14px;">
              <div style="font-size:1rem; font-weight:800; color:#0F172A;">ANEXO FOTOGRÁFICO</div>
              <div style="font-size:0.68rem; font-weight:700; color:#475569; text-transform:uppercase;">${destUnitFullName}</div>
            </td>
          </tr>
        </table>
        <div style="flex-grow:1; display:flex; align-items:center; justify-content:center; border:1.5px solid #0F172A; border-radius:4px; overflow:hidden; background:#F8FAFC;">
          <img src="${imgData}" alt="Anexo fotográfico" style="max-width:100%; max-height:100%; object-fit:contain;">
        </div>
      </div>
    </div>
  ` : '';

  const pdfPage = pdfAttach ? await (async () => {
    try {
      const pdfImages = await pdfDataUrlToImages(pdfAttach.data);
      return pdfImages.map((imgSrc, idx) => `
        <div class="print-page" style="position:relative; padding:0.9cm 1.1cm; box-sizing:border-box; display:flex; flex-direction:column; background:white; border:2px solid #0F172A;">
          <div style="position:absolute; inset:0.25cm; border:1px solid #94A3B8; pointer-events:none;"></div>
          <div style="position:relative; z-index:1; display:flex; flex-direction:column; height:100%;">
            <table style="width:100%; border-collapse:collapse; margin-bottom:10px; table-layout:fixed;">
              <tr>
                <td style="border:1.5px solid #0F172A; padding:8px 14px;">
                  <div style="font-size:1rem; font-weight:800; color:#0F172A;">ANEXO EM PDF${pdfImages.length > 1 ? ` — Página ${idx + 1} de ${pdfImages.length}` : ''}</div>
                  <div style="font-size:0.68rem; font-weight:700; color:#475569; text-transform:uppercase;">${destUnitFullName}</div>
                </td>
              </tr>
            </table>
            <div style="flex-grow:1; display:flex; align-items:center; justify-content:center; border:1.5px solid #0F172A; border-radius:4px; overflow:hidden; background:#F8FAFC;">
              <img src="${imgSrc}" alt="Página ${idx + 1} do anexo em PDF" style="max-width:100%; max-height:100%; object-fit:contain;">
            </div>
          </div>
        </div>
      `).join('');
    } catch (err) {
      return `
        <div class="print-page" style="position:relative; padding:0.9cm 1.1cm; box-sizing:border-box; display:flex; flex-direction:column; align-items:center; justify-content:center; background:white; border:2px solid #0F172A;">
          <div style="font-size:1rem; font-weight:800; color:#0F172A; text-align:center;">Não foi possível carregar o anexo em PDF para impressão.<br>Verifique a conexão com a internet e tente novamente.</div>
        </div>
      `;
    }
  })() : '';

  const secondUnitPage = secondUnitItem ? `
    <div class="print-page" style="position:relative; padding:0.9cm 1.1cm; box-sizing:border-box; display:flex; flex-direction:column; background:white; border:2px solid #0F172A;">
      <div style="position:absolute; inset:0.25cm; border:1px solid #94A3B8; pointer-events:none;"></div>
      <div style="position:relative; z-index:1; display:flex; flex-direction:column; height:100%;">
        <table style="width:100%; border-collapse:collapse; margin-bottom:10px; table-layout:fixed;">
          <tr>
            <td style="border:1.5px solid #0F172A; padding:8px 14px;">
              <div style="font-size:1rem; font-weight:800; color:#0F172A;">2ª UNIDADE DO ENCAMINHAMENTO</div>
              <div style="font-size:0.68rem; font-weight:700; color:#475569; text-transform:uppercase;">${escapeHtml(secondUnitItem.fullName)}</div>
            </td>
          </tr>
        </table>
        ${secondUnitSummaryLine ? `<div style="margin-bottom:10px; padding:8px 12px; border:1.5px solid #0F172A; border-radius:4px; font-size:0.78rem; line-height:1.4; color:#475569; background:rgba(17,94,89,0.02);"><strong style="color:#0091C2;">Unidade:</strong> ${secondUnitSummaryLine}</div>` : ''}
        <div style="border:1.5px solid #0F172A; border-radius:4px; overflow:hidden; flex-shrink:0;">
          ${secondUnitCatDisplay ? `<div style="padding:10px 14px; border-bottom:1px solid #CBD5E1; background:rgba(0,145,194,0.05);">
            <div style="font-size:0.6rem; font-weight:800; text-transform:uppercase; letter-spacing:0.04em; color:#0091C2; margin-bottom:4px;">Categoria</div>
            <div style="font-size:0.9rem; line-height:1.3; color:#0F172A; font-weight:700;">${secondUnitCatDisplay}</div>
          </div>` : ''}
          <div style="padding:10px 14px; border-bottom:1px solid #CBD5E1;">
            <div style="font-size:0.6rem; font-weight:800; text-transform:uppercase; letter-spacing:0.04em; color:#475569; margin-bottom:4px;">Unidade</div>
            <div style="font-size:0.95rem; line-height:1.4; color:#0F172A; font-weight:800;">${escapeHtml(secondUnitItem.name)}</div>
          </div>
          <div style="padding:10px 14px; border-bottom:1px solid #CBD5E1;">
            <div style="font-size:0.6rem; font-weight:800; text-transform:uppercase; letter-spacing:0.04em; color:#475569; margin-bottom:4px;">Endereço</div>
            <div style="font-size:0.86rem; line-height:1.4; color:#0F172A; font-weight:700;">${secondUnitAddressPrint}</div>
          </div>
          <div style="padding:10px 14px; border-bottom:1px solid #CBD5E1; background:rgba(17,94,89,0.04);">
            <div style="font-size:0.6rem; font-weight:800; text-transform:uppercase; letter-spacing:0.04em; color:#475569; margin-bottom:4px;">Horário</div>
            <div style="font-size:0.86rem; line-height:1.4; color:#0F172A; font-weight:700;">${cleanPrintField(secondUnitItem.hours, 'A confirmar diretamente com a unidade.')}</div>
          </div>
          <div style="padding:10px 14px;">
            <div style="font-size:0.6rem; font-weight:800; text-transform:uppercase; letter-spacing:0.04em; color:#475569; margin-bottom:4px;">Contato</div>
            <div style="font-size:0.86rem; line-height:1.3; color:#0091C2; font-weight:800;">${secondUnitPhonesPrint}</div>
          </div>
        </div>
        <div style="font-size:0.56rem; line-height:1.4; color:#94A3B8; text-align:center; padding-top:6px; margin-top:8px; border-top:1px dashed #CBD5E1; flex-shrink:0;">
          Encaminhamento adicional referente ao mesmo atendimento — ver 1ª página para dados do(a) usuário(a), motivo e protocolo.
        </div>
      </div>
    </div>
  ` : '';

  const printArea = document.getElementById('print-area');
  printArea.innerHTML = firstPage + secondPage + pdfPage + secondUnitPage;

  printArea.style.cssText = 'display:block; position:fixed; top:-10000px; left:-10000px; visibility:hidden;';

  await fitPrintNote();

  printArea.style.cssText = '';

  window.print();
}

// Exporta TODOS os dados sensíveis salvos neste navegador (anotações por
// unidade, anotação geral, dados de encaminhamento preenchidos e anexos)
// em um único arquivo .json, para guardar em outro lugar ou levar para
// outro dispositivo. Complementa clearAllLocalData(): antes de apagar os
// dados de um computador compartilhado, dá para salvar esse backup primeiro.
//
// O arquivo de backup é cifrado com a MESMA chave da sessão em uso
// (derivada da senha digitada no login) usada para os dados no
// localStorage — ver encryptForStorage()/decryptFromStorage() acima. Isso
// evita que nome, endereço, NIS e anotações fiquem legíveis em texto puro
// se o arquivo .json for perdido, enviado por engano ou parar num backup
// de nuvem pessoal. Só quem souber a senha do app consegue restaurar.
function exportData() {
  const data = collectSensitiveData();
  const keys = Object.keys(data);
  if (keys.length === 0) {
    alert('Não há anotações, dados de encaminhamento ou anexos salvos neste navegador para fazer backup.');
    return;
  }
  if (!sessionEncKey) {
    alert('O app precisa estar desbloqueado (senha digitada) para gerar um backup cifrado. Faça login e tente novamente.');
    return;
  }
  const payload = {
    app: 'Argo SUAS',
    tipo: 'backup-local-argo-suas',
    versaoBackup: 2,
    cifrado: true,
    geradoEm: new Date().toISOString(),
    dadosCifrados: encryptForStorage(JSON.stringify(data))
  };
  const b = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = `argo_suas_backup_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// Abre o seletor de arquivo para restaurar um backup gerado por exportData().
function triggerImportData() {
  const input = document.getElementById('backupImportInput');
  if (input) input.click();
}

// Lê o arquivo .json escolhido e restaura as anotações/dados/anexos nele
// contidos neste navegador. Pede confirmação antes, pois isso pode
// sobrescrever dados já salvos com o mesmo identificador.
//
// Backups novos (versaoBackup 2+) vêm cifrados com a senha em uso no
// momento da exportação (ver exportData) e só são decifrados aqui se a
// sessão atual (app desbloqueado) usar a MESMA senha — senão o resultado
// vira texto ilegível e a importação é cancelada em vez de gravar dados
// corrompidos. Backups antigos (versaoBackup 1, de antes desta mudança),
// salvos em texto puro, continuam sendo restaurados normalmente.
function importData(fileInput) {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const payload = JSON.parse(e.target.result);
      let dados = null;
      if (payload && payload.cifrado && typeof payload.dadosCifrados === 'string') {
        if (!sessionEncKey) throw new Error('app trancado');
        const json = decryptFromStorage(payload.dadosCifrados);
        if (!json) throw new Error('não foi possível decifrar (senha diferente da usada no backup?)');
        dados = JSON.parse(json);
      } else if (payload && typeof payload.dados === 'object' && payload.dados) {
        dados = payload.dados; // backup antigo, em texto puro
      }
      if (!dados) throw new Error('formato inválido');
      const keys = Object.keys(dados).filter(isSensitiveDataKey);
      if (keys.length === 0) throw new Error('nenhum dado reconhecido');
      const ok = confirm(`Este arquivo contém ${keys.length} item(ns) de backup (anotações, dados de encaminhamento e/ou anexos).\n\nImportar agora vai SOBRESCREVER, neste navegador, qualquer dado já salvo com o mesmo identificador. Deseja continuar?`);
      if (!ok) return;
      keys.forEach(k => safeStorage.set(k, dados[k]));
      alert(`Backup importado com sucesso: ${keys.length} item(ns) restaurado(s).`);
      if (typeof render === 'function') render();
    } catch (err) {
      alert('Não foi possível importar este arquivo. Verifique se é um backup gerado pelo próprio Argo SUAS (botão "Backup de anotações") e se a senha digitada no login é a mesma usada quando o backup foi feito.');
    } finally {
      fileInput.value = '';
    }
  };
  reader.readAsText(file);
}

let searchDebounceTimer = null;
document.getElementById('mainSearch').addEventListener('input', (e) => {
  const clearBtn = document.getElementById('searchClearBtn');
  if (clearBtn) clearBtn.classList.toggle('visible', e.target.value.length > 0);
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(render, 180);
});

/* Destaca o card clicado: marca com a classe is-selected e tira o
   destaque de qualquer outro card que estivesse selecionado antes.
   Clicar de novo no mesmo card remove o destaque. */
document.getElementById('grid').addEventListener('click', (e) => {
  if (e.target.closest('.cras-lookup')) return; // usar o localizador não deve marcar/desmarcar o card
  const card = e.target.closest('.tech-card');
  if (!card) return;
  const wasSelected = card.classList.contains('is-selected');
  document.querySelectorAll('.tech-card.is-selected').forEach(c => c.classList.remove('is-selected'));
  if (!wasSelected) card.classList.add('is-selected');
});

// Localizador de bairro da aba CRAS: o card é recriado a cada busca/troca
// de aba, então os eventos ficam delegados no grid (que nunca é recriado).
function crasRunLookup(value) {
  const out = document.getElementById('crasBairroResult');
  if (out) out.innerHTML = crasLookupHtml(value);
  const nq = crasNormalize(value);
  document.querySelectorAll('.cras-chip').forEach(c =>
    c.setAttribute('aria-pressed', nq && crasNormalize(c.dataset.bairro) === nq ? 'true' : 'false')
  );
}
document.getElementById('grid').addEventListener('input', (e) => {
  if (e.target && e.target.id === 'crasBairroInput') crasRunLookup(e.target.value);
});
document.getElementById('grid').addEventListener('click', (e) => {
  const chip = e.target.closest ? e.target.closest('.cras-chip') : null;
  if (!chip) return;
  const input = document.getElementById('crasBairroInput');
  if (input) input.value = chip.dataset.bairro;
  crasRunLookup(chip.dataset.bairro);
});

document.getElementById('searchClearBtn').addEventListener('click', () => {
  const input = document.getElementById('mainSearch');
  input.value = '';
  input.focus();
  render();
});

/* ---- Barra lateral de categorias (gaveta no celular, coluna fixa no desktop) ---- */
const categorySidebar = document.getElementById('categorySidebar');
const categoryToggleBtn = document.getElementById('categoryToggleBtn');
const categoryToggleLabel = document.getElementById('categoryToggleLabel');
const categoryToggleCount = document.getElementById('categoryToggleCount');
const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
const sidebarBackdrop = document.getElementById('sidebarBackdrop');
const mobileSidebarQuery = window.matchMedia('(max-width: 1023px)');

function openCategorySidebar() {
  categorySidebar.classList.add('is-open');
  sidebarBackdrop.classList.add('is-visible');
  document.body.classList.add('sidebar-open');
  if (categoryToggleBtn) categoryToggleBtn.setAttribute('aria-expanded', 'true');
}

function closeCategorySidebar() {
  categorySidebar.classList.remove('is-open');
  sidebarBackdrop.classList.remove('is-visible');
  document.body.classList.remove('sidebar-open');
  if (categoryToggleBtn) categoryToggleBtn.setAttribute('aria-expanded', 'false');
}

if (categoryToggleBtn) {
  categoryToggleBtn.addEventListener('click', () => {
    categorySidebar.classList.contains('is-open') ? closeCategorySidebar() : openCategorySidebar();
  });
}
if (sidebarCloseBtn) sidebarCloseBtn.addEventListener('click', closeCategorySidebar);
if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', closeCategorySidebar);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && categorySidebar.classList.contains('is-open')) closeCategorySidebar();
});

// Os grupos de categorias agora ficam sempre expandidos — a função de
// recolher foi desativada a pedido, para que nenhuma seção fique
// escondida do usuário.
function toggleFilterGroup(labelEl) {
  // Intencionalmente vazio: grupos não recolhem mais.
}

document.querySelectorAll('.filter-group-label[role="button"]').forEach(label => {
  label.addEventListener('click', () => toggleFilterGroup(label));
  label.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleFilterGroup(label);
    }
  });
});

function syncCategoryToggleLabel() {
  const active = document.querySelector('.filter-chip.active');
  if (!active || !categoryToggleLabel) return;
  const nameEl = active.querySelector('span:not(.chip-icon):not(.chip-count)');
  categoryToggleLabel.textContent = nameEl ? nameEl.textContent : 'Categorias';
  if (categoryToggleCount) {
    const countEl = active.querySelector('.chip-count');
    categoryToggleCount.textContent = countEl ? countEl.textContent : '';
    categoryToggleCount.style.display = countEl ? '' : 'none';
  }
}

document.querySelectorAll('.filter-chip').forEach(c => c.addEventListener('click', () => {
  const prevActive = document.querySelector('.filter-chip.active');
  prevActive.classList.remove('active');
  prevActive.setAttribute('aria-selected', 'false');
  c.classList.add('active');
  c.setAttribute('aria-selected', 'true');
  const chipGroup = c.closest('.filter-group');
  if (chipGroup && chipGroup.classList.contains('collapsed')) {
    chipGroup.classList.remove('collapsed');
    const chipGroupLabel = chipGroup.querySelector('.filter-group-label[role="button"]');
    if (chipGroupLabel) chipGroupLabel.setAttribute('aria-expanded', 'true');
  }
  syncCategoryToggleLabel();
  render();
  if (mobileSidebarQuery.matches) {
    closeCategorySidebar();
  } else {
    const controlsEl = document.querySelector('.controls');
    const controlsBottom = controlsEl.getBoundingClientRect().bottom;
    if (controlsBottom < 0 || window.scrollY > controlsEl.offsetTop + 400) {
      controlsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}));

const backToTopBtn = document.getElementById('backToTop');
window.addEventListener('scroll', () => {
  const show = window.scrollY > 600;
  backToTopBtn.classList.toggle('visible', show);
  backToTopBtn.tabIndex = show ? 0 : -1;
}, { passive: true });
backToTopBtn.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
  document.getElementById('mainSearch').focus();
});

function updateHeaderFooterStats() {
  const totalEl = document.getElementById('heroStatTotal');
  const catEl = document.getElementById('heroStatCategories');
  const footerCountEl = document.getElementById('footerItemCount');

  if (totalEl) totalEl.textContent = DATA.length;

  if (catEl) {
    const chips = document.querySelectorAll('.filter-chip[data-cat]:not([data-cat="all"]):not([data-cat="anotacoes"])');
    catEl.textContent = chips.length;
  }

  if (footerCountEl) {
    footerCountEl.textContent = `${DATA.length} registros no diretório`;
  }

  const footerYearEl = document.getElementById('footerYear');
  if (footerYearEl) {
    footerYearEl.textContent = new Date().getFullYear();
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(reg => {

      // Já existe uma atualização baixada esperando para entrar em ação?
      if (reg.waiting) ativarAtualizacao(reg.waiting);

      // Fica de olho em novas atualizações encontradas a partir de agora
      reg.addEventListener('updatefound', () => {
        const novoWorker = reg.installing;
        novoWorker.addEventListener('statechange', () => {
          if (novoWorker.state === 'installed' && navigator.serviceWorker.controller) {
            ativarAtualizacao(novoWorker);
          }
        });
      });

      // O navegador só checa sw.js sozinho quando a página é recarregada/
      // navegada de novo. Como o app costuma ficar com a aba aberta por
      // horas (às vezes dias), isso sozinho não é suficiente para pegar
      // uma atualização publicada nesse meio tempo. Por isso, além disso,
      // força a checagem manual (reg.update()) sempre que a aba volta a
      // ficar visível (o usuário troca de aba/app e volta) e também em
      // intervalo fixo enquanto a aba permanece aberta em primeiro plano.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
      setInterval(() => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      }, 30 * 60 * 1000); // a cada 30 minutos, só quando a aba está em foco
    }).catch(() => {
    });

    // Quando o novo Service Worker assume o controle:
    //  • primeira instalação (a página ainda não tinha Service Worker): não há
    //    versão nova a carregar, então não recarrega — antes recarregava já na
    //    primeira visita;
    //  • app trancado (tela de senha): recarrega na hora, sem custo;
    //  • app em uso: NÃO recarrega no meio do trabalho (isso jogava a pessoa
    //    de volta na tela de senha). Mostra um aviso discreto com o botão
    //    "Atualizar" e recarrega sozinho na próxima vez que o app for trancado.
    const jaTinhaControlador = !!navigator.serviceWorker.controller;
    let jaRecarregou = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!jaTinhaControlador || jaRecarregou) return;
      const appRoot = document.getElementById('appRoot');
      const emUso = appRoot && appRoot.dataset.locked === 'false';
      if (!emUso) {
        jaRecarregou = true;
        window.location.reload();
        return;
      }
      window.__argoUpdatePending = true;
      const greeting = document.getElementById('argoGreetingModal');
      // Com o cartão de abertura na tela, o aviso espera ele ser fechado
      // (ver argoDismissGreeting) para não ficar por cima dos botões.
      if (!(greeting && greeting.classList.contains('visible'))) argoShowUpdateToast();
    });
  });
}

function ativarAtualizacao(worker) {
  worker.postMessage({ type: 'SKIP_WAITING' });
}

// Aviso discreto de "nova versão disponível" (ver controllerchange acima).
function argoShowUpdateToast() {
  if (document.getElementById('argoUpdateToast')) return;
  const el = document.createElement('div');
  el.id = 'argoUpdateToast';
  el.setAttribute('role', 'status');
  el.style.cssText = 'position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:1300;width:max-content;max-width:calc(100vw - 24px);display:flex;align-items:center;gap:12px;padding:9px 10px 9px 16px;border-radius:14px;background:#0c2946;color:#f6e7bd;border:1px solid rgba(243,213,138,.45);box-shadow:0 12px 30px -8px rgba(0,0,0,.6);font:600 13px Inter,system-ui,sans-serif;';
  el.innerHTML = '<span>Nova versão do Argo disponível.</span>' +
    '<button type="button" style="flex-shrink:0;border:none;border-radius:10px;padding:7px 14px;background:linear-gradient(135deg,#29ABE2,#0091C2);color:#fff;font:700 13px Inter,system-ui,sans-serif;cursor:pointer;">Atualizar</button>';
  el.querySelector('button').addEventListener('click', () => window.location.reload());
  document.body.appendChild(el);
}

/* ============================================================
   AGENDA BOA VISTA 2026 — calendário com feriados/pagamentos fixos e
   anotações pessoais sincronizadas entre aparelhos (Firebase Firestore).
   Mesmo princípio das outras abas de ferramenta: o SDK do Firebase só é
   baixado do gstatic na primeira vez que o usuário configura um código de
   sincronização, então não entra no cache offline do Service Worker.
   Sem um código configurado, o calendário funciona normalmente (feriados e
   pagamentos aparecem), só as anotações ficam indisponíveis até sincronizar.
   ============================================================ */
const AGENDA_YEAR = 2026;
const AGENDA_MONTH_NAMES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

const AGENDA_DATA_INFO = {
  "2026-01-01": { label: "CONF.", type: "agenda-badge-feriado" },
  "2026-01-02": { label: "FAC.", type: "agenda-badge-facultativo" },
  "2026-01-19": { label: "FAC.", type: "agenda-badge-facultativo" },
  "2026-01-20": { label: "S. SEB.", type: "agenda-badge-feriado" },
  "2026-01-30": { label: "PAG.", type: "agenda-badge-pagamento" },
  "2026-02-16": { label: "CAR.", type: "agenda-badge-facultativo" },
  "2026-02-17": { label: "CAR.", type: "agenda-badge-facultativo" },
  "2026-02-18": { label: "CIN.", type: "agenda-badge-facultativo" },
  "2026-02-27": { label: "PAG.", type: "agenda-badge-pagamento" },
  "2026-03-31": { label: "PAG.", type: "agenda-badge-pagamento" },
  "2026-04-02": { label: "FAC.", type: "agenda-badge-facultativo" },
  "2026-04-03": { label: "PAIX.", type: "agenda-badge-feriado" },
  "2026-04-20": { label: "FAC.", type: "agenda-badge-facultativo" },
  "2026-04-21": { label: "TIR.", type: "agenda-badge-feriado" },
  "2026-04-30": { label: "PAG.", type: "agenda-badge-pagamento" },
  "2026-05-01": { label: "TRAB.", type: "agenda-badge-feriado" },
  "2026-05-30": { label: "PAG.", type: "agenda-badge-pagamento" },
  "2026-06-04": { label: "CORP.", type: "agenda-badge-feriado" },
  "2026-06-05": { label: "FAC.", type: "agenda-badge-facultativo" },
  "2026-06-16": { label: "13º SAL.", type: "agenda-badge-extra" },
  "2026-06-29": { label: "S. PED.", type: "agenda-badge-feriado" },
  "2026-06-30": { label: "PAG.", type: "agenda-badge-pagamento" },
  "2026-07-09": { label: "B. VIST.", type: "agenda-badge-feriado" },
  "2026-07-10": { label: "FAC.", type: "agenda-badge-facultativo" },
  "2026-07-31": { label: "PAG.", type: "agenda-badge-pagamento" },
  "2026-08-28": { label: "PAG.", type: "agenda-badge-pagamento" },
  "2026-09-07": { label: "IND.", type: "agenda-badge-feriado" },
  "2026-09-30": { label: "PAG.", type: "agenda-badge-pagamento" },
  "2026-10-05": { label: "ROR.", type: "agenda-badge-feriado" },
  "2026-10-12": { label: "APAR.", type: "agenda-badge-feriado" },
  "2026-10-28": { label: "SERV.", type: "agenda-badge-feriado" },
  "2026-10-30": { label: "PAG.", type: "agenda-badge-pagamento" },
  "2026-11-02": { label: "FIN.", type: "agenda-badge-feriado" },
  "2026-11-15": { label: "REP.", type: "agenda-badge-feriado" },
  "2026-11-20": { label: "C. NEG.", type: "agenda-badge-feriado" },
  "2026-11-27": { label: "PAG.", type: "agenda-badge-pagamento" },
  "2026-12-07": { label: "FAC.", type: "agenda-badge-facultativo" },
  "2026-12-08": { label: "CONC.", type: "agenda-badge-feriado" },
  "2026-12-18": { label: "13º SAL.", type: "agenda-badge-extra" },
  "2026-12-24": { label: "FAC.", type: "agenda-badge-facultativo" },
  "2026-12-25": { label: "NATAL", type: "agenda-badge-feriado" },
  "2026-12-29": { label: "PAG.", type: "agenda-badge-pagamento" },
  "2026-12-31": { label: "FAC.", type: "agenda-badge-facultativo" }
};

// Config do projeto Firebase "agenda-boa-vista" (Firestore em modo de teste,
// regra liberando leitura/escrita em agendas/{codigo}/notes/{data} — o
// código de sincronização funciona como senha compartilhada entre aparelhos).
const AGENDA_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDiqeeApAASF0GUPv940EpITwIPtkZ65jA",
  authDomain: "agenda-boa-vista.firebaseapp.com",
  projectId: "agenda-boa-vista",
  storageBucket: "agenda-boa-vista.firebasestorage.app",
  messagingSenderId: "1008550278960",
  appId: "1:1008550278960:web:59f247b9dfe549f3babaf5"
};

const AGENDA_CDN = {
  firebaseApp: 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
  firebaseFirestore: 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js'
};

const agendaScriptPromises = {};
function agendaLoadScript(url) {
  if (agendaScriptPromises[url]) return agendaScriptPromises[url];
  agendaScriptPromises[url] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = () => resolve();
    s.onerror = () => { delete agendaScriptPromises[url]; reject(new Error('Falha ao carregar ' + url)); };
    document.head.appendChild(s);
  });
  return agendaScriptPromises[url];
}
async function agendaEnsureFirebase() {
  if (window.firebase && window.firebase.firestore) return window.firebase;
  await agendaLoadScript(AGENDA_CDN.firebaseApp);
  await agendaLoadScript(AGENDA_CDN.firebaseFirestore);
  return window.firebase;
}

const today0 = new Date();
let agendaCurrentMonth = (today0.getFullYear() === AGENDA_YEAR) ? today0.getMonth() : 0;
let agendaSelectedKey = "";
let agendaNotesCache = {};
let agendaUnsubscribe = null;
let agendaSyncCode = localStorage.getItem('argo_agenda_sync_code') || "";
let agendaDb = null;
let agendaFirebaseReady = false;
let agendaTodayBannerDismissed = false;
let agendaSyncStatusHtml = '';
// 'connecting' | 'ok' | 'error' ('' = ainda não tentou). Lido pela notificação
// de abertura (argoGreetingSyncState), que mostra o mesmo status sem precisar
// do modal de sincronização aberto.
let agendaSyncState = '';

function agendaSetSyncStatus(html, state) {
  agendaSyncStatusHtml = html;
  if (state) agendaSyncState = state;
  const line = document.getElementById('agendaSyncStatusLine');
  if (line) line.innerHTML = html;
  // Atualiza a notificação de abertura, se ela ainda estiver na tela.
  if (typeof argoRefreshGreeting === 'function') argoRefreshGreeting();
}

// ======= Helpers de data e de nomes =======

// Nome por extenso de uma data marcada. "FAC." vira "Ponto facultativo"; as
// demais siglas vêm de ARGO_AGENDA_LABEL_NAMES (definido no topo do arquivo).
function agendaFullName(info) {
  if (!info) return '';
  return ARGO_AGENDA_LABEL_NAMES[info.label] || String(info.label).replace(/\.$/, '');
}

function agendaDateFromKey(key) {
  const p = key.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

// Chave AAAA-MM-DD a partir de um Date qualquer (agendaKeyFor sempre usa
// AGENDA_YEAR, então não serve para dias vizinhos na virada do ano).
function agendaIsoKey(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

// Título do dia. Ponto facultativo colado num feriado ganha a explicação
// ("antes de Tiradentes", "depois de Corpus Christi"), deduzida das próprias
// datas cadastradas em AGENDA_DATA_INFO — nada é inventado.
function agendaDayTitle(key) {
  const info = AGENDA_DATA_INFO[key];
  if (!info) return '';
  const name = agendaFullName(info);
  if (info.label !== 'FAC.') return name;
  const date = agendaDateFromKey(key);
  const prev = new Date(date); prev.setDate(date.getDate() - 1);
  const next = new Date(date); next.setDate(date.getDate() + 1);
  const nInfo = AGENDA_DATA_INFO[agendaIsoKey(next)];
  const pInfo = AGENDA_DATA_INFO[agendaIsoKey(prev)];
  if (nInfo && argoAgendaKind(nInfo) === 'feriado') return name + ' (antes de ' + agendaFullName(nInfo) + ')';
  if (pInfo && argoAgendaKind(pInfo) === 'feriado') return name + ' (depois de ' + agendaFullName(pInfo) + ')';
  return name;
}

function agendaLongDate(date) {
  return date.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
}

// "hoje", "amanhã", "em 10 dias", "há 3 dias" — só para datas até 60 dias de
// distância; além disso o rótulo seria ruído.
function agendaRelativeLabel(key) {
  const now = new Date();
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((agendaDateFromKey(key) - t0) / 86400000);
  if (days === 0) return 'hoje';
  if (days === 1) return 'amanhã';
  if (days === -1) return 'ontem';
  if (days > 1 && days <= 60) return 'em ' + days + ' dias';
  if (days < -1 && days >= -60) return 'há ' + (-days) + ' dias';
  return '';
}

function agendaJoinPt(parts) {
  if (parts.length <= 1) return parts[0] || '';
  return parts.slice(0, -1).join(', ') + ' e ' + parts[parts.length - 1];
}

// ======= Avisos rápidos (substituem os alert() da agenda) =======

let agendaToastTimer = null;
function agendaToast(msg, kind) {
  agendaEnsureModals();
  let el = document.getElementById('agendaToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'agendaToast';
    el.className = 'agenda-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.dataset.kind = kind || 'info';
  el.classList.add('visible');
  clearTimeout(agendaToastTimer);
  agendaToastTimer = setTimeout(() => el.classList.remove('visible'), kind === 'error' ? 6500 : 4200);
}

// ======= Card da agenda =======

function renderAgendaCard() {
  return `
    <div class="tech-card agenda-card">
      <style>
        .agenda-card { grid-column: 1 / -1; --agenda-accent: #1f3d33; --agenda-accent-bg: rgba(31, 61, 51, 0.1); }
        /* Tema escuro: o verde do caderno some sobre o fundo azul-marinho do app. */
        @media (prefers-color-scheme: dark) {
          :root:not([data-theme="light"]) .agenda-card { --agenda-accent: #8fd0b4; --agenda-accent-bg: rgba(143, 208, 180, 0.14); }
        }
        :root[data-theme="dark"] .agenda-card { --agenda-accent: #8fd0b4; --agenda-accent-bg: rgba(143, 208, 180, 0.14); }
        .agenda-card .card-top h2 { color: var(--agenda-accent); }
        .agenda-badge { color: var(--agenda-accent); background: var(--agenda-accent-bg); }

        .agenda-privacy {
          font-size: 0.8rem; color: var(--text-muted); background: var(--agenda-accent-bg);
          border: 1px dashed #b8894f; border-radius: 8px; padding: 0.6rem 0.9rem;
          margin-bottom: 1.1rem; line-height: 1.5;
        }
        .agenda-privacy summary { display: flex; align-items: center; gap: 0.55rem; cursor: pointer; font-weight: 700; list-style: none; }
        .agenda-privacy summary::-webkit-details-marker { display: none; }
        .agenda-privacy summary svg { color: var(--agenda-accent); flex-shrink: 0; }
        .agenda-privacy summary:focus-visible { outline: 2px solid var(--agenda-accent); outline-offset: 3px; border-radius: 4px; }
        .agenda-privacy p { margin: 0.5rem 0 0; }

        .agenda-book {
          --paper: #f8f2e4; --paper-alt: #efe4cb; --rule-line: #e0d3ac;
          --cover: #1f3d33; --cover-dark: #14261f; --gold: #b8894f; --ink: #2c2620;
          --ink-muted: #6f6551; --red-ink: #b3413a; --blue-ink: #2f5d8a;
          --amber-ink: #a9762a; --amber-bg: #f0d78a; --green-ink: #3f7d55;
          position: relative;
          container-type: inline-size; container-name: agendabook;
          background: var(--paper);
          background-image: repeating-linear-gradient(to bottom, transparent 0px, transparent 27px, var(--rule-line) 27px, var(--rule-line) 28px);
          border-radius: 6px 18px 18px 6px;
          box-shadow: 0 2px 0 rgba(0,0,0,0.04) inset, 0 10px 26px rgba(20,20,10,0.18);
          overflow: hidden;
          padding-left: 30px;
          font-family: 'Times New Roman', Times, serif;
          color: var(--ink);
        }
        .agenda-book button { font-family: inherit; }
        .agenda-book button:focus-visible { outline: 2px solid var(--cover); outline-offset: 2px; }
        .agenda-binding {
          position: absolute; left: 0; top: 0; bottom: 0; width: 30px;
          background: linear-gradient(to right, var(--cover-dark), var(--cover) 60%, var(--cover) 100%);
          border-radius: 6px 0 0 6px; box-shadow: inset -4px 0 8px rgba(0,0,0,0.25);
        }
        .agenda-binding::before {
          content: ''; position: absolute; left: 50%; top: 14px; bottom: 14px; width: 12px;
          transform: translateX(-50%);
          background-image: radial-gradient(circle, var(--paper) 3.4px, transparent 4px);
          background-size: 100% 26px; background-repeat: repeat-y;
        }

        .agenda-header { padding: 16px 18px 10px 20px; display: flex; align-items: center; flex-wrap: wrap; gap: 10px 18px; }
        .agenda-brand { flex: 1 1 auto; }
        .agenda-brand h3 { margin: 0; font-style: italic; font-weight: 800; font-size: 1.5rem; color: var(--ink); }
        .agenda-brand p { margin: 2px 0 0 1px; font-size: 13px; font-style: italic; color: #86652f; letter-spacing: 0.3px; }
        .agenda-tools { display: flex; gap: 8px; }
        .agenda-sync-btn { position: relative; width: 38px; height: 38px; display: inline-flex; align-items: center; justify-content: center; padding: 0; background: var(--paper-alt); border: 1px solid var(--rule-line); cursor: pointer; color: var(--ink-muted); border-radius: 50%; font-size: 15px; }
        .agenda-sync-btn:hover { background: var(--paper); color: var(--cover); }
        .agenda-sync-dot { width: 8px; height: 8px; border-radius: 50%; position: absolute; top: 3px; right: 3px; border: 1.5px solid var(--paper-alt); }
        .agenda-sync-ok { background: var(--green-ink); }
        .agenda-sync-off { background: var(--red-ink); }
        .agenda-sync-neutral { background: #b3a98e; }

        .agenda-monthbar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
        .agenda-nav-controls { display: flex; align-items: center; gap: 2px; background: var(--paper-alt); padding: 3px; border-radius: 24px; border: 1px solid var(--rule-line); }
        .agenda-nav-btn { width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center; background: none; border: none; padding: 0; cursor: pointer; color: var(--ink-muted); border-radius: 50%; font-size: 13px; }
        .agenda-nav-btn:hover { background: var(--paper); color: var(--cover); }
        .agenda-month-display { font-style: italic; font-weight: 700; font-size: 19px; min-width: 118px; text-align: center; color: var(--ink); }
        .agenda-today-btn { background: transparent; border: 1px solid var(--gold); color: var(--cover); border-radius: 20px; padding: 8px 14px; font-size: 14px; font-weight: 700; cursor: pointer; }
        .agenda-today-btn:hover { background: rgba(184, 137, 79, 0.14); }
        .agenda-today-btn[hidden] { display: none; }

        /* Card do resumo da semana (aparece depois de sincronizar). */
        .agenda-today-banner {
          display: none; flex-direction: column; align-items: stretch; gap: 6px;
          margin: 0 14px 10px; padding: 10px 12px;
          background: rgba(184, 137, 79, 0.14); border: 1px solid var(--gold);
          border-left-width: 4px; border-radius: 8px;
        }
        .agenda-sync-card-head { display: flex; align-items: center; gap: 8px; }
        .agenda-today-icon { font-size: 14px; line-height: 1; }
        .agenda-sync-card-title { flex: 1; font-size: 13px; font-weight: 800; color: var(--cover); }
        .agenda-sync-card-time { font-size: 11px; font-weight: 700; color: var(--ink-muted); white-space: nowrap; }
        .agenda-today-text { font-size: 13px; font-weight: 600; color: var(--ink); line-height: 1.45; }
        .agenda-sync-card-today { font-weight: 700; }
        .agenda-sync-card-sub { margin-top: 4px; font-size: 11px; font-weight: 800; color: var(--ink-muted); }
        .agenda-sync-card-row { padding-left: 2px; }
        .agenda-today-close { background: none; border: none; cursor: pointer; color: var(--ink-muted); font-size: 13px; line-height: 1; padding: 6px 8px; border-radius: 4px; }
        .agenda-today-close:hover { background: var(--paper-alt); color: var(--cover); }

        /* Calendário + página ao lado (lista do mês). */
        .agenda-spread { display: grid; grid-template-columns: minmax(0, 1fr); }
        .agenda-cal { display: flex; flex-direction: column; min-width: 0; }
        .agenda-cal #agendaCalendarGrid { flex: 1 1 auto; }
        .agenda-weekdays { display: grid; grid-template-columns: repeat(7, 1fr); padding: 4px 14px; text-align: center; border-bottom: 2px solid var(--gold); margin: 0 4px; }
        .agenda-weekdays div { font-size: 11px; font-weight: 800; letter-spacing: 0.3px; color: var(--ink-muted); padding-bottom: 6px; }
        .agenda-weekdays .agenda-dom { color: var(--red-ink); }
        #agendaCalendarGrid { container-type: inline-size; display: grid; grid-template-columns: repeat(7, 1fr); grid-auto-rows: minmax(var(--agenda-cell-min, 76px), 1fr); gap: 1px; padding: 6px 10px 8px; }
        .agenda-day-cell { border-radius: 4px; padding: 4px 5px; display: flex; flex-direction: column; justify-content: space-between; gap: 2px; cursor: pointer; border-bottom: 1px solid var(--rule-line); transition: transform 0.12s, background 0.12s; min-width: 0; }
        .agenda-day-cell:hover { background: rgba(184, 137, 79, 0.10); transform: translateY(-1px); }
        .agenda-day-cell:focus-visible { outline: 2px solid var(--cover); outline-offset: -2px; }
        .agenda-day-cell.agenda-day-empty { visibility: hidden; cursor: default; border-bottom-color: transparent; }
        .agenda-day-cell.agenda-bg-sunday { background-color: rgba(179, 65, 58, 0.06); }
        .agenda-day-cell.agenda-bg-saturday { background-color: rgba(44, 38, 32, 0.035); }
        .agenda-day-cell.agenda-is-today { background-color: rgba(184, 137, 79, 0.16); box-shadow: inset 0 0 0 1.5px var(--gold); }
        .agenda-day-cell.agenda-is-today .agenda-day-num { display: inline-flex; align-items: center; justify-content: center; background: var(--cover); color: var(--paper) !important; width: 20px; height: 20px; border-radius: 50%; font-size: 12px; }
        .agenda-day-num { font-size: 13px; font-weight: 700; }
        .agenda-badge-status { font-size: 9px; padding: 2px 3px; border-radius: 3px; font-weight: 800; text-align: center; color: white; text-transform: uppercase; line-height: 1.2; letter-spacing: 0.2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; box-shadow: 0 1px 2px rgba(0,0,0,0.18); }
        .agenda-badge-status .lbl-full { display: none; }
        .agenda-badge-feriado { background-color: var(--red-ink); }
        .agenda-badge-facultativo { background-color: var(--amber-bg); color: #5c3f0d; }
        .agenda-badge-pagamento { background-color: var(--green-ink); }
        .agenda-badge-extra { background-color: var(--blue-ink); }
        .agenda-note-preview { font-family: 'Caveat', cursive; font-size: 15px; line-height: 1; font-weight: 700; color: var(--blue-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; transform: rotate(-1.5deg); transform-origin: left center; }
        /* Grade média: sigla um pouco maior. Grade larga: nome por extenso. */
        @container (min-width: 470px) {
          .agenda-badge-status { font-size: 10px; padding: 2px 4px; }
        }
        @container (min-width: 620px) {
          .agenda-badge-status { font-size: 10.5px; padding: 3px 5px; text-transform: none; font-weight: 700; letter-spacing: 0; }
          .agenda-badge-status .lbl-short { display: none; }
          .agenda-badge-status .lbl-full { display: inline; }
        }

        .agenda-side { background: var(--paper); padding: 6px 14px 14px 16px; min-width: 0; border-top: 1px dashed var(--rule-line); }
        .agenda-side-title { margin: 8px 0 0; font-size: 18px; font-style: italic; font-weight: 800; color: var(--ink); }
        .agenda-side-sub { margin: 2px 0 8px; font-size: 13px; color: var(--ink-muted); line-height: 1.4; }
        .agenda-list { display: flex; flex-direction: column; }
        .agenda-item { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; gap: 10px; align-items: start; width: 100%; text-align: left; background: transparent; border: 0; border-bottom: 1px solid var(--rule-line); border-radius: 4px; padding: 9px 6px; cursor: pointer; color: var(--ink); font-size: 15px; }
        .agenda-item:hover { background: rgba(184, 137, 79, 0.10); }
        .agenda-item.is-today { background: rgba(184, 137, 79, 0.16); box-shadow: inset 3px 0 0 var(--gold); }
        .agenda-item-date { text-align: center; line-height: 1; }
        .agenda-item-date b { display: block; font-size: 22px; font-style: italic; font-weight: 700; }
        .agenda-item-date small { display: block; margin-top: 3px; font-size: 12px; color: var(--ink-muted); }
        .agenda-item-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .agenda-item-title { display: flex; align-items: baseline; gap: 7px; font-weight: 700; line-height: 1.25; }
        .agenda-item-dot { flex-shrink: 0; width: 9px; height: 9px; border-radius: 50%; background: var(--ink-muted); transform: translateY(0.5px); }
        .agenda-item-feriado .agenda-item-dot { background: var(--red-ink); }
        .agenda-item-facultativo .agenda-item-dot { background: var(--amber-ink); }
        .agenda-item-pagamento .agenda-item-dot { background: var(--green-ink); }
        .agenda-item-extra .agenda-item-dot { background: var(--blue-ink); }
        .agenda-item-note { font-family: 'Caveat', cursive; font-size: 19px; font-weight: 700; line-height: 1.1; color: var(--blue-ink); overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-line; }
        .agenda-item-when { font-size: 12px; color: var(--ink-muted); white-space: nowrap; padding-top: 3px; }
        .agenda-item.is-past .agenda-item-title { font-weight: 600; color: var(--ink-muted); }
        .agenda-list-empty { margin: 6px 0 4px; font-style: italic; color: var(--ink-muted); line-height: 1.5; }

        .agenda-footer { padding: 10px 18px 14px 20px; border-top: 1px dashed var(--rule-line); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
        .agenda-legend { display: flex; gap: 14px; flex-wrap: wrap; }
        .agenda-legend-item { display: flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 700; color: var(--ink-muted); }
        .agenda-dot { width: 8px; height: 8px; border-radius: 50%; }
        .agenda-creator-info { text-align: right; font-size: 10px; font-weight: 700; color: var(--ink-muted); font-style: italic; }
        .agenda-creator-name { color: var(--cover); font-style: italic; font-size: 12px; }

        @container agendabook (min-width: 860px) {
          .agenda-spread { grid-template-columns: minmax(0, 1fr) 310px; }
          .agenda-side { border-top: 0; border-left: 1px dashed var(--gold); box-shadow: inset 8px 0 10px -10px rgba(20,20,10,0.35); padding-top: 12px; }
        }
        @media (max-width: 600px) {
          .agenda-card .card-top, .agenda-card .card-body { padding-left: 14px; padding-right: 14px; }
          .agenda-book { padding-left: 22px; --agenda-cell-min: 56px; }
          .agenda-binding { width: 22px; }
          .agenda-header { padding: 14px 12px 10px 14px; }
          .agenda-monthbar { order: 3; flex: 1 1 100%; }
          .agenda-nav-controls { flex: 1; justify-content: space-between; }
          .agenda-month-display { min-width: 0; flex: 1; }
          .agenda-weekdays { padding: 4px 8px; margin: 0 2px; }
          .agenda-weekdays div { font-size: 10px; }
          #agendaCalendarGrid { padding: 4px 6px 6px; gap: 2px; }
          .agenda-day-cell { padding: 3px 3px; }
          .agenda-badge-status { font-size: 8px; padding: 2px 1px; letter-spacing: 0; }
          .agenda-note-preview { font-size: 13px; }
          .agenda-footer { padding: 10px 12px 12px 14px; }
          .agenda-side { padding: 6px 10px 12px 12px; }
        }
        @media (max-width: 380px) {
          .agenda-book { padding-left: 18px; --agenda-cell-min: 50px; }
          .agenda-binding { width: 18px; }
          .agenda-day-num { font-size: 12px; }
          .agenda-day-cell { padding: 3px 2px; }
          .agenda-badge-status { font-size: 7.5px; }
          .agenda-footer { flex-direction: column; align-items: flex-start; }
          .agenda-creator-info { text-align: left; }
          .agenda-item { grid-template-columns: 34px minmax(0, 1fr); }
          .agenda-item-when { grid-column: 2; padding-top: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .agenda-day-cell { transition: none; }
          .agenda-day-cell:hover { transform: none; }
        }
      </style>
      <div class="card-top">
        <div style="display:flex; align-items:center; gap:0.55rem;">
          <span class="tradutor-badge agenda-badge">${ICONS.calendar}</span>
          <h2 style="margin:0;">Agenda Boa Vista 2026</h2>
        </div>
        <span class="subtitle">📅 Feriados, pontos facultativos e pagamentos, com anotações que acompanham você entre aparelhos</span>
      </div>
      <div class="card-body">
        <details class="agenda-privacy"${agendaSyncCode ? '' : ' open'}>
          <summary>${ICONS.info}<span>Como funcionam as anotações</span></summary>
          <p>Feriados e pagamentos aparecem sem nenhuma configuração. Para guardar anotações e vê-las em outros aparelhos, toque em 🔄 e defina um código de sincronização: ele funciona como uma senha compartilhada só entre os seus dispositivos. As anotações ficam em um banco de dados online (Firebase/Google), não neste navegador.</p>
        </details>

        <div class="agenda-book" id="agendaBook">
          <div class="agenda-binding"></div>
          <div class="agenda-header">
            <div class="agenda-brand">
              <h3>Boa Vista</h3>
              <p>Agenda oficial 2026</p>
            </div>
            <div class="agenda-monthbar">
              <div class="agenda-nav-controls">
                <button type="button" class="agenda-nav-btn" onclick="agendaChangeMonth(-1)" aria-label="Mês anterior">◀</button>
                <span id="agendaMonthDisplay" class="agenda-month-display" aria-live="polite">Janeiro</span>
                <button type="button" class="agenda-nav-btn" onclick="agendaChangeMonth(1)" aria-label="Próximo mês">▶</button>
              </div>
              <button type="button" id="agendaTodayBtn" class="agenda-today-btn" onclick="agendaGoToday()" hidden>Ir para hoje</button>
            </div>
            <div class="agenda-tools">
              <button type="button" id="agendaNotifyBtn" class="agenda-sync-btn" title="Notificar sobre a semana" aria-label="Notificar sobre a semana" onclick="agendaToggleNotify()">
                🔔<span id="agendaNotifyDot" class="agenda-sync-dot agenda-sync-off"></span>
              </button>
              <button type="button" id="agendaSyncBtn" class="agenda-sync-btn" title="Sincronização entre aparelhos" aria-label="Sincronização entre aparelhos" onclick="agendaOpenSyncModal()">
                🔄<span id="agendaSyncDot" class="agenda-sync-dot agenda-sync-off"></span>
              </button>
            </div>
          </div>

          <div id="agendaTodayBanner" class="agenda-today-banner" role="status" aria-live="polite">
            <div class="agenda-sync-card-head">
              <span class="agenda-today-icon" aria-hidden="true">🔔</span>
              <span class="agenda-sync-card-title">Resumo da semana</span>
              <span id="agendaSyncCardTime" class="agenda-sync-card-time"></span>
              <button type="button" class="agenda-today-close" onclick="agendaDismissTodayBanner()" aria-label="Fechar o resumo da semana">✕</button>
            </div>
            <div id="agendaTodayText" class="agenda-today-text"></div>
          </div>

          <div class="agenda-spread">
            <div class="agenda-cal">
              <div class="agenda-weekdays" aria-hidden="true">
                <div class="agenda-dom">Dom</div><div>Seg</div><div>Ter</div><div>Qua</div><div>Qui</div><div>Sex</div><div>Sáb</div>
              </div>
              <div id="agendaCalendarGrid"></div>
            </div>
            <aside class="agenda-side" aria-labelledby="agendaSideTitle">
              <h4 class="agenda-side-title" id="agendaSideTitle">Neste mês</h4>
              <p class="agenda-side-sub" id="agendaMonthSummary"></p>
              <div class="agenda-list" id="agendaMonthList"></div>
            </aside>
          </div>

          <div class="agenda-footer">
            <div class="agenda-legend">
              <div class="agenda-legend-item"><div class="agenda-dot" style="background:var(--red-ink)"></div>Feriado</div>
              <div class="agenda-legend-item"><div class="agenda-dot" style="background:var(--amber-bg); box-shadow: inset 0 0 0 1px var(--amber-ink)"></div>Facultativo</div>
              <div class="agenda-legend-item"><div class="agenda-dot" style="background:var(--green-ink)"></div>Pagamento</div>
              <div class="agenda-legend-item"><div class="agenda-dot" style="background:var(--blue-ink)"></div>13º salário</div>
            </div>
            <div class="agenda-creator-info">
              Criado por<br><span class="agenda-creator-name">Paulo Xavier — CRP-20/09816</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function agendaKeyFor(month, day) {
  return AGENDA_YEAR + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

// Dia que recebe o foco do teclado (só uma célula fica na ordem de Tab).
let agendaFocusDay = 0;

function agendaDaysInMonth(month) {
  return new Date(AGENDA_YEAR, month + 1, 0).getDate();
}

function agendaRenderCalendar() {
  const grid = document.getElementById('agendaCalendarGrid');
  const display = document.getElementById('agendaMonthDisplay');
  if (!grid || !display) return;

  // A grade é refeita a cada sincronização; guarda o foco para o teclado não
  // "cair" no meio da navegação.
  const active = document.activeElement;
  const keepFocusDay = (active && grid.contains(active) && active.dataset && active.dataset.day) ? Number(active.dataset.day) : 0;

  grid.innerHTML = '';
  display.textContent = AGENDA_MONTH_NAMES[agendaCurrentMonth];

  const today = new Date();
  const inYear = today.getFullYear() === AGENDA_YEAR;
  const isThisMonth = inYear && today.getMonth() === agendaCurrentMonth;
  const first = new Date(AGENDA_YEAR, agendaCurrentMonth, 1).getDay();
  const count = agendaDaysInMonth(agendaCurrentMonth);
  // Só as semanas que o mês realmente usa (5 ou 6 linhas), sem linha vazia.
  const totalCells = Math.ceil((first + count) / 7) * 7;
  const tabDay = (agendaFocusDay >= 1 && agendaFocusDay <= count) ? agendaFocusDay : (isThisMonth ? today.getDate() : 1);

  const todayBtn = document.getElementById('agendaTodayBtn');
  if (todayBtn) todayBtn.hidden = !(inYear && !isThisMonth);

  for (let i = 0; i < totalCells; i++) {
    const d = i - first + 1;
    const cell = document.createElement('div');
    cell.className = 'agenda-day-cell';

    if (d > 0 && d <= count) {
      const key = agendaKeyFor(agendaCurrentMonth, d);
      const info = AGENDA_DATA_INFO[key];
      const date = new Date(AGENDA_YEAR, agendaCurrentMonth, d);
      const wd = date.getDay();
      const note = agendaNotesCache[key];

      if (wd === 0) cell.classList.add('agenda-bg-sunday');
      else if (wd === 6) cell.classList.add('agenda-bg-saturday');

      const isToday = isThisMonth && today.getDate() === d;
      if (isToday) cell.classList.add('agenda-is-today');

      let html = '<span class="agenda-day-num" style="color:' + (wd === 0 ? 'var(--red-ink)' : 'var(--ink)') + '">' + d + '</span>';
      if (note) {
        const tilt = (d % 2 === 0) ? '-1.5deg' : '1deg';
        html += '<div class="agenda-note-preview" style="transform:rotate(' + tilt + ')">' + escapeHtml(note) + '</div>';
      }
      if (info) {
        const full = info.label === 'FAC.' ? 'Facultativo' : agendaFullName(info);
        html += '<div class="agenda-badge-status ' + info.type + '" title="' + escapeHtml(agendaDayTitle(key)) + '"><span class="lbl-short">' + escapeHtml(info.label === '13º SAL.' ? '13º' : info.label) + '</span><span class="lbl-full">' + escapeHtml(full) + '</span></div>';
      }

      cell.innerHTML = html;
      cell.dataset.day = String(d);
      cell.setAttribute('role', 'button');
      cell.setAttribute('tabindex', d === tabDay ? '0' : '-1');
      if (isToday) cell.setAttribute('aria-current', 'date');
      let ariaLabel = agendaLongDate(date);
      if (info) ariaLabel += ', ' + agendaDayTitle(key);
      if (note) ariaLabel += ', com anotação: ' + note;
      cell.setAttribute('aria-label', ariaLabel);
      cell.addEventListener('click', () => { agendaFocusDay = d; agendaOpenNoteModal(key); });
      cell.addEventListener('focus', () => {
        agendaFocusDay = d;
        grid.querySelectorAll('.agenda-day-cell[tabindex="0"]').forEach(c => { if (c !== cell) c.setAttribute('tabindex', '-1'); });
        cell.setAttribute('tabindex', '0');
      });
      cell.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); agendaFocusDay = d; agendaOpenNoteModal(key); return; }
        const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
        if (moves[ev.key] !== undefined) { ev.preventDefault(); agendaMoveFocus(d, moves[ev.key]); }
        else if (ev.key === 'PageUp') { ev.preventDefault(); agendaChangeMonth(-1, d); }
        else if (ev.key === 'PageDown') { ev.preventDefault(); agendaChangeMonth(1, d); }
      });
    } else {
      cell.classList.add('agenda-day-empty');
      cell.setAttribute('aria-hidden', 'true');
    }
    grid.appendChild(cell);
  }

  if (keepFocusDay) {
    const again = grid.querySelector('.agenda-day-cell[data-day="' + keepFocusDay + '"]');
    if (again) again.focus({ preventScroll: true });
  }

  agendaRenderMonthList();
}

// Página ao lado do calendário: cada data marcada do mês com nome completo,
// e cada anotação inteira (a grade só mostra o começo dela).
function agendaRenderMonthList() {
  const list = document.getElementById('agendaMonthList');
  const summary = document.getElementById('agendaMonthSummary');
  if (!list) return;

  const m = agendaCurrentMonth;
  const count = agendaDaysInMonth(m);
  const now = new Date();
  const todayKey = now.getFullYear() === AGENDA_YEAR ? agendaKeyFor(now.getMonth(), now.getDate()) : '';
  const counts = { feriado: 0, facultativo: 0, pagamento: 0, extra: 0 };
  let notes = 0;
  let html = '';

  for (let d = 1; d <= count; d++) {
    const key = agendaKeyFor(m, d);
    const info = AGENDA_DATA_INFO[key];
    const note = agendaNotesCache[key];
    if (!info && !note) continue;
    if (info) counts[argoAgendaKind(info)]++;
    if (note) notes++;

    const date = new Date(AGENDA_YEAR, m, d);
    const kind = info ? argoAgendaKind(info) : 'nota';
    const title = agendaDayTitle(key);
    const rel = agendaRelativeLabel(key);
    const isToday = key === todayKey;
    const isPast = !!todayKey && key < todayKey;
    let label = agendaLongDate(date);
    if (title) label += ', ' + title;
    if (note) label += ', anotação: ' + note;

    html += '<button type="button" class="agenda-item agenda-item-' + kind + (isToday ? ' is-today' : '') + (isPast ? ' is-past' : '') + '" data-key="' + key + '" aria-label="' + escapeHtml(label) + '">' +
      '<span class="agenda-item-date"><b>' + d + '</b><small>' + AGENDA_WEEKDAY_ABBR[date.getDay()].toLowerCase() + '</small></span>' +
      '<span class="agenda-item-main">' +
        (info ? '<span class="agenda-item-title"><i class="agenda-item-dot"></i><span>' + escapeHtml(title) + '</span></span>' : '') +
        (note ? '<span class="agenda-item-note">' + escapeHtml(note) + '</span>' : '') +
      '</span>' +
      '<span class="agenda-item-when">' + rel + '</span>' +
    '</button>';
  }

  if (!html) {
    html = '<p class="agenda-list-empty">Nenhuma data marcada em ' + AGENDA_MONTH_NAMES[m].toLowerCase() + '. Toque em um dia do calendário para fazer uma anotação.</p>';
  }
  list.innerHTML = html;
  list.onclick = (ev) => {
    const btn = ev.target.closest ? ev.target.closest('.agenda-item') : null;
    if (btn) agendaOpenNoteModal(btn.dataset.key);
  };

  if (summary) {
    const parts = [];
    if (counts.feriado) parts.push(counts.feriado + (counts.feriado === 1 ? ' feriado' : ' feriados'));
    if (counts.facultativo) parts.push(counts.facultativo + (counts.facultativo === 1 ? ' ponto facultativo' : ' pontos facultativos'));
    if (counts.pagamento) parts.push(counts.pagamento + (counts.pagamento === 1 ? ' pagamento' : ' pagamentos'));
    if (counts.extra) parts.push(counts.extra + (counts.extra === 1 ? ' outra data' : ' outras datas'));
    if (notes) parts.push(notes + (notes === 1 ? ' anotação' : ' anotações'));
    summary.textContent = agendaJoinPt(parts);
  }
}

function agendaChangeMonth(delta, keepDay) {
  agendaCurrentMonth = (agendaCurrentMonth + delta + 12) % 12;
  agendaFocusDay = keepDay ? Math.min(keepDay, agendaDaysInMonth(agendaCurrentMonth)) : 0;
  agendaRenderCalendar();
  if (keepDay) agendaFocusCell(agendaFocusDay);
}

function agendaGoToday() {
  const now = new Date();
  if (now.getFullYear() !== AGENDA_YEAR) {
    agendaToast('A agenda cobre apenas ' + AGENDA_YEAR + '.');
    return;
  }
  agendaCurrentMonth = now.getMonth();
  agendaFocusDay = 0;
  agendaRenderCalendar();
}

function agendaFocusCell(day) {
  const cell = document.querySelector('#agendaCalendarGrid .agenda-day-cell[data-day="' + day + '"]');
  if (cell) cell.focus();
}

// Setas do teclado andam pelos dias; nas pontas do mês, passam para o mês
// vizinho (sem dar a volta de dezembro para janeiro).
function agendaMoveFocus(fromDay, delta) {
  const count = agendaDaysInMonth(agendaCurrentMonth);
  let target = fromDay + delta;
  if (target < 1) {
    if (agendaCurrentMonth === 0) return;
    agendaCurrentMonth -= 1;
    target = agendaDaysInMonth(agendaCurrentMonth) + target;
    agendaFocusDay = target;
    agendaRenderCalendar();
  } else if (target > count) {
    if (agendaCurrentMonth === 11) return;
    agendaCurrentMonth += 1;
    target = target - count;
    agendaFocusDay = target;
    agendaRenderCalendar();
  } else {
    agendaFocusDay = target;
  }
  agendaFocusCell(target);
}

// Deslizar para os lados troca de mês (celular).
function agendaAttachSwipe() {
  const book = document.getElementById('agendaBook');
  if (!book || book.dataset.swipe === '1') return;
  book.dataset.swipe = '1';
  let sx = 0, sy = 0, tracking = false;
  book.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { tracking = false; return; }
    tracking = true; sx = e.touches[0].clientX; sy = e.touches[0].clientY;
  }, { passive: true });
  book.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) agendaChangeMonth(dx < 0 ? 1 : -1);
  }, { passive: true });
}

// ======= Modais (ficam presos ao <body>, fora do card, para que
// position:fixed funcione mesmo com a animação de entrada dos cards) =======

let agendaLastFocus = null;
let agendaNoteOriginal = '';
let agendaPendingSave = false;   // "guardar assim que a sincronização conectar"
let agendaDeleteArmed = false;
let agendaDeleteTimer = null;
let agendaBusy = false;

function agendaEnsureModals() {
  if (document.getElementById('agendaNoteModal')) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div id="agendaNoteModal" class="agenda-modal-overlay" onclick="if(event.target==this && !agendaNoteIsDirty()) agendaCloseNoteModal()">
      <div class="agenda-modal-box" role="dialog" aria-modal="true" aria-labelledby="agendaModalDate">
        <div class="agenda-modal-header">
          <div>
            <h3 id="agendaModalDate" class="agenda-modal-title">Data</h3>
            <div id="agendaModalChip" class="agenda-modal-chip" hidden></div>
          </div>
          <button type="button" class="agenda-modal-x" onclick="agendaCloseNoteModal()" aria-label="Fechar">&times;</button>
        </div>
        <label for="agendaNoteInput" class="agenda-sr-only">Anotação do dia</label>
        <textarea id="agendaNoteInput" rows="4" maxlength="500" placeholder="Escrever nota…" class="agenda-textarea" oninput="agendaUpdateNoteCounter()"></textarea>
        <div class="agenda-note-meta">
          <span id="agendaNoteHint" class="agenda-note-hint"></span>
          <span id="agendaNoteCounter" class="agenda-note-counter">0/500</span>
        </div>
        <div class="agenda-btn-group">
          <button type="button" id="agendaSaveBtn" onclick="agendaSaveNote()" class="agenda-btn-save">Guardar</button>
          <button type="button" id="agendaDelBtn" onclick="agendaDeleteNote()" class="agenda-btn-del" hidden>Apagar</button>
        </div>
      </div>
    </div>
    <div id="agendaSyncModal" class="agenda-modal-overlay" onclick="if(event.target==this) agendaCloseSyncModal()">
      <div class="agenda-modal-box" role="dialog" aria-modal="true" aria-labelledby="agendaSyncTitle">
        <div class="agenda-modal-header">
          <h3 id="agendaSyncTitle" class="agenda-modal-title">Sincronização</h3>
          <button type="button" class="agenda-modal-x" onclick="agendaCloseSyncModal()" aria-label="Fechar">&times;</button>
        </div>
        <div id="agendaSyncStatusLine" class="agenda-status-line" aria-live="polite"></div>
        <div id="agendaSyncHint" class="agenda-sync-hint" hidden>Sua anotação será guardada assim que a sincronização conectar.</div>
        <div class="agenda-sync-info">Este código conecta suas anotações entre aparelhos. Use o <b>mesmo código</b> em todos os dispositivos.</div>
        <div id="agendaSyncCodeDisplay" class="agenda-sync-code-display" style="display:none;"></div>
        <label for="agendaSyncCodeInput" class="agenda-sr-only">Código de sincronização</label>
        <input type="text" id="agendaSyncCodeInput" placeholder="Digite um código (ex: familia-xavier)" class="agenda-input" autocomplete="off" autocapitalize="off" spellcheck="false">
        <div class="agenda-btn-group">
          <button type="button" onclick="agendaUseSyncCode()" class="agenda-btn-save">Usar este código</button>
          <button type="button" onclick="agendaGenerateSyncCode()" class="agenda-btn-secondary">Gerar novo</button>
        </div>
        <button type="button" id="agendaCopyBtn" onclick="agendaCopySyncCode()" class="agenda-btn-link" hidden>Copiar código atual</button>
      </div>
    </div>
    <style>
      .agenda-modal-overlay { display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(20,16,10,0.5); z-index:999; align-items:center; justify-content:center; padding:16px; box-sizing:border-box; }
      .agenda-modal-box { background:#f8f2e4; background-image: repeating-linear-gradient(to bottom, transparent 0px, transparent 25px, #e0d3ac 25px, #e0d3ac 26px); width:100%; max-width:360px; max-height:100%; overflow:auto; border-radius:4px 14px 14px 4px; padding:20px 22px 22px; box-shadow:0 16px 34px rgba(0,0,0,0.28); position:relative; border-left:8px solid #1f3d33; font-family:'Times New Roman', Times, serif; color:#2c2620; box-sizing:border-box; }
      .agenda-modal-header { display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:12px; }
      .agenda-modal-title { margin:0; font-size:20px; font-style:italic; font-weight:700; line-height:1.2; }
      #agendaModalDate::first-letter { text-transform:uppercase; }
      .agenda-modal-chip { display:inline-flex; align-items:center; gap:6px; margin-top:6px; padding:3px 10px 3px 8px; border-radius:12px; font-size:13px; font-weight:700; background:rgba(44,38,32,0.07); }
      .agenda-modal-chip[hidden] { display:none; }
      .agenda-modal-chip i { width:9px; height:9px; border-radius:50%; background:#6f6551; }
      .agenda-modal-chip[data-kind="feriado"] i { background:#b3413a; }
      .agenda-modal-chip[data-kind="facultativo"] i { background:#a9762a; }
      .agenda-modal-chip[data-kind="pagamento"] i { background:#3f7d55; }
      .agenda-modal-chip[data-kind="extra"] i { background:#2f5d8a; }
      .agenda-modal-x { background:none; border:none; font-size:26px; line-height:1; cursor:pointer; color:#6f6551; padding:2px 8px; border-radius:6px; }
      .agenda-modal-x:hover { background:#efe4cb; color:#1f3d33; }
      .agenda-textarea, .agenda-input { width:100%; border:1px solid #d3c495; background:rgba(255,255,255,0.6); border-radius:8px; padding:10px; box-sizing:border-box; color:#2c2620; }
      .agenda-textarea { font-family:'Caveat', cursive; font-size:21px; line-height:1.15; color:#2f5d8a; resize:vertical; min-height:96px; max-height:220px; margin-bottom:4px; }
      .agenda-input { font-family:'Times New Roman', Times, serif; font-size:15px; margin-bottom:14px; }
      .agenda-textarea:focus, .agenda-input:focus { outline:2px solid #1f3d33; outline-offset:1px; }
      .agenda-note-meta { display:flex; justify-content:space-between; gap:10px; font-size:12px; color:#6f6551; margin-bottom:12px; min-height:16px; }
      .agenda-note-hint { flex:1; line-height:1.3; }
      .agenda-note-counter { white-space:nowrap; }
      .agenda-btn-group { display:flex; gap:8px; }
      .agenda-btn-group button { font-family:inherit; font-size:15px; }
      .agenda-btn-save { flex:1; background:#1f3d33; color:#f8f2e4; border:none; padding:11px; border-radius:8px; font-weight:700; cursor:pointer; }
      .agenda-btn-save:hover:not(:disabled) { background:#14261f; }
      .agenda-btn-save:disabled { opacity:0.6; cursor:progress; }
      .agenda-btn-del { background:#f3dbd8; color:#8f2d27; border:none; padding:11px 14px; border-radius:8px; font-weight:700; cursor:pointer; }
      .agenda-btn-del[hidden] { display:none; }
      .agenda-btn-del.armed { background:#b3413a; color:#fff; }
      .agenda-btn-secondary { flex:1; background:#efe4cb; color:#2c2620; border:1px solid #d3c495; padding:11px; border-radius:8px; font-weight:700; cursor:pointer; }
      .agenda-btn-link { display:block; margin:12px auto 0; background:none; border:none; color:#1f3d33; font-family:inherit; font-size:14px; font-weight:700; text-decoration:underline; cursor:pointer; padding:4px 8px; }
      .agenda-btn-link[hidden] { display:none; }
      .agenda-modal-box button:focus-visible { outline:2px solid #1f3d33; outline-offset:2px; }
      .agenda-sync-info { font-size:14px; color:#5f5644; margin-bottom:10px; line-height:1.5; }
      .agenda-sync-hint { font-size:13px; font-weight:700; color:#5c3f0d; background:#f0d78a; border-radius:8px; padding:8px 10px; margin-bottom:10px; line-height:1.4; }
      .agenda-sync-hint[hidden] { display:none; }
      .agenda-sync-code-display { font-size:17px; font-weight:800; letter-spacing:1px; background:#efe4cb; border:1px dashed #b8894f; border-radius:8px; padding:10px; text-align:center; margin-bottom:12px; color:#1f3d33; overflow-wrap:anywhere; }
      .agenda-status-line { font-size:13px; margin-bottom:10px; }
      .agenda-sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
      .agenda-toast { position:fixed; left:50%; bottom:max(24px, env(safe-area-inset-bottom)); transform:translate(-50%, 12px); max-width:min(92vw, 420px); background:#1f3d33; color:#f8f2e4; padding:11px 16px; border-radius:10px; font:600 14px/1.4 'Times New Roman', Times, serif; box-shadow:0 10px 24px rgba(0,0,0,0.3); z-index:1001; opacity:0; pointer-events:none; transition:opacity .18s, transform .18s; text-align:center; }
      .agenda-toast.visible { opacity:1; transform:translate(-50%, 0); }
      .agenda-toast[data-kind="error"] { background:#8f2d27; }
      @media (prefers-reduced-motion: reduce) { .agenda-toast { transition:none; } }
    </style>
  `;
  document.body.appendChild(wrap);

  // Teclado dos modais (registrado uma única vez): Esc fecha, Ctrl/⌘+Enter
  // guarda a nota, e Tab fica preso dentro do modal aberto.
  if (!window.__agendaKeysBound) {
    window.__agendaKeysBound = true;
    document.addEventListener('keydown', function (e) {
      const noteModal = document.getElementById('agendaNoteModal');
      const syncModal = document.getElementById('agendaSyncModal');
      const noteOpen = noteModal && noteModal.style.display === 'flex';
      const syncOpen = syncModal && syncModal.style.display === 'flex';
      if (!noteOpen && !syncOpen) return;
      const top = syncOpen ? syncModal : noteModal;   // o de sincronização abre por cima
      if (e.key === 'Escape') {
        e.preventDefault();
        if (syncOpen) agendaCloseSyncModal(); else agendaCloseNoteModal();
        return;
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && top === noteModal) {
        e.preventDefault();
        agendaSaveNote();
        return;
      }
      if (e.key === 'Tab') {
        const items = Array.from(top.querySelectorAll('button, textarea, input')).filter(el => !el.disabled && !el.hidden && el.offsetParent !== null);
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (!top.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }
}

function agendaNoteIsDirty() {
  const input = document.getElementById('agendaNoteInput');
  return !!input && input.value.trim() !== agendaNoteOriginal.trim();
}

function agendaUpdateNoteCounter() {
  const input = document.getElementById('agendaNoteInput');
  const counter = document.getElementById('agendaNoteCounter');
  if (input && counter) counter.textContent = input.value.length + '/' + (input.maxLength > 0 ? input.maxLength : 500);
}

function agendaResetDeleteButton() {
  agendaDeleteArmed = false;
  clearTimeout(agendaDeleteTimer);
  const del = document.getElementById('agendaDelBtn');
  if (del) { del.textContent = 'Apagar'; del.classList.remove('armed'); }
}

function agendaOpenNoteModal(key) {
  agendaEnsureModals();
  agendaSelectedKey = key;
  agendaLastFocus = document.activeElement;
  agendaPendingSave = false;
  agendaResetDeleteButton();

  const date = agendaDateFromKey(key);
  const info = AGENDA_DATA_INFO[key];
  const note = agendaNotesCache[key] || '';
  agendaNoteOriginal = note;

  document.getElementById('agendaModalDate').textContent = agendaLongDate(date);
  const chip = document.getElementById('agendaModalChip');
  if (info) {
    chip.hidden = false;
    chip.dataset.kind = argoAgendaKind(info);
    chip.innerHTML = '<i></i>' + escapeHtml(agendaDayTitle(key));
  } else {
    chip.hidden = true;
    chip.innerHTML = '';
  }

  const input = document.getElementById('agendaNoteInput');
  input.value = note;
  agendaUpdateNoteCounter();

  const hint = document.getElementById('agendaNoteHint');
  const save = document.getElementById('agendaSaveBtn');
  save.disabled = false;
  if (!agendaSyncCode) {
    hint.textContent = 'Para guardar, defina um código de sincronização.';
    save.textContent = 'Guardar e sincronizar';
  } else {
    hint.textContent = (window.matchMedia && window.matchMedia('(hover: hover)').matches) ? 'Ctrl+Enter guarda.' : '';
    save.textContent = 'Guardar';
  }
  document.getElementById('agendaDelBtn').hidden = !note;

  document.getElementById('agendaNoteModal').style.display = 'flex';
  input.focus();
}

function agendaCloseNoteModal() {
  const m = document.getElementById('agendaNoteModal');
  if (m) m.style.display = 'none';
  agendaPendingSave = false;
  agendaResetDeleteButton();
  const sm = document.getElementById('agendaSyncModal');
  if (sm && sm.style.display === 'flex') return;   // o foco fica com o modal de cima
  // A grade e a lista são redesenhadas a cada sincronização (inclusive logo
  // depois de guardar), então o elemento que abriu o modal pode já ter sido
  // substituído. Nesse caso, procura o equivalente pelo dia.
  let target = agendaLastFocus;
  if (!target || !document.contains(target)) {
    const day = agendaSelectedKey ? Number(agendaSelectedKey.slice(8)) : 0;
    const fromList = agendaLastFocus && agendaLastFocus.classList && agendaLastFocus.classList.contains('agenda-item');
    target = fromList ? document.querySelector('#agendaMonthList .agenda-item[data-key="' + agendaSelectedKey + '"]') : null;
    // Item da lista que sumiu (nota apagada): cai no dia do calendário.
    if (!target) target = document.querySelector('#agendaCalendarGrid .agenda-day-cell[data-day="' + day + '"]');
  }
  if (target && typeof target.focus === 'function') {
    try { target.focus({ preventScroll: true }); } catch (e) { /* ignora */ }
  }
}

// Grava (ou apaga, se o texto for vazio) e espera a confirmação do servidor
// por até 7 s. O Firestore já atualiza a tela na hora, mesmo sem internet;
// se a confirmação demorar, avisa que o envio fica na fila.
async function agendaCommitNote(key, text) {
  const ref = agendaDb.collection('agendas').doc(agendaSyncCode).collection('notes').doc(key);
  const op = text
    ? ref.set({ text: text, updatedAt: firebase.firestore.FieldValue.serverTimestamp() })
    : ref.delete();
  op.catch(() => { /* tratado abaixo ou depois do prazo */ });
  const outcome = await Promise.race([
    op.then(() => 'ok'),
    new Promise(resolve => setTimeout(() => resolve('slow'), 7000))
  ]);
  return outcome;
}

async function agendaSaveNote() {
  if (agendaBusy) return;
  const input = document.getElementById('agendaNoteInput');
  const txt = input.value.trim();

  if (!txt && !agendaNoteOriginal) { agendaToast('Escreva algo antes de guardar.'); input.focus(); return; }

  if (!agendaSyncCode) {
    // Sem código ainda: abre a sincronização e guarda sozinho quando conectar.
    agendaPendingSave = true;
    agendaOpenSyncModal();
    return;
  }
  if (!agendaDb) {
    agendaPendingSave = true;
    agendaToast('Conectando à nuvem. A anotação será guardada assim que conectar.');
    return;
  }

  const save = document.getElementById('agendaSaveBtn');
  agendaBusy = true;
  save.disabled = true;
  save.textContent = 'Guardando…';
  const key = agendaSelectedKey;
  try {
    const outcome = await agendaCommitNote(key, txt);
    agendaCloseNoteModal();
    if (outcome === 'ok') agendaToast(txt ? 'Anotação guardada.' : 'Anotação apagada.');
    else agendaToast('Sem resposta do servidor. A anotação já aparece aqui e será enviada quando a conexão voltar; mantenha o app aberto.', 'error');
  } catch (e) {
    console.error(e);
    save.disabled = false;
    save.textContent = 'Guardar';
    agendaToast('Não foi possível guardar na nuvem. Verifique a internet e tente de novo.', 'error');
  } finally {
    agendaBusy = false;
  }
}

// Apagar pede um segundo toque (o botão vira "Apagar mesmo?") — a nota some
// de todos os aparelhos, então não pode ser um toque acidental.
async function agendaDeleteNote() {
  if (agendaBusy) return;
  if (!agendaSyncCode || !agendaDb) { agendaToast('Ainda conectando à nuvem. Tente de novo em alguns segundos.'); return; }
  const del = document.getElementById('agendaDelBtn');
  if (!agendaDeleteArmed) {
    agendaDeleteArmed = true;
    del.textContent = 'Apagar mesmo?';
    del.classList.add('armed');
    clearTimeout(agendaDeleteTimer);
    agendaDeleteTimer = setTimeout(agendaResetDeleteButton, 3500);
    return;
  }
  agendaBusy = true;
  agendaResetDeleteButton();
  try {
    const outcome = await agendaCommitNote(agendaSelectedKey, '');
    agendaCloseNoteModal();
    if (outcome === 'ok') agendaToast('Anotação apagada.');
    else agendaToast('Sem resposta do servidor. A exclusão será enviada quando a conexão voltar; mantenha o app aberto.', 'error');
  } catch (e) {
    console.error(e);
    agendaToast('Não foi possível apagar na nuvem. Verifique a internet e tente de novo.', 'error');
  } finally {
    agendaBusy = false;
  }
}

// ======= Sincronização =======

function agendaUpdateSyncIndicator(connected) {
  const dot = document.getElementById('agendaSyncDot');
  if (dot) dot.className = 'agenda-sync-dot ' + (connected ? 'agenda-sync-ok' : 'agenda-sync-off');
  const btn = document.getElementById('agendaSyncBtn');
  if (btn) {
    const t = connected ? 'Sincronização: conectada' : (agendaSyncCode ? 'Sincronização: desconectada' : 'Sincronização: defina um código');
    btn.title = t;
    btn.setAttribute('aria-label', t);
  }
}

let agendaConnectingCode = '';

async function agendaConnectSync(code, force) {
  const newCode = code.trim().toLowerCase().replace(/\s+/g, '-');
  if (!newCode) return;
  // Já há uma conexão em andamento (ou ativa) com este mesmo código: não
  // abre uma segunda escuta. A notificação de abertura e a aba da agenda
  // podem chamar esta função quase ao mesmo tempo.
  // `force` (botão "Tentar de novo" da notificação) ignora essa trava: quando
  // a conexão fica pendurada em "connecting" (rede ruim, sem erro), sem isso
  // o botão caía aqui e não reconectava nada.
  if (!force && newCode === agendaConnectingCode && (agendaUnsubscribe || agendaSyncState === 'connecting')) return;
  agendaConnectingCode = newCode;
  agendaSyncCode = newCode;
  localStorage.setItem('argo_agenda_sync_code', agendaSyncCode);

  agendaSetSyncStatus('<span style="color:#6f6551">● Conectando…</span>', 'connecting');

  let firebaseLib;
  try {
    firebaseLib = await agendaEnsureFirebase();
    if (!agendaFirebaseReady) {
      firebaseLib.initializeApp(AGENDA_FIREBASE_CONFIG);
      agendaDb = firebaseLib.firestore();
      agendaFirebaseReady = true;
    }
  } catch (e) {
    console.error(e);
    agendaUpdateSyncIndicator(false);
    agendaSetSyncStatus('<span style="color:var(--red-ink,#b3413a)">● Não foi possível carregar a sincronização (verifique a internet)</span>', 'error');
    agendaConnectingCode = '';
    return;
  }

  if (agendaUnsubscribe) agendaUnsubscribe();

  agendaUnsubscribe = agendaDb.collection('agendas').doc(agendaSyncCode).collection('notes')
    .onSnapshot(snapshot => {
      agendaNotesCache = {};
      snapshot.forEach(doc => { agendaNotesCache[doc.id] = doc.data().text; });
      agendaUpdateSyncIndicator(true);
      // Registra o horário aqui (e não só em agendaRenderTodayBanner), pois a
      // sincronização agora pode conectar antes de a aba da agenda existir.
      agendaLastSyncAt = new Date();
      agendaRenderCalendar();
      // A notificação da sincronização agora fica num card dentro da agenda
      // (antes disparava uma notificação do sistema a cada sincronização).
      agendaRenderTodayBanner(true);
      agendaRefreshSyncModal();
      agendaSetSyncStatus('<span style="color:var(--green-ink,#3f7d55)">● Conectado</span>', 'ok');
      // Anotação que estava esperando a conexão: guarda agora e fecha a
      // janela de sincronização.
      if (agendaPendingSave) {
        agendaPendingSave = false;
        agendaCloseSyncModal();
        const nm = document.getElementById('agendaNoteModal');
        if (nm && nm.style.display === 'flex') agendaSaveNote();
      }
    }, err => {
      console.error(err);
      // O Firestore encerra a escuta quando dá erro; sem limpar aqui, a
      // agenda achava que ainda estava conectada e nunca tentava de novo.
      try { if (agendaUnsubscribe) agendaUnsubscribe(); } catch (e) { /* já encerrada */ }
      agendaUnsubscribe = null;
      agendaConnectingCode = '';
      agendaUpdateSyncIndicator(false);
      agendaSetSyncStatus('<span style="color:var(--red-ink,#b3413a)">● Erro de conexão</span>', 'error');
    });
}

function agendaRefreshSyncModal() {
  const display = document.getElementById('agendaSyncCodeDisplay');
  const copy = document.getElementById('agendaCopyBtn');
  const hint = document.getElementById('agendaSyncHint');
  if (display) {
    if (agendaSyncCode) { display.style.display = 'block'; display.textContent = agendaSyncCode; }
    else display.style.display = 'none';
  }
  if (copy) copy.hidden = !agendaSyncCode;
  if (hint) hint.hidden = !agendaPendingSave;
}

let agendaSyncOpener = null;

function agendaOpenSyncModal() {
  agendaEnsureModals();
  const modal = document.getElementById('agendaSyncModal');
  if (modal.style.display !== 'flex') agendaSyncOpener = document.activeElement;
  modal.style.display = 'flex';
  agendaRefreshSyncModal();
  const statusLine = document.getElementById('agendaSyncStatusLine');
  if (agendaSyncCode) {
    statusLine.innerHTML = agendaSyncStatusHtml || '<span style="color:#6f6551">● Conectando…</span>';
  } else {
    statusLine.innerHTML = '<span style="color:#6f6551">● Nenhum código definido ainda</span>';
  }
  const input = document.getElementById('agendaSyncCodeInput');
  if (input) input.focus();
}
function agendaCloseSyncModal() {
  const m = document.getElementById('agendaSyncModal');
  if (m) m.style.display = 'none';
  const nm = document.getElementById('agendaNoteModal');
  if (nm && nm.style.display === 'flex') {
    const input = document.getElementById('agendaNoteInput');
    if (input) input.focus();
  } else if (agendaSyncOpener && document.contains(agendaSyncOpener) && typeof agendaSyncOpener.focus === 'function') {
    try { agendaSyncOpener.focus({ preventScroll: true }); } catch (e) { /* ignora */ }
  }
}
function agendaUseSyncCode() {
  const input = document.getElementById('agendaSyncCodeInput');
  const val = input.value.trim();
  if (!val) { agendaToast('Digite um código.'); input.focus(); return; }
  // O código vira o nome de um documento no Firestore: barras e "." / ".."
  // não são aceitos ali e deixariam a conexão travada em "Conectando…".
  if (/[\/\\]/.test(val) || val === '.' || val === '..') {
    agendaToast('O código não pode ter barras nem ser só pontos.', 'error');
    input.focus();
    return;
  }
  agendaConnectSync(val);
}
async function agendaCopySyncCode() {
  if (!agendaSyncCode) return;
  try {
    await navigator.clipboard.writeText(agendaSyncCode);
    agendaToast('Código copiado.');
  } catch (e) {
    const d = document.getElementById('agendaSyncCodeDisplay');
    if (d && window.getSelection) {
      const r = document.createRange(); r.selectNodeContents(d);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    }
    agendaToast('Não deu para copiar sozinho. Selecionei o código: copie manualmente.');
  }
}
function agendaGenerateSyncCode() {
  // Esse código é a única "senha" da agenda sincronizada (ver regras do
  // Firestore acima), então usa gerador criptográfico e 10 caracteres em vez
  // de Math.random() com 6. Só vale para códigos NOVOS; os já em uso seguem
  // funcionando normalmente.
  const bytes = new Uint8Array(10);
  (window.crypto || window.msCrypto).getRandomValues(bytes);
  const code = 'agenda-' + Array.from(bytes, b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
  document.getElementById('agendaSyncCodeInput').value = code;
  agendaConnectSync(code);
}

// ======= Notificações (lembrete do dia) =======

function agendaUpdateNotifyIndicator() {
  const dot = document.getElementById('agendaNotifyDot');
  if (!dot) return;
  let title;
  if (!('Notification' in window)) { dot.className = 'agenda-sync-dot agenda-sync-neutral'; title = 'Este navegador não suporta notificações'; }
  else if (Notification.permission === 'granted') { dot.className = 'agenda-sync-dot agenda-sync-ok'; title = 'Notificações ativadas: toque para ver o resumo da semana'; }
  else if (Notification.permission === 'denied') { dot.className = 'agenda-sync-dot agenda-sync-off'; title = 'Notificações bloqueadas neste navegador'; }
  else { dot.className = 'agenda-sync-dot agenda-sync-neutral'; title = 'Ativar notificações do resumo da semana'; }
  const btn = document.getElementById('agendaNotifyBtn');
  if (btn) { btn.title = title; btn.setAttribute('aria-label', title); }
}

async function agendaShowTodayNotification(title, body) {
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      reg.showNotification(title, { body, icon: './icon-192.png', badge: './icon-192.png', tag: 'argo-agenda-today' });
      return;
    } catch (e) { /* cai para notificação simples abaixo */ }
  }
  new Notification(title, { body, icon: './icon-192.png' });
}

const AGENDA_WEEKDAY_ABBR = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// Datas da semana (domingo a sábado) que contém a data informada — mesma
// convenção de início de semana já usada na grade do calendário
// (agendaRenderCalendar, onde wd===0 é domingo).
function agendaWeekDates(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  return days;
}

// Resumo da semana (hoje + demais dias com algo marcado). Usado pelo card da
// agenda e pela notificação do sistema (botão 🔔). Devolve null fora de
// AGENDA_YEAR, pois não há dados.
function agendaBuildWeekSummary(now) {
  if (now.getFullYear() !== AGENDA_YEAR) return null;

  const todayKey = agendaKeyFor(now.getMonth(), now.getDate());

  // Um item por dia da semana (feriado/pagamento marcado em AGENDA_DATA_INFO
  // e/ou anotação própria em agendaNotesCache), pulando apenas os dias sem
  // nada marcado. Dias da semana que caem fora de AGENDA_YEAR (virada do
  // ano) não têm dados e ficam de fora do resumo.
  const weekEntries = agendaWeekDates(now)
    .filter(d => d.getFullYear() === AGENDA_YEAR)
    .map(d => {
      const key = agendaKeyFor(d.getMonth(), d.getDate());
      const info = AGENDA_DATA_INFO[key];
      const note = agendaNotesCache[key];
      if (!info && !note) return null;
      const parts = [];
      if (info) parts.push(agendaDayTitle(key));
      if (note) parts.push(note);
      return {
        isToday: key === todayKey,
        label: AGENDA_WEEKDAY_ABBR[d.getDay()] + ' ' + String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0'),
        text: parts.join(' • '),
        // Campos separados (usados pela notificação de abertura para
        // colorir o tipo do dia e limitar o tamanho da anotação).
        key: key,
        date: d,
        info: info || null,
        note: note || ''
      };
    })
    .filter(Boolean);

  // O dia de hoje vem primeiro e em destaque (📌 HOJE); o resto da semana
  // segue depois, em ordem cronológica, só com os dias que têm algo marcado.
  const todayEntry = weekEntries.find(e => e.isToday) || null;
  const restEntries = weekEntries.filter(e => !e.isToday);

  const bodyLines = [`📌 HOJE: ${todayEntry ? todayEntry.text : 'sem anotações'}`];
  if (restEntries.length) {
    bodyLines.push('Resto da semana: ' + restEntries.map(e => `${e.label} — ${e.text}`).join(' · '));
  }
  return { todayKey, weekEntries, todayEntry, restEntries, body: bodyLines.join('\n') };
}

// Notificação do sistema — só quando a pessoa toca em 🔔 (forceShow). Não
// dispara mais sozinha ao sincronizar: isso agora é o card da agenda.
function agendaCheckTodayNotifications(forceShow) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const summary = agendaBuildWeekSummary(new Date());
  if (!summary) return;

  if (!summary.weekEntries.length) {
    if (forceShow) agendaShowTodayNotification('Agenda Boa Vista', 'Nada marcado para esta semana.');
    return;
  }

  const body = summary.body;
  const notifiedKey = 'argo_agenda_notified_' + summary.todayKey;
  // Sem corte no hash: o resumo pode ter vários dias (mais texto que um
  // único dia), e cortar em poucos caracteres arriscava duas semanas
  // diferentes caírem no mesmo prefixo e a notificação real deixar de
  // aparecer.
  const notifiedHash = btoa(unescape(encodeURIComponent(body)));
  if (!forceShow && localStorage.getItem(notifiedKey) === notifiedHash) return;

  agendaShowTodayNotification('Agenda Boa Vista — Semana', body);
  localStorage.setItem(notifiedKey, notifiedHash);
}

// ======= Card de notificação dentro da agenda =======
// Mostra o resumo da semana (hoje em destaque) num card no topo do calendário.
// Aparece a cada sincronização (fromSync = true), com o horário dela; se a
// pessoa fechar o card, ele só volta quando o conteúdo do resumo mudar numa
// nova sincronização.
let agendaLastSyncAt = null;
let agendaLastCardSignature = '';

function agendaRenderTodayBanner(fromSync) {
  const banner = document.getElementById('agendaTodayBanner');
  const bodyEl = document.getElementById('agendaTodayText');
  const timeEl = document.getElementById('agendaSyncCardTime');
  if (!banner || !bodyEl) return;

  const summary = agendaBuildWeekSummary(new Date());
  if (!summary) { banner.style.display = 'none'; return; }

  if (fromSync === true) agendaLastSyncAt = new Date();

  const hasContent = summary.weekEntries.length > 0;
  // Sem sincronização e sem nada marcado, não há o que avisar.
  if (!hasContent && !agendaLastSyncAt) { banner.style.display = 'none'; return; }

  if (summary.body !== agendaLastCardSignature) {
    agendaLastCardSignature = summary.body;
    if (fromSync === true) agendaTodayBannerDismissed = false;
  }
  if (agendaTodayBannerDismissed) { banner.style.display = 'none'; return; }

  if (hasContent) {
    const rest = summary.restEntries
      .map(e => `<div class="agenda-sync-card-row"><strong>${escapeHtml(e.label)}</strong> — ${escapeHtml(e.text)}</div>`)
      .join('');
    bodyEl.innerHTML =
      `<div class="agenda-sync-card-today">📌 HOJE: ${escapeHtml(summary.todayEntry ? summary.todayEntry.text : 'sem anotações')}</div>` +
      (rest ? `<div class="agenda-sync-card-sub">Resto da semana</div>${rest}` : '');
  } else {
    bodyEl.textContent = 'Nada marcado para esta semana.';
  }

  if (timeEl) {
    timeEl.textContent = agendaLastSyncAt
      ? 'Sincronizado às ' + String(agendaLastSyncAt.getHours()).padStart(2, '0') + ':' + String(agendaLastSyncAt.getMinutes()).padStart(2, '0')
      : '';
  }
  banner.style.display = 'flex';
}

function agendaDismissTodayBanner() {
  agendaTodayBannerDismissed = true;
  const banner = document.getElementById('agendaTodayBanner');
  if (banner) banner.style.display = 'none';
}

async function agendaToggleNotify() {
  if (!('Notification' in window)) { agendaToast('Este navegador não suporta notificações.', 'error'); return; }
  if (Notification.permission === 'denied') {
    agendaToast('As notificações estão bloqueadas para este site. Para ativar, permita-as nas configurações do navegador ou do app.', 'error');
    return;
  }
  if (Notification.permission === 'default') {
    const result = await Notification.requestPermission();
    agendaUpdateNotifyIndicator();
    if (result !== 'granted') return;
  }
  agendaUpdateNotifyIndicator();
  agendaCheckTodayNotifications(true);
}

function initAgendaPanel() {
  agendaEnsureModals();
  agendaRenderCalendar();
  agendaAttachSwipe();
  agendaUpdateNotifyIndicator();
  agendaUpdateSyncIndicator(!!agendaUnsubscribe);
  agendaRenderTodayBanner();
  // Reconecta silenciosamente se já havia um código salvo neste navegador
  // (sem abrir o modal — só pede o código na primeira vez que o usuário
  // tentar guardar uma anotação ou tocar em 🔄).
  if (agendaSyncCode && !agendaUnsubscribe) {
    agendaConnectSync(agendaSyncCode);
  }
}


/* ============================================================
   FERRAMENTAS DE ARQUIVO — Unificar PDF · PDF<->Word · PDF<->JPG
   Tudo roda no navegador (client-side). As bibliotecas abaixo só
   são baixadas do cdnjs na primeira vez que cada função é usada
   (por isso não entram no cache offline do Service Worker).
   ============================================================ */
const PDFTOOLS_CDN = {
  pdfLib: 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js',
  pdfJs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfJsWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  jszip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  mammoth: 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.12.2/mammoth.browser.min.js'
};

const pdftoolsScriptPromises = {};
function pdftoolsLoadScript(url) {
  if (pdftoolsScriptPromises[url]) return pdftoolsScriptPromises[url];
  pdftoolsScriptPromises[url] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = () => resolve();
    s.onerror = () => { delete pdftoolsScriptPromises[url]; reject(new Error('Falha ao carregar ' + url)); };
    document.head.appendChild(s);
  });
  return pdftoolsScriptPromises[url];
}
async function ensurePdfLib() {
  if (!window.PDFLib) await pdftoolsLoadScript(PDFTOOLS_CDN.pdfLib);
  return window.PDFLib;
}
async function ensurePdfJs() {
  if (!window.pdfjsLib) {
    await pdftoolsLoadScript(PDFTOOLS_CDN.pdfJs);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFTOOLS_CDN.pdfJsWorker;
  }
  return window.pdfjsLib;
}
async function ensureJSZip() {
  if (!window.JSZip) await pdftoolsLoadScript(PDFTOOLS_CDN.jszip);
  return window.JSZip;
}
async function ensureMammoth() {
  if (!window.mammoth) await pdftoolsLoadScript(PDFTOOLS_CDN.mammoth);
  return window.mammoth;
}

function pdftoolsDownloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

function pdftoolsSetStatus(id, message, kind) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'pdftools-status' + (kind ? ' is-' + kind : ' is-info');
  el.textContent = message || '';
}

function pdftoolsSetProgress(prefix, current, total) {
  const bar = document.getElementById('pdftools' + prefix + 'Progress');
  const fill = document.getElementById('pdftools' + prefix + 'ProgressFill');
  if (!bar || !fill) return;
  if (!total) { bar.classList.remove('active'); fill.style.width = '0%'; return; }
  bar.classList.add('active');
  fill.style.width = Math.round((current / total) * 100) + '%';
  if (current >= total) setTimeout(() => bar.classList.remove('active'), 600);
}

function pdftoolsFormatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function pdftoolsHandleDrop(event, kind) {
  event.preventDefault();
  event.currentTarget.classList.remove('dragover');
  const files = event.dataTransfer.files;
  if (!files || !files.length) return;
  if (kind === 'merge') { pdftoolsAddMergeFiles(files); return; }
  if (kind === 'jpgpdf') { pdftoolsAddJpgPdfFiles(files); return; }
  if (kind === 'pdfword') { pdftoolsRunPdfToWord(files[0]); return; }
  if (kind === 'wordpdf') { pdftoolsRunWordToPdf(files[0]); return; }
  if (kind === 'pdfjpg') { pdftoolsRunPdfToJpg(files[0]); return; }
}

/* ---------- Unificar PDF (até 10 arquivos / 50 MB no total) ---------- */
const PDFTOOLS_MERGE_MAX_FILES = 20;
const PDFTOOLS_MERGE_MAX_BYTES = 50 * 1024 * 1024;
// Cada item da lista é { id, kind: 'pdf' | 'image', name, size, pages, range, rotation,
// bytes (PDF) ou file (imagem) }. "range" é o texto digitado em "Páginas"
// (vazio = todas) e "rotation" o giro extra em graus (0, 90, 180, 270).
const pdftoolsMergeState = { files: [], busy: false };

function pdftoolsIsPdfFile(file) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}
function pdftoolsIsImageFile(file) {
  return /^image\/(jpeg|png)$/.test(file.type) || /\.(jpe?g|png)$/i.test(file.name);
}

// Nome padrão do arquivo final, com a data de hoje: evita que o navegador
// renomeie para "pdf-unificado (1).pdf" quando se unifica mais de uma vez.
function pdftoolsDefaultMergeName() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `pdf-unificado-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Interpreta o campo "Páginas" de um PDF: "1-3, 5" -> [0,1,2,4]; "8-" vai
// até a última página; vazio ou "todas" usa o arquivo inteiro. A ordem
// digitada é respeitada (ex.: "3,1,2" reordena as páginas).
function pdftoolsParsePageRange(text, total) {
  const raw = String(text || '').trim().toLowerCase();
  if (!raw || raw === 'todas' || raw === 'todos' || raw === 'tudo') {
    return { indices: Array.from({ length: total }, (_, i) => i) };
  }
  const out = [];
  for (const part of raw.split(/[,;]+/)) {
    const t = part.trim();
    if (!t) continue;
    let m;
    if ((m = t.match(/^(\d+)$/))) {
      const n = Number(m[1]);
      if (n < 1 || n > total) return { error: `a página ${n} não existe (o arquivo tem ${total})` };
      out.push(n - 1);
    } else if ((m = t.match(/^(\d+)\s*-\s*(\d*)$/))) {
      const from = Number(m[1]);
      const to = m[2] === '' ? total : Number(m[2]);
      if (from < 1 || from > total) return { error: `a página ${from} não existe (o arquivo tem ${total})` };
      if (to > total) return { error: `a página ${to} não existe (o arquivo tem ${total})` };
      if (to < from) return { error: `o intervalo "${t}" está ao contrário` };
      for (let n = from; n <= to; n++) out.push(n - 1);
    } else {
      return { error: `não entendi "${t}" — use, por exemplo, 1-3, 5` };
    }
  }
  if (!out.length) return { error: 'nenhuma página escolhida' };
  return { indices: out };
}

// Junta os avisos de uma rodada de arquivos adicionados em uma única
// mensagem (até 3 avisos, o resto vira "e mais N").
function pdftoolsNoticeFromProblems(problems) {
  if (!problems.length) return null;
  const kind = problems.some(p => p.kind === 'error') ? 'error' : 'warn';
  const texts = problems.slice(0, 3).map(p => p.text);
  if (problems.length > 3) texts.push(`E mais ${problems.length - 3} aviso(s).`);
  return { message: texts.join(' '), kind };
}

async function pdftoolsAddMergeFiles(fileList) {
  const files = Array.from(fileList || []);
  const input = document.getElementById('pdftoolsMergeInput');
  if (!files.length) return;
  if (pdftoolsMergeState.busy) {
    if (input) input.value = '';
    pdftoolsRenderMergeList({ message: 'Aguarde terminar de ler os arquivos anteriores.', kind: 'warn' });
    return;
  }
  pdftoolsMergeState.busy = true;
  const problems = [];
  pdftoolsSetStatus('pdftoolsMergeStatus', 'Lendo os arquivos...', 'info');
  try {
    let PDFLib = null;
    if (files.some(pdftoolsIsPdfFile)) {
      try {
        pdftoolsSetStatus('pdftoolsMergeStatus', 'Carregando biblioteca de PDF...', 'info');
        PDFLib = await ensurePdfLib();
      } catch (e) {
        problems.push({ kind: 'error', text: 'Não foi possível carregar a biblioteca de PDF. Verifique sua conexão.' });
      }
    }
    for (const file of files) {
      if (pdftoolsMergeState.files.length >= PDFTOOLS_MERGE_MAX_FILES) {
        problems.push({ kind: 'warn', text: `Limite de ${PDFTOOLS_MERGE_MAX_FILES} arquivos atingido — os demais não foram adicionados.` });
        break;
      }
      const isPdf = pdftoolsIsPdfFile(file);
      const isImage = !isPdf && pdftoolsIsImageFile(file);
      if (!isPdf && !isImage) {
        problems.push({ kind: 'error', text: `"${file.name}" não é PDF, JPG nem PNG.` });
        continue;
      }
      // Evita adicionar duas vezes o mesmo arquivo por engano (mesmo nome e
      // tamanho) — fácil de acontecer ao arrastar da mesma pasta duas vezes.
      if (pdftoolsMergeState.files.some(f => f.name === file.name && f.size === file.size)) {
        problems.push({ kind: 'warn', text: `"${file.name}" já está na lista.` });
        continue;
      }
      // Verifica o limite de 50 MB ANTES de ler o arquivo para a memória.
      const currentTotal = pdftoolsMergeState.files.reduce((s, f) => s + (f.size || 0), 0);
      if (currentTotal + file.size > PDFTOOLS_MERGE_MAX_BYTES) {
        const remaining = Math.max(0, PDFTOOLS_MERGE_MAX_BYTES - currentTotal);
        problems.push({ kind: 'error', text: `"${file.name}" (${pdftoolsFormatBytes(file.size)}) não cabe no limite de 50 MB — restam ${pdftoolsFormatBytes(remaining)}.` });
        continue;
      }
      const id = 'm' + Date.now() + Math.random().toString(36).slice(2);
      if (isImage) {
        pdftoolsMergeState.files.push({ id, kind: 'image', name: file.name, size: file.size, pages: 1, range: '', rotation: 0, file });
        continue;
      }
      if (!PDFLib) continue; // biblioteca indisponível (aviso já registrado acima)
      try {
        const bytes = await file.arrayBuffer();
        const doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
        // Com ignoreEncryption o pdf-lib "abre" o arquivo, mas as páginas de
        // um PDF com senha saem em branco/ilegíveis no resultado. Melhor
        // recusar já aqui, dizendo o que fazer.
        if (doc.isEncrypted) {
          problems.push({ kind: 'error', text: `"${file.name}" tem proteção por senha. Abra o arquivo, salve uma cópia sem senha e adicione de novo.` });
          continue;
        }
        pdftoolsMergeState.files.push({ id, kind: 'pdf', name: file.name, size: file.size, pages: doc.getPageCount(), range: '', rotation: 0, bytes });
      } catch (e) {
        problems.push({ kind: 'error', text: `Não foi possível ler "${file.name}" (arquivo corrompido).` });
      }
    }
  } finally {
    pdftoolsMergeState.busy = false;
    if (input) input.value = '';
    // Os avisos vão para a renderização (antes, ela sobrescrevia a mensagem
    // logo em seguida e o técnico nunca via por que um arquivo foi recusado).
    pdftoolsRenderMergeList(pdftoolsNoticeFromProblems(problems));
  }
}

const PDFTOOLS_ICON_ROTATE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>';

// "notice" ({ message, kind }) tem prioridade sobre o resumo padrão da
// lista: é como resultados e avisos (arquivo recusado, PDF gerado...)
// chegam à tela sem serem apagados pela própria renderização.
function pdftoolsRenderMergeList(notice) {
  const list = document.getElementById('pdftoolsMergeList');
  const btn = document.getElementById('pdftoolsMergeBtn');
  const clearBtn = document.getElementById('pdftoolsMergeClearBtn');
  if (!list) return;
  const files = pdftoolsMergeState.files;
  const rows = files.map(f => {
    const sel = f.kind === 'pdf' ? pdftoolsParsePageRange(f.range, f.pages) : { indices: [0] };
    return { f, sel, count: sel.error ? 0 : sel.indices.length };
  });
  const invalid = rows.filter(r => r.sel.error);
  const totalPages = rows.reduce((s, r) => s + r.count, 0);
  const totalBytes = files.reduce((s, f) => s + (f.size || 0), 0);

  list.innerHTML = rows.map(({ f, sel, count }, idx) => {
    const isPdf = f.kind === 'pdf';
    const pagesLabel = !isPdf ? 'Foto'
      : (sel.error || count === f.pages) ? `${f.pages} pág.` : `${count} de ${f.pages} pág.`;
    const rotLabel = f.rotation ? ` · girado ${f.rotation}°` : '';
    const rangeRow = isPdf ? `
      <span class="pdftools-fileitem-options">
        <label class="pdftools-range">
          <span>Páginas</span>
          <input type="text" class="${sel.error ? 'is-invalid' : ''}" value="${escapeHtml(f.range)}"
                 placeholder="todas (ex.: 1-3, 5)" autocomplete="off" autocapitalize="off" spellcheck="false"
                 aria-label="Páginas de ${escapeHtml(f.name)} a usar" ${sel.error ? 'aria-invalid="true"' : ''}
                 onfocus="this.closest('li').draggable = false" onblur="this.closest('li').draggable = true"
                 onchange="pdftoolsSetMergeRange('${f.id}', this.value)">
        </label>
        ${sel.error ? `<span class="pdftools-range-error">${escapeHtml(sel.error)}</span>` : ''}
      </span>` : '';
    return `
    <li class="pdftools-fileitem pdftools-mergeitem" draggable="true" data-id="${f.id}"
        ondragstart="pdftoolsMergeDragStart(event, '${f.id}')"
        ondragover="pdftoolsMergeDragOver(event, '${f.id}')"
        ondragleave="pdftoolsMergeDragLeave(event)"
        ondrop="pdftoolsMergeDrop(event, '${f.id}')"
        ondragend="pdftoolsMergeDragEnd(event)">
      <span class="pdftools-drag-handle" title="Arraste para reordenar" aria-hidden="true">
        <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor"><circle cx="2" cy="2" r="1.5"/><circle cx="8" cy="2" r="1.5"/><circle cx="2" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="2" cy="14" r="1.5"/><circle cx="8" cy="14" r="1.5"/></svg>
      </span>
      <span class="pdftools-kind ${isPdf ? 'is-pdf' : 'is-image'}" title="${isPdf ? 'PDF' : 'Foto'}" aria-hidden="true">${isPdf ? ICONS.pdf : ICONS.image}</span>
      <span class="pdftools-fileitem-name">${idx + 1}. ${escapeHtml(f.name)}</span>
      <span class="pdftools-fileitem-meta">${pagesLabel} · ${pdftoolsFormatBytes(f.size || 0)}${rotLabel}</span>
      <span class="pdftools-fileitem-btns">
        <button type="button" class="pdftools-icon-btn" title="Mover para cima" aria-label="Mover ${escapeHtml(f.name)} para cima" ${idx === 0 ? 'disabled' : ''} onclick="pdftoolsMoveMergeFile('${f.id}', -1)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
        </button>
        <button type="button" class="pdftools-icon-btn" title="Mover para baixo" aria-label="Mover ${escapeHtml(f.name)} para baixo" ${idx === files.length - 1 ? 'disabled' : ''} onclick="pdftoolsMoveMergeFile('${f.id}', 1)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <button type="button" class="pdftools-icon-btn${f.rotation ? ' is-active' : ''}" title="Girar 90° para a direita" aria-label="Girar ${escapeHtml(f.name)} 90 graus" onclick="pdftoolsRotateMergeFile('${f.id}')">${PDFTOOLS_ICON_ROTATE}</button>
        <button type="button" class="pdftools-icon-btn pdftools-remove" title="Remover" aria-label="Remover ${escapeHtml(f.name)}" onclick="pdftoolsRemoveMergeFile('${f.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </span>
      ${rangeRow}
    </li>`;
  }).join('');

  // Barra de capacidade: mostra visualmente o quanto já foi usado dos 50 MB
  // permitidos, ficando âmbar perto do limite e vermelha ao ultrapassá-lo.
  const gauge = document.getElementById('pdftoolsMergeCapacity');
  const gaugeFill = document.getElementById('pdftoolsMergeCapacityFill');
  if (gauge && gaugeFill) {
    const pct = Math.min(100, (totalBytes / PDFTOOLS_MERGE_MAX_BYTES) * 100);
    gaugeFill.style.width = pct + '%';
    gauge.classList.toggle('is-warn', totalBytes <= PDFTOOLS_MERGE_MAX_BYTES && pct >= 80);
    gauge.classList.toggle('is-error', totalBytes > PDFTOOLS_MERGE_MAX_BYTES);
    gauge.style.visibility = files.length ? 'visible' : 'hidden';
  }

  if (btn) btn.disabled = pdftoolsMergeState.busy || files.length < 2 || totalBytes > PDFTOOLS_MERGE_MAX_BYTES || invalid.length > 0;
  if (clearBtn) clearBtn.disabled = files.length === 0;

  const toolbar = document.getElementById('pdftoolsMergeToolbar');
  const sortBtn = document.getElementById('pdftoolsMergeSortBtn');
  const summary = document.getElementById('pdftoolsMergeSummary');
  if (toolbar) toolbar.style.display = files.length ? 'flex' : 'none';
  if (sortBtn) sortBtn.disabled = files.length < 2;
  if (summary) summary.textContent = files.length ? `${files.length} arquivo(s) · ${totalPages} pág. no resultado` : '';

  if (notice && notice.message) {
    pdftoolsSetStatus('pdftoolsMergeStatus', notice.message, notice.kind || 'info');
  } else if (files.length === 0) {
    pdftoolsSetStatus('pdftoolsMergeStatus', '', 'info');
  } else if (totalBytes > PDFTOOLS_MERGE_MAX_BYTES) {
    pdftoolsSetStatus('pdftoolsMergeStatus', `Total de ${pdftoolsFormatBytes(totalBytes)} — o limite é 50 MB. Remova algum arquivo.`, 'error');
  } else if (invalid.length) {
    pdftoolsSetStatus('pdftoolsMergeStatus', `Corrija o campo "Páginas" de "${invalid[0].f.name}": ${invalid[0].sel.error}.`, 'error');
  } else if (files.length === 1) {
    pdftoolsSetStatus('pdftoolsMergeStatus', `1 arquivo · ${totalPages} pág. · ${pdftoolsFormatBytes(totalBytes)}. Adicione mais um arquivo para poder unificar.`, 'info');
  } else {
    pdftoolsSetStatus('pdftoolsMergeStatus', `${files.length} de ${PDFTOOLS_MERGE_MAX_FILES} arquivo(s) · ${totalPages} pág. · ${pdftoolsFormatBytes(totalBytes)} de 50 MB.`, 'info');
  }
}

// Campo "Páginas" de um PDF (evento onchange: dispara ao sair do campo ou
// apertar Enter, então a lista só é redesenhada quando a digitação termina).
function pdftoolsSetMergeRange(id, value) {
  const item = pdftoolsMergeState.files.find(f => f.id === id);
  if (!item) return;
  item.range = String(value || '').trim();
  pdftoolsRenderMergeList();
}

// Gira o item em passos de 90° (PDF: todas as páginas escolhidas; foto: a
// imagem). Útil para documentos fotografados de lado ou digitalizados
// invertidos.
function pdftoolsRotateMergeFile(id) {
  const item = pdftoolsMergeState.files.find(f => f.id === id);
  if (!item) return;
  item.rotation = ((item.rotation || 0) + 90) % 360;
  pdftoolsRenderMergeList();
}

// Ordena a lista por nome (A-Z), útil quando muitos arquivos foram
// escolhidos de uma vez e a ordem de seleção não é a ordem desejada no
// PDF final — evita ter que arrastar item por item ou usar as setas
// repetidas vezes.
function pdftoolsSortMergeFilesAlpha() {
  if (pdftoolsMergeState.files.length < 2) return;
  pdftoolsMergeState.files.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true, sensitivity: 'base' }));
  pdftoolsRenderMergeList();
}

function pdftoolsMoveMergeFile(id, dir) {
  const idx = pdftoolsMergeState.files.findIndex(f => f.id === id);
  const target = idx + dir;
  if (idx < 0 || target < 0 || target >= pdftoolsMergeState.files.length) return;
  const [item] = pdftoolsMergeState.files.splice(idx, 1);
  pdftoolsMergeState.files.splice(target, 0, item);
  pdftoolsRenderMergeList();
}

function pdftoolsRemoveMergeFile(id) {
  pdftoolsMergeState.files = pdftoolsMergeState.files.filter(f => f.id !== id);
  pdftoolsRenderMergeList();
}

// Esvazia a lista de uma vez (botão "Limpar lista"), em vez de precisar
// remover arquivo por arquivo quando o técnico quer recomeçar a seleção.
function pdftoolsClearMergeFiles() {
  if (!pdftoolsMergeState.files.length) return;
  pdftoolsMergeState.files = [];
  pdftoolsRenderMergeList();
}

// ---- Reordenar a lista arrastando com o mouse (além das setas acima,
// que continuam funcionando e são o único jeito de reordenar no celular,
// já que arrastar-e-soltar nativo do HTML5 não funciona em telas de toque).
let pdftoolsMergeDragId = null;

function pdftoolsMergeDragStart(event, id) {
  pdftoolsMergeDragId = id;
  event.currentTarget.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  try { event.dataTransfer.setData('text/plain', id); } catch (e) { /* Firefox exige setData */ }
}

function pdftoolsMergeDragOver(event, id) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  if (id !== pdftoolsMergeDragId) event.currentTarget.classList.add('drag-over');
}

function pdftoolsMergeDragLeave(event) {
  event.currentTarget.classList.remove('drag-over');
}

function pdftoolsMergeDrop(event, targetId) {
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over');
  const draggedId = pdftoolsMergeDragId;
  if (!draggedId || draggedId === targetId) return;
  const fromIdx = pdftoolsMergeState.files.findIndex(f => f.id === draggedId);
  const toIdx = pdftoolsMergeState.files.findIndex(f => f.id === targetId);
  if (fromIdx < 0 || toIdx < 0) return;
  const [item] = pdftoolsMergeState.files.splice(fromIdx, 1);
  pdftoolsMergeState.files.splice(toIdx, 0, item);
  pdftoolsRenderMergeList();
}

function pdftoolsMergeDragEnd(event) {
  event.currentTarget.classList.remove('dragging');
  document.querySelectorAll('#pdftoolsMergeList .pdftools-fileitem.drag-over').forEach(el => el.classList.remove('drag-over'));
  pdftoolsMergeDragId = null;
}

async function pdftoolsMergePdfs() {
  const items = pdftoolsMergeState.files;
  const totalBytes = items.reduce((s, f) => s + (f.size || 0), 0);
  if (items.length < 2 || totalBytes > PDFTOOLS_MERGE_MAX_BYTES || pdftoolsMergeState.busy) return;
  const bad = items.find(f => f.kind === 'pdf' && pdftoolsParsePageRange(f.range, f.pages).error);
  if (bad) { pdftoolsRenderMergeList(); return; }
  pdftoolsMergeState.busy = true;
  const btn = document.getElementById('pdftoolsMergeBtn');
  const clearBtn = document.getElementById('pdftoolsMergeClearBtn');
  if (btn) btn.disabled = true;
  if (clearBtn) clearBtn.disabled = true;
  pdftoolsSetStatus('pdftoolsMergeStatus', 'Unificando...', 'info');
  pdftoolsSetProgress('Merge', 0, items.length);
  let notice = null;
  let currentName = '';
  try {
    const PDFLib = await ensurePdfLib();
    const merged = await PDFLib.PDFDocument.create();
    let done = 0;
    for (const f of items) {
      currentName = f.name;
      if (f.kind === 'pdf') {
        const src = await PDFLib.PDFDocument.load(f.bytes, { ignoreEncryption: true });
        const sel = pdftoolsParsePageRange(f.range, src.getPageCount());
        const copied = await merged.copyPages(src, sel.indices);
        copied.forEach(p => {
          if (f.rotation) p.setRotation(PDFLib.degrees((p.getRotation().angle + f.rotation) % 360));
          merged.addPage(p);
        });
      } else {
        const prepared = await pdftoolsPrepareImage(f.file, f.rotation);
        const jpg = await merged.embedJpg(prepared.bytes);
        pdftoolsAddImagePage(merged, jpg, prepared);
      }
      done++;
      pdftoolsSetProgress('Merge', done, items.length);
      pdftoolsSetStatus('pdftoolsMergeStatus', `Unificando (${done}/${items.length})...`, 'info');
    }
    currentName = '';
    const bytes = await merged.save();
    // Nome do arquivo final: o que o técnico digitou (limpo de caracteres
    // inválidos em nome de arquivo) ou o padrão com a data de hoje.
    const filenameInput = document.getElementById('pdftoolsMergeFilename');
    const typed = filenameInput ? filenameInput.value.trim() : '';
    const fallback = pdftoolsDefaultMergeName();
    const base = (typed || fallback).replace(/[\\/:*?"<>|]+/g, '').replace(/\.pdf$/i, '').trim() || fallback;
    pdftoolsDownloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${base}.pdf`);
    notice = { message: `Pronto! "${base}.pdf" foi baixado — ${merged.getPageCount()} páginas · ${pdftoolsFormatBytes(bytes.length)}.`, kind: 'success' };
  } catch (e) {
    notice = {
      message: currentName
        ? `Não foi possível processar "${currentName}". Remova esse arquivo da lista e tente de novo.`
        : 'Erro ao unificar os arquivos. Tente novamente.',
      kind: 'error'
    };
  } finally {
    pdftoolsMergeState.busy = false;
    pdftoolsSetProgress('Merge', 0, 0);
    // A mensagem final (sucesso ou erro) precisa sobreviver à renderização
    // da lista — antes ela era apagada logo em seguida.
    pdftoolsRenderMergeList(notice);
  }
}

/* ---------- Preparo de imagens (usado por "Unificar" e "JPG → PDF") ---------- */
// Fotos de celular guardam a posição em que o aparelho estava (EXIF) e
// costumam ser enormes. O PDF ignora essa informação — a foto saía deitada
// — e cada foto de 4–8 MB inflava o arquivo final. O navegador já sabe
// aplicar a orientação ao desenhar a imagem; aqui ela é desenhada num
// canvas (girada, se o técnico pediu), limitada a ~A4 em 300 dpi e salva
// como JPEG. PNG com transparência ganha fundo branco.
const PDFTOOLS_IMG_MAX_LONG = 3508;
const PDFTOOLS_IMG_MAX_SHORT = 2480;

async function pdftoolsPrepareImage(file, rotation) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth, h = img.naturalHeight;
    const rot = (((rotation || 0) % 360) + 360) % 360;
    const swap = rot === 90 || rot === 270;
    const rw = swap ? h : w, rh = swap ? w : h; // tamanho depois de girar
    const scale = Math.min(1, PDFTOOLS_IMG_MAX_LONG / Math.max(rw, rh), PDFTOOLS_IMG_MAX_SHORT / Math.min(rw, rh));
    const outW = Math.max(1, Math.round(rw * scale));
    const outH = Math.max(1, Math.round(rh * scale));
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, outW, outH);
    ctx.translate(outW / 2, outH / 2);
    ctx.rotate(rot * Math.PI / 180);
    ctx.drawImage(img, -(w * scale) / 2, -(h * scale) / 2, w * scale, h * scale);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.88));
    if (!blob) throw new Error('não foi possível gerar a imagem');
    return { bytes: await blob.arrayBuffer(), width: outW, height: outH };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Uma página A4 por imagem, na posição (retrato ou paisagem) que melhor
// aproveita a foto, com margem de 24 pt.
function pdftoolsAddImagePage(doc, embeddedJpg, prepared) {
  const A4_W = 595.28, A4_H = 841.89, margin = 24;
  const landscape = prepared.width > prepared.height * 1.05;
  const pageW = landscape ? A4_H : A4_W;
  const pageH = landscape ? A4_W : A4_H;
  const scale = Math.min((pageW - margin * 2) / prepared.width, (pageH - margin * 2) / prepared.height, 1);
  const w = prepared.width * scale, h = prepared.height * scale;
  const page = doc.addPage([pageW, pageH]);
  page.drawImage(embeddedJpg, { x: (pageW - w) / 2, y: (pageH - h) / 2, width: w, height: h });
}

/* ---------- JPG → PDF ---------- */
// Antes sem limite algum: era possível escolher dezenas de fotos em alta
// resolução (comum em fotos tiradas direto do celular) e travar o
// navegador tentando processar tudo de uma vez. Usa os mesmos princípios
// de limite do "Unificar PDF" (quantidade + tamanho total).
const PDFTOOLS_JPGPDF_MAX_FILES = 20;
const PDFTOOLS_JPGPDF_MAX_BYTES = 40 * 1024 * 1024;
const pdftoolsJpgPdfState = { files: [] };

function pdftoolsAddJpgPdfFiles(fileList) {
  const files = Array.from(fileList || []).filter(f => /^image\/(jpeg|png)$/.test(f.type) || /\.(jpe?g|png)$/i.test(f.name));
  if (!files.length) {
    pdftoolsSetStatus('pdftoolsJpgPdfStatus', 'Selecione arquivos JPG ou PNG.', 'error');
    return;
  }
  let skippedLimit = false;
  files.forEach(file => {
    if (pdftoolsJpgPdfState.files.length >= PDFTOOLS_JPGPDF_MAX_FILES) { skippedLimit = true; return; }
    const currentTotal = pdftoolsJpgPdfState.files.reduce((s, f) => s + (f.file.size || 0), 0);
    if (currentTotal + file.size > PDFTOOLS_JPGPDF_MAX_BYTES) { skippedLimit = true; return; }
    const isDuplicate = pdftoolsJpgPdfState.files.some(f => f.file.name === file.name && f.file.size === file.size);
    if (isDuplicate) return;
    pdftoolsJpgPdfState.files.push({ id: 'j' + Date.now() + Math.random().toString(36).slice(2), file });
  });
  const input = document.getElementById('pdftoolsJpgPdfInput');
  if (input) input.value = '';
  pdftoolsRenderJpgPdfList();
  if (skippedLimit) {
    pdftoolsSetStatus('pdftoolsJpgPdfStatus', `Algumas imagens não foram adicionadas — limite de ${PDFTOOLS_JPGPDF_MAX_FILES} imagens ou 40 MB no total.`, 'warn');
  }
}

function pdftoolsRenderJpgPdfList() {
  const list = document.getElementById('pdftoolsJpgPdfList');
  const btn = document.getElementById('pdftoolsJpgPdfBtn');
  if (!list) return;
  const totalBytes = pdftoolsJpgPdfState.files.reduce((s, f) => s + (f.file.size || 0), 0);
  list.innerHTML = pdftoolsJpgPdfState.files.map((f, idx) => `
    <li class="pdftools-fileitem">
      <span class="pdftools-fileitem-name">${idx + 1}. ${escapeHtml(f.file.name)}</span>
      <span class="pdftools-fileitem-meta">${pdftoolsFormatBytes(f.file.size)}</span>
      <span class="pdftools-fileitem-btns">
        <button type="button" class="pdftools-icon-btn" title="Mover para cima" ${idx === 0 ? 'disabled' : ''} onclick="pdftoolsMoveJpgPdfFile('${f.id}', -1)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
        </button>
        <button type="button" class="pdftools-icon-btn" title="Mover para baixo" ${idx === pdftoolsJpgPdfState.files.length - 1 ? 'disabled' : ''} onclick="pdftoolsMoveJpgPdfFile('${f.id}', 1)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <button type="button" class="pdftools-icon-btn pdftools-remove" title="Remover" onclick="pdftoolsRemoveJpgPdfFile('${f.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </span>
    </li>
  `).join('');
  if (btn) btn.disabled = pdftoolsJpgPdfState.files.length === 0;
  pdftoolsSetStatus('pdftoolsJpgPdfStatus', pdftoolsJpgPdfState.files.length ? `${pdftoolsJpgPdfState.files.length} de ${PDFTOOLS_JPGPDF_MAX_FILES} imagem(ns) · ${pdftoolsFormatBytes(totalBytes)} de 40 MB.` : '', 'info');
}

function pdftoolsMoveJpgPdfFile(id, dir) {
  const idx = pdftoolsJpgPdfState.files.findIndex(f => f.id === id);
  const target = idx + dir;
  if (idx < 0 || target < 0 || target >= pdftoolsJpgPdfState.files.length) return;
  const [item] = pdftoolsJpgPdfState.files.splice(idx, 1);
  pdftoolsJpgPdfState.files.splice(target, 0, item);
  pdftoolsRenderJpgPdfList();
}

function pdftoolsRemoveJpgPdfFile(id) {
  pdftoolsJpgPdfState.files = pdftoolsJpgPdfState.files.filter(f => f.id !== id);
  pdftoolsRenderJpgPdfList();
}

async function pdftoolsRunJpgToPdf() {
  if (!pdftoolsJpgPdfState.files.length) return;
  const btn = document.getElementById('pdftoolsJpgPdfBtn');
  if (btn) btn.disabled = true;
  pdftoolsSetStatus('pdftoolsJpgPdfStatus', 'Carregando biblioteca e convertendo...', 'info');
  let currentName = '';
  try {
    const PDFLib = await ensurePdfLib();
    const doc = await PDFLib.PDFDocument.create();
    for (const item of pdftoolsJpgPdfState.files) {
      currentName = item.file.name;
      const prepared = await pdftoolsPrepareImage(item.file, 0);
      const jpg = await doc.embedJpg(prepared.bytes);
      pdftoolsAddImagePage(doc, jpg, prepared);
    }
    currentName = '';
    const bytes = await doc.save();
    pdftoolsDownloadBlob(new Blob([bytes], { type: 'application/pdf' }), 'imagens-convertidas.pdf');
    pdftoolsSetStatus('pdftoolsJpgPdfStatus', `PDF gerado com sucesso! (${doc.getPageCount()} páginas · ${pdftoolsFormatBytes(bytes.length)})`, 'success');
  } catch (e) {
    pdftoolsSetStatus('pdftoolsJpgPdfStatus', currentName
      ? `Não foi possível ler a imagem "${currentName}". Remova-a da lista e tente de novo.`
      : 'Erro ao converter as imagens. Verifique se são JPG/PNG válidos.', 'error');
  } finally {
    if (btn) btn.disabled = pdftoolsJpgPdfState.files.length === 0;
  }
}

/* ---------- PDF → JPG ---------- */
async function pdftoolsRunPdfToJpg(file, inputEl) {
  if (!file) return;
  if (inputEl) inputEl.disabled = true;
  pdftoolsSetStatus('pdftoolsPdfJpgStatus', 'Carregando biblioteca de PDF...', 'info');
  pdftoolsSetProgress('PdfJpg', 0, 0);
  try {
    const pdfjsLib = await ensurePdfJs();
    const JSZipLib = await ensureJSZip();
    const bytes = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const baseName = file.name.replace(/\.pdf$/i, '') || 'documento';
    const zip = new JSZipLib();
    pdftoolsSetStatus('pdftoolsPdfJpgStatus', `Gerando imagens (0/${pdf.numPages})...`, 'info');
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      if (pdf.numPages === 1) {
        pdftoolsDownloadBlob(blob, `${baseName}.jpg`);
      } else {
        zip.file(`${baseName}-pagina-${String(i).padStart(2, '0')}.jpg`, blob);
      }
      pdftoolsSetProgress('PdfJpg', i, pdf.numPages);
      pdftoolsSetStatus('pdftoolsPdfJpgStatus', `Gerando imagens (${i}/${pdf.numPages})...`, 'info');
    }
    if (pdf.numPages > 1) {
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      pdftoolsDownloadBlob(zipBlob, `${baseName}-imagens.zip`);
    }
    pdftoolsSetStatus('pdftoolsPdfJpgStatus', 'Imagens geradas com sucesso!', 'success');
  } catch (e) {
    pdftoolsSetStatus('pdftoolsPdfJpgStatus', 'Não foi possível converter este PDF.', 'error');
  } finally {
    if (inputEl) { inputEl.disabled = false; inputEl.value = ''; }
    pdftoolsSetProgress('PdfJpg', 0, 0);
  }
}

/* ---------- PDF → Word (texto) ---------- */
function pdftoolsEscapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function pdftoolsBuildDocx(paragraphsPerPage) {
  const JSZipLib = await ensureJSZip();
  const zip = new JSZipLib();

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`);

  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`);

  zip.folder('docProps').file('core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Argo SUAS</dc:creator><cp:lastModifiedBy>Argo SUAS</cp:lastModifiedBy></cp:coreProperties>`);

  zip.folder('docProps').file('app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Argo SUAS</Application></Properties>`);

  const wordFolder = zip.folder('word');
  wordFolder.folder('_rels').file('document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`);

  /* Cada página é uma lista de parágrafos { text, bold, size } — size em
     pontos (aprox. extraído do próprio PDF), convertido aqui para
     meios-pontos (unidade w:sz do OOXML). */
  let bodyXml = '';
  paragraphsPerPage.forEach((pageParagraphs, pageIdx) => {
    if (!pageParagraphs.length) {
      bodyXml += '<w:p/>';
    } else {
      pageParagraphs.forEach(para => {
        const halfPoints = Math.max(16, Math.min(72, Math.round((para.size || 11) * 2)));
        const rPr = `<w:rPr>${para.bold ? '<w:b/><w:bCs/>' : ''}<w:sz w:val="${halfPoints}"/><w:szCs w:val="${halfPoints}"/></w:rPr>`;
        bodyXml += `<w:p><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/>${para.bold ? '<w:rPr><w:b/></w:rPr>' : ''}</w:pPr><w:r>${rPr}<w:t xml:space="preserve">${pdftoolsEscapeXml(para.text)}</w:t></w:r></w:p>`;
      });
    }
    if (pageIdx < paragraphsPerPage.length - 1) {
      bodyXml += `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
    }
  });

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417"/></w:sectPr></w:body></w:document>`;

  wordFolder.file('document.xml', documentXml);

  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

/* ---------- PDF → Word ---------- */
/* Em vez de criar um parágrafo por linha física do PDF (o que deixava o
   Word cheio de quebras artificiais), agrupamos as linhas em parágrafos
   de verdade: uma nova linha só vira um novo parágrafo quando o espaço
   vertical até a linha anterior é bem maior que o espaçamento normal
   entre linhas da página (ou seja, uma quebra real de parágrafo/título),
   e o tamanho/negrito da fonte é preservado a partir do próprio PDF. */
async function pdftoolsRunPdfToWord(file, inputEl) {
  if (!file) return;
  if (inputEl) inputEl.disabled = true;
  pdftoolsSetStatus('pdftoolsPdfWordStatus', 'Carregando bibliotecas...', 'info');
  pdftoolsSetProgress('PdfWord', 0, 0);
  try {
    const pdfjsLib = await ensurePdfJs();
    await ensureJSZip();
    const bytes = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const pagesParagraphs = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();

      // 1) Agrupa os itens de texto em linhas físicas, por posição vertical.
      const rawLines = [];
      let currentLine = null;
      content.items.forEach(item => {
        if (!item.str) return;
        const y = item.transform[5];
        const fontHeight = Math.abs(item.transform[3]) || Math.abs(item.transform[0]) || 10;
        const isBold = /bold/i.test(item.fontName || '');
        if (currentLine && Math.abs(y - currentLine.y) <= fontHeight * 0.4) {
          currentLine.parts.push({ text: item.str, bold: isBold, size: fontHeight });
          currentLine.y = (currentLine.y + y) / 2;
        } else {
          if (currentLine) rawLines.push(currentLine);
          currentLine = { y, parts: [{ text: item.str, bold: isBold, size: fontHeight }] };
        }
      });
      if (currentLine) rawLines.push(currentLine);

      // 2) Descobre o espaçamento típico entre linhas desta página, para
      //    diferenciar "quebra de linha por largura" de "novo parágrafo".
      const gaps = [];
      for (let k = 1; k < rawLines.length; k++) gaps.push(rawLines[k - 1].y - rawLines[k].y);
      const sortedGaps = gaps.filter(g => g > 0).sort((a, b) => a - b);
      const typicalGap = sortedGaps.length ? sortedGaps[Math.floor(sortedGaps.length / 2)] : 14;

      // 3) Funde linhas com espaçamento normal no mesmo parágrafo; um
      //    espaçamento bem maior vira um parágrafo novo.
      const paragraphs = [];
      let currentPara = null;
      rawLines.forEach((line, idx) => {
        const text = line.parts.map(p => p.text).join(' ').replace(/\s+/g, ' ').trim();
        if (!text) { if (currentPara) { paragraphs.push(currentPara); currentPara = null; } return; }
        const avgSize = line.parts.reduce((s, p) => s + p.size, 0) / line.parts.length;
        const isBoldLine = line.parts.every(p => p.bold);
        const gap = idx > 0 ? rawLines[idx - 1].y - line.y : 0;
        const isNewParagraph = !currentPara || gap > typicalGap * 1.6;
        if (isNewParagraph) {
          if (currentPara) paragraphs.push(currentPara);
          currentPara = { text, bold: isBoldLine, size: avgSize };
        } else {
          currentPara.text += ' ' + text;
          currentPara.bold = currentPara.bold && isBoldLine;
          currentPara.size = Math.max(currentPara.size, avgSize);
        }
      });
      if (currentPara) paragraphs.push(currentPara);

      pagesParagraphs.push(paragraphs);
      pdftoolsSetProgress('PdfWord', i, pdf.numPages);
      pdftoolsSetStatus('pdftoolsPdfWordStatus', `Extraindo texto (${i}/${pdf.numPages})...`, 'info');
    }

    const blob = await pdftoolsBuildDocx(pagesParagraphs);
    pdftoolsDownloadBlob(blob, (file.name.replace(/\.pdf$/i, '') || 'documento') + '.docx');
    pdftoolsSetStatus('pdftoolsPdfWordStatus', 'Documento Word gerado, com parágrafos, títulos e negrito preservados! (baseado no texto — layouts muito complexos podem mudar)', 'success');
  } catch (e) {
    pdftoolsSetStatus('pdftoolsPdfWordStatus', 'Não foi possível converter este PDF.', 'error');
  } finally {
    if (inputEl) { inputEl.disabled = false; inputEl.value = ''; }
    pdftoolsSetProgress('PdfWord', 0, 0);
  }
}

/* ---------- Word → PDF ---------- */
/* Percorre a árvore HTML gerada pelo mammoth preservando: títulos (H1-H6),
   negrito/itálico dentro do mesmo parágrafo, listas com marcador/numeração,
   tabelas (com bordas e cabeçalho destacado) e imagens embutidas —
   quebrando linhas corretamente mesmo quando um parágrafo mistura trechos
   normais e em negrito/itálico. */
async function pdftoolsRunWordToPdf(file, inputEl) {
  if (!file) return;
  if (inputEl) inputEl.disabled = true;
  pdftoolsSetStatus('pdftoolsWordPdfStatus', 'Carregando bibliotecas...', 'info');
  try {
    const mammothLib = await ensureMammoth();
    const PDFLib = await ensurePdfLib();
    const bytes = await file.arrayBuffer();
    const result = await mammothLib.convertToHtml({ arrayBuffer: bytes });
    const container = document.createElement('div');
    container.innerHTML = result.value;

    const doc = await PDFLib.PDFDocument.create();
    const fonts = {
      regular: await doc.embedFont(PDFLib.StandardFonts.Helvetica),
      bold: await doc.embedFont(PDFLib.StandardFonts.HelveticaBold),
      italic: await doc.embedFont(PDFLib.StandardFonts.HelveticaOblique),
      boldItalic: await doc.embedFont(PDFLib.StandardFonts.HelveticaBoldOblique)
    };

    const pageWidth = 595.28, pageHeight = 841.89, margin = 56;
    const maxWidth = pageWidth - margin * 2;
    const ctx = { page: doc.addPage([pageWidth, pageHeight]), y: pageHeight - margin };
    let drewSomething = false;

    const sanitize = t => t.replace(/[^\x20-\x7EÀ-ÿ""''–—•ºª§«»…]/g, '?');

    function ensureSpace(height) {
      if (ctx.y - height < margin) {
        ctx.page = doc.addPage([pageWidth, pageHeight]);
        ctx.y = pageHeight - margin;
      }
    }

    function pickFont(bold, italic) {
      if (bold && italic) return fonts.boldItalic;
      if (bold) return fonts.bold;
      if (italic) return fonts.italic;
      return fonts.regular;
    }

    // Extrai o texto de um nó preservando negrito/itálico por trecho (run).
    function extractRuns(node, bold, italic) {
      const runs = [];
      node.childNodes.forEach(child => {
        if (child.nodeType === 3) {
          if (child.textContent) runs.push({ text: child.textContent, bold, italic });
        } else if (child.nodeType === 1) {
          const tag = child.tagName.toLowerCase();
          if (tag === 'img') return;
          if (tag === 'br') { runs.push({ text: '\n', bold, italic }); return; }
          const nb = bold || tag === 'strong' || tag === 'b';
          const ni = italic || tag === 'em' || tag === 'i';
          runs.push(...extractRuns(child, nb, ni));
        }
      });
      return runs;
    }

    // Quebra os "runs" em linhas que cabem em `width`, respeitando a
    // formatação de cada palavra individualmente (permite negrito/itálico
    // misturados na mesma linha).
    function wrapRuns(runs, size, width) {
      const tokens = [];
      runs.forEach(run => {
        run.text.split(/(\n|\s+)/).forEach(p => {
          if (p !== '') tokens.push({ text: p, bold: run.bold, italic: run.italic });
        });
      });
      const lines = [];
      let line = [], lineW = 0;
      const trimTrailingSpace = () => { while (line.length && /^\s+$/.test(line[line.length - 1].text)) line.pop(); };
      tokens.forEach(tok => {
        if (tok.text === '\n') { trimTrailingSpace(); lines.push(line); line = []; lineW = 0; return; }
        const font = pickFont(tok.bold, tok.italic);
        const w = font.widthOfTextAtSize(sanitize(tok.text), size);
        if (/^\s+$/.test(tok.text)) {
          if (line.length) { line.push(tok); lineW += w; }
          return;
        }
        if (lineW + w > width && line.length) {
          trimTrailingSpace();
          lines.push(line);
          line = [tok]; lineW = w;
        } else {
          line.push(tok); lineW += w;
        }
      });
      if (line.length) { trimTrailingSpace(); lines.push(line); }
      return lines.filter(l => l.length);
    }

    function drawWrappedLines(lines, size, x0, lineHeight, indent) {
      lines.forEach(line => {
        ensureSpace(lineHeight);
        let x = x0 + (indent || 0);
        line.forEach(tok => {
          const font = pickFont(tok.bold, tok.italic);
          const text = sanitize(tok.text);
          ctx.page.drawText(text, { x, y: ctx.y - size, size, font });
          x += font.widthOfTextAtSize(text, size);
        });
        ctx.y -= lineHeight;
        drewSomething = true;
      });
    }

    async function drawImage(imgNode) {
      const src = imgNode.getAttribute('src') || '';
      const m = /^data:(image\/(png|jpe?g));base64,([^"]*)$/i.exec(src);
      if (!m) return;
      try {
        const raw = atob(m[3]);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        const img = /png/i.test(m[2]) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        let { width, height } = img;
        const scale = Math.min(maxWidth / width, 340 / height, 1);
        width *= scale; height *= scale;
        ensureSpace(height + 10);
        ctx.page.drawImage(img, { x: margin, y: ctx.y - height, width, height });
        ctx.y -= height + 10;
        drewSomething = true;
      } catch (e) { /* imagem em formato não suportado — ignora e segue o documento */ }
    }

    async function drawTable(tableNode) {
      const rows = Array.from(tableNode.querySelectorAll('tr'));
      if (!rows.length) return;
      const colCount = Math.max(...rows.map(r => r.children.length));
      if (!colCount) return;
      const cellW = maxWidth / colCount;
      const cellPad = 5, fontSize = 9.5, lineH = fontSize + 3;

      rows.forEach(row => {
        const cells = Array.from(row.children);
        const isHeaderRow = cells.length > 0 && cells.every(c => c.tagName.toLowerCase() === 'th');
        const cellLines = cells.map(cell => {
          const runs = extractRuns(cell, isHeaderRow, false);
          return wrapRuns(runs.length ? runs : [{ text: ' ', bold: isHeaderRow, italic: false }], fontSize, cellW - cellPad * 2);
        });
        const rowLineCount = Math.max(1, ...cellLines.map(l => l.length || 1));
        const rowHeight = rowLineCount * lineH + cellPad * 2;
        ensureSpace(rowHeight);
        const rowTop = ctx.y;
        if (isHeaderRow) {
          ctx.page.drawRectangle({ x: margin, y: rowTop - rowHeight, width: cellW * cells.length, height: rowHeight, color: PDFLib.rgb(0.92, 0.92, 0.92) });
        }
        cells.forEach((cell, ci) => {
          const x0 = margin + ci * cellW;
          ctx.page.drawRectangle({ x: x0, y: rowTop - rowHeight, width: cellW, height: rowHeight, borderColor: PDFLib.rgb(0.55, 0.55, 0.55), borderWidth: 0.6 });
          let ly = rowTop - cellPad;
          (cellLines[ci] || []).forEach(line => {
            let lx = x0 + cellPad;
            line.forEach(tok => {
              const font = pickFont(tok.bold, tok.italic);
              const text = sanitize(tok.text);
              ctx.page.drawText(text, { x: lx, y: ly - fontSize, size: fontSize, font });
              lx += font.widthOfTextAtSize(text, fontSize);
            });
            ly -= lineH;
          });
        });
        ctx.y = rowTop - rowHeight;
        drewSomething = true;
      });
      ctx.y -= 8;
    }

    async function walkBlocks(nodes) {
      for (const node of Array.from(nodes)) {
        if (node.nodeType !== 1) continue;
        const tag = node.tagName.toLowerCase();

        if (tag === 'img') { await drawImage(node); continue; }
        if (tag === 'table') { await drawTable(node); continue; }

        if (tag === 'ul' || tag === 'ol') {
          let idx = 1;
          for (const li of Array.from(node.children)) {
            if (li.tagName.toLowerCase() !== 'li') continue;
            const marker = tag === 'ol' ? `${idx}. ` : '• ';
            idx++;
            const size = 11;
            const indent = 16;
            const markerWidth = fonts.regular.widthOfTextAtSize(marker, size);
            const runs = extractRuns(li, false, false);
            const lines = wrapRuns(runs, size, maxWidth - indent - markerWidth);
            lines.forEach((line, li2) => {
              ensureSpace(size + 5);
              if (li2 === 0) {
                ctx.page.drawText(marker, { x: margin + indent, y: ctx.y - size, size, font: fonts.regular });
              }
              let x = margin + indent + markerWidth;
              line.forEach(tok => {
                const font = pickFont(tok.bold, tok.italic);
                const text = sanitize(tok.text);
                ctx.page.drawText(text, { x, y: ctx.y - size, size, font });
                x += font.widthOfTextAtSize(text, size);
              });
              ctx.y -= size + 5;
              drewSomething = true;
            });
            ctx.y -= 3;
          }
          continue;
        }

        const isHeading = /^h[1-6]$/.test(tag);
        if (tag === 'p' || isHeading || tag === 'blockquote' || tag === 'div') {
          const imgs = node.querySelectorAll ? Array.from(node.querySelectorAll('img')) : [];
          for (const img of imgs) await drawImage(img);
          const text = (node.textContent || '').trim();
          if (!text) continue;
          const headingSizes = { h1: 20, h2: 17, h3: 15, h4: 13, h5: 12, h6: 11 };
          const size = isHeading ? headingSizes[tag] : 11;
          const lineHeight = size + (isHeading ? 6 : 5);
          const runs = extractRuns(node, isHeading, false);
          const lines = wrapRuns(runs, size, maxWidth);
          drawWrappedLines(lines, size, margin, lineHeight);
          ctx.y -= isHeading ? 8 : 6;
          continue;
        }

        const fallbackText = (node.textContent || '').trim();
        if (fallbackText) {
          const lines = wrapRuns([{ text: fallbackText, bold: false, italic: false }], 11, maxWidth);
          drawWrappedLines(lines, 11, margin, 16);
          ctx.y -= 6;
        }
      }
    }

    await walkBlocks(container.childNodes);

    if (!drewSomething) {
      pdftoolsSetStatus('pdftoolsWordPdfStatus', 'Não encontramos conteúdo neste documento.', 'error');
      return;
    }

    const pdfBytes = await doc.save();
    pdftoolsDownloadBlob(new Blob([pdfBytes], { type: 'application/pdf' }), (file.name.replace(/\.docx?$/i, '') || 'documento') + '.pdf');
    pdftoolsSetStatus('pdftoolsWordPdfStatus', 'PDF gerado, com títulos, negrito/itálico, listas, tabelas e imagens preservados!', 'success');
  } catch (e) {
    pdftoolsSetStatus('pdftoolsWordPdfStatus', 'Não foi possível converter este documento.', 'error');
  } finally {
    if (inputEl) { inputEl.disabled = false; inputEl.value = ''; }
  }
}

function initPdfToolsPanel() {
  pdftoolsRenderMergeList();
  pdftoolsRenderJpgPdfList();
}

// A tela de login precisa ficar pronta (travada e com o campo de senha
// interativo) IMEDIATAMENTE, e o clique em "Entrar" precisa responder na
// hora. Antes, o render() pesado (as 374 fichas do diretório, com leitura
// de anotações/anexos no localStorage a cada uma) rodava logo depois do
// carregamento da página, num requestAnimationFrame — mas isso acontecia
// ainda ENQUANTO a pessoa digitava a senha, então se ela clicasse em
// "Entrar" nesse meio-tempo, o clique ficava esperando essa montagem pesada
// (síncrona) liberar a thread principal antes de ser processado, dando a
// sensação de lentidão para entrar no aplicativo.
// Agora esse render() só é chamado uma vez, e só DEPOIS do login bem
// sucedido (ver o submit do #loginForm, em initAuth), nunca antes — assim
// ele nunca concorre com o clique de entrar, e a tela de login em si fica
// leve e responsiva do início ao fim.
initAuth();
applyStoredTheme();
updateHeaderFooterStats();
syncCategoryToggleLabel();
