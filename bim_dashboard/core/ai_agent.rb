# =============================================================================
# BIM Dashboard – AI Agent
# Datei: core/ai_agent.rb
# =============================================================================

require 'net/http'
require 'net/https'
require 'json'
require 'uri'
require 'openssl'

module BimDashboard
  module AiAgent

    API_URL = 'https://api.anthropic.com/v1/messages'.freeze
    MODEL   = 'claude-haiku-4-5-20251001'.freeze

    def self.ask(question, model_context, api_key, history = [])
      messages = history.map { |m| { 'role' => m['role'], 'content' => m['content'] } }
      messages << { 'role' => 'user', 'content' => question }

      body = {
        'model'      => MODEL,
        'max_tokens' => 1024,
        'system'     => build_system_prompt(model_context),
        'messages'   => messages,
      }.to_json

      ask_via_curl(body, api_key)
    rescue => e
      { success: false, error: e.message }
    end

    # Nutzt Windows-eigenes curl.exe mit system() + Dateiausgabe
    # Open3.capture3 funktioniert in SketchUp's Ruby unter Windows nicht zuverlässig
    def self.ask_via_curl(body_json, api_key)
      require 'tempfile'

      curl = find_curl
      return { success: false, error: 'curl.exe nicht gefunden. Windows 10+ erforderlich.' } unless curl

      # Body und Ausgabe als Temp-Dateien
      body_tmp = Tempfile.new(['bim_body_', '.json'])
      body_tmp.write(body_json)
      body_tmp.close
      out_path = File.join(Dir.tmpdir, "bim_curl_#{Thread.current.object_id}.json")

      body_win = body_tmp.path.gsub('/', '\\')
      out_win  = out_path.gsub('/', '\\')
      curl_win = curl.gsub('/', '\\')
      err_path = File.join(Dir.tmpdir, "bim_curl_err_#{Thread.current.object_id}.txt")
      err_win  = err_path.gsub('/', '\\')

      cmd = "\"#{curl_win}\" --silent --show-error --max-time 90 " \
            "-X POST " \
            "-H \"Content-Type: application/json\" " \
            "-H \"x-api-key: #{api_key}\" " \
            "-H \"anthropic-version: 2023-06-01\" " \
            "--data-binary \"@#{body_win}\" " \
            "\"#{API_URL}\" " \
            "-o \"#{out_win}\" " \
            "--stderr \"#{err_win}\""

      ok = system(cmd)
      body_tmp.unlink rescue nil

      unless File.exist?(out_path)
        err_msg = File.exist?(err_path) ? File.read(err_path, encoding: 'utf-8').strip : '(kein Fehlertext)'
        File.delete(err_path) rescue nil
        return { success: false, error: "curl fehlgeschlagen (exit: #{ok.inspect}): #{err_msg}" }
      end

      raw = File.read(out_path, encoding: 'utf-8')
      File.delete(out_path) rescue nil
      File.delete(err_path) rescue nil

      data = JSON.parse(raw)
      if data['type'] == 'error'
        msg = (data.dig('error', 'message') || raw)[0..300]
        return { success: false, error: "API-Fehler: #{msg}" }
      end
      { success: true, content: data['content'][0]['text'] }
    rescue => e
      { success: false, error: e.message }
    ensure
      body_tmp&.unlink rescue nil
      File.delete(out_path) rescue nil if defined?(out_path)
    end

    def self.find_curl
      candidates = [
        'C:/Windows/System32/curl.exe',
        'C:/Windows/SysWOW64/curl.exe',
      ]
      candidates.each { |p| return p if File.exist?(p) }
      (ENV['PATH'] || '').split(';').each do |dir|
        c = File.join(dir.strip, 'curl.exe')
        return c if File.exist?(c)
      end
      nil
    end

    def self.build_system_prompt(ctx)
      entities = ctx['entities'] || []
      project  = ctx['project']  || {}
      bgf      = ctx['bgf'].to_s.empty? ? '—' : ctx['bgf']
      bri      = ctx['bri'].to_s.empty? ? '—' : ctx['bri']
      name     = project['name'] || 'Unbenanntes Projekt'

      # Strukturiere Entities nach Gewerk
      by_gewerk = entities.group_by { |e| (e['tags'] || {})['gewerk'] || '(kein Gewerk)' }

      detail = by_gewerk.sort_by { |k, _| k }.map do |gewerk, ents|
        items = ents.map do |e|
          tags   = e['tags'] || {}
          menge  = e['menge_auto'].to_s.empty? ? (tags['menge'] || '') : e['menge_auto']
          stufe  = tags['stufe'] ? "Stufe #{tags['stufe']}" : ''
          din    = tags['din276'] ? "KG#{tags['din276']}" : ''
          preis  = tags['preis_id'] || tags['einheitspreis'] || ''
          meta   = [stufe, din, preis].reject(&:empty?).join(', ')
          "  • #{e['name']}: #{menge}#{meta.empty? ? '' : " [#{meta}]"}"
        end.join("\n")
        "### #{gewerk} (#{ents.length})\n#{items}"
      end.join("\n\n")

      # Kostensumme berechnen
      total_cost = entities.sum do |e|
        tags = e['tags'] || {}
        ep   = (tags['einheitspreis'] || '').to_f
        ep   = tags['preis_id'].to_f if ep == 0
        menge_str = e['menge_auto'].to_s
        menge = menge_str.match(/[\d.,]+/)&.[](0)&.gsub(',', '.').to_f || 0
        ep * menge
      end

      <<~PROMPT
        Du bist ein erfahrener BIM-Assistent für das Bauprojekt "#{name}".
        Du hilfst bei Fragen zu Bauteilen, Mengen, Kosten und Klassifikationen.
        Antworte auf Deutsch, präzise und fachlich korrekt.
        Nutze Markdown für Formatierungen (Listen, Fettdruck, Tabellen).

        ## Projekteckdaten
        - BGF (Bruttogrundfläche): #{bgf} m²
        - BRI (Bruttorauminhalt): #{bri} m³
        - Bauteile gesamt: #{entities.length}
        - Geschätzte Gesamtkosten: #{total_cost > 0 ? "#{total_cost.round.to_s.reverse.gsub(/(\d{3})(?=\d)/, '\1.')\
            .reverse} €" : '—'}

        ## Modelldaten
        #{detail}
      PROMPT
    end

    def self.get_api_key
      Sketchup.active_model.get_attribute(DICT_PROJECT, 'ai_api_key', '').to_s
    end

    def self.set_api_key(key)
      Sketchup.active_model.set_attribute(DICT_PROJECT, 'ai_api_key', key.to_s.strip)
    end

    def self.has_api_key?
      !get_api_key.empty?
    end

  end
end
