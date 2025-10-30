import os
import sys
import certifi
import google.generativeai as genai
from flask import Flask, request, jsonify, render_template, send_from_directory
from dotenv import load_dotenv
import webview
import threading
import time
import json
from datetime import datetime
import uuid
import subprocess
from google.cloud import texttospeech
import math
from google.generativeai import types
import base64
import wave

load_dotenv()

os.environ['GRPC_DEFAULT_SSL_ROOTS_FILE_PATH'] = certifi.where()
os.environ['GRPC_ENABLE_FORK_SUPPORT'] = "false"

def resource_path(relative_path):
    """ Get absolute path to resource, works for dev and for PyInstaller """
    try:
        # PyInstaller creates a temp folder and stores path in _MEIPASS
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")

    return os.path.join(base_path, relative_path)

template_folder = resource_path('templates')
static_folder = resource_path('static')
app = Flask(__name__, template_folder=template_folder, static_folder=static_folder)

# --- CONFIGURAÇÃO INICIAL DO TTS ---
CREDENTIALS_FILE = "gcp_credentials.json"

if os.path.exists(CREDENTIALS_FILE):
    os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = os.path.abspath(CREDENTIALS_FILE)
    print(f"Autenticação do Google Cloud configurada com '{CREDENTIALS_FILE}'.")
    GCP_ENABLED = True
else:
    print(f"AVISO: Arquivo de credenciais '{CREDENTIALS_FILE}' não encontrado. As vozes do Google não estarão disponíveis.")
    GCP_ENABLED = False

if not os.path.exists('static/audio'):
    os.makedirs('static/audio')
if not os.path.exists('temp_audio'):
    os.makedirs('temp_audio')

JOBS = {}

# --- FUNÇÕES DE TTS E PROCESSAMENTO DE ÁUDIO ---

def get_gemini_voices():
    # NOTE: This is a hardcoded list.
    # In the future, we should query the Gemini API for available voices.
    return [
        {'id': 'pt-BR-Wavenet-B', 'name': 'Gemini Schedar (Masc)'},
        {'id': 'pt-BR-Wavenet-A', 'name': 'Gemini Sulafat (Fem)'},
        {'id': 'pt-BR-Wavenet-D', 'name': 'Gemini Umbriel (Masc)'},
        {'id': 'pt-BR-Wavenet-C', 'name': 'Gemini Aoede (Fem)'},
    ]

def get_available_voices():
    voices = []
    if GCP_ENABLED:
        try:
            client = texttospeech.TextToSpeechClient()
            response = client.list_voices(language_code="pt") # Busca todas as variantes de PT
            for voice in response.voices:
                gender = texttospeech.SsmlVoiceGender(voice.ssml_gender).name
                gender_pt = "Fem" if gender == 'FEMALE' else "Masc" if gender == 'MALE' else ""
                display_name = f"{voice.name} ({gender_pt})"
                voices.append({'id': voice.name, 'name': display_name})
        except Exception as e:
            print(f"Erro ao buscar vozes do Google Cloud: {e}")
            voices.append({'id': 'gcp_error', 'name': 'Erro ao conectar com a API do Google.'})
    else:
        voices.append({'id': 'gcp_disabled', 'name': 'Google Cloud desativado. Verifique as credenciais.'})

    voices.extend(get_gemini_voices())
    return voices

def split_text(long_text, max_chars=4500):
    """Divide o texto longo em pedaços menores para a API do Google."""
    paragraphs = [p.strip() for p in long_text.split('\n') if p.strip()]
    chunks = []
    for p in paragraphs:
        if len(p) > max_chars:
            for i in range(0, len(p), max_chars):
                chunks.append(p[i:i+max_chars])
        else:
            chunks.append(p)
    return chunks

def process_long_audio(job_id, text, voice_id, rate, volume, pitch):
    try:
        if not GCP_ENABLED:
            raise Exception(f"Google Cloud não está habilitado. Verifique o arquivo {CREDENTIALS_FILE}.")

        client = texttospeech.TextToSpeechClient()
        chunks = split_text(text)
        total_chunks = len(chunks)
        JOBS[job_id].update({'status': 'processing', 'total': total_chunks})
        
        temp_files = []
        for i, chunk in enumerate(chunks):
            synthesis_input = texttospeech.SynthesisInput(text=chunk)
            voice = texttospeech.VoiceSelectionParams(language_code="pt-BR", name=voice_id)
            
            speaking_rate = float(rate) / 175.0 
            speaking_rate = max(0.25, min(4.0, speaking_rate))
            
            volume_gain_db = (float(volume) * 20.0) - 20.0

            audio_config = texttospeech.AudioConfig(
                audio_encoding=texttospeech.AudioEncoding.LINEAR16,
                sample_rate_hertz=24000,
                speaking_rate=speaking_rate,
                pitch=float(pitch),
                volume_gain_db=volume_gain_db
            )

            response = client.synthesize_speech(input=synthesis_input, voice=voice, audio_config=audio_config)
            
            temp_filename = os.path.join('temp_audio', f"{job_id}_chunk_{i}.wav")
            with open(temp_filename, "wb") as out:
                out.write(response.audio_content)
            
            temp_files.append(os.path.abspath(temp_filename))
            JOBS[job_id]['progress'] = i + 1

        JOBS[job_id]['status'] = 'merging'
        list_filename = os.path.join('temp_audio', f"{job_id}_filelist.txt")
        with open(list_filename, 'w') as f:
            for temp_file in temp_files:
                f.write(f"file '{temp_file.replace(os.path.sep, '/')}'\n")

        final_filename = f"{job_id}.mp3"
        final_filepath = os.path.abspath(os.path.join('static', 'audio', final_filename))
        ffmpeg_executable = os.path.abspath("ffmpeg.exe")

        command = [
            ffmpeg_executable, 
            '-y', 
            '-f', 'concat', 
            '-safe', '0', 
            '-i', list_filename, 
            '-c:a', 'libmp3lame',
            '-b:a', '256k',
            final_filepath
        ]
        result = subprocess.run(command, capture_output=True, text=True, check=False)

        if result.returncode != 0:
            raise Exception(f"FFmpeg falhou: {result.stderr}")

        for temp_file in temp_files:
            os.remove(temp_file)
        os.remove(list_filename)

        JOBS[job_id].update({'status': 'complete', 'filePath': f'/static/audio/{final_filename}'})

    except Exception as e:
        print(f"Erro no job {job_id}: {e}")
        JOBS[job_id].update({'status': 'error', 'error': str(e)})

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/list_models', methods=['POST'])
def list_models():
    try:
        data = request.get_json()
        api_key = data.get('api_key')
        if not api_key:
            return jsonify({'error': 'API Key não fornecida.'}), 400
        genai.configure(api_key=api_key)
        models = []
        for model in genai.list_models():
            if 'generateContent' in model.supported_generation_methods:
                models.append({'name': model.name, 'supported_generation_methods': model.supported_generation_methods})
        return jsonify(models)
    except Exception as e:
        print(f"Erro ao listar modelos: {e}")
        return jsonify({'error': f'Ocorreu um erro no servidor: {str(e)}'}), 500

@app.route('/generate_narratives', methods=['POST'])
def handle_narratives():
    try:
        data = request.get_json()
        api_key = data.get('api_key')
        model_name = data.get('model_name')
        transcription = data.get('transcription')

        if not all([api_key, model_name, transcription]):
            return jsonify({'error': 'API Key, modelo e transcrição são obrigatórios.'}), 400

        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(model_name)

        def get_narrative_prompt(transcription_text):
            return f'''[[ PERSONA ]]
Você é um Roteirista Especialista e "Agente Astro-Jornalista" para o YouTube, focado em ciência e astronomia. Sua voz é direta, rápida, confiante e informativa.

[[ REGRA MESTRA DE COMPRIMENTO OBRIGATÓRIA ]]
O roteiro final DEVE ter entre 9.000 e 10.000 caracteres. Esta é a diretriz mais importante. Verifique a contagem antes de gerar a resposta.

[[ OBJETIVO PRINCIPAL ]]
Analisar a [TRANSCRIÇÃO] e transformá-la em um roteiro de vídeo jornalístico coeso.

[[ MÉTODO OBRIGATÓRIO (REGRAS DE ANÁLISE) ]]
- Fidelidade à Fonte: O roteiro deve ser 100% baseado nos fatos da [TRANSCRIÇÃO].
- Sintetizar e Aprofundar: Reescreva o texto bruto de forma lógica, aprofundando cada fato.
- Explicar a Ciência: Explique termos técnicos e dados, contextualizando-os.
- Conectar Implicações: Destaque as consequências na transcrição.

[[ REGRAS DE ESTILO E RITMO ]]
- RITMO VELOZ: Texto direto ao ponto.
- SEM PAUSAS ARTIFICIAIS: Não use "...".

[[ ESTRUTURA DE SAÍDA OBRIGATÓRIA (3 BLOCOS COM METAS) ]]
**BLOCO 1: INTRODUÇÃO** (Meta: ~1.000-1.500 caracteres)
**BLOCO 2: MEIO (A INVESTIGAÇÃO)** (Meta: ~7.000-7.500 caracteres)
**BLOCO 3: FIM (CONCLUSÃO E CTA)** (Meta: ~1.000 caracteres)

[[ FORMATO DA RESPOSTA FINAL ]]
Sua resposta deve conter APENAS o texto do roteiro, sem títulos de bloco ou metadados.

[[ INPUT (ENTRADA) ]]
[TRANSCRIÇÃO]: "{transcription_text}"'''

        def get_description_prompt(narrative_text):
            return f'''### TAREFA ###
Você é um especialista em SEO para o YouTube. Baseado no roteiro de vídeo fornecido, crie uma descrição de YouTube otimizada e envolvente.

### REGRAS ###
1.  **Gancho Inicial:** Comece com 2-3 frases que capturem a atenção usando palavras-chave do roteiro.
2.  **Resumo Detalhado:** Forneça um resumo conciso do vídeo (3-4 parágrafos).
3.  **Estrutura Clara:** Use parágrafos curtos.
4.  **Chamada para Ação:** Incentive a inscrição e o debate.

### ROTEIRO BASE ###
{narrative_text}'''

        def get_tags_prompt(narrative_text):
            return f'''### TAREFA ###
Você é um especialista em SEO para o YouTube. Baseado no roteiro fornecido, gere um bloco de tags otimizadas.

### REGRAS ###
1.  **Formato:** As tags devem ser separadas por vírgulas.
2.  **Conteúdo:** Inclua tags amplas, específicas e conceituais baseadas no roteiro.
3.  **Comprimento:** O bloco de texto final com as tags DEVE ter entre 400 e 500 caracteres.

### ROTEIRO BASE ###
{narrative_text}'''

        results = {}
        narrative_prompt = get_narrative_prompt(transcription)

        for i in range(1, 5):
            # Gerar Narrativa
            narrative_response = model.generate_content(narrative_prompt)
            narrative_text = narrative_response.text
            results[f'narrative{i}'] = narrative_text

            # Gerar Descrição
            description_prompt = get_description_prompt(narrative_text)
            description_response = model.generate_content(description_prompt)
            results[f'description{i}'] = description_response.text

            # Gerar Tags
            tags_prompt = get_tags_prompt(narrative_text)
            tags_response = model.generate_content(tags_prompt)
            results[f'tags{i}'] = tags_response.text

        return jsonify(results)

    except Exception as e:
        print(f"Erro ao gerar narrativas: {e}")
        return jsonify({'error': f'Ocorreu um erro no servidor: {str(e)}'}), 500

@app.route('/generate_agent_content', methods=['POST'])
def generate_agent_content():
    try:
        data = request.get_json()
        api_key = data.get('api_key')
        model_name = data.get('model_name')
        premise = data.get('premise')
        block_structure = data.get('block_structure')
        cultural_adaptation = data.get('cultural_adaptation')
        content_request = data.get('content_request')

        if not all([api_key, model_name, content_request]):
            return jsonify({'error': 'API Key, modelo e pedido de conteúdo são obrigatórios.'}), 400

        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(model_name)

        all_results = {}

        for i in range(1, 7):  # Generate 6 variations
            # Construct the main content prompt
            main_content_prompt = f"""
Você é um agente personalizado com as seguintes características:

**Premissa:** {premise if premise else "Nenhuma premissa específica fornecida."}

**Estruturação de Blocos:** {block_structure if block_structure else "Nenhuma estrutura de blocos específica fornecida. Gere o conteúdo de forma livre."}

**Adaptação Cultural:** {cultural_adaptation if cultural_adaptation else "Nenhuma adaptação cultural específica fornecida. Use um tom neutro."}

Com base nessas características, por favor, gere uma VARIAÇÃO {i} do seguinte conteúdo:

**Pedido de Conteúdo:** {content_request}

Por favor, forneça APENAS o conteúdo gerado, sem introduções ou comentários adicionais sobre a sua persona.
"""
            content_response = model.generate_content(main_content_prompt)
            content_text = content_response.text
            all_results[f'narrative{i}'] = content_text

            # Generate Titles (using content_text)
            title_prompt = f"""
### TAREFA ###
Você é um especialista em criação de títulos para vídeos do YouTube. Crie 3 opções de títulos extremamente fortes, impactantes e apelativos para o roteiro de vídeo fornecido. Os títulos devem gerar curiosidade e chamar a atenção do espectador imediatamente. Cada título deve estar em uma nova linha.

### REGRAS ###
1.  **Impacto:** Os títulos devem ser chocantes, surpreendentes ou instigantes.
2.  **Curiosidade:** Devem fazer o espectador querer clicar para saber mais.
3.  **Palavras-chave:** Inclua palavras-chave relevantes, se possível, de forma natural.
4.  **Formato:** Cada título deve ser conciso e direto, com no máximo 100 caracteres.
5.  **Quantidade:** Gere exatamente 3 títulos, cada um em uma nova linha.

### ROTEIRO BASE ###
{content_text}
"""
            title_response = model.generate_content(title_prompt)
            titles = [t.strip() for t in title_response.text.split('\n') if t.strip()]
            all_results[f'titles{i}'] = titles

            # Generate Description (using content_text)
            description_prompt = f"""
### TAREFA ###
Você é um especialista em SEO para o YouTube. Baseado no roteiro de vídeo fornecido, crie uma descrição de YouTube otimizada e envolvente.

### REGRAS ###
1.  **Gancho Inicial:** Comece com 2-3 frases que capturem a atenção usando palavras-chave do roteiro.
2.  **Resumo Detalhado:** Forneça um resumo conciso do vídeo (3-4 parágrafos).
3.  **Estrutura Clara:** Use parágrafos curtos.
4.  **Chamada para Ação:** Incentive a inscrição e o debate.

### ROTEIRO BASE ###
{content_text}
"""
            description_response = model.generate_content(description_prompt)
            all_results[f'description{i}'] = description_response.text

            # Generate Tags (using content_text)
            tags_prompt = f"""
### TAREFA ###
Você é um especialista em SEO para o YouTube. Baseado no roteiro fornecido, gere um bloco de tags otimizadas.

### REGRAS ###
1.  **Formato:** As tags devem ser separadas por vírgulas.
2.  **Conteúdo:** Inclua tags amplas, específicas e conceituais baseadas no roteiro.
3.  **Comprimento:** O bloco de texto final com as tags DEVE ter entre 400 e 500 caracteres.

### ROTEIRO BASE ###
{content_text}
"""
            tags_response = model.generate_content(tags_prompt)
            all_results[f'tags{i}'] = tags_response.text

        return jsonify(all_results)

    except Exception as e:
        print(f"Erro ao gerar conteúdo com agente personalizado: {e}")
        return jsonify({'error': f'Ocorreu um erro no servidor ao gerar conteúdo personalizado: {str(e)}'}), 500



@app.route('/save_narrative', methods=['POST'])
def save_narrative():
    try:
        data = request.get_json()
        narrative_data = data.get('narrative_data')
        filename = data.get('filename')

        if not narrative_data or not filename:
            return jsonify({'error': 'Dados da narrativa e nome do arquivo são obrigatórios.'}), 400

        save_path = resource_path(os.path.join('narrativas_salvas', filename))
        with open(save_path, 'w', encoding='utf-8') as f:
            json.dump(narrative_data, f, ensure_ascii=False, indent=4)

        return jsonify({'message': f'Narrativa salva com sucesso em {filename}'})

    except Exception as e:
        print(f"Erro ao salvar narrativa: {e}")
        return jsonify({'error': f'Erro ao salvar narrativa: {str(e)}'}), 500

@app.route('/api/voices')
def api_voices():
    return jsonify(get_available_voices())

@app.route('/api/generate', methods=['POST'])
def api_generate():
    data = request.json
    job_id = str(uuid.uuid4())
    JOBS[job_id] = {'status': 'queued', 'progress': 0, 'total': 0}
    voice_id = data['voiceId']
    api_key = data.get('api_key')

    thread = threading.Thread(target=process_long_audio, args=(job_id, data['text'], voice_id, data['rate'], data['volume'], data['pitch']))
    
    thread.start()
    return jsonify({'success': True, 'jobId': job_id})

@app.route('/api/status/<job_id>')
def api_status(job_id):
    return jsonify(JOBS.get(job_id, {'status': 'not_found'}))

@app.route('/static/audio/<filename>')
def download_file(filename):
    return send_from_directory(os.path.join('static', 'audio'), filename)

@app.route('/api/test_voice', methods=['POST'])
def api_test_voice():
    data = request.json
    voice_id = data.get('voiceId')
    api_key = data.get('api_key')

    if not GCP_ENABLED or not voice_id:
        return jsonify({'success': False, 'error': 'API do Google não disponível ou ID da voz não fornecido.'}), 400

    try:
        client = texttospeech.TextToSpeechClient()
        synthesis_input = texttospeech.SynthesisInput(text="Olá, esta é uma demonstração da minha voz.")
        voice = texttospeech.VoiceSelectionParams(language_code="pt-BR", name=voice_id)
        audio_config = texttospeech.AudioConfig(audio_encoding=texttospeech.AudioEncoding.MP3)
        
        response = client.synthesize_speech(input=synthesis_input, voice=voice, audio_config=audio_config)
        
        audio_base64 = base64.b64encode(response.audio_content).decode('utf-8')
        
        return jsonify({'success': True, 'audioContent': audio_base64, 'isWav': False})
    except Exception as e:
        print(f"Erro ao testar voz: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

def start_flask():
    app.run(host='127.0.0.1', port=8080, debug=False, use_reloader=False)

if __name__ == '__main__':
    flask_thread = threading.Thread(target=start_flask)
    flask_thread.daemon = True
    flask_thread.start()

    time.sleep(1)  # Give Flask a moment to start up

    webview.create_window('Gerador de Narrativas', 'http://127.0.0.1:8080')
    webview.start()