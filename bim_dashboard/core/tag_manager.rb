# =============================================================================
# BIM Dashboard – Tag Manager
# Datei: core/tag_manager.rb
# =============================================================================

module BimDashboard
  module TagManager

    def self.get_tags(entity)
      dict = entity.attribute_dictionary(DICT_NAME)
      return {} unless dict
      result = {}
      ALL_TAG_KEYS.each do |key|
        val = dict[key]
        result[key] = val if val && !val.empty?
      end
      result
    end

    def self.set_tags(entity, tags_hash)
      tags_hash.each do |key, value|
        next unless ALL_TAG_KEYS.include?(key)
        if value.nil? || value.to_s.empty?
          entity.delete_attribute(DICT_NAME, key)
        else
          entity.set_attribute(DICT_NAME, key, value.to_s)
        end
      end
    end

    def self.set_tags_batch(entities, tags_hash)
      model = Sketchup.active_model
      model.start_operation('BIM Tags setzen', true)
      begin
        entities.each { |e| set_tags(e, tags_hash) }
        model.commit_operation
      rescue => e
        model.abort_operation
        raise e
      end
    end

    def self.clear_tags(entity)
      entity.delete_attribute(DICT_NAME)
    end

    def self.collect_all_entities(model = Sketchup.active_model)
      results = []
      traverse_entities(model.entities, results, [], 0, Geom::Transformation.new)
      results
    end

    def self.entity_to_hash(entity, path = [])
      tags = get_tags(entity)
      {
        'id'           => entity.entityID,
        'name'         => entity_name(entity),
        'type'         => entity.class.to_s.split('::').last,
        'layer'        => (entity.layer.name rescue 'Default'),
        'path'         => path,
        'tags'         => tags,
        'persistent_id'=> entity.persistent_id.to_s,
        'menge_auto'   => entity.get_attribute(DICT_NAME, 'menge_auto').to_s,
      }
    end

    def self.all_entities_as_json
      require 'json'
      entities = collect_all_entities
      entities.each_with_index.map do |(e, path, _world_t), i|
        entity_to_hash(e, path).merge('list_id' => "#{e.entityID}_#{i}")
      end.to_json
    end

    # Gibt alle eindeutigen Werte einer Kategorie zurück (für Dropdowns)
    def self.distinct_values(category)
      collect_all_entities
        .map { |e, _path, _t| e.get_attribute(DICT_NAME, category).to_s }
        .reject(&:empty?)
        .uniq
        .sort
    end

    private

    # Traversiert rekursiv und akkumuliert die Welt-Transformation über alle Eltern.
    # Bauteile: Gruppen ohne Unterelemente (Gruppen mit Unterelementen nur als Ordner)
    # und jede Komponenten-Instanz als Ganzes (ihr Inhalt wird nicht einzeln gelistet).
    # Jedes Ergebnis-Tupel: [entity, path, world_transform]
    # Die world_transform wird in der Mengenberechnung verwendet, damit Skalierungen
    # übergeordneter Container-Gruppen korrekt berücksichtigt werden.
    def self.traverse_entities(entities, results, path, depth = 0, world_transform = Geom::Transformation.new)
      entities.each do |e|
        case e
        when Sketchup::Group
          local_to_world = world_transform * e.transformation
          has_sub_groups = e.entities.any? { |c| c.is_a?(Sketchup::Group) || c.is_a?(Sketchup::ComponentInstance) }
          results << [e, path.dup, local_to_world] unless has_sub_groups
          traverse_entities(e.entities, results, path + [entity_name(e)], depth + 1, local_to_world)
        when Sketchup::ComponentInstance
          results << [e, path.dup, world_transform * e.transformation]
        when Sketchup::Face, Sketchup::Edge
          tags = get_tags(e)
          results << [e, path.dup, world_transform] unless tags.empty?
        end
      end
    end

    def self.entity_name(entity)
      case entity
      when Sketchup::Group
        entity.name.empty? ? "Gruppe ##{entity.entityID}" : entity.name
      when Sketchup::ComponentInstance
        entity.name.empty? ? entity.definition.name : entity.name
      else
        "#{entity.class.to_s.split('::').last} ##{entity.entityID}"
      end
    end

  end
end
