// =============================================================================
// BIM Dashboard – report.js
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// Haupt-Render-Funktion
// ---------------------------------------------------------------------------
function renderReport() {
  // State.reportFilters lazy initialisieren
  if (!State.reportFilters) State.reportFilters = {};

  const container    = document.getElementById('reportContainer');
  if (!container) return;
  const activeGroups = State.groupBy.filter(Boolean);

  buildReportFilterSelects();

  if (!activeGroups.length) {
    container.innerHTML = '<p class="placeholder">Gruppierung wählen um Auswertung zu starten.</p>';
    return;
  }
  if (!State.entities || !State.entities.length) {
    container.innerHTML = '<p class="placeholder">Keine Bauteile im Modell.</p>';
    return;
  }

  const entities  = getReportFilteredEntities();
  container.innerHTML = '';

  if (!entities.length) {
    container.innerHTML = '<p class="placeholder">Alle Bauteile durch Filter ausgeblendet.</p>';
    return;
  }

  const grouped   = groupEntities(entities, activeGroups);
  const totalCost = sumCosts(entities);

  container.appendChild(buildTotalHeader(totalCost, entities.length));
  container.appendChild(buildSection(grouped, activeGroups, 0));

  const unclassified = entities.filter(e => !isClassified(e)).length;
  if (unclassified > 0) {
    const hint = document.createElement('div');
    hint.className = 'report-completeness';
    hint.innerHTML = `<span class="report-completeness-dot"></span>
      ${unclassified} Bauteil${unclassified !== 1 ? 'e' : ''} noch nicht klassifiziert`;
    container.appendChild(hint);
  }
}

// ---------------------------------------------------------------------------
// Gesamt-Header
// ---------------------------------------------------------------------------
function buildTotalHeader(total, count) {
  const hdr = document.createElement('div');
  hdr.className = 'cost-report-header';
  const bgf = parseFloat(document.getElementById('metaBGF')?.textContent) || 0;
  hdr.innerHTML = `
    <div class="cost-report-kpi">
      <span>Bauteile</span>
      <strong>${count}</strong>
    </div>
    <div class="cost-report-kpi">
      <span>Gesamtkosten</span>
      <strong>${total > 0 ? fmtEur(total) : '—'}</strong>
    </div>
    ${bgf > 0 && total > 0 ? `<div class="cost-report-kpi">
      <span>Kosten / m² BGF</span>
      <strong>${Math.round(total / bgf).toLocaleString('de-DE')} €/m²</strong>
    </div>` : ''}
  `;
  return hdr;
}

// ---------------------------------------------------------------------------
// Rekursiver Gruppenaufbau
// ---------------------------------------------------------------------------
function buildSection(node, groupKeys, depth) {
  const frag = document.createDocumentFragment();

  if (node.__items__) {
    frag.appendChild(buildDetailTable(node.__items__));
    return frag;
  }

  const catKey   = groupKeys[depth];
  const catLabel = State.categories[catKey] || catKey;

  Object.entries(node).forEach(([label, children]) => {
    const items    = collectItems(children);
    const count    = items.length;
    const subtotal = sumCosts(items);

    const section = document.createElement('div');
    section.className = `report-section depth-${depth}`;

    const hdr = document.createElement('div');
    hdr.className = 'report-section-header';
    hdr.innerHTML = `
      <span class="report-toggle">▾</span>
      <span class="report-cat-label">${escHtml(catLabel)}:</span>
      <span class="report-group-label">${escHtml(label)}</span>
      <span class="badge">${count}</span>
      <span class="report-spacer"></span>
      <span class="cost-section-total">${subtotal > 0 ? fmtEur(subtotal) : '<span class="dim">—</span>'}</span>
      <span class="report-select-hint" title="In SketchUp selektieren">⌖</span>
    `;

    hdr.addEventListener('click', (e) => {
      if (e.target.classList.contains('report-toggle')) return;
      State.selectedIds = new Set(items.map(i => String(i.id)));
      syncSelectionToSketchUp();
      updateSelectionBar();
      renderEntityList();
      renderTagEditor();
      showToast(`${count} Bauteil${count !== 1 ? 'e' : ''} selektiert`);
    });

    const toggle = hdr.querySelector('.report-toggle');
    const body   = document.createElement('div');
    body.className = 'report-section-body';

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const collapsed = body.style.display === 'none';
      body.style.display = collapsed ? '' : 'none';
      toggle.textContent = collapsed ? '▾' : '▸';
    });

    if (!node[label].__items__ && groupKeys[depth + 1]) {
      body.appendChild(buildSummaryTable(children, groupKeys[depth + 1], subtotal));
    }
    body.appendChild(buildSection(children, groupKeys, depth + 1));

    section.appendChild(hdr);
    section.appendChild(body);
    frag.appendChild(section);
  });

  return frag;
}

// ---------------------------------------------------------------------------
// Zusammenfassungstabelle
// ---------------------------------------------------------------------------
function buildSummaryTable(node, nextCatKey, parentTotal) {
  if (node.__items__) return document.createDocumentFragment();
  const catLabel = State.categories[nextCatKey] || nextCatKey;
  const wrap = document.createElement('div');
  wrap.className = 'report-summary';
  const tbl = document.createElement('table');
  tbl.className = 'report-summary-table';
  tbl.innerHTML = `<thead><tr>
    <th>${escHtml(catLabel)}</th>
    <th class="num">Anzahl</th>
    <th class="num">Anteil</th>
    <th class="num">Gesamtbetrag</th>
  </tr></thead>`;
  const tbody    = document.createElement('tbody');
  const allItems = collectItems(node);
  Object.entries(node).forEach(([subLabel, subChildren]) => {
    const items  = collectItems(subChildren);
    const n      = items.length;
    const cost   = sumCosts(items);
    const anteil = allItems.length > 0 ? Math.round(n / allItems.length * 100) : 0;
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.innerHTML = `
      <td>${escHtml(subLabel)}</td>
      <td class="num">${n}</td>
      <td class="num">
        <div class="pct-bar-wrap">
          <div class="pct-bar" style="width:${anteil}%"></div>
          <span>${anteil} %</span>
        </div>
      </td>
      <td class="num">${cost > 0 ? fmtEur(cost) : '<span class="dim">—</span>'}</td>
    `;
    tr.addEventListener('click', () => {
      State.selectedIds = new Set(items.map(i => String(i.id)));
      syncSelectionToSketchUp();
      updateSelectionBar();
      renderEntityList();
      showToast(`${n} Bauteil${n !== 1 ? 'e' : ''} selektiert`);
    });
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);
  wrap.appendChild(tbl);
  return wrap;
}

// ---------------------------------------------------------------------------
// Detail-Tabelle
// ---------------------------------------------------------------------------
function buildDetailTable(items) {
  const wrap = document.createElement('div');
  wrap.className = 'report-agg-wrapper';
  const tbl = document.createElement('table');
  tbl.className = 'report-table';

  // Header mit data-col zur Validierung
  const thead = tbl.createTHead();
  const hRow  = thead.insertRow();
  ['Name','Stufe','Material','Menge','EP (€)','GB (€)',''].forEach((label, i) => {
    const th = document.createElement('th');
    th.textContent = label;
    th.dataset.col = i;
    if (i >= 3 && i <= 5) th.className = 'num';
    if (i === 6) th.style.width = '24px';
    hRow.appendChild(th);
  });

  const tbody    = document.createElement('tbody');
  let   subtotal = 0;
  const stufeLabels = { '1': 'Stufe 1', '2': 'Stufe 2', '3': 'Stufe 3' };

  // DEBUG: erste Entity loggen
  if (items.length > 0) {
    const dbg = getCostData(items[0]);
    console.log('[BIM Report] Erste Entity:', items[0].name, '| menge_auto:', items[0].menge_auto, '| tags:', JSON.stringify(items[0].tags), '| getCostData:', JSON.stringify(dbg));
  }

  items.forEach(e => {
    const cost = getCostData(e);
    const tr   = document.createElement('tr');
    tr.className = State.selectedIds.has(String(e.id)) ? 'selected' : '';

    const stufe = e.tags?.stufe || '';

    // Spalte 1: Name
    const tdName = document.createElement('td');
    tdName.className = 'report-item-name';
    tdName.textContent = e.name;

    // Spalte 2: Stufe
    const tdStufe = document.createElement('td');
    if (stufe) {
      const badge = document.createElement('span');
      badge.className = `stufe-badge stufe-${stufe}`;
      badge.textContent = stufeLabels[stufe] || stufe;
      tdStufe.appendChild(badge);
    } else {
      tdStufe.innerHTML = '<span class="dim">—</span>';
    }

    // Spalte 3: Material
    const tdMat = document.createElement('td');
    tdMat.className = 'dim';
    tdMat.textContent = e.tags?.material || '—';

    // Spalte 4: Menge (mit Einheit)
    const tdMenge = document.createElement('td');
    tdMenge.className = 'num';
    if (cost && cost.menge != null) {
      tdMenge.innerHTML = `${fmtNum(cost.menge)}<span class="menge-einheit"> ${escHtml(cost.einheit)}</span>`;
    } else if (e.menge_auto) {
      tdMenge.innerHTML = `<span class="dim">${escHtml(e.menge_auto)}</span>`;
    } else {
      tdMenge.innerHTML = '<span class="dim">—</span>';
    }

    // Spalte 5: EP
    const tdEP = document.createElement('td');
    tdEP.className = 'num';
    if (cost) {
      tdEP.innerHTML = `${fmtNum(cost.ep)}<span class="menge-einheit"> €/${escHtml(cost.einheit)}</span>`;
    } else {
      tdEP.innerHTML = '<span class="dim">—</span>';
    }

    // Spalte 6: GB
    const tdGB = document.createElement('td');
    tdGB.className = 'num cost-cell';
    if (cost && cost.gb != null) {
      tdGB.innerHTML = `<strong>${fmtEur(cost.gb)}</strong>`;
      subtotal += cost.gb;
    } else if (cost) {
      tdGB.innerHTML = '<span class="dim">⊞ Mengen berechnen</span>';
    } else {
      tdGB.innerHTML = '<span class="dim">—</span>';
    }

    // Spalte 7: Zoom-Button
    const tdZoom = document.createElement('td');
    const zoomBtn = document.createElement('button');
    zoomBtn.className = 'btn-zoom-item';
    zoomBtn.title     = 'Selektieren';
    zoomBtn.textContent = '⌖';
    tdZoom.appendChild(zoomBtn);

    tr.appendChild(tdName);
    tr.appendChild(tdStufe);
    tr.appendChild(tdMat);
    tr.appendChild(tdMenge);
    tr.appendChild(tdEP);
    tr.appendChild(tdGB);
    tr.appendChild(tdZoom);

    tr.addEventListener('click', (ev) => {
      if (ev.target === zoomBtn) return;
      State.selectedIds = new Set([String(e.id)]);
      syncSelectionToSketchUp();
      updateSelectionBar();
      renderEntityList();
      renderTagEditor();
      scrollToEntity(String(e.id));
    });
    zoomBtn.addEventListener('click', () => {
      State.selectedIds = new Set([String(e.id)]);
      syncSelectionToSketchUp();
      ruby('zoomToSelection');
    });
    tbody.appendChild(tr);
  });

  // Summenzeile
  const sumTr = document.createElement('tr');
  sumTr.className = 'cost-sum-row';
  sumTr.innerHTML = `
    <td colspan="5" class="cost-sum-label">Summe (${items.length} Bauteil${items.length !== 1 ? 'e' : ''})</td>
    <td class="num cost-cell cost-sum-value">${subtotal > 0 ? fmtEur(subtotal) : '<span class="dim">—</span>'}</td>
    <td></td>
  `;
  tbody.appendChild(sumTr);
  tbl.appendChild(tbody);
  wrap.appendChild(tbl);
  return wrap;
}

// ---------------------------------------------------------------------------
// Filter-Logik
// ---------------------------------------------------------------------------
function getReportFilteredEntities() {
  if (!State.reportFilters) return State.entities;
  return State.entities.filter(e => {
    for (const [cat, excluded] of Object.entries(State.reportFilters)) {
      if (!excluded || !excluded.size) continue;
      const val = (e.tags && e.tags[cat]) || '—';
      if (excluded.has(val)) return false;
    }
    return true;
  });
}

function buildReportFilterSelects() {
  if (!State.reportFilters) State.reportFilters = {};
  const container = document.getElementById('reportFilters');
  if (!container) return;
  container.innerHTML = '';

  Object.entries(State.categories || {}).forEach(([cat, label]) => {
    const allVals = [...new Set(State.entities.map(e => (e.tags && e.tags[cat]) || '—'))].sort();
    if (allVals.length <= 1) return;

    const excluded = State.reportFilters[cat] || new Set();
    const active   = excluded.size > 0;

    const wrap = document.createElement('div');
    wrap.className = 'report-filter-wrap';

    const btn = document.createElement('button');
    btn.className   = `btn btn-sm report-filter-btn${active ? ' active' : ''}`;
    btn.textContent = active ? `${label} (${excluded.size}) ▾` : `${label} ▾`;

    const dropdown = document.createElement('div');
    dropdown.className     = 'report-filter-dropdown';
    dropdown.style.display = 'none';

    // Schnellaktionen: Alle an / Alle aus
    const quickRow = document.createElement('div');
    quickRow.className = 'filter-quick-row';

    const btnAll = document.createElement('button');
    btnAll.className   = 'btn btn-sm filter-quick-btn';
    btnAll.textContent = '✓ Alle';
    btnAll.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!State.reportFilters[cat]) State.reportFilters[cat] = new Set();
      State.reportFilters[cat].clear();
      dropdown.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = true);
      updateClearFilterBtn();
      renderReport();
    });

    const btnNone = document.createElement('button');
    btnNone.className   = 'btn btn-sm filter-quick-btn';
    btnNone.textContent = '✕ Keine';
    btnNone.addEventListener('click', (e) => {
      e.stopPropagation();
      State.reportFilters[cat] = new Set(allVals);
      dropdown.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);
      updateClearFilterBtn();
      renderReport();
    });

    quickRow.appendChild(btnAll);
    quickRow.appendChild(btnNone);
    dropdown.appendChild(quickRow);

    const divider = document.createElement('div');
    divider.className = 'filter-divider';
    dropdown.appendChild(divider);

    allVals.forEach(val => {
      const item = document.createElement('label');
      item.className = 'report-filter-item';
      const cb = document.createElement('input');
      cb.type    = 'checkbox';
      cb.checked = !excluded.has(val);
      cb.addEventListener('change', () => {
        if (!State.reportFilters[cat]) State.reportFilters[cat] = new Set();
        cb.checked ? State.reportFilters[cat].delete(val) : State.reportFilters[cat].add(val);
        updateClearFilterBtn();
        renderReport();
      });
      item.appendChild(cb);
      item.appendChild(document.createTextNode(' ' + val));
      dropdown.appendChild(item);
    });

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.report-filter-dropdown').forEach(d => {
        if (d !== dropdown) d.style.display = 'none';
      });
      dropdown.style.display = dropdown.style.display === 'none' ? '' : 'none';
    });

    wrap.appendChild(btn);
    wrap.appendChild(dropdown);
    container.appendChild(wrap);
  });

  // Klick außerhalb schließt alle Dropdowns
  document.onclick = (e) => {
    if (!e.target.closest('.report-filter-wrap')) {
      document.querySelectorAll('.report-filter-dropdown').forEach(d => d.style.display = 'none');
    }
  };

  updateClearFilterBtn();
}

function updateClearFilterBtn() {
  const btn = document.getElementById('btnClearReportFilter');
  if (!btn) return;
  const hasFilter = Object.values(State.reportFilters || {}).some(s => s && s.size > 0);
  btn.style.display = hasFilter ? '' : 'none';
}

// ---------------------------------------------------------------------------
// Kosten-Hilfsfunktionen
// ---------------------------------------------------------------------------
function getCostData(entity) {
  const tags    = entity.tags || {};
  const preisId = (tags.preis_id || '').trim();
  const preise  = State.library?.preise || [];

  let ep          = 0;
  let einheit     = (tags.einheit || '').trim();
  let bezeichnung = '';

  // Bibliotheks-Treffer per ID?
  const preisObj = preisId ? preise.find(p => String(p.id).trim() === preisId) : null;

  if (preisObj) {
    ep          = parseFloat(String(preisObj.ep).replace(',', '.')) || 0;
    einheit     = einheit || preisObj.einheit || '';
    bezeichnung = preisObj.bezeichnung || '';
  } else if (preisId) {
    // Kein Bibliotheks-Treffer → preis_id direkt als EP-Zahl interpretieren (manuell eingegeben)
    ep          = parseFloat(preisId.replace(',', '.')) || 0;
    bezeichnung = preisId;
  }

  // Letzter Fallback: einheitspreis-Tag
  if (ep <= 0) {
    ep = parseFloat((tags.einheitspreis || '').replace(',', '.')) || 0;
  }

  // Kein Preis → keine Kostendaten
  if (ep <= 0) return null;

  // Menge: manuell hat Vorrang, dann menge_auto
  const mengeStr  = (tags.menge || '').trim();
  const mengeAuto = (entity.menge_auto || '').trim();
  const menge     = mengeStr
    ? parseFloat(mengeStr.replace(',', '.'))
    : parseMengeAuto(mengeAuto);

  // Einheit aus menge_auto extrahieren wenn noch nicht gesetzt
  if (!einheit && mengeAuto) {
    const m = mengeAuto.match(/[^\d\s.,]+/);
    if (m) einheit = m[0];
  }

  // EP anzeigen auch ohne Menge (GB dann null)
  const gb = (menge && menge > 0) ? parseFloat((menge * ep).toFixed(2)) : null;

  return {
    bezeichnung,
    menge:  (menge && menge > 0) ? menge : null,
    einheit: einheit || '?',
    ep,
    gb,
  };
}

function parseMengeAuto(str) {
  const m = String(str).match(/[\d.,]+/);
  return m ? parseFloat(m[0].replace(',', '.')) : null;
}

function sumCosts(items) {
  return items.reduce((acc, e) => {
    const c = getCostData(e);
    return acc + (c ? c.gb : 0);
  }, 0);
}

function collectItems(node) {
  if (node.__items__) return node.__items__;
  return Object.values(node).flatMap(collectItems);
}

function fmtEur(v) {
  return parseFloat(v).toLocaleString('de-DE', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  }) + ' €';
}

function fmtNum(v) {
  return typeof v === 'number'
    ? v.toLocaleString('de-DE', { maximumFractionDigits: 3 })
    : String(v || '—');
}

// Konsolen-Debug-Hilfe
window.debugCosts = function() {
  console.log('Library preise:', State.library?.preise);
  State.entities.slice(0, 5).forEach(e => {
    console.log(e.name, '→ tags:', e.tags, '| menge_auto:', e.menge_auto, '| cost:', getCostData(e));
  });
};
