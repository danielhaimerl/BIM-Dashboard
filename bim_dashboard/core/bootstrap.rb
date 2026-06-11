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
    'gewerk'   => 'Gewerk',
    'din276'   => 'DIN 276 Kostengruppe',
    'material' => 'Material',
    'stufe'    => 'Detaillierungsstufe',
    'preis_id' => 'Preis (Bibliothek)',
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

  EINHEITEN = %w[m² m³ m Stück].freeze
  STUFEN    = %w[1 2 3].freeze

  KG_EINHEIT_DEFAULTS = {
    '310' => 'm³', '320' => 'm³',
    '330' => 'm²', '340' => 'm²', '350' => 'm²', '360' => 'm²',
    '370' => 'Stück',
    '410' => 'Stück', '420' => 'm', '430' => 'm', '440' => 'Stück',
    '510' => 'm²', '520' => 'm²', '530' => 'm²',
  }.freeze

  PROJECT_META_KEYS = %w[bgf bri gesamtkosten].freeze

  DICT_NAME    = 'BimDashboard'.freeze
  DICT_PROJECT = 'BimDashboard_Project'.freeze
  DICT_LIBRARY = 'BimDashboard_Library'.freeze

  require File.join(CORE_DIR, 'tag_manager')
  require File.join(CORE_DIR, 'observer')
  require File.join(CORE_DIR, 'isolate')
  require File.join(CORE_DIR, 'quantity_calculator')
  require File.join(CORE_DIR, 'library_manager')
  require File.join(CORE_DIR, 'cost_manager')
  require File.join(CORE_DIR, 'model_builder')
  require File.join(UI_DIR,   'dialog')
  require File.join(PLUGIN_DIR, 'menu')

end
