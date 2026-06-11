// =============================================================================
// BIM Dashboard – app.js
// Haupt-Applikationslogik: State, Bauteilliste, Tag-Editor, Ruby-Bridge
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------
const State = {
  entities:       [],        // alle Bauteile aus dem Modell
  categories:     {},        // { 'gewerk': 'Gewerk', ... }
  selectedIds:    new Set(), // aktuelle JS-Selektion (entityIDs)
  filteredIds:    [],        // nach Suche/Gruppe gefiltert
  groupBy:        ['', '', ''],
  searchQuery:    '',
  pendingTags:    {},        // im Editor editierte aber noch nicht gespeicherte Tags
  modelDirty:     false,
  classFilter:    'all',     // 'all' | 'classified' | 'unclassified'
  tagFilters:     {},        // { gewerk: 'Rohbau', ... } – aktive Tag-Filter
  isolateActive:  false,     // Isolier-Modus ein/aus
};

// ---------------------------------------------------------------------------
// RUBY BRIDGE
// Alle Funktionen die Ruby via execute_script('window.rubyBridge.xxx()') aufruft
// ---------------------------------------------------------------------------
window.rubyBridge = {

  onEntitiesLoaded(entities) {
    State.entities = entities;
    updateEntityCount();
    buildTagFilterSelects();
    renderEntityList();
    renderReport();
    updateCostBanner();
  },

  onCategoriesLoaded(cats) {
    State.categories = cats;
    populateCategorySelects();
    renderTagEditor();
  },

  onSketchupSelectionChanged(ids) {
    // SketchUp hat Selektion verändert → im Dashboard markieren
    State.selectedIds = new Set(ids.map(String));
    renderEntityList();
    renderTagEditor();
    updateSelectionBar();
    // Erstes selektiertes Element in der Liste sichtbar scrollen
    if (ids.length > 0) {
      scrollToEntity(String(ids[0]));
    }
  },

  onModelChanged({ dirty }) {
    State.modelDirty = dirty;
    const dot  = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    dot.className  = 'status-dot dirty';
    text.textContent = 'Modell geändert – bitte aktualisieren';
  },

  onModelLoaded() {
    ruby('refreshModel');
  },

  onModelRefreshed({ timestamp }) {
    State.modelDirty = false;
    const dot  = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    dot.className  = 'status-dot ok';
    text.textContent = `Synchronisiert – ${new Date(timestamp * 1000).toLocaleTimeString()}`;
  },

  onTagsUpdated({ success, count, error }) {
    if (success) {
      showToast(`✓ Tags für ${count} Bauteil(e) gespeichert`);
    } else {
      showToast(`✗ Fehler: ${error}`, 'error');
    }
  },


  onProjectMetaLoaded(meta) {
    document.getElementById('projectName').textContent = meta.name || 'Projekt';
    document.getElementById('metaKosten').textContent = meta.gesamtkosten || '—';
    document.getElementById('metaBGF').textContent    = meta.bgf || '—';
    document.getElementById('metaBRI').textContent    = meta.bri || '—';
  },

  onProjectMetaSaved({ success }) {
    if (success) showToast('✓ Projektdaten gespeichert');
  },

  onError({ message }) {
    showToast(`Fehler: ${message}`, 'error');
  },

  onIsolateChanged({ active, error }) {
    State.isolateActive = active;
    if (!active) {
      State.isolateCat = null;
      // Filter zurücksetzen der durch Isolate gesetzt wurde
      Object.keys(State.tagFilters).forEach(k => {
        if (State.tagFilters[k] === '__none__') delete State.tagFilters[k];
      });
      State.selectedIds.clear();
      renderEntityList();
      updateSelectionBar();
      renderTagEditor();
    }
    // Alle Isolate-Buttons neu rendern
    buildTagFilterSelects();
    const btn = document.getElementById('btnIsolate');
    if (active) {
      btn.classList.add('btn-active');
      btn.textContent = '◉ Isoliert';
      btn.title = 'Isolier-Modus aktiv – klicken zum Beenden';
    } else {
      btn.classList.remove('btn-active');
      btn.textContent = '◎ Isolieren';
      btn.title = 'Nicht-selektierte Bauteile ausblenden';
      if (error) showToast(error, 'error');
    }
  },

  onImportStarted({ path }) {
    showToast(`Importiere ${path}…`);
  },

  onImportFinished({ success, stats, error }) {
    if (success) {
      const s = stats;
      showToast(`✓ Import: ${s.groups} Gruppen, ${s.geometries} Bauteile erstellt`);
    } else {
      showToast(`✗ Import fehlgeschlagen: ${error}`, 'error');
    }
  },
};

// ---------------------------------------------------------------------------
// RUBY CALL HELPER
// ---------------------------------------------------------------------------
function ruby(action, data) {
  if (typeof sketchup === 'undefined') {
    console.warn('[BIM] sketchup bridge not available', action, data);
    return;
  }
  const payload = data !== undefined ? JSON.stringify(data) : undefined;
  sketchup[action](payload);
}

// ---------------------------------------------------------------------------
// INIT
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  bindNavigation();
  bindControls();
  bindMetaControls();
  ruby('dialogReady');
});

// ---------------------------------------------------------------------------
// NAVIGATION
// ---------------------------------------------------------------------------
function bindNavigation() {
  document.querySelectorAll('.nav-item[data-module]').forEach(btn => {
    btn.addEventListener('click', () => {
      const moduleId = 'module' + btn.dataset.module.charAt(0).toUpperCase() + btn.dataset.module.slice(1);

      // Nav-Buttons
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Module
      document.querySelectorAll('.module').forEach(m => m.classList.remove('active'));
      const mod = document.getElementById(moduleId);
      if (mod) mod.classList.add('active');

      // Report neu rendern wenn Auswertung geöffnet wird
      if (btn.dataset.module === 'report') renderReport();
    });
  });

  // Import-Button (kein Modul-Wechsel, öffnet Datei-Dialog)
  document.getElementById('btnImportExcel')?.addEventListener('click', () => {
    ruby('importProjectStructure');
  });
}

function bindControls() {
  // Header
  document.getElementById('btnRefresh').addEventListener('click', () => {
    ruby('refreshModel');
  });
  document.getElementById('btnZoom').addEventListener('click', () => {
    ruby('zoomToSelection');
  });

  document.getElementById('btnIsolate').addEventListener('click', () => {
    if (State.isolateActive) {
      ruby('isolateDisable');
    } else {
      const ids = [...State.selectedIds].map(Number);
      if (!ids.length) {
        showToast('Zuerst Bauteile selektieren', 'error');
        return;
      }
      ruby('isolateEnable', ids);
    }
  });

  // Suche
  document.getElementById('searchInput').addEventListener('input', (e) => {
    State.searchQuery = e.target.value.toLowerCase();
    renderEntityList();
  });

  // Gruppen-Selects (im Report-Panel)
  ['groupBy1', 'groupBy2', 'groupBy3'].forEach((id, i) => {
    document.getElementById(id).addEventListener('change', (e) => {
      State.groupBy[i] = e.target.value;
      renderReport();
    });
  });

  // Report-Filter löschen
  document.getElementById('btnClearReportFilter')?.addEventListener('click', () => {
    State.reportFilters = {};
    renderReport();
  });

  // "Alle markieren" – selektiert alle gefilterten Bauteile
  document.getElementById('btnSelectAll').addEventListener('click', () => {
    const filtered = getFilteredEntities();
    if (!filtered.length) { showToast('Keine Bauteile im aktuellen Filter', 'error'); return; }
    filtered.forEach(e => State.selectedIds.add(String(e.id)));
    renderEntityList();
    syncSelectionToSketchUp();
    updateSelectionBar();
    renderTagEditor();
    showToast(`${filtered.length} Bauteil${filtered.length !== 1 ? 'e' : ''} markiert`);
  });
  document.getElementById('btnClearSelected').addEventListener('click', () => {
    if (!confirm(`Tags für ${State.selectedIds.size} Bauteil(e) löschen?`)) return;
    ruby('clearTags', { ids: [...State.selectedIds], category: null });
  });

  // Tag-Editor (mittlere Spalte – einziger Weg zum Vergeben von Tags)
  document.getElementById('btnSaveTags').addEventListener('click', saveInlineTags);
  document.getElementById('btnResetTags').addEventListener('click', renderTagEditor);

  // Export
  document.getElementById('btnExportCSV').addEventListener('click', exportCSV);
  document.getElementById('btnExportJSON').addEventListener('click', exportJSON);
}

// ---------------------------------------------------------------------------
// ENTITY LIST
// ---------------------------------------------------------------------------
function isClassified(e) {
  return Object.keys(State.categories).some(cat => e.tags && e.tags[cat] && e.tags[cat].trim() !== '');
}

function getFilteredEntities() {
  return State.entities.filter(e => {
    // 2. Tag-Filter (jeder aktive Filter muss passen)
    for (const [cat, val] of Object.entries(State.tagFilters)) {
      if (!val) continue;
      const entityVal = (e.tags && e.tags[cat]) || '';
      if (val === '__none__') {
        // Nur Bauteile ohne Wert in dieser Kategorie
        if (entityVal) return false;
      } else {
        if (entityVal !== val) return false;
      }
    }

    // 3. Textsuche
    if (State.searchQuery) {
      const haystack = [e.name, e.type, e.layer, ...Object.values(e.tags || {})].join(' ').toLowerCase();
      if (!haystack.includes(State.searchQuery)) return false;
    }

    return true;
  });
}

function renderEntityList() {
  const container = document.getElementById('entityList');
  const filtered  = getFilteredEntities();
  State.filteredIds = filtered.map(e => String(e.id));

  if (!filtered.length) {
    container.innerHTML = '<p class="placeholder">Keine Bauteile gefunden.</p>';
    return;
  }

  // Gruppierung
  const grouped = groupEntities(filtered, State.groupBy.filter(Boolean));
  container.innerHTML = '';
  container.appendChild(renderGroup(grouped, 0));
}

function groupEntities(entities, keys) {
  if (!keys.length) return { __items__: entities };
  const key  = keys[0];
  const rest = keys.slice(1);
  const groups = {};
  entities.forEach(e => {
    const val = (e.tags && e.tags[key]) || '—';
    if (!groups[val]) groups[val] = [];
    groups[val].push(e);
  });
  const result = {};
  Object.keys(groups).sort().forEach(v => {
    result[v] = groupEntities(groups[v], rest);
  });
  return result;
}

function renderGroup(node, depth) {
  const frag = document.createDocumentFragment();

  if (node.__items__) {
    node.__items__.forEach(e => frag.appendChild(renderEntityRow(e)));
    return frag;
  }

  Object.entries(node).forEach(([label, children]) => {
    const header = document.createElement('div');
    header.className = `group-header depth-${depth}`;
    const count = countLeaves(children);
    header.innerHTML = `<span class="group-toggle">▾</span> ${escHtml(label)} <span class="badge">${count}</span>`;
    header.addEventListener('click', () => {
      const body = header.nextElementSibling;
      const collapsed = body.style.display === 'none';
      body.style.display = collapsed ? '' : 'none';
      header.querySelector('.group-toggle').textContent = collapsed ? '▾' : '▸';
    });

    const body = document.createElement('div');
    body.className = 'group-body';
    body.appendChild(renderGroup(children, depth + 1));

    frag.appendChild(header);
    frag.appendChild(body);
  });
  return frag;
}

function renderEntityRow(entity) {
  const row = document.createElement('div');
  const id  = String(entity.id);
  const sel = State.selectedIds.has(id);
  row.className = `entity-row${sel ? ' selected' : ''}`;
  row.dataset.id = id;

  // Tags die in der Bauteilliste NICHT als Badge erscheinen sollen
  const HIDDEN_IN_LIST = new Set(['menge', 'menge_auto', 'einheitspreis', 'einheit', 'ref_stufe2', 'preis_id']);

  const STUFE_LABELS = { '1': 'Stufe 1', '2': 'Stufe 2', '3': 'Stufe 3' };

  // Preis separat als Textzeile (kein Badge)
  let preisLine = '';
  const preisId     = entity.tags?.preis_id;
  const preisQuelle = entity.tags?.preis_quelle || '';
  if (preisId) {
    const fromLib = preisQuelle === 'bibliothek';
    const opts    = (typeof window.getLibraryOptions === 'function') ? window.getLibraryOptions('preis_id') : [];
    const entry   = opts.find(o => o.value === preisId);

    if (fromLib && entry?.meta) {
      // Aus Bibliothek: EP + Einheit aus Bibliotheks-Eintrag
      const epFmt = parseFloat(entry.meta.ep).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      preisLine = `<span class="entity-ep entity-ep-lib" title="Preis aus Bibliothek">` +
        `📚 EP: ${epFmt} €/${escHtml(entry.meta.einheit)}</span>`;
    } else {
      // Manuell eingegeben: preis_id ist der Wert selbst
      const einheit = entity.tags?.einheit || '';
      const ep      = parseFloat(preisId);
      if (!isNaN(ep)) {
        const epFmt = ep.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        preisLine = `<span class="entity-ep entity-ep-manual" title="Manuell eingegeben">` +
          `✎ EP: ${epFmt} €${einheit ? '/' + escHtml(einheit) : ''}</span>`;
      } else {
        preisLine = `<span class="entity-ep entity-ep-manual" title="Manuell eingegeben">` +
          `✎ EP: ${escHtml(preisId)}</span>`;
      }
    }
  }

  const tagBadges = Object.entries(entity.tags || {})
    .filter(([k]) => !HIDDEN_IN_LIST.has(k))
    .map(([k, v]) => {
      const label = k === 'stufe' ? (STUFE_LABELS[v] || `Stufe ${v}`) : v;
      return `<span class="tag-badge" data-cat="${escHtml(k)}">${escHtml(label)}</span>`;
    })
    .join('');

  row.innerHTML = `
    <div class="entity-icon">${typeIcon(entity.type)}</div>
    <div class="entity-info">
      <span class="entity-name">${escHtml(entity.name)}</span>
      <span class="entity-meta">${escHtml(entity.type)} · ${escHtml(entity.layer)}</span>
      <div class="entity-tags">${tagBadges}</div>
      ${preisLine}
    </div>
    <div class="entity-check"><input type="checkbox" ${sel ? 'checked' : ''} /></div>
  `;

  // Klick auf Zeile → Selektion
  row.addEventListener('click', (e) => {
    if (e.target.tagName === 'INPUT') return;
    handleRowClick(id, e);
  });
  row.querySelector('input[type=checkbox]').addEventListener('change', (e) => {
    if (e.target.checked) {
      State.selectedIds.add(id);
    } else {
      State.selectedIds.delete(id);
    }
    row.classList.toggle('selected', e.target.checked);
    syncSelectionToSketchUp();
    updateSelectionBar();
    renderTagEditor();
  });

  return row;
}

function handleRowClick(id, e) {
  if (e.shiftKey) {
    // Shift: Range-Selektion
    const ids = State.filteredIds;
    const last = [...State.selectedIds].pop();
    const a = ids.indexOf(last);
    const b = ids.indexOf(id);
    if (a !== -1 && b !== -1) {
      const [from, to] = [Math.min(a, b), Math.max(a, b)];
      ids.slice(from, to + 1).forEach(i => State.selectedIds.add(i));
    }
  } else if (e.ctrlKey || e.metaKey) {
    // Ctrl: Toggle
    if (State.selectedIds.has(id)) State.selectedIds.delete(id);
    else State.selectedIds.add(id);
  } else {
    // Einfachklick: Nur diese Entity
    State.selectedIds = new Set([id]);
  }
  renderEntityList();
  syncSelectionToSketchUp();
  updateSelectionBar();
  renderTagEditor();
}

function syncSelectionToSketchUp() {
  const ids = [...State.selectedIds].map(Number);
  ruby('selectEntities', ids);
  // Isolate-Modus: bei Selektionsänderung automatisch neu anwenden
  if (State.isolateActive) {
    if (ids.length > 0) {
      ruby('isolateEnable', ids);
    } else {
      ruby('isolateDisable');
    }
  }
}

// ---------------------------------------------------------------------------
// TAG EDITOR (Inline in mittlerer Spalte)
// ---------------------------------------------------------------------------
function renderTagEditor() {
  const body      = document.getElementById('tagEditorBody');
  const hint      = document.getElementById('tagEditorHint');
  const actions   = document.getElementById('tagActions');
  const batchHint = document.getElementById('tagBatchHint');
  const batchText = document.getElementById('tagBatchText');
  const ids       = [...State.selectedIds];

  if (!ids.length) {
    hint.textContent        = 'Bauteil wählen';
    actions.style.display   = 'none';
    batchHint.style.display = 'none';
    body.innerHTML = '<p class="placeholder">Wähle ein oder mehrere Bauteile in der Liste oder im Modell.</p>';
    return;
  }

  // Batch-Hinweis wenn mehr als 1 Bauteil selektiert
  if (ids.length > 1) {
    batchHint.style.display = '';
    batchText.textContent   = `${ids.length} Bauteile ausgewählt – Tags gelten für alle`;
  } else {
    batchHint.style.display = 'none';
  }

  const name = ids.length === 1
    ? (State.entities.find(e => String(e.id) === ids[0])?.name || ids[0])
    : `${ids.length} Bauteile`;
  hint.textContent      = name;
  actions.style.display = '';

  const selected = State.entities.filter(e => ids.includes(String(e.id)));
  const merged   = mergedTags(selected);

  body.innerHTML = '';
  body.appendChild(buildTagForm(merged, 'inline'));
  attachDropdowns('inline');

  // Mengen-Bereich (nur bei Einzelselektion sinnvoll, bei Batch auch möglich)
  const mengenSection = buildMengenSection(selected, ids.length === 1);
  body.appendChild(mengenSection);
}

function buildMengenSection(entities, isSingle) {
  const section = document.createElement('div');
  section.className = 'menge-section';

  const title = document.createElement('div');
  title.className   = 'menge-section-title';
  title.textContent = 'Menge';
  section.appendChild(title);

  // Auto-berechnete Menge anzeigen (readonly)
  if (isSingle && entities[0]?.menge_auto) {
    const autoRow = document.createElement('div');
    autoRow.className = 'menge-auto-row';
    autoRow.innerHTML = `<span class="filter-label">Berechnet</span>
      <span class="menge-auto-val">${escHtml(entities[0].menge_auto)}</span>`;
    section.appendChild(autoRow);
  }

  // Manuelle Mengen-Eingabe
  const manField = document.createElement('div');
  manField.className = 'tag-field';
  const manLabel = document.createElement('label');
  manLabel.setAttribute('for', 'inline_menge');
  manLabel.textContent = 'Menge (manuell)';
  manField.appendChild(manLabel);

  const manWrap = document.createElement('div');
  manWrap.className = 'tag-input-wrap';

  const manInput = document.createElement('input');
  manInput.type        = 'number';
  manInput.id          = 'inline_menge';
  manInput.dataset.cat = 'menge';
  manInput.step        = 'any';
  const mergedMenge = [...new Set(entities.map(e => e.tags?.menge || ''))];
  manInput.value       = mergedMenge.length === 1 ? mergedMenge[0] : '';
  manInput.placeholder = isSingle && entities[0]?.menge_auto
    ? `auto: ${entities[0].menge_auto}`
    : 'z.B. 24.5';

  const clearBtn = document.createElement('button');
  clearBtn.type      = 'button';
  clearBtn.className = 'tag-dropdown-btn';
  clearBtn.title     = 'Manuelle Menge löschen (auto verwenden)';
  clearBtn.textContent = '✕';
  clearBtn.addEventListener('click', () => { manInput.value = ''; });

  manWrap.appendChild(manInput);
  manWrap.appendChild(clearBtn);
  manField.appendChild(manWrap);
  section.appendChild(manField);

  return section;
}


  const result = {};
  Object.keys(State.categories).forEach(cat => {
    const vals = [...new Set(entities.map(e => (e.tags && e.tags[cat]) || ''))];
    result[cat] = vals.length === 1 ? vals[0] : (vals.every(v => !v) ? '' : '__mixed__');
  });
  return result;
}

function buildTagForm(currentTags, prefix) {
  const frag = document.createDocumentFragment();
  Object.entries(State.categories).forEach(([cat, label]) => {
    const val   = currentTags[cat] || '';
    const mixed = val === '__mixed__';

    // Bibliotheks-Optionen (können leer sein wenn Bibliothek noch nicht geladen)
    const libOptions = (typeof window.getLibraryOptions === 'function')
      ? window.getLibraryOptions(cat)
      : [];

    // Fallback: bereits im Modell vorhandene Werte dieser Kategorie
    const modelExisting = [...new Set(
      State.entities.map(e => e.tags && e.tags[cat]).filter(Boolean)
    )].sort();

    // Für preis_id: gespeicherte ID als lesbaren Label anzeigen
    let displayVal = val;
    if (cat === 'preis_id' && val) {
      const entry = libOptions.find(o => o.value === val);
      // Wenn Bibliothek geladen: Label anzeigen, sonst ID beibehalten
      displayVal = entry ? entry.meta?.bezeichnung || entry.label : val;
    }

    const field = document.createElement('div');
    field.className = 'tag-field';

    const lbl = document.createElement('label');
    lbl.setAttribute('for', `${prefix}_${cat}`);
    lbl.textContent = label;
    field.appendChild(lbl);

    const inputWrap = document.createElement('div');
    inputWrap.className = 'tag-input-wrap';

    // Einziges sichtbares Eingabefeld – immer editierbar
    const input = document.createElement('input');
    input.type        = 'text';
    input.id          = `${prefix}_${cat}`;
    input.dataset.cat = cat;
    input.value       = mixed ? '' : displayVal;
    input.placeholder = mixed
      ? '(gemischt – Eingabe überschreibt alle)'
      : (libOptions.length ? 'Eingabe oder ▾ wählen' : '');
    if (mixed) input.classList.add('mixed');
    inputWrap.appendChild(input);

    // Dropdown-Optionen zusammenstellen
    const dropdownOptions = libOptions.length
      ? libOptions
      : modelExisting.map(v => ({ value: v, label: v }));

    if (dropdownOptions.length) {
      const btn = document.createElement('button');
      btn.type        = 'button';
      btn.className   = 'tag-dropdown-btn';
      btn.title       = 'Aus Bibliothek wählen';
      btn.textContent = '▾';
      inputWrap.appendChild(btn);

      const list = document.createElement('div');
      list.className     = 'tag-dropdown-list';
      list.style.display = 'none';
      list.dataset.cat   = cat;

      dropdownOptions.forEach(opt => {
        const item = document.createElement('div');
        item.className = 'tag-dropdown-item';
        // Für Preise: Bezeichnung + Preis anzeigen
        if (cat === 'preis_id' && opt.meta) {
          item.innerHTML = `<span class="dd-main">${escHtml(opt.meta.bezeichnung || opt.label)}</span>
            <span class="dd-sub">${opt.meta.ep} €/${opt.meta.einheit}</span>`;
        } else {
          item.textContent = opt.label;
        }
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          input.classList.remove('mixed');
          // Für preis_id: den lesbaren Namen ins Feld, für Speichern die ID merken
          if (cat === 'preis_id') {
            input.value = opt.meta?.bezeichnung || opt.label;
            input.dataset.savedValue = opt.value; // echte ID für Speichern
          } else {
            input.value = opt.value;
            delete input.dataset.savedValue;
          }
          list.style.display = 'none';
        });
        list.appendChild(item);
      });

      // Leeren-Option
      const clearItem = document.createElement('div');
      clearItem.className   = 'tag-dropdown-item tag-dropdown-clear';
      clearItem.textContent = '✕ Leeren';
      clearItem.addEventListener('mousedown', (e) => {
        e.preventDefault();
        input.value = '';
        delete input.dataset.savedValue;
        input.classList.remove('mixed');
        list.style.display = 'none';
      });
      list.appendChild(clearItem);
      inputWrap.appendChild(list);
    }

    field.appendChild(inputWrap);
    frag.appendChild(field);
  });
  return frag;
}

// Bindet Dropdown-Toggle-Events nach DOM-Einfügen
function attachDropdowns(prefix) {
  document.querySelectorAll('.tag-dropdown-btn').forEach(btn => {
    const wrap = btn.closest('.tag-input-wrap');
    const list = wrap.querySelector('.tag-dropdown-list');
    const input = wrap.querySelector('input');

    btn.addEventListener('click', () => {
      const open = list.style.display !== 'none';
      // Alle anderen schließen
      document.querySelectorAll('.tag-dropdown-list').forEach(l => l.style.display = 'none');
      list.style.display = open ? 'none' : '';
    });

    input.addEventListener('blur', () => {
      setTimeout(() => { list.style.display = 'none'; }, 150);
    });

    input.addEventListener('input', () => {
      // Live-Filter der Dropdown-Items
      const q = input.value.toLowerCase();
      list.querySelectorAll('.tag-dropdown-item:not(.tag-dropdown-clear)').forEach(item => {
        item.style.display = item.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
      if (q) list.style.display = '';
    });
  });
}

function collectTagsFromForm(prefix) {
  const result = {};
  Object.keys(State.categories).forEach(cat => {
    const el = document.getElementById(`${prefix}_${cat}`);
    if (!el) return;
    if (cat === 'preis_id') {
      if (el.dataset.savedValue) {
        result['preis_id']     = el.dataset.savedValue;
        result['preis_quelle'] = 'bibliothek';
      } else {
        result['preis_id']     = el.value.trim();
        result['preis_quelle'] = el.value.trim() ? 'manuell' : '';
      }
    } else {
      result[cat] = el.value.trim();
    }
  });

  // Menge manuell (aus separatem Mengen-Bereich)
  const mengeEl = document.getElementById(`${prefix}_menge`);
  if (mengeEl) result['menge'] = mengeEl.value.trim();

  return result;
}

function saveInlineTags() {
  const tags = collectTagsFromForm('inline');
  const ids  = [...State.selectedIds].map(Number);
  if (!ids.length) return;
  ruby('setTags', { ids, tags });
}

// Modal entfernt – Tags werden ausschliesslich in der mittleren Spalte vergeben

// ---------------------------------------------------------------------------
// SELECTION BAR
// ---------------------------------------------------------------------------
function scrollToEntity(id) {
  // Kurz warten bis renderEntityList() den DOM aktualisiert hat
  requestAnimationFrame(() => {
    const row = document.querySelector(`.entity-row[data-id="${id}"]`);
    if (row) {
      row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      // Element liegt in einer eingeklappten Gruppe → Gruppe aufklappen und nochmal versuchen
      expandGroupForEntity(id);
      requestAnimationFrame(() => {
        const r = document.querySelector(`.entity-row[data-id="${id}"]`);
        if (r) r.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    }
  });
}

// Klappt alle Gruppen-Bodies auf, die das gesuchte Entity enthalten
function expandGroupForEntity(id) {
  const entity = State.entities.find(e => String(e.id) === id);
  if (!entity) return;

  // Alle group-body Elemente die display:none haben aufklappen
  document.querySelectorAll('.group-body').forEach(body => {
    if (body.style.display === 'none') {
      body.style.display = '';
      const toggle = body.previousElementSibling?.querySelector('.group-toggle');
      if (toggle) toggle.textContent = '▾';
    }
  });
}

function updateSelectionBar() {
  const bar   = document.getElementById('selectionBar');
  const count = document.getElementById('selectionCount');
  const n     = State.selectedIds.size;
  bar.style.display   = n > 0 ? '' : 'none';
  count.textContent   = `${n} ausgewählt`;
}

function updateEntityCount() {
  const total       = State.entities.length;
  const classified  = State.entities.filter(isClassified).length;
  const gewerke     = new Set(State.entities.map(e => e.tags && e.tags['gewerk']).filter(Boolean));
  document.getElementById('entityCount').textContent        = total;
  document.getElementById('metaBauteile').textContent       = total;
  document.getElementById('metaGewerke').textContent        = gewerke.size || '—';
  document.getElementById('metaKlassifiziert').textContent  = classified === 0 ? '—' : `${classified} / ${total}`;
}

function updateCostBanner() {
  if (!State.entities.length) return;
  let total = 0;
  const preise = State.library?.preise || [];
  State.entities.forEach(e => {
    const tags    = e.tags || {};
    const preisId = tags.preis_id || '';
    let ep = 0;
    const preisObj = preisId ? preise.find(p => p.id === preisId) : null;
    if (preisObj) {
      ep = parseFloat(preisObj.ep) || 0;
    } else {
      ep = parseFloat(tags.einheitspreis || '') || 0;
    }
    if (ep <= 0) return;
    const mengeStr  = tags.menge || '';
    const mengeAuto = e.menge_auto || '';
    const menge = mengeStr
      ? parseFloat(mengeStr.replace(',', '.'))
      : (mengeAuto ? parseFloat(String(mengeAuto).match(/[\d.,]+/)?.[0]?.replace(',', '.') || '0') : 0);
    if (menge > 0) total += menge * ep;
  });
  const el = document.getElementById('metaGesamtkosten');
  if (el) el.textContent = total > 0
    ? total.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' €'
    : '—';
}

// ---------------------------------------------------------------------------
// CATEGORY SELECTS
// ---------------------------------------------------------------------------
function populateCategorySelects() {
  const options = '<option value="">— keine —</option>' +
    Object.entries(State.categories)
      .map(([v, l]) => `<option value="${escHtml(v)}">${escHtml(l)}</option>`)
      .join('');
  ['groupBy1', 'groupBy2', 'groupBy3'].forEach(id => {
    const el = document.getElementById(id);
    el.innerHTML = options;
  });
  document.getElementById('groupBy1').value = '';
  buildTagFilterSelects();
}

// ---------------------------------------------------------------------------
// TAG-FILTER: Eine Zeile pro Kategorie + Schieberegler für Klassifizierung
// ---------------------------------------------------------------------------

function buildTagFilterSelects() {
  const container = document.getElementById('tagFilterRows');
  if (!container) return;
  container.innerHTML = '';

  // Merke welche Kategorie gerade isoliert wird
  if (!State.isolateCat) State.isolateCat = null;

  Object.entries(State.categories).forEach(([cat, label]) => {
    const values = [...new Set(State.entities.map(e => e.tags && e.tags[cat]).filter(Boolean))].sort();

    const row = document.createElement('div');
    row.className = 'filter-row filter-cat-row';
    row.dataset.cat = cat;

    // Isolier-Button (vor dem Label)
    const isoBtn = document.createElement('button');
    isoBtn.className = 'btn-iso-cat';
    isoBtn.title     = `Nur unklassifizierte Bauteile (${label}) im Modell anzeigen`;
    isoBtn.innerHTML = '◎';
    isoBtn.dataset.cat = cat;
    const isActive = State.isolateActive && State.isolateCat === cat;
    if (isActive) {
      isoBtn.classList.add('btn-iso-active');
      isoBtn.innerHTML = '◉';
    }
    isoBtn.addEventListener('click', () => toggleCatIsolate(cat, label, isoBtn));
    row.appendChild(isoBtn);

    const lbl = document.createElement('span');
    lbl.className   = 'filter-label filter-cat-label';
    lbl.textContent = label;
    row.appendChild(lbl);

    const sel = document.createElement('select');
    sel.className   = 'tag-filter-select';
    sel.dataset.cat = cat;
    sel.innerHTML =
      `<option value="">Alle</option>` +
      `<option value="__none__">— nicht klassifiziert —</option>` +
      values.map(v => `<option value="${escHtml(v)}">${escHtml(v)}</option>`).join('');

    if (State.tagFilters[cat]) sel.value = State.tagFilters[cat];

    sel.addEventListener('change', () => {
      State.tagFilters[cat] = sel.value;
      sel.classList.toggle('filter-active', !!sel.value);
      renderEntityList();
    });

    row.appendChild(sel);
    container.appendChild(row);
  });
}

// Schaltet Isolate für eine Kategorie ein/aus
function toggleCatIsolate(cat, label, btn) {
  // Wenn diese Kategorie bereits isoliert ist → ausschalten
  if (State.isolateActive && State.isolateCat === cat) {
    ruby('isolateDisable');
    return;
  }

  // Unklassifizierte Bauteile dieser Kategorie ermitteln
  const unclassified = State.entities.filter(e => !(e.tags && e.tags[cat] && e.tags[cat].trim()));
  if (!unclassified.length) {
    showToast(`Alle Bauteile haben bereits ein ${label}-Tag`, 'ok');
    return;
  }

  // Diese Bauteile selektieren + isolieren
  State.selectedIds = new Set(unclassified.map(e => String(e.id)));
  State.isolateCat  = cat;
  ruby('isolateEnable', unclassified.map(e => e.id));

  // Auch im Dashboard-Filter anzeigen
  State.tagFilters[cat] = '__none__';
  renderEntityList();
  updateSelectionBar();
  renderTagEditor();

  showToast(`${unclassified.length} unklassifizierte ${label}-Bauteile isoliert`);
}


function updateFilterIndicator() {
  const activeCount = Object.values(State.tagFilters).filter(Boolean).length +
    (State.classFilter !== 'all' ? 1 : 0);
  const row = document.getElementById('tagFilterRow');
  if (row) row.classList.toggle('filter-active', activeCount > 0);
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------
function countLeaves(node) {
  if (node.__items__) return node.__items__.length;
  return Object.values(node).reduce((acc, child) => acc + countLeaves(child), 0);
}

function typeIcon(type) {
  const map = { Group: '▣', ComponentInstance: '◈', Face: '△', Edge: '—' };
  return map[type] || '○';
}

function escHtml(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function showToast(msg, type = 'ok') {
  let toast = document.getElementById('_toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = '_toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className   = `toast toast-${type}`;
  toast.style.display = 'block';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.display = 'none'; }, 3000);
}

// ---------------------------------------------------------------------------
// EXPORT
// ---------------------------------------------------------------------------
function exportCSV() {
  const cats = Object.keys(State.categories);
  const header = ['ID', 'Name', 'Typ', 'Layer', ...cats].join(';');
  const rows = State.entities.map(e => {
    const tagVals = cats.map(c => e.tags?.[c] || '');
    return [e.id, e.name, e.type, e.layer, ...tagVals]
      .map(v => `"${String(v).replace(/"/g, '""')}"`)
      .join(';');
  });
  downloadFile('bim_report.csv', [header, ...rows].join('\n'), 'text/csv');
}

function exportJSON() {
  downloadFile('bim_report.json', JSON.stringify(State.entities, null, 2), 'application/json');
}

function downloadFile(filename, content, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = filename;
  a.click();
}

// ---------------------------------------------------------------------------
// PROJEKTMETA CONTROLS
// Inline-Bearbeitung von BGF, BRI, Gesamtkosten direkt im Banner
// ---------------------------------------------------------------------------
function bindMetaControls() {
  const fields = [
    { btnId: 'btnEditKosten', inputId: 'inputKosten', valueId: 'metaKosten', key: 'gesamtkosten' },
    { btnId: 'btnEditBGF',    inputId: 'inputBGF',    valueId: 'metaBGF',    key: 'bgf'          },
    { btnId: 'btnEditBRI',    inputId: 'inputBRI',    valueId: 'metaBRI',    key: 'bri'          },
  ];

  fields.forEach(({ btnId, inputId, valueId }) => {
    document.getElementById(btnId).addEventListener('click', () => {
      const val = document.getElementById(valueId).textContent;
      const inp = document.getElementById(inputId);
      inp.value = val === '—' ? '' : val;
      inp.style.display = '';
      document.getElementById(valueId).style.display = 'none';
      document.getElementById('metaSaveArea').style.display = '';
      inp.focus();
    });
  });

  document.getElementById('btnSaveMeta').addEventListener('click', () => {
    const payload = {};
    fields.forEach(({ inputId, valueId, key }) => {
      const inp = document.getElementById(inputId);
      const val = inp.value.trim();
      payload[key] = val;
      // UI sofort aktualisieren
      document.getElementById(valueId).textContent = val || '—';
      document.getElementById(valueId).style.display = '';
      inp.style.display = 'none';
    });
    document.getElementById('metaSaveArea').style.display = 'none';
    ruby('saveProjectMeta', payload);
  });
}
