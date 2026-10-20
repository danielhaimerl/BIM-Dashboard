# =============================================================================
# BIM Dashboard – Isolate
# Datei: core/isolate.rb
#
# Versteckt nicht-selektierte Entities via entity.visible = false.
# Zuverlässiger als Transparenz-Material (funktioniert mit allen Rendermodes).
# Speichert Originalzustand und stellt ihn vollständig wieder her.
# =============================================================================

module BimDashboard
  module Isolate

    @saved_visibility = {}   # { entity_id (Integer) => true/false }
    @active           = false

    def self.active?
      @active
    end

    # Aktiviert: alle nicht-selektierten Top-Level-Entities ausblenden
    def self.enable(selected_ids)
      disable if @active   # zuerst sauber zurücksetzen falls schon aktiv

      model = Sketchup.active_model
      @saved_visibility = {}

      model.start_operation('BIM Isolate', true)
      all_top_level(model).each do |e|
        @saved_visibility[e.entityID] = e.visible?
        e.visible = selected_ids.include?(e.entityID)
      end
      model.commit_operation

      @active = true
    end

    # Deaktiviert: alle Originalzustände wiederherstellen
    def self.disable
      return unless @active
      model = Sketchup.active_model

      model.start_operation('BIM Isolate aufheben', true)
      all_top_level(model).each do |e|
        orig = @saved_visibility[e.entityID]
        e.visible = orig.nil? ? true : orig
      end
      model.commit_operation

      @saved_visibility = {}
      @active           = false
    end

    # Selektion hat sich geändert: Sichtbarkeit neu berechnen
    def self.update(new_selected_ids)
      return unless @active
      model = Sketchup.active_model

      model.start_operation('BIM Isolate aktualisieren', true)
      all_top_level(model).each do |e|
        # Originalmaterial für neue Entities merken
        @saved_visibility[e.entityID] = e.visible? unless @saved_visibility.key?(e.entityID)
        e.visible = new_selected_ids.include?(e.entityID)
      end
      model.commit_operation
    end

    private

    def self.all_top_level(model)
      model.entities.select do |e|
        e.is_a?(Sketchup::Group) || e.is_a?(Sketchup::ComponentInstance)
      end
    end

  end
end
