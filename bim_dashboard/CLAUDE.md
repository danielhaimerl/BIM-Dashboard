BIM Dashboard – Claude Code Kontext
Projektübersicht
SketchUp-Plugin für bidirektionales BIM-Dashboard: Bauteilverwaltung, Tag-Klassifikation, Kostenauswertung. Entwickelt als Ruby-Plugin mit HtmlDialog (eingebetteter Chromium-Browser).
Repository: https://github.com/danielhaimerl/BIM-Dashboard  
SketchUp: 2024, Windows, Ruby 3.2.2
---
Dateistruktur
```
bim_dashboard.rb                ← SketchUp Extension Loader (Plugins-Root)
bim_dashboard/
├── core/
│   ├── bootstrap.rb            ← Konstanten, TAG_CATEGORIES, Ladereihenfolge
│   ├── tag_manager.rb          ← Tags lesen/schreiben auf Entities (ALL_TAG_KEYS)
│   ├── observer.rb             ← SelectionObserver, ModelObserver, AppObserver
│   ├── isolate.rb              ← Bauteile ein-/ausblenden (entity.visible=)
│   ├── quantity_calculator.rb  ← Mengen aus Geometrie (Transformation beachten!)
│   ├── cost_manager.rb         ← Kostenberechnung über preis_id → Bibliothek
│   ├── library_manager.rb      ← Wertelisten (Preise, Gewerke, KGs, Materialien)
│   └── model_builder.rb        ← Excel-Import → SketchUp-Gruppenstruktur
├── ui/
│   ├── dialog.rb               ← HtmlDialog + alle Ruby↔JS Callbacks
│   └── html/
│       ├── index.html          ← UI Shell, Navigation (Sidebar)
│       ├── app.js              ← State, Bauteilliste, Tag-Editor, Navigation
│       ├── report.js           ← Auswertung: Gruppierung, Filter, Kosten
│       ├── costs.js            ← Kosten-Binding, Mengenberechnung-Trigger
│       ├── library.js          ← Bibliotheksverwaltung (Preise, Gewerke etc.)
│       └── style.css           ← Helles Theme, CSS-Variablen
├── menu.rb                     ← SketchUp Menüeinträge inkl. "Import Struktur"
└── data/                       ← Wird zur Laufzeit erstellt (Preistabellen)
```
---
Tag-System
Klassifikations-Tags (TAG_CATEGORIES in bootstrap.rb)
Key	Bezeichnung
gewerk	Gewerk
din276	DIN 276 Kostengruppe
material	Material
stufe	Detaillierungsstufe (1/2/3)
preis_id	Preis (ID aus Bibliothek oder direkter €-Wert)
Kosten-Tags (COST_TAGS in bootstrap.rb)
Key	Bedeutung
einheit	Mengeneinheit (m², m³, m, Stück)
menge	Manuelle Menge (überschreibt menge_auto)
menge_auto	Automatisch berechnete Menge (readonly)
einheitspreis	Direkter EP-Wert (Fallback wenn kein preis_id)
preis_quelle	"bibliothek" oder "manuell"
ref_stufe2	Referenz auf Stufe-2-Fläche (geplant)
Speicherort
Alle Tags: `entity.attribute_dictionary('BimDashboard')`  
Bibliothek: `model.attribute_dictionary('BimDashboard_Library')` (JSON)  
Projektmeta: `model.attribute_dictionary('BimDashboard_Project')`
---
Bekannte Fallstricke & Lösungen
1. Skalierte Gruppen (KRITISCH)
SketchUp speichert skalierte Gruppen mit Transformationsmatrix.  
`face.area` gibt untransformierte Werte zurück — immer 1.0 m² bei 1×1m Platzhalter!
```ruby
# FALSCH:
area = face.area  # gibt immer rohe Geometrie zurück, ignoriert Skalierung

# RICHTIG:
t  = group.transformation
sx = t.xaxis.length   # Skalierungsfaktor X
sy = t.yaxis.length   # Skalierungsfaktor Y
sz = t.zaxis.length   # Skalierungsfaktor Z
area = face.area * sx * sy  # für horizontale Flächen
```
Für Volumen: Vertices mit sx/sy/sz multiplizieren vor Divergenz-Theorem.  
Implementiert in `core/quantity_calculator.rb` → `calculate_group_entities`.
2. HtmlDialog JS-Cache
SketchUp cached JS-Dateien aggressiv. Bei JS-Änderungen:
`preferences_key` in `ui/dialog.rb` erhöhen (aktuell 'bim_dashboard_v5')
SketchUp komplett neu starten (nicht nur Dialog schließen)
Niemals `_v3`-Suffix-Dateien anlegen — stattdessen direkt die Hauptdatei überschreiben
3. Windows-Pfade
`UI.openpanel` gibt Backslashes zurück → normalisieren:
```ruby
path = path.gsub('\\', '/')
```
4. Python für Excel-Import
Temp-Dateien in `Dir.tmpdir` schreiben, nicht PLUGIN_DIR:
```ruby
tmp_script = File.join(Dir.tmpdir, 'bim_parser.py')
```
5. pushpull – nur 1 Argument
```ruby
face.pushpull(-s)        # RICHTIG
face.pushpull(-s, true)  # FALSCH – ArgumentError in SU2024
```
6. State.reportFilters – Initialisierungsreihenfolge
`report.js` lädt nach `app.js`. `State` ist beim Laden von report.js noch nicht vollständig initialisiert.  
→ Immer lazy initialisieren: `if (!State.reportFilters) State.reportFilters = {}`
7. preis_id Auflösung
`preis_id` kann sein:
Bibliotheks-ID (`"p001"`) → Nachschlag in `State.library.preise`
Direkter Zahlenwert (`"800"`) → direkt als EP interpretieren
```javascript
const preisObj = preise.find(p => String(p.id).trim() === preisId);
if (preisObj) { ep = preisObj.ep; }
else { ep = parseFloat(preisId); }  // direkter Wert
```
---
Ruby↔JS Bridge
Ruby → JS
```ruby
DialogManager.call_js('functionName', { key: value })
# Aufruf: window.rubyBridge.functionName(data)
```
JS → Ruby
```javascript
ruby('callbackName', payload);
// in dialog.rb: @dialog.add_action_callback('callbackName') { |ctx, payload| }
```
Alle Callbacks (ui/dialog.rb)
`dialogReady` – initialer Datenladeaufruf
`getAllEntities` / `refreshModel`
`setTags` / `clearTags`
`selectEntities` / `zoomToSelection`
`calculateQuantities` – Mengen berechnen (auto, alle klassifizierten Entities)
`isolateEnable` / `isolateDisable`
`getLibrary` / `updateLibraryList` / `deleteLibraryEntry`
`saveProjectMeta`
`importProjectStructure` – Excel-Import
---
UI-Architektur
Navigation (Sidebar, 72px)
⬡ Klassifizieren → Bauteilliste + Tag-Editor
▤ Auswertung → Report mit Gruppierung, Filter, Kosten
☰ Bibliothek → Preise, Gewerke, KGs, Materialien
↑ Import → Excel-Projektstruktur importieren
State (app.js)
```javascript
State = {
  entities:       [],      // alle Bauteile aus Modell
  categories:     {},      // TAG_CATEGORIES
  library:        {},      // Bibliothek (preise, gewerke, etc.)
  selectedIds:    Set,     // aktuelle Selektion
  groupBy:        [],      // Gruppierung für Auswertung
  tagFilters:     {},      // Filter in Bauteilliste
  reportFilters:  {},      // Filter in Auswertung
  isolateActive:  false,
  isolateCat:     null,
}
```
---
Detaillierungsstufen
Stufe	Inhalt	Geometrie	Menge
1	Kennwerte (BGF, BRI)	Fläche/Volumen skaliert	m², m³
2	Flächen DIN 276	Fläche skaliert	m²
3	Echte Bauteile	Reale Geometrie	je nach Typ
---
Mengenberechnung (quantity_calculator.rb)
Reihenfolge der Ermittlung:
`einheit`-Tag bestimmt Methode (m³ → Volumen, m² → Fläche, m → Länge)
Stück → immer 1 pro Bauteil
m → längste skalierte Ausdehnung (Bounding Box), nicht Summe aller Kanten
Transformation (sx, sy, sz) aus `group.transformation` extrahieren
Solid? → Divergenz-Theorem mit transformierten Vertices
Faces? → `face.area * sx * sy` (für horizontale Flächen)
Edges? → `edge.length * sx`
Fallback: Stück (1.0, reliable: false)
Automatisch beim Start: `auto_calculate_quantities` in `setup_bridge` (dialogReady)  
Manuell: ⊞ Mengen-Button im Panel-Header
---
Installation (Entwicklung)
Symlink (einmalig, als Administrator in CMD):
```cmd
mklink /D "C:\Users\dahaimerl\AppData\Roaming\SketchUp\SketchUp 2024\SketchUp\Plugins\bim_dashboard" "C:\Pfad\zum\repo\bim_dashboard"
```
Dann `bim_dashboard.rb` separat kopieren oder ebenfalls symlinken.
Reload nach Änderungen (Ruby-Konsole in SketchUp):
```ruby
load 'bim_dashboard.rb'
BimDashboard::DialogManager.close
BimDashboard::DialogManager.show
```
Bei JS-Änderungen zusätzlich:
`preferences_key` in `ui/dialog.rb` erhöhen
SketchUp komplett neu starten
---
Kosten-Workflow
Bibliothek → Preise anlegen (Bezeichnung, Einheit, EP)
Klassifizieren → Bauteil anklicken → Preis aus Dropdown wählen → Speichern
⊞ Mengen → automatisch beim Start oder manuell neu berechnen
Auswertung → Gruppierung wählen → Menge × EP = GB erscheint automatisch
---
Offene Punkte
Mengenberechnung für skalierte Gruppen: Transformations-Fix implementiert, noch nicht vollständig verifiziert
Räumliche Zuordnung Stufe 3 → Stufe 2 (noch nicht implementiert)
Excel-Import/Export für Bibliothek (Platzhalter in library_manager.rb)
Manuelle Mengeneingabe im Tag-Editor (Feld vorhanden, Integration unvollständig)
