// =============================================================================
// BIM Dashboard – library.js
// Verwaltung aller Wertelisten: Preise, Gewerke, Kostengruppen, Materialien
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------
State.library = {
  preise:        [],
  gewerke:       [],
  kostengruppen: [],
  materialien:   [],
  stufen:        [],
};
State.activeLibTab = 'preise';

// ---------------------------------------------------------------------------
// RUBY BRIDGE
// ---------------------------------------------------------------------------
Object.assign(window.rubyBridge, {

  onLibraryLoaded(library) {
    State.library = library;
    renderLibrary();
    if (typeof renderTagEditor === 'function') renderTagEditor();
    if (typeof buildTagFilterSelects === 'function') buildTagFilterSelects();
    // Kosten neu berechnen sobald Bibliothek geladen
    if (typeof updateCostBanner === 'function') updateCostBanner();
    renderReport();
  },

  onLibraryListUpdated({ list, count }) {
    showToast(`✓ ${libLabel(list)} gespeichert (${count} Einträge)`);
  },

});

// ---------------------------------------------------------------------------
// INIT
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  bindLibraryControls();
});

function bindLibraryControls() {
  // Tab-Buttons in der Bibliotheks-Spalte
  document.getElementById('libTabBar')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.lib-tab-btn');
    if (!btn) return;
    State.activeLibTab = btn.dataset.list;
    document.querySelectorAll('.lib-tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    renderLibraryList(State.activeLibTab);
  });

  // "+ Zeile"-Button
  document.getElementById('btnLibAdd')?.addEventListener('click', () => {
    addLibraryRow(State.activeLibTab);
  });

  // "Speichern"-Button
  document.getElementById('btnLibSave')?.addEventListener('click', () => {
    saveLibraryList(State.activeLibTab);
  });
}

// ---------------------------------------------------------------------------
// RENDER
// ---------------------------------------------------------------------------
function renderLibrary() {
  renderLibraryTabs();
  renderLibraryList(State.activeLibTab);
}

function renderLibraryTabs() {
  const bar = document.getElementById('libTabBar');
  if (!bar) return;
  const lists = ['preise', 'gewerke', 'kostengruppen', 'materialien'];
  bar.innerHTML = lists.map(l => `
    <button class="lib-tab-btn${l === State.activeLibTab ? ' active' : ''}" data-list="${l}">
      ${libLabel(l)}
      <span class="lib-count">${(State.library[l] || []).length}</span>
    </button>
  `).join('');
}

function renderLibraryList(listName) {
  const container = document.getElementById('libTableContainer');
  if (!container) return;

  const items = State.library[listName] || [];
  const cols  = libColumns(listName);

  const wrapper = document.createElement('div');
  wrapper.className = 'lib-table-wrap';

  const table = document.createElement('table');
  table.className = 'price-table lib-table';
  table.dataset.list = listName;

  // Header
  const thead = document.createElement('thead');
  thead.innerHTML = `<tr>
    ${cols.map(c => `<th>${c.label}</th>`).join('')}
    <th style="width:28px"></th>
  </tr>`;
  table.appendChild(thead);

  // Body
  const tbody = document.createElement('tbody');
  tbody.id = 'libTbody';
  items.forEach((item, idx) => {
    tbody.appendChild(buildLibRow(listName, item, idx, cols));
  });
  table.appendChild(tbody);
  wrapper.appendChild(table);
  container.innerHTML = '';
  container.appendChild(wrapper);
}

function buildLibRow(listName, item, idx, cols) {
  const tr = document.createElement('tr');
  tr.dataset.id = item.id || '';

  cols.forEach(col => {
    const td = document.createElement('td');
    if (col.type === 'select') {
      const sel = document.createElement('select');
      sel.className = 'pt-input';
      sel.dataset.key = col.key;
      col.options.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o;
        opt.textContent = o;
        if (o === item[col.key]) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', () => { item[col.key] = sel.value; });
      td.appendChild(sel);
    } else {
      const inp = document.createElement('input');
      inp.className = `pt-input${col.num ? ' num' : ''}`;
      inp.type      = col.num ? 'number' : 'text';
      inp.dataset.key = col.key;
      inp.value     = item[col.key] !== undefined ? item[col.key] : '';
      inp.placeholder = col.placeholder || '';
      if (col.num) inp.step = '0.01';
      inp.addEventListener('change', () => {
        item[col.key] = col.num ? parseFloat(inp.value) : inp.value;
      });
      inp.addEventListener('input', () => {
        item[col.key] = col.num ? parseFloat(inp.value) : inp.value;
      });
      td.appendChild(inp);
    }
    tr.appendChild(td);
  });

  // Löschen-Button
  const tdDel = document.createElement('td');
  const delBtn = document.createElement('button');
  delBtn.className = 'btn-del-row';
  delBtn.textContent = '✕';
  delBtn.title = 'Eintrag löschen';
  delBtn.addEventListener('click', () => {
    if (!confirm('Eintrag löschen?')) return;
    ruby('deleteLibraryEntry', { list: listName, id: item.id });
  });
  tdDel.appendChild(delBtn);
  tr.appendChild(tdDel);

  return tr;
}

function addLibraryRow(listName) {
  const cols     = libColumns(listName);
  const newItem  = { id: '' };
  cols.forEach(c => { newItem[c.key] = c.default !== undefined ? c.default : ''; });

  State.library[listName] = State.library[listName] || [];
  State.library[listName].push(newItem);

  const tbody = document.getElementById('libTbody');
  if (tbody) {
    const idx = State.library[listName].length - 1;
    tbody.appendChild(buildLibRow(listName, newItem, idx, cols));
  }
  // Tab-Zähler aktualisieren
  renderLibraryTabs();
}

function saveLibraryList(listName) {
  const items = State.library[listName] || [];
  ruby('updateLibraryList', { list: listName, items });
}

// ---------------------------------------------------------------------------
// KONFIGURATION DER SPALTEN JE LISTE
// ---------------------------------------------------------------------------
function libColumns(listName) {
  switch (listName) {
    case 'preise':
      return [
        { key: 'bezeichnung', label: 'Bezeichnung',     placeholder: 'z.B. Außenwand Beton' },
        { key: 'einheit',     label: 'Einheit',         type: 'select',
          options: ['m²', 'm³', 'm', 'Stück'],           default: 'm²' },
        { key: 'ep',          label: '€ / Einheit',     num: true, placeholder: '0.00', default: 0 },
        { key: 'beschreibung',label: 'Hinweis / KG',    placeholder: 'optional' },
      ];
    case 'gewerke':
      return [
        { key: 'bezeichnung', label: 'Bezeichnung', placeholder: 'z.B. Rohbau' },
      ];
    case 'kostengruppen':
      return [
        { key: 'kg',          label: 'KG-Nr.',      placeholder: '330' },
        { key: 'bezeichnung', label: 'Bezeichnung', placeholder: 'z.B. Außenwände' },
        { key: 'einheit',     label: 'Std.-Einheit',type: 'select',
          options: ['', 'm²', 'm³', 'm', 'Stück'],   default: 'm²' },
      ];
    case 'materialien':
      return [
        { key: 'bezeichnung', label: 'Bezeichnung', placeholder: 'z.B. Beton' },
      ];
    default:
      return [{ key: 'bezeichnung', label: 'Bezeichnung' }];
  }
}

function libLabel(listName) {
  return { preise: 'Preise', gewerke: 'Gewerke',
           kostengruppen: 'Kost.gruppen', materialien: 'Materialien' }[listName] || listName;
}

// ---------------------------------------------------------------------------
// HILFSFUNKTIONEN FÜR ANDERE MODULE
// ---------------------------------------------------------------------------

// Gibt Dropdown-Optionen für Tag-Editor zurück
// Wird von app.js / costs.js beim Aufbau der Formulare aufgerufen
window.getLibraryOptions = function(tagKey) {
  switch (tagKey) {
    case 'gewerk':
      return State.library.gewerke.map(g => ({ value: g.bezeichnung, label: g.bezeichnung }));
    case 'din276':
      return State.library.kostengruppen.map(k => ({
        value: k.kg,
        label: `${k.kg} – ${k.bezeichnung}`,
      }));
    case 'material':
      return State.library.materialien.map(m => ({ value: m.bezeichnung, label: m.bezeichnung }));
    case 'stufe':
      return State.library.stufen
        ? State.library.stufen.map(s => ({ value: s.bezeichnung, label: s.beschreibung }))
        : [
            { value: '1', label: 'Stufe 1 – Kennwerte' },
            { value: '2', label: 'Stufe 2 – Flächen' },
            { value: '3', label: 'Stufe 3 – Bauteile' },
          ];
    case 'preis_id':
      return State.library.preise.map(p => ({
        value: p.id,
        label: `${p.bezeichnung}  ·  ${p.ep} €/${p.einheit}`,
        meta:  { ep: p.ep, einheit: p.einheit, bezeichnung: p.bezeichnung },
      }));
    default:
      return [];
  }
};

// Wenn preis_id gesetzt wird: Einheit + EP automatisch übernehmen
window.onPreisSelected = function(preisId, formPrefix) {
  const preis = State.library.preise.find(p => p.id === preisId);
  if (!preis) return;

  const einheitEl = document.getElementById(`cost_einheit`);
  const epEl      = document.getElementById(`cost_einheitspreis`);
  if (einheitEl) { einheitEl.value = preis.einheit; einheitEl.dispatchEvent(new Event('change')); }
  if (epEl)      { epEl.value      = preis.ep;      epEl.dispatchEvent(new Event('input')); }
};
