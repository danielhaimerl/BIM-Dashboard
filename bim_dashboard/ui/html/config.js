// =============================================================================
// BIM Dashboard – Konfiguration (Bauteilzuordnungen)
// Datei: ui/html/config.js
// =============================================================================
'use strict';

// Statische Metadaten: fest im JS definiert, kein Roundtrip zu Ruby nötig
var CONFIG_AGGS = [
  { value: 'count',      label: 'Anzahl' },
  { value: 'menge_auto', label: 'Menge Auto' },
];

var CONFIG_UNITS = {
  wohnungen: 'Stk',
  bgf:       'm²',
  bri:       'm³',
};

// Defensive init
if (typeof State !== 'undefined') {
  State.elementMappingFields = State.elementMappingFields || [];
  State.elementMapping       = State.elementMapping       || {};
}

if (typeof window.rubyBridge !== 'undefined') {
  Object.assign(window.rubyBridge, {
    onElementMappingLoaded(data) {
      State.elementMappingFields = (data && data.fields)  || [];
      State.elementMapping       = (data && data.mapping) || {};
      renderConfig();
      if (typeof updateEntityCount === 'function') updateEntityCount();
      if (typeof updateAutoMetrics === 'function') updateAutoMetrics();
      if (typeof updateCostBanner  === 'function') updateCostBanner();
    },
    onElementMappingSaved(_data) {},
  });
}

// ---------------------------------------------------------------------------
// RENDER
// ---------------------------------------------------------------------------
function renderConfig() {
  const container = document.getElementById('configContainer');
  if (!container) return;

  const fields = State.elementMappingFields;
  const aggs   = CONFIG_AGGS;
  const map    = State.elementMapping || {};

  if (!fields.length) {
    container.innerHTML = '<p class="placeholder">Lade Konfiguration…</p>';
    return;
  }

  // Tabelle ohne verschachtelte Template-Literals aufbauen
  let html = '<div class="config-hint-global">'
    + 'Filter: Elementname (z.B. <em>Wohnungseingangstür</em>) oder Pfad mit Schrägstrich'
    + ' (z.B. <em>01 - Kostenschätzung/BGF - Bruttogrundfläche</em>).'
    + '</div>';

  html += '<table class="config-table"><thead><tr>'
    + '<th>Kennzahl</th><th>Filter (Name oder Pfad)</th>'
    + '<th>Aggregation</th><th>Einheit</th><th>Aktuell</th>'
    + '</tr></thead><tbody>';

  for (let i = 0; i < fields.length; i++) {
    const f   = fields[i];
    const cfg = map[f.key] || {};

    // Aggregations-Toggle (Button-Gruppe statt native Select)
    let toggleBtns = '';
    for (let j = 0; j < aggs.length; j++) {
      const a      = aggs[j];
      const active = (cfg.aggregation === a.value) ? ' agg-active' : '';
      toggleBtns += '<button type="button" class="agg-btn' + active + '" data-agg="'
                  + escHtml(a.value) + '">' + escHtml(a.label) + '</button>';
    }

    html += '<tr class="config-tr" data-key="' + escHtml(f.key) + '">';
    if (f.key === 'wohnungen') {
      // Bezugsgröße frei benennbar (z.B. Stellplätze)
      html += '<td class="config-td-label">'
            +   '<input type="text" class="config-input cfg-name"'
            +   ' value="' + escHtml(cfg.name || 'Wohnungen') + '" placeholder="z.B. Stellplätze" />'
            + '</td>';
    } else {
      html += '<td class="config-td-label">' + escHtml(f.label) + '</td>';
    }
    html +=   '<td><input type="text" class="config-input cfg-filter"'
            +   ' value="' + escHtml(cfg.filter || '') + '"'
            +   ' placeholder="Elementname oder Pfad/Name" /></td>';
    html +=   '<td><div class="agg-toggle">' + toggleBtns + '</div></td>';
    html +=   '<td class="config-td-unit">' + escHtml(CONFIG_UNITS[f.key] || f.unit || '') + '</td>';
    html +=   '<td class="config-td-current" id="cfgCurrent_' + escHtml(f.key) + '">'
            +   formatMetric(f.key) + '</td>';
    html += '</tr>';
    html += '<tr class="config-tr-hint">'
          +   '<td colspan="5" class="config-hint-cell">' + escHtml(f.hint || '') + '</td>'
          + '</tr>';
  }

  html += '</tbody></table>';
  container.innerHTML = html;
}

function formatMetric(key) {
  if (typeof getMetricValue !== 'function') return '—';
  const v = getMetricValue(key);
  if (!v) return '—';
  return v.toLocaleString('de-DE', { maximumFractionDigits: 1 });
}

function updateConfigCurrentValues() {
  State.elementMappingFields.forEach(f => {
    const el = document.getElementById(`cfgCurrent_${f.key}`);
    if (el) el.textContent = formatMetric(f.key);
  });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// BIND
// ---------------------------------------------------------------------------
function bindConfig() {
  // Toggle-Buttons: Klick aktiviert den angeklickten, deaktiviert den anderen
  document.getElementById('configContainer')?.addEventListener('click', function(e) {
    const btn = e.target.closest('.agg-btn');
    if (!btn) return;
    const toggle = btn.closest('.agg-toggle');
    if (!toggle) return;
    toggle.querySelectorAll('.agg-btn').forEach(function(b) { b.classList.remove('agg-active'); });
    btn.classList.add('agg-active');
  });

  document.getElementById('btnConfigSave')?.addEventListener('click', () => {
    const mapping = {};
    document.querySelectorAll('#configContainer .config-tr[data-key]').forEach(row => {
      const key    = row.dataset.key;
      const active = row.querySelector('.agg-btn.agg-active');
      mapping[key] = {
        filter:      (row.querySelector('.cfg-filter')?.value || '').trim(),
        aggregation: active ? active.dataset.agg : 'count',
      };
      const nameEl = row.querySelector('.cfg-name');
      if (nameEl) mapping[key].name = nameEl.value.trim();
    });
    State.elementMapping = mapping;
    ruby('saveElementMapping', mapping);
    if (typeof updateEntityCount === 'function') updateEntityCount();
    if (typeof updateAutoMetrics === 'function') updateAutoMetrics();
    if (typeof updateCostBanner  === 'function') updateCostBanner();
    updateConfigCurrentValues();
  });
}

document.addEventListener('DOMContentLoaded', bindConfig);
