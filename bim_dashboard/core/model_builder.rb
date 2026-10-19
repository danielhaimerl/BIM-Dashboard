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
        py_error = tag_lists.is_a?(Hash) ? tag_lists['__error'] : nil
        msg = py_error ? "Import fehlgeschlagen: #{py_error}" \
                       : 'Keine Daten gefunden. Bitte prüfen ob die Datei einen Reiter "Modellstruktur" enthält.'
        return { error: msg }
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
    # Excel parsen via PowerShell (kein Python erforderlich)
    # -------------------------------------------------------------------------
    def self.parse_excel(path)
      ps_code = <<~'PS'
        param([string]$XlsxPath, [string]$OutPath)
        function Write-Result($data) {
          $json = $data | ConvertTo-Json -Depth 10 -Compress
          [System.IO.File]::WriteAllText($OutPath, $json, [System.Text.UTF8Encoding]::new($false))
        }
        try {
          Add-Type -AssemblyName System.IO.Compression
          Add-Type -AssemblyName System.IO.Compression.FileSystem
          function Read-Zip($zip, $entry) {
            $e = $zip.GetEntry($entry)
            if (!$e) { return '' }
            $r = [System.IO.StreamReader]::new($e.Open(), [System.Text.Encoding]::UTF8)
            $c = $r.ReadToEnd(); $r.Dispose(); return $c
          }
          $stream = [System.IO.File]::Open($XlsxPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
          $zip = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Read)

          # Shared strings
          $ss = [System.Collections.Generic.List[string]]::new()
          $ssc = Read-Zip $zip 'xl/sharedStrings.xml'
          if ($ssc) {
            $ssXml = [xml]$ssc
            $ns = @{x='http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
            foreach ($si in (Select-Xml -Xml $ssXml -XPath '//x:si' -Namespace $ns)) {
              $parts = Select-Xml -Xml $si.Node -XPath './/x:t' -Namespace $ns
              $ss.Add(($parts | ForEach-Object { $_.Node.InnerText }) -join '')
            }
          }

          # Sheet map from workbook
          $wbXml  = [xml](Read-Zip $zip 'xl/workbook.xml')
          $relXml = [xml](Read-Zip $zip 'xl/_rels/workbook.xml.rels')
          $sheetMap = @{}
          $nsWb = @{x='http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
          foreach ($sn in (Select-Xml -Xml $wbXml -XPath '//x:sheet' -Namespace $nsWb)) {
            $name = $sn.Node.GetAttribute('name')
            $rid  = $sn.Node.GetAttribute('id','http://schemas.openxmlformats.org/officeDocument/2006/relationships')
            $rel  = $relXml.Relationships.Relationship | Where-Object { $_.Id -eq $rid } | Select-Object -First 1
            if ($rel) { $sheetMap[$name] = 'xl/' + $rel.Target }
          }

          function Get-CellVal($cell) {
            $t = $cell.GetAttribute('t')
            $v = $cell.SelectSingleNode('*[local-name()="v"]')
            if (!$v) { return $null }
            $val = $v.InnerText
            if ($t -eq 's') { $idx=[int]$val; if($idx -lt $ss.Count){return $ss[$idx]}else{return ''} }
            return $val
          }
          function Get-ColIdx($ref) {
            $letters = $ref -replace '\d+',''
            $idx = 0
            foreach ($c in $letters.ToCharArray()) { $idx = $idx*26 + ([int][char]$c - [int][char]'A' + 1) }
            return $idx - 1
          }

          function Parse-Sheet($path) {
            $content = Read-Zip $zip $path
            if (!$content) { return @() }
            $xml = [xml]$content
            $ns  = @{x='http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
            $out = [System.Collections.Generic.List[object]]::new()
            $headerSkipped = $false
            foreach ($rn in (Select-Xml -Xml $xml -XPath '//x:row' -Namespace $ns)) {
              $cells = @($null,$null,$null,$null,$null,$null,$null)
              foreach ($cn in (Select-Xml -Xml $rn.Node -XPath 'x:c' -Namespace $ns)) {
                $ci = Get-ColIdx ($cn.Node.GetAttribute('r'))
                if ($ci -ge 0 -and $ci -le 6) { $cells[$ci] = Get-CellVal $cn.Node }
              }
              $hasData = $cells | Where-Object { $_ -ne $null -and "$_".Trim() -ne '' }
              if (!$hasData) { continue }
              if (!$headerSkipped -and $cells[0] -eq 'E1') { $headerSkipped=$true; continue }
              $out.Add($cells)
            }
            return ,$out.ToArray()
          }

          # Find Modellstruktur (case-insensitive)
          $msKey = $sheetMap.Keys | Where-Object { $_.Trim().ToLower() -eq 'modellstruktur' } | Select-Object -First 1
          if (!$msKey) {
            Write-Result @{error=('Kein Reiter Modellstruktur. Vorhandene Reiter: ' + ($sheetMap.Keys -join ', '))}
            $zip.Dispose(); $stream.Dispose(); exit 0
          }
          $rows = Parse-Sheet $sheetMap[$msKey]

          # Tag sheets
          $tagLists = @{}
          foreach ($ts in @('Tag_Kostenstufe','Tag_Gewerk','Tag_Verortung','Tag_Kostengruppe','Tag_Material')) {
            $tsKey = $sheetMap.Keys | Where-Object { $_.Trim().ToLower() -eq $ts.ToLower() } | Select-Object -First 1
            if ($tsKey) {
              $content = Read-Zip $zip $sheetMap[$tsKey]
              $xml = [xml]$content
              $ns  = @{x='http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
              $vals = [System.Collections.Generic.List[string]]::new()
              foreach ($rn in (Select-Xml -Xml $xml -XPath '//x:row' -Namespace $ns)) {
                $cn = (Select-Xml -Xml $rn.Node -XPath 'x:c' -Namespace $ns) | Select-Object -First 1
                if ($cn) { $v = Get-CellVal $cn.Node; if ($v -and "$v".Trim()) { $vals.Add("$v".Trim()) } }
              }
              $tagLists[$ts] = $vals.ToArray()
            }
          }
          $zip.Dispose(); $stream.Dispose()
          Write-Result @{rows=$rows; tag_lists=$tagLists}
        } catch {
          Write-Result @{error=$_.Exception.Message; trace=$_.ScriptStackTrace}
        }
      PS

      tmp_dir    = Dir.tmpdir
      tmp_script = File.join(tmp_dir, 'bim_parser.ps1')
      tmp_result = File.join(tmp_dir, 'bim_result.json')

      File.write(tmp_script, ps_code, encoding: 'UTF-8')

      norm_path   = path.gsub('/', '\\')
      win_script  = tmp_script.gsub('/', '\\')
      win_result  = tmp_result.gsub('/', '\\')

      system("powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"#{win_script}\" -XlsxPath \"#{norm_path}\" -OutPath \"#{win_result}\"")

      unless File.exist?(tmp_result) && File.size(tmp_result) > 0
        return [[], { '__error' => 'PowerShell-Aufruf fehlgeschlagen oder keine Ausgabe erzeugt.' }]
      end

      bytes  = File.binread(tmp_result)
      bytes  = bytes[3..] if bytes.start_with?("\xEF\xBB\xBF".b)  # BOM entfernen
      bytes.force_encoding('UTF-8')
      # Nur bei wirklich ungültigen Bytes ersetzen, sonst UTF-8 direkt verwenden
      bytes  = bytes.encode('UTF-8', 'binary', invalid: :replace, undef: :replace) unless bytes.valid_encoding?
      raw    = bytes.strip
      result = JSON.parse(raw)

      File.delete(tmp_script) rescue nil
      File.delete(tmp_result) rescue nil

      if result['error']
        puts "[BIM Import] Fehler: #{result['error']}"
        puts "[BIM Import] Trace: #{result['trace'].to_s[0..500]}" if result['trace']
        return [[], { '__error' => result['error'] }]
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
        next unless row['e2']

        # Neue E1-Gruppe anlegen wenn E1 sich ändert
        if row['e1'] && row['e1'] != current_e1
          row_y     += max_depth + SPACING * M * 2 unless current_e1.nil?
          current_e1     = row['e1']
          current_e1_grp = top_entities.add_group
          current_e1_grp.name = current_e1
          cursor_x   = 0.0
          max_depth  = 0.0
          elem_index = 0
          stats[:groups] += 1
        end

        next unless current_e1_grp

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
        'stufe'    => row['e1'],
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

      if tag_lists['Tag_Kostenstufe']
        items = tag_lists['Tag_Kostenstufe'].map.with_index do |bez, i|
          existing['stufen'].find { |s| s['bezeichnung'] == bez } ||
            { 'id' => "s_imp_#{i}", 'bezeichnung' => bez, 'beschreibung' => '' }
        end
        LibraryManager.update_list('stufen', items.to_json)
      end

      if tag_lists['Tag_Gewerk']
        items = tag_lists['Tag_Gewerk'].map.with_index do |bez, i|
          existing['gewerke'].find { |g| g['bezeichnung'] == bez } ||
            { 'id' => "g_imp_#{i}", 'bezeichnung' => bez }
        end
        LibraryManager.update_list('gewerke', items.to_json)
      end

      if tag_lists['Tag_Verortung']
        items = tag_lists['Tag_Verortung'].map.with_index do |bez, i|
          existing['verortung'].find { |v| v['bezeichnung'] == bez } ||
            { 'id' => "v_imp_#{i}", 'bezeichnung' => bez }
        end
        LibraryManager.update_list('verortung', items.to_json)
      end

      if tag_lists['Tag_Kostengruppe']
        items = tag_lists['Tag_Kostengruppe'].map.with_index do |bez, i|
          existing['kostengruppen'].find { |k| k['kg'] == bez } ||
            { 'id' => "k_imp_#{i}", 'kg' => bez, 'einheit' => 'm²' }
        end
        LibraryManager.update_list('kostengruppen', items.to_json)
      end

      if tag_lists['Tag_Material']
        items = tag_lists['Tag_Material'].map.with_index do |bez, i|
          existing['materialien'].find { |m| m['bezeichnung'] == bez } ||
            { 'id' => "m_imp_#{i}", 'bezeichnung' => bez }
        end
        LibraryManager.update_list('materialien', items.to_json)
      end
    end

    # -------------------------------------------------------------------------
    # Excel-Export der Auswertung (Struktur wie Dashboard-Ansicht)
    # -------------------------------------------------------------------------
    def self.export_report_excel(out_path, data)
      tmp_dir    = Dir.tmpdir
      data_file  = File.join(tmp_dir, 'bim_report_data.json')
      script_file = File.join(tmp_dir, 'bim_export.ps1')

      File.write(data_file, data.to_json, encoding: 'UTF-8')

      win_data   = data_file.gsub('/', '\\')
      win_out    = out_path.gsub('/', '\\')
      win_script = script_file.gsub('/', '\\')

      ps = <<~'PS'
        param([string]$DataPath, [string]$OutPath)
        $ErrorActionPreference = 'Stop'

        $raw  = [System.IO.File]::ReadAllText($DataPath, [System.Text.Encoding]::UTF8)
        $data = $raw | ConvertFrom-Json

        # --- Excel via COM ---
        $xl  = New-Object -ComObject Excel.Application
        $xl.Visible        = $false
        $xl.DisplayAlerts  = $false

        $wb = $xl.Workbooks.Add()
        $ws = $wb.Worksheets.Item(1)
        $ws.Name = 'Auswertung'

        function SetCell($r, $c, $val) { $ws.Cells.Item($r,$c) = $val }
        function BoldCell($r, $c)      { $ws.Cells.Item($r,$c).Font.Bold = $true }
        function BgCell($r, $c, $rgb)  { $ws.Cells.Item($r,$c).Interior.Color = $rgb }
        function FgCell($r, $c, $rgb)  { $ws.Cells.Item($r,$c).Font.Color = $rgb }

        $COLS = 6
        $row  = 1

        # Projekt-Header
        SetCell $row 1 $data.project; BoldCell $row 1
        $ws.Cells.Item($row,1).Font.Size = 14
        $row++
        SetCell $row 1 ("Erstellt: " + $data.date)
        $ws.Cells.Item($row,1).Font.Color = 0x888888
        $row += 2

        # Spalten-Header
        $headers = @('Name','Kostenstufe','Material','Menge','EP (€)','GB (€)')
        for ($c = 1; $c -le $COLS; $c++) {
            SetCell $row $c $headers[$c-1]
            BoldCell $row $c
            BgCell $row $c 0x2D3D4E
            FgCell $row $c 0xFFFFFF
        }
        $row++

        # Tiefenfarben (BGR für Excel COM)
        $sectionBg = @(0xE8EFF5, 0xF0F5F8, 0xF7FAFB)

        foreach ($r in $data.rows) {
            $indent = '  ' * [int]$r.depth

            switch ($r.type) {
                'total' {
                    SetCell $row 1 $r.label; BoldCell $row 1
                    if ($r.cost -gt 0) { SetCell $row 6 ([math]::Round($r.cost,2)); BoldCell $row 6 }
                    for ($c=1; $c -le $COLS; $c++) { BgCell $row $c 0xD5E3EF }
                }
                'section' {
                    $d = [int]$r.depth
                    $bg = $sectionBg[$d % 3]
                    SetCell $row 1 ($indent + $r.label); BoldCell $row 1
                    if ($r.cost -gt 0) { SetCell $row 6 ([math]::Round($r.cost,2)); BoldCell $row 6 }
                    for ($c=1; $c -le $COLS; $c++) { BgCell $row $c $bg }
                }
                'group' {
                    $suffix = if ([int]$r.count -gt 1) { ' (' + [int]$r.count + '×)' } else { '' }
                    SetCell $row 1 ($indent + $r.name + $suffix); BoldCell $row 1
                    SetCell $row 2 $r.stufe
                    SetCell $row 3 $r.material
                    if ($r.menge -ne $null -and [double]$r.menge -gt 0) {
                        SetCell $row 4 ([string][math]::Round([double]$r.menge,3) + ' ' + $r.einheit)
                    }
                    if ($r.ep -ne $null -and [double]$r.ep -gt 0) {
                        $ws.Cells.Item($row,5) = [math]::Round([double]$r.ep,2)
                    }
                    if ($r.gb -ne $null -and [double]$r.gb -gt 0) {
                        $ws.Cells.Item($row,6) = [math]::Round([double]$r.gb,2)
                        BoldCell $row 6
                    }
                }
                'detail' {
                    SetCell $row 1 ($indent + $r.name)
                    FgCell $row 1 0x888888
                    SetCell $row 2 $r.stufe
                    SetCell $row 3 $r.material
                    if ($r.menge -ne $null -and [double]$r.menge -gt 0) {
                        SetCell $row 4 ([string][math]::Round([double]$r.menge,3) + ' ' + $r.einheit)
                    }
                    if ($r.ep -ne $null -and [double]$r.ep -gt 0) {
                        $ws.Cells.Item($row,5) = [math]::Round([double]$r.ep,2)
                    }
                    if ($r.gb -ne $null -and [double]$r.gb -gt 0) {
                        $ws.Cells.Item($row,6) = [math]::Round([double]$r.gb,2)
                    }
                }
                'subtotal' {
                    SetCell $row 1 ($indent + $r.label)
                    $ws.Cells.Item($row,1).Font.Italic = $true
                    if ($r.cost -gt 0) {
                        SetCell $row 6 ([math]::Round($r.cost,2)); BoldCell $row 6
                    }
                    for ($c=1; $c -le $COLS; $c++) { BgCell $row $c 0xF5F5F5 }
                }
            }
            $row++
        }

        # Kostenzeilen als Währung formatieren
        $costRange = $ws.Range($ws.Cells.Item(5,5), $ws.Cells.Item($row,6))
        $costRange.NumberFormat = '#.##0,00 "€"'

        # Spaltenbreite anpassen
        $ws.Columns.AutoFit() | Out-Null
        # Erste Spalte mindestens 30 Zeichen
        if ($ws.Columns.Item(1).ColumnWidth -lt 30) { $ws.Columns.Item(1).ColumnWidth = 30 }

        # Zeilen fixieren (Header einfrieren)
        $ws.Application.ActiveWindow.SplitRow = 5
        $ws.Application.ActiveWindow.FreezePanes = $true

        $wb.SaveAs($OutPath, 51)  # 51 = xlOpenXMLWorkbook (.xlsx)
        $wb.Close($false)
        $xl.Quit()
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) | Out-Null
        Write-Output 'OK'
      PS

      File.write(script_file, ps, encoding: 'UTF-8')

      ok = system("powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"#{win_script}\" -DataPath \"#{win_data}\" -OutPath \"#{win_out}\"")
      raise 'PowerShell-Export fehlgeschlagen (ist Excel installiert?)' unless ok
    end

  end
end
