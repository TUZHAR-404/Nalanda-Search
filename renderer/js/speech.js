/* ========================================
   NALANDA SEARCH - Speech-to-Text
   ======================================== */

let recognition = null;
let isListening = false;

// Initialize speech recognition
function initializeSpeech() {
    const micBtn = document.getElementById('micBtn');
    const searchInput = document.getElementById('searchInput');
    const voiceStatus = document.getElementById('voiceStatus');
    
    // Check for browser support
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        console.warn('⚠️ Speech recognition not supported in this browser');
        micBtn.disabled = true;
        micBtn.style.opacity = '0.5';
        micBtn.title = 'Speech recognition not supported';
        return;
    }
    
    // Initialize speech recognition
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    
    // Configure recognition
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    
    // Try to detect language, fallback to English
    recognition.lang = navigator.language || 'en-US';
    
    console.log(`🎤 Speech recognition initialized (${recognition.lang})`);
    
    // Handle microphone button click
    micBtn.addEventListener('click', () => {
        if (isListening) {
            stopListening();
        } else {
            startListening();
        }
    });
    
    // Recognition event handlers
    recognition.onstart = () => {
        console.log('🎤 Listening...');
        isListening = true;
        micBtn.classList.add('listening');
        voiceStatus.classList.remove('hidden');
        searchInput.placeholder = 'Listening... Speak now';
    };
    
    recognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalTranscript += transcript + ' ';
            } else {
                interimTranscript += transcript;
            }
        }
        
        // Update search input with transcript
        if (finalTranscript) {
            searchInput.value = finalTranscript.trim();
            console.log('🎤 Final transcript:', finalTranscript.trim());
        } else if (interimTranscript) {
            searchInput.value = interimTranscript;
        }
    };
    
    recognition.onend = () => {
        console.log('🎤 Stopped listening');
        isListening = false;
        micBtn.classList.remove('listening');
        voiceStatus.classList.add('hidden');
        searchInput.placeholder = 'Search the web with wisdom...';
        
        // Auto-submit if we have text
        const query = searchInput.value.trim();
        if (query) {
            // Small delay to show the final transcript
            setTimeout(() => {
                document.getElementById('searchForm').dispatchEvent(new Event('submit'));
            }, 500);
        }
    };
    
    recognition.onerror = (event) => {
        console.error('🎤 Speech recognition error:', event.error);
        
        let errorMessage = 'Speech recognition error';
        switch (event.error) {
            case 'no-speech':
                errorMessage = 'No speech detected. Please try again.';
                break;
            case 'audio-capture':
                errorMessage = 'No microphone found. Please check your device.';
                break;
            case 'not-allowed':
                errorMessage = 'Microphone permission denied.';
                break;
            case 'network':
                errorMessage = 'Network error. Speech recognition requires internet.';
                break;
            default:
                errorMessage = `Speech recognition error: ${event.error}`;
        }
        
        window.App.notify(errorMessage, 'error');
        stopListening();
    };
}

// Start listening
function startListening() {
    if (!recognition) {
        window.App.notify('Speech recognition not available', 'error');
        return;
    }
    
    try {
        recognition.start();
    } catch (error) {
        console.error('Error starting recognition:', error);
        
        // If already started, stop and restart
        if (error.message && error.message.includes('already started')) {
            recognition.stop();
            setTimeout(() => {
                recognition.start();
            }, 100);
        }
    }
}

// Stop listening
function stopListening() {
    if (recognition && isListening) {
        recognition.stop();
    }
}

// Change recognition language
function changeLanguage(lang) {
    if (recognition) {
        recognition.lang = lang;
        console.log(`🎤 Language changed to: ${lang}`);
    }
}

// Get supported languages (common ones)
function getSupportedLanguages() {
    return [
        { code: 'en-US', name: 'English (US)' },
        { code: 'en-GB', name: 'English (UK)' },
        { code: 'es-ES', name: 'Spanish' },
        { code: 'fr-FR', name: 'French' },
        { code: 'de-DE', name: 'German' },
        { code: 'it-IT', name: 'Italian' },
        { code: 'pt-BR', name: 'Portuguese (Brazil)' },
        { code: 'ru-RU', name: 'Russian' },
        { code: 'zh-CN', name: 'Chinese (Simplified)' },
        { code: 'ja-JP', name: 'Japanese' },
        { code: 'ko-KR', name: 'Korean' },
        { code: 'hi-IN', name: 'Hindi' },
        { code: 'ar-SA', name: 'Arabic' }
    ];
}

// Export for use in other modules
window.Speech = {
    start: startListening,
    stop: stopListening,
    changeLanguage: changeLanguage,
    getSupportedLanguages: getSupportedLanguages,
    isListening: () => isListening
};
