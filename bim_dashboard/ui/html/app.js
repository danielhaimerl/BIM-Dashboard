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
  reportFilters:  {},        // aktive Filter im Auswertungs-Tab
  kostenstufe:    '01 - Kostenprognose',
  bgfTotal:       0,
  briTotal:       0,
  wohnungenTotal: 0,
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
    updateAutoMetrics();
    updateCostBanner();
  },

  onCategoriesLoaded(cats) {
    State.categories = cats;
    populateCategorySelects();
    renderTagEditor();
  },

  onSketchupSelectionChanged(ids) {
    const skuIds = new Set(ids.map(String));
    // list_ids aller Entities finden deren SketchUp-ID selektiert ist
    State.selectedIds = new Set(
      State.entities.filter(e => skuIds.has(String(e.id))).map(e => e.list_id || String(e.id))
    );
    renderEntityList();
    renderTagEditor();
    updateSelectionBar();
    if (ids.length > 0) {
      // Timeout damit renderEntityList() den DOM vollständig aufgebaut hat
      setTimeout(() => scrollToEntity(String(ids[0])), 50);
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
    // BGF und BRI kommen immer aus dem Modell (updateAutoMetrics), nicht aus gespeicherten Meta-Daten
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

      if (btn.dataset.module === 'report') renderReport();
      if (btn.dataset.module === 'agent' && typeof onAgentModuleActivated === 'function')
        onAgentModuleActivated();
    });
  });

  // Import-Button (kein Modul-Wechsel, öffnet Datei-Dialog)
  document.getElementById('btnImportExcel')?.addEventListener('click', () => {
    ruby('importProjectStructure');
  });
}

function bindControls() {
  // Header
  document.getElementById('kostenstufeSelect').addEventListener('change', (e) => {
    State.kostenstufe = e.target.value;
    updateCostBanner();
  });

  document.getElementById('btnRefresh').addEventListener('click', () => {
    ruby('refreshModel');
  });
  document.getElementById('btnZoom').addEventListener('click', () => {
    const ids = getSelectedEntityIds();
    if (!ids.length) return;
    ruby('selectAndZoom', ids);
  });

  document.getElementById('btnIsolate').addEventListener('click', () => {
    if (State.isolateActive) {
      ruby('isolateDisable');
    } else {
      const ids = getSelectedEntityIds();
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

  // "Alle markieren" – ersetzt Selektion durch alle gefilterten Bauteile
  document.getElementById('btnSelectAll').addEventListener('click', () => {
    const filtered = getFilteredEntities();
    if (!filtered.length) { showToast('Keine Bauteile im aktuellen Filter', 'error'); return; }
    State.selectedIds = new Set(filtered.map(e => e.list_id || String(e.id)));
    renderEntityList();
    updateSelectionBar();
    renderTagEditor();
    showToast(`${filtered.length} Bauteil${filtered.length !== 1 ? 'e' : ''} markiert`);
  });
  document.getElementById('btnClearSelected').addEventListener('click', () => {
    if (!confirm(`Tags für ${State.selectedIds.size} Bauteil(e) löschen?`)) return;
    ruby('clearTags', { ids: getSelectedEntityIds(), category: null });
  });

  // Tag-Editor (mittlere Spalte – einziger Weg zum Vergeben von Tags)
  document.getElementById('btnSaveTags').addEventListener('click', saveInlineTags);
  document.getElementById('btnResetTags').addEventListener('click', renderTagEditor);

  // Export
  document.getElementById('btnCalcQty')?.addEventListener('click', () => {
    const ids = getSelectedEntityIds();
    ruby('calculateQuantities', ids.length ? ids : null);
  });

  document.getElementById('btnExportExcel')?.addEventListener('click', exportReportExcel);
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
  State.filteredIds = filtered.map(e => e.list_id || String(e.id));

  if (!filtered.length) {
    container.innerHTML = '<p class="placeholder">Keine Bauteile gefunden.</p>';
    return;
  }

  // Gruppierung
  const grouped = groupEntities(filtered, State.groupBy.filter(Boolean));
  container.innerHTML = '';
  container.appendChild(renderGroup(grouped, 0));
}

// DIN 276 Ebenen für die Gruppierung: 1. Ebene = 100er (300), 2. Ebene = 10er (330),
// 3. Ebene = der gespeicherte Tag selbst (331)
const DIN276_LEVELS = {
  din276_1: 'DIN 276 – 1. Ebene',
  din276_2: 'DIN 276 – 2. Ebene',
};

function groupLabel(key) {
  if (key === 'din276') return 'DIN 276 – 3. Ebene';
  return DIN276_LEVELS[key] || (State.categories || {})[key] || key;
}

function groupValue(e, key) {
  if (DIN276_LEVELS[key]) {
    const m = ((e.tags && e.tags.din276) || '').match(/^\s*(\d{3})/);
    if (!m) return '—';
    return key === 'din276_1' ? m[1][0] + '00' : m[1].slice(0, 2) + '0';
  }
  return (e.tags && e.tags[key]) || '—';
}

function groupEntities(entities, keys) {
  if (!keys.length) return { __items__: entities };
  const key  = keys[0];
  const rest = keys.slice(1);
  const groups = {};
  entities.forEach(e => {
    const val = groupValue(e, key);
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
  const row    = document.createElement('div');
  const listId = entity.list_id || String(entity.id);  // eindeutig pro Listeneintrag
  const id     = String(entity.id);                    // echte SketchUp entityID
  const sel    = State.selectedIds.has(listId);
  row.className = `entity-row${sel ? ' selected' : ''}`;
  row.dataset.id     = listId;
  row.dataset.sku_id = id;

  // Tags die in der Bauteilliste NICHT als Badge erscheinen sollen
  const HIDDEN_IN_LIST = new Set(['menge', 'menge_auto', 'einheitspreis', 'einheit', 'ref_stufe2', 'preis_id']);

  const STUFE_LABELS = {
    '1': '01 - Kostenprognose', '2': '02 - Kostenschätzung', '3': '03 - Kostenberechnung',
    '01 - Kostenprognose': '01 - Kostenprognose',
    '02 - Kostenschätzung': '02 - Kostenschätzung',
    '03 - Kostenberechnung': '03 - Kostenberechnung',
  };

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

  // Alle Klassifikations-Tags in fester Reihenfolge — vergeben=farbig, leer=ausgegraut
  const TAG_DISPLAY_ORDER = Object.keys(State.categories || {}).filter(k => k !== 'preis_id');
  const tags = entity.tags || {};
  const tagBadges = TAG_DISPLAY_ORDER.map(k => {
    const val = tags[k];
    const catLabel = (State.categories || {})[k] || k;
    if (val) {
      const label = k === 'stufe' ? (STUFE_LABELS[val] || val) : val;
      return `<span class="tag-badge tag-badge-set" data-cat="${escHtml(k)}" title="${escHtml(catLabel)}: ${escHtml(label)}">${escHtml(label)}</span>`;
    }
    return `<span class="tag-badge tag-badge-empty" data-cat="${escHtml(k)}" title="${escHtml(catLabel)} (nicht vergeben)">${escHtml(catLabel)}</span>`;
  }).join('');

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

  // Klick auf Zeile → Selektion (listId als Schlüssel, id für SketchUp)
  row.addEventListener('click', (e) => {
    if (e.target.tagName === 'INPUT') return;
    handleRowClick(listId, e);
  });
  row.querySelector('input[type=checkbox]').addEventListener('change', (e) => {
    if (e.target.checked) {
      State.selectedIds.add(listId);
    } else {
      State.selectedIds.delete(listId);
    }
    row.classList.toggle('selected', e.target.checked);
    updateSelectionBar();
    renderTagEditor();
  });

  return row;
}

function handleRowClick(id, e) {
  if (e.shiftKey) {
    const ids = State.filteredIds;
    const last = [...State.selectedIds].pop();
    const a = ids.indexOf(last);
    const b = ids.indexOf(id);
    if (a !== -1 && b !== -1) {
      const [from, to] = [Math.min(a, b), Math.max(a, b)];
      ids.slice(from, to + 1).forEach(i => State.selectedIds.add(i));
    }
  } else if (e.ctrlKey || e.metaKey) {
    if (State.selectedIds.has(id)) State.selectedIds.delete(id);
    else State.selectedIds.add(id);
  } else {
    State.selectedIds = new Set([id]);
  }
  renderEntityList();
  updateSelectionBar();
  renderTagEditor();
  // Kein syncSelectionToSketchUp hier – verursacht Echo-Loop über SelectionObserver
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

  // list_ids → echte Entities auflösen
  const selectedListIds = new Set(ids);
  const selected = State.entities.filter(e => selectedListIds.has(e.list_id || String(e.id)));
  const firstEnt = selected[0];

  const name = ids.length === 1
    ? (firstEnt?.name || ids[0])
    : `${ids.length} Bauteile`;
  hint.textContent      = name;
  actions.style.display = '';

  const merged = mergedTags(selected);

  body.innerHTML = '';

  // Bauteil-Namenszeile
  if (ids.length === 1 && firstEnt) {
    const nameCard = document.createElement('div');
    nameCard.className = 'entity-name-card';
    nameCard.innerHTML = `
      <span class="entity-name-card-name">${escHtml(firstEnt.name)}</span>
      <span class="entity-name-card-meta">${escHtml(firstEnt.type)} · Layer: ${escHtml(firstEnt.layer)}</span>
      ${firstEnt.path?.length ? `<span class="entity-name-card-path">${firstEnt.path.map(escHtml).join(' › ')}</span>` : ''}
    `;
    body.appendChild(nameCard);
  }

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
  title.textContent = 'Menge (aus Modell)';
  section.appendChild(title);

  // Berechnete Menge anzeigen
  if (isSingle && entities[0]?.menge_auto) {
    const autoRow = document.createElement('div');
    autoRow.className = 'menge-auto-row';
    autoRow.innerHTML = `<span class="filter-label">Berechnet</span>
      <span class="menge-auto-val">${escHtml(fmtMenge(entities[0].menge_auto))}</span>`;
    section.appendChild(autoRow);
  } else if (isSingle) {
    const hint = document.createElement('div');
    hint.className = 'menge-auto-row';
    hint.innerHTML = `<span class="filter-label" style="color:var(--text-hint)">⊞ Mengen berechnen</span>`;
    section.appendChild(hint);
  }

  // Einheit-Override
  const einheiten = State.constants?.einheiten || ['m²', 'm³', 'm', 'Stück'];
  const mergedEinheit = [...new Set(entities.map(e => e.tags?.einheit || ''))];
  const currentEinheit = mergedEinheit.length === 1 ? mergedEinheit[0] : '';

  const einheitRow = document.createElement('div');
  einheitRow.className = 'menge-auto-row';

  const lbl = document.createElement('span');
  lbl.className   = 'filter-label';
  lbl.textContent = 'Einheit';
  einheitRow.appendChild(lbl);

  const sel = document.createElement('select');
  sel.id          = 'inline_einheit';
  sel.dataset.cat = 'einheit';
  sel.className   = 'tag-filter-select';
  sel.style.flex  = '1';

  const emptyOpt = document.createElement('option');
  emptyOpt.value       = '';
  emptyOpt.textContent = '— auto —';
  sel.appendChild(emptyOpt);

  einheiten.forEach(e => {
    const opt = document.createElement('option');
    opt.value       = e;
    opt.textContent = e;
    if (e === currentEinheit) opt.selected = true;
    sel.appendChild(opt);
  });

  einheitRow.appendChild(sel);
  section.appendChild(einheitRow);

  return section;
}


function mergedTags(entities) {
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
    input.dataset.dirty = 'false';
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
          input.dataset.dirty = 'true';
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
        input.dataset.dirty = 'true';
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
      input.dataset.dirty = 'true';
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
    if (el.dataset.dirty !== 'true') return; // nur vom Nutzer geänderte Felder senden
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

  // Einheit aus Mengen-Bereich
  const einheitEl = document.getElementById('inline_einheit');
  if (einheitEl) result['einheit'] = einheitEl.value;

  return result;
}

// list_ids → echte SketchUp entity IDs (Zahlen), dedupliziert
function getSelectedEntityIds() {
  const selectedListIds = new Set([...State.selectedIds]);
  return [...new Set(
    State.entities
      .filter(e => selectedListIds.has(e.list_id || String(e.id)))
      .map(e => Number(e.id))
  )];
}

function saveInlineTags() {
  const tags = collectTagsFromForm('inline');
  const ids = getSelectedEntityIds();
  if (!ids.length) return;
  ruby('setTags', { ids, tags });
}

// Modal entfernt – Tags werden ausschliesslich in der mittleren Spalte vergeben

// ---------------------------------------------------------------------------
// SELECTION BAR
// ---------------------------------------------------------------------------
function scrollToEntity(id) {
  const row = document.querySelector(`.entity-row[data-id="${id}"]`);
  if (row) {
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } else {
    // Element in eingeklappter Gruppe → alle aufklappen, dann scrollen
    expandGroupForEntity(id);
    setTimeout(() => {
      const r = document.querySelector(`.entity-row[data-id="${id}"]`);
      if (r) r.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 30);
  }
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
  bar.style.display = n > 0 ? '' : 'none';
  count.textContent = `${n} ausgewählt`;
}

// ---------------------------------------------------------------------------
// KENNZAHLEN: Aggregation aus Modellelementen anhand Konfig-Mapping
// ---------------------------------------------------------------------------
function matchesFilter(entity, filter) {
  if (!filter) return false;
  const fullPath = [...(entity.path || []), entity.name].join('/');
  // Enthält "/" → Pfad-Filter; sonst exakter Namensvergleich
  if (filter.includes('/')) return fullPath === filter || fullPath.endsWith('/' + filter);
  return entity.name === filter;
}

function getMetricValue(key) {
  const cfg  = (State.elementMapping && State.elementMapping[key]) || {};
  const filter = cfg.filter || '';
  const agg  = cfg.aggregation || 'count';
  const matches = State.entities.filter(e => matchesFilter(e, filter));
  if (agg === 'count') return matches.length;
  // menge_auto summieren
  return matches.reduce((sum, e) => {
    const n = parseFloat(String(e.menge_auto || '').replace(',', '.').match(/[\d.,]+/)?.[0]?.replace(',', '.') || '0');
    return sum + (isNaN(n) ? 0 : n);
  }, 0);
}

function updateEntityCount() {
  const total      = State.entities.length;
  const classified = State.entities.filter(isClassified).length;
  const wohnungen  = getMetricValue('wohnungen');
  State.wohnungenTotal = wohnungen;
  document.getElementById('entityCount').textContent        = total;
  document.getElementById('metaBauteile').textContent       = total;
  document.getElementById('metaWohnungen').textContent      = wohnungen || '—';
  document.getElementById('metaKlassifiziert').textContent  = classified === 0 ? '—' : `${classified} / ${total}`;
}

function updateAutoMetrics() {
  const bgf = getMetricValue('bgf');
  const bri = getMetricValue('bri');

  State.bgfTotal = bgf;
  State.briTotal = bri;

  if (bgf > 0)
    document.getElementById('metaBGF').textContent =
      bgf.toLocaleString('de-DE', { maximumFractionDigits: 0 });
  if (bri > 0)
    document.getElementById('metaBRI').textContent =
      bri.toLocaleString('de-DE', { maximumFractionDigits: 0 });
}

function resolveEP(tags) {
  const preisId    = tags.preis_id || '';
  const preisQuelle = tags.preis_quelle || '';
  const preise     = State.library?.preise || [];

  if (!preisId) return parseFloat(tags.einheitspreis || '') || 0;

  if (preisQuelle === 'bibliothek') {
    const obj = preise.find(p => p.id === preisId);
    if (obj) return parseFloat(obj.ep) || 0;
  }

  // manuell: preis_id enthält direkt den Zahlenwert
  const manual = parseFloat(preisId);
  if (!isNaN(manual) && manual > 0) return manual;

  // Fallback: einheitspreis-Tag
  return parseFloat(tags.einheitspreis || '') || 0;
}

function parseMenge(tags, menge_auto) {
  const mengeStr = tags.menge || '';
  if (mengeStr) return parseFloat(mengeStr.replace(',', '.')) || 0;
  const auto = String(menge_auto || '');
  return parseFloat(auto.match(/[\d.,]+/)?.[0]?.replace(',', '.') || '0') || 0;
}

function updateCostBanner() {
  if (!State.entities.length) return;
  let total = 0;
  const stufeFilter = State.kostenstufe;

  // Altwerte '1'/'2'/'3' auf neue Bezeichnungen mappen für Rückwärtskompatibilität
  const STUFE_MIGRATE = { '1': '01 - Kostenprognose', '2': '02 - Kostenschätzung', '3': '03 - Kostenberechnung' };
  State.entities.forEach(e => {
    const rawStufe = e.tags?.stufe || '';
    const normStufe = STUFE_MIGRATE[rawStufe] || rawStufe;
    if (stufeFilter && normStufe !== stufeFilter) return;
    const tags  = e.tags || {};
    const ep    = resolveEP(tags);
    if (ep <= 0) return;
    const menge = parseMenge(tags, e.menge_auto);
    if (menge > 0) total += menge * ep;
  });

  const el = document.getElementById('metaGesamtkosten');
  if (el) el.textContent = total > 0
    ? total.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' €'
    : '—';

  updateKostenkennzahlen(total);
}

function updateKostenkennzahlen(gesamtkosten) {
  const fmt = (v) => v.toLocaleString('de-DE', { maximumFractionDigits: 0 });
  const elBGF = document.getElementById('metaEurBGF');
  const elBRI = document.getElementById('metaEurBRI');
  const elWohnung = document.getElementById('metaEurWohnung');
  if (elBGF) elBGF.textContent = (gesamtkosten > 0 && State.bgfTotal > 0)
    ? fmt(gesamtkosten / State.bgfTotal) + ' €/m²' : '—';
  if (elBRI) elBRI.textContent = (gesamtkosten > 0 && State.briTotal > 0)
    ? fmt(gesamtkosten / State.briTotal) + ' €/m³' : '—';
  if (elWohnung) elWohnung.textContent = (gesamtkosten > 0 && State.wohnungenTotal > 0)
    ? fmt(gesamtkosten / State.wohnungenTotal) + ' €' : '—';
}

// ---------------------------------------------------------------------------
// CATEGORY SELECTS
// ---------------------------------------------------------------------------
function populateCategorySelects() {
  const options = '<option value="">— keine —</option>' +
    Object.entries(State.categories)
      .flatMap(([v, l]) => v === 'din276'
        ? [['din276_1', DIN276_LEVELS.din276_1 + ' (100er)'],
           ['din276_2', DIN276_LEVELS.din276_2 + ' (10er)'],
           ['din276',   'DIN 276 – 3. Ebene (1er)']]
        : [[v, l]])
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

// Zahl mit deutscher Formatierung (Komma, Punkt-Tausender, max 2 Nachkommastellen)
function fmtNum(v, maxDec = 2) {
  const n = parseFloat(v);
  if (isNaN(n)) return v != null ? String(v) : '—';
  return n.toLocaleString('de-DE', { maximumFractionDigits: maxDec });
}

// Menge-String aus Ruby ("3897.25 m²") in deutsche Schreibweise umwandeln
function fmtMenge(str) {
  if (!str) return '—';
  const m = String(str).match(/^([\d.,]+)\s*(.*)$/);
  if (!m) return str;
  const n = parseFloat(m[1].replace(',', '.'));
  if (isNaN(n)) return str;
  return n.toLocaleString('de-DE', { maximumFractionDigits: 2 }) + (m[2] ? ' ' + m[2].trim() : '');
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
  // Strukturierter Export der aktuellen Auswertungsansicht (Gruppierung + Filter)
  if (typeof exportReportCSVStructured === 'function') {
    exportReportCSVStructured();
  }
}

function exportJSON() {
  ruby('exportCSVFile', {
    csv: JSON.stringify(State.entities, null, 2),
    filename: 'bim_report.json',
  });
}

// ---------------------------------------------------------------------------
// PROJEKTMETA CONTROLS
// Inline-Bearbeitung von BGF, BRI, Gesamtkosten direkt im Banner
// ---------------------------------------------------------------------------
function bindMetaControls() {
  const fields = [
    { btnId: 'btnEditKosten', inputId: 'inputKosten', valueId: 'metaKosten', key: 'gesamtkosten' },
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
      document.getElementById(valueId).textContent = val || '—';
      document.getElementById(valueId).style.display = '';
      inp.style.display = 'none';
    });
    document.getElementById('metaSaveArea').style.display = 'none';
    ruby('saveProjectMeta', payload);
  });
}
