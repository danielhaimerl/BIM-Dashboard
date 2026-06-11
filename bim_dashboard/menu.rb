# =============================================================================
# BIM Dashboard – Menü
# Datei: menu.rb
# =============================================================================

module BimDashboard

  unless file_loaded?(__FILE__)

    menu = UI.menu('Extensions').add_submenu('BIM Dashboard')

    # --- Import Struktur (ganz oben) ---
    menu.add_item('Import Struktur…') do
      path = UI.openpanel('Projektstruktur importieren (Excel)', '', 'Excel-Datei|*.xlsx||')
      next unless path && File.exist?(path)
      path = path.gsub('\\', '/')  # Windows-Backslashes normalisieren

      result = ModelBuilder.import_from_excel(path)

      if result[:success]
        s = result[:stats]
        warn_text = s[:errors].any? ? "\n\nWarnungen (#{s[:errors].size}):\n#{s[:errors].first(3).join("\n")}" : ''
        UI.messagebox(
          "✓ Import erfolgreich\n\n" \
          "Gruppen erstellt:   #{s[:groups]}\n" \
          "Bauteile erstellt:  #{s[:geometries]}#{warn_text}"
        )
        # Dashboard aktualisieren falls offen
        if DialogManager.instance_variable_get(:@dialog)&.visible?
          DialogManager.show
        end
      else
        UI.messagebox("✗ Import fehlgeschlagen\n\n#{result[:error]}")
      end
    end

    menu.add_separator

    # --- Dashboard ---
    menu.add_item('Dashboard öffnen') do
      DialogManager.show
    end

    menu.add_item('Dashboard schließen') do
      DialogManager.close
    end

    menu.add_separator

    menu.add_item('Über BIM Dashboard') do
      UI.messagebox("BIM Dashboard v#{VERSION}\n\nBidirektionale Bauteilverwaltung für SketchUp.\nTags, Klassifikation, Kosten und Reports.")
    end

    # Toolbar
    toolbar  = UI::Toolbar.new('BIM Dashboard')
    icon_dir = File.join(PLUGIN_DIR, 'ui', 'icons')

    if File.exist?(File.join(icon_dir, 'dashboard_24.png'))
      cmd = UI::Command.new('BIM Dashboard') { DialogManager.show }
      cmd.small_icon      = File.join(icon_dir, 'dashboard_16.png')
      cmd.large_icon      = File.join(icon_dir, 'dashboard_24.png')
      cmd.tooltip         = 'BIM Dashboard öffnen'
      cmd.status_bar_text = 'BIM Dashboard – Bauteilverwaltung'
      toolbar.add_item(cmd)
      toolbar.restore
    end

    file_loaded(__FILE__)
  end

end
