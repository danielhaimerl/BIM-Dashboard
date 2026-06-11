# =============================================================================
# BIM Dashboard – Library Manager
# Datei: core/library_manager.rb
#
# Verwaltet alle Wertelisten (Dropdown-Listen) und die Preisbibliothek.
# Daten werden im globalen SketchUp-Attribut-Dictionary gespeichert
# (DICT_LIBRARY) – damit sind sie büroweit persistent wenn das Plugin
# als RBZ verteilt wird, aber unabhängig vom geöffneten Modell.
#
# Struktur der gespeicherten Daten (als JSON):
#   preise:       [{ id, bezeichnung, einheit, ep, beschreibung }, ...]
#   gewerke:      [{ id, bezeichnung }, ...]
#   kostengruppen:[{ id, kg, bezeichnung, einheit }, ...]
#   materialien:  [{ id, bezeichnung }, ...]
#   stufen:       [{ id, bezeichnung, beschreibung }, ...]
#
# Perspektivisch: Excel-Import/Export kann hier als neue Methoden
# load_from_xlsx / save_to_xlsx ergänzt werden ohne die Architektur
# zu ändern.
# =============================================================================

require 'json'

module BimDashboard
  module LibraryManager

    # Speicherort: Sketchup.active_model.attribute_dictionary(DICT_LIBRARY)
    # → Achtung: wird pro Modell gespeichert. Für büroweite Persistenz
    #   Daten zusätzlich in einer globalen Klassen-Variable halten
    #   und beim Modellwechsel neu laden.

    @data = nil  # Cache

    # ---------------------------------------------------------------------------
    # Standarddaten (werden beim ersten Start verwendet)
    # ---------------------------------------------------------------------------
    DEFAULTS = {
      'preise' => [
        { 'id' => 'p001', 'bezeichnung' => 'Bodenplatte Beton',     'einheit' => 'm²', 'ep' => 180.0, 'beschreibung' => 'KG 320' },
        { 'id' => 'p002', 'bezeichnung' => 'Außenwand Beton',        'einheit' => 'm²', 'ep' => 280.0, 'beschreibung' => 'KG 330' },
        { 'id' => 'p003', 'bezeichnung' => 'Außenwand Holzständer',  'einheit' => 'm²', 'ep' => 190.0, 'beschreibung' => 'KG 330' },
        { 'id' => 'p004', 'bezeichnung' => 'Fassade Glas/Fenster',   'einheit' => 'm²', 'ep' => 650.0, 'beschreibung' => 'KG 330' },
        { 'id' => 'p005', 'bezeichnung' => 'Innenwand Beton',        'einheit' => 'm²', 'ep' => 240.0, 'beschreibung' => 'KG 340' },
        { 'id' => 'p006', 'bezeichnung' => 'Innenwand Gipsständer',  'einheit' => 'm²', 'ep' => 120.0, 'beschreibung' => 'KG 340' },
        { 'id' => 'p007', 'bezeichnung' => 'Stahlbetondecke',        'einheit' => 'm²', 'ep' => 310.0, 'beschreibung' => 'KG 350' },
        { 'id' => 'p008', 'bezeichnung' => 'Flachdach Aufbau',       'einheit' => 'm²', 'ep' => 220.0, 'beschreibung' => 'KG 360' },
        { 'id' => 'p009', 'bezeichnung' => 'Stahlstütze HEA',        'einheit' => 'm',  'ep' => 380.0, 'beschreibung' => 'KG 330' },
        { 'id' => 'p010', 'bezeichnung' => 'Betonkern m³',           'einheit' => 'm³', 'ep' => 420.0, 'beschreibung' => 'KG 330' },
      ],
      'gewerke' => [
        { 'id' => 'g001', 'bezeichnung' => 'Rohbau' },
        { 'id' => 'g002', 'bezeichnung' => 'Holzbau' },
        { 'id' => 'g003', 'bezeichnung' => 'Fassade' },
        { 'id' => 'g004', 'bezeichnung' => 'Dach' },
        { 'id' => 'g005', 'bezeichnung' => 'Innenausbau' },
        { 'id' => 'g006', 'bezeichnung' => 'Heizung' },
        { 'id' => 'g007', 'bezeichnung' => 'Lüftung' },
        { 'id' => 'g008', 'bezeichnung' => 'Sanitär' },
        { 'id' => 'g009', 'bezeichnung' => 'Elektro' },
      ],
      'kostengruppen' => [
        { 'id' => 'k300', 'kg' => '300',  'bezeichnung' => 'Bauwerk – Baukonstruktion', 'einheit' => '' },
        { 'id' => 'k310', 'kg' => '310',  'bezeichnung' => 'Baugrube',                  'einheit' => 'm³' },
        { 'id' => 'k320', 'kg' => '320',  'bezeichnung' => 'Gründung',                  'einheit' => 'm²' },
        { 'id' => 'k330', 'kg' => '330',  'bezeichnung' => 'Außenwände',                'einheit' => 'm²' },
        { 'id' => 'k340', 'kg' => '340',  'bezeichnung' => 'Innenwände',                'einheit' => 'm²' },
        { 'id' => 'k350', 'kg' => '350',  'bezeichnung' => 'Decken',                    'einheit' => 'm²' },
        { 'id' => 'k360', 'kg' => '360',  'bezeichnung' => 'Dächer',                    'einheit' => 'm²' },
        { 'id' => 'k370', 'kg' => '370',  'bezeichnung' => 'Baukonstruktive Einbauten', 'einheit' => 'Stück' },
        { 'id' => 'k400', 'kg' => '400',  'bezeichnung' => 'Bauwerk – Technische Anlagen', 'einheit' => '' },
        { 'id' => 'k410', 'kg' => '410',  'bezeichnung' => 'Abwasser/Wasser/Gas',       'einheit' => 'm' },
        { 'id' => 'k420', 'kg' => '420',  'bezeichnung' => 'Wärmeversorgung',            'einheit' => 'Stück' },
        { 'id' => 'k430', 'kg' => '430',  'bezeichnung' => 'Raumlufttechnik',            'einheit' => 'm' },
        { 'id' => 'k440', 'kg' => '440',  'bezeichnung' => 'Elektro',                   'einheit' => 'm' },
        { 'id' => 'k500', 'kg' => '500',  'bezeichnung' => 'Außenanlagen',              'einheit' => 'm²' },
      ],
      'materialien' => [
        { 'id' => 'm001', 'bezeichnung' => 'Beton' },
        { 'id' => 'm002', 'bezeichnung' => 'Stahlbeton' },
        { 'id' => 'm003', 'bezeichnung' => 'Stahl' },
        { 'id' => 'm004', 'bezeichnung' => 'Holz' },
        { 'id' => 'm005', 'bezeichnung' => 'Glas' },
        { 'id' => 'm006', 'bezeichnung' => 'Mauerwerk' },
        { 'id' => 'm007', 'bezeichnung' => 'Gips' },
        { 'id' => 'm008', 'bezeichnung' => 'Aluminium' },
        { 'id' => 'm009', 'bezeichnung' => 'PVC' },
      ],
      'stufen' => [
        { 'id' => 's1', 'bezeichnung' => '1', 'beschreibung' => 'Stufe 1 – Kennwerte (BGF/BRI)' },
        { 'id' => 's2', 'bezeichnung' => '2', 'beschreibung' => 'Stufe 2 – Flächen (DIN 276)' },
        { 'id' => 's3', 'bezeichnung' => '3', 'beschreibung' => 'Stufe 3 – Bauteile (Geometrie)' },
      ],
    }.freeze

    # ---------------------------------------------------------------------------
    # Laden / Speichern
    # ---------------------------------------------------------------------------

    # Lädt Bibliothek aus globalem SketchUp-Attribut (modellunabhängig)
    # Fällt auf Defaults zurück wenn noch keine Daten vorhanden
    def self.load
      raw = Sketchup.active_model.get_attribute(DICT_LIBRARY, 'data')
      if raw && !raw.empty?
        @data = JSON.parse(raw)
      else
        @data = deep_dup(DEFAULTS)
        save   # Defaults einmalig persistieren
      end
      @data
    rescue => e
      puts "[BIM Library] Ladefehler: #{e.message} – nutze Defaults"
      @data = deep_dup(DEFAULTS)
      @data
    end

    # Speichert aktuelle Bibliothek im Modell
    def self.save
      ensure_loaded
      Sketchup.active_model.set_attribute(DICT_LIBRARY, 'data', @data.to_json)
    rescue => e
      puts "[BIM Library] Speicherfehler: #{e.message}"
    end

    # ---------------------------------------------------------------------------
    # Zugriff auf Listen
    # ---------------------------------------------------------------------------

    def self.preise
      ensure_loaded
      @data['preise'] || []
    end

    def self.gewerke
      ensure_loaded
      @data['gewerke'] || []
    end

    def self.kostengruppen
      ensure_loaded
      @data['kostengruppen'] || []
    end

    def self.materialien
      ensure_loaded
      @data['materialien'] || []
    end

    def self.stufen
      ensure_loaded
      @data['stufen'] || []
    end

    # Alle Listen als Hash für JS
    def self.all_as_hash
      {
        'preise'        => preise,
        'gewerke'       => gewerke,
        'kostengruppen' => kostengruppen,
        'materialien'   => materialien,
        'stufen'        => stufen,
      }
    end

    # Preis per ID nachschlagen
    def self.find_preis(preis_id)
      preise.find { |p| p['id'] == preis_id }
    end

    # ---------------------------------------------------------------------------
    # Schreiben (aus JS-Editor)
    # ---------------------------------------------------------------------------

    def self.update_list(list_name, items_json)
      ensure_loaded
      items = JSON.parse(items_json)
      # IDs für neue Einträge generieren
      prefix = list_name[0]  # 'p', 'g', 'k', 'm', 's'
      items.each_with_index do |item, i|
        if item['id'].to_s.empty?
          item['id'] = "#{prefix}#{(Time.now.to_i + i).to_s(36)}"
        end
      end
      @data[list_name] = items
      save
      items
    end

    # Einzelnen Eintrag löschen
    def self.delete_entry(list_name, id)
      ensure_loaded
      @data[list_name]&.reject! { |e| e['id'] == id }
      save
    end

    # ---------------------------------------------------------------------------
    # Perspektivisch: Excel-Import/Export (Platzhalter)
    # ---------------------------------------------------------------------------

    # def self.import_from_xlsx(path)
    #   # TODO: Iteration 2 – RubyXL oder eigener Parser
    #   raise NotImplementedError, 'Excel-Import noch nicht implementiert'
    # end

    # def self.export_to_xlsx(path)
    #   # TODO: Iteration 2
    #   raise NotImplementedError, 'Excel-Export noch nicht implementiert'
    # end

    # ---------------------------------------------------------------------------
    private
    # ---------------------------------------------------------------------------

    def self.ensure_loaded
      load if @data.nil?
    end

    def self.deep_dup(obj)
      JSON.parse(obj.to_json)
    end

  end
end
