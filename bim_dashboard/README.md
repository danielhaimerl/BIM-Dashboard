# BIM Dashboard – SketchUp Plugin

Bidirektionales Bauteilverwaltungs-Dashboard für SketchUp.

---

## Installation

1. Gesamten Ordner `bim_dashboard/` in das SketchUp-Plugin-Verzeichnis kopieren:

   | Betriebssystem | Plugin-Pfad |
   |---|---|
   | Windows | `C:\Users\<Name>\AppData\Roaming\SketchUp\SketchUp 20xx\SketchUp\Plugins\` |
   | macOS   | `~/Library/Application Support/SketchUp 20xx/SketchUp/Plugins/` |

2. Zusätzlich die Datei `bim_dashboard.rb` (die Loader-Datei im Wurzelverzeichnis) in den Plugins-Ordner kopieren – sie liegt **neben** dem Ordner, nicht darin.

   Korrekte Struktur im Plugins-Ordner:
   ```
   Plugins/
   ├── bim_dashboard.rb          ← Loader
   └── bim_dashboard/            ← Plugin-Ordner
       ├── core/
       ├── ui/
       └── menu.rb
   ```

3. SketchUp neu starten.

4. Plugin aktivieren: **Fenster → Erweiterungsverwaltung → BIM Dashboard ✓**

5. Dashboard öffnen: **Erweiterungen → BIM Dashboard → Dashboard öffnen**

---

## Dateistruktur

```
bim_dashboard.rb                ← Entry Point / SketchupExtension
bim_dashboard/
├── core/
│   ├── bootstrap.rb            ← Modul-Init, Konstanten, Lade-Reihenfolge
│   ├── observer.rb             ← Selection- & ModelObserver
│   └── tag_manager.rb          ← Tag lesen/schreiben auf Entities
├── ui/
│   ├── dialog.rb               ← HtmlDialog + Ruby↔JS Bridge (alle Callbacks)
│   ├── icons/                  ← (optional) Toolbar-Icons (16x16 + 24x24 PNG)
│   └── html/
│       ├── index.html          ← UI-Shell
│       ├── app.js              ← Bauteilliste, Tag-Editor, State, Bridge
│       ├── report.js           ← Report-Rendering, Gruppierung, Export
│       └── style.css           ← Dark-Theme UI
├── menu.rb                     ← SketchUp-Menü & Toolbar
└── README.md                   ← Diese Datei
```

---

## Funktionsübersicht

### Bidirektionale Selektion
- **SketchUp → Dashboard**: Selektierte Entities werden in der Bauteilliste hervorgehoben
- **Dashboard → SketchUp**: Klick/Checkbox in der Liste selektiert Entities im Modell
- Mehrfachselektion: Shift, Ctrl/Cmd, Drag-Select in SketchUp, Checkbox-Batch in Liste

### Tag-Klassifikation
Vordefinierte Kategorien in `core/bootstrap.rb` (erweiterbar):

| Schlüssel | Bezeichnung |
|---|---|
| `gewerk` | Gewerk |
| `din276` | DIN 276 Kostengruppe |
| `material` | Material |
| `phase` | Bauphase |
| `status` | Status |
| `custom` | Benutzerdefiniert |

Tags werden als `AttributeDictionary` direkt auf den Entities gespeichert –
persistent im `.skp`-Modell.

### Report
- Verschachtelte Gruppierung (bis zu 3 Ebenen kombinierbar)
- Zusammenfassungstabellen pro Gruppe
- Export als CSV und JSON

### Sync / Aktualisieren
- `ModelObserver` zeigt an wenn das Modell geändert wurde
- Aktualisieren-Button lädt alle Entities neu ohne SketchUp zu blockieren

---

## Kategorien anpassen

In `core/bootstrap.rb` die Konstante `TAG_CATEGORIES` erweitern:

```ruby
TAG_CATEGORIES = {
  'gewerk'       => 'Gewerk',
  'din276'       => 'DIN 276 Kostengruppe',
  'material'     => 'Material',
  'phase'        => 'Bauphase',
  'status'       => 'Status',
  'custom'       => 'Benutzerdefiniert',
  'lieferant'    => 'Lieferant',        # eigene Kategorie
  'garantie'     => 'Garantiezeit',     # eigene Kategorie
}.freeze
```

Das Dashboard liest die Kategorien beim Start und baut Formulare und Selects dynamisch.

---

## Debugging

Ruby-Konsole in SketchUp: **Fenster → Ruby-Konsole**

```ruby
# Alle Entities mit Tags ausgeben
BimDashboard::TagManager.collect_all_entities.each do |e, path|
  tags = BimDashboard::TagManager.get_tags(e)
  puts "#{e.class}: #{tags}" unless tags.empty?
end

# Dashboard neu öffnen
BimDashboard::DialogManager.show
```

JS-Logs erscheinen in der Ruby-Konsole (via `jsLog`-Callback).
