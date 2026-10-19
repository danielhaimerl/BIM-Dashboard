# =============================================================================
# BIM Dashboard – Quantity Calculator
# Datei: core/quantity_calculator.rb
#
# Berechnet Mengen aus SketchUp-Geometrie.
# WICHTIG: Transformationsmatrix wird vollständig angewendet (nicht nur Skalierung).
# face.area gibt untransformierte Werte zurück → Vertices transformieren und
# dann Fläche/Volumen aus den Weltkoordinaten berechnen.
# =============================================================================

module BimDashboard
  module QuantityCalculator

    INCH_TO_M   = 0.0254
    INCH2_TO_M2 = INCH_TO_M ** 2
    INCH3_TO_M3 = INCH_TO_M ** 3

    # -------------------------------------------------------------------------
    # Hauptmethode
    # -------------------------------------------------------------------------
    def self.calculate(entity, world_transform = nil)
      hint = entity.get_attribute(DICT_NAME, 'einheit').to_s.strip
      # Welt-Transformation: akkumuliert alle Eltern-Skalierungen/-Rotationen.
      # Korrekt für beliebige Verschachtelungstiefe (z.B. Blatt in 3 Container-Gruppen).
      wt = world_transform || (entity.respond_to?(:transformation) ? entity.transformation : Geom::Transformation.new)

      case entity
      when Sketchup::Group
        calculate_group_entities(entity.entities, wt, hint)
      when Sketchup::ComponentInstance
        calculate_group_entities(entity.definition.entities, wt, hint)
      when Sketchup::Face
        { value: to_m2(entity.area), unit: 'm²', method: 'area', reliable: true }
      when Sketchup::Edge
        { value: to_m(entity.length), unit: 'm', method: 'length', reliable: true }
      else
        fallback
      end
    end

    # Akzeptiert entweder reine Entity-Objekte oder 3-Tupel [entity, path, world_transform]
    # aus TagManager.collect_all_entities (empfohlen, da world_transform Eltern-Skalierungen enthält).
    def self.calculate_and_store_batch(items)
      model = Sketchup.active_model
      model.start_operation('BIM Mengen berechnen', true)
      results = []
      puts "[BIM Mengen] Berechne #{items.size} Entities..."
      begin
        items.each do |item|
          e, world_t = item.is_a?(Array) ? [item[0], item[2]] : [item, nil]

          result = calculate(e, world_t)

          tag_einheit = e.get_attribute(DICT_NAME, 'einheit').to_s.strip
          if tag_einheit == 'Stück' || tag_einheit == 'St'
            result = { value: 1, unit: tag_einheit, method: 'count', reliable: true }
          elsif tag_einheit != '' && result[:unit] != tag_einheit
            result = result.merge(unit: tag_einheit)
          end

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
    # Gruppe/Komponente mit Transformation berechnen
    # -------------------------------------------------------------------------
    def self.calculate_group_entities(entities, transform, hint_einheit = '')
      faces = entities.grep(Sketchup::Face)
      edges = entities.grep(Sketchup::Edge)

      # --- m Länge (nur Kanten, keine Faces) ---
      # MUSS vor dem faces.empty?-Frühausstieg stehen, damit Linien-Platzhalter
      # nicht als Fallback 1 Stück zurückgeben.
      # Bounding-Box statt Kantensumme: Querstriche/Endmarker werden so ignoriert.
      if edges.any? && faces.empty?
        all_verts = edges.flat_map { |e| [e.start, e.end] }
        len = bounding_box_longest_axis(all_verts, transform)
        return { value: to_m(len), unit: 'm', method: 'bbox_length', reliable: true } if len > 0
      end

      # Keine direkten Faces → Sub-Gruppen durchsuchen
      if faces.empty?
        result = calculate_nested(entities, transform, hint_einheit)
        return result if result
        return fallback
      end

      # --- m³ Volumen ---
      wants_volume = hint_einheit == 'm³' || hint_einheit == 'm3' || hint_einheit == ''
      if wants_volume && solid_entities?(faces)
        vol = volume_of_faces(faces, transform)
        if vol && vol > 0
          return { value: to_m3(vol), unit: 'm³', method: 'volume', reliable: true }
        end
        # Fallback: Bounding-Box-Volumen
        bb_vol = bounding_box_volume(faces, transform)
        if bb_vol > 0 && hint_einheit == 'm³'
          return { value: to_m3(bb_vol), unit: 'm³', method: 'bbox_volume', reliable: true }
        end
      end

      # --- m Länge (explizit angefordert, Geometrie mit Faces) ---
      if hint_einheit == 'm'
        all_verts = faces.flat_map { |f| f.vertices } + edges.flat_map { |e| [e.start, e.end] }
        len = bounding_box_longest_axis(all_verts, transform)
        return { value: to_m(len), unit: 'm', method: 'bbox_length', reliable: true } if len > 0
      end

      # --- m² Fläche ---
      if faces.any?
        if solid_entities?(faces)
          area = faces.map { |f| transformed_face_area(f, transform) }.max
        else
          area = faces.sum { |f| transformed_face_area(f, transform) }
        end
        return { value: to_m2(area), unit: 'm²', method: 'area', reliable: true } if area && area > 0
      end

      fallback
    end

    # Wenn eine Gruppe keine direkten Faces hat, Sub-Gruppen/Komponenten zusammenfassen
    def self.calculate_nested(entities, transform, hint_einheit)
      sub = entities.select { |e| e.is_a?(Sketchup::Group) || e.is_a?(Sketchup::ComponentInstance) }
      return nil if sub.empty?

      total_vol  = 0.0
      total_area = 0.0
      total_len  = 0.0
      method_used = nil

      sub.each do |s|
        sub_entities = s.is_a?(Sketchup::Group) ? s.entities : s.definition.entities
        sub_transform = transform * s.transformation
        r = calculate_group_entities(sub_entities, sub_transform, hint_einheit)
        next if r[:method] == 'count'
        case r[:unit]
        when 'm³' then total_vol  += r[:value]; method_used = r[:method]
        when 'm²' then total_area += r[:value]; method_used = r[:method]
        when 'm'  then total_len  += r[:value]; method_used = r[:method]
        end
      end

      return { value: total_vol,  unit: 'm³', method: method_used || 'volume', reliable: true } if total_vol  > 0
      return { value: total_area, unit: 'm²', method: method_used || 'area',   reliable: true } if total_area > 0
      return { value: total_len,  unit: 'm',  method: method_used || 'length', reliable: true } if total_len  > 0
      nil
    end

    # -------------------------------------------------------------------------
    # Flächenberechnung via Newell-Methode auf transformierten Vertices
    # Korrekt für beliebige Rotation + Skalierung
    # -------------------------------------------------------------------------
    def self.transformed_face_area(face, transform)
      verts = face.outer_loop.vertices.map { |v| transform * v.position }
      polygon_area_3d(verts)
    rescue
      0.0
    end

    # Newell-Methode: Fläche eines beliebigen 3D-Polygons
    def self.polygon_area_3d(pts)
      return 0.0 if pts.length < 3
      nx = ny = nz = 0.0
      n = pts.length
      pts.each_with_index do |p, i|
        q = pts[(i + 1) % n]
        nx += (p.y - q.y) * (p.z + q.z)
        ny += (p.z - q.z) * (p.x + q.x)
        nz += (p.x - q.x) * (p.y + q.y)
      end
      Math.sqrt(nx * nx + ny * ny + nz * nz) / 2.0
    rescue
      0.0
    end

    # -------------------------------------------------------------------------
    # Kanten-Länge nach Transformation
    # -------------------------------------------------------------------------
    def self.transformed_edge_length(edge, transform)
      p0 = transform * edge.start.position
      p1 = transform * edge.end.position
      p0.distance(p1)
    rescue
      0.0
    end

    # -------------------------------------------------------------------------
    # Solid-Erkennung
    # -------------------------------------------------------------------------
    def self.solid_entities?(faces)
      return false if faces.empty?
      faces.all? { |f| f.edges.all? { |e| e.faces.length == 2 } }
    rescue
      false
    end

    # -------------------------------------------------------------------------
    # Volumen via Divergenz-Theorem auf transformierten Punkten
    # Korrekt für beliebige affine Transformationen (Rotation + Skalierung)
    # -------------------------------------------------------------------------
    def self.volume_of_faces(faces, transform)
      vol = 0.0
      faces.each do |face|
        mesh = face.mesh
        (1..mesh.count_polygons).each do |i|
          pts = mesh.polygon_points_at(i).map { |p| transform * p }
          next unless pts.length >= 3
          p0, p1, p2 = pts[0], pts[1], pts[2]
          vol += p0.x * (p1.y * p2.z - p1.z * p2.y) +
                 p0.y * (p1.z * p2.x - p1.x * p2.z) +
                 p0.z * (p1.x * p2.y - p1.y * p2.x)
        end
      end
      (vol / 6.0).abs
    rescue
      nil
    end

    # -------------------------------------------------------------------------
    # Bounding-Box-Volumen aus transformierten Vertices
    # -------------------------------------------------------------------------
    def self.bounding_box_volume(faces, transform)
      pts = faces.flat_map { |f| f.vertices.map { |v| transform * v.position } }
      return 0 if pts.empty?
      xs = pts.map(&:x); ys = pts.map(&:y); zs = pts.map(&:z)
      (xs.max - xs.min) * (ys.max - ys.min) * (zs.max - zs.min)
    rescue
      0
    end

    # -------------------------------------------------------------------------
    # Alle Vertices eines Entities rekursiv in Weltkoordinaten sammeln.
    # Verwendet die akkumulierte Welt-Transformation (inkl. aller Eltern-Skalierungen).
    # -------------------------------------------------------------------------
    def self.world_vertices(entity, transform)
      pts = []
      collect_verts(entity, transform, pts)
      pts
    rescue
      []
    end

    def self.collect_verts(entity, transform, pts)
      children = case entity
                 when Sketchup::Group            then entity.entities
                 when Sketchup::ComponentInstance then entity.definition.entities
                 else return
                 end
      children.each do |e|
        case e
        when Sketchup::Group, Sketchup::ComponentInstance
          collect_verts(e, transform * e.transformation, pts)
        when Sketchup::Face
          e.outer_loop.vertices.each { |v| pts << (transform * v.position) }
        when Sketchup::Edge
          pts << (transform * e.start.position)
          pts << (transform * e.end.position)
        end
      end
    end

    # -------------------------------------------------------------------------
    # Längste Achse der Bounding Box transformierter Vertices
    # Für lineare Bauteile mit expliziter Einheit 'm'
    # -------------------------------------------------------------------------
    def self.bounding_box_longest_axis(vertices, transform)
      pts = vertices.map { |v| transform * v.position }
      return 0.0 if pts.empty?
      xs = pts.map(&:x); ys = pts.map(&:y); zs = pts.map(&:z)
      [xs.max - xs.min, ys.max - ys.min, zs.max - zs.min].max
    rescue
      0.0
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
