# =============================================================================
# BIM Dashboard – Dialog & Ruby↔JS Bridge
# Datei: ui/dialog.rb
# =============================================================================

require 'json'

module BimDashboard
  module DialogManager

    DIALOG_OPTS = {
      dialog_title:    'BIM Dashboard',
      preferences_key: 'bim_dashboard_v64',
      resizable:       true,
      width:           1200,
      height:          750,
      left:            20,
      top:             20
    }.freeze

    def self.show
      if @dialog && @dialog.visible?
        @dialog.bring_to_front
        return
      end
      # Bibliothek beim Start laden
      LibraryManager.load

      @dialog = UI::HtmlDialog.new(DIALOG_OPTS)
      @dialog.set_file(File.join(HTML_DIR, 'index.html'))
      setup_bridge
      setup_callbacks
      @app_observer ||= DashboardAppObserver.new(self)
      Sketchup.add_observer(@app_observer)
      @app_observer.attach_to_current_model
      @dialog.show
    end

    def self.close
      Isolate.disable if Isolate.active?
      @app_observer&.detach_all
      Sketchup.remove_observer(@app_observer) if @app_observer
      @dialog&.close
      @dialog = nil
    end

    def self.call_js(fn_name, data = nil)
      return unless @dialog&.visible?
      json = data.nil? ? 'null' : data.to_json
      @dialog.execute_script("window.rubyBridge && window.rubyBridge.#{fn_name}(#{json})")
    end

    private

    def self.read_project_meta(model)
      meta = {}
      PROJECT_META_KEYS.each do |k|
        meta[k] = model.get_attribute(DICT_PROJECT, k, '')
      end
      meta['name'] = model.title.empty? ? 'Unbenanntes Projekt' : model.title
      meta
    end

    def self.read_element_mapping(model)
      raw   = model.get_attribute(DICT_PROJECT, 'element_mapping', '')
      saved = raw.to_s.empty? ? {} : JSON.parse(raw)
      # Tiefes Merge: Default-Einträge als Basis, gespeicherte Werte überschreiben
      result = {}
      ELEMENT_MAPPING_DEFAULTS.each do |key, defaults|
        result[key] = defaults.merge(saved[key] || {})
      end
      result
    rescue JSON::ParserError
      ELEMENT_MAPPING_DEFAULTS.transform_values(&:dup)
    end

    def self.setup_callbacks

      # --- Basis-Callbacks ---

      @dialog.add_action_callback('getAllEntities') do |_ctx, _|
        call_js('onEntitiesLoaded', JSON.parse(TagManager.all_entities_as_json))
      end

      @dialog.add_action_callback('setTags') do |_ctx, payload|
        data      = JSON.parse(payload)
        ids       = data['ids']
        tags_hash = data['tags']
        model     = Sketchup.active_model
        entities  = ids.map { |id| model.find_entity_by_id(id) }.compact
        if entities.any?
          TagManager.set_tags_batch(entities, tags_hash)
          call_js('onTagsUpdated', { success: true, count: entities.size })
          call_js('onEntitiesLoaded', JSON.parse(TagManager.all_entities_as_json))
        else
          call_js('onTagsUpdated', { success: false, error: 'Keine Entities gefunden' })
        end
      end

      @dialog.add_action_callback('selectEntities') do |_ctx, payload|
        ids   = JSON.parse(payload)
        model = Sketchup.active_model
        model.selection.clear
        entities = ids.map { |id| model.find_entity_by_id(id) }.compact
        model.selection.add(entities) if entities.any?
        Isolate.update(ids) if Isolate.active?
      end

      @dialog.add_action_callback('zoomToSelection') do |_ctx, _|
        model = Sketchup.active_model
        model.active_view.zoom(model.selection) unless model.selection.empty?
      end

      @dialog.add_action_callback('selectAndZoom') do |_ctx, payload|
        ids      = JSON.parse(payload)
        model    = Sketchup.active_model
        entities = ids.map { |id| model.find_entity_by_id(id) }.compact
        model.selection.clear
        model.selection.add(entities) if entities.any?
        model.active_view.zoom(model.selection) unless model.selection.empty?
      end

      @dialog.add_action_callback('refreshModel') do |_ctx, _|
        model = Sketchup.active_model
        # Mengen automatisch berechnen beim Aktualisieren
        auto_calculate_quantities
        call_js('onEntitiesLoaded', JSON.parse(TagManager.all_entities_as_json))
        call_js('onProjectMetaLoaded', read_project_meta(model))
        call_js('onModelRefreshed', { timestamp: Time.now.to_i })
      end

      @dialog.add_action_callback('getCategories') do |_ctx, _|
        call_js('onCategoriesLoaded', TAG_CATEGORIES)
        call_js('onCostTagsLoaded', COST_TAGS)
        call_js('onConstantsLoaded', {
          einheiten: EINHEITEN,
          stufen:    STUFEN,
          kg_einheit_defaults: KG_EINHEIT_DEFAULTS,
        })
      end

      @dialog.add_action_callback('clearTags') do |_ctx, payload|
        data     = JSON.parse(payload)
        ids      = data['ids']
        category = data['category']
        model    = Sketchup.active_model
        model.start_operation('BIM Tags löschen', true)
        begin
          ids.each do |id|
            entity = model.find_entity_by_id(id)
            next unless entity
            category ? entity.delete_attribute(DICT_NAME, category) : TagManager.clear_tags(entity)
          end
          model.commit_operation
        rescue => e
          model.abort_operation
          call_js('onError', { message: e.message })
        end
        call_js('onEntitiesLoaded', JSON.parse(TagManager.all_entities_as_json))
      end

      @dialog.add_action_callback('saveProjectMeta') do |_ctx, payload|
        data  = JSON.parse(payload)
        model = Sketchup.active_model
        model.start_operation('Projektdaten speichern', true)
        begin
          PROJECT_META_KEYS.each do |k|
            model.set_attribute(DICT_PROJECT, k, data[k].to_s) if data.key?(k)
          end
          model.commit_operation
          call_js('onProjectMetaSaved', { success: true })
        rescue => e
          model.abort_operation
          call_js('onError', { message: e.message })
        end
      end

      # --- Konfiguration: Bauteilzuordnungen ---

      @dialog.add_action_callback('getElementMapping') do |_ctx, _|
        call_js('onElementMappingLoaded', {
          fields:  ELEMENT_MAPPING_FIELDS,
          mapping: read_element_mapping(Sketchup.active_model),
        })
      end

      @dialog.add_action_callback('saveElementMapping') do |_ctx, payload|
        data  = JSON.parse(payload)
        model = Sketchup.active_model
        model.start_operation('Bauteilzuordnungen speichern', true)
        begin
          model.set_attribute(DICT_PROJECT, 'element_mapping', data.to_json)
          model.commit_operation
          call_js('onElementMappingSaved', { success: true })
          call_js('onEntitiesLoaded', JSON.parse(TagManager.all_entities_as_json))
        rescue => e
          model.abort_operation
          call_js('onError', { message: e.message })
        end
      end

      # --- Mengen-Callbacks ---

      @dialog.add_action_callback('calculateQuantities') do |_ctx, payload|
        ids   = payload ? JSON.parse(payload) : nil
        model = Sketchup.active_model

        all_tuples = TagManager.collect_all_entities
        items = if ids && ids.any?
          id_set = ids.map(&:to_i).to_set
          all_tuples.select { |e, _p, _t| id_set.include?(e.entityID) }
        else
          all_tuples.select do |e, _p, _t|
            d = e.attribute_dictionary(DICT_NAME)
            d && !d.to_h.empty?
          end
        end

        begin
          results = QuantityCalculator.calculate_and_store_batch(items)
          call_js('onQuantitiesCalculated', {
            count:       results.size,
            unreliable:  results.count { |r| !r[:result][:reliable] },
          })
          call_js('onEntitiesLoaded', JSON.parse(TagManager.all_entities_as_json))
        rescue => e
          call_js('onError', { message: e.message })
        end
      end

      # --- Kosten-Callbacks ---

      # Kosten-Report generieren
      @dialog.add_action_callback('getCostReport') do |_ctx, _|
        begin
          report = CostManager.cost_report
          call_js('onCostReportLoaded', report)
        rescue => e
          call_js('onError', { message: e.message })
        end
      end

      # Preistabelle an JS senden
      @dialog.add_action_callback('getPriceTable') do |_ctx, _|
        call_js('onLibraryLoaded', LibraryManager.all_as_hash)
      end

      # Preistabelle aus JS-Editor speichern
      @dialog.add_action_callback('savePriceTable') do |_ctx, payload|
        begin
          CostManager.update_from_json(payload)
          call_js('onPriceTableSaved', { success: true, count: CostManager.table.size })
        rescue => e
          call_js('onError', { message: e.message })
        end
      end

      # Bibliotheksliste aus JS-Editor speichern (neue Methode)
      @dialog.add_action_callback('updateLibraryList') do |_ctx, payload|
        begin
          data      = JSON.parse(payload)
          list_name = data['list']
          items     = data['items']
          LibraryManager.update_list(list_name, items.to_json)
          call_js('onLibraryListUpdated', { list: list_name, count: items.size })
        rescue => e
          call_js('onError', { message: e.message })
        end
      end

      # Einzelnen Bibliothekseintrag löschen
      @dialog.add_action_callback('deleteLibraryEntry') do |_ctx, payload|
        begin
          data = JSON.parse(payload)
          LibraryManager.delete_entry(data['list'], data['id'])
          call_js('onLibraryLoaded', LibraryManager.all_as_hash)
        rescue => e
          call_js('onError', { message: e.message })
        end
      end

      # Preistabelle als CSV exportieren (Datei-Dialog)
      @dialog.add_action_callback('exportPriceTableCSV') do |_ctx, _|
        path = UI.savepanel('Preistabelle exportieren', '', 'preistabelle.csv')
        if path
          CostManager.save_csv(path)
          call_js('onPriceTableExported', { path: path })
        end
      end

      # Preistabelle aus externer CSV importieren
      @dialog.add_action_callback('importPriceTableCSV') do |_ctx, _|
        path = UI.openpanel('Preistabelle importieren', '', '*.csv')
        if path
          CostManager.load_csv(path)
          call_js('onPriceTableLoaded', CostManager.table)
          call_js('onPriceTableImported', { path: path, count: CostManager.table.size })
        end
      end

      # --- Isolate-Callbacks ---

      @dialog.add_action_callback('isolateEnable') do |_ctx, payload|
        ids = JSON.parse(payload).map(&:to_i)
        if ids.any?
          Isolate.enable(ids)
          call_js('onIsolateChanged', { active: true })
        else
          call_js('onIsolateChanged', { active: false, error: 'Keine Bauteile selektiert' })
        end
      end

      @dialog.add_action_callback('isolateDisable') do |_ctx, _|
        Isolate.disable
        call_js('onIsolateChanged', { active: false })
      end

      # --- KI-Agent Callbacks ---

      @dialog.add_action_callback('agentGetStatus') do |_ctx, _|
        call_js('onAgentStatus', {
          has_key: AiAgent.has_api_key?,
          model:   AiAgent::MODEL,
        })
      end

      @dialog.add_action_callback('agentSetKey') do |_ctx, payload|
        data = JSON.parse(payload)
        AiAgent.set_api_key(data['key'])
        call_js('onAgentKeySet', { success: true })
      end

      @dialog.add_action_callback('agentAsk') do |_ctx, payload|
        data     = JSON.parse(payload)
        question = data['question']
        context  = data['context']
        history  = data['history'] || []
        api_key  = AiAgent.get_api_key

        if api_key.empty?
          call_js('onAgentError', { message: 'Kein API-Key hinterlegt. Bitte oben ⚙ Key klicken.' })
        else
          result_holder = { done: false, result: nil }
          Thread.new do
            result_holder[:result] = AiAgent.ask(question, context, api_key, history)
            result_holder[:done]   = true
          end
          timer_id = nil
          timer_id = UI.start_timer(0.3, true) do
            next unless result_holder[:done]
            UI.stop_timer(timer_id)
            r = result_holder[:result]
            if r[:success]
              call_js('onAgentResponse', { content: r[:content] })
            else
              call_js('onAgentError', { message: r[:error] })
            end
          end
        end
      end

      @dialog.add_action_callback('exportExcelFile') do |_ctx, payload|
        begin
          data = JSON.parse(payload)
          path = UI.savepanel('Auswertung als Excel exportieren', '', data['filename'] || 'BIM_Auswertung.xlsx')
          if path
            path += '.xlsx' unless path.downcase.end_with?('.xlsx')
            xlsx = generate_xlsx(data)
            File.open(path, 'wb') { |f| f.write(xlsx) }
            call_js('onReportExported', { success: true, path: File.basename(path) })
          end
        rescue => e
          call_js('onError', { message: "Excel-Export fehlgeschlagen: #{e.message}\n#{e.backtrace.first(3).join("\n")}" })
        end
      end

      @dialog.add_action_callback('exportCSVFile') do |_ctx, payload|
        begin
          data = JSON.parse(payload)
          path = UI.savepanel('Auswertung exportieren', '', data['filename'] || 'BIM_Auswertung.csv')
          if path
            path += '.csv' unless path.downcase.end_with?('.csv')
            # UTF-8 BOM damit Excel Umlaute korrekt liest
            File.open(path, 'wb') do |f|
              f.write("\xEF\xBB\xBF")
              f.write(data['csv'])
            end
            call_js('onReportExported', { success: true, path: File.basename(path) })
          end
        rescue => e
          call_js('onError', { message: "CSV-Export fehlgeschlagen: #{e.message}" })
        end
      end

      @dialog.add_action_callback('jsLog') do |_ctx, msg|
        puts "[BIM Dashboard JS] #{msg}"
      end

      # --- Projektstruktur importieren ---
      @dialog.add_action_callback('importProjectStructure') do |_ctx, _|
        path = UI.openpanel('Projektstruktur importieren', '', '*.xlsx')
        if path
          call_js('onImportStarted', { path: File.basename(path) })
          result = ModelBuilder.import_from_excel(path)
          if result[:success]
            # Modell neu laden
            call_js('onEntitiesLoaded', JSON.parse(TagManager.all_entities_as_json))
            call_js('onProjectMetaLoaded', read_project_meta(Sketchup.active_model))
            call_js('onLibraryLoaded', LibraryManager.all_as_hash)
            call_js('onImportFinished', {
              success: true,
              stats: result[:stats]
            })
          else
            call_js('onImportFinished', { success: false, error: result[:error] })
          end
        end
      end
    end

    # -------------------------------------------------------------------------
    # OOXML (.xlsx) Generator – reines Ruby, kein externes Gem.
    # Erstellt eine valide ZIP-Datei mit OOXML-Sheets, Formatierung
    # und echten Excel-Zeilengruppierungen (outlineLevel + summaryBelow=0).
    # -------------------------------------------------------------------------
    def self.generate_xlsx(data)
      require 'zlib'
      rows    = data['rows']    || []
      project = data['project'].to_s
      date    = data['date'].to_s
      build_zip(
        '[Content_Types].xml'        => xlsx_content_types,
        '_rels/.rels'                => xlsx_root_rels,
        'xl/workbook.xml'            => xlsx_workbook,
        'xl/_rels/workbook.xml.rels' => xlsx_workbook_rels,
        'xl/styles.xml'              => xlsx_styles,
        'xl/worksheets/sheet1.xml'   => xlsx_sheet(rows, project, date),
      )
    end

    def self.xlsx_content_types
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' \
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' \
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' \
      '<Default Extension="xml" ContentType="application/xml"/>' \
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' \
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' \
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' \
      '</Types>'
    end

    def self.xlsx_root_rels
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' \
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' \
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' \
      '</Relationships>'
    end

    def self.xlsx_workbook
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' \
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' \
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' \
      '<sheets><sheet name="BIM Auswertung" sheetId="1" r:id="rId1"/></sheets>' \
      '</workbook>'
    end

    def self.xlsx_workbook_rels
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' \
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' \
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' \
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' \
      '</Relationships>'
    end

    def self.xlsx_styles
      # cellXfs indices:
      # 0=default, 1=title, 2=meta, 3=header, 4=total_txt, 5=total_eur,
      # 6=sec0_txt, 7=sec0_eur, 8=sec1_txt, 9=sec1_eur, 10=sec2_txt, 11=sec2_eur,
      # 12=sub_txt, 13=sub_eur, 14=menge, 15=eur
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' \
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' \
      '<numFmts count="2">' \
        '<numFmt numFmtId="164" formatCode="#,##0.000"/>' \
        '<numFmt numFmtId="165" formatCode=\'#,##0.00\ &quot;&#8364;&quot;\'/>' \
      '</numFmts>' \
      '<fonts count="5">' \
        '<font><sz val="11"/><name val="Calibri"/></font>' \
        '<font><b/><sz val="13"/><name val="Calibri"/></font>' \
        '<font><i/><sz val="11"/><color rgb="FF888888"/><name val="Calibri"/></font>' \
        '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' \
        '<font><b/><sz val="11"/><name val="Calibri"/></font>' \
      '</fonts>' \
      '<fills count="9">' \
        '<fill><patternFill patternType="none"/></fill>' \
        '<fill><patternFill patternType="gray125"/></fill>' \
        '<fill><patternFill patternType="solid"><fgColor rgb="FF2C3E50"/></patternFill></fill>' \
        '<fill><patternFill patternType="solid"><fgColor rgb="FFF0B429"/></patternFill></fill>' \
        '<fill><patternFill patternType="solid"><fgColor rgb="FFBFC9CA"/></patternFill></fill>' \
        '<fill><patternFill patternType="solid"><fgColor rgb="FFD5DBDB"/></patternFill></fill>' \
        '<fill><patternFill patternType="solid"><fgColor rgb="FFEAECEE"/></patternFill></fill>' \
        '<fill><patternFill patternType="solid"><fgColor rgb="FFFAD7A0"/></patternFill></fill>' \
        '<fill><patternFill patternType="solid"><fgColor rgb="FFF2F3F4"/></patternFill></fill>' \
      '</fills>' \
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' \
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' \
      '<cellXfs count="19">' \
        '<xf numFmtId="0"   fontId="0" fillId="0" borderId="0" xfId="0"/>' \
        '<xf numFmtId="0"   fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' \
        '<xf numFmtId="0"   fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' \
        '<xf numFmtId="0"   fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' \
        '<xf numFmtId="0"   fontId="4" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' \
        '<xf numFmtId="165" fontId="4" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/>' \
        '<xf numFmtId="0"   fontId="4" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' \
        '<xf numFmtId="165" fontId="4" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/>' \
        '<xf numFmtId="0"   fontId="4" fillId="5" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' \
        '<xf numFmtId="165" fontId="4" fillId="5" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/>' \
        '<xf numFmtId="0"   fontId="4" fillId="6" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' \
        '<xf numFmtId="165" fontId="4" fillId="6" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/>' \
        '<xf numFmtId="0"   fontId="0" fillId="7" borderId="0" xfId="0" applyFill="1"/>' \
        '<xf numFmtId="165" fontId="0" fillId="7" borderId="0" xfId="0" applyFill="1" applyNumberFormat="1"/>' \
        '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' \
        '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' \
        '<xf numFmtId="0"   fontId="4" fillId="8" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' \
        '<xf numFmtId="164" fontId="4" fillId="8" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/>' \
        '<xf numFmtId="165" fontId="4" fillId="8" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/>' \
      '</cellXfs>' \
      '</styleSheet>'
    end

    COLS = %w[A B C D E F G].freeze

    def self.cs(col, rn, val, s = 0)
      "<c r=\"#{col}#{rn}\" s=\"#{s}\" t=\"inlineStr\"><is><t>#{xe(val.to_s)}</t></is></c>"
    end

    def self.cn(col, rn, val, s = 0)
      "<c r=\"#{col}#{rn}\" s=\"#{s}\"><v>#{val}</v></c>"
    end

    def self.xlsx_sheet(rows, project, date)
      # Subtotal-Zeilen (orange) komplett entfernen
      rows = rows.reject { |r| r['type'] == 'subtotal' }

      # Datenzeilen beginnen bei Excel-Zeile 5 (Zeilen 1-4 = Header)
      # Jede Datenzeile in `rows` belegt genau eine Excel-Zeile.
      er = ->(i) { 5 + i }

      # ---- Vorberechnung: SUM()-Formeln für D- (Menge) und G- (GB) Spalte ----
      # Ergebnis: formula_g[i] / formula_d[i] = "G5,G7,G12" (Argumente für SUM)
      formula_g = {}
      formula_d = {}

      rows.each_with_index do |r, i|
        d = (r['depth'] || 0).to_i

        case r['type']

        when 'total'
          refs = rows.each_with_index
                     .select { |x, _| x['type'] == 'section' && (x['depth'] || 0) == 0 }
                     .map    { |_, j| j }
          formula_g[i] = refs.map { |j| "G#{er.(j)}" }.join(',') if refs.any?
          # Menge NICHT summieren: total enthält Bauteile mit verschiedenen Einheiten

        when 'section'
          tail = rows[(i + 1)..].find_index { |x| (x['depth'] || 0) <= d }
          end_i = tail ? i + 1 + tail : rows.size
          block = (i + 1...end_i)

          subs  = block.select { |j| rows[j]['type'] == 'subtotal' && (rows[j]['depth'] || 0) == d + 1 }
          sects = block.select { |j| rows[j]['type'] == 'section'  && (rows[j]['depth'] || 0) == d + 1 }
          grps  = block.select { |j| rows[j]['type'] == 'group'    && (rows[j]['depth'] || 0) == d + 1 }
          targets = subs.any? ? subs : (sects.any? ? sects : grps)
          formula_g[i] = targets.map { |j| "G#{er.(j)}" }.join(',') if targets.any?
          # Menge NICHT summieren: Abschnitte können verschiedene Einheiten enthalten

        when 'group'
          next unless (r['count'] || 1).to_i > 1
          tail = rows[(i + 1)..].find_index { |x| (x['depth'] || 0) <= d }
          end_i = tail ? i + 1 + tail : rows.size
          details = (i + 1...end_i).select { |j| rows[j]['type'] == 'detail' }
          formula_g[i] = details.map { |j| "G#{er.(j)}" }.join(',') if details.any?
          formula_d[i] = details.map { |j| "D#{er.(j)}" }.join(',') if details.any?

        end
      end

      # ---- XML aufbauen ----
      cells_xml = []
      merges    = []

      add_row = lambda do |rn, ht, ol, body|
        oa = ol > 0 ? " outlineLevel=\"#{ol}\"" : ''
        ha = ht ? " ht=\"#{ht}\" customHeight=\"1\"" : ''
        cells_xml << "<row r=\"#{rn}\"#{ha}#{oa}>#{body}</row>"
      end

      # Hilfsmethode: Formelzelle
      cf = lambda do |col, rn, args, s|
        "<c r=\"#{col}#{rn}\" s=\"#{s}\"><f>SUM(#{args})</f></c>"
      end

      # Zeilen 1-4: Header
      add_row.(1, 20, 0,
        cs('A', 1, "BIM Auswertung — #{project}", 1) +
        (1..6).map { |k| "<c r=\"#{COLS[k]}1\" s=\"1\"/>" }.join)
      merges << 'A1:G1'

      add_row.(2, nil, 0, cs('A', 2, "Erstellt: #{date}", 2))
      merges << 'A2:G2'

      add_row.(3, 6, 0, '')

      hdr_cells = ['Bezeichnung','Stufe','Material','Menge','Einheit','EP (€)','GB (€)']
        .each_with_index.map { |h, k| cs(COLS[k], 4, h, 3) }.join
      add_row.(4, 18, 0, hdr_cells)

      # Datenzeilen
      rows.each_with_index do |r, i|
        rn    = er.(i)
        depth = (r['depth'] || 0).to_i
        ol    = depth
        fargs = formula_g[i]   # SUM-Argumente oder nil

        case r['type']

        when 'total'
          body  = cs('A', rn, r['label'].to_s, 4)
          body += (1..5).map { |k| "<c r=\"#{COLS[k]}#{rn}\" s=\"4\"/>" }.join
          body += fargs ? cf.('G', rn, fargs, 5) :
                  (r['cost'].to_f > 0 ? cn('G', rn, r['cost'].round(2), 5) : "<c r=\"G#{rn}\" s=\"4\"/>")
          add_row.(rn, 16, ol, body)
          merges << "A#{rn}:F#{rn}"

        when 'section'
          d   = [depth, 2].min
          st  = 6 + d * 2
          stn = st + 1
          body  = cs('A', rn, r['label'].to_s, st)
          body += (1..5).map { |k| "<c r=\"#{COLS[k]}#{rn}\" s=\"#{st}\"/>" }.join
          body += fargs ? cf.('G', rn, fargs, stn) :
                  (r['cost'].to_f > 0 ? cn('G', rn, r['cost'].round(2), stn) : "<c r=\"G#{rn}\" s=\"#{st}\"/>")
          add_row.(rn, 15, ol, body)
          merges << "A#{rn}:F#{rn}"

        when 'group', 'detail'
          is_group = r['type'] == 'group'
          suffix   = ''
          txt_s = is_group ? 16 : 0
          mng_s = is_group ? 17 : 14
          eur_s = is_group ? 18 : 15
          dargs = formula_d[i]
          body  = cs('A', rn, r['name'].to_s + suffix, txt_s)
          body += cs('B', rn, r['stufe'].to_s,          txt_s)
          body += cs('C', rn, r['material'].to_s,        txt_s)
          m = r['menge']
          body += dargs ? cf.('D', rn, dargs, mng_s) :
                  (m ? cn('D', rn, m.round(3), mng_s) : "<c r=\"D#{rn}\" s=\"#{txt_s}\"/>")
          body += cs('E', rn, r['einheit'].to_s, txt_s)
          ep = r['ep']
          body += ep ? cn('F', rn, ep.round(2), eur_s) : "<c r=\"F#{rn}\" s=\"#{txt_s}\"/>"
          gb = r['gb']
          body += fargs ? cf.('G', rn, fargs, eur_s) :
                  (gb ? cn('G', rn, gb.round(2), eur_s) : "<c r=\"G#{rn}\" s=\"#{txt_s}\"/>")
          add_row.(rn, nil, ol, body)

        end
      end

      mc = merges.empty? ? '' : "<mergeCells count=\"#{merges.size}\">#{merges.map { |m| "<mergeCell ref=\"#{m}\"/>" }.join}</mergeCells>"

      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' \
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' \
      '<sheetPr><outlinePr summaryBelow="0" summaryRight="0"/></sheetPr>' \
      '<sheetViews><sheetView workbookViewId="0">' \
        '<pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/>' \
        '<selection pane="bottomLeft"/>' \
      '</sheetView></sheetViews>' \
      '<sheetFormatPr defaultRowHeight="15" outlineLevelRow="3"/>' \
      '<cols>' \
        '<col min="1" max="1" width="37" customWidth="1"/>' \
        '<col min="2" max="2" width="10" customWidth="1"/>' \
        '<col min="3" max="3" width="15" customWidth="1"/>' \
        '<col min="4" max="4" width="10" customWidth="1"/>' \
        '<col min="5" max="5" width="8"  customWidth="1"/>' \
        '<col min="6" max="6" width="13" customWidth="1"/>' \
        '<col min="7" max="7" width="14" customWidth="1"/>' \
      '</cols>' \
      "<sheetData>#{cells_xml.join}</sheetData>" \
      "#{mc}" \
      '</worksheet>'
    end

    # Minimaler ZIP-Builder: reines Ruby, nutzt Zlib::Deflate.
    # Erzeugt eine valide ZIP-Datei aus einem Hash { Pfad => Inhalt }.
    def self.build_zip(files)
      require 'zlib'
      zip  = ''.b
      cdir = ''.b

      files.each do |name, content|
        raw    = content.encode('UTF-8').b
        crc    = Zlib.crc32(raw)
        # Raw-DEFLATE: zlib-Stream ohne 2-Byte-Header und 4-Byte-Adler32
        comp   = Zlib::Deflate.deflate(raw, Zlib::BEST_COMPRESSION)[2..-5]
        off    = zip.bytesize
        name_b = name.b

        local = [0x04034b50, 20, 0, 8, 0, 0, crc,
                 comp.bytesize, raw.bytesize, name_b.bytesize, 0].pack('VvvvvvVVVvv')
        zip << local << name_b << comp

        cdir << [0x02014b50, 20, 20, 0, 8, 0, 0, crc,
                 comp.bytesize, raw.bytesize, name_b.bytesize,
                 0, 0, 0, 0, 0, off].pack('VvvvvvvVVVvvvvvVV')
        cdir << name_b
      end

      eocd = [0x06054b50, 0, 0, files.size, files.size,
              cdir.bytesize, zip.bytesize, 0].pack('VvvvvVVv')
      zip << cdir << eocd
    end

    def self.xe(str)
      str.to_s.gsub('&','&amp;').gsub('<','&lt;').gsub('>','&gt;').gsub('"','&quot;')
    end

    def self.setup_bridge
      @dialog.add_action_callback('dialogReady') do |_ctx, _|
        model = Sketchup.active_model
        call_js('onCategoriesLoaded', TAG_CATEGORIES)
        call_js('onCostTagsLoaded', COST_TAGS)
        call_js('onConstantsLoaded', {
          einheiten: EINHEITEN,
          stufen:    STUFEN,
          kg_einheit_defaults: KG_EINHEIT_DEFAULTS,
        })
        # Mengen automatisch berechnen beim ersten Laden
        auto_calculate_quantities
        call_js('onEntitiesLoaded', JSON.parse(TagManager.all_entities_as_json))
        call_js('onProjectMetaLoaded', read_project_meta(model))
        call_js('onLibraryLoaded', LibraryManager.all_as_hash)
        call_js('onElementMappingLoaded', {
          fields:  ELEMENT_MAPPING_FIELDS,
          mapping: read_element_mapping(model),
        })
      end
    end

    # Berechnet Mengen für alle klassifizierten Entities (lautlos im Hintergrund)
    def self.auto_calculate_quantities
      tuples = TagManager.collect_all_entities.select do |e, _p, _t|
        d = e.attribute_dictionary(DICT_NAME)
        d && !d.to_h.empty?
      end
      QuantityCalculator.calculate_and_store_batch(tuples) if tuples.any?
    rescue => e
      puts "[BIM] Auto-Mengenberechnung fehlgeschlagen: #{e.message}"
    end

  end
end
