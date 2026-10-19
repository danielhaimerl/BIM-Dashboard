# =============================================================================
# BIM Dashboard – Quantity Calculator
# Datei: core/quantity_calculator.rb
#
# Berechnet Mengen aus SketchUp-Geometrie.
# WICHTIG: Berücksichtigt Transformationen (Skalierung, Rotation).
# SketchUp speichert skalierte Gruppen mit Transformationsmatrix —
# face.area gibt untransformierte Werte zurück, muss mit Skala multipliziert werden.
# =============================================================================

module BimDashboard
  module QuantityCalculator

    INCH_TO_M   = 0.0254
    INCH2_TO_M2 = INCH_TO_M ** 2
    INCH3_TO_M3 = INCH_TO_M ** 3

    # -------------------------------------------------------------------------
    # Hauptmethode
    # -------------------------------------------------------------------------
    def self.calculate(entity)
      case entity
      when Sketchup::Group, Sketchup::ComponentInstance
        calculate_group(entity, entity.transformation)
      when Sketchup::Face
        { value: to_m2(entity.area), unit: 'm²', method: 'area', reliable: true }
      when Sketchup::Edge
        { value: to_m(entity.length), unit: 'm', method: 'length', reliable: true }
      else
        fallback
      end
    end

    def self.calculate_and_store_batch(entities)
      model = Sketchup.active_model
      model.start_operation('BIM Mengen berechnen', true)
      results = []
      puts "[BIM Mengen] Berechne #{entities.size} Entities..."
      begin
        entities.each do |e|
          result = calculate(e)

          # Einheit aus Tag hat Vorrang
          tag_einheit = e.get_attribute(DICT_NAME, 'einheit').to_s.strip
          result = result.merge(unit: tag_einheit) if tag_einheit != ''

          menge_str = "#{format_value(result[:value])} #{result[:unit]}"
          e.set_attribute(DICT_NAME, 'menge_auto', menge_str)

          unless e.get_attribute(DICT_NAME, 'einheit').to_s.strip != ''
            e.set_attribute(DICT_NAME, 'einheit', result[:unit])
          end

          puts "[BIM Mengen] '#{e.respond_to?(:name) ? e.name : e.class}': #{menge_str} (#{result[:method]})"
          results << { id: e.entityID, result: result }
        end
        model.commit_operation
        puts "[BIM Mengen] Fertig. #{results.size} Entities berechnet."
      rescue => err
        model.abort_operation
        raise err
      end
      results
    end

    private

    # -------------------------------------------------------------------------
    # Gruppe mit Transformation berechnen
    # -------------------------------------------------------------------------
    def self.calculate_group(group, transform)
      tag_einheit = group.get_attribute(DICT_NAME, 'einheit').to_s.strip
      entities = group.is_a?(Sketchup::Group) ? group.entities : group.definition.entities
      calculate_group_entities(entities, transform, tag_einheit)
    end

    def self.calculate_group_entities(entities, transform, hint_einheit = '')
      # Skalierungsfaktoren aus Transformation extrahieren
      sx = transform.xaxis.length   # Skalierung X-Achse
      sy = transform.yaxis.length   # Skalierung Y-Achse
      sz = transform.zaxis.length   # Skalierung Z-Achse

      faces = entities.grep(Sketchup::Face)
      edges = entities.grep(Sketchup::Edge)

      # --- Stück: immer 1 pro Bauteil ---
      if hint_einheit =~ /\ASt/i
        return { value: 1.0, unit: hint_einheit, method: 'count', reliable: true }
      end

      # --- m Länge: längste Ausdehnung (Endmarkierungen etc. zählen nicht mit) ---
      if hint_einheit == 'm'
        length = extents_of(entities, sx, sy, sz).max
        return { value: to_m(length), unit: 'm', method: 'extent', reliable: true } if length > 0
      end

      # --- m³ Volumen ---
      if hint_einheit == 'm³' || hint_einheit == 'm3' || hint_einheit == ''
        if solid_entities?(entities)
          vol = volume_of_entities(entities, sx, sy, sz)
          if vol && vol > 0
            return { value: to_m3(vol), unit: 'm³', method: 'volume', reliable: true }
          end
          # Fallback Bounding Box Volumen (bei skalierten Würfeln sehr genau)
          b = bounding_box_of(entities, sx, sy, sz)
          if b > 0 && hint_einheit == 'm³'
            return { value: to_m3(b), unit: 'm³', method: 'bbox_volume', reliable: true }
          end
        end
      end

      # --- m² Fläche ---
      if faces.any?
        # face.area ist in Zoll² ohne Transformation
        # Bei skalierter Gruppe: mit sx*sy multiplizieren
        # Für eine planare Fläche (z.B. BGF-Fläche) ist das korrekt
        area = faces.sum do |f|
          # Normale bestimmt welche Achsen die Fläche aufspannen
          n = f.normal
          if n.z.abs > 0.9       # horizontale Fläche (XY-Ebene)
            f.area * sx * sy
          elsif n.y.abs > 0.9    # vertikale Fläche (XZ-Ebene)
            f.area * sx * sz
          elsif n.x.abs > 0.9    # vertikale Fläche (YZ-Ebene)
            f.area * sy * sz
          else
            # Schräge Fläche: allgemeine Skalierung
            f.area * Math.sqrt((sx*sy)**2 + (sy*sz)**2 + (sx*sz)**2) / Math.sqrt(3)
          end
        end
        # Bei Solid: nur äußere Flächen (Hülle) → Gesamtfläche / 2
        # Bei einzelner Fläche: direkt verwenden
        if solid_entities?(entities) && hint_einheit != 'm²'
          # Das ist ein Solid → Volumen bevorzugen (bereits oben behandelt)
          # Wenn wir hier ankommen: Volumen nicht berechnet, Fläche als Fallback
          area = area / 2.0  # Näherung äußere Hülle
        end
        return { value: to_m2(area), unit: 'm²', method: 'area', reliable: true } if area > 0
      end

      # --- m Länge ---
      if edges.any? && faces.empty?
        length = edges.sum { |e| e.length * sx }
        return { value: to_m(length), unit: 'm', method: 'length', reliable: true } if length > 0
      end

      fallback
    end

    # -------------------------------------------------------------------------
    # Solid-Erkennung
    # -------------------------------------------------------------------------
    def self.solid_entities?(entities)
      faces = entities.grep(Sketchup::Face)
      return false if faces.empty?
      faces.all? { |f| f.edges.all? { |e| e.faces.length == 2 } }
    rescue
      false
    end

    # -------------------------------------------------------------------------
    # Volumen via Divergenz-Theorem (korrekt für skalierte Geometrie)
    # -------------------------------------------------------------------------
    def self.volume_of_entities(entities, sx, sy, sz)
      vol = 0.0
      entities.grep(Sketchup::Face).each do |face|
        mesh = face.mesh
        (1..mesh.count_polygons).each do |i|
          pts = mesh.polygon_points_at(i)
          next unless pts.length >= 3
          # Punkte mit Skalierung transformieren
          p0 = [pts[0].x * sx, pts[0].y * sy, pts[0].z * sz]
          p1 = [pts[1].x * sx, pts[1].y * sy, pts[1].z * sz]
          p2 = [pts[2].x * sx, pts[2].y * sy, pts[2].z * sz]
          # Signed Tetraeder-Volumen
          vol += p0[0] * (p1[1] * p2[2] - p1[2] * p2[1]) +
                 p0[1] * (p1[2] * p2[0] - p1[0] * p2[2]) +
                 p0[2] * (p1[0] * p2[1] - p1[1] * p2[0])
        end
      end
      (vol / 6.0).abs
    rescue
      nil
    end

    # -------------------------------------------------------------------------
    # Bounding Box Volumen (skaliert)
    # -------------------------------------------------------------------------
    def self.bounding_box_of(entities, sx, sy, sz)
      extents_of(entities, sx, sy, sz).reduce(:*)
    end

    # Skalierte Ausdehnung [dx, dy, dz] über alle Kanten-Endpunkte
    def self.extents_of(entities, sx, sy, sz)
      pts = entities.grep(Sketchup::Edge).flat_map { |e| e.vertices.map(&:position) }
      return [0, 0, 0] if pts.empty?
      [
        (pts.map(&:x).max - pts.map(&:x).min) * sx,
        (pts.map(&:y).max - pts.map(&:y).min) * sy,
        (pts.map(&:z).max - pts.map(&:z).min) * sz,
      ]
    rescue
      [0, 0, 0]
    end

    # -------------------------------------------------------------------------
    # Einheiten-Konvertierung
    # -------------------------------------------------------------------------
    def self.to_m(inches)
      (inches * INCH_TO_M).round(3)
    end

    def self.to_m2(inches2)
      (inches2 * INCH2_TO_M2).round(3)
    end

    def self.to_m3(inches3)
      (inches3 * INCH3_TO_M3).round(4)
    end

    def self.format_value(v)
      v == v.to_i ? v.to_i.to_s : ('%.3f' % v).sub(/\.?0+$/, '')
    end

    def self.fallback
      { value: 1.0, unit: 'Stück', method: 'count', reliable: false }
    end

  end
end
