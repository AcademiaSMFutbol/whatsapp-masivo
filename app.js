// ============================================================
//  WhatsApp Masivo – Academia SM Fútbol
//  Vanilla JS, sin dependencias npm.
//  La API key de Groq se guarda solo en sessionStorage (no en
//  localStorage ni en el servidor).
// ============================================================

// ── Estado global ──────────────────────────────────────────
const state = {
  numbers: [],       // strings limpios, ej: "34612345678"
  sending: false,
  stopRequested: false,
};

// ── Selectores ─────────────────────────────────────────────
const $ = id => document.getElementById(id);

const contactsInput  = $('contacts-input');
const contactsResult = $('contacts-result');
const contactsCount  = $('contacts-count');
const contactsList   = $('contacts-list');
const messageText    = $('message-text');
const groqKey        = $('groq-key');
const aiPrompt       = $('ai-prompt');
const aiStatus       = $('ai-status');
const sendProgress   = $('send-progress');
const progressFill   = $('progress-fill');
const progressText   = $('progress-text');
const bulkLinks      = $('bulk-links');
const logArea        = $('log-area');
const btnStop        = $('btn-stop');
const btnSend        = $('btn-send');

// ── Inicialización ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadTemplatesUI();

  // Restaurar key de Groq si la guardó el usuario en esta sesión
  const savedKey = sessionStorage.getItem('groq_key');
  if (savedKey) groqKey.value = savedKey;

  $('btn-clean').addEventListener('click', handleClean);
  $('btn-clear-contacts').addEventListener('click', clearContacts);
  $('btn-copy-numbers').addEventListener('click', copyNumbers);
  $('btn-generate').addEventListener('click', handleGenerate);
  $('btn-clear-msg').addEventListener('click', () => { messageText.value = ''; });
  $('btn-save-template').addEventListener('click', saveTemplate);
  $('btn-send').addEventListener('click', handleSend);
  $('btn-stop').addEventListener('click', () => { state.stopRequested = true; });
  $('btn-clear-log').addEventListener('click', () => { logArea.innerHTML = ''; });

  // Guardar key en sessionStorage al escribirla
  groqKey.addEventListener('input', () => {
    sessionStorage.setItem('groq_key', groqKey.value.trim());
  });

  // Mostrar/ocultar opción de delay según modo
  document.querySelectorAll('input[name="send-mode"]').forEach(r =>
    r.addEventListener('change', e => {
      $('delay-option').style.display = e.target.value === 'sequential' ? '' : 'none';
    })
  );
});

// ── 1. Limpieza de números ──────────────────────────────────

/**
 * Extrae números de teléfono de texto libre.
 * Reglas:
 *   - Elimina letras, emojis y caracteres no numéricos excepto "+"
 *   - Normaliza prefijo España (+34 / 34) si el número local tiene 9 dígitos
 *   - Descarta tokens con menos de 8 dígitos (descarta basura)
 */
function cleanNumbers(raw) {
  const lines = raw.split(/[\n,;]+/);
  const found = new Set();

  for (const line of lines) {
    // Extrae bloques que parezcan teléfonos (dígitos, +, espacios, guiones)
    const tokens = line.match(/[\+\d][\d\s\-\.]{6,}/g) || [];

    for (const tok of tokens) {
      // Quita todo excepto dígitos y "+" inicial
      let num = tok.replace(/[^\d+]/g, '');

      // Quita el "+" para trabajar solo con dígitos
      if (num.startsWith('+')) num = num.slice(1);

      // Descarta si quedan menos de 8 dígitos
      if (num.replace(/\D/g, '').length < 8) continue;

      // Normalización España: si tiene 9 dígitos y empieza por 6,7,8,9 → añade 34
      if (/^[6789]\d{8}$/.test(num)) num = '34' + num;

      // Si empieza por 0034 → quitar los dos ceros
      if (num.startsWith('0034')) num = num.slice(2);

      found.add(num);
    }
  }

  return [...found];
}

function handleClean() {
  const raw = contactsInput.value;
  if (!raw.trim()) return;

  state.numbers = cleanNumbers(raw);

  if (state.numbers.length === 0) {
    log('No se encontraron números válidos en la lista.', 'err');
    return;
  }

  renderNumberTags();
  log(`${state.numbers.length} números extraídos.`, 'ok');
}

function renderNumberTags() {
  contactsList.innerHTML = '';
  state.numbers.forEach((n, i) => {
    const tag = document.createElement('span');
    tag.className = 'number-tag';
    tag.innerHTML = `${n} <span class="remove" data-i="${i}" title="Eliminar">✕</span>`;
    contactsList.appendChild(tag);
  });

  // Delegar evento de eliminación
  contactsList.onclick = e => {
    if (e.target.classList.contains('remove')) {
      const i = parseInt(e.target.dataset.i);
      state.numbers.splice(i, 1);
      renderNumberTags();
      contactsCount.textContent = `${state.numbers.length} números encontrados`;
    }
  };

  contactsCount.textContent = `${state.numbers.length} números encontrados`;
  contactsResult.classList.remove('hidden');
}

function clearContacts() {
  contactsInput.value = '';
  state.numbers = [];
  contactsResult.classList.add('hidden');
  contactsList.innerHTML = '';
}

function copyNumbers() {
  navigator.clipboard.writeText(state.numbers.join('\n'))
    .then(() => log('Números copiados al portapapeles.', 'info'));
}

// ── 2. Generador IA con Groq ────────────────────────────────

async function handleGenerate() {
  const key    = groqKey.value.trim();
  const prompt = aiPrompt.value.trim();

  if (!key)    { showAiStatus('Introduce tu API Key de Groq.', 'error'); return; }
  if (!prompt) { showAiStatus('Describe el mensaje que necesitas.', 'error'); return; }

  showAiStatus('Generando mensaje…', 'loading');
  $('btn-generate').disabled = true;

  try {
    const body = {
      model: 'llama3-8b-8192',
      messages: [
        {
          role: 'system',
          content: 'Eres un asistente para una academia deportiva. Redacta mensajes de WhatsApp breves, amigables y directos en español. Sin emojis excesivos. Sin saludos corporativos. Máximo 3 frases.',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 250,
      temperature: 0.7,
    };

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${res.status}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim() || '';
    messageText.value = text;
    showAiStatus('✓ Mensaje generado.', 'info');
    log('Mensaje generado con IA.', 'ok');

  } catch (err) {
    showAiStatus(`Error: ${err.message}`, 'error');
    log(`Error IA: ${err.message}`, 'err');
  } finally {
    $('btn-generate').disabled = false;
  }
}

function showAiStatus(msg, type) {
  aiStatus.textContent = msg;
  aiStatus.className = `status-msg ${type}`;
  aiStatus.classList.remove('hidden');
}

// ── 3. Plantillas en LocalStorage ──────────────────────────

function loadTemplates() {
  return JSON.parse(localStorage.getItem('wam_templates') || '[]');
}
function saveTemplates(arr) {
  localStorage.setItem('wam_templates', JSON.stringify(arr));
}

function saveTemplate() {
  const text = messageText.value.trim();
  if (!text) return;

  const label = prompt('Nombre para esta plantilla:');
  if (!label) return;

  const tpls = loadTemplates();
  tpls.push({ label, text, ts: Date.now() });
  saveTemplates(tpls);
  loadTemplatesUI();
  log(`Plantilla "${label}" guardada.`, 'ok');
}

function loadTemplatesUI() {
  const list = $('templates-list');
  list.innerHTML = '';
  const tpls = loadTemplates();

  if (tpls.length === 0) {
    list.innerHTML = '<span class="hint-inline">Sin plantillas todavía.</span>';
    return;
  }

  tpls.forEach((tpl, i) => {
    const chip = document.createElement('span');
    chip.className = 'tpl-chip';
    chip.innerHTML = `<span class="tpl-text">${escHtml(tpl.label)}</span><span class="del-tpl" data-i="${i}" title="Eliminar">✕</span>`;

    // Cargar plantilla al hacer clic en el texto
    chip.querySelector('.tpl-text').addEventListener('click', () => {
      messageText.value = tpl.text;
      log(`Plantilla "${tpl.label}" cargada.`, 'info');
    });

    // Borrar plantilla
    chip.querySelector('.del-tpl').addEventListener('click', e => {
      e.stopPropagation();
      const arr = loadTemplates();
      arr.splice(i, 1);
      saveTemplates(arr);
      loadTemplatesUI();
    });

    list.appendChild(chip);
  });
}

// ── 4. Envío ────────────────────────────────────────────────

async function handleSend() {
  if (state.sending) return;

  if (state.numbers.length === 0) {
    log('No hay números cargados. Extrae los contactos primero.', 'err');
    return;
  }

  const msg = messageText.value.trim();
  if (!msg) {
    log('Escribe el mensaje antes de enviar.', 'err');
    return;
  }

  const mode  = document.querySelector('input[name="send-mode"]:checked').value;
  const delay = parseInt($('send-delay').value) * 1000 || 4000;

  if (mode === 'bulk') {
    renderBulkLinks(state.numbers, msg);
    return;
  }

  // Modo secuencial
  state.sending = true;
  state.stopRequested = false;
  btnSend.classList.add('hidden');
  btnStop.classList.remove('hidden');
  sendProgress.classList.remove('hidden');
  bulkLinks.classList.add('hidden');

  for (let i = 0; i < state.numbers.length; i++) {
    if (state.stopRequested) {
      log('Envío detenido por el usuario.', 'info');
      break;
    }

    const num  = state.numbers[i];
    const text = personalizeMsg(msg, num);
    const url  = buildWaUrl(num, text);

    window.open(url, '_blank');
    log(`Abierto: ${num}`, 'ok');

    updateProgress(i + 1, state.numbers.length);

    // Espera entre aperturas (excepto en el último)
    if (i < state.numbers.length - 1 && !state.stopRequested) {
      await sleep(delay);
    }
  }

  finishSend();
}

function renderBulkLinks(numbers, msg) {
  bulkLinks.innerHTML = '';
  numbers.forEach(num => {
    const text = personalizeMsg(msg, num);
    const url  = buildWaUrl(num, text);
    const a    = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = `${num} → ${url.slice(0, 60)}…`;
    bulkLinks.appendChild(a);
  });
  bulkLinks.classList.remove('hidden');
  log(`${numbers.length} links generados en modo bulk.`, 'ok');
}

function buildWaUrl(number, text) {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

// Sustituye {nombre} por los últimos 3 dígitos del número (placeholder simple)
function personalizeMsg(msg, number) {
  return msg.replace(/\{nombre\}/gi, number.slice(-3));
}

function updateProgress(done, total) {
  const pct = Math.round((done / total) * 100);
  progressFill.style.width = pct + '%';
  progressText.textContent = `${done} / ${total}`;
}

function finishSend() {
  state.sending = false;
  btnSend.classList.remove('hidden');
  btnStop.classList.add('hidden');
  log('Envío finalizado.', 'ok');
}

// ── Helpers ─────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function log(msg, type = 'info') {
  const icons = { ok: '✓', err: '✗', info: '·' };
  const now   = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerHTML = `<span class="ts">${now}</span><span class="icon">${icons[type]}</span><span>${escHtml(msg)}</span>`;
  logArea.prepend(entry);
}
