# =============================================================================
# BIM Dashboard – Gliederung schreiben
# Datei: core/outliner.rb
#
# Hängt Bauteile in verschachtelte Gruppen nach der Gruppierung der Auswertung
# (z. B. 300 > 330 > 331). Gruppen und Komponenten werden in der Zielgruppe neu
# erzeugt (gleiche Definition, Lage, Name, Tag, Material, Attribute) und am alten
# Ort gelöscht. Leer gewordene Gruppen werden entfernt. Alles in einer
# Undo-Operation.
# =============================================================================

module BimDashboard
  module Outliner

    # rows: [{ 'id' => entityID, 'path' => ['300 …', '330 …', '331 …'] }, …]
    # Rückgabe: { moved:, skipped: }
    #
    # Kopierte Gruppen teilen sich ihren Inhalt: Ein Bauteil darin ist dieselbe Entity,
    # kommt im Modell aber mehrfach vor. Deshalb wird jedes Vorkommen einzeln an seiner
    # Lage neu erzeugt und das Original erst danach einmal gelöscht.
    def self.write(rows)
      model = Sketchup.active_model
      Isolate.disable if Isolate.active?

      paths = {}
      rows.each { |r| paths[r['id'].to_i] = r['path'] }
      # [entity, path, welt_transformation] je Vorkommen im Modell
      occurrences = TagManager.collect_all_entities(model).select { |e, _p, _t| paths.key?(e.entityID) }

      moved = 0
      skipped = 0
      originals = []

      model.start_operation('Gruppierung in Gliederung schreiben', true)
      begin
        occurrences.each do |e, _p, t|
          unless (e.is_a?(Sketchup::Group) || e.is_a?(Sketchup::ComponentInstance)) && !e.locked?
            skipped += 1
            next
          end

          target = target_group(model, paths[e.entityID])
          next if e.parent == target.definition  # liegt schon richtig

          copy = target.entities.add_instance(e.definition, t)
          copy.name     = e.name
          copy.layer    = e.layer
          copy.material = e.material
          copy.hidden   = e.hidden?
          (e.attribute_dictionaries || []).each do |dict|
            dict.each_pair { |k, v| copy.set_attribute(dict.name, k, v) }
          end
          originals << e
          moved += 1
        end

        originals.uniq!
        old_parents = originals.map(&:parent).uniq
        originals.each { |e| e.erase! if e.valid? }
        remove_empty_groups(old_parents)
        model.commit_operation
      rescue => err
        model.abort_operation
        raise err
      end

      { moved: moved, skipped: skipped }
    end

    # Färbt Bauteile ein. colors: [{ 'name' => 'BIM 300 › 330', 'rgb' => [r,g,b], 'ids' => [...] }, …]
    # Je Farbe ein Material; bestehende Materialien gleichen Namens werden aktualisiert.
    # Farben im Inneren der Bauteile (Flächen, verschachtelte Gruppen) werden entfernt.
    def self.colorize(colors)
      model = Sketchup.active_model
      count = 0
      model.start_operation('Modell nach Gruppierung einfärben', true)
      begin
        colors.each do |c|
          mat = model.materials[c['name']] || model.materials.add(c['name'])
          mat.color = Sketchup::Color.new(*c['rgb'])
          c['ids'].each do |id|
            e = model.find_entity_by_id(id.to_i)
            next unless e && e.valid? && e.respond_to?(:material=)
            if e.is_a?(Sketchup::Group) || e.is_a?(Sketchup::ComponentInstance)
              e.make_unique if e.is_a?(Sketchup::Group)
              clear_materials(e.definition.entities)
            end
            e.material = mat
            count += 1
          end
        end
        model.commit_operation
      rescue => err
        model.abort_operation
        raise err
      end
      count
    end

    # Entfernt Materialien im Inneren, damit die Farbe des Bauteils überall sichtbar wird
    def self.clear_materials(entities)
      entities.each do |c|
        case c
        when Sketchup::Face
          c.material = nil
          c.back_material = nil
        when Sketchup::Group, Sketchup::ComponentInstance
          c.material = nil
          clear_materials(c.definition.entities)
        end
      end
    end

    # Sucht/erzeugt die verschachtelten Gruppen für einen Pfad ab Modell-Ebene
    def self.target_group(model, path)
      entities = model.entities
      group = nil
      path.each do |name|
        # Nur bestehende Ordner-Gruppen wiederverwenden, nie ein Bauteil
        group = entities.grep(Sketchup::Group).find { |g| g.name == name && folder?(g) }
        unless group
          group = entities.add_group
          group.name = name
        end
        entities = group.entities
      end
      group
    end

    def self.folder?(group)
      group.entities.any? { |c| c.is_a?(Sketchup::Group) || c.is_a?(Sketchup::ComponentInstance) }
    end

    # Entfernt Gruppen, die durch das Umhängen leer geworden sind (auch übergeordnete,
    # und alle Kopien einer leeren Gruppe)
    def self.remove_empty_groups(parents)
      queue = parents.dup
      until queue.empty?
        parent = queue.shift
        next unless parent.is_a?(Sketchup::ComponentDefinition) && parent.valid? && parent.group? &&
                    parent.entities.length == 0
        parent.instances.dup.each do |inst|
          queue << inst.parent
          inst.erase!
        end
      end
    end

  end
end
