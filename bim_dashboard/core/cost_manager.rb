# =============================================================================
# BIM Dashboard – Cost Manager
# Datei: core/cost_manager.rb
#
# Berechnet Kosten pro Entity auf Basis von:
#   preis_id → Nachschlag in LibraryManager.preise
#   menge    → manuell oder menge_auto
#   einheit  → aus Preis-Bibliothek oder manuell
# =============================================================================

module BimDashboard
  module CostManager

    # Kosten einer einzelnen Entity berechnen
    # Gibt nil zurück wenn kein Preis oder keine Menge vorhanden
    def self.cost_for(entity)
      preis_id = entity.get_attribute(DICT_NAME, 'preis_id').to_s
      menge_str = entity.get_attribute(DICT_NAME, 'menge').to_s
      menge_auto_str = entity.get_attribute(DICT_NAME, 'menge_auto').to_s

      # Preis aus Bibliothek
      preis = LibraryManager.find_preis(preis_id)
      return nil unless preis

      ep      = preis['ep'].to_f
      einheit = preis['einheit'].to_s

      # Menge: manuell hat Vorrang
      menge = if !menge_str.empty?
        menge_str.gsub(',', '.').to_f
      else
        parse_menge(menge_auto_str)
      end

      return nil unless menge && menge > 0

      {
        preis_id:       preis_id,
        bezeichnung:    preis['bezeichnung'].to_s,
        menge:          menge,
        einheit:        einheit,
        einheitspreis:  ep,
        gesamt:         (menge * ep).round(2),
      }
    end

    # Kosten-Report für alle Entities
    def self.cost_report
      entities   = TagManager.collect_all_entities.map(&:first)
      total      = 0.0
      by_kg      = {}
      unpriced   = []
      no_quantity = []

      entities.each do |e|
        cost  = cost_for(e)
        name  = entity_name(e)
        kg    = e.get_attribute(DICT_NAME, 'din276').to_s
        mat   = e.get_attribute(DICT_NAME, 'material').to_s
        stufe = e.get_attribute(DICT_NAME, 'stufe').to_s

        if cost.nil?
          preis_id = e.get_attribute(DICT_NAME, 'preis_id').to_s
          menge_auto = e.get_attribute(DICT_NAME, 'menge_auto').to_s
          if preis_id.empty?
            unpriced << { id: e.entityID, name: name, kg: kg }
          elsif menge_auto.empty? && e.get_attribute(DICT_NAME, 'menge').to_s.empty?
            no_quantity << { id: e.entityID, name: name, kg: kg }
          end
          next
        end

        total += cost[:gesamt]
        kg_key = kg.empty? ? '—' : kg

        by_kg[kg_key] ||= { items: [], subtotal: 0.0 }
        by_kg[kg_key][:items] << {
          id:            e.entityID,
          name:          name,
          stufe:         stufe,
          material:      mat,
          bezeichnung:   cost[:bezeichnung],
          menge:         cost[:menge],
          einheit:       cost[:einheit],
          einheitspreis: cost[:einheitspreis],
          gesamt:        cost[:gesamt],
        }
        by_kg[kg_key][:subtotal] += cost[:gesamt]
      end

      {
        total:       total.round(2),
        by_kg:       by_kg,
        unpriced:    unpriced,
        no_quantity: no_quantity,
      }
    end

    private

    def self.parse_menge(str)
      m = str.to_s.match(/[\d.,]+/)
      m ? m[0].gsub(',', '.').to_f : nil
    end

    def self.entity_name(entity)
      case entity
      when Sketchup::Group
        entity.name.empty? ? "Gruppe ##{entity.entityID}" : entity.name
      when Sketchup::ComponentInstance
        entity.name.empty? ? entity.definition.name : entity.name
      else
        "#{entity.class.to_s.split('::').last} ##{entity.entityID}"
      end
    end

  end
end
