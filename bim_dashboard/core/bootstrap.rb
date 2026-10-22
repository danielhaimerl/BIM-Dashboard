# =============================================================================
# BIM Dashboard – Bootstrap
# Datei: core/bootstrap.rb
# =============================================================================

module BimDashboard

  CORE_DIR = File.join(PLUGIN_DIR, 'core').freeze
  UI_DIR   = File.join(PLUGIN_DIR, 'ui').freeze
  HTML_DIR = File.join(UI_DIR, 'html').freeze

  # Klassifikations-Tags
  TAG_CATEGORIES = {
    'gewerk'    => 'Gewerk',
    'din276'    => 'Kostengruppe',
    'material'  => 'Material',
    'stufe'     => 'Kostenstufe',
    'verortung' => 'Verortung',
    'preis_id'  => 'Preis (Bibliothek)',
  }.freeze

  # Kosten-Tags (nicht im Klassifikations-Editor, werden automatisch gesetzt)
  COST_TAGS = {
    'einheit'       => 'Mengeneinheit',
    'menge'         => 'Menge',
    'menge_auto'    => 'Menge (auto)',
    'einheitspreis' => 'Einheitspreis (€)',
    'preis_quelle'  => 'Preisquelle',
    'ref_stufe2'    => 'Referenz Stufe 2',
  }.freeze

  ALL_TAG_KEYS = (TAG_CATEGORIES.keys + COST_TAGS.keys).freeze

  EINHEITEN = %w[m² m³ m St Stück].freeze
  STUFEN    = ['01 - Kostenschätzung', '02 - Kostenberechnung Benchmark', '03 - Kostenberechnung Bauteile'].freeze

  KG_EINHEIT_DEFAULTS = {
    '310' => 'm³', '320' => 'm³',
    '330' => 'm²', '340' => 'm²', '350' => 'm²', '360' => 'm²',
    '370' => 'Stück',
    '410' => 'Stück', '420' => 'm', '430' => 'm', '440' => 'Stück',
    '510' => 'm²', '520' => 'm²', '530' => 'm²',
  }.freeze

  PROJECT_META_KEYS = %w[bgf bri gesamtkosten].freeze

  # Bauteilzuordnungen für automatisch ermittelte Kennzahlen.
  # key = Kennzahl, value = exakte Bauteilbezeichnung im Modell.
  # Aggregationsmethoden für Kennzahlen
  ELEMENT_AGGREGATIONS = [
    { 'value' => 'count',      'label' => 'Anzahl (Stück)' },
    { 'value' => 'menge_auto', 'label' => 'Menge Auto (m², m³, …)' },
  ].freeze

  # Standardzuordnungen: filter = Name oder Pfad-Segment, aggregation = count|menge_auto
  ELEMENT_MAPPING_DEFAULTS = {
    'wohnungen' => { 'filter' => 'Wohnungseingangstür',    'aggregation' => 'count',
                     'name' => 'Wohnungen', 'name_einzahl' => 'Wohnung' },
    'bgf'       => { 'filter' => 'BGF - Bruttogrundfläche','aggregation' => 'menge_auto' },
    'bri'       => { 'filter' => 'BRI - Bruttorauminhalt', 'aggregation' => 'menge_auto' },
  }.freeze

  ELEMENT_MAPPING_FIELDS = [
    { 'key' => 'wohnungen', 'label' => 'Wohnungen',
      'unit' => 'Stk',
      'hint' => 'Bezeichnung frei wählbar (Mehrzahl / Einzahl, z.B. "Stellplätze" / "Stellplatz"). Filter: Elementname oder Pfad (z.B. "Wohnungseingangstür")' },
    { 'key' => 'bgf', 'label' => 'BGF – Bruttogrundfläche',
      'unit' => 'm²',
      'hint' => 'Pfad-Filter möglich, z.B. "01 - Kostenschätzung/BGF - Bruttogrundfläche"' },
    { 'key' => 'bri', 'label' => 'BRI – Bruttorauminhalt',
      'unit' => 'm³',
      'hint' => 'Pfad-Filter möglich, z.B. "01 - Kostenschätzung/BRI - Bruttorauminhalt"' },
  ].freeze

  DICT_NAME    = 'BimDashboard'.freeze
  DICT_PROJECT = 'BimDashboard_Project'.freeze
  DICT_LIBRARY = 'BimDashboard_Library'.freeze

  load File.join(CORE_DIR, 'tag_manager.rb')
  load File.join(CORE_DIR, 'observer.rb')
  load File.join(CORE_DIR, 'isolate.rb')
  load File.join(CORE_DIR, 'quantity_calculator.rb')
  load File.join(CORE_DIR, 'library_manager.rb')
  load File.join(CORE_DIR, 'cost_manager.rb')
  load File.join(CORE_DIR, 'ai_agent.rb')
  load File.join(CORE_DIR, 'model_builder.rb')
  load File.join(CORE_DIR, 'outliner.rb')
  load File.join(UI_DIR,   'dialog.rb')
  load File.join(PLUGIN_DIR, 'menu.rb')

end
