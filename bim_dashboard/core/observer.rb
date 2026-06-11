# =============================================================================
# BIM Dashboard – Observer
# Datei: core/observer.rb
#
# SelectionObserver: Reagiert auf Klicks/Selektion im Modell und
#                    aktualisiert das Dashboard.
# ModelObserver:     Reagiert auf Modellveränderungen (Sync-Button-Trigger).
# AppObserver:       Beobachtet Modellwechsel (neues/anderes Modell öffnen).
# =============================================================================

module BimDashboard

  # ---------------------------------------------------------------------------
  # SelectionObserver
  # Wird aktiv wenn der Nutzer Elemente in SketchUp selektiert.
  # ---------------------------------------------------------------------------
  class DashboardSelectionObserver < Sketchup::SelectionObserver

    def initialize(dialog_bridge)
      @bridge = dialog_bridge
    end

    def onSelectionBulkChange(selection)
      push_selection(selection)
    end

    def onSelectionCleared(selection)
      @bridge.call_js('onSketchupSelectionChanged', [])
    end

    private

    def push_selection(selection)
      ids = selection.map(&:entityID)
      # Nur alle 50ms senden um Flooding bei Drag-Select zu vermeiden
      @bridge.call_js('onSketchupSelectionChanged', ids)
    end

  end

  # ---------------------------------------------------------------------------
  # ModelObserver
  # Merkt sich ob das Modell seit dem letzten Report geändert wurde.
  # ---------------------------------------------------------------------------
  class DashboardModelObserver < Sketchup::ModelObserver

    def initialize(dialog_bridge)
      @bridge  = dialog_bridge
      @dirty   = false
    end

    def onTransactionCommit(model)
      mark_dirty
    end

    def onTransactionAbort(model)
      # nichts
    end

    private

    def mark_dirty
      unless @dirty
        @dirty = true
        @bridge.call_js('onModelChanged', { dirty: true })
      end
    end

    public

    def reset_dirty
      @dirty = false
    end

  end

  # ---------------------------------------------------------------------------
  # AppObserver
  # Registriert/deregistriert Model-Observer wenn Modell wechselt.
  # ---------------------------------------------------------------------------
  class DashboardAppObserver < Sketchup::AppObserver

    def initialize(dialog_bridge)
      @bridge            = dialog_bridge
      @sel_observer      = nil
      @model_observer    = nil
    end

    def onNewModel(model)
      reattach(model)
    end

    def onOpenModel(model)
      reattach(model)
    end

    def expectsStartupModelNotifications
      true
    end

    def attach_to_current_model
      reattach(Sketchup.active_model)
    end

    def detach_all
      model = Sketchup.active_model
      return unless model
      model.selection.remove_observer(@sel_observer)   if @sel_observer
      model.remove_observer(@model_observer)           if @model_observer
      @sel_observer   = nil
      @model_observer = nil
    end

    private

    def reattach(model)
      detach_all

      @sel_observer   = DashboardSelectionObserver.new(@bridge)
      @model_observer = DashboardModelObserver.new(@bridge)

      model.selection.add_observer(@sel_observer)
      model.add_observer(@model_observer)

      # Beim Modellwechsel Dashboard neu befüllen
      @bridge.call_js('onModelLoaded', {})
    end

  end

end
