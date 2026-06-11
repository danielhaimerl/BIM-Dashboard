# BIM Dashboard – Claude Code Kontext

## Projektstruktur

```
bim_dashboard.rb                ← SketchUp Extension Loader (liegt im Plugins-Root)
bim_dashboard/
├── core/
│   ├── bootstrap.rb            ← Konstanten, Ladereihenfolge
│   ├── tag_manager.rb          ← Tags lesen/schreiben auf SketchUp-Entities
│   ├── observer.rb             ← SelectionObserver, ModelObserver
│   ├── isolate.rb              ← Bauteile ein-/ausblenden
│   ├── quantity_calculator.rb  ← Mengen aus Geometrie (Transformation beachten!)
│   ├── cost_manager.rb         ← Kostenberechnung
│   ├── library_manager.rb      ← Wertelisten (Preise, Gewerke, KGs, Materialien)
│   └── model_builder.rb        ← Excel-Import → SketchUp-Struktur erstellen
├── ui/
│   ├── dialog.rb               ← HtmlDialog + alle Ruby↔JS Callbacks
│   └── html/
│       ├── index.html          ← UI Shell
│       ├── app.js              ← State, Bauteilliste, Tag-Editor
│       ├── report.js           ← Auswertung mit Kosten
│       ├── costs.js            ← Kostenberechnung JS-Seite
│       ├── library.js          ← Bibliotheksverwaltung
│       └── style.css           ← Helles Theme
├── menu.rb                     ← SketchUp Menüeinträge
└── data/                       ← Preistabellen-Daten (wird zur Laufzeit erstellt)
```

## Wichtige Hinweise für Claude Code

### SketchUp-spezifisch
- Ruby läuft in SketchUp 2024 (Ruby 3.2.2, Windows)
- Geometrie in Zoll, Umrechnung: 1m = 39.3701 Zoll
- **Skalierte Gruppen**: face.area gibt untransformierte Werte → transformation.xaxis.length etc. für Skalierung
- HtmlDialog cached JS aggressiv → preferences_key erhöhen bei JS-Änderungen
- Ruby↔JS: Ruby schreibt via execute_script(), JS ruft via sketchup.callback() auf

### Bekannte Fallstricke
- `pushpull` akzeptiert nur 1 Argument (kein zweites `true`)
- Windows-Pfade: Backslashes müssen zu Forward-Slashes konvertiert werden
- Python-Skripte für Excel-Import in Dir.tmpdir schreiben (nicht PLUGIN_DIR)
- State.reportFilters lazy initialisieren (report.js lädt nach app.js)

### Ruby↔JS Bridge
- Ruby → JS: `DialogManager.call_js('functionName', data)`
- JS → Ruby: `sketchup.callbackName(JSON.stringify(payload))`
- Alle Callbacks in `ui/dialog.rb` unter `setup_callbacks`

### Tag-Kategorien
Klassifikation: gewerk, din276, material, stufe, preis_id
Kosten: einheit, menge, menge_auto, einheitspreis, preis_quelle, ref_stufe2
Alle Keys: ALL_TAG_KEYS in bootstrap.rb

## Installation (Entwicklung)
Symlink oder Kopie von `bim_dashboard/` und `bim_dashboard.rb` 
nach `C:/Users/.../AppData/Roaming/SketchUp/SketchUp 2024/SketchUp/Plugins/`

## Testen
In SketchUp Ruby-Konsole:
```ruby
load 'bim_dashboard.rb'
BimDashboard::DialogManager.show
```
