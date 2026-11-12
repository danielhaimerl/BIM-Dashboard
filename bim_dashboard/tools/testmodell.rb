# =============================================================================
# BIM Dashboard – Testmodell
# Baut ein kleines Beispielmodell zum Prüfen von Bauteilliste und Mengen.
# Aufruf in der Ruby-Konsole (in einer neuen, leeren Datei):
#   load 'C:/Users/dahaimerl/AppData/Roaming/SketchUp/SketchUp 2024/SketchUp/Plugins/bim_dashboard/tools/testmodell.rb'
#
# Erwartete Bauteilliste / Mengen:
#   Außenwand Nord   Gruppe in "EG"            13,75 m²   (5,00 × 2,75)
#   Lauf             Untergruppe von "Treppe"   1,2 m³    (3,00 × 1,00 × 0,40)
#   Podest           Untergruppe von "Treppe"   1,44 m²   (1,20 × 1,20)
#   Fenster (3×)     Komponente in "EG"         je 1 Stück
#   Geländer         Gruppe in "EG", skaliert   4 m       (Linie 1 m × 4 gestreckt)
#   Bodenplatte      oberste Ebene, skaliert    20 m³     (Würfel 1 m auf 10 × 8 × 0,25)
#   "EG" und "Treppe" erscheinen NICHT (Gruppen mit Unterelementen).
# =============================================================================

module BimDashboard
  module Testmodell
    DICT = 'BimDashboard'

    def self.box(ents, w, d, h, x = 0, y = 0, z = 0)
      face = ents.add_face([x, y, z], [x + w, y, z], [x + w, y + d, z], [x, y + d, z])
      face.reverse! if face.normal.z < 0
      face.pushpull(h)
    end

    def self.tag(e, tags)
      tags.each { |k, v| e.set_attribute(DICT, k, v) }
    end

    def self.build
      model = Sketchup.active_model
      model.start_operation('BIM Testmodell', true)
      top = model.entities

      eg = top.add_group
      eg.name = 'EG'

      # Außenwand: 5,00 × 0,30 × 2,75 m, abgerechnet in m²
      wand = eg.entities.add_group
      wand.name = 'Außenwand Nord'
      box(wand.entities, 5.m, 0.3.m, 2.75.m)
      tag(wand, 'din276' => '331', 'gewerk' => 'Rohbau', 'einheit' => 'm²', 'stufe' => '3')

      # Treppe: Ordnergruppe mit zwei Unterelementen
      treppe = eg.entities.add_group
      treppe.name = 'Treppe'
      lauf = treppe.entities.add_group
      lauf.name = 'Lauf'
      box(lauf.entities, 3.m, 1.m, 0.4.m, 0, 2.m, 0)
      tag(lauf, 'din276' => '351', 'gewerk' => 'Rohbau', 'einheit' => 'm³', 'stufe' => '3')
      podest = treppe.entities.add_group
      podest.name = 'Podest'
      podest.entities.add_face([3.m, 2.m, 1.m], [4.2.m, 2.m, 1.m], [4.2.m, 3.2.m, 1.m], [3.m, 3.2.m, 1.m])
      tag(podest, 'din276' => '351', 'gewerk' => 'Rohbau', 'einheit' => 'm²', 'stufe' => '3')

      # Fenster: Komponente mit Rahmen und Glas, 3 Instanzen
      defn = model.definitions.add('Fenster 1,26x1,38')
      rahmen = defn.entities.add_group
      rahmen.name = 'Rahmen'
      box(rahmen.entities, 1.26.m, 0.08.m, 1.38.m)
      glas = defn.entities.add_group
      glas.name = 'Glas'
      glas.entities.add_face([0.1.m, 0.04.m, 0.1.m], [1.16.m, 0.04.m, 0.1.m], [1.16.m, 0.04.m, 1.28.m], [0.1.m, 0.04.m, 1.28.m])
      3.times do |i|
        inst = eg.entities.add_instance(defn, Geom::Transformation.new([i * 1.6.m, -1.m, 0.9.m]))
        inst.name = "Fenster #{i + 1}"
        tag(inst, 'din276' => '334', 'gewerk' => 'Fenster', 'einheit' => 'Stück', 'stufe' => '3')
      end

      # Geländer: Linien-Platzhalter 1 m mit Endmarkierungen, auf 4 m gestreckt
      gel = eg.entities.add_group
      gel.name = 'Geländer'
      gel.entities.add_line([0, 0, 0], [1.m, 0, 0])
      gel.entities.add_line([0, 0, -0.15.m], [0, 0, 0.15.m])
      gel.entities.add_line([1.m, 0, -0.15.m], [1.m, 0, 0.15.m])
      gel.transform!(Geom::Transformation.translation([0, 5.m, 1.m]))
      gel.transform!(Geom::Transformation.scaling(gel.bounds.min, 4, 1, 1))
      tag(gel, 'din276' => '359', 'gewerk' => 'Schlosser', 'einheit' => 'm', 'stufe' => '3')

      # Bodenplatte: Würfel 1 m auf oberster Ebene, skaliert auf 10 × 8 × 0,25 m
      bp = top.add_group
      bp.name = 'Bodenplatte'
      box(bp.entities, 1.m, 1.m, 1.m)
      bp.transform!(Geom::Transformation.translation([0, 0, -1.m]))
      bp.transform!(Geom::Transformation.scaling(bp.bounds.min, 10, 8, 0.25))
      tag(bp, 'din276' => '324', 'gewerk' => 'Rohbau', 'einheit' => 'm³', 'stufe' => '3')

      model.commit_operation
      puts '[BIM Testmodell] Fertig. Jetzt Dashboard öffnen und ⊞ Mengen klicken.'
    rescue => e
      model.abort_operation
      puts "[BIM Testmodell] Fehler: #{e.message}"
    end
  end
end

BimDashboard::Testmodell.build
