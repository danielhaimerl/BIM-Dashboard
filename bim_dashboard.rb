# =============================================================================
# BIM Dashboard – Loader
# Datei: bim_dashboard.rb
#
# Dies ist der einzige Entry Point den SketchUp kennt.
# Alle weiteren Dateien werden von hier aus geladen.
# =============================================================================

require 'sketchup'
require 'extensions'

module BimDashboard
  # __FILE__ ist die Loader-Datei im Plugins-Ordner.
  # Der eigentliche Plugin-Unterordner heißt 'bim_dashboard'.
  PLUGIN_DIR = File.join(File.dirname(__FILE__), 'bim_dashboard').freeze
  VERSION    = '1.0.0'.freeze
  PLUGIN_ID  = 'bim_dashboard'.freeze

  extension = SketchupExtension.new(
    'BIM Dashboard',
    File.join(PLUGIN_DIR, 'core', 'bootstrap')
  )
  extension.description = 'Bidirektionales BIM-Dashboard: Bauteilverwaltung, ' \
                          'Tag-Klassifikation und individualisierbare Reports.'
  extension.version     = VERSION
  extension.creator     = 'Dein Name'

  Sketchup.register_extension(extension, true)
end
