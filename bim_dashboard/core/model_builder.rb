# =============================================================================
# BIM Dashboard – Model Builder
# Datei: core/model_builder.rb
# =============================================================================

require 'json'
require 'tmpdir'

module BimDashboard
  module ModelBuilder

    M            = 39.3701
    CUBE_SIZE    = 1.0
    FACE_SIZE    = 1.0
    LINE_LENGTH  = 1.0
    PYRAMID_SIZE = 0.5
    SPACING      = 2.0

    PALETTES = [
      [210, 65, 55],
      [145, 55, 45],
      [25,  70, 50],
      [280, 50, 55],
      [170, 60, 45],
      [350, 60, 55],
    ].freeze

    # -------------------------------------------------------------------------
    # Hauptmethode
    # -------------------------------------------------------------------------
    def self.import_from_excel(path)
      structure, tag_lists = parse_excel(path)
      if structure.empty?
        return { error: 'Keine Daten gefunden. Bitte prüfen ob die Datei einen Reiter "Modellstruktur" enthält.' }
      end

      model = Sketchup.active_model
      model.start_operation('BIM Projektstruktur importieren', true)
      begin
        update_library(tag_lists) unless tag_lists.empty?
        stats = build_structure(model, structure)
        model.commit_operation
        model.active_view.zoom_extents
        { success: true, stats: stats }
      rescue => e
        model.abort_operation
        { error: "#{e.class}: #{e.message}", backtrace: e.backtrace.first(5).join(' | ') }
      end
    end

    # -------------------------------------------------------------------------
    # Excel parsen via Python
    # -------------------------------------------------------------------------
    def self.parse_excel(path)
      py_code = <<~PYTHON
        import json, sys, warnings
        warnings.filterwarnings("ignore")
        try:
            import openpyxl
            wb = openpyxl.load_workbook(sys.argv[1], read_only=True, data_only=True)

            if "Modellstruktur" not in wb.sheetnames:
                print(json.dumps({"error": "Kein Reiter Modellstruktur"}))
                sys.exit(0)

            ws = wb["Modellstruktur"]
            rows = []
            header_skipped = False
            for row in ws.iter_rows(values_only=True):
                if not any(c for c in row if c is not None and str(c).strip()):
                    continue
                if not header_skipped and row[0] == "E1":
                    header_skipped = True
                    continue
                rows.append([
                    str(row[0]).strip() if row[0] is not None else None,
                    str(row[1]).strip() if row[1] is not None else None,
                    str(row[2]).strip() if row[2] is not None else None,
                    str(row[3]).strip() if row[3] is not None else None,
                    str(row[4]).strip() if row[4] is not None else None,
                    str(row[5]).strip() if row[5] is not None else None,
                    str(row[6]).strip() if row[6] is not None else None,
                ])

            tag_lists = {}
            for sheet in ["Tag_Verortung","Tag_Gewerke","Tag_Kostengruppen","Tag_Materialien"]:
                if sheet in wb.sheetnames:
                    ws2 = wb[sheet]
                    vals = []
                    for r in ws2.iter_rows(values_only=True):
                        if r[0] is not None and str(r[0]).strip():
                            vals.append(str(r[0]).strip())
                    tag_lists[sheet] = vals

            print(json.dumps({"rows": rows, "tag_lists": tag_lists}))

        except Exception as e:
            import traceback
            print(json.dumps({"error": str(e), "trace": traceback.format_exc()}))
      PYTHON

      tmp_dir    = Dir.tmpdir
      tmp_script = File.join(tmp_dir, 'bim_parser.py')
      tmp_result = File.join(tmp_dir, 'bim_result.json')

      File.write(tmp_script, py_code, encoding: 'UTF-8')

      # Windows: Backslashes zu Forward-Slashes normalisieren
      norm_path   = path.gsub('\\', '/')
      safe_script = tmp_script.gsub('\\', '/')
      safe_result = tmp_result.gsub('\\', '/')

      system("python3 \"#{safe_script}\" \"#{norm_path}\" > \"#{safe_result}\" 2>&1")

      unless File.exist?(tmp_result) && File.size(tmp_result) > 0
        system("python \"#{safe_script}\" \"#{norm_path}\" > \"#{safe_result}\" 2>&1")
      end

      unless File.exist?(tmp_result) && File.size(tmp_result) > 0
        return [[], {}]
      end

      raw    = File.read(tmp_result, encoding: 'UTF-8').strip
      result = JSON.parse(raw)

      File.delete(tmp_script) rescue nil
      File.delete(tmp_result) rescue nil

      if result['error']
        puts "[BIM Import] Python-Fehler: #{result['error']}"
        return [[], {}]
      end

      rows = (result['rows'] || []).map do |r|
        {
          'e1'       => r[0],
          'e2'       => r[1],
          'e3'       => r[2],
          'einheit'  => r[3],
          'gewerk'   => r[4],
          'kg'       => r[5],
          'material' => r[6],
        }
      end

      [rows, result['tag_lists'] || {}]
    rescue => e
      puts "[BIM Import] Ruby-Fehler: #{e.message}"
      [[], {}]
    end

    # -------------------------------------------------------------------------
    # Struktur aufbauen
    # -------------------------------------------------------------------------
    def self.build_structure(model, rows)
      top_entities   = model.entities
      stats          = { groups: 0, geometries: 0, errors: [] }

      e1_groups      = rows.map { |r| r['e1'] }.compact.uniq
      e1_palette_map = {}
      e1_groups.each_with_index { |g, i| e1_palette_map[g] = i % PALETTES.size }

      current_e1     = nil
      current_e1_grp = nil
      cursor_x       = 0.0
      row_y          = 0.0
      max_depth      = 0.0
      elem_index     = 0

      rows.each do |row|
        if row['e1']
          row_y     += max_depth + SPACING * M * 2 unless current_e1.nil?
          current_e1     = row['e1']
          current_e1_grp = top_entities.add_group
          current_e1_grp.name = current_e1
          cursor_x   = 0.0
          max_depth  = 0.0
          elem_index = 0
          stats[:groups] += 1
          next
        end

        next unless row['e2'] && current_e1_grp

        palette = PALETTES[e1_palette_map[current_e1] || 0]
        pos     = Geom::Point3d.new(cursor_x, row_y, 0)
        einheit = row['einheit'].to_s.strip

        begin
          grp = build_geometry(current_e1_grp.entities, row['e2'], einheit, pos, palette, elem_index)
          if grp
            set_tags(grp, row)
            bbox      = grp.bounds
            w         = [bbox.width,  SPACING * M * 0.5].max
            d         = [bbox.depth,  SPACING * M * 0.5].max
            cursor_x += w + SPACING * M * 0.5
            max_depth = [max_depth, d].max
            stats[:geometries] += 1
            elem_index += 1
          end
        rescue => e
          stats[:errors] << "#{row['e2']}: #{e.message}"
        end
      end

      stats
    end

    # -------------------------------------------------------------------------
    # Geometrie je Einheit
    # -------------------------------------------------------------------------
    def self.build_geometry(entities, name, einheit, pos, palette, idx)
      grp      = entities.add_group
      grp.name = name.to_s

      color = palette_color(palette, idx)
      mat   = Sketchup.active_model.materials.add(
        "BIM_#{(name[0..12] rescue 'x').gsub(/[^\w]/, '_')}_#{idx}"
      )
      mat.color = color

      case einheit
      when 'm³', 'm3'  then build_cube(grp.entities, pos, CUBE_SIZE, mat)
      when 'm²', 'm2'  then build_face(grp.entities, pos, FACE_SIZE, mat)
      when 'm'         then build_line(grp.entities, pos, LINE_LENGTH, mat)
      when /\ASt/i, /\AStück/i then build_pyramid(grp.entities, pos, PYRAMID_SIZE, mat)
      else                  build_cube(grp.entities, pos, CUBE_SIZE, mat)
      end

      grp
    end

    # --- Würfel (m³) ---
    def self.build_cube(ents, pos, size_m, mat)
      s = size_m * M
      x, y, z = pos.x, pos.y, pos.z
      pts  = [[x,y,z], [x+s,y,z], [x+s,y+s,z], [x,y+s,z]]
      face = ents.add_face(pts)
      face.reverse! if face.normal.z < 0
      face.pushpull(-s)
      ents.grep(Sketchup::Face).each do |f|
        f.material      = mat
        f.back_material = mat
      end
    end

    # --- Fläche (m²) ---
    def self.build_face(ents, pos, size_m, mat)
      s    = size_m * M
      x, y, z = pos.x, pos.y, pos.z
      pts  = [[x,y,z], [x+s,y,z], [x+s,y+s,z], [x,y+s,z]]
      face = ents.add_face(pts)
      face.material      = mat
      face.back_material = mat
    end

    # --- Linie (m) ---
    def self.build_line(ents, pos, length_m, _mat)
      l = length_m * M
      h = 0.15 * M
      x, y, z = pos.x, pos.y, pos.z
      ents.add_line([x,   y, z],   [x+l, y, z])
      ents.add_line([x,   y, z-h], [x,   y, z+h])
      ents.add_line([x+l, y, z-h], [x+l, y, z+h])
    end

    # --- Pyramide (St.) ---
    def self.build_pyramid(ents, pos, size_m, mat)
      s    = size_m * M
      half = s / 2.0
      x, y, z = pos.x, pos.y, pos.z
      base = [[x,y,z], [x+s,y,z], [x+s,y+s,z], [x,y+s,z]]
      apex = [x + half, y + half, z + s]

      bf = ents.add_face(base)
      bf.material      = mat
      bf.back_material = mat

      4.times do |i|
        sf = ents.add_face([base[i], base[(i+1) % 4], apex])
        next unless sf.is_a?(Sketchup::Face)
        sf.material      = mat
        sf.back_material = mat
      end
    end

    # -------------------------------------------------------------------------
    # Tags setzen
    # -------------------------------------------------------------------------
    def self.set_tags(entity, row)
      {
        'einheit'  => row['einheit'],
        'gewerk'   => row['gewerk'],
        'din276'   => row['kg'],
        'material' => row['material'],
        'stufe'    => '3',
      }.each do |key, val|
        entity.set_attribute(DICT_NAME, key, val.to_s) if val && !val.to_s.empty?
      end
    end

    # -------------------------------------------------------------------------
    # Farbberechnung HSL → RGB
    # -------------------------------------------------------------------------
    def self.palette_color(palette, idx)
      hue   = palette[0]
      sat   = palette[1] / 100.0
      steps = [-0.15, -0.05, 0.0, 0.08, 0.15, 0.20, -0.10, 0.12]
      l     = (palette[2] / 100.0 + steps[idx % steps.size]).clamp(0.25, 0.80)
      r, g, b = hsl_to_rgb(hue, sat, l)
      Sketchup::Color.new((r * 255).round, (g * 255).round, (b * 255).round)
    end

    def self.hsl_to_rgb(h, s, l)
      h /= 360.0
      return [l, l, l] if s == 0
      q = l < 0.5 ? l * (1 + s) : l + s - l * s
      p = 2 * l - q
      [hue_to_rgb(p, q, h + 1.0/3),
       hue_to_rgb(p, q, h),
       hue_to_rgb(p, q, h - 1.0/3)]
    end

    def self.hue_to_rgb(p, q, t)
      t += 1 if t < 0
      t -= 1 if t > 1
      return p + (q - p) * 6 * t        if t < 1.0/6
      return q                           if t < 0.5
      return p + (q - p) * (2.0/3-t)*6  if t < 2.0/3
      p
    end

    # -------------------------------------------------------------------------
    # Bibliothek aktualisieren
    # -------------------------------------------------------------------------
    def self.update_library(tag_lists)
      existing = LibraryManager.all_as_hash

      if tag_lists['Tag_Gewerke']
        items = tag_lists['Tag_Gewerke'].map.with_index do |bez, i|
          existing['gewerke'].find { |g| g['bezeichnung'] == bez } ||
            { 'id' => "g_imp_#{i}", 'bezeichnung' => bez }
        end
        LibraryManager.update_list('gewerke', items.to_json)
      end

      if tag_lists['Tag_Kostengruppen']
        items = tag_lists['Tag_Kostengruppen'].map.with_index do |bez, i|
          kg_nr = bez.match(/^\d+/)&.to_s || ''
          existing['kostengruppen'].find { |k| k['kg'] == kg_nr } ||
            { 'id' => "k_imp_#{i}", 'kg' => kg_nr,
              'bezeichnung' => bez.sub(/^\d+\s*/, ''), 'einheit' => 'm²' }
        end
        LibraryManager.update_list('kostengruppen', items.to_json)
      end

      if tag_lists['Tag_Materialien']
        items = tag_lists['Tag_Materialien'].map.with_index do |bez, i|
          existing['materialien'].find { |m| m['bezeichnung'] == bez } ||
            { 'id' => "m_imp_#{i}", 'bezeichnung' => bez }
        end
        LibraryManager.update_list('materialien', items.to_json)
      end
    end

  end
end
