// ============================================================
//  WhatsApp Masivo – Academia SM Fútbol
//  Vanilla JS, sin dependencias npm.
//  La API key de Groq se guarda solo en sessionStorage.
// ============================================================

// ── Estado global ──────────────────────────────────────────
const state = {
  // Cada contacto: { phone: "34612345678", vars: { nombre: "Juan", equipo: "Sub-10", ... } }
  contacts: [],
  sending: false,
  stopRequested: false,

  // CSV temporal antes de confirmar el mapeo
  csv: {
    headers: [],
    rows: [],      // array de arrays (strings)
    colRoles: [],  // "phone" | "nombre" | "equipo" | "fecha" | "ignore" | custom string
  },
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
  updateVarsChips();  // chips por defecto al arrancar

  const savedKey = sessionStorage.getItem('groq_key');
  if (savedKey) groqKey.value = savedKey;

  // Tabs
  document.querySelectorAll('.tab').forEach(tab =>
    tab.addEventListener('click', () => switchTab(tab.dataset.tab))
  );

  // Cargar URL guardada de Sheets
  const savedSheetsUrl = localStorage.getItem('wam_sheets_url');
  if (savedSheetsUrl) $('sheets-url').value = savedSheetsUrl;

  // Contactos – texto
  $('btn-clean').addEventListener('click', handleClean);
  $('btn-clear-contacts').addEventListener('click', clearContacts);
  $('btn-copy-numbers').addEventListener('click', copyNumbers);

  // Contactos – Google Sheets
  $('btn-load-sheets').addEventListener('click', handleLoadSheets);
  $('sheets-url').addEventListener('keydown', e => { if (e.key === 'Enter') handleLoadSheets(); });

  // Contactos – CSV
  $('csv-file-input').addEventListener('change', handleCsvFile);
  $('btn-apply-csv').addEventListener('click', applyMapping);
  $('btn-cancel-csv').addEventListener('click', cancelCsv);

  // Mensaje
  $('btn-generate').addEventListener('click', handleGenerate);
  $('btn-clear-msg').addEventListener('click', () => { messageText.value = ''; });
  $('btn-save-template').addEventListener('click', saveTemplate);

  // Envío
  $('btn-send').addEventListener('click', handleSend);
  $('btn-stop').addEventListener('click', () => { state.stopRequested = true; });
  $('btn-clear-log').addEventListener('click', () => { logArea.innerHTML = ''; });

  groqKey.addEventListener('input', () => {
    sessionStorage.setItem('groq_key', groqKey.value.trim());
  });

  document.querySelectorAll('input[name="send-mode"]').forEach(r =>
    r.addEventListener('change', e => {
      $('delay-option').style.display = e.target.value === 'sequential' ? '' : 'none';
    })
  );
});

// ── Tabs ───────────────────────────────────────────────────

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  $('tab-sheets').classList.toggle('hidden', name !== 'sheets');
  $('tab-paste').classList.toggle('hidden', name !== 'paste');
  $('tab-csv').classList.toggle('hidden', name !== 'csv');
}

// ── 1a. Limpieza desde texto pegado ────────────────────────

function cleanNumbers(raw) {
  const lines = raw.split(/[\n,;]+/);
  const found = new Set();

  for (const line of lines) {
    const tokens = line.match(/[+\d][\d\s\-.]{6,}/g) || [];
    for (const tok of tokens) {
      let num = tok.replace(/[^\d+]/g, '');
      if (num.startsWith('+')) num = num.slice(1);
      if (num.replace(/\D/g, '').length < 8) continue;
      if (/^[6789]\d{8}$/.test(num)) num = '34' + num;
      if (num.startsWith('0034')) num = num.slice(2);
      found.add(num);
    }
  }
  return [...found];
}

function handleClean() {
  const raw = contactsInput.value;
  if (!raw.trim()) return;

  const numbers = cleanNumbers(raw);
  if (numbers.length === 0) { log('No se encontraron números válidos.', 'err'); return; }

  state.contacts = numbers.map(phone => ({ phone, vars: {} }));
  renderContactTags();
  log(`${state.contacts.length} números extraídos.`, 'ok');
}

function clearContacts() {
  contactsInput.value = '';
  state.contacts = [];
  contactsResult.classList.add('hidden');
  contactsList.innerHTML = '';
  cancelCsv();
}

function copyNumbers() {
  const nums = state.contacts.map(c => c.phone).join('\n');
  navigator.clipboard.writeText(nums).then(() => log('Números copiados al portapapeles.', 'info'));
}

// ── 1b. Google Sheets ──────────────────────────────────────

// Extrae el ID del Sheet de cualquier variante de URL de Google Sheets
function extractSheetId(url) {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

// Extrae el gid (pestaña) de la URL, si lo hay
function extractGid(url) {
  const m = url.match(/[#&?]gid=(\d+)/);
  return m ? m[1] : null;
}

function buildExportUrl(sheetId, gid) {
  let url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
  if (gid) url += `&gid=${gid}`;
  return url;
}

function showSheetsStatus(msg, type) {
  const el = $('sheets-status');
  el.textContent = msg;
  el.className = `status-msg ${type}`;
  el.classList.remove('hidden');
}

async function handleLoadSheets() {
  const raw = $('sheets-url').value.trim();
  if (!raw) { showSheetsStatus('Pega el enlace de tu Google Sheet.', 'error'); return; }

  const sheetId = extractSheetId(raw);
  if (!sheetId) { showSheetsStatus('URL no reconocida. Asegúrate de que es un enlace de Google Sheets.', 'error'); return; }

  const gid        = extractGid(raw);
  const exportUrl  = buildExportUrl(sheetId, gid);

  showSheetsStatus('Conectando con Google Sheets…', 'loading');
  $('btn-load-sheets').disabled = true;

  try {
    const res = await fetch(exportUrl);
    if (!res.ok) {
      if (res.status === 403) throw new Error('Acceso denegado. Comprueba que el Sheet está compartido como "Cualquier persona con el enlace".');
      throw new Error(`Error HTTP ${res.status}`);
    }

    const text = await res.text();
    if (!text.trim()) throw new Error('El Sheet está vacío o no tiene datos en esta pestaña.');

    // Guardar la URL para próximas visitas
    localStorage.setItem('wam_sheets_url', raw);

    // Reutilizar el pipeline de CSV
    processRawCsv(text, `Sheet (${sheetId.slice(0, 8)}…)`);
    showSheetsStatus('✓ Sheet cargado correctamente.', 'info');

  } catch (err) {
    showSheetsStatus(`Error: ${err.message}`, 'error');
    log(`Error Sheets: ${err.message}`, 'err');
  } finally {
    $('btn-load-sheets').disabled = false;
  }
}

// ── 1c. Importación CSV ─────────────────────────────────────

// Detecta separador (;  ,  \t) contando ocurrencias en la primera línea
function detectSep(firstLine) {
  const counts = { ';': 0, ',': 0, '\t': 0 };
  for (const ch of firstLine) if (ch in counts) counts[ch]++;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

// Parser CSV mínimo: respeta comillas dobles, sep variable
function parseCsv(text, sep) {
  const rows = [];
  // Normaliza saltos de línea
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;
    const row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        // Comilla doble escapada ("")
        if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === sep && !inQuotes) {
        row.push(field.trim());
        field = '';
      } else {
        field += ch;
      }
    }
    row.push(field.trim());
    rows.push(row);
  }
  return rows;
}

// Intenta adivinar el rol de una columna por su cabecera
function guessRole(header) {
  const h = header.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/tel|phone|movil|celular|whatsapp/.test(h)) return 'phone';
  if (/nombre|name|contacto/.test(h))             return 'nombre';
  if (/jugador|alumno|player/.test(h))            return 'jugador';
  if (/apellido|surname/.test(h))                 return 'ignore';
  if (/fecha|date|dia|evento/.test(h))            return 'fecha';
  return 'ignore';
}

// Post-proceso: si hay varias columnas con rol 'nombre', la más cercana
// (por la izquierda) a la columna de teléfono queda como 'nombre' (padre/tutor),
// el resto pasan a 'jugador' (nombre del alumno).
function resolveNombreDuplicates(colRoles) {
  const roles = [...colRoles];
  const phoneIdx  = roles.indexOf('phone');
  const nombreIdxs = roles.reduce((acc, r, i) => (r === 'nombre' ? [...acc, i] : acc), []);

  if (nombreIdxs.length <= 1) return roles;

  // La más cercana (y anterior) al teléfono = padre. El resto = jugador.
  const closestToPhone = phoneIdx === -1
    ? nombreIdxs[nombreIdxs.length - 1]
    : nombreIdxs.filter(i => i < phoneIdx).at(-1) ?? nombreIdxs[0];

  nombreIdxs.forEach(i => {
    if (i !== closestToPhone) roles[i] = 'jugador';
  });
  return roles;
}

// Lógica compartida entre Sheets y CSV: recibe texto CSV crudo y lo procesa
function processRawCsv(text, sourceName) {
  const firstLine = text.split(/\r?\n/)[0];
  const sep  = detectSep(firstLine);
  const rows = parseCsv(text, sep);

  if (rows.length < 2) { log(`${sourceName}: necesita al menos cabecera y una fila de datos.`, 'err'); return; }

  state.csv.headers  = rows[0];
  state.csv.rows     = rows.slice(1).filter(r => r.some(c => c !== ''));
  state.csv.colRoles = resolveNombreDuplicates(state.csv.headers.map(guessRole));

  renderMappingPanel();
  const relevant = state.csv.colRoles.filter(r => r !== 'ignore').length;
  log(`${sourceName}: ${state.csv.rows.length} filas, ${state.csv.headers.length} columnas (${relevant} relevantes).`, 'ok');
}

function handleCsvFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  $('csv-file-name').textContent = file.name;

  const reader = new FileReader();
  reader.onload = evt => {
    const text = evt.target.result;
    if (!text.trim()) { log('El archivo está vacío.', 'err'); return; }
    processRawCsv(text, file.name);
  };
  reader.readAsText(file, 'UTF-8');
}

const ROLE_OPTIONS = [
  { value: 'phone',   label: '📱 Teléfono' },
  { value: 'nombre',  label: '{nombre} – padre/tutor' },
  { value: 'jugador', label: '{jugador} – alumno' },
  { value: 'fecha',   label: '{fecha}' },
  { value: 'ignore',  label: 'Ignorar' },
];

// Crea un <select> de rol para la columna i
function makeColSelect(i) {
  const { colRoles } = state.csv;
  const sel = document.createElement('select');
  sel.dataset.col = i;
  ROLE_OPTIONS.forEach(opt => {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === colRoles[i]) o.selected = true;
    sel.appendChild(o);
  });
  sel.className = colRoles[i] === 'phone' ? 'mapped-phone' : '';
  sel.addEventListener('change', () => {
    state.csv.colRoles[i] = sel.value;
    sel.className = sel.value === 'phone' ? 'mapped-phone' : '';
    highlightPreviewCols();
  });
  return sel;
}

function renderMappingPanel() {
  const panel   = $('csv-map-panel');
  const selects = $('csv-col-selects');
  const { headers, rows, colRoles } = state.csv;

  selects.innerHTML = '';

  // Columnas relevantes (no ignoradas) primero; el resto oculto por defecto
  const relevantIdxs = headers.map((_, i) => i).filter(i => colRoles[i] !== 'ignore');
  const ignoredIdxs  = headers.map((_, i) => i).filter(i => colRoles[i] === 'ignore');

  const renderGroup = (idxs) => idxs.forEach(i => {
    const wrap = document.createElement('div');
    wrap.className = 'col-map-item';
    const lbl = document.createElement('label');
    lbl.textContent = headers[i] || `Col ${i + 1}`;
    lbl.title = headers[i];
    wrap.appendChild(lbl);
    wrap.appendChild(makeColSelect(i));
    selects.appendChild(wrap);
  });

  renderGroup(relevantIdxs);

  // Toggle para mostrar columnas ignoradas
  if (ignoredIdxs.length > 0) {
    const toggle = document.createElement('button');
    toggle.className = 'btn ghost mini';
    toggle.style.marginTop = '4px';
    toggle.textContent = `+ Mostrar ${ignoredIdxs.length} columnas ignoradas`;
    toggle.addEventListener('click', () => {
      toggle.remove();
      renderGroup(ignoredIdxs);
    });
    selects.appendChild(toggle);
  }

  buildPreviewTable(rows.slice(0, 5));
  panel.classList.remove('hidden');
}

function buildPreviewTable(previewRows) {
  const tbl = $('csv-preview-table');
  const { headers, colRoles } = state.csv;

  tbl.innerHTML = '';

  // Solo columnas no ignoradas para mantener la tabla legible
  const visibleIdxs = headers.map((_, i) => i).filter(i => colRoles[i] !== 'ignore');
  if (visibleIdxs.length === 0) { tbl.innerHTML = '<tr><td class="hint">Sin columnas asignadas todavía.</td></tr>'; return; }

  const thead = tbl.createTHead();
  const hrow  = thead.insertRow();
  visibleIdxs.forEach(i => {
    const th = document.createElement('th');
    th.textContent = `${headers[i] || `Col ${i + 1}`} (${colRoles[i]})`;
    th.classList.add('col-active');
    hrow.appendChild(th);
  });

  const tbody = tbl.createTBody();
  previewRows.forEach(row => {
    const tr = tbody.insertRow();
    visibleIdxs.forEach(i => {
      const td = tr.insertCell();
      td.textContent = row[i] ?? '';
      td.classList.add('col-active');
    });
  });
}

function highlightPreviewCols() {
  buildPreviewTable(state.csv.rows.slice(0, 5));
}

function applyMapping() {
  const { headers, rows, colRoles } = state.csv;

  const phoneIdx = colRoles.indexOf('phone');
  if (phoneIdx === -1) {
    log('Asigna al menos una columna como Teléfono.', 'err');
    return;
  }

  const contacts = [];
  let skipped = 0;

  for (const row of rows) {
    const rawPhone = row[phoneIdx] || '';
    const cleaned  = cleanNumbers(rawPhone);

    if (cleaned.length === 0) { skipped++; continue; }

    const vars = {};
    colRoles.forEach((role, i) => {
      if (role === 'phone' || role === 'ignore') return;
      // Usamos el nombre del rol como clave de variable
      vars[role] = row[i] || '';
    });

    // Un contacto por número limpio encontrado
    cleaned.forEach(phone => contacts.push({ phone, vars }));
  }

  state.contacts = contacts;

  if (contacts.length === 0) {
    log('No se encontraron números válidos en la columna Teléfono.', 'err');
    return;
  }

  renderContactTags();
  $('csv-map-panel').classList.add('hidden');

  const varNames = [...new Set(colRoles.filter(r => r !== 'phone' && r !== 'ignore'))];
  updateVarsChips(varNames);

  log(`${contacts.length} contactos importados desde CSV.${skipped ? ` (${skipped} filas sin número ignoradas)` : ''}`, 'ok');
}

function cancelCsv() {
  $('csv-map-panel').classList.add('hidden');
  $('csv-file-name').textContent = 'Seleccionar archivo .csv';
  $('csv-file-input').value = '';
  state.csv = { headers: [], rows: [], colRoles: [] };
}

// Variables por defecto siempre disponibles; las del CSV se añaden al aplicar el mapeo
const DEFAULT_VARS = ['nombre', 'jugador', 'fecha'];

function updateVarsChips(varNames = DEFAULT_VARS) {
  const all = [...new Set([...DEFAULT_VARS, ...varNames])];
  const container = $('vars-chips');
  container.innerHTML = '';
  all.forEach(v => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'var-chip';
    chip.textContent = `{${v}}`;
    chip.title = `Insertar ${v} en el mensaje`;
    chip.addEventListener('click', () => insertVarAtCursor(`{${v}}`));
    container.appendChild(chip);
  });
}

// Inserta texto en la posición actual del cursor del textarea
function insertVarAtCursor(text) {
  const ta    = messageText;
  const start = ta.selectionStart;
  const end   = ta.selectionEnd;
  ta.focus();
  // Sustituye la selección (o inserta si no hay selección)
  ta.setRangeText(text, start, end, 'end');
  // Dispara el evento input por si hay listeners
  ta.dispatchEvent(new Event('input'));
}

// ── Render de etiquetas de contactos ───────────────────────

function renderContactTags() {
  contactsList.innerHTML = '';

  state.contacts.forEach((c, i) => {
    const tag = document.createElement('span');
    tag.className = 'number-tag';
    const nameLabel = c.vars.nombre ? `<span class="tag-name">${escHtml(c.vars.nombre)} · </span>` : '';
    tag.innerHTML = `${nameLabel}${c.phone} <span class="remove" data-i="${i}" title="Eliminar">✕</span>`;
    contactsList.appendChild(tag);
  });

  contactsList.onclick = e => {
    if (e.target.classList.contains('remove')) {
      state.contacts.splice(parseInt(e.target.dataset.i), 1);
      renderContactTags();
    }
  };

  contactsCount.textContent = `${state.contacts.length} contactos cargados`;
  contactsResult.classList.remove('hidden');
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
          content: 'Eres un asistente para una academia deportiva. Redacta mensajes de WhatsApp breves, amigables y directos en español. Sin emojis excesivos. Sin saludos corporativos. Máximo 3 frases. Usa {nombre} si la personalización tiene sentido.',
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

    chip.querySelector('.tpl-text').addEventListener('click', () => {
      messageText.value = tpl.text;
      log(`Plantilla "${tpl.label}" cargada.`, 'info');
    });

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

  if (state.contacts.length === 0) {
    log('No hay contactos cargados.', 'err');
    return;
  }

  const msg = messageText.value.trim();
  if (!msg) { log('Escribe el mensaje antes de enviar.', 'err'); return; }

  const mode  = document.querySelector('input[name="send-mode"]:checked').value;
  const delay = parseInt($('send-delay').value) * 1000 || 4000;

  if (mode === 'bulk') {
    renderBulkLinks(state.contacts, msg);
    return;
  }

  state.sending = true;
  state.stopRequested = false;
  btnSend.classList.add('hidden');
  btnStop.classList.remove('hidden');
  sendProgress.classList.remove('hidden');
  bulkLinks.classList.add('hidden');

  for (let i = 0; i < state.contacts.length; i++) {
    if (state.stopRequested) { log('Envío detenido por el usuario.', 'info'); break; }

    const contact = state.contacts[i];
    const text    = personalizeMsg(msg, contact);
    const url     = buildWaUrl(contact.phone, text);

    window.open(url, '_blank');
    const label = contact.vars.nombre ? `${contact.vars.nombre} (${contact.phone})` : contact.phone;
    log(`Abierto: ${label}`, 'ok');

    updateProgress(i + 1, state.contacts.length);

    if (i < state.contacts.length - 1 && !state.stopRequested) await sleep(delay);
  }

  finishSend();
}

function renderBulkLinks(contacts, msg) {
  bulkLinks.innerHTML = '';
  contacts.forEach(contact => {
    const text = personalizeMsg(msg, contact);
    const url  = buildWaUrl(contact.phone, text);
    const a    = document.createElement('a');
    a.href   = url;
    a.target = '_blank';
    a.rel    = 'noopener noreferrer';
    const label = contact.vars.nombre ? `${contact.vars.nombre} · ${contact.phone}` : contact.phone;
    a.textContent = `${label} → wa.me/${contact.phone}`;
    bulkLinks.appendChild(a);
  });
  bulkLinks.classList.remove('hidden');
  log(`${contacts.length} links generados en modo bulk.`, 'ok');
}

function buildWaUrl(number, text) {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

// Sustituye {variable} por el valor del contacto. Fallback: valor vacío (no expone el número)
function personalizeMsg(msg, contact) {
  return msg.replace(/\{(\w+)\}/g, (_, key) => contact.vars[key] ?? '');
}

function updateProgress(done, total) {
  progressFill.style.width = Math.round((done / total) * 100) + '%';
  progressText.textContent = `${done} / ${total}`;
}

function finishSend() {
  state.sending = false;
  btnSend.classList.remove('hidden');
  btnStop.classList.add('hidden');
  log('Envío finalizado.', 'ok');
}

// ── Helpers ─────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
