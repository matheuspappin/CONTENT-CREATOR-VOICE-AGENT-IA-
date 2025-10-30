document.addEventListener('DOMContentLoaded', () => {
    // Globals
    let currentApiKey = null;
    let currentModelName = '';
    let progressInterval = null;
    let ttsStatusInterval; // Renamed to avoid conflict
    let isAgentGeneratorInitialized = false;


    // --- DOM Elements ---
    const tabLinks = document.querySelectorAll('.sidebar .tab-link');
    const tabContents = document.querySelectorAll('.main-content .tab-content');
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const closeButton = document.querySelector('.close-button');
    const apiKeyInput = document.getElementById('api-key-input');
    const modelSelect = document.getElementById('model-select');
    const saveConfigBtn = document.getElementById('save-config-btn');
    const configStatus = document.getElementById('config-status');

    // Agent Generator Elements
    const generateAgentContentBtn = document.getElementById('generateAgentContentBtn');
    const agentLoadingSpinner = document.getElementById('agent-loading-spinner');
    const agentProgressText = document.getElementById('agent-progress-text');
    const agentProgressBar = document.getElementById('agent-progress-bar');
    const agentErrorMessage = document.getElementById('agent-error-message');
    const saveAllNarrativesBtn = document.getElementById('save-all-narratives-btn');
    let agentNarrativeTabButtonsContainer = null; // Initialize as null
    let agentNarrativeContentContainer = null; // Initialize as null

    // TTS Generator Elements
    const ttsForm = document.getElementById('tts-form');
    const voiceSelect = document.getElementById('voice-select');
    const testVoiceBtn = document.getElementById('test-voice-btn');
    const rateSlider = document.getElementById('rate-slider');
    const rateValue = document.getElementById('rate-value');
    const volumeSlider = document.getElementById('volume-slider');
    const volumeValue = document.getElementById('volume-value');
    const pitchSlider = document.getElementById('pitch-slider');
    const pitchValue = document.getElementById('pitch-value');
    const generateBtn = document.getElementById('generate-btn');
    const resultDiv = document.getElementById('result');
    const ttsTextInput = document.getElementById('text-input');




    // --- Initialization ---
    loadConfig();
    loadModels();
    loadVoices();
    initMainTabs();
    initSettingsModal();
    initTTSGenerator();
    initDynamicButtonListeners(); // Centralized listener for dynamic buttons


    // --- Main Tab Functions ---
    function initMainTabs() {
        tabLinks.forEach(link => {
            link.addEventListener('click', () => {
                const tabId = link.getAttribute('data-tab');
                activateMainTab(tabId);
            });
        });
        // Activate the first tab by default
        activateMainTab('agent-generator');
    }

    function activateMainTab(tabId) {
        try {
            tabLinks.forEach(link => link.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));

            const sidebarLink = document.querySelector(`.sidebar .tab-link[data-tab="${tabId}"]`);
            const tabContentElement = document.getElementById(tabId);

            if (sidebarLink) {
                sidebarLink.classList.add('active');
            }
            if (tabContentElement) {
                tabContentElement.classList.add('active'); // Ensure main tab content is active first
            }

            // Initialize sub-modules only once when their tab is activated
            if (tabId === 'agent-generator' && !isAgentGeneratorInitialized) {
                agentNarrativeTabButtonsContainer = document.querySelector('#agent-results-section .tab-buttons');
                agentNarrativeContentContainer = document.querySelector('#agent-results-section .tab-content-container');
                if (agentNarrativeTabButtonsContainer && agentNarrativeContentContainer) {
                    initAgentGenerator();
                    isAgentGeneratorInitialized = true;
                }
            }

            // Now, handle sub-tabs if the main tab content is successfully activated
            if (tabContentElement && tabContentElement.classList.contains('active')) {
                if (tabId === 'agent-generator') {
                    const firstAgentNarrativeTab = document.querySelector('#agent-results-section .tab-buttons .tab-button');
                    if (firstAgentNarrativeTab) firstAgentNarrativeTab.click();
                }
            }
        } catch (error) {
            console.error("Error activating main tab:", error);
            alert("Ocorreu um erro ao tentar abrir a aba. Por favor, tente novamente.");
        }
    }

    // --- Settings Modal Functions ---
    function initSettingsModal() {
        settingsBtn.addEventListener('click', () => settingsModal.classList.remove('hidden'));
        closeButton.addEventListener('click', () => settingsModal.classList.add('hidden'));
        window.addEventListener('click', (event) => {
            if (event.target === settingsModal) {
                settingsModal.classList.add('hidden');
            }
        });

        saveConfigBtn.addEventListener('click', () => {
            currentApiKey = apiKeyInput.value;
            currentModelName = modelSelect.value;
            localStorage.setItem('geminiApiKey', currentApiKey);
            localStorage.setItem('geminiModelName', currentModelName);
            configStatus.textContent = 'Configuração salva.';
            loadModels(); // Reload models with potentially new API key
        });

        modelSelect.addEventListener('change', () => {
            currentModelName = modelSelect.value;
            localStorage.setItem('geminiModelName', currentModelName);
        });
    }

    function loadConfig() {
        if (localStorage.getItem('geminiApiKey')) {
            currentApiKey = localStorage.getItem('geminiApiKey');
            apiKeyInput.value = currentApiKey;
            configStatus.textContent = 'API Key carregada.';
        }
        if (localStorage.getItem('geminiModelName')) {
            currentModelName = localStorage.getItem('geminiModelName');
        }
    }

    async function loadModels() {
        if (!currentApiKey) {
            modelSelect.innerHTML = '<option value="">API Key não configurada</option>';
            return;
        }
        try {
            const response = await fetch('/list_models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: currentApiKey }) });
            const models = await response.json();
            if (!response.ok) throw new Error(models.error || 'Erro ao carregar modelos');
            modelSelect.innerHTML = '';
            models.forEach(model => {
                const option = document.createElement('option');
                option.value = model.name;
                option.textContent = model.name;
                if (model.name === currentModelName) option.selected = true;
                modelSelect.appendChild(option);
            });
            if (!currentModelName && models.length > 0) currentModelName = models[0].name;
        } catch (e) {
            modelSelect.innerHTML = `<option value="">${e.message}</option>`;
        }
    }

    // --- Agent Generator Functions ---
    function initAgentGenerator() {
        generateAgentContentBtn.addEventListener('click', generateAgentContent);
        saveAllNarrativesBtn.addEventListener('click', saveAllNarratives);
        
        // Create agent narrative sub-tab buttons and content containers
        for (let i = 1; i <= 6; i++) {
            const tabButton = document.createElement('button');
            tabButton.classList.add('tab-button');
            tabButton.setAttribute('data-tab', `narrative${i}`);
            tabButton.textContent = `VARIAÇÃO ${i}`;
            if (i === 1) tabButton.classList.add('active');
            agentNarrativeTabButtonsContainer.appendChild(tabButton);

            const narrativeDiv = createAgentNarrativeResultElement(i);
            agentNarrativeContentContainer.appendChild(narrativeDiv);
        }

        // Event delegation for agent narrative sub-tab buttons
        agentNarrativeTabButtonsContainer.addEventListener('click', (event) => {
            if (event.target.classList.contains('tab-button')) {
                const tabId = event.target.getAttribute('data-tab');
                activateAgentNarrativeSubTab(tabId);
            }
        });
    }

    function createAgentNarrativeResultElement(index) {
        const narrativeDiv = document.createElement('div');
        narrativeDiv.id = `narrative${index}`;
        narrativeDiv.classList.add('tab-content');
        if (index === 1) narrativeDiv.classList.add('active');

        narrativeDiv.innerHTML = `
            <div class="narrative-environment">
                <div class="narrative-block">
                    <h3>Narrativa ${index}</h3>
                    <button class="delete-button" data-target-narrative="${index}" data-type="agent">Excluir</button>
                    <div class="output-container">
                        <div class="output-box" id="narrative${index}-output"></div>
                        <button class="copy-button" data-target-id="narrative${index}-output">Copiar</button>
                        <button class="generate-audio-button" data-target-narrative="narrative${index}-output" data-target-tab="tts-generator">Gerar Áudio</button>
                    </div>
                    <h4>Título para YouTube</h4>
                    <div class="output-container">
                        <div class="output-box" id="title${index}-output-1"></div>
                        <button class="copy-button" data-target-id="title${index}-output-1">Copiar</button>
                    </div>
                    <div class="output-container">
                        <div class="output-box" id="title${index}-output-2"></div>
                        <button class="copy-button" data-target-id="title${index}-output-2">Copiar</button>
                    </div>
                    <div class="output-container">
                        <div class="output-box" id="title${index}-output-3"></div>
                        <button class="copy-button" data-target-id="title${index}-output-3">Copiar</button>
                    </div>
                    <h4>Descrição para YouTube</h4>
                    <div class="output-container">
                        <div class="output-box" id="description${index}-output"></div>
                        <button class="copy-button" data-target-id="description${index}-output">Copiar</button>
                    </div>
                    <h4>Tags para YouTube</h4>
                    <div class="output-container">
                        <div class="output-box" id="tags${index}-output"></div>
                        <button class="copy-button" data-target-id="tags${index}-output">Copiar</button>
                    </div>
                </div>
            </div>
        `;
        return narrativeDiv;
    }

    function activateAgentNarrativeSubTab(tabId) {
        const narrativeTabButtons = document.querySelectorAll('#agent-results-section .tab-buttons .tab-button');
        const narrativeTabContents = document.querySelectorAll('#agent-results-section .tab-content-container .tab-content');

        narrativeTabButtons.forEach(btn => btn.classList.remove('active'));
        narrativeTabContents.forEach(content => content.classList.remove('active'));

        document.querySelector(`#agent-results-section .tab-buttons .tab-button[data-tab="${tabId}"]`).classList.add('active');
        document.getElementById(tabId).classList.add('active');
    }

    async function generateAgentContent() {
        const agentPremise = document.getElementById('agentPremise').value;
        const blockStructure = document.getElementById('blockStructure').value;
        const culturalAdaptation = document.getElementById('culturalAdaptation').value;
        const contentRequest = document.getElementById('contentRequest').value;

        if (!currentApiKey || !currentModelName || !contentRequest) {
            agentErrorMessage.textContent = 'API Key, Modelo e Pedido de Conteúdo são obrigatórios.';
            agentErrorMessage.classList.remove('hidden');
            return;
        }

        agentLoadingSpinner.classList.remove('hidden');
        agentErrorMessage.classList.add('hidden');
        generateAgentContentBtn.disabled = true;
        saveAllNarrativesBtn.disabled = true; // Disable save button during generation

        let currentProgress = 0;
        let currentStep = 0;
        const totalSteps = 6 * 4; 
        const progressIncrement = 100 / totalSteps; 

        const stepMessages = [
            "Gerando Variação 1...", "Gerando Títulos 1...", "Gerando Descrição 1...", "Gerando Tags 1...",
            "Gerando Variação 2...", "Gerando Títulos 2...", "Gerando Descrição 2...", "Gerando Tags 2...",
            "Gerando Variação 3...", "Gerando Títulos 3...", "Gerando Descrição 3...", "Gerando Tags 3...",
            "Gerando Variação 4...", "Gerando Títulos 4...", "Gerando Descrição 4...", "Gerando Tags 4...",
            "Gerando Variação 5...", "Gerando Títulos 5...", "Gerando Descrição 5...", "Gerando Tags 5...",
            "Gerando Variação 6...", "Gerando Títulos 6...", "Gerando Descrição 6...", "Gerando Tags 6...",
            "Finalizando..."
        ];

        agentProgressBar.style.width = '0%';
        agentProgressText.textContent = 'Preparando...';
        currentProgress = 0;
        currentStep = 0;

        progressInterval = setInterval(() => {
            if (currentProgress < 95) { 
                currentProgress += progressIncrement / 2; 
                if (currentProgress > (currentStep + 1) * progressIncrement) {
                    currentStep++;
                }
                agentProgressText.textContent = stepMessages[currentStep] || stepMessages[stepMessages.length - 1];
                agentProgressBar.style.width = `${currentProgress}%`;
            }
        }, 500); // Update progress more frequently

        try {
            const response = await fetch('/generate_agent_content', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    api_key: currentApiKey,
                    model_name: currentModelName,
                    premise: agentPremise,
                    block_structure: blockStructure,
                    cultural_adaptation: culturalAdaptation,
                    content_request: contentRequest
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Erro desconhecido na geração de conteúdo personalizado.');
            }

            // Populate the dynamically created elements
            for (let i = 1; i <= 6; i++) {
                document.getElementById(`narrative${i}-output`).textContent = data[`narrative${i}`] || '';
                for (let j = 1; j <= 3; j++) {
                    document.getElementById(`title${i}-output-${j}`).textContent = data[`titles${i}`] && data[`titles${i}`][j-1] ? data[`titles${i}`][j-1] : '';
                }
                document.getElementById(`description${i}-output`).textContent = data[`description${i}`] || '';
                document.getElementById(`tags${i}-output`).textContent = data[`tags${i}`] || '';
            }
            activateAgentNarrativeSubTab('narrative1'); // Activate the first narrative tab after generation

        } catch (e) {
            agentErrorMessage.textContent = e.message;
            agentErrorMessage.classList.remove('hidden');
        } finally {
            clearInterval(progressInterval);
            agentProgressBar.style.width = '100%';
            agentProgressText.textContent = 'Concluído!';
            agentLoadingSpinner.classList.add('hidden');
            generateAgentContentBtn.disabled = false;
            saveAllNarrativesBtn.disabled = false; // Re-enable save button
        }
    }

    async function saveAllNarratives() {
        const baseFilename = prompt('Digite um nome base para os arquivos (ex: meu_video):');
        if (!baseFilename) return;

        for (let i = 1; i <= 6; i++) {
            const narrativeText = document.getElementById(`narrative${i}-output`).textContent;
            const titles = [];
            for (let j = 1; j <= 3; j++) {
                titles.push(document.getElementById(`title${i}-output-${j}`).textContent);
            }
            const descriptionText = document.getElementById(`description${i}-output`).textContent;
            const tagsText = document.getElementById(`tags${i}-output`).textContent;

            if (narrativeText || titles.some(title => title) || descriptionText || tagsText) {
                const narrativeData = {
                    narrative: narrativeText,
                    titles: titles,
                    description: descriptionText,
                    tags: tagsText
                };
                const filename = `${baseFilename}_narrativa_${i}.json`;
                await saveNarrativeToFile(narrativeData, filename);
            }
        }
        alert('Todas as narrativas salvas (se houver conteúdo).');
    }

    async function saveNarrativeToFile(narrativeData, filename) {
        try {
            const response = await fetch('/save_narrative', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ narrative_data: narrativeData, filename: filename })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Erro ao salvar narrativa');
            console.log(result.message);
        } catch (e) {
            console.error(`Erro ao salvar ${filename}:`, e.message);
            alert(`Erro ao salvar ${filename}: ${e.message}`);
        }
    }



    // --- TTS Generator Functions ---
    function initTTSGenerator() {
        ttsForm.addEventListener('submit', generateTTS);
        testVoiceBtn.addEventListener('click', testVoice);
        rateSlider.addEventListener('input', () => rateValue.textContent = rateSlider.value);
        volumeSlider.addEventListener('input', () => volumeValue.textContent = volumeSlider.value);
        pitchSlider.addEventListener('input', () => pitchValue.textContent = pitchSlider.value);
    }

    async function loadVoices() {
        try {
            const response = await fetch('/api/voices');
            const voices = await response.json();
            voiceSelect.innerHTML = '';

            const googleVoices = voices.filter(v => !v.id.startsWith('gemini-'));
            const geminiVoices = voices.filter(v => v.id.startsWith('gemini-'));

            if (googleVoices.length > 0) {
                const googleOptgroup = document.createElement('optgroup');
                googleOptgroup.label = 'Google Cloud';
                googleVoices.forEach(voice => {
                    const option = document.createElement('option');
                    option.value = voice.id;
                    option.textContent = voice.name;
                    googleOptgroup.appendChild(option);
                });
                voiceSelect.appendChild(googleOptgroup);
            }

            if (geminiVoices.length > 0) {
                const geminiOptgroup = document.createElement('optgroup');
                geminiOptgroup.label = 'Google Gemini';
                geminiVoices.forEach(voice => {
                    const option = document.createElement('option');
                    option.value = voice.id;
                    option.textContent = voice.name;
                    geminiOptgroup.appendChild(option);
                });
                voiceSelect.appendChild(geminiOptgroup);
            }

        } catch (e) {
            voiceSelect.innerHTML = `<option value="">Erro ao carregar vozes</option>`;
        }
    }

    async function generateTTS(event) {
        event.preventDefault();
        if (ttsStatusInterval) clearInterval(ttsStatusInterval);
        generateBtn.disabled = true;
        resultDiv.innerHTML = `<div class="status-message">Enviando tarefa para o servidor...</div>`;

        const data = {
            text: ttsTextInput.value,
            voiceId: voiceSelect.value,
            rate: rateSlider.value,
            volume: volumeSlider.value / 100,
            pitch: pitchSlider.value
        };

        try {
            const response = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
            const result = await response.json();
            if (result.success) {
                ttsStatusInterval = setInterval(() => checkJobStatus(result.jobId), 2000);
            } else {
                showError('Falha ao iniciar a tarefa no servidor.');
            }
        } catch (err) {
            showError('Erro de comunicação ao iniciar tarefa.');
        }
    }

    function checkJobStatus(jobId) {
        fetch(`/api/status/${jobId}`)
            .then(response => response.json())
            .then(job => {
                let percentage = 0;
                if (job.total > 0) {
                    percentage = Math.round((job.progress / job.total) * 100);
                }

                let progressBarHtml = `<div class="progress-bar-container"><div class="progress-bar" style="width: ${percentage}%"></div></div>`;

                switch (job.status) {
                    case 'queued':
                        resultDiv.innerHTML = `<div class="status-message">Tarefa na fila, aguardando para iniciar...</div>`;
                        break;
                    case 'processing':
                        resultDiv.innerHTML = `<div class="status-message">Processando parte ${job.progress} de ${job.total}...</div>${progressBarHtml}`;
                        break;
                    case 'merging':
                        resultDiv.innerHTML = `<div class="status-message">Juntando arquivos de audio...</div><div class="progress-bar-container"><div class="progress-bar" style="width: 100%"></div></div>`;
                        break;
                    case 'complete':
                        clearInterval(ttsStatusInterval);
                        generateBtn.disabled = false;
                        resultDiv.innerHTML = `
                            <div class="status-message" style="background-color: #e8f5e9; color: #4caf50;">Áudio longo gerado com sucesso!</div>
                            <audio controls src="${job.filePath}">
                                Seu navegador não suporta o elemento de áudio.
                            </audio>
                        `;
                        break;
                    case 'error':
                        showError(`Falha na geração: ${job.error}`);
                        break;
                    case 'not_found':
                        showError('A tarefa não foi encontrada no servidor.');
                        break;
                }
            })
            .catch(err => showError('Erro ao verificar status da tarefa.'));
    }

    function showError(message) {
        if (ttsStatusInterval) clearInterval(ttsStatusInterval);
        generateBtn.disabled = false;
        resultDiv.innerHTML = `<div class="status-message error">${message}</div>`;
    }

    async function testVoice() {
        const selectedVoiceId = voiceSelect.value;
        if (!selectedVoiceId) return;

        const originalBtnText = testVoiceBtn.innerHTML;
        testVoiceBtn.disabled = true;
        testVoiceBtn.innerHTML = '...';

        try {
            const response = await fetch('/api/test_voice', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ voiceId: selectedVoiceId })
            });
            const result = await response.json();
            if (result.success) {
                const audioType = result.isWav ? 'wav' : 'mpeg';
                const audio = new Audio(`data:audio/${audioType};base64,` + result.audioContent);
                audio.play();
            } else {
                alert(`Erro ao testar a voz: ${result.error}`);
            }
        } catch (err) {
            alert('Erro de comunicação ao testar a voz.');
        } finally {
            testVoiceBtn.disabled = false;
            testVoiceBtn.innerHTML = originalBtnText;
        }
    }

    // --- Generic Handlers for Dynamically Created Buttons (Event Delegation) ---
    function initDynamicButtonListeners() {
        document.addEventListener('click', (event) => {
            if (event.target.classList.contains('copy-button')) {
                handleCopy(event.target);
            } else if (event.target.classList.contains('delete-button')) {
                handleDelete(event.target);
            } else if (event.target.classList.contains('generate-audio-button')) {
                handleGenerateAudio(event.target);
            }
        });
    }

    function handleCopy(button) {
        const targetId = button.dataset.targetId;
        const targetElement = document.getElementById(targetId);
        if (targetElement && targetElement.textContent) {
            navigator.clipboard.writeText(targetElement.textContent).then(() => {
                const originalText = button.textContent;
                button.textContent = 'Copiado!';
                setTimeout(() => {
                    button.textContent = originalText;
                }, 2000);
            }).catch(err => {
                console.error('Failed to copy: ', err);
                alert('Erro ao copiar o texto.');
            });
        }
    }

    function handleDelete(button) {
        const narrativeNumber = button.dataset.targetNarrative;
        const type = button.dataset.type; // 'agent' or 'transcription'

        if (narrativeNumber) {
            if (type === 'agent') {
                document.getElementById(`narrative${narrativeNumber}-output`).textContent = '';
                for (let j = 1; j <= 3; j++) {
                    document.getElementById(`title${narrativeNumber}-output-${j}`).textContent = '';
                }
                document.getElementById(`description${narrativeNumber}-output`).textContent = '';
                document.getElementById(`tags${narrativeNumber}-output`).textContent = '';
            }
        }
    }

    function handleGenerateAudio(button) {
        const narrativeOutputId = button.getAttribute('data-target-narrative');
        const narrativeOutput = document.getElementById(narrativeOutputId);
        const narrativeText = narrativeOutput.innerText;
        const targetTab = button.getAttribute('data-target-tab');

        ttsTextInput.value = narrativeText;
        activateMainTab(targetTab); // Activate the main TTS tab
    }
});