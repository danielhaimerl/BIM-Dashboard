# Bauteil-Export für den Abgleich Modell <-> PDF-Pläne.
# Aufruf in der SketchUp-Ruby-Konsole:
#   load File.join(Sketchup.find_support_file('Plugins'), 'bim_dashboard', 'tools', 'bauteile_export.rb')
# Schreibt bauteile_export.csv in denselben tools-Ordner.
#
# Ein Bauteil = Komponenten-Instanz oder Gruppe ohne Unter-Gruppen (wie Bauteilliste).
# Maße in cm, inkl. Skalierung aller übergeordneten Gruppen.

module BimDashboard
  module BauteilExport
    CM = 2.54

    def self.run
      rows = []
      walk(Sketchup.active_model.entities, Geom::Transformation.new, [], rows)
      path = File.join(__dir__, 'bauteile_export.csv')
      File.open(path, 'w:UTF-8') do |f|
        f.puts %w[Pfad Name Tag Gewerk DIN276 Material
                  Laenge_X Breite_Y Hoehe_Z
                  Min_X Min_Y Min_Z Max_X Max_Y Max_Z Drehung_Grad].join(';')
        rows.each { |r| f.puts r.join(';') }
      end
      puts "#{rows.size} Bauteile exportiert: #{path}"
    end

    def self.walk(entities, parent_t, path, rows)
      entities.each do |e|
        next unless e.is_a?(Sketchup::Group) || e.is_a?(Sketchup::ComponentInstance)
        t = parent_t * e.transformation
        name = e.name.to_s.empty? ? e.definition.name : e.name
        children = e.definition.entities.select { |c| c.is_a?(Sketchup::Group) || c.is_a?(Sketchup::ComponentInstance) }
        if e.is_a?(Sketchup::Group) && !children.empty?
          walk(e.definition.entities, t, path + [name], rows)
        else
          rows << row(e, t, path, name)
        end
      end
    end

    def self.row(e, t, path, name)
      bb = e.definition.bounds
      # Maße in lokalen Achsen (richtig auch bei gedrehten Wänden)
      dims = [bb.width * t.xaxis.length, bb.height * t.yaxis.length, bb.depth * t.zaxis.length]
      # Lage im Modell (achsparallele Hülle)
      pts = (0..7).map { |i| bb.corner(i).transform(t) }
      min = [0, 1, 2].map { |k| pts.map { |p| p[k] }.min }
      max = [0, 1, 2].map { |k| pts.map { |p| p[k] }.max }
      rot = Math.atan2(t.xaxis.y, t.xaxis.x) * 180 / Math::PI
      tag = ->(k) { e.get_attribute('BimDashboard', k).to_s }
      [path.join(' / '), name, e.layer.name, tag.('gewerk'), tag.('din276'), tag.('material'),
       *dims.map { |v| num(v * CM) }, *min.map { |v| num(v * CM) }, *max.map { |v| num(v * CM) },
       num(rot)].map { |v| v.to_s.tr(';', ',') }
    end

    def self.num(v)
      format('%.1f', v).tr('.', ',')
    end
  end
end

BimDashboard::BauteilExport.run
