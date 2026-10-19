// =============================================================================
// BIM Dashboard – costs.js
// Kosten-Report und Mengenberechnung
// =============================================================================

'use strict';

State.costReport = null;

// ---------------------------------------------------------------------------
// RUBY BRIDGE
// ---------------------------------------------------------------------------
Object.assign(window.rubyBridge, {

  onCostTagsLoaded(tags) {
    // Nicht mehr benötigt – Kosten laufen über Tag-Editor
  },

  onConstantsLoaded(constants) {
    State.constants = constants || {};
  },

  onQuantitiesCalculated({ count, unreliable }) {
    let msg = `⊞ Mengen für ${count} Bauteil(e) berechnet`;
    if (unreliable > 0) msg += ` · ${unreliable} Fallback auf Stück`;
    showToast(msg);
    // Bauteilliste neu laden damit menge_auto sichtbar wird
    ruby('refreshModel');
  },

  onCostReportLoaded(report) {
    // Banner-Update
    if (report && report.total > 0) {
      const fmt = v => v.toLocaleString('de-DE', {minimumFractionDigits:0,maximumFractionDigits:0}) + ' €';
      document.getElementById('metaGesamtkosten').textContent = fmt(report.total);
    }
  },

});

// ---------------------------------------------------------------------------
// INIT
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  bindCostControls();
  initResizeHandles();
});

function bindCostControls() {
  document.getElementById('btnCalcQty')?.addEventListener('click', () => {
    // Immer alle Entities berechnen (null = alle)
    ruby('calculateQuantities', null);
    showToast('Mengen werden berechnet…');
  });
}

function bindReportModeControl() {
  // Kein Modus-Button mehr – Kosten sind direkt in die Auswertung integriert
}

// ---------------------------------------------------------------------------
// KOSTEN-REPORT
// ---------------------------------------------------------------------------
function renderCostReport(report) {
  const container = document.getElementById('reportContainer');
  container.innerHTML = '';

  if (!report || (!report.total && !Object.keys(report.by_kg || {}).length)) {
    container.innerHTML = `
      <div class="cost-onboarding">
        <p>Noch keine Kostendaten vorhanden.</p>
        <ol>
          <li>Preise in der <strong>Bibliothek</strong> anlegen</li>
          <li>Bauteile klassifizieren: Preis aus Dropdown wählen</li>
          <li><strong>⊞ Mengen</strong> berechnen lassen</li>
          <li>Hier auf <strong>Kosten</strong> umschalten</li>
        </ol>
      </div>`;
    return;
  }

  const fmtEur = v => v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  const fmtNum = v => typeof v === 'number'
    ? v.toLocaleString('de-DE', { maximumFractionDigits: 2 })
    : (v || '—');

  // --- Gesamt-Header ---
  const bgf = parseFloat(document.getElementById('metaBGF')?.textContent) || 0;
  const hdr = document.createElement('div');
  hdr.className = 'cost-report-header';
  hdr.innerHTML = `
    <div class="cost-report-kpi">
      <span>Gesamtkosten</span>
      <strong>${fmtEur(report.total)}</strong>
    </div>
    ${bgf > 0 ? `<div class="cost-report-kpi">
      <span>Kosten/m² BGF</span>
      <strong>${Math.round(report.total / bgf).toLocaleString('de-DE')} €/m²</strong>
    </div>` : ''}
  `;
  container.appendChild(hdr);

  // --- Pro KG ---
  Object.entries(report.by_kg || {})
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([kg, data]) => {
      const pct = report.total > 0 ? (data.subtotal / report.total * 100).toFixed(1) : 0;

      const section = document.createElement('div');
      section.className = 'report-section depth-0';

      const sHdr = document.createElement('div');
      sHdr.className = 'report-section-header';
      sHdr.innerHTML = `
        <span class="report-toggle">▾</span>
        <span class="report-cat-label">KG</span>
        <span class="report-group-label">${escHtml(kg)}</span>
        <span class="badge">${data.items.length}</span>
        <span class="cost-section-pct">${pct} %</span>
        <span class="cost-section-total">${fmtEur(data.subtotal)}</span>
      `;

      const body = document.createElement('div');
      body.className = 'report-section-body';

      // Tabelle der Positionen
      const tbl = document.createElement('table');
      tbl.className = 'report-table';
      tbl.innerHTML = `
        <thead><tr>
          <th>Name</th>
          <th>Stufe</th>
          <th>Preis-Pos.</th>
          <th class="num">Menge</th>
          <th>Einh.</th>
          <th class="num">EP (€)</th>
          <th class="num">GB (€)</th>
          <th style="width:24px"></th>
        </tr></thead>`;

      const tbody = document.createElement('tbody');
      data.items.forEach(item => {
        const tr = document.createElement('tr');
        tr.className = State.selectedIds.has(String(item.id)) ? 'selected' : '';
        tr.innerHTML = `
          <td class="report-item-name">${escHtml(item.name)}</td>
          <td><span class="stufe-badge stufe-${item.stufe || ''}">${item.stufe || '—'}</span></td>
          <td class="dim">${escHtml(item.bezeichnung || '—')}</td>
          <td class="num">${fmtNum(item.menge)}</td>
          <td class="dim">${escHtml(item.einheit || '—')}</td>
          <td class="num">${fmtNum(item.einheitspreis)}</td>
          <td class="num cost-cell">${fmtEur(item.gesamt)}</td>
          <td><button class="btn-zoom-item" title="Selektieren &amp; zoomen">⌖</button></td>
        `;
        // Klick → selektieren
        tr.addEventListener('click', (e) => {
          if (e.target.classList.contains('btn-zoom-item')) return;
          State.selectedIds = new Set([String(item.id)]);
          syncSelectionToSketchUp();
          updateSelectionBar();
          renderEntityList();
          renderTagEditor();
          scrollToEntity(String(item.id));
        });
        tr.querySelector('.btn-zoom-item').addEventListener('click', () => {
          State.selectedIds = new Set([String(item.id)]);
          syncSelectionToSketchUp();
          ruby('zoomToSelection');
        });
        tbody.appendChild(tr);
      });

      // Summenzeile pro KG
      const sumTr = document.createElement('tr');
      sumTr.className = 'cost-sum-row';
      sumTr.innerHTML = `
        <td colspan="6" class="cost-sum-label">Summe KG ${escHtml(kg)}</td>
        <td class="num cost-cell cost-sum-value">${fmtEur(data.subtotal)}</td>
        <td></td>
      `;
      tbody.appendChild(sumTr);

      tbl.appendChild(tbody);
      body.appendChild(tbl);

      // Toggle-Logik
      const toggle = sHdr.querySelector('.report-toggle');
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const closed = body.style.display === 'none';
        body.style.display = closed ? '' : 'none';
        toggle.textContent = closed ? '▾' : '▸';
      });
      // Klick auf Header → Gruppe selektieren
      sHdr.addEventListener('click', () => {
        const ids = data.items.map(i => String(i.id));
        State.selectedIds = new Set(ids);
        syncSelectionToSketchUp();
        updateSelectionBar();
        renderEntityList();
        showToast(`${ids.length} Bauteil(e) selektiert`);
      });

      section.appendChild(sHdr);
      section.appendChild(body);
      container.appendChild(section);
    });

  // --- Warnungen ---
  const warns = [];
  if (report.unpriced?.length)   warns.push(`${report.unpriced.length} Bauteil(e) ohne Preis-Zuweisung`);
  if (report.no_quantity?.length) warns.push(`${report.no_quantity.length} Bauteil(e) ohne Menge – ⊞ Mengen berechnen`);
  if (warns.length) {
    const w = document.createElement('div');
    w.className = 'cost-warnings';
    warns.forEach(msg => {
      const row = document.createElement('div');
      row.className = 'cost-warn-row';
      row.textContent = '⚠ ' + msg;
      w.appendChild(row);
    });
    container.appendChild(w);
  }
}

// ---------------------------------------------------------------------------
// RESIZE HANDLES – Spaltenbreiten per Drag anpassbar
// ---------------------------------------------------------------------------
function initResizeHandles() {
  document.querySelectorAll('.resize-handle').forEach(handle => {
    let startX, leftW, leftPanel, rightPanel;

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      leftPanel  = handle.previousElementSibling;
      rightPanel = handle.nextElementSibling;
      if (!leftPanel || !rightPanel) return;

      startX = e.clientX;
      leftW  = leftPanel.getBoundingClientRect().width;

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
      handle.classList.add('dragging');
      document.body.style.cursor     = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    function onMove(e) {
      const newLeft = Math.max(160, leftW + (e.clientX - startX));
      leftPanel.style.flex  = `0 0 ${newLeft}px`;
      leftPanel.style.width = `${newLeft}px`;
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      handle.classList.remove('dragging');
      document.body.style.cursor     = '';
      document.body.style.userSelect = '';
    }
  });
}
