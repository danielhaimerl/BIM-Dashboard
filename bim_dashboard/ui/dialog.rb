# =============================================================================
# BIM Dashboard – Dialog & Ruby↔JS Bridge
# Datei: ui/dialog.rb
# =============================================================================

require 'json'

module BimDashboard
  module DialogManager

    DIALOG_OPTS = {
      dialog_title:    'BIM Dashboard',
      preferences_key: 'bim_dashboard_v5',
      resizable:       true,
      width:           1300,
      height:          800,
      left:            80,
      top:             80
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

      # --- Mengen-Callbacks ---

      @dialog.add_action_callback('calculateQuantities') do |_ctx, payload|
        ids   = payload ? JSON.parse(payload) : nil
        model = Sketchup.active_model

        entities = if ids && ids.any?
          ids.map { |id| model.find_entity_by_id(id) }.compact
        else
          # Alle Entities die ein BimDashboard-AttributeDictionary haben
          # ODER einen einheit-Tag → das sind die relevanten Bauteile
          TagManager.collect_all_entities.map(&:first).select do |e|
            d = e.attribute_dictionary(DICT_NAME)
            d && !d.to_h.empty?
          end
        end

        begin
          results = QuantityCalculator.calculate_and_store_batch(entities)
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
      end
    end

    # Berechnet Mengen für alle klassifizierten Entities (lautlos im Hintergrund)
    def self.auto_calculate_quantities
      entities = TagManager.collect_all_entities.map(&:first).select do |e|
        d = e.attribute_dictionary(DICT_NAME)
        d && !d.to_h.empty?
      end
      QuantityCalculator.calculate_and_store_batch(entities) if entities.any?
    rescue => e
      puts "[BIM] Auto-Mengenberechnung fehlgeschlagen: #{e.message}"
    end

  end
end
