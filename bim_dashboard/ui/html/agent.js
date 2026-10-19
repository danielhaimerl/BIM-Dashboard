// =============================================================================
// BIM Dashboard – agent.js
// KI-Assistent Modul
// =============================================================================

'use strict';

State.agentHistory  = [];   // { role: 'user'|'assistant', content: '...' }
State.agentPending  = false;

// ---------------------------------------------------------------------------
// RUBY BRIDGE
// ---------------------------------------------------------------------------
Object.assign(window.rubyBridge, {

  onAgentResponse({ content }) {
    if (_agentTimeout) { clearTimeout(_agentTimeout); _agentTimeout = null; }
    State.agentPending = false;
    appendMessage('assistant', content);
    State.agentHistory.push({ role: 'assistant', content });
    setAgentLoading(false);
  },

  onAgentError({ message }) {
    if (_agentTimeout) { clearTimeout(_agentTimeout); _agentTimeout = null; }
    State.agentPending = false;
    appendMessage('error', message);
    setAgentLoading(false);
  },

  onAgentStatus({ has_key, model }) {
    const bar = document.getElementById('agentKeyBar');
    const inp = document.getElementById('agentKeyInput');
    if (!has_key) {
      if (bar) bar.style.display = '';
    } else {
      if (bar) bar.style.display = 'none';
      if (inp) inp.value = '';
    }
    const modelEl = document.getElementById('agentModelLabel');
    if (modelEl) modelEl.textContent = model || '';
  },

  onAgentKeySet({ success }) {
    if (success) {
      document.getElementById('agentKeyBar').style.display = 'none';
      showToast('✓ API-Key gespeichert');
      ruby('agentGetStatus');
    }
  },

});

// ---------------------------------------------------------------------------
// INIT
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  bindAgentControls();
});

function bindAgentControls() {
  const form   = document.getElementById('agentForm');
  const input  = document.getElementById('agentInput');
  const clear  = document.getElementById('btnAgentClear');
  const keyBtn = document.getElementById('btnAgentSaveKey');
  const toggle = document.getElementById('btnAgentKeyToggle');

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    sendAgentMessage();
  });

  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendAgentMessage();
    }
  });

  clear?.addEventListener('click', () => {
    State.agentHistory = [];
    document.getElementById('agentMessages').innerHTML =
      '<div class="agent-welcome">Stelle eine Frage zu deinem Modell.</div>';
  });

  keyBtn?.addEventListener('click', () => {
    const key = document.getElementById('agentKeyInput').value.trim();
    if (!key) return;
    ruby('agentSetKey', { key });
  });

  toggle?.addEventListener('click', () => {
    const bar = document.getElementById('agentKeyBar');
    bar.style.display = bar.style.display === 'none' ? '' : 'none';
  });
}

// ---------------------------------------------------------------------------
// SEND
// ---------------------------------------------------------------------------
let _agentTimeout = null;

function sendAgentMessage() {
  if (State.agentPending) return;
  const input = document.getElementById('agentInput');
  const q = input?.value.trim();
  if (!q) return;

  input.value = '';
  appendMessage('user', q);
  State.agentHistory.push({ role: 'user', content: q });
  setAgentLoading(true);
  State.agentPending = true;

  // Timeout: nach 120 Sek. automatisch zurücksetzen
  _agentTimeout = setTimeout(() => {
    if (State.agentPending) {
      State.agentPending = false;
      appendMessage('error', 'Keine Antwort erhalten (Timeout nach 120 s). Bitte erneut versuchen.');
      setAgentLoading(false);
    }
  }, 120000);

  const context = buildAgentContext();
  ruby('agentAsk', {
    question: q,
    context,
    history: State.agentHistory.slice(0, -1).slice(-8),
  });
}

function cancelAgentRequest() {
  if (_agentTimeout) clearTimeout(_agentTimeout);
  _agentTimeout = null;
  State.agentPending = false;
  setAgentLoading(false);
  appendMessage('error', 'Anfrage abgebrochen.');
}

function buildAgentContext() {
  return {
    entities: State.entities,
    project:  { name: document.getElementById('projectName')?.textContent || '' },
    bgf:      State.bgfTotal || 0,
    bri:      State.briTotal || 0,
    library:  State.library  || {},
  };
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
function appendMessage(role, content) {
  const container = document.getElementById('agentMessages');
  if (!container) return;

  // Willkommens-Text entfernen
  const welcome = container.querySelector('.agent-welcome');
  if (welcome) welcome.remove();

  const wrap = document.createElement('div');
  wrap.className = `agent-msg agent-msg-${role}`;

  if (role === 'assistant') {
    // Markdown-ähnliche Formatierung
    wrap.innerHTML = `
      <div class="agent-avatar">AI</div>
      <div class="agent-bubble">${renderMarkdown(content)}</div>
    `;
  } else if (role === 'user') {
    wrap.innerHTML = `
      <div class="agent-bubble agent-bubble-user">${escHtml(content)}</div>
    `;
  } else {
    wrap.innerHTML = `
      <div class="agent-bubble agent-bubble-error">⚠ ${escHtml(content)}</div>
    `;
  }

  container.appendChild(wrap);
  container.scrollTop = container.scrollHeight;
}

function setAgentLoading(on) {
  const btn      = document.getElementById('btnAgentSend');
  const loading  = document.getElementById('agentLoading');
  const input    = document.getElementById('agentInput');
  if (btn)     btn.disabled     = on;
  if (input)   input.disabled   = on;
  if (loading) loading.style.display = on ? '' : 'none';
}

// Einfaches Markdown → HTML (fett, kursiv, Listen, Überschriften)
function renderMarkdown(text) {
  return escHtml(text)
    // Überschriften
    .replace(/^### (.+)$/gm, '<strong>$1</strong>')
    .replace(/^## (.+)$/gm,  '<strong>$1</strong>')
    // Fett
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Kursiv
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Listen
    .replace(/^[•\-] (.+)$/gm, '<li>$1</li>')
    // Zeilenumbrüche
    .replace(/\n/g, '<br>')
    // li-Tags in ul einwickeln (vereinfacht)
    .replace(/(<li>.*?<\/li>)(<br>)*/g, (m) => m);
}

// Wird aufgerufen wenn Agent-Modul aktiviert wird
function onAgentModuleActivated() {
  ruby('agentGetStatus');
}
