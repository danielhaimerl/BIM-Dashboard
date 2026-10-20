# =============================================================================
# BIM Dashboard – Isolate
# Datei: core/isolate.rb
#
# Blendet alles aus, was nicht selektiert ist – auch innerhalb verschachtelter
# Gruppen. Übergeordnete Gruppen der Selektion bleiben sichtbar, nur ihre
# übrigen Unterelemente werden ausgeblendet.
# Zwei Darstellungen (MODUS):
#   :glas       – Rest bekommt vorübergehend ein Glas-Material, auch auf
#                 händisch eingefärbten Flächen im Inneren
#   :ausblenden – Rest wird ausgeblendet und über die SketchUp-Ansicht
#                 "Ausgeblendete Objekte" blass angezeigt
# Speichert Originalzustand und stellt ihn vollständig wieder her.
# =============================================================================

module BimDashboard
  module Isolate

    MODUS     = :glas
    GLAS_NAME = 'BIM Isolieren Glas'

    @saved_visibility = {}   # { entity => true/false }
    @saved_material   = {}   # { entity => Material/nil }
    @saved_faces      = {}   # { face => [Material/nil, Rückseite/nil] }
    @saved_draw_hidden = nil # Ansichtsoption "Ausgeblendete Objekte" vorher
    @active           = false

    def self.active?
      @active
    end

    # Aktiviert: alles außer der Selektion ausblenden
    def self.enable(selected_ids)
      disable if @active   # zuerst sauber zurücksetzen falls schon aktiv

      model = Sketchup.active_model
      @saved_visibility = {}
      @saved_material   = {}
      @saved_faces      = {}
      @selected = selected_ids.to_a
      @contains = {}
      @painted  = {}

      model.start_operation('BIM Isolate', true)
      hide_rest(model.entities)
      if MODUS == :ausblenden
        opts = model.rendering_options
        @saved_draw_hidden = opts['DrawHiddenObjects']
        opts['DrawHiddenObjects'] = true
      end
      model.commit_operation

      @active = true
    end

    # Deaktiviert: alle Originalzustände wiederherstellen
    def self.disable
      return unless @active
      model = Sketchup.active_model

      model.start_operation('BIM Isolate aufheben', true)
      @saved_visibility.each { |e, orig| e.visible = orig if e.valid? }
      @saved_material.each { |e, orig| e.material = orig if e.valid? }
      @saved_faces.each do |f, (m, bm)|
        next unless f.valid?
        f.material = m
        f.back_material = bm
      end
      glas = model.materials[GLAS_NAME]
      model.materials.remove(glas) if glas
      model.rendering_options['DrawHiddenObjects'] = @saved_draw_hidden unless @saved_draw_hidden.nil?
      @saved_draw_hidden = nil
      model.commit_operation

      @saved_visibility = {}
      @saved_material   = {}
      @saved_faces      = {}
      @active           = false
    end

    # Selektion hat sich geändert: Sichtbarkeit neu berechnen
    def self.update(new_selected_ids)
      return unless @active
      enable(new_selected_ids)
    end

    private

    # Selektierte Bauteile bleiben unverändert, Gruppen mit selektiertem
    # Inhalt bleiben sichtbar und werden durchlaufen, alles andere wird Glas/ausgeblendet.
    def self.hide_rest(entities)
      entities.each do |e|
        next unless e.is_a?(Sketchup::Group) || e.is_a?(Sketchup::ComponentInstance)
        next if @selected.include?(e.entityID)
        if contains_selected?(e.definition)
          hide_rest(e.definition.entities)
        elsif MODUS == :glas
          glas_entity(e)
        else
          @saved_visibility[e] = e.visible? unless @saved_visibility.key?(e)
          e.visible = false
        end
      end
    end

    # Bauteil und alle Flächen darin vorübergehend auf Glas setzen.
    # Inhalte, die ein selektiertes Bauteil mitbenutzt (kopierte Komponenten),
    # bleiben unverändert, sonst würde die Auswahl ebenfalls zu Glas.
    def self.glas_entity(e)
      @saved_material[e] = e.material unless @saved_material.key?(e)
      e.material = glas_material
      d = e.definition
      return if @painted[d] || d.instances.any? { |i| @selected.include?(i.entityID) }
      @painted[d] = true
      d.entities.each do |c|
        if c.is_a?(Sketchup::Face)
          @saved_faces[c] = [c.material, c.back_material] unless @saved_faces.key?(c)
          c.material = glas_material
          c.back_material = glas_material
        elsif c.is_a?(Sketchup::Group) || c.is_a?(Sketchup::ComponentInstance)
          glas_entity(c)
        end
      end
    end

    def self.glas_material
      materials = Sketchup.active_model.materials
      mat = materials[GLAS_NAME]
      return mat if mat
      mat = materials.add(GLAS_NAME)
      mat.color = Sketchup::Color.new(200, 220, 235)
      mat.alpha = 0.15
      mat
    end

    def self.contains_selected?(definition)
      return @contains[definition] if @contains.key?(definition)
      @contains[definition] = false   # Schutz vor Endlosschleife
      @contains[definition] = definition.entities.any? do |e|
        (e.is_a?(Sketchup::Group) || e.is_a?(Sketchup::ComponentInstance)) &&
          (@selected.include?(e.entityID) || contains_selected?(e.definition))
      end
    end

  end
end
