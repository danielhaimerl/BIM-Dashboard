// =============================================================================
// BIM Dashboard – report.js
// =============================================================================

'use strict';

// Tag-Wert zur Anzeige auflösen
// din276: voller Text direkt im Tag ("330 Außenwände") → kein Lookup nötig
// Fallback: für alte Daten die nur die Nummer haben, Bibliothek durchsuchen
function resolveLabel(catKey, rawVal) {
  if (!rawVal || rawVal === '—') return rawVal;
  if (catKey.startsWith('din276')) {
    const lib = State.library || {};
    const kg = (lib.kostengruppen || []).find(k => k.kg === rawVal);
    if (kg) return kg.kg; // enthält bereits den vollen Text
    // Alte Daten: nur Nummer gespeichert → Präfix-Suche
    const byPrefix = (lib.kostengruppen || []).find(k => k.kg.startsWith(rawVal + ' ') || k.kg.startsWith(rawVal + '-'));
    if (byPrefix) return byPrefix.kg;
    // Nicht in der Bibliothek → Bezeichnung aus einem Bauteil-Tag mit derselben Nummer
    const tagged = (State.entities || []).map(e => e.tags && e.tags.din276).find(t => t && t.startsWith(rawVal + ' '));
    if (tagged) return tagged;
  }
  return rawVal;
}

// Überspringt Unterebenen, die dieselbe KG-Nummer wie die Elterngruppe tragen
// (z. B. Bauteil direkt mit "320 Gründung" getaggt → keine eigene 3. Ebene)
function kgCode(label) {
  const m = String(label).match(/^\s*(\d{3})/);
  return m ? m[1] : null;
}

function skipSameKg(node, depth, parentLabel) {
  const code = kgCode(parentLabel);
  while (code && !node.__items__) {
    const keys = Object.keys(node);
    if (keys.length !== 1 || kgCode(keys[0]) !== code) break;
    node = node[keys[0]];
    depth++;
  }
  return { node, depth };
}

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
  buildOutlineButtons(activeGroups.length);

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
  container.appendChild(buildSection(grouped, activeGroups, 0, totalCost));
  applyOutlineLevel();

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
// Ebenen-Buttons 1, 2, 3 … (wie Gliederung in Excel)
// Stufe n zeigt die Gruppen bis Ebene n; die letzte Stufe zeigt auch die Bauteile.
// ---------------------------------------------------------------------------
function buildOutlineButtons(groupCount) {
  const wrap = document.getElementById('outlineButtons');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!groupCount) return;
  if (State.outlineLevel > groupCount + 1) State.outlineLevel = null;
  for (let n = 1; n <= groupCount + 1; n++) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm outline-btn';
    btn.textContent = n;
    btn.title = n <= groupCount ? `Bis Ebene ${n} anzeigen` : 'Alles mit Bauteilen anzeigen';
    if (n === (State.outlineLevel || groupCount + 1)) btn.classList.add('active');
    btn.addEventListener('click', () => {
      State.outlineLevel = n;
      wrap.querySelectorAll('.outline-btn').forEach(b => b.classList.toggle('active', b === btn));
      applyOutlineLevel();
    });
    wrap.appendChild(btn);
  }
}

function applyOutlineLevel() {
  const level = State.outlineLevel;
  if (!level) return; // Standard: alles aufgeklappt
  document.querySelectorAll('#reportContainer .report-section').forEach(sec => {
    const open   = Number(sec.dataset.depth) < level - 1;
    const body   = sec.querySelector(':scope > .report-section-body');
    const toggle = sec.querySelector(':scope > .report-section-header .report-toggle');
    if (body)   body.style.display = open ? '' : 'none';
    if (toggle) toggle.textContent = open ? '▾' : '▸';
  });
}

// ---------------------------------------------------------------------------
// Gesamt-Header
// ---------------------------------------------------------------------------
function buildTotalHeader(total, count) {
  const hdr = document.createElement('div');
  hdr.className = 'cost-report-header';
  const bgf = State.bgfTotal || 0;
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
function buildSection(node, groupKeys, depth, parentTotal) {
  const frag = document.createDocumentFragment();

  if (node.__items__) {
    frag.appendChild(buildDetailTable(node.__items__));
    return frag;
  }

  const catKey   = groupKeys[depth];
  const catLabel = groupLabel(catKey);

  Object.entries(node).forEach(([label, children]) => {
    const items    = collectItems(children);
    const count    = items.length;
    const subtotal = sumCosts(items);
    const displayLabel = resolveLabel(catKey, label);
    const anteil   = parentTotal > 0 ? Math.round(subtotal / parentTotal * 100) : 0;

    const section = document.createElement('div');
    section.className = `report-section depth-${depth}`;
    section.dataset.depth = depth;

    const hdr = document.createElement('div');
    hdr.className = 'report-section-header';
    hdr.innerHTML = `
      <span class="report-toggle">▾</span>
      <span class="report-cat-label">${escHtml(catLabel)}:</span>
      <span class="report-group-label">${escHtml(displayLabel)}</span>
      <span class="badge">${count}</span>
      <span class="report-spacer"></span>
      <span class="pct-bar-wrap header-pct"><span class="pct-bar" style="width:${anteil * 0.6}%"></span><span>${anteil} %</span></span>
      <span class="hdr-cols">
        <span class="cost-section-menge">${fmtGroupMenge(items)}</span>
        <span class="cost-section-bgf">${fmtBgf(subtotal)}</span>
        <span class="cost-section-total">${subtotal > 0 ? fmtEur(subtotal) : '<span class="dim">—</span>'}</span>
        <span class="report-select-hint" title="In SketchUp selektieren">⌖</span>
      </span>
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

    const sub = skipSameKg(children, depth + 1, label);
    body.appendChild(buildSection(sub.node, groupKeys, sub.depth, subtotal));

    section.appendChild(hdr);
    section.appendChild(body);
    frag.appendChild(section);
  });

  return frag;
}

// ---------------------------------------------------------------------------
// Detail-Tabelle (mit Namens-Gruppierung)
// ---------------------------------------------------------------------------
function buildDetailTable(items) {
  const wrap = document.createElement('div');
  wrap.className = 'report-agg-wrapper';
  const tbl = document.createElement('table');
  tbl.className = 'report-table';
  // Die letzten Spalten haben feste Breiten, passend zu .hdr-cols in den Gruppen-Kopfzeilen
  tbl.innerHTML = `<colgroup>
    <col style="width:35%">
    <col>
    <col>
    <col style="width:120px">
    <col style="width:120px">
    <col style="width:130px">
    <col style="width:24px">
  </colgroup>`;

  const thead = tbl.createTHead();
  const hRow  = thead.insertRow();
  ['Name', 'Stufe', 'Material', 'Menge', 'EP (€)', 'GB (€)', ''].forEach((label, i) => {
    const th = document.createElement('th');
    th.textContent = label;
    th.dataset.col = i;
    if (i >= 3 && i <= 5) th.className = 'num';
    hRow.appendChild(th);
  });

  const tbody       = document.createElement('tbody');
  let   subtotal    = 0;
  const stufeLabels = {
    '1': '01 - Kostenprognose', '2': '02 - Kostenschätzung', '3': '03 - Kostenberechnung',
    '01 - Kostenprognose':  '01 - Kostenprognose',
    '02 - Kostenschätzung': '02 - Kostenschätzung',
    '03 - Kostenberechnung':'03 - Kostenberechnung',
  };

  // Bauteile nach Name gruppieren (Reihenfolge erhalten)
  const nameGroups = new Map();
  items.forEach(e => {
    const key = e.name || '—';
    if (!nameGroups.has(key)) nameGroups.set(key, []);
    nameGroups.get(key).push(e);
  });

  nameGroups.forEach((groupItems, name) => {
    const isGroup = groupItems.length > 1;

    // Aggregierte Kosten/Mengen berechnen
    let totalGB    = 0;
    let totalMenge = 0;
    let einheit    = '';
    let ep         = null;
    let mengeOk    = true;

    // Mengen unabhängig von Preis direkt aus menge_auto aufsummieren
    let totalMengeAuto = 0;
    let einheitAuto    = '';
    let mengeAutoOk    = true;

    groupItems.forEach(e => {
      // Kosten
      const cost = getCostData(e);
      if (cost) {
        totalGB += cost.gb || 0;
        if (ep === null) ep = cost.ep;
        if (!einheit) einheit = cost.einheit;
        if (cost.menge != null && cost.einheit === einheit) {
          totalMenge += cost.menge;
        } else {
          mengeOk = false;
        }
      } else {
        mengeOk = false;
      }

      // Menge aus menge_auto (kein Preis erforderlich)
      const autoStr = (e.menge_auto || '').trim();
      const autoVal = parseMengeAuto(autoStr);
      const autoUnit = autoStr.replace(/^[\d.,\s]+/, '').trim();
      if (autoVal && autoVal > 0) {
        if (!einheitAuto) einheitAuto = autoUnit;
        if (autoUnit === einheitAuto) {
          totalMengeAuto += autoVal;
        } else {
          mengeAutoOk = false;
        }
      } else {
        mengeAutoOk = false;
      }
    });
    subtotal += totalGB;

    // ── Aggregat-Zeile ──────────────────────────────────────────────────────
    const tr = document.createElement('tr');
    tr.className = 'report-group-row';

    // Name + Expand-Button
    const tdName = document.createElement('td');
    tdName.className = 'report-item-name';
    if (isGroup) {
      const expandBtn = document.createElement('button');
      expandBtn.className   = 'btn-expand-group';
      expandBtn.textContent = '+';
      expandBtn.title       = `${groupItems.length} Elemente aufklappen`;
      tdName.appendChild(expandBtn);
    }
    const nameTxt = document.createElement('span');
    nameTxt.textContent = name;
    tdName.appendChild(nameTxt);
    if (isGroup) {
      const badge = document.createElement('span');
      badge.className   = 'badge badge-count';
      badge.textContent = groupItems.length;
      tdName.appendChild(badge);
    }

    // Stufe (wenn alle gleich → anzeigen)
    const tdStufe = document.createElement('td');
    const stufen  = [...new Set(groupItems.map(e => e.tags?.stufe || ''))];
    if (stufen.length === 1 && stufen[0]) {
      const b = document.createElement('span');
      b.className   = `stufe-badge stufe-${stufen[0]}`;
      b.textContent = stufeLabels[stufen[0]] || stufen[0];
      tdStufe.appendChild(b);
    } else {
      tdStufe.innerHTML = '<span class="dim">—</span>';
    }

    // Material
    const tdMat  = document.createElement('td');
    tdMat.className = 'dim';
    const mats   = [...new Set(groupItems.map(e => e.tags?.material || '').filter(Boolean))];
    tdMat.textContent = mats.length === 1 ? mats[0] : (mats.length > 1 ? '(gem.)' : '—');

    // Menge
    const tdMenge = document.createElement('td');
    tdMenge.className = 'num';
    if (mengeOk && totalMenge > 0 && einheit) {
      // Aus Kostendaten (Preis vorhanden)
      tdMenge.innerHTML = `${fmtNum(totalMenge)}<span class="menge-einheit"> ${escHtml(einheit)}</span>`;
    } else if (mengeAutoOk && totalMengeAuto > 0 && einheitAuto) {
      // Aus menge_auto (funktioniert auch ohne Preis)
      tdMenge.innerHTML = `${fmtNum(totalMengeAuto)}<span class="menge-einheit"> ${escHtml(einheitAuto)}</span>`;
    } else if (!isGroup && groupItems[0]?.menge_auto) {
      tdMenge.innerHTML = `<span class="dim">${escHtml(fmtMenge(groupItems[0].menge_auto))}</span>`;
    } else {
      tdMenge.innerHTML = '<span class="dim">—</span>';
    }

    // EP
    const tdEP = document.createElement('td');
    tdEP.className = 'num';
    if (ep != null && ep > 0) {
      tdEP.innerHTML = `${fmtNum(ep)}<span class="menge-einheit"> €/${escHtml(einheit || '?')}</span>`;
    } else {
      tdEP.innerHTML = '<span class="dim">—</span>';
    }

    // GB
    const tdGB = document.createElement('td');
    tdGB.className = 'num cost-cell';
    tdGB.innerHTML = totalGB > 0
      ? `<strong>${fmtEur(totalGB)}</strong>`
      : '<span class="dim">—</span>';

    // Zoom
    const tdZoom  = document.createElement('td');
    const zoomBtn = document.createElement('button');
    zoomBtn.className   = 'btn-zoom-item';
    zoomBtn.title       = 'Selektieren';
    zoomBtn.textContent = '⌖';
    tdZoom.appendChild(zoomBtn);

    tr.append(tdName, tdStufe, tdMat, tdMenge, tdEP, tdGB, tdZoom);

    tr.addEventListener('click', (ev) => {
      if (ev.target.closest('.btn-expand-group') || ev.target === zoomBtn) return;
      State.selectedIds = new Set(groupItems.map(e => String(e.id)));
      syncSelectionToSketchUp();
      updateSelectionBar();
      renderEntityList();
      renderTagEditor();
      if (groupItems.length === 1) scrollToEntity(String(groupItems[0].id));
    });
    zoomBtn.addEventListener('click', () => {
      State.selectedIds = new Set(groupItems.map(e => String(e.id)));
      syncSelectionToSketchUp();
      ruby('zoomToSelection');
    });

    tbody.appendChild(tr);

    // ── Detail-Zeilen (nur bei Gruppe, initial versteckt) ───────────────────
    if (isGroup) {
      const detailRows = groupItems.map(e => {
        const cost = getCostData(e);
        const dtr  = document.createElement('tr');
        dtr.className    = 'report-detail-row';
        dtr.style.display = 'none';

        const stufe = e.tags?.stufe || '';

        const dtdName = document.createElement('td');
        dtdName.className   = 'report-item-name report-detail-indent';
        dtdName.textContent = e.name;

        const dtdStufe = document.createElement('td');
        if (stufe) {
          const b = document.createElement('span');
          b.className   = `stufe-badge stufe-${stufe}`;
          b.textContent = stufeLabels[stufe] || stufe;
          dtdStufe.appendChild(b);
        } else {
          dtdStufe.innerHTML = '<span class="dim">—</span>';
        }

        const dtdMat = document.createElement('td');
        dtdMat.className   = 'dim';
        dtdMat.textContent = e.tags?.material || '—';

        const dtdMenge = document.createElement('td');
        dtdMenge.className = 'num';
        if (cost?.menge != null) {
          dtdMenge.innerHTML = `${fmtNum(cost.menge)}<span class="menge-einheit"> ${escHtml(cost.einheit)}</span>`;
        } else if (e.menge_auto) {
          dtdMenge.innerHTML = `<span class="dim">${escHtml(fmtMenge(e.menge_auto))}</span>`;
        } else {
          dtdMenge.innerHTML = '<span class="dim">—</span>';
        }

        const dtdEP = document.createElement('td');
        dtdEP.className = 'num';
        dtdEP.innerHTML = (cost?.ep > 0)
          ? `${fmtNum(cost.ep)}<span class="menge-einheit"> €/${escHtml(cost.einheit)}</span>`
          : '<span class="dim">—</span>';

        const dtdGB = document.createElement('td');
        dtdGB.className = 'num cost-cell';
        dtdGB.innerHTML = (cost?.gb > 0) ? fmtEur(cost.gb) : '<span class="dim">—</span>';

        const dtdZoom  = document.createElement('td');
        const dzoomBtn = document.createElement('button');
        dzoomBtn.className   = 'btn-zoom-item';
        dzoomBtn.title       = 'Selektieren';
        dzoomBtn.textContent = '⌖';
        dtdZoom.appendChild(dzoomBtn);

        dtr.append(dtdName, dtdStufe, dtdMat, dtdMenge, dtdEP, dtdGB, dtdZoom);

        dtr.addEventListener('click', (ev) => {
          if (ev.target === dzoomBtn) return;
          State.selectedIds = new Set([String(e.id)]);
          syncSelectionToSketchUp();
          updateSelectionBar();
          renderEntityList();
          renderTagEditor();
          scrollToEntity(String(e.id));
        });
        dzoomBtn.addEventListener('click', () => {
          State.selectedIds = new Set([String(e.id)]);
          syncSelectionToSketchUp();
          ruby('zoomToSelection');
        });

        tbody.appendChild(dtr);
        return dtr;
      });

      // Expand-Button verdrahten
      tr.querySelector('.btn-expand-group').addEventListener('click', (ev) => {
        ev.stopPropagation();
        const open = detailRows[0].style.display !== 'none';
        detailRows.forEach(dr => dr.style.display = open ? 'none' : '');
        ev.currentTarget.textContent = open ? '+' : '−';
        ev.currentTarget.classList.toggle('expanded', !open);
      });
    }
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

// Mengensumme einer Gruppe – nur wenn alle Bauteile eine Menge in derselben Einheit haben
function fmtGroupMenge(items) {
  let sum = 0, unit = null;
  for (const e of items) {
    const cost = getCostData(e);
    let menge, einheit;
    if (cost && cost.menge != null) {
      menge = cost.menge; einheit = cost.einheit;
    } else {
      const autoStr = (e.menge_auto || '').trim();
      menge   = parseMengeAuto(autoStr);
      einheit = autoStr.replace(/^[\d.,\s]+/, '').trim();
    }
    if (!(menge > 0) || !einheit || einheit === '?') return '';
    if (unit === null) unit = einheit;
    if (einheit !== unit) return '';
    sum += menge;
  }
  return unit ? `${fmtNum(sum)} ${escHtml(unit)}` : '';
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

// Benchmark: Kosten je m² BGF (leer, wenn keine BGF oder keine Kosten)
function fmtBgf(cost) {
  const bgf = State.bgfTotal || 0;
  if (!(bgf > 0 && cost > 0)) return '';
  return Math.round(cost / bgf).toLocaleString('de-DE') + ' €/m² BGF';
}

function fmtNum(v) {
  return typeof v === 'number'
    ? v.toLocaleString('de-DE', { maximumFractionDigits: 2 })
    : String(v || '—');
}

// ---------------------------------------------------------------------------
// Excel-Export
// ---------------------------------------------------------------------------

// Wird von rubyBridge.onReportExported aufgerufen
if (!window.rubyBridge) window.rubyBridge = {};
window.rubyBridge.onReportExported = function({ success, path }) {
  if (success) showToast('✓ Excel gespeichert: ' + path);
};

function exportReportExcel() {
  const activeGroups = (State.groupBy || []).filter(Boolean);
  const entities     = getReportFilteredEntities();
  if (!entities.length) { showToast('Keine Daten zum Export'); return; }

  const rows    = [];
  const total   = sumCosts(entities);
  const project = document.getElementById('projectName')?.textContent || '';
  const date    = new Date().toLocaleDateString('de-DE');

  rows.push({ type: 'total', depth: 0, label: `Gesamt (${entities.length} Bauteile)`, cost: total });

  if (activeGroups.length) {
    const grouped = groupEntities(entities, activeGroups);
    collectExportSections(grouped, activeGroups, 0, rows);
  } else {
    collectExportDetails(entities, 0, rows);
  }

  ruby('exportExcelFile', { rows, project, date, filename: 'BIM_Auswertung.xlsx' });
}

function exportReportCSVStructured() {
  const activeGroups = (State.groupBy || []).filter(Boolean);
  const entities     = getReportFilteredEntities();
  if (!entities.length) { showToast('Keine Daten zum Export'); return; }

  const rows = [];
  const totalCost = sumCosts(entities);
  const project   = document.getElementById('projectName')?.textContent || '';
  const date      = new Date().toLocaleDateString('de-DE');

  rows.push({ type: 'total', depth: 0, label: `Gesamt (${entities.length} Bauteile)`, cost: totalCost });

  if (activeGroups.length) {
    const grouped = groupEntities(entities, activeGroups);
    collectExportSections(grouped, activeGroups, 0, rows);
  } else {
    collectExportDetails(entities, 0, rows);
  }

  // CSV aufbauen (Semikolon-getrennt für Excel DE)
  const lines = [];
  lines.push(`BIM Auswertung;${project};Erstellt: ${date}`);
  lines.push('');
  lines.push('Bezeichnung;Kostenstufe;Material;Menge;Einheit;EP (€);GB (€)');

  rows.forEach(r => {
    const indent = '  '.repeat(r.depth || 0);
    const fmtN = v => v != null ? String(v).replace('.', ',') : '';
    switch (r.type) {
      case 'total':
        lines.push(`${r.label};;;;;;${fmtN(r.cost > 0 ? r.cost.toFixed(2) : '')}`);
        break;
      case 'section':
        lines.push(`${indent}${r.label} (${r.count} Bauteile);;;;;;${fmtN(r.cost > 0 ? r.cost.toFixed(2) : '')}`);
        break;
      case 'group': {
        const suffix = r.count > 1 ? ` (${r.count}×)` : '';
        const menge  = r.menge != null ? fmtN(parseFloat(r.menge).toFixed(3)) : '';
        lines.push([
          `${indent}${r.name}${suffix}`,
          r.stufe || '',
          r.material || '',
          menge,
          r.einheit || '',
          r.ep  ? fmtN(parseFloat(r.ep).toFixed(2))  : '',
          r.gb  ? fmtN(parseFloat(r.gb).toFixed(2))  : '',
        ].join(';'));
        break;
      }
      case 'detail': {
        const menge = r.menge != null ? fmtN(parseFloat(r.menge).toFixed(3)) : '';
        lines.push([
          `${indent}${r.name}`,
          r.stufe || '',
          r.material || '',
          menge,
          r.einheit || '',
          r.ep ? fmtN(parseFloat(r.ep).toFixed(2)) : '',
          r.gb ? fmtN(parseFloat(r.gb).toFixed(2)) : '',
        ].join(';'));
        break;
      }
      case 'subtotal':
        lines.push(`${indent}${r.label};;;;;;${fmtN(r.cost > 0 ? r.cost.toFixed(2) : '')}`);
        break;
    }
  });

  ruby('exportCSVFile', { csv: lines.join('\r\n'), filename: 'BIM_Auswertung.csv' });
}

function collectExportSections(node, groupKeys, depth, rows) {
  if (node.__items__) {
    collectExportDetails(node.__items__, depth, rows);
    return;
  }
  const catKey   = groupKeys[depth];
  const catLabel = groupLabel(catKey);

  Object.entries(node).forEach(([label, children]) => {
    const items        = collectItems(children);
    const cost         = sumCosts(items);
    const displayLabel = resolveLabel(catKey, label);
    rows.push({ type: 'section', depth, label: `${catLabel}: ${displayLabel}`, count: items.length, cost });
    const sub = skipSameKg(children, depth + 1, label);
    collectExportSections(sub.node, groupKeys, sub.depth, rows);
  });
}

function collectExportDetails(items, depth, rows) {
  // Gleiche Namensgruppierung wie in buildDetailTable
  const nameGroups = new Map();
  items.forEach(e => {
    const key = e.name || '—';
    if (!nameGroups.has(key)) nameGroups.set(key, []);
    nameGroups.get(key).push(e);
  });

  let subtotal = 0;

  nameGroups.forEach((groupItems, name) => {
    let totalGB = 0, totalMenge = 0, einheit = '', ep = null;
    let totalMengeAuto = 0, einheitAuto = '', mengeAutoOk = true;

    groupItems.forEach(e => {
      const cost = getCostData(e);
      if (cost) {
        totalGB += cost.gb || 0;
        if (ep === null) ep = cost.ep;
        if (!einheit) einheit = cost.einheit;
        if (cost.menge != null) totalMenge += cost.menge;
      }
      const autoStr  = (e.menge_auto || '').trim();
      const autoVal  = parseMengeAuto(autoStr);
      const autoUnit = autoStr.replace(/^[\d.,\s]+/, '').trim();
      if (autoVal && autoVal > 0) {
        if (!einheitAuto) einheitAuto = autoUnit;
        if (autoUnit === einheitAuto) totalMengeAuto += autoVal;
        else mengeAutoOk = false;
      } else { mengeAutoOk = false; }
    });
    subtotal += totalGB;

    const mengeVal  = totalMenge  > 0 ? totalMenge  : (mengeAutoOk && totalMengeAuto > 0 ? totalMengeAuto : null);
    const einheitVal = totalMenge > 0 ? einheit      : einheitAuto;
    const stufen    = [...new Set(groupItems.map(e => e.tags?.stufe || '').filter(Boolean))];
    const mats      = [...new Set(groupItems.map(e => e.tags?.material || '').filter(Boolean))];

    rows.push({
      type:     'group',
      depth,
      name,
      count:    groupItems.length,
      stufe:    stufen.length === 1 ? stufen[0] : (stufen.length > 1 ? '(gem.)' : ''),
      material: mats.length   === 1 ? mats[0]   : (mats.length   > 1 ? '(gem.)' : ''),
      menge:    mengeVal,
      einheit:  einheitVal || '',
      ep:       ep || null,
      gb:       totalGB || null,
    });

    if (groupItems.length > 1) {
      groupItems.forEach(e => {
        const cost    = getCostData(e);
        const autoStr = (e.menge_auto || '').trim();
        const autoVal = parseMengeAuto(autoStr);
        const autoUnit = autoStr.replace(/^[\d.,\s]+/, '').trim();
        rows.push({
          type:     'detail',
          depth:    depth + 1,
          name:     e.name || '—',
          stufe:    e.tags?.stufe    || '',
          material: e.tags?.material || '',
          menge:    cost?.menge || (autoVal > 0 ? autoVal : null),
          einheit:  cost?.einheit || autoUnit || '',
          ep:       cost?.ep  || null,
          gb:       cost?.gb  || null,
        });
      });
    }
  });

  if (subtotal > 0) {
    rows.push({ type: 'subtotal', depth, label: `Summe (${items.length} Bauteil${items.length !== 1 ? 'e' : ''})`, cost: subtotal });
  }
}

// Konsolen-Debug-Hilfe
window.debugCosts = function() {
  console.log('Library preise:', State.library?.preise);
  State.entities.slice(0, 5).forEach(e => {
    console.log(e.name, '→ tags:', e.tags, '| menge_auto:', e.menge_auto, '| cost:', getCostData(e));
  });
};
