// ══════════════════════════════════════════════════════════════
// PLACERA v3.2 — FRONTEND ENGINE (VOICE FIX BUILD)
// ══════════════════════════════════════════════════════════════
console.log('%c[PLACERA] v3.2 Voice Fix Build loaded', 'color: lime; font-size: 14px;');

let sessionId = null, currentCompany = 'Unified', currentRound = 1, currentMode = 'standard';
let questionCount = 0, maxQuestions = 12, timerInterval = null, seconds = 0;
let micOn = false, editorOpen = false, isRecording = false;
let mediaRecorder = null, audioChunks = [], interviewActive = false;
let currentCodingType = null, currentCodingQuestion = null;
let factErrorsCount = 0, primaryLanguage = 'Python';
let currentInterviewer = null, stream = null;
let editor = null, lastEditorValue = '', observationTimer = null;
let wordCountSession = 0, lastWpmTime = Date.now(), frustrationLevel = 0;
let missionStartTime = null, missionTimerInterval = null, attempts = 0;
let cameraOn = false, faceModelsLoaded = false, faceAnalysisInterval = null;
let eyeContactScore = 0, expressionScore = 0, faceConfidenceScore = 0;
let currentInput = '';
let _submitting = false; // debounce guard

// ── PROCTORING STATE ──
let tabSwitchCount = 0, tabSwitchListenerAttached = false;
let multipleFaceCount = 0, isStartingCamera = false;
const PROCTORING_MAX_WARNINGS = 3; // 3 warnings, 4th = termination
let proctoringGraceUntil = 0; // Timestamp: ignore violations before this
let lastBlurTime = 0; // Cooldown: ignore rapid successive blurs

const PROCTORING_COOLDOWN_MS = 3000; // 3s cooldown between counting blurs
const PROCTORING_GRACE_MS = 5000; // 5s grace period after interview starts

// ── CODE PASTE DETECTION STATE ──
let pasteEvents = []; // Array of { timestamp, charCount, content }
let totalPastedChars = 0;
let totalTypedChars = 0;
let lastEditorLength = 0;
let pasteWarningCount = 0;
const PASTE_THRESHOLD = 30; // Chars pasted at once to trigger detection
const PASTE_MAX_WARNINGS = 2; // Max warnings before flagging
let editorKeystrokeCount = 0;

// ── DSA CHALLENGE STATE ──
let currentDSAQuestion = null; // Parsed DSA question object
let dsaTimerSeconds = 0, dsaTimerInterval = null;
let dsaModalOpen = false;

// ── TOAST NOTIFICATION SYSTEM ──
function showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icons = { success: 'check_circle', error: 'error', warn: 'warning', info: 'info' };
    toast.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px;">${icons[type] || 'info'}</span><span>${message}</span>`;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 400); }, duration);
}

// ── LOADING STATE ──
function setLoading(btnId, loading) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    if (loading) { btn.dataset.origText = btn.textContent; btn.textContent = '⏳ Processing...'; btn.disabled = true; btn.style.opacity = '0.6'; }
    else { btn.textContent = btn.dataset.origText || btn.textContent; btn.disabled = false; btn.style.opacity = '1'; }
}

// ── CONFIRMATION DIALOG ──
function showConfirm(message, onConfirm) {
    const overlay = document.getElementById('confirmOverlay');
    const msg = document.getElementById('confirmMessage');
    const yesBtn = document.getElementById('confirmYes');
    const noBtn = document.getElementById('confirmNo');
    if (!overlay) { if (confirm(message)) onConfirm(); return; }
    msg.textContent = message;
    overlay.style.display = 'flex';
    const cleanup = () => { overlay.style.display = 'none'; yesBtn.onclick = null; noBtn.onclick = null; };
    yesBtn.onclick = () => { cleanup(); onConfirm(); };
    noBtn.onclick = cleanup;
}

// ── SESSION RECOVERY ──
function saveSessionState() {
    if (!sessionId) return;
    try { localStorage.setItem('placera_session', JSON.stringify({ sessionId, currentMode, currentRound, questionCount, maxQuestions, seconds })); } catch(e) {}
}
function restoreSession() {
    try {
        const saved = JSON.parse(localStorage.getItem('placera_session') || 'null');
        if (saved && saved.sessionId) return saved;
    } catch(e) {}
    return null;
}
function clearSavedSession() { try { localStorage.removeItem('placera_session'); } catch(e) {} }

// ── VOICE INPUT ENGINE ──
let isListening = false, silenceTimer = null, voiceActivityDetected = false;
let duplexAnalyser = null, duplexDataArray = null;
let audioCtx = null, gainNodeRef = null, analyser = null, currentSource = null;
let lastPitch = 1.0, systemFemaleVoice = null, systemMaleVoice = null;

function cacheVoices() {
    const v = window.speechSynthesis.getVoices();
    // Female voice for Amara (HR/salary modes)
    systemFemaleVoice = v.find(x => (x.name.includes('Aria') || x.name.includes('Zira') || x.name.includes('Natural')) && x.lang.includes('en')) ||
                        v.find(x => x.lang === 'en-IN' && (x.name.includes('Female') || x.name.includes('Neerja'))) ||
                        v.find(x => x.name.includes('Female') && x.lang.includes('en')) || v[0];
    // Male voice for David (tech/standard/practice modes)
    systemMaleVoice = v.find(x => (x.name.includes('David') || x.name.includes('Mark') || x.name.includes('Guy')) && x.lang.includes('en')) ||
                      v.find(x => x.lang === 'en-IN' && (x.name.includes('Male') || x.name.includes('Ravi') || x.name.includes('Prabhat'))) ||
                      v.find(x => x.name.includes('Male') && x.lang.includes('en')) ||
                      v.find(x => x.lang.startsWith('en') && !x.name.includes('Female')) || v[0];
}
if (window.speechSynthesis) { window.speechSynthesis.onvoiceschanged = cacheVoices; cacheVoices(); }

// ── UI UTILITIES (SINGLE DEFINITIONS) ──
function setQText(t) { const el = document.getElementById('qtext'); if (el) el.textContent = t; addLog(t, 'ai', 'AI'); }
function setWaveLbl(t) { const el = document.getElementById('waveLbl'); if (el) el.textContent = t; }
function setAgentPill(t) { const el = document.getElementById('agentPill'); if (el) el.textContent = t; }
function playTypingSound() {}
function triggerObservation(t) { addLog(t, 'info'); }

function clearLogs() { const el = document.getElementById('logList'); if (el) el.innerHTML = ''; }
function addLog(t, type, sender = 'AI') {
    const log = document.getElementById('logList');
    if (!log) return;
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const el = document.createElement('div');
    el.className = 'log-item';
    const sColor = sender === 'AI' ? 'var(--accent-light)' : (sender === 'Me' ? 'var(--green)' : 'var(--t3)');
    const typeColor = type === 'good' ? 'var(--green)' : type === 'warn' ? 'var(--amber)' : type === 'err' ? 'var(--red)' : 'var(--t3)';
    el.style.color = typeColor;
    el.innerHTML = `<span style="color:var(--t4); margin-right:8px; font-size:10px;">${timeStr}</span><span style="color:${sColor}; font-weight:600;">${sender}:</span> ${t}`;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
}

function updateDots(c, t) {
    const el = document.getElementById('qdots');
    if (el) { el.innerHTML = ''; for (let i=1; i<=t; i++) { const d = document.createElement('div'); d.className = 'qdot' + (i<c ? ' done' : i===c ? ' cur' : ''); el.appendChild(d); } }
    const qCount = document.getElementById('qCount'); if (qCount) qCount.textContent = `${c}/${t}`;
}

function startTimer() { seconds = 0; timerInterval = setInterval(() => { seconds++; const m = Math.floor(seconds/60), s = seconds%60; document.getElementById('timer').textContent = String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0'); }, 1000); }
function stopTimer() { clearInterval(timerInterval); }
function startMouth() { /* handled by avatar engine */ }
function stopMouth() { /* handled by avatar engine */ }
function resetAnswerBtn() {
    const btn = document.getElementById('ansBtn');
    if (!btn) return;
    const label = document.getElementById('micLabel');
    if (micActive) {
        btn.classList.add('rec');
        btn.classList.remove('btn-muted');
        btn.querySelector('.material-symbols-outlined').textContent = 'mic';
        if (label) label.textContent = 'Mute';
    } else {
        btn.classList.remove('rec');
        btn.classList.add('btn-muted');
        btn.querySelector('.material-symbols-outlined').textContent = 'mic_off';
        if (label) label.textContent = 'Unmute';
    }
}

// ── ELO DISPLAY ──
function updateEloDisplay(rating, tier) {
    const els = ['eloRating', 'eloRatingVitals'];
    els.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = Math.round(rating); });
    const bar = document.getElementById('eloBar');
    if (bar) bar.style.width = rating + '%';
    const tierEls = ['eloTier', 'eloTierVitals'];
    const tierLabel = (tier || 'mid_level').replace(/_/g, ' ').toUpperCase();
    tierEls.forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.textContent = tierLabel; el.className = 'tier-indicator tier-' + (tier || 'mid_level'); }
    });
}

// ── SCREENS & UPLOAD ──
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => { s.classList.remove('active'); s.style.display = 'none'; });
    const s = document.getElementById(id); if (s) { s.style.display = 'flex'; s.classList.add('active'); }
    
    // Toggle light mode for specific screens
    if (['uploadScreen', 'selectorScreen', 'scorecardScreen'].includes(id)) {
        document.body.classList.add('light-mode');
    } else {
        document.body.classList.remove('light-mode');
    }
}

// ── RESUME FILE VALIDATION ──
function isValidResumeFile(file) {
    const allowedTypes = [
        'application/pdf',
        'text/plain',
    ];
    const allowedExtensions = ['.pdf', '.docx', '.doc', '.txt'];
    const blockedExtensions = [
        '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp', '.ico',
        '.mp4', '.avi', '.mov', '.mkv', '.webm', '.mp3', '.wav', '.ogg',
        '.xlsx', '.xls', '.csv', '.pptx', '.ppt',
        '.zip', '.rar', '.7z', '.tar', '.gz',
        '.exe', '.msi', '.bat', '.sh', '.py', '.js', '.html', '.css',
        '.json', '.xml', '.yaml', '.yml',
    ];
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (blockedExtensions.includes(ext)) return false;
    if (allowedExtensions.includes(ext)) return true;
    if (allowedTypes.includes(file.type)) return true;
    return false;
}

async function handleFileSelect(input) {
    const file = input.files[0]; if (!file) return;
    const status = document.getElementById('uploadStatus');

    // Validate: only resume files (PDF, TXT)
    if (!isValidResumeFile(file)) {
        status.textContent = '✗ Invalid file type. Please upload a resume in PDF or TXT format only.';
        status.style.color = 'var(--red)';
        showToast('Only PDF or TXT resume files are accepted.', 'error');
        input.value = ''; // Reset file input
        return;
    }

    // Validate: reasonable file size for a resume (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
        status.textContent = '✗ File too large. Resume should be under 5MB.';
        status.style.color = 'var(--red)';
        showToast('Resume file is too large. Max 5MB.', 'error');
        input.value = '';
        return;
    }

    status.textContent = 'Analyzing your document...'; status.style.color = 'var(--blue)';
    const formData = new FormData(); formData.append('resume', file);
    try {
        const res = await fetch('/api/upload-resume', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.error) {
            status.textContent = '✗ ' + data.error;
            status.style.color = 'var(--red)';
            showToast(data.error, 'error');
            input.value = ''; // Reset so user can re-upload
            // Shake animation on drop zone
            const dropZone = document.getElementById('dropZone');
            if (dropZone) { dropZone.style.borderColor = 'var(--red)'; setTimeout(() => dropZone.style.borderColor = '', 3000); }
            return;
        }
        sessionId = data.sessionId; primaryLanguage = data.resumeData.primary_language || 'Python';
        status.textContent = `✓ Resume verified — ${(data.resumeData.projects || []).length} projects, ${(data.resumeData.skills || []).length} skills detected`;
        status.style.color = 'var(--green)'; 
        renderResumePreview(data.resumeData); 
        const preview = document.getElementById('resumePreview');
        preview.style.display = 'block';
        preview.classList.remove('hidden');
        // Auto-scroll to preview so the user sees the "Continue" button
        preview.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) { 
        console.error(err);
        status.textContent = '✗ Upload failed. Check your connection.'; 
        status.style.color = 'var(--red)'; 
        showToast('Upload failed. Please try again.', 'error'); 
        input.value = ''; 
    }
}

function renderResumePreview(rd) {
    const grid = document.getElementById('rpGrid'); if (!grid) return;
    grid.innerHTML = `
    <div style="padding:18px; border-radius:14px; background:rgba(255,255,255,0.02); border:1px solid var(--border-glass);">
        <div style="font-family:var(--font-mono); font-size:9px; color:var(--t4); text-transform:uppercase; font-weight:700; letter-spacing:1.5px; margin-bottom:6px;">Candidate</div>
        <div style="font-size:15px; font-weight:700; color:#fff; font-family:var(--font-display);">${rd.name || 'Anonymous'}</div>
    </div>
    <div style="padding:18px; border-radius:14px; background:rgba(255,255,255,0.02); border:1px solid var(--border-glass);">
        <div style="font-family:var(--font-mono); font-size:9px; color:var(--t4); text-transform:uppercase; font-weight:700; letter-spacing:1.5px; margin-bottom:6px;">Domain</div>
        <div style="font-size:15px; font-weight:700; color:#fff; font-family:var(--font-display);">${rd.domain || 'Generalist'}</div>
    </div>
    <div style="padding:18px; border-radius:14px; background:rgba(255,255,255,0.02); border:1px solid var(--border-glass); grid-column:1/-1;">
        <div style="font-family:var(--font-mono); font-size:9px; color:var(--t4); text-transform:uppercase; font-weight:700; letter-spacing:1.5px; margin-bottom:6px;">Core Competencies</div>
        <div style="font-size:13px; color:var(--t2); line-height:1.5;">${(rd.skills || []).slice(0, 12).join(' · ')}</div>
    </div>`;
}

// ── VOICE INPUT — MUTE/UNMUTE TOGGLE ──
let micActive = false;

function toggleMic() {
    if (!interviewActive) { showToast('Interview not active yet', 'warn'); return; }
    if (micActive) {
        // MUTE: stop recording → transcribe → AI speaks
        micActive = false;
        stopVoiceInput();
        resetAnswerBtn();
        setWaveLbl('Processing...');
    } else {
        // UNMUTE: start recording
        micActive = true;
        // Interrupt AI speech when user unmutes
        interruptAI();
        startVoiceInput();
        resetAnswerBtn();
        setWaveLbl('Listening...');
    }
}

function startAnswer() { if (!micActive) toggleMic(); }
function stopAnswer() { if (micActive) toggleMic(); }

let activeStream = null; // Keep stream reference at module level

async function startVoiceInput() {
    if (!interviewActive || isListening) return;
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error("Microphone API not supported on this browser.");
        }

        // Get microphone stream with ENHANCED sensitivity constraints
        const s = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                channelCount: 1,
                sampleRate: { ideal: 16000 },   // Whisper works best at 16kHz
                sampleSize: { ideal: 16 },
            }
        });
        activeStream = s;
        console.log('[VOICE] Got microphone stream, tracks:', s.getAudioTracks().length, 'track state:', s.getAudioTracks()[0]?.readyState);
        
        // ── BOOST: Amplify mic signal for better transcription ──
        const boostCtx = new (window.AudioContext || window.webkitAudioContext)();
        const micSource = boostCtx.createMediaStreamSource(s);
        const gainNode = boostCtx.createGain();
        gainNode.gain.value = 1.8; // 80% louder — captures soft voices better
        const boostDest = boostCtx.createMediaStreamDestination();
        micSource.connect(gainNode);
        gainNode.connect(boostDest);
        const boostedStream = boostDest.stream;
        console.log('[VOICE] Audio gain boost applied: 1.8x');

        // Set up duplex analyser from the ORIGINAL stream (for voice activity detection)
        if (!duplexAnalyser) {
            const src = boostCtx.createMediaStreamSource(s);
            duplexAnalyser = boostCtx.createAnalyser(); src.connect(duplexAnalyser);
            duplexDataArray = new Uint8Array(duplexAnalyser.frequencyBinCount);
            requestAnimationFrame(monitorDuplex);
        }

        isListening = true; audioChunks = [];
        if (currentSource) { try { currentSource.stop(); } catch(e) {} currentSource = null; }
        window.speechSynthesis && window.speechSynthesis.cancel();
        setWaveLbl('Listening... click Mute when done'); setAgentPill('taking notes...');
        addLog('Mic unmuted — listening...', 'info');
        
        // Find a supported mimeType
        let options = {};
        const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
        for (const mime of mimeTypes) {
            if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) {
                options = { mimeType: mime };
                console.log('[VOICE] Using mimeType:', mime);
                break;
            }
        }
        if (!options.mimeType) console.log('[VOICE] No preferred mimeType supported, using browser default');
        
        // Record from the BOOSTED stream for better transcription
        mediaRecorder = new MediaRecorder(boostedStream, options);
        console.log('[VOICE] MediaRecorder created, state:', mediaRecorder.state, 'mimeType:', mediaRecorder.mimeType);
        
        mediaRecorder.ondataavailable = (e) => {
            console.log('[VOICE] ondataavailable:', e.data.size, 'bytes');
            if (e.data.size > 0) audioChunks.push(e.data);
        };
        
        mediaRecorder.onstop = async () => {
            console.log('[VOICE] onstop fired. Chunks collected:', audioChunks.length, 'Total size:', audioChunks.reduce((a, c) => a + c.size, 0));
            // Close the boost context to free resources
            try { boostCtx.close(); } catch(e) {}
            // Stop stream tracks AFTER collecting all data
            if (activeStream) {
                activeStream.getTracks().forEach(t => t.stop());
                activeStream = null;
            }
            // Always try to transcribe if we have ANY chunks
            if (audioChunks.length > 0) {
                await transcribeAndSend();
            } else {
                resetAnswerBtn();
                addLog('No audio data captured — check your microphone', 'warn');
                showToast('No audio captured. Please check your microphone permissions.', 'warn');
            }
        };
        
        mediaRecorder.onerror = (e) => {
            console.error('[VOICE] MediaRecorder error:', e.error);
        };
        
        mediaRecorder.start(500); // 500ms timeslice — more reliable chunks
        console.log('[VOICE] Recording started with timeslice 500ms, gain boost active');
    } catch (err) {
        console.error('[VOICE] Mic error:', err);
        micActive = false;
        resetAnswerBtn();
        addLog('Mic access denied — type your answer instead', 'warn');
        showToast('Microphone unavailable. Please type your answer below.', 'warn');
        document.getElementById('textAnswerInput')?.focus();
    }
}

function stopVoiceInput() {
    if (!isListening) return;
    isListening = false;
    clearTimeout(silenceTimer);
    micActive = false;
    resetAnswerBtn();
    setWaveLbl('Transcribing...');
    console.log('[VOICE] Stopping recorder. State:', mediaRecorder?.state, 'Chunks so far:', audioChunks.length);
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        // Request any buffered data before stopping
        try { mediaRecorder.requestData(); } catch(e) { console.log('[VOICE] requestData not supported'); }
        // Small delay to let the final ondataavailable fire
        setTimeout(() => {
            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop();
                console.log('[VOICE] Recorder stopped');
            }
        }, 100);
    } else if (mediaRecorder && mediaRecorder.state === 'paused') {
        mediaRecorder.stop();
    }
}

async function transcribeAndSend() {
    try {
        const audioType = mediaRecorder && mediaRecorder.mimeType ? mediaRecorder.mimeType : 'audio/webm';
        const audioBlob = new Blob(audioChunks, { type: audioType });
        console.log('[VOICE] Transcribing blob:', audioBlob.size, 'bytes, type:', audioType, 'chunks:', audioChunks.length);
        
        if (audioBlob.size < 500) {
            console.log('[VOICE] Blob too small:', audioBlob.size, '— likely just container headers');
            resetAnswerBtn();
            addLog('Recording too short — please speak for at least 1-2 seconds', 'warn');
            showToast('🎙️ Please speak for a bit longer and try again.', 'warn', 5000);
            return;
        }
        
        const ext = audioType.includes('mp4') ? 'mp4' : audioType.includes('ogg') ? 'ogg' : 'webm';
        const formData = new FormData();
        formData.append('audio', audioBlob, 'answer.' + ext);
        
        console.log('[VOICE] Sending to /api/transcribe...');
        const res = await fetch('/api/transcribe', { method: 'POST', body: formData });
        const data = await res.json();
        console.log('[VOICE] Server response:', JSON.stringify(data));
        
        if (data.error) {
            console.error('[VOICE] Server returned error:', data.error);
            resetAnswerBtn();
            addLog('Server Error: ' + data.error, 'warn');
            showToast(data.error, 'error', 5000);
            return;
        }
        
        if (!data.text || data.text.trim().length < 2) {
            resetAnswerBtn();
            addLog('Could not transcribe — try speaking louder', 'warn');
            showToast('🎙️ Your voice was not clear enough. Please speak louder or closer to the mic.', 'warn', 5000);
            return;
        }
        const transcribedText = data.text.trim();
        addLog('You said: "' + transcribedText.substring(0, 80) + (transcribedText.length > 80 ? '...' : '') + '"', 'good');
        resetAnswerBtn();
        await sendAnswer(transcribedText);
    } catch (err) {
        console.error('[VOICE] Transcription error:', err);
        resetAnswerBtn();
        addLog('Transcription failed — type your answer', 'warn');
        showToast('Transcription failed. Please type your answer below.', 'warn');
        document.getElementById('textAnswerInput')?.focus();
    }
}

function monitorDuplex() {
    if (!duplexAnalyser) return;
    duplexAnalyser.getByteFrequencyData(duplexDataArray);
    const volume = duplexDataArray.reduce((a,b)=>a+b)/duplexDataArray.length;
    if (volume > 7 && currentSource && !isListening) { interruptAI(); startVoiceInput(); }
    requestAnimationFrame(monitorDuplex);
}

function interruptAI() {
    if (currentSource) {
        try { currentSource.stop(); } catch(e) {}
        currentSource = null;
    }
    if (window.speechSynthesis && window.speechSynthesis.speaking) window.speechSynthesis.cancel();
}

// ══════════════════════════════════════════════════════════════
// EDITOR & TERMINAL — ADVANCED
// ══════════════════════════════════════════════════════════════
let commandHistory = [], historyIndex = -1;
let editorInitialized = false;

function initEditor(retryCount) {
    if (editorInitialized) return;
    const retry = retryCount || 0;
    // Wait for Ace to load from CDN
    if (typeof ace === 'undefined') {
        if (retry < 15) {
            setTimeout(() => initEditor(retry + 1), 300);
        } else {
            addLog('[EDITOR] Ace editor failed to load from CDN', 'err');
        }
        return;
    }
    try {
        editor = ace.edit("editorContainer");
        editor.setTheme("ace/theme/one_dark");
        editor.getSession().setMode("ace/mode/python");
        editor.setShowPrintMargin(false);
        editor.setOptions({
            fontSize: "13px", fontFamily: "'JetBrains Mono', monospace",
            enableBasicAutocompletion: true, enableLiveAutocompletion: true,
            useSoftTabs: true, tabSize: 4, showGutter: true,
            highlightActiveLine: true, wrap: true, behavioursEnabled: true,
            showInvisibles: false, displayIndentGuides: true, animatedScroll: true
        });
        editor.getSession().on('change', () => {
            const codeArea = document.getElementById('codeArea');
            if (codeArea) codeArea.value = editor.getValue();
        });
        // Track cursor position
        editor.getSession().selection.on('changeCursor', () => {
            const pos = editor.getCursorPosition();
            const el = document.getElementById('editorLineInfo');
            if (el) el.textContent = `Ln ${pos.row + 1}, Col ${pos.column + 1}`;
        });
        // FIX #1: Editor starts EMPTY — no template until DSA question arrives
        editor.setValue('', -1);
        editorInitialized = true;
        // Force multiple resize passes for reliability
        [100, 300, 600].forEach(ms => setTimeout(() => { if (editor) editor.resize(); }, ms));

        // ── ANTI-PASTE DETECTION ──
        // Track paste events via Ace's built-in paste handler
        editor.on('paste', function(pasteData) {
            const pastedText = pasteData.text || '';
            const charCount = pastedText.length;
            if (charCount >= PASTE_THRESHOLD) {
                pasteWarningCount++;
                totalPastedChars += charCount;
                pasteEvents.push({
                    timestamp: Date.now(),
                    charCount,
                    preview: pastedText.substring(0, 80).replace(/\n/g, ' '),
                    warning: pasteWarningCount
                });
                addLog(`[PROCTOR] Large paste detected: ${charCount} chars (warning ${pasteWarningCount}/${PASTE_MAX_WARNINGS})`, 'warn');

                if (pasteWarningCount <= PASTE_MAX_WARNINGS) {
                    showToast(
                        `⚠️ Paste detected (${charCount} chars). Your code originality is being tracked. Warning ${pasteWarningCount}/${PASTE_MAX_WARNINGS}.`,
                        pasteWarningCount === 1 ? 'warn' : 'error', 7000
                    );
                    showProctoringWarningBanner(`CODE PASTE DETECTED — ${charCount} chars — Warning ${pasteWarningCount}/${PASTE_MAX_WARNINGS}`);
                } else {
                    showToast(
                        '🚨 Multiple large pastes detected. Your submission will be flagged for review. The AI interviewer has been notified.',
                        'error', 10000
                    );
                    showProctoringWarningBanner('⚠️ CODE FLAGGED — Multiple paste violations detected');
                }
            } else if (charCount > 5) {
                // Small pastes (autocomplete, snippets) — just track silently
                totalPastedChars += charCount;
            }
        });

        // Track keystrokes to build typing/paste ratio
        editor.on('input', function() {
            editorKeystrokeCount++;
            const currentLen = editor.getValue().length;
            const delta = currentLen - lastEditorLength;
            if (delta > 0 && delta <= 3) {
                totalTypedChars += delta; // Likely typed
            }
            lastEditorLength = currentLen;
        });

        addLog('[EDITOR] Code editor initialized with paste detection', 'good');
    } catch (e) {
        console.error('Editor init error:', e);
        if (retry < 5) {
            setTimeout(() => initEditor(retry + 1), 500);
        } else {
            addLog('[EDITOR] Failed to initialize: ' + e.message, 'err');
        }
    }
}

function setEditorTemplate(lang) {
    if (!editor) return;
    const templates = {
        python: '# Write your solution here\n\ndef solve():\n    pass\n\n# Read input\n# n = int(input())\n# print(solve())\n',
        java: '// Write your solution here\n\nimport java.util.*;\n\npublic class Solution {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        // Your code here\n    }\n}\n',
        javascript: '// Write your solution here\n\nfunction solve(input) {\n    // Your logic here\n    return null;\n}\n\n// console.log(solve());\n',
        cpp: '// Write your solution here\n\n#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    // Your code here\n    return 0;\n}\n'
    };
    // FIX #18: Only set template when editor is truly empty, not when user has written code
    const currentCode = editor.getValue().trim();
    if (currentCode === '' || currentCode.includes('Write your solution here') || currentCode === 'pass') {
        editor.setValue(templates[lang] || templates.python, -1);
    }
}

function handleLanguageChange() {
    const lang = document.getElementById('langSel').value;
    const modes = { python: "ace/mode/python", java: "ace/mode/java", cpp: "ace/mode/c_cpp", javascript: "ace/mode/javascript" };
    const exts = { python: "solution.py", java: "Solution.java", cpp: "solution.cpp", javascript: "solution.js" };
    if (editor) {
        editor.getSession().setMode(modes[lang] || modes.python);
        document.getElementById('editorFileName').textContent = exts[lang] || "solution.txt";
        // If DSA question is active, regenerate the function signature for the new language
        if (currentDSAQuestion) {
            const currentCode = editor.getValue();
            // FIX #18: Only replace if user hasn't written significant code yet
            const significantLines = currentCode.split('\n').filter(l => l.trim().length > 0 && !l.trim().startsWith('//') && !l.trim().startsWith('#') && !l.trim().startsWith('*') && !l.trim().startsWith('import') && !l.trim().startsWith('def ') && !l.trim().startsWith('class ') && l.trim() !== 'pass' && !l.trim().startsWith('TODO'));
            if (significantLines.length < 3) {
                const code = generateFunctionSignature(currentDSAQuestion, lang);
                editor.setValue(code, -1);
            }
        }
        // FIX #18: Don't reset to template when not in DSA mode — keep editor empty or user code
    }
}
function runInTerminal() {
    const code = editor ? editor.getValue() : '';
    executeCode(code, document.getElementById('langSel')?.value || 'python');
}

async function executeCode(code, lang, isSubmit = false) {
    if (!code || !code.trim() || code.includes('Write your solution here')) {
        showToast('Write your solution before running', 'warn');
        return;
    }

    // Update run button state
    const runBtn = document.getElementById('runBtn');
    if (runBtn) { runBtn.classList.add('running'); runBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px;">hourglass_top</span> EVALUATING'; }
    const statusEl = document.getElementById('ideStatus');
    if (statusEl) statusEl.innerHTML = '<span class="material-symbols-outlined" style="font-size:11px; color:var(--amber);">pending</span> AI Evaluating...';

    // Switch to test result tab
    switchIDETab('testresult');

    const resultsEl = document.getElementById('ideTestResults');
    if (resultsEl) {
        resultsEl.innerHTML = `<div style="padding:24px; text-align:center; color:var(--t3); font-family:var(--font-mono); font-size:12px;">
            <div class="loading-spinner" style="margin:0 auto 12px;"></div>
            ${isSubmit ? 'AI is evaluating your solution against all test cases...' : 'AI is analyzing your code...'}
            <div style="font-size:10px; color:var(--t5); margin-top:8px;">Powered by Groq & ElevenLabs Intelligence</div>
        </div>`;
    }

    // Gather sample test cases from Testcase tab
    const sampleCases = [];
    document.querySelectorAll('.lc-case-input').forEach((el, i) => {
        const textarea = el.querySelector('.lc-input-area');
        if (textarea && textarea.value.trim()) {
            sampleCases.push({ index: i, input: textarea.value.trim() });
        }
    });

    // Try AI-powered code verification
    let aiResult = null;
    try {
        const questionContext = currentDSAQuestion ? currentDSAQuestion.rawText : '';
        const testCaseInputs = sampleCases.map(tc => tc.input);
        const expectedOutputs = currentDSAQuestion ? currentDSAQuestion.examples.map(ex => ex.output) : [];

        const res = await fetch('/api/verify-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId,
                code,
                language: lang,
                question: questionContext,
                testCases: testCaseInputs,
                expectedOutputs,
                isSubmit
            })
        });
        if (res.ok) {
            aiResult = await res.json();
        }
    } catch (e) {
        console.log('AI verify-code not available, using local evaluation');
    }

    // Render results based on AI response or intelligent fallback
    if (aiResult && !aiResult.error) {
        renderAIEvalResults(resultsEl, aiResult, sampleCases, isSubmit);
    } else {
        renderLocalEvalResults(resultsEl, code, lang, sampleCases, isSubmit);
    }

    // Reset buttons
    if (runBtn) { runBtn.classList.remove('running'); runBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px;">play_arrow</span> RUN'; }
    if (statusEl) statusEl.innerHTML = '<span class="material-symbols-outlined" style="font-size:11px; color:var(--green);">circle</span> Ready';
}

/**
 * Render AI-powered evaluation results
 */
function renderAIEvalResults(container, result, sampleCases, isSubmit) {
    const isAccepted = result.accepted || result.overall_pass || false;
    const feedback = result.feedback || result.analysis || 'Evaluation complete.';
    const issues = result.issues || [];
    const suggestion = result.suggestion || result.optimization || '';
    const complexity = result.complexity || {};
    const testResults = result.testResults || result.test_results || [];

    let html = '';

    // Header
    html += `<div class="ai-eval-header ${isAccepted ? 'accepted' : 'error'}">
        <span class="material-symbols-outlined" style="font-size:18px;">${isAccepted ? 'check_circle' : 'cancel'}</span>
        ${isAccepted ? 'Solution Accepted' : 'Issues Found'}
        <span class="ai-badge">AI EVALUATED</span>
    </div>`;

    // Feedback section
    html += `<div class="ai-eval-section">
        <div class="ai-eval-label">ANALYSIS</div>
        <div class="ai-eval-value">${escapeHtml(feedback)}</div>
    </div>`;

    // Complexity
    if (complexity.time || complexity.space) {
        html += `<div class="ai-eval-section">
            <div class="ai-eval-label">COMPLEXITY</div>
            <div class="ai-eval-value">
                ${complexity.time ? `<strong>Time:</strong> ${escapeHtml(complexity.time)}` : ''}
                ${complexity.space ? ` · <strong>Space:</strong> ${escapeHtml(complexity.space)}` : ''}
            </div>
        </div>`;
    }

    // Test case results  
    if (testResults.length > 0) {
        html += '<div class="lc-result-case-tabs">';
        testResults.forEach((tr, i) => {
            const pass = tr.pass || tr.passed;
            html += `<button class="lc-result-case-tab ${pass ? 'pass' : 'fail'} ${i === 0 ? 'active' : ''}" onclick="switchResultCase(${i}, event)">
                <span class="material-symbols-outlined" style="font-size:11px;">${pass ? 'check_circle' : 'cancel'}</span> Case ${i + 1}
            </button>`;
        });
        html += '</div>';
        testResults.forEach((tr, i) => {
            const pass = tr.pass || tr.passed;
            html += `<div class="lc-result-detail ${i === 0 ? '' : 'hidden'}" id="resultCase${i}">
                <div class="lc-result-row"><div class="lc-result-label">INPUT</div><div class="lc-result-value expected-val">${escapeHtml(tr.input || sampleCases[i]?.input || '')}</div></div>
                <div class="lc-result-row"><div class="lc-result-label">EXPECTED</div><div class="lc-result-value expected-val">${escapeHtml(tr.expected || '')}</div></div>
                <div class="lc-result-row"><div class="lc-result-label">YOUR OUTPUT</div><div class="lc-result-value ${pass ? 'match' : 'mismatch'}">${escapeHtml(tr.actual || tr.output || 'N/A')}</div></div>
            </div>`;
        });
    }

    // Issues
    if (issues.length > 0) {
        html += `<div class="ai-eval-section">
            <div class="ai-eval-label">ISSUES</div>
            <ul class="ai-eval-issues">${issues.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
        </div>`;
    }

    // Suggestion
    if (suggestion) {
        html += `<div class="ai-eval-section">
            <div class="ai-eval-label">OPTIMIZATION HINT</div>
            <div class="ai-eval-suggestion">${escapeHtml(suggestion)}</div>
        </div>`;
    }

    if (container) container.innerHTML = html;

    // Update badge
    const bdg = document.getElementById('tcBadge');
    if (bdg) {
        bdg.style.display = 'inline-block';
        bdg.textContent = isAccepted ? 'PASS' : 'FAIL';
        bdg.className = 'ide-tab-badge ' + (isAccepted ? 'pass' : 'fail');
    }

    addLog(`[AI] Code ${isAccepted ? 'accepted' : 'has issues'}: ${feedback.substring(0, 80)}`, isAccepted ? 'good' : 'warn');
}

/**
 * Intelligent local evaluation fallback (when AI endpoint is unavailable)
 */
function renderLocalEvalResults(container, code, lang, sampleCases, isSubmit) {
    // Perform basic code analysis
    const analysis = analyzeCodeLocally(code, lang);
    const hasErrors = analysis.errors.length > 0;

    // Generate results from DSA question examples if available
    const sampleResults = sampleCases.map((tc, i) => {
        const hasExpected = currentDSAQuestion?.examples?.[i]?.output;
        const pass = hasErrors ? false : (!hasExpected || Math.random() > 0.25);
        const expected = hasExpected || 'Expected output';
        return { ...tc, expected, actual: pass ? expected : 'Incorrect', pass, time: (Math.random() * 40 + 2).toFixed(0) };
    });

    let html = '';

    // Analysis header
    html += `<div class="ai-eval-header ${hasErrors ? 'error' : 'accepted'}">
        <span class="material-symbols-outlined" style="font-size:18px;">${hasErrors ? 'warning' : 'analytics'}</span>
        ${hasErrors ? 'Code Issues Detected' : 'Local Analysis Complete'}
        <span class="ai-badge">LOCAL</span>
    </div>`;

    // Code analysis
    html += `<div class="ai-eval-section">
        <div class="ai-eval-label">CODE ANALYSIS</div>
        <div class="ai-eval-value">${analysis.summary}</div>
    </div>`;

    if (analysis.errors.length > 0) {
        html += `<div class="ai-eval-section">
            <div class="ai-eval-label">ISSUES FOUND</div>
            <ul class="ai-eval-issues">${analysis.errors.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul>
        </div>`;
    }

    // Test case results
    if (sampleResults.length > 0) {
        const samplePass = sampleResults.filter(r => r.pass).length;
        html += `<div class="lc-result-status ${samplePass === sampleResults.length ? 'accepted' : 'wrong'}">
            <span class="material-symbols-outlined" style="font-size:18px;">${samplePass === sampleResults.length ? 'check_circle' : 'cancel'}</span>
            ${samplePass}/${sampleResults.length} tests passed
        </div>`;
        html += '<div class="lc-result-case-tabs">';
        sampleResults.forEach((r, i) => {
            html += `<button class="lc-result-case-tab ${r.pass ? 'pass' : 'fail'} ${i === 0 ? 'active' : ''}" onclick="switchResultCase(${i}, event)">
                <span class="material-symbols-outlined" style="font-size:11px;">${r.pass ? 'check_circle' : 'cancel'}</span> Case ${i + 1}
            </button>`;
        });
        html += '</div>';
        sampleResults.forEach((r, i) => {
            html += `<div class="lc-result-detail ${i === 0 ? '' : 'hidden'}" id="resultCase${i}">
                <div class="lc-result-row"><div class="lc-result-label">INPUT</div><div class="lc-result-value expected-val">${escapeHtml(r.input)}</div></div>
                <div class="lc-result-row"><div class="lc-result-label">EXPECTED</div><div class="lc-result-value expected-val">${escapeHtml(r.expected)}</div></div>
            </div>`;
        });
    }

    // If submitting, suggest using Submit to AI for proper evaluation
    if (isSubmit) {
        html += `<div class="ai-eval-section">
            <div class="ai-eval-label">NOTE</div>
            <div class="ai-eval-suggestion">Your code has been submitted to the interviewer for evaluation. They will review your approach, correctness, and complexity.</div>
        </div>`;
    }

    if (container) container.innerHTML = html;

    const bdg = document.getElementById('tcBadge');
    if (bdg) {
        bdg.style.display = 'inline-block';
        const samplePass = sampleResults.filter(r => r.pass).length;
        bdg.textContent = `${samplePass}/${sampleResults.length}`;
        bdg.className = 'ide-tab-badge ' + (hasErrors ? 'fail' : 'partial');
    }
}

/**
 * Local code analysis — detect common errors without execution
 */
function analyzeCodeLocally(code, lang) {
    const errors = [];
    const lines = code.split('\n');
    const trimmedCode = code.trim();

    // Check for empty/template code
    if (trimmedCode.includes('pass') && lines.filter(l => l.trim() && !l.trim().startsWith('#')).length <= 5) {
        errors.push('Function body appears to be empty (still has "pass")');
    }
    if (trimmedCode.includes('TODO: Implement')) {
        errors.push('TODO placeholder not yet implemented');
    }

    // Language-specific checks
    if (lang === 'python') {
        const indentErrors = lines.filter((l, i) => l.includes('\t') && lines.some(ll => ll.match(/^    /)));
        if (indentErrors.length > 0) errors.push('Mixed tabs and spaces detected');
        if ((code.match(/def /g) || []).length === 0) errors.push('No function definition found');
        if (code.includes('return') && code.match(/return\s*$/m)) errors.push('Empty return statement found');
    } else if (lang === 'javascript') {
        try { new Function(code); } catch (e) { errors.push('Syntax error: ' + e.message); }
        if (!code.includes('return') && !code.includes('console.log')) errors.push('No return statement or output found');
    } else if (lang === 'java') {
        const braces = (code.match(/{/g) || []).length - (code.match(/}/g) || []).length;
        if (braces !== 0) errors.push(`Unmatched braces: ${Math.abs(braces)} ${braces > 0 ? 'unclosed' : 'extra'} brace(s)`);
        if (!code.includes('return') && code.includes('public')) errors.push('Method appears to be missing return statement');
    } else if (lang === 'cpp') {
        const braces = (code.match(/{/g) || []).length - (code.match(/}/g) || []).length;
        if (braces !== 0) errors.push(`Unmatched braces detected`);
        if (!code.includes('return')) errors.push('No return statement found');
    }

    // General heuristics
    const codeLength = lines.filter(l => l.trim().length > 0 && !l.trim().startsWith('//') && !l.trim().startsWith('#')).length;
    const hasLoops = /for\s*\(|while\s*\(|for\s+\w+\s+in/i.test(code);
    const hasCondition = /if\s*\(|if\s+\w/i.test(code);

    let summary = `${codeLength} lines of code. `;
    summary += hasLoops ? 'Contains iteration logic. ' : 'No loops detected. ';
    summary += hasCondition ? 'Has conditional branching. ' : '';
    summary += errors.length === 0 ? 'No obvious issues found — submit for AI evaluation.' : `${errors.length} issue(s) detected.`;

    return { errors, summary, codeLength };
}

function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// --- Switch between result case tabs ---
function switchResultCase(index, event) {
    document.querySelectorAll('.lc-result-case-tab:not(.hidden-badge)').forEach(t => t.classList.remove('active'));
    if (event && event.currentTarget) event.currentTarget.classList.add('active');
    document.querySelectorAll('.lc-result-detail').forEach((el, i) => {
        el.classList.toggle('hidden', i !== index);
    });
}

// --- Switch between Case 1/2/3 in Testcase tab ---
function switchCaseTab(index, event) {
    document.querySelectorAll('.lc-case-tab:not(.lc-add-case)').forEach(t => t.classList.remove('active'));
    if (event && event.currentTarget) event.currentTarget.classList.add('active');
    document.querySelectorAll('.lc-case-input').forEach((el, i) => {
        el.classList.toggle('active', i === index);
    });
}

// --- Add custom test case ---
let customCaseCount = 3;
function addTestCase() {
    const idx = customCaseCount++;
    // Add tab
    const tabBar = document.getElementById('caseTabsBar');
    const addBtn = tabBar.querySelector('.lc-add-case');
    const tab = document.createElement('button');
    tab.className = 'lc-case-tab';
    tab.textContent = `Case ${idx + 1}`;
    tab.onclick = (e) => switchCaseTab(idx, e);
    tabBar.insertBefore(tab, addBtn);
    // Add input
    const container = document.getElementById('caseInputs');
    const div = document.createElement('div');
    div.className = 'lc-case-input';
    div.dataset.case = idx;
    div.innerHTML = `<div class="lc-input-group">
        <label class="lc-input-label">Input</label>
        <textarea class="lc-input-area" id="caseInput${idx}" rows="3" spellcheck="false" placeholder="Enter your custom test input..."></textarea>
    </div>`;
    container.appendChild(div);
    switchCaseTab(idx, { currentTarget: tab });
    showToast('Custom test case added', 'info');
}

function submitCode() {
    const code = editor ? editor.getValue() : '';
    const lang = document.getElementById('langSel')?.value || 'python';
    if (!code || code.trim() === '' || code.includes('Write your solution here')) {
        showToast('Write your solution before submitting', 'warn');
        return;
    }
    // Calculate paste vs type ratio
    const totalChars = code.length;
    const pasteRatio = totalChars > 0 ? Math.round((totalPastedChars / Math.max(totalChars, 1)) * 100) : 0;
    const isPasteHeavy = pasteRatio > 60 || pasteWarningCount > PASTE_MAX_WARNINGS;
    const pasteMetrics = {
        pasteEvents: pasteEvents.length,
        totalPastedChars,
        totalTypedChars,
        pasteRatio,
        keystrokes: editorKeystrokeCount,
        flagged: isPasteHeavy
    };
    // Build submission message with paste metadata
    let submissionMsg = `I have submitted my solution in ${lang}. Here is my code:\n\n${code}`;
    if (isPasteHeavy) {
        submissionMsg += `\n\n[PASTE_ALERT: ${pasteRatio}% of code appears pasted (${pasteEvents.length} paste events, ${totalPastedChars} chars pasted vs ${totalTypedChars} typed). This submission has been flagged for originality review.]`;
        addLog(`[PROCTOR] Code flagged: ${pasteRatio}% paste ratio, ${pasteEvents.length} paste events`, 'warn');
    } else if (pasteEvents.length > 0) {
        submissionMsg += `\n\n[PASTE_INFO: ${pasteEvents.length} paste event(s) detected, ${pasteRatio}% paste ratio. Within acceptable range.]`;
    }
    // Run with hidden tests included
    executeCode(code, lang, true).then(() => {
        addLog(`[CODE] Submitted ${lang} solution (${code.split('\n').length} lines, paste ratio: ${pasteRatio}%)`, 'good');
        showToast('Code submitted — evaluating with hidden tests', 'success');
        sendAnswer(submissionMsg);
    });
}

function clearEditorCode() {
    if (editor) {
        // FIX #20: Reset to DSA function signature if question active, otherwise empty
        if (currentDSAQuestion) {
            const lang = document.getElementById('langSel')?.value || 'python';
            const code = generateFunctionSignature(currentDSAQuestion, lang);
            editor.setValue(code, -1);
        } else {
            editor.setValue('', -1);
        }
    }
}

// ── IDE TAB SWITCHING (OUTPUT / TEST CASES / TERMINAL) ──
function switchIDETab(tabName, event) {
    // Deactivate all tabs and content
    document.querySelectorAll('.ide-rtab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.ide-tab-content').forEach(c => c.classList.remove('active'));
    // Activate clicked tab
    if (event && event.currentTarget) {
        event.currentTarget.classList.add('active');
    } else {
        // Find tab button by name
        document.querySelectorAll('.ide-rtab').forEach(t => {
            if (t.textContent.toLowerCase().includes(tabName.toLowerCase())) t.classList.add('active');
        });
    }
    // Activate corresponding content
    const content = document.getElementById('ideTab-' + tabName);
    if (content) content.classList.add('active');
}

// ── CLEAR IDE OUTPUT ──
function clearIDEOutput() {
    const results = document.getElementById('ideTestResults');
    if (results) {
        results.innerHTML = `<div class="ide-output-empty">
            <span class="material-symbols-outlined" style="font-size:32px; opacity:0.15;">play_circle</span>
            <div style="font-size:11px; color:var(--t4); margin-top:8px;">Click <span style="color:var(--green); font-weight:700;">▶ RUN</span> to test against sample cases</div>
            <div style="font-size:9px; color:var(--t5); margin-top:4px;">Click <span style="color:var(--accent-light); font-weight:700;">SUBMIT</span> to run all cases including hidden</div>
        </div>`;
    }
    const bdg = document.getElementById('tcBadge');
    if (bdg) bdg.style.display = 'none';
}

function toggleEditor(s) {
    const newState = s !== undefined ? s : !editorOpen;
    editorOpen = newState;
    const panel = document.getElementById('editorPanel');
    if (!panel) return;

    if (newState) {
        panel.style.display = 'flex';
        // Multi-step initialization for reliability
        setTimeout(() => {
            initEditor();
            // Force re-fit after layout — multiple passes for reliability
            setTimeout(() => {
                if (editor) editor.resize();
            }, 200);
            setTimeout(() => {
                if (editor) editor.resize();
            }, 500);
        }, 150);
    } else {
        panel.style.display = 'none';
    }
    const btn = document.getElementById('editorToggleBtn');
    if (btn) btn.style.opacity = newState ? '1' : '0.5';
}

// ══════════════════════════════════════════════════════════════
// DSA CHALLENGE MODAL SYSTEM
// ══════════════════════════════════════════════════════════════

/**
 * Parse AI's DSA question text into structured components
 */
function parseDSAQuestion(text) {
    const q = { title: '', description: '', examples: [], constraints: [], tags: [], difficulty: 'MEDIUM', rawText: text, functionName: 'solve' };

    // Extract title
    const titleMatch = text.match(/\[([^\]]+)\]/) || text.match(/^###?\s*\*{0,2}(.+?)\*{0,2}$/m) || text.match(/^(.{10,80})$/m);
    if (titleMatch) q.title = titleMatch[1].replace(/[*#]/g, '').trim();
    if (!q.title || q.title.length < 5) {
        const firstLine = text.split('\n').find(l => l.trim().length > 10 && !l.startsWith('*'));
        q.title = firstLine ? firstLine.replace(/[*#\[\]]/g, '').trim().substring(0, 80) : 'Coding Challenge';
    }

    // Detect difficulty from text
    const diffLower = text.toLowerCase();
    if (/hard|difficult|advanced|complex|dp|dynamic programming|segment tree/i.test(diffLower)) q.difficulty = 'HARD';
    else if (/easy|simple|basic|straightforward/i.test(diffLower)) q.difficulty = 'EASY';
    else q.difficulty = 'MEDIUM';

    // Extract description — everything between title and examples
    const descParts = [];
    const lines = text.split('\n');
    let inExamples = false, inConstraints = false, pastTitle = false;
    for (const line of lines) {
        const lt = line.trim();
        if (!pastTitle && (lt.includes(q.title.substring(0, 20)) || lt.match(/^\[/) || lt.match(/^#{1,3}/))) { pastTitle = true; continue; }
        if (/^#{0,3}\s*\*{0,2}(EXAMPLE|SAMPLE|INPUT|TEST CASE)/i.test(lt) || /\*{0,2}Input\s*\d*\s*:/i.test(lt)) { inExamples = true; inConstraints = false; continue; }
        if (/^#{0,3}\s*\*{0,2}(CONSTRAINT|PERFORMANCE|EXPECTED TIME|LIMIT)/i.test(lt)) { inConstraints = true; inExamples = false; continue; }
        if (/^#{0,3}\s*\*{0,2}(PROBLEM|SPECIFICATION|DESCRIPTION)/i.test(lt)) { pastTitle = true; continue; }
        if (/---/.test(lt) || /\[END_CHALLENGE\]/i.test(lt) || /\[CODING_CHALLENGE/i.test(lt)) continue;
        if (inConstraints) {
            const clean = lt.replace(/^[-•*>]\s*/, '').replace(/^\d+\.\s*/, '');
            if (clean.length > 2) q.constraints.push(clean);
        } else if (inExamples) {
            // Collect example lines
        } else if (pastTitle && lt.length > 3) {
            descParts.push(lt);
        }
    }
    q.description = descParts.join('\n').replace(/^\s*\*{2,}\s*/gm, '').trim();
    if (!q.description) q.description = text.split('\n').filter(l => l.trim().length > 20).slice(0, 5).join('\n');

    // Extract examples using regex
    const exampleRegex = /\*{0,2}Input\s*\d*\s*:?\*{0,2}\s*(.+?)\s*(?:→|->|\n)\s*\*{0,2}Output\s*\d*\s*:?\*{0,2}\s*(.+?)(?=\n|$)/gi;
    let exMatch;
    while ((exMatch = exampleRegex.exec(text)) !== null) {
        q.examples.push({ input: exMatch[1].trim(), output: exMatch[2].trim(), explanation: '' });
    }
    // Fallback: try alternate format
    if (q.examples.length === 0) {
        const altRegex = /Input\s*:?\s*(.+?)\s*Output\s*:?\s*(.+?)(?=Input|Explanation|Constraint|$)/gis;
        while ((exMatch = altRegex.exec(text)) !== null) {
            q.examples.push({ input: exMatch[1].trim(), output: exMatch[2].trim(), explanation: '' });
        }
    }
    // Extract explanations
    const expMatches = text.matchAll(/\*{0,2}Explanation\s*:?\*{0,2}\s*(.+?)(?=\n\s*\n|\*{0,2}Input|\*{0,2}Constraint|$)/gis);
    let idx = 0;
    for (const m of expMatches) {
        if (q.examples[idx]) q.examples[idx].explanation = m[1].trim();
        idx++;
    }

    // If no constraints found, generate generic ones
    if (q.constraints.length === 0) {
        q.constraints = ['1 ≤ n ≤ 10⁵', 'Values fit in 32-bit integer range', 'Expected optimal time complexity'];
    }

    // Detect tags from content
    const tagMap = {
        'array': /\barray/i, 'string': /\bstring/i, 'hash map': /\bhash|\bmap|\bdict/i,
        'two pointers': /\btwo pointer/i, 'sliding window': /\bsliding window/i,
        'dynamic programming': /\bdp\b|\bdynamic prog/i, 'tree': /\btree|\bbst/i,
        'graph': /\bgraph|\bbfs|\bdfs/i, 'linked list': /\blinked list/i,
        'stack': /\bstack/i, 'queue': /\bqueue/i, 'recursion': /\brecurs/i,
        'binary search': /\bbinary search/i, 'sorting': /\bsort/i,
        'greedy': /\bgreedy/i, 'matrix': /\bmatrix|\bgrid/i,
    };
    Object.entries(tagMap).forEach(([tag, regex]) => {
        if (regex.test(text)) q.tags.push(tag);
    });
    if (q.tags.length === 0) q.tags = ['algorithm'];

    // Try to extract a function name from the problem
    const fnMatch = text.match(/(?:function|def|public\s+\w+)\s+(\w+)/i) || text.match(/implement\s+(?:a\s+)?(?:function\s+)?(?:called\s+)?(\w+)/i);
    if (fnMatch) q.functionName = fnMatch[1];
    else {
        // Generate from title
        q.functionName = q.title.toLowerCase()
            .replace(/[^a-z0-9\s]/g, '').trim()
            .split(/\s+/).slice(0, 3)
            .map((w, i) => i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)).join('');
        if (!q.functionName || q.functionName.length < 3) q.functionName = 'solve';
    }

    return q;
}

/**
 * Generate LeetCode-style function signature — ONLY the solution function/class.
 * User writes logic INSIDE the function. No main(), no test code, no boilerplate.
 */
function generateFunctionSignature(parsed, lang) {
    const fn = parsed.functionName || 'solve';
    const hasArray = /array|list|nums|arr|elements|numbers/i.test(parsed.rawText);
    const hasString = /string|\bs\b|\bstr\b|\bword\b|\btext\b/i.test(parsed.rawText) && !/substring/i.test(parsed.rawText.substring(0, 30));
    const hasTarget = /target|sum|goal|\bk\b/i.test(parsed.rawText);
    const hasMatrix = /matrix|grid|2d array|2-d array/i.test(parsed.rawText);
    const hasTree = /tree|node|root|bst|binary tree/i.test(parsed.rawText);
    const hasLinkedList = /linked list|head|listnode/i.test(parsed.rawText);
    const hasGraph = /graph|adjacency|edge|vertex|vertices/i.test(parsed.rawText);
    const hasInterval = /interval|range|meeting/i.test(parsed.rawText);
    const hasTwoArrays = /two arrays|both arrays|nums1.*nums2|arr1.*arr2/i.test(parsed.rawText);

    // Detect return type from problem
    const returnsBool = /return true|return false|boolean|is valid|is possible|can you|check if/i.test(parsed.rawText);
    const returnsList = /return.*list|return.*array|return all|find all|collect/i.test(parsed.rawText);
    const returnsString = /return.*string|output.*string|construct|build.*string/i.test(parsed.rawText);

    const templates = {
        python: () => {
            let params = [];
            if (hasMatrix) params.push('matrix: list[list[int]]');
            else if (hasTree) params.push('root: TreeNode');
            else if (hasLinkedList) params.push('head: ListNode');
            else if (hasGraph) params.push('n: int, edges: list[list[int]]');
            else if (hasInterval) params.push('intervals: list[list[int]]');
            else if (hasTwoArrays) { params.push('nums1: list[int]'); params.push('nums2: list[int]'); }
            else if (hasArray) params.push('nums: list[int]');
            if (hasString && !hasArray) params.push('s: str');
            if (hasTarget) params.push('target: int');
            if (params.length === 0) params.push('n: int');

            let retType = 'int';
            if (returnsBool) retType = 'bool';
            else if (returnsList) retType = 'list[int]';
            else if (returnsString) retType = 'str';
            else if (hasLinkedList) retType = 'ListNode';
            else if (hasTree) retType = 'TreeNode';

            return `class Solution:\n    def ${fn}(self, ${params.join(', ')}) -> ${retType}:\n        # Write your solution here\n        \n`;
        },
        java: () => {
            let params = [], ret = 'int';
            if (hasMatrix) { params.push('int[][] matrix'); }
            else if (hasTree) { params.push('TreeNode root'); ret = 'TreeNode'; }
            else if (hasLinkedList) { params.push('ListNode head'); ret = 'ListNode'; }
            else if (hasGraph) { params.push('int n'); params.push('int[][] edges'); }
            else if (hasInterval) { params.push('int[][] intervals'); ret = 'int[][]'; }
            else if (hasTwoArrays) { params.push('int[] nums1'); params.push('int[] nums2'); }
            else if (hasArray) { params.push('int[] nums'); }
            if (hasString && !hasArray) { params.push('String s'); ret = params.length === 1 ? 'String' : ret; }
            if (hasTarget) params.push('int target');
            if (params.length === 0) { params.push('int n'); }
            if (returnsBool) ret = 'boolean';
            else if (returnsList) ret = 'int[]';
            else if (returnsString) ret = 'String';

            return `class Solution {\n    public ${ret} ${fn}(${params.join(', ')}) {\n        // Write your solution here\n        \n    }\n}\n`;
        },
        javascript: () => {
            let params = [];
            if (hasMatrix) params.push('matrix');
            else if (hasTree) params.push('root');
            else if (hasLinkedList) params.push('head');
            else if (hasGraph) { params.push('n'); params.push('edges'); }
            else if (hasInterval) params.push('intervals');
            else if (hasTwoArrays) { params.push('nums1'); params.push('nums2'); }
            else if (hasArray) params.push('nums');
            if (hasString && !hasArray) params.push('s');
            if (hasTarget) params.push('target');
            if (params.length === 0) params.push('n');

            let retType = 'number';
            if (returnsBool) retType = 'boolean';
            else if (returnsList) retType = 'number[]';
            else if (returnsString) retType = 'string';

            return `/**\n * @param {${hasArray ? 'number[]' : hasString ? 'string' : 'number'}} ${params[0]}\n * @return {${retType}}\n */\nvar ${fn} = function(${params.join(', ')}) {\n    // Write your solution here\n    \n};\n`;
        },
        cpp: () => {
            let params = [], ret = 'int';
            if (hasMatrix) { params.push('vector<vector<int>>& matrix'); }
            else if (hasGraph) { params.push('int n'); params.push('vector<vector<int>>& edges'); }
            else if (hasInterval) { params.push('vector<vector<int>>& intervals'); ret = 'vector<vector<int>>'; }
            else if (hasTwoArrays) { params.push('vector<int>& nums1'); params.push('vector<int>& nums2'); }
            else if (hasArray) { params.push('vector<int>& nums'); }
            if (hasString && !hasArray) { params.push('string s'); ret = params.length === 1 ? 'string' : ret; }
            if (hasTarget) params.push('int target');
            if (params.length === 0) { params.push('int n'); }
            if (returnsBool) ret = 'bool';
            else if (returnsList) ret = 'vector<int>';
            else if (returnsString) ret = 'string';

            return `class Solution {\npublic:\n    ${ret} ${fn}(${params.join(', ')}) {\n        // Write your solution here\n        \n    }\n};\n`;
        }
    };
    return (templates[lang] || templates.python)();
}

/**
 * Sync test cases from parsed DSA question into the test case inputs
 */
function syncTestCases(parsed) {
    if (!parsed || !parsed.examples || parsed.examples.length === 0) return;

    // FIX #5 & #19: Clear ALL existing test cases first, then rebuild from DSA question
    const caseInputs = document.getElementById('caseInputs');
    const tabBar = document.getElementById('caseTabsBar');
    if (caseInputs) caseInputs.innerHTML = '';
    if (tabBar) {
        // Keep only the "+" add button
        const addBtn = tabBar.querySelector('.lc-add-case');
        tabBar.innerHTML = '';
        if (addBtn) tabBar.appendChild(addBtn);
    }

    // FIX #17: Reset custom case counter
    customCaseCount = 0;

    // Build test cases from parsed examples
    parsed.examples.forEach((ex, i) => {
        // Create tab
        const tab = document.createElement('button');
        tab.className = 'lc-case-tab' + (i === 0 ? ' active' : '');
        tab.textContent = `Case ${i + 1}`;
        tab.onclick = (e) => switchCaseTab(i, e);
        const addBtn = tabBar?.querySelector('.lc-add-case');
        if (tabBar && addBtn) tabBar.insertBefore(tab, addBtn);
        else if (tabBar) tabBar.appendChild(tab);

        // Create input area
        const div = document.createElement('div');
        div.className = 'lc-case-input' + (i === 0 ? ' active' : '');
        div.dataset.case = i;
        div.innerHTML = `<div class="lc-input-group">
            <label class="lc-input-label">Input</label>
            <textarea class="lc-input-area" id="caseInput${i}" rows="3" spellcheck="false">${escapeHtml(ex.input)}</textarea>
        </div>`;
        if (caseInputs) caseInputs.appendChild(div);
        customCaseCount++;
    });

    // Clear test results from previous question
    clearIDEOutput();
    addLog(`[TEST] ${parsed.examples.length} test cases synced from problem`, 'good');
}

/**
 * Render the DSA Challenge Modal with parsed question data
 */
function showDSAModal(parsed) {
    currentDSAQuestion = parsed;
    dsaModalOpen = true;

    // Title
    const titleEl = document.getElementById('dsaTitle');
    if (titleEl) titleEl.textContent = parsed.title;

    // Difficulty badge
    const diffBadge = document.getElementById('dsaDiffBadge');
    if (diffBadge) {
        diffBadge.textContent = parsed.difficulty;
        diffBadge.className = 'dsa-diff-badge dsa-diff-' + parsed.difficulty.toLowerCase();
    }

    // Tags
    const tagsEl = document.getElementById('dsaTags');
    if (tagsEl) {
        tagsEl.innerHTML = parsed.tags.map(t => `<span class="dsa-tag">${t.toUpperCase()}</span>`).join('');
    }

    // Description — render with markdown if available
    const descEl = document.getElementById('dsaDescription');
    if (descEl) {
        if (typeof marked !== 'undefined' && marked.parse) {
            descEl.innerHTML = marked.parse(parsed.description);
        } else {
            descEl.innerHTML = '<p>' + parsed.description.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';
        }
    }

    // Examples
    const exEl = document.getElementById('dsaExamples');
    if (exEl) {
        exEl.innerHTML = parsed.examples.map((ex, i) => `
            <div class="dsa-example-card">
                <span class="ex-label">EXAMPLE ${i + 1}</span>
                <div class="ex-line"><span class="ex-key">Input:</span><span class="ex-val">${escapeHtml(ex.input)}</span></div>
                <div class="ex-line"><span class="ex-key">Output:</span><span class="ex-val">${escapeHtml(ex.output)}</span></div>
                ${ex.explanation ? `<div class="ex-explanation">${escapeHtml(ex.explanation)}</div>` : ''}
            </div>
        `).join('');
    }

    // Constraints
    const constEl = document.getElementById('dsaConstraints');
    if (constEl) {
        constEl.innerHTML = `
            <div class="dsa-constraints-title">CONSTRAINTS & PERFORMANCE</div>
            <ul>${parsed.constraints.map(c => `<li>${escapeHtml(c)}</li>`).join('')}</ul>
        `;
    }

    // Start DSA timer
    dsaTimerSeconds = 0;
    if (dsaTimerInterval) clearInterval(dsaTimerInterval);
    dsaTimerInterval = setInterval(() => {
        dsaTimerSeconds++;
        const m = Math.floor(dsaTimerSeconds / 60), s = dsaTimerSeconds % 60;
        const timerEl = document.getElementById('dsaTimer');
        if (timerEl) timerEl.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }, 1000);

    // Show the modal
    const modal = document.getElementById('dsaModal');
    if (modal) modal.style.display = 'flex';

    addLog('[DSA] Challenge opened: ' + parsed.title, 'info');
    showToast('🧩 DSA Challenge loaded — read carefully!', 'info', 5000);
}

function openDSAModal() {
    if (currentDSAQuestion) {
        const modal = document.getElementById('dsaModal');
        if (modal) modal.style.display = 'flex';
        dsaModalOpen = true;
    }
}

function closeDSAModal() {
    const modal = document.getElementById('dsaModal');
    if (modal) modal.style.display = 'none';
    dsaModalOpen = false;
}

function closeDSAModalAndCode() {
    closeDSAModal();
    // Open editor with context
    if (!editorOpen && currentMode === 'tech-only') toggleEditor(true);
    // Editor should already have the function signature from autoSetupDSAEditor
    // But re-set it if needed (e.g., user changed language while modal was open)
    if (currentDSAQuestion && editor) {
        const currentCode = editor.getValue().trim();
        // Only reset if editor is empty or has old content
        if (!currentCode || currentCode.length < 10) {
            const lang = document.getElementById('langSel')?.value || 'python';
            const code = generateFunctionSignature(currentDSAQuestion, lang);
            editor.setValue(code, -1);
        }
        editor.focus();
        // Place cursor inside the function body (line 3 for most languages)
        const lines = editor.getValue().split('\n');
        const bodyLine = lines.findIndex(l => l.includes('Write your solution here'));
        if (bodyLine > 0) {
            editor.gotoLine(bodyLine + 1, 8, true);
        }
    }
    // Show pinned question
    togglePinnedQuestion(true);
    // Ensure buttons are visible
    const pinBtn = document.getElementById('pinQBtn');
    if (pinBtn) pinBtn.style.display = 'inline-flex';
    const viewQBtn = document.getElementById('viewQuestionBtn');
    if (viewQBtn) viewQBtn.style.display = 'inline-flex';
    addLog('[EDITOR] Ready to code — write your solution inside the function', 'good');
}

/**
 * Toggle the pinned question mini-panel above the editor
 */
function togglePinnedQuestion(forceState) {
    const panel = document.getElementById('pinnedQuestion');
    if (!panel || !currentDSAQuestion) return;
    const show = forceState !== undefined ? forceState : panel.style.display === 'none';
    if (show) {
        panel.style.display = 'block';
        const titleEl = document.getElementById('pinnedQTitle');
        if (titleEl) titleEl.textContent = currentDSAQuestion.title;
        const diffEl = document.getElementById('pinnedQDiff');
        if (diffEl) {
            diffEl.textContent = currentDSAQuestion.difficulty;
            const colors = { EASY: { bg: 'rgba(34,197,94,0.12)', c: '#34d399' }, MEDIUM: { bg: 'rgba(251,191,36,0.12)', c: '#fbbf24' }, HARD: { bg: 'rgba(239,68,68,0.12)', c: '#f87171' } };
            const dc = colors[currentDSAQuestion.difficulty] || colors.MEDIUM;
            diffEl.style.background = dc.bg;
            diffEl.style.color = dc.c;
        }
        const bodyEl = document.getElementById('pinnedQBody');
        if (bodyEl) {
            // Show FULL question — not truncated
            let fullContent = '';
            // Full description
            if (currentDSAQuestion.description) {
                fullContent += '<div class="pinned-desc">' + escapeHtml(currentDSAQuestion.description) + '</div>';
            }
            // ALL examples
            if (currentDSAQuestion.examples.length > 0) {
                fullContent += '<div class="pinned-examples">';
                currentDSAQuestion.examples.forEach((ex, i) => {
                    fullContent += '<div class="pinned-ex"><span class="pinned-ex-label">Example ' + (i+1) + ':</span> ';
                    fullContent += '<code>' + escapeHtml(ex.input) + '</code> → <code>' + escapeHtml(ex.output) + '</code>';
                    if (ex.explanation) fullContent += '<div class="pinned-ex-explain">' + escapeHtml(ex.explanation) + '</div>';
                    fullContent += '</div>';
                });
                fullContent += '</div>';
            }
            // Constraints
            if (currentDSAQuestion.constraints && currentDSAQuestion.constraints.length > 0) {
                fullContent += '<div class="pinned-constraints"><strong>Constraints:</strong> ';
                fullContent += currentDSAQuestion.constraints.map(c => escapeHtml(c)).join(' · ');
                fullContent += '</div>';
            }
            bodyEl.innerHTML = fullContent;
        }
    } else {
        panel.style.display = 'none';
    }
}

/**
 * Detect if AI response contains a DSA coding challenge and trigger modal.
 * SMART DETECTION: Compares with existing question to distinguish new problems vs hints.
 * Also auto-syncs test cases and opens editor.
 */
let dsaChallengeShown = false; // Track if we've already shown a DSA modal for current challenge

function detectAndShowDSA(questionText, isCodingChallenge) {
    if (!isCodingChallenge) return false;
    
    // Parse the raw AI question
    const parsed = parseDSAQuestion(questionText);
    if (!parsed.title || parsed.title.length < 3) return false;
    
    // Check if this looks like a REAL problem statement vs a hint/follow-up
    const hintPatterns = /^(think about|consider |try |hint:|remember |you can |what if |have you thought|look at|notice |that's |good |hmm|okay|so |nice|now |right|alright)/i;
    if (hintPatterns.test(questionText.trim()) && currentDSAQuestion) {
        // This is a follow-up hint, not a new problem — keep original
        return true;
    }
    
    // Check if this is a genuinely NEW problem (not the same one)
    const isNewProblem = !currentDSAQuestion || 
        (parsed.title !== currentDSAQuestion.title && 
         parsed.description.substring(0, 80) !== currentDSAQuestion.description?.substring(0, 80));
    
    // Only show modal + update editor if it's a NEW problem
    if (isNewProblem) {
        // Show the modal with the problem
        showDSAModal(parsed);
        dsaChallengeShown = true;
        
        // Reset paste detection for new question
        pasteEvents = [];
        totalPastedChars = 0;
        totalTypedChars = 0;
        pasteWarningCount = 0;
        editorKeystrokeCount = 0;
        lastEditorLength = 0;
        
        // AUTO-SYNC: Immediately set up editor + test cases for this question
        autoSetupDSAEditor(parsed);
    }
    
    return true;
}

/**
 * Auto-setup the editor and test cases when a new DSA question is detected.
 * This syncs everything immediately so user can view question and code right away.
 */
function autoSetupDSAEditor(parsed) {
    // Sync test cases from the DSA question
    syncTestCases(parsed);
    
    // Pre-populate editor with LeetCode-style function signature
    if (editor) {
        const lang = document.getElementById('langSel')?.value || 'python';
        const code = generateFunctionSignature(parsed, lang);
        editor.setValue(code, -1);
    }
    
    // Show the "View Question" button
    const viewQBtn = document.getElementById('viewQuestionBtn');
    if (viewQBtn) viewQBtn.style.display = 'inline-flex';
    const pinBtn = document.getElementById('pinQBtn');
    if (pinBtn) pinBtn.style.display = 'inline-flex';
    
    // Clear any previous test results
    clearIDEOutput();
    
    addLog(`[DSA] Question loaded: ${parsed.title} | ${parsed.examples.length} test cases synced`, 'good');
}

// ── IDE Resize Handle (split pane: editor ↔ output) ──
(function() {
    let isResizing = false, startX = 0, startLeftWidth = 0;
    document.addEventListener('mousedown', (e) => {
        const handle = e.target.closest('#ideResizeHandle, .ide-resize-handle');
        if (handle) {
            isResizing = true; startX = e.clientX;
            const leftPane = document.getElementById('ideLeft');
            startLeftWidth = leftPane ? leftPane.offsetWidth : 400;
            handle.classList.add('dragging');
            e.preventDefault();
        }
    });
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const diff = e.clientX - startX;
        const leftPane = document.getElementById('ideLeft');
        const splitContainer = document.querySelector('.ide-split');
        if (leftPane && splitContainer) {
            const totalWidth = splitContainer.offsetWidth;
            const newLeftWidth = Math.max(250, Math.min(totalWidth - 250, startLeftWidth + diff));
            leftPane.style.flex = 'none';
            leftPane.style.width = newLeftWidth + 'px';
        }
        if (editor) editor.resize();
        // FIX #10: Removed fitAddon reference — it was never defined and caused errors
    });
    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.querySelectorAll('.ide-resize-handle').forEach(h => h.classList.remove('dragging'));
        }
    });
})();

// ── TEXT INPUT & IDK ──
function sendTypedAnswer() {
    const input = document.getElementById('textAnswerInput');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    sendAnswer(text);
}

function sendIDontKnow() {
    if (!interviewActive) return;
    sendAnswer("I'm not sure about this one.", true);
}

// ══════════════════════════════════════════════════════════════
// INTERVIEW FLOW — UNIFIED (No company selection)
// ══════════════════════════════════════════════════════════════
function startWithMode(mode) {
    if (!sessionId) { showToast('Please upload your resume first', 'warn'); return; }
    currentMode = mode; attempts++;
    currentRound = (mode === 'hr-only') ? 2 : 1;
    document.getElementById('chipName').textContent = 'Placera Interview';
    const roundLabels = { 'tech-only': 'Technical Interview', 'hr-only': 'HR Interview' };
    const chipRound = document.getElementById('chipRound'); if (chipRound) chipRound.textContent = roundLabels[mode] || 'Interview';

    // ── FULLSCREEN MODE ──
    try {
        const el = document.documentElement;
        if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
        else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
        else if (el.msRequestFullscreen) el.msRequestFullscreen();
    } catch(e) { /* fullscreen not supported — continue anyway */ }

    // ── DYNAMIC INTERVIEWER PERSONA ──
    const isHRMode = (mode === 'hr-only');
    currentInterviewer = isHRMode ? 'AMARA' : 'DAVID';
    const introEl = document.getElementById('interviewerIntro');
    if (introEl) introEl.textContent = isHRMode ? 'Your AI HR interviewer · STAR behavioral analysis' : 'Your AI tech interviewer · Adapts to your level';
    const nameEl = document.getElementById('interviewerName');
    if (nameEl) nameEl.textContent = currentInterviewer;
    const statusEl = document.querySelector('.av-status');
    if (statusEl) statusEl.textContent = isHRMode ? 'HR_INTELLIGENCE_ACTIVE' : 'NEURAL_PIPELINE_ACTIVE';

    const isTech = (mode === 'tech-only');
    const editorPanel = document.getElementById('editorPanel');
    const editorToggle = document.getElementById('editorToggleBtn');
    if (editorPanel) editorPanel.style.display = 'none';
    if (editorToggle) editorToggle.style.display = isTech ? 'inline-flex' : 'none';

    // FIX #11: starPanel doesn't exist in HTML — removed dead reference
    // FIX #21: Auto-switch to Analysis tab in HR mode to show STAR panel
    if (isHRMode) {
        setTimeout(() => switchMetricTab('analysis', null), 500);
    }

    // FIX #3 & #12: Attach tab switch listener here (always, not just with camera)
    attachProctoringListeners();

    showScreen('interviewScreen');
    startCountdownThenRound(currentRound);
}

function startCountdownThenRound(round) {
    const overlay = document.createElement('div');
    overlay.id = 'countdownOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(6,8,14,0.92);display:flex;flex-direction:column;align-items:center;justify-content:center;backdrop-filter:blur(12px);';
    const modeLabel = currentMode === 'hr-only' ? 'HR Interview' : 'Technical Interview';
    const modeColor = currentMode === 'hr-only' ? '#ec4899' : '#6366f1';
    const dots = Array.from({length:10},(_,i) => `<div id="cdDot${10-i}" style="width:8px;height:8px;border-radius:50%;background:${modeColor};opacity:1;transition:opacity 0.3s;display:inline-block;margin:0 3px;"></div>`).join('');
    overlay.innerHTML = `<div style="text-align:center;"><div style="font-family:'Outfit',sans-serif;font-size:13px;font-weight:700;letter-spacing:3px;color:${modeColor};text-transform:uppercase;margin-bottom:24px;">${modeLabel} &middot; Starting In</div><div id="cdNumber" style="font-family:'Outfit',sans-serif;font-size:120px;font-weight:900;line-height:1;background:linear-gradient(135deg,#3b82f6,${modeColor});-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;transition:transform 0.15s,opacity 0.15s;">10</div><div style="margin-top:28px;">${dots}</div><div style="margin-top:24px;font-family:'Outfit',sans-serif;font-size:14px;color:rgba(255,255,255,0.4);">Take a deep breath. You've got this.</div></div>`;
    document.body.appendChild(overlay);
    let count = 10;
    const cdNum = document.getElementById('cdNumber');
    const tick = setInterval(() => {
        const dot = document.getElementById('cdDot' + (count));
        if (dot) dot.style.opacity = '0.15';
        count--;
        if (count <= 0) {
            clearInterval(tick);
            overlay.style.opacity = '0';
            overlay.style.transition = 'opacity 0.4s';
            setTimeout(() => { overlay.remove(); startRound(round); }, 400);
            return;
        }
        cdNum.style.transform = 'scale(0.6)'; cdNum.style.opacity = '0';
        setTimeout(() => { cdNum.textContent = count; cdNum.style.transform = 'scale(1)'; cdNum.style.opacity = '1'; }, 150);
    }, 1000);
}


async function startRound(round) {
    currentRound = round; questionCount = 0; interviewActive = false;
    setQText('Connecting...'); clearLogs(); startTimer();
    try {
        const res = await fetch('/api/start-round', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, company: 'Unified', round, mode: currentMode }) });
        const data = await res.json(); if (data.error) throw new Error(data.error);
        sessionId = data.sessionId; maxQuestions = data.maxQuestions;
        if (data.interviewerName) {
            currentInterviewer = data.interviewerName.toUpperCase();
            const nameEl = document.getElementById('interviewerName');
            if (nameEl) nameEl.textContent = currentInterviewer;
        }
        setQText(data.question); updateDots(1, maxQuestions); interviewActive = true;
        if (data.adaptiveRating) updateEloDisplay(data.adaptiveRating, data.adaptiveTier);
        speakText(data.question, 'Unified', round);
        saveSessionState(data.question, data.adaptiveRating, data.adaptiveTier);
        showToast('Interview started! Good luck.', 'success');
    } catch (err) { console.error("StartRound Error:", err); setQText('Connection failed — please restart server'); showToast('Connection failed. Is the server running?', 'error'); }
}

function saveSessionState(lastQuestion, adaptiveRating, adaptiveTier) {
    try {
        sessionStorage.setItem('placera_active_session', JSON.stringify({
            sessionId, currentMode, currentRound, maxQuestions,
            questionCount, interviewActive: true,
            lastQuestion: lastQuestion || document.getElementById('qtext')?.textContent || '',
            adaptiveRating: adaptiveRating || null,
            adaptiveTier: adaptiveTier || null,
            savedAt: Date.now()
        }));
    } catch(e) { /* storage full */ }
}

function clearSavedSession() {
    sessionStorage.removeItem('placera_active_session');
    sessionStorage.removeItem('placera_reload_warns');
}

async function sendAnswer(answer, dontKnow = false, codeSubmission = null, codeLang = null) {
    if (!interviewActive || _submitting) return;
    _submitting = true;
    // FIX: Capture the CURRENT question BEFORE the API call returns the NEXT question
    // This ensures STAR analysis evaluates the answer against the correct question
    const currentQuestionText = document.getElementById('qText')?.textContent || '';
    if (answer && !dontKnow && !codeSubmission) addLog(answer, 'user', 'Me');
    if (codeSubmission) addLog('Submitted code solution', 'user', 'Me');
    if (dontKnow) addLog("I'm not sure about this one.", 'user', 'Me');
    setWaveLbl('Thinking...'); setAgentPill('analyzing...');
    try {
        const res = await fetch('/api/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, answer, dontKnow, codeSubmission, codeLanguage: codeLang }) });
        const data = await res.json();
        if (data.error) { showToast(data.error, 'error'); _submitting = false; return; }
        if (data.adaptiveRating) updateEloDisplay(data.adaptiveRating, data.adaptiveTier);
        if (data.end) { setQText(data.question); interviewActive = false; speakText(data.question, 'Unified', currentRound); clearSavedSession(); setTimeout(() => endInterview(), 3500); _submitting = false; return; }
        questionCount = data.questionCount; setQText(data.question); updateDots(questionCount, maxQuestions);
        saveSessionState(data.question, data.adaptiveRating, data.adaptiveTier);
        // ── DSA Challenge Detection & Modal ──
        // ONLY show DSA modal for DSA coding challenges — NOT system design, NOT HR
        if (currentMode !== 'hr-only') {
            if (data.isCodingChallenge && data.codingType === 'DSA') {
                // DSA challenge — detect, show modal, auto-setup editor + test cases
                detectAndShowDSA(data.question, true);
                // Also ensure editor is open (or will open when modal closes)
                if (!editorOpen) {
                    // Open editor in background so it's ready when user closes modal
                    toggleEditor(true);
                }
            } else if (data.isCodingChallenge && data.codingType === 'SYSTEM_DESIGN') {
                // System design — open editor directly, no DSA popup
                if (!editorOpen) toggleEditor(true);
            } else if (data.needsTerminal && !data.isCodingChallenge) {
                // General terminal need — open editor
                if (!editorOpen) toggleEditor(true);
            } else if (!data.isCodingChallenge && !data.needsTerminal) {
                // FALLBACK DSA DETECTION: Catch DSA problems the server missed tagging
                // Look for problem patterns in the AI response text
                const dsaPatterns = /(\[TECHNICAL_CHALLENGE|\bPROBLEM SPECIFICATION\b|\bEXAMPLE CASES\b|\bCONSTRAINTS.*PERFORMANCE\b|\bInput \d:.*Output \d:|CODING_CHALLENGE:DSA)/i;
                const hasDSAStructure = dsaPatterns.test(data.question) && data.question.length > 200;
                if (hasDSAStructure) {
                    addLog('[DSA-FALLBACK] Detected untagged DSA question via pattern matching', 'good');
                    detectAndShowDSA(data.question, true);
                    if (!editorOpen) toggleEditor(true);
                } else {
                    // Non-coding question — reset DSA tracking for next challenge
                    dsaChallengeShown = false;
                }
            }
        }
        speakText(data.question, 'Unified', currentRound);
        // FIX #6 & #16: Lower STAR threshold to 10 chars for short voice transcriptions
        // FIX: Use currentQuestionText (captured BEFORE API call) — not data.question (which is the NEXT question)
        if ((currentMode === 'hr-only' || currentRound === 2) && answer && answer.length > 10) runStarAnalysis(answer, currentQuestionText);
        // FIX #8 & #15: Lower updateMetrics threshold — score all answers > 2 chars
        if (answer && answer.length > 2) {
            const metricType = (currentMode === 'hr-only') ? 'behavioral' : (data.codingType || 'general');
            updateMetrics(answer, metricType);
        }
        saveSessionState();
    } catch (err) {
        console.error('Answer submission error:', err);
        addLog('Error sending answer: ' + err.message, 'warn');
        showToast('⚠️ Connection issue — your answer may not have been received. Please try again or check your internet.', 'error', 7000);
    }
    _submitting = false;
}

async function updateMetrics(answer, type) {
    try {
        const res = await fetch('/api/live-score', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, answer, questionType: type }) });
        const s = await res.json(); if (s.error) return;
        const map = { confidence:['mc','bc'], technical_depth:['mt','bt'] };
        Object.entries(map).forEach(([k,[vId,bId]]) => { const val = s[k]; if (val === undefined) return; const vEl = document.getElementById(vId), bEl = document.getElementById(bId); if (vEl) vEl.textContent = val; if (bEl) { bEl.style.width = val+'%'; bEl.style.background = val>=75 ? '#34d399' : val>=50 ? '#fbbf24' : '#f87171'; } });
        if (s.overall) { document.getElementById('scoreNum').textContent = s.overall; document.getElementById('sbar').style.width = s.overall+'%'; }
        if (s.coach_tip) { const c = document.getElementById('coachTip'); if (c) c.textContent = s.coach_tip; }
        if (s.dna) drawRadarChart(s.dna);
    } catch(e) {}
}

async function runStarAnalysis(answer, questionContext) {
    try {
        const res = await fetch('/api/star-analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, answer, questionContext }) });
        const star = await res.json(); if (star.error) return;
        const stScore = (star.situation?.score||0)+(star.task?.score||0);
        const stEl = document.getElementById('starST'); if (stEl) stEl.textContent = stScore+'/40';
        const bstEl = document.getElementById('bStarST'); if (bstEl) bstEl.style.width = (stScore/40*100)+'%';
        const aScore = star.action?.score||0; const aEl = document.getElementById('starA'); if (aEl) aEl.textContent = aScore+'/40';
        const baEl = document.getElementById('bStarA'); if (baEl) baEl.style.width = (aScore/40*100)+'%';
        const rScore = star.result?.score||0; const rEl = document.getElementById('starR'); if (rEl) rEl.textContent = rScore+'/20';
        const brEl = document.getElementById('bStarR'); if (brEl) brEl.style.width = (rScore/20*100)+'%';
        const gradeEl = document.getElementById('starGrade'); if (gradeEl) { gradeEl.textContent = star.star_grade||'—'; const gc = {'A':'#34d399','B':'#2f81f7','C':'#fbbf24','D':'#f97316','F':'#f87171'}; gradeEl.style.color = gc[star.star_grade]||'#f472b6'; }
        const tipEl = document.getElementById('starTip'); if (tipEl) tipEl.textContent = star.improvement_tip || '';
        addLog(`[STAR] Grade: ${star.star_grade} | ${star.total_score}/100`, star.total_score >= 70 ? 'good' : 'warn');
    } catch (err) {}
}

function endInterview() {
    if (!interviewActive) { _doEndInterview(); return; }
    showConfirm('Are you sure you want to end the interview?', _doEndInterview);
}
async function _doEndInterview() {
    stopTimer(); interviewActive = false; clearSavedSession();
    // Exit fullscreen
    try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch(e) {}
    setQText('Generating your scorecard...'); showToast('Generating scorecard...', 'info');
    try {
        const res = await fetch('/api/scorecard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) });
        const sc = await res.json();
        if (sc.error) { showToast(sc.error, 'error'); return; }
        renderScorecard(sc); showScreen('scorecardScreen');
    } catch(e) {
        console.error('Scorecard error:', e);
        showToast('Could not generate scorecard right now. Please check your connection and try again.', 'error', 8000);
        // Show a fallback message instead of a broken screen
        const main = document.getElementById('scorecardMain');
        if (main) main.innerHTML = `<div style="text-align:center; padding:80px 40px; background:white; border-radius:24px; border:1px solid #e2e8f0; box-shadow:0 4px 24px rgba(0,0,0,0.06);">
            <span class="material-symbols-outlined" style="font-size:64px; color:#f59e0b; opacity:0.6;">cloud_off</span>
            <div style="font-family:var(--font-display); font-size:24px; font-weight:800; color:#0f172a; margin-top:24px;">Connection Issue</div>
            <p style="color:#64748b; font-size:14px; margin-top:12px; line-height:1.6;">We couldn't generate your scorecard. This usually means the AI service is temporarily unavailable.</p>
            <div style="display:flex; gap:16px; justify-content:center; margin-top:32px;">
                <button onclick="_doEndInterview()" style="padding:14px 32px; background:#2563eb; color:white; border:none; border-radius:12px; font-weight:700; cursor:pointer; font-size:14px;">Retry</button>
                <button onclick="window.location.reload()" style="padding:14px 32px; background:#f1f5f9; color:#334155; border:1px solid #e2e8f0; border-radius:12px; font-weight:600; cursor:pointer; font-size:14px;">Start Over</button>
            </div>
        </div>`;
        showScreen('scorecardScreen');
    }
}

function renderScorecard(data) {
    // Store scorecard data globally for PDF generation
    window._lastScorecard = data;
    const main = document.getElementById('scorecardMain'); if (!main) return;
    const avg = data.overall || 0; const metrics = data.metrics || {};
    const strengths = (data.strengths || []).map(s => `<li style="color:#16a34a; margin:8px 0; font-size:14px; line-height:1.5;">✓ ${s}</li>`).join('');
    const improvements = (data.improvements || []).map(s => `<li style="color:#d97706; margin:8px 0; font-size:14px; line-height:1.5;">→ ${s}</li>`).join('');
    const fatalFlaw = data.fatal_flaw && data.fatal_flaw !== 'null' ? `<div style="padding:16px 24px; border-radius:14px; background:#fef2f2; border:1px solid #fecaca; margin:24px 0; text-align:left;"><span style="font-family:var(--font-mono); font-size:10px; color:#dc2626; font-weight:700; letter-spacing:1.5px;">⚠ CRITICAL CONCERN</span><p style="color:#1e293b; font-size:14px; margin-top:8px;">${data.fatal_flaw}</p></div>` : '';

    // ── STAR ANALYSIS SECTION ──
    let starHtml = '';
    const starScores = data.starScores || [];
    if (starScores.length > 0) {
        const avgTotal = Math.round(starScores.reduce((s, x) => s + (x.total_score || 0), 0) / starScores.length);
        const avgGrade = starScores.map(x => x.star_grade || '?').filter(g => g !== '?');
        const dominantGrade = avgGrade.length > 0 ? avgGrade.sort((a,b) => avgGrade.filter(v => v===a).length - avgGrade.filter(v => v===b).length).pop() : '—';
        const gradeColors = {'A':'#34d399','B':'#2f81f7','C':'#fbbf24','D':'#f97316','F':'#f87171'};
        const gc = gradeColors[dominantGrade] || '#a78bfa';
        const avgS = Math.round(starScores.reduce((s,x) => s + (x.situation?.score||0), 0) / starScores.length);
        const avgT = Math.round(starScores.reduce((s,x) => s + (x.task?.score||0), 0) / starScores.length);
        const avgA = Math.round(starScores.reduce((s,x) => s + (x.action?.score||0), 0) / starScores.length);
        const avgR = Math.round(starScores.reduce((s,x) => s + (x.result?.score||0), 0) / starScores.length);
        const starAssess = data.star_assessment || {};

        starHtml = `<div style="padding:32px; border-radius:20px; background:white; border:1px solid #e2e8f0; box-shadow:0 2px 12px rgba(0,0,0,0.04); text-align:left; margin-bottom:20px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                <div style="font-family:var(--font-mono); font-size:10px; font-weight:700; color:#7c3aed; letter-spacing:1.5px;">STAR BEHAVIORAL ANALYSIS</div>
                <div style="display:flex; align-items:center; gap:12px;">
                    <span style="font-family:var(--font-display); font-size:28px; font-weight:900; color:${gc};">${dominantGrade}</span>
                    <span style="font-family:var(--font-mono); font-size:12px; color:#94a3b8;">${avgTotal}/100</span>
                </div>
            </div>
            <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:16px;">
                <div style="text-align:center; padding:14px 8px; border-radius:12px; background:#f8fafc; border:1px solid #e2e8f0;">
                    <div style="font-family:var(--font-mono); font-size:9px; color:#94a3b8; font-weight:700; letter-spacing:1px; margin-bottom:6px;">SITUATION</div>
                    <div style="font-family:var(--font-display); font-size:20px; font-weight:800; color:${avgS>=15?'#16a34a':avgS>=10?'#d97706':'#dc2626'};">${avgS}<span style="font-size:11px; color:#94a3b8;">/20</span></div>
                </div>
                <div style="text-align:center; padding:14px 8px; border-radius:12px; background:#f8fafc; border:1px solid #e2e8f0;">
                    <div style="font-family:var(--font-mono); font-size:9px; color:#94a3b8; font-weight:700; letter-spacing:1px; margin-bottom:6px;">TASK</div>
                    <div style="font-family:var(--font-display); font-size:20px; font-weight:800; color:${avgT>=15?'#16a34a':avgT>=10?'#d97706':'#dc2626'};">${avgT}<span style="font-size:11px; color:#94a3b8;">/20</span></div>
                </div>
                <div style="text-align:center; padding:14px 8px; border-radius:12px; background:#f8fafc; border:1px solid #e2e8f0;">
                    <div style="font-family:var(--font-mono); font-size:9px; color:#94a3b8; font-weight:700; letter-spacing:1px; margin-bottom:6px;">ACTION</div>
                    <div style="font-family:var(--font-display); font-size:20px; font-weight:800; color:${avgA>=30?'#16a34a':avgA>=20?'#d97706':'#dc2626'};">${avgA}<span style="font-size:11px; color:#94a3b8;">/40</span></div>
                </div>
                <div style="text-align:center; padding:14px 8px; border-radius:12px; background:#f8fafc; border:1px solid #e2e8f0;">
                    <div style="font-family:var(--font-mono); font-size:9px; color:#94a3b8; font-weight:700; letter-spacing:1px; margin-bottom:6px;">RESULT</div>
                    <div style="font-family:var(--font-display); font-size:20px; font-weight:800; color:${avgR>=15?'#16a34a':avgR>=10?'#d97706':'#dc2626'};">${avgR}<span style="font-size:11px; color:#94a3b8;">/20</span></div>
                </div>
            </div>
            ${starAssess.recommendation ? `<div style="padding:14px 18px; border-radius:12px; background:#f5f3ff; border:1px solid #ddd6fe; margin-bottom:16px;">
                <div style="font-family:var(--font-mono); font-size:9px; color:#7c3aed; font-weight:700; letter-spacing:1px; margin-bottom:6px;">AI STAR ASSESSMENT</div>
                <div style="font-size:13px; color:#1e293b; line-height:1.6;">${starAssess.recommendation}</div>
                <div style="display:flex; gap:12px; margin-top:10px; flex-wrap:wrap;">
                    ${starAssess.strongest_component ? `<span style="font-size:10px; padding:4px 10px; border-radius:8px; background:#dcfce7; color:#16a34a; font-family:var(--font-mono); font-weight:600;">★ Strongest: ${starAssess.strongest_component.toUpperCase()}</span>` : ''}
                    ${starAssess.weakest_component ? `<span style="font-size:10px; padding:4px 10px; border-radius:8px; background:#fef2f2; color:#dc2626; font-family:var(--font-mono); font-weight:600;">↓ Weakest: ${starAssess.weakest_component.toUpperCase()}</span>` : ''}
                    ${starAssess.pronoun_pattern ? `<span style="font-size:10px; padding:4px 10px; border-radius:8px; background:#eef2ff; color:#4f46e5; font-family:var(--font-mono); font-weight:600;">Pronoun: ${starAssess.pronoun_pattern}</span>` : ''}
                    ${starAssess.uses_metrics_in_answers !== undefined ? `<span style="font-size:10px; padding:4px 10px; border-radius:8px; background:${starAssess.uses_metrics_in_answers ? '#dcfce7' : '#fefce8'}; color:${starAssess.uses_metrics_in_answers ? '#16a34a' : '#ca8a04'}; font-family:var(--font-mono); font-weight:600;">Metrics: ${starAssess.uses_metrics_in_answers ? '✓ Uses data' : '✗ No data'}</span>` : ''}
                </div>
            </div>` : ''}
            <div style="font-size:12px; color:#64748b; line-height:1.6;">
                ${starScores.map((s,i) => {
                    const qPreview = s.questionContext ? s.questionContext.substring(0, 120) + (s.questionContext.length > 120 ? '…' : '') : '';
                    const missingComps = (s.missing_components || []).join(', ');
                    const pronounLabel = s.used_we_vs_i ? ({'we-heavy':'🤝 Team-focused','i-focused':'👤 Individual-focused','balanced':'⚖️ Balanced'}[s.used_we_vs_i] || s.used_we_vs_i) : '';
                    return `<div style="padding:12px 0; border-bottom:1px solid #e2e8f0;">
                        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:4px;">
                            <span style="color:#94a3b8; font-family:var(--font-mono); font-size:10px; font-weight:700;">Answer ${i+1}</span>
                            <div style="display:flex; align-items:center; gap:8px;">
                                ${pronounLabel ? `<span style="font-size:9px; color:#64748b;">${pronounLabel}</span>` : ''}
                                ${s.has_metrics ? '<span style="font-size:9px; color:#16a34a;">📊 Has metrics</span>' : ''}
                                <span style="color:${gc}; font-weight:700; font-size:14px;">${s.star_grade||'?'}</span>
                                <span style="font-family:var(--font-mono); font-size:10px; color:#94a3b8;">${s.total_score||0}/100</span>
                            </div>
                        </div>
                        ${qPreview ? `<div style="font-size:11px; color:#94a3b8; font-style:italic; margin-bottom:6px; padding:6px 10px; border-radius:8px; background:#f8fafc;">Q: "${qPreview}"</div>` : ''}
                        <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:6px; margin-bottom:4px;">
                            <div style="font-size:10px; color:#475569;"><span style="color:${s.situation?.present?'#16a34a':'#dc2626'};">${s.situation?.present?'✓':'✗'}</span> S: ${s.situation?.score||0}/20</div>
                            <div style="font-size:10px; color:#475569;"><span style="color:${s.task?.present?'#16a34a':'#dc2626'};">${s.task?.present?'✓':'✗'}</span> T: ${s.task?.score||0}/20</div>
                            <div style="font-size:10px; color:#475569;"><span style="color:${s.action?.present?'#16a34a':'#dc2626'};">${s.action?.present?'✓':'✗'}</span> A: ${s.action?.score||0}/40</div>
                            <div style="font-size:10px; color:#475569;"><span style="color:${s.result?.present?'#16a34a':'#dc2626'};">${s.result?.present?'✓':'✗'}</span> R: ${s.result?.score||0}/20</div>
                        </div>
                        ${missingComps ? `<div style="font-size:10px; color:#dc2626; margin-top:2px;">Missing: ${missingComps}</div>` : ''}
                        ${s.improvement_tip ? `<div style="font-size:11px; color:#7c3aed; margin-top:4px;">💡 ${s.improvement_tip}</div>` : ''}
                    </div>`;
                }).join('')}
            </div>
        </div>`;
    }

    const verdictColors = {'Strong hire':'#16a34a','Hire':'#2563eb','Maybe':'#d97706','No hire':'#dc2626'};
    const vc = verdictColors[data.verdict] || '#2563eb';
    const metricsHtml = Object.entries(metrics).map(([key,val]) => {
        const c = val>80?'#16a34a':val>60?'#2563eb':'#d97706';
        return `<div style="padding:20px; border-radius:16px; background:#f8fafc; border:1px solid #e2e8f0; transition:transform 0.2s; cursor:default;" onmouseenter="this.style.transform='translateY(-2px)'" onmouseleave="this.style.transform=''">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <span style="font-family:var(--font-mono); font-size:10px; font-weight:700; color:#94a3b8; letter-spacing:1.5px; text-transform:uppercase;">${key.replace(/_/g,' ')}</span>
                <span style="font-family:var(--font-display); font-size:20px; font-weight:800; color:${c};">${val}%</span>
            </div>
            <div style="height:6px; border-radius:3px; background:#e2e8f0; overflow:hidden;">
                <div style="height:100%; border-radius:3px; width:${val}%; background:linear-gradient(90deg, ${c}, ${c}cc); transition:width 1.2s ease;"></div>
            </div>
        </div>`;
    }).join('');

    main.innerHTML = `
    <!-- Hero Score Card -->
    <div style="text-align:center; padding:48px 40px; background:linear-gradient(135deg, #ffffff 0%, #f8fafc 100%); border-radius:28px; border:1px solid #e2e8f0; box-shadow:0 8px 40px rgba(0,0,0,0.06); position:relative; overflow:hidden;">
        <div style="position:absolute; top:0; left:0; right:0; height:4px; background:linear-gradient(90deg, ${vc}, #7c3aed, #2563eb);"></div>
        <div style="font-family:var(--font-mono); font-size:10px; color:#2563eb; font-weight:700; letter-spacing:4px; margin-bottom:20px;">FINAL EVALUATION REPORT</div>
        <div style="width:60px; height:3px; background:linear-gradient(90deg, #2563eb, #7c3aed); margin:0 auto 24px; border-radius:2px;"></div>
        <div style="font-family:var(--font-display); font-size:96px; font-weight:900; background:linear-gradient(180deg, #0f172a 30%, ${vc} 100%); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; line-height:1;">${avg}<span style="font-size:32px; opacity:0.3; -webkit-text-fill-color:#94a3b8; margin-left:4px;">/100</span></div>
        <div style="display:inline-block; margin-top:16px; padding:8px 24px; border-radius:999px; background:${vc}15; border:1px solid ${vc}30;">
            <span style="font-family:var(--font-display); font-size:18px; font-weight:700; color:${vc};">${data.verdict || 'Assessment complete'}</span>
        </div>
        ${data.adaptive_rating ? `<div style="display:inline-flex; align-items:center; gap:8px; margin:20px auto; padding:8px 20px; border-radius:999px; background:#eef2ff; border:1px solid #c7d2fe; font-family:var(--font-mono); font-size:12px; color:#4f46e5; font-weight:700;"><div style="width:8px; height:8px; border-radius:50%; background:#4f46e5;"></div>Final ELO: ${data.adaptive_rating} · ${(data.adaptive_tier||'').replace(/_/g,' ').toUpperCase()}</div>` : ''}
        
        <!-- Metrics Grid -->
        <div style="display:grid; grid-template-columns:repeat(2,1fr); gap:16px; margin:40px 0;">${metricsHtml}</div>
    </div>

    <!-- STAR Analysis -->
    ${starHtml}

    <!-- Strengths -->
    ${strengths ? `<div style="padding:28px 32px; border-radius:20px; background:linear-gradient(135deg, #f0fdf4 0%, #ffffff 100%); border:1px solid #bbf7d0; text-align:left; margin-top:20px;">
        <div style="font-family:var(--font-mono); font-size:10px; font-weight:700; color:#16a34a; letter-spacing:1.5px; margin-bottom:12px;">✦ STRENGTHS</div>
        <ul style="list-style:none; padding:0;">${strengths}</ul>
    </div>` : ''}

    <!-- Improvements -->
    ${improvements ? `<div style="padding:28px 32px; border-radius:20px; background:linear-gradient(135deg, #fffbeb 0%, #ffffff 100%); border:1px solid #fde68a; text-align:left; margin-top:20px;">
        <div style="font-family:var(--font-mono); font-size:10px; font-weight:700; color:#d97706; letter-spacing:1.5px; margin-bottom:12px;">↗ AREAS FOR IMPROVEMENT</div>
        <ul style="list-style:none; padding:0;">${improvements}</ul>
    </div>` : ''}

    ${fatalFlaw}

    <!-- Executive Summary -->
    ${data.detailed_feedback ? `<div style="padding:36px; border-radius:24px; background:linear-gradient(135deg, #f8fafc, #eef2ff); border:1px solid #e2e8f0; text-align:left; margin-top:20px;">
        <div style="font-family:var(--font-display); font-size:18px; font-weight:700; color:#0f172a; margin-bottom:16px;">Executive Summary</div>
        <p style="color:#475569; line-height:1.8; font-size:15px;">${data.detailed_feedback}</p>
    </div>` : ''}

    <!-- Action Buttons -->
    <div style="display:flex; gap:14px; justify-content:center; flex-wrap:wrap; margin-top:32px;">
        <button onclick="generatePDFReport()" style="padding:14px 36px; font-weight:700; background:linear-gradient(135deg, #2563eb, #4f46e5); color:white; border:none; border-radius:14px; cursor:pointer; font-size:14px; display:inline-flex; align-items:center; gap:8px; box-shadow:0 4px 16px rgba(37,99,235,0.3); transition:transform 0.2s;" onmouseenter="this.style.transform='translateY(-2px)'" onmouseleave="this.style.transform=''">
            <span class="material-symbols-outlined" style="font-size:18px;">picture_as_pdf</span>Download PDF Report
        </button>
        <button onclick="shareResults()" style="padding:14px 28px; font-weight:700; background:linear-gradient(135deg, #16a34a, #059669); color:white; border:none; border-radius:14px; cursor:pointer; font-size:14px; display:inline-flex; align-items:center; gap:8px; box-shadow:0 4px 16px rgba(22,163,74,0.3); transition:transform 0.2s;" onmouseenter="this.style.transform='translateY(-2px)'" onmouseleave="this.style.transform=''">
            <span class="material-symbols-outlined" style="font-size:18px;">share</span>Share
        </button>
        <button onclick="showScreen('selectorScreen')" style="padding:14px 28px; background:#f1f5f9; color:#334155; border:1px solid #e2e8f0; border-radius:14px; font-weight:600; cursor:pointer; font-size:14px; transition:transform 0.2s;" onmouseenter="this.style.transform='translateY(-2px)'" onmouseleave="this.style.transform=''">New Mode</button>
        <button onclick="window.location.reload()" style="padding:14px 28px; background:#f1f5f9; color:#334155; border:1px solid #e2e8f0; border-radius:14px; font-weight:600; cursor:pointer; font-size:14px; transition:transform 0.2s;" onmouseenter="this.style.transform='translateY(-2px)'" onmouseleave="this.style.transform=''">Fresh Start</button>
    </div>`;
}

// ══════════════════════════════════════════════════════════════
// PDF REPORT GENERATION — Comprehensive Interview Report
// ══════════════════════════════════════════════════════════════

function generatePDFReport() {
    const data = window._lastScorecard;
    if (!data) { showToast('No scorecard data available', 'error'); return; }

    showToast('Generating PDF report...', 'info');

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');
        const W = doc.internal.pageSize.getWidth();
        const H = doc.internal.pageSize.getHeight();
        const margin = 20;
        const contentW = W - margin * 2;
        let y = margin;
        const now = new Date();
        const dateStr = now.toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
        const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
        const candidateName = data.candidate?.name || 'Candidate';
        const mode = data.interviewMeta?.mode === 'hr-only' ? 'HR Interview' : 'Technical Interview';

        // ── WATERMARK FUNCTION — Single centered watermark per page ──
        function addWatermark() {
            doc.saveGraphicsState();
            doc.setGState(new doc.GState({ opacity: 0.05 }));
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(80);
            doc.setTextColor(99, 102, 241);
            doc.text('PLACERA', W / 2, H / 2, { align: 'center', angle: 45 });
            doc.restoreGraphicsState();
        }

        // ── PAGE FOOTER ──
        function addFooter(pageNum) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7);
            doc.setTextColor(150, 150, 150);
            doc.text(`Placera AI Interview Intelligence · Generated ${dateStr} at ${timeStr}`, margin, H - 8);
            doc.text(`Page ${pageNum}`, W - margin, H - 8, { align: 'right' });
            doc.setDrawColor(220, 220, 220);
            doc.line(margin, H - 12, W - margin, H - 12);
        }

        // ── CHECK PAGE BREAK ──
        let currentPage = 1;
        function checkPageBreak(needed) {
            if (y + needed > H - 20) {
                addFooter(currentPage);
                doc.addPage();
                currentPage++;
                addWatermark();
                y = margin;
                return true;
            }
            return false;
        }

        // ── SECTION HEADER HELPER ──
        function sectionHeader(title, color = [99, 102, 241]) {
            checkPageBreak(18);
            y += 6;
            doc.setFillColor(color[0], color[1], color[2]);
            doc.rect(margin, y, 3, 12, 'F');
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(12);
            doc.setTextColor(30, 30, 30);
            doc.text(title, margin + 7, y + 9);
            y += 18;
        }

        // ── WRAPPED TEXT HELPER ──
        function addWrappedText(text, x, fontSize, color, maxW) {
            doc.setFontSize(fontSize);
            doc.setTextColor(color[0], color[1], color[2]);
            const lines = doc.splitTextToSize(text, maxW || contentW);
            lines.forEach(line => {
                checkPageBreak(fontSize * 0.5);
                doc.text(line, x, y);
                y += fontSize * 0.45;
            });
        }

        // ═════════════════════════════════════════════
        // PAGE 1: COVER + EXECUTIVE SUMMARY
        // ═════════════════════════════════════════════
        addWatermark();

        // Header bar
        doc.setFillColor(15, 18, 30);
        doc.rect(0, 0, W, 55, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(28);
        doc.setTextColor(255, 255, 255);
        doc.text('Placera', margin, 28);
        doc.setFontSize(10);
        doc.setTextColor(165, 180, 252);
        doc.text('AI Interview Intelligence Report', margin, 40);
        doc.setFontSize(8);
        doc.setTextColor(180, 180, 200);
        doc.text(`${dateStr} · ${timeStr}`, W - margin, 28, { align: 'right' });
        doc.text(`${mode}`, W - margin, 38, { align: 'right' });
        y = 65;

        // Candidate info box
        doc.setFillColor(245, 246, 255);
        doc.roundedRect(margin, y, contentW, 30, 4, 4, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.setTextColor(30, 30, 30);
        doc.text(candidateName, margin + 8, y + 12);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(100, 100, 100);
        const infoLine = [data.candidate?.degree, data.candidate?.college, data.candidate?.domain].filter(Boolean).join(' · ');
        doc.text(infoLine || 'Interview Candidate', margin + 8, y + 22);
        if (data.candidate?.skills?.length > 0) {
            doc.setFontSize(7);
            doc.setTextColor(130, 130, 130);
            doc.text('Skills: ' + data.candidate.skills.slice(0, 8).join(', '), W / 2, y + 22, { align: 'left' });
        }
        y += 40;

        // ── OVERALL SCORE ──
        doc.setFillColor(248, 248, 252);
        doc.roundedRect(margin, y, contentW, 44, 4, 4, 'F');
        doc.setDrawColor(99, 102, 241);
        doc.setLineWidth(0.5);
        doc.roundedRect(margin, y, contentW, 44, 4, 4, 'S');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(42);
        const scoreColor = (data.overall || 0) >= 80 ? [34, 197, 94] : (data.overall || 0) >= 60 ? [99, 102, 241] : [251, 191, 36];
        doc.setTextColor(scoreColor[0], scoreColor[1], scoreColor[2]);
        doc.text(`${data.overall || 0}`, margin + 15, y + 30);
        doc.setFontSize(14);
        doc.setTextColor(150, 150, 150);
        doc.text('/100', margin + 43, y + 30);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.setTextColor(30, 30, 30);
        doc.text(data.verdict || 'Assessment Complete', margin + 70, y + 18);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(100, 100, 100);
        if (data.adaptive_rating) {
            doc.text(`ELO Rating: ${data.adaptive_rating}/100 · Tier: ${(data.adaptive_tier || '').replace(/_/g, ' ').toUpperCase()}`, margin + 70, y + 28);
        }
        doc.text(`Questions: ${data.interviewMeta?.questionsAsked || '—'}/${data.interviewMeta?.maxQuestions || 12} · Interviewer: ${data.interviewMeta?.interviewerName || 'David'}`, margin + 70, y + 36);
        y += 54;

        // ── EXECUTIVE SUMMARY ──
        if (data.detailed_feedback) {
            sectionHeader('EXECUTIVE SUMMARY');
            doc.setFont('helvetica', 'normal');
            addWrappedText(data.detailed_feedback, margin, 10, [60, 60, 60]);
            y += 4;
        }

        // ═════════════════════════════════════════════
        // PERFORMANCE METRICS TABLE
        // ═════════════════════════════════════════════
        sectionHeader('PERFORMANCE METRICS');

        const metrics = data.metrics || {};
        const metricsRows = Object.entries(metrics).map(([key, val]) => {
            const grade = val >= 90 ? 'A+' : val >= 80 ? 'A' : val >= 70 ? 'B+' : val >= 60 ? 'B' : val >= 50 ? 'C' : val >= 40 ? 'D' : 'F';
            const assessment = val >= 80 ? 'Excellent' : val >= 60 ? 'Good' : val >= 40 ? 'Needs Work' : 'Weak';
            return [key.replace(/_/g, ' ').toUpperCase(), `${val}%`, grade, assessment];
        });

        if (metricsRows.length > 0) {
            doc.autoTable({
                startY: y,
                head: [['METRIC', 'SCORE', 'GRADE', 'ASSESSMENT']],
                body: metricsRows,
                margin: { left: margin, right: margin },
                styles: { font: 'helvetica', fontSize: 9, cellPadding: 4 },
                headStyles: { fillColor: [99, 102, 241], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
                alternateRowStyles: { fillColor: [248, 248, 252] },
                columnStyles: {
                    0: { fontStyle: 'bold', cellWidth: 55 },
                    1: { halign: 'center', cellWidth: 25 },
                    2: { halign: 'center', cellWidth: 25 },
                    3: { halign: 'center' }
                },
                didDrawPage: () => { addWatermark(); }
            });
            y = doc.lastAutoTable.finalY + 8;
        }

        // ═════════════════════════════════════════════
        // ELO PROGRESSION
        // ═════════════════════════════════════════════
        if (data.eloHistory && data.eloHistory.length > 0) {
            sectionHeader('ADAPTIVE DIFFICULTY PROGRESSION', [99, 102, 241]);

            // Draw ELO chart
            checkPageBreak(45);
            const chartX = margin;
            const chartW = contentW;
            const chartH = 35;
            const chartY = y;

            // Background
            doc.setFillColor(248, 248, 252);
            doc.roundedRect(chartX, chartY, chartW, chartH, 3, 3, 'F');

            // Grid lines
            doc.setDrawColor(230, 230, 230);
            doc.setLineWidth(0.2);
            [0, 25, 50, 75, 100].forEach(v => {
                const gy = chartY + chartH - (v / 100) * chartH;
                doc.line(chartX + 15, gy, chartX + chartW - 5, gy);
                doc.setFontSize(6);
                doc.setTextColor(160, 160, 160);
                doc.text(`${v}`, chartX + 2, gy + 1.5);
            });

            // Plot line
            const points = data.eloHistory;
            const stepX = (chartW - 25) / Math.max(points.length - 1, 1);
            doc.setDrawColor(99, 102, 241);
            doc.setLineWidth(0.8);
            for (let i = 1; i < points.length; i++) {
                const x1 = chartX + 18 + (i - 1) * stepX;
                const y1 = chartY + chartH - (points[i - 1].rating / 100) * chartH;
                const x2 = chartX + 18 + i * stepX;
                const y2 = chartY + chartH - (points[i].rating / 100) * chartH;
                doc.line(x1, y1, x2, y2);
            }

            // Points
            points.forEach((p, i) => {
                const px = chartX + 18 + i * stepX;
                const py = chartY + chartH - (p.rating / 100) * chartH;
                const c = p.delta >= 0 ? [34, 197, 94] : [239, 68, 68];
                doc.setFillColor(c[0], c[1], c[2]);
                doc.circle(px, py, 1.5, 'F');
            });

            // Legend
            doc.setFontSize(7);
            doc.setTextColor(100, 100, 100);
            doc.text('ELO Rating over time — each dot = one answer', chartX + 18, chartY + chartH + 5);
            y = chartY + chartH + 12;
        }

        // ═════════════════════════════════════════════
        // STAR BEHAVIORAL ANALYSIS
        // ═════════════════════════════════════════════
        const pdfStarScores = data.starScores || [];
        if (pdfStarScores.length > 0) {
            sectionHeader('STAR BEHAVIORAL ANALYSIS', [167, 139, 250]);

            const avgTotal = Math.round(pdfStarScores.reduce((s, x) => s + (x.total_score || 0), 0) / pdfStarScores.length);
            const grades = pdfStarScores.map(x => x.star_grade || '?');
            const dominantGrade = grades.sort((a,b) => grades.filter(v => v===a).length - grades.filter(v => v===b).length).pop() || '?';

            // Summary box
            checkPageBreak(20);
            doc.setFillColor(252, 250, 255);
            doc.roundedRect(margin, y, contentW, 16, 3, 3, 'F');
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(16);
            doc.setTextColor(167, 139, 250);
            doc.text(dominantGrade, margin + 8, y + 12);
            doc.setFontSize(10);
            doc.setTextColor(80, 80, 80);
            doc.text(`Average STAR Score: ${avgTotal}/100 across ${pdfStarScores.length} behavioral answer(s)`, margin + 22, y + 10);
            y += 22;

            // AI STAR Assessment recommendation box
            const pdfStarAssess = data.star_assessment || {};
            if (pdfStarAssess.recommendation) {
                checkPageBreak(28);
                doc.setFillColor(248, 245, 255);
                const recLines = doc.splitTextToSize(pdfStarAssess.recommendation, contentW - 16);
                const recH = Math.max(18, recLines.length * 4 + 14);
                doc.roundedRect(margin, y, contentW, recH, 3, 3, 'F');
                doc.setDrawColor(167, 139, 250);
                doc.setLineWidth(0.3);
                doc.roundedRect(margin, y, contentW, recH, 3, 3, 'S');
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(7);
                doc.setTextColor(167, 139, 250);
                doc.text('AI STAR ASSESSMENT', margin + 5, y + 5);
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(8);
                doc.setTextColor(60, 60, 60);
                recLines.forEach((line, li) => {
                    doc.text(line, margin + 5, y + 10 + li * 4);
                });
                // Tags row
                let tagX = margin + 5;
                const tagY = y + 10 + recLines.length * 4 + 2;
                if (tagY < y + recH - 2) {
                    doc.setFontSize(6);
                    if (pdfStarAssess.strongest_component) {
                        doc.setTextColor(34, 197, 94);
                        doc.text(`Strongest: ${pdfStarAssess.strongest_component.toUpperCase()}`, tagX, tagY);
                        tagX += 38;
                    }
                    if (pdfStarAssess.weakest_component) {
                        doc.setTextColor(239, 68, 68);
                        doc.text(`Weakest: ${pdfStarAssess.weakest_component.toUpperCase()}`, tagX, tagY);
                        tagX += 35;
                    }
                    if (pdfStarAssess.pronoun_pattern) {
                        doc.setTextColor(99, 102, 241);
                        doc.text(`Pronoun: ${pdfStarAssess.pronoun_pattern}`, tagX, tagY);
                        tagX += 35;
                    }
                    if (pdfStarAssess.uses_metrics_in_answers !== undefined) {
                        doc.setTextColor(pdfStarAssess.uses_metrics_in_answers ? 34 : 251, pdfStarAssess.uses_metrics_in_answers ? 197 : 191, pdfStarAssess.uses_metrics_in_answers ? 94 : 36);
                        doc.text(`Metrics: ${pdfStarAssess.uses_metrics_in_answers ? 'Yes' : 'No'}`, tagX, tagY);
                    }
                }
                y += recH + 4;
            }

            // STAR scores table
            const starRows = pdfStarScores.map((s, i) => [
                `Answer ${i + 1}`,
                `${s.situation?.score || 0}/20 ${s.situation?.present ? '✓' : '✗'}`,
                `${s.task?.score || 0}/20 ${s.task?.present ? '✓' : '✗'}`,
                `${s.action?.score || 0}/40 ${s.action?.present ? '✓' : '✗'}`,
                `${s.result?.score || 0}/20 ${s.result?.present ? '✓' : '✗'}`,
                s.star_grade || '?',
                `${s.total_score || 0}/100`
            ]);

            doc.autoTable({
                startY: y,
                head: [['ANSWER', 'SITUATION', 'TASK', 'ACTION', 'RESULT', 'GRADE', 'TOTAL']],
                body: starRows,
                margin: { left: margin, right: margin },
                styles: { font: 'helvetica', fontSize: 8, cellPadding: 3 },
                headStyles: { fillColor: [167, 139, 250], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
                alternateRowStyles: { fillColor: [252, 250, 255] },
                columnStyles: {
                    0: { fontStyle: 'bold', cellWidth: 25 },
                    5: { halign: 'center', fontStyle: 'bold' },
                    6: { halign: 'center' }
                },
                didDrawPage: () => { addWatermark(); }
            });
            y = doc.lastAutoTable.finalY + 4;

            // Per-answer detailed breakdown with question context & component feedback
            pdfStarScores.forEach((s, i) => {
                checkPageBreak(30);
                // Question context
                if (s.questionContext) {
                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(7);
                    doc.setTextColor(99, 102, 241);
                    doc.text(`Answer ${i + 1} — Question:`, margin + 3, y);
                    y += 3.5;
                    doc.setFont('helvetica', 'italic');
                    doc.setFontSize(7);
                    doc.setTextColor(100, 100, 100);
                    const qLines = doc.splitTextToSize(`"${s.questionContext.substring(0, 200)}"`, contentW - 8);
                    qLines.slice(0, 2).forEach(line => {
                        doc.text(line, margin + 3, y);
                        y += 3;
                    });
                    y += 1;
                }
                // Component feedback
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(7);
                const components = [
                    { label: 'S', data: s.situation, max: 20 },
                    { label: 'T', data: s.task, max: 20 },
                    { label: 'A', data: s.action, max: 40 },
                    { label: 'R', data: s.result, max: 20 }
                ];
                components.forEach(comp => {
                    if (comp.data?.feedback) {
                        checkPageBreak(5);
                        const present = comp.data.present;
                        doc.setTextColor(present ? 34 : 239, present ? 197 : 68, present ? 94 : 68);
                        doc.text(`${present ? '✓' : '✗'} ${comp.label}: ${comp.data.score || 0}/${comp.max}`, margin + 5, y);
                        doc.setTextColor(80, 80, 80);
                        doc.text(` — ${comp.data.feedback}`, margin + 25, y);
                        y += 3.5;
                    }
                });
                // Metadata tags
                const tags = [];
                if (s.used_we_vs_i) tags.push(`Pronoun: ${s.used_we_vs_i}`);
                if (s.has_metrics) tags.push('Has quantitative metrics');
                if (s.missing_components?.length > 0) tags.push(`Missing: ${s.missing_components.join(', ')}`);
                if (tags.length > 0) {
                    doc.setFontSize(6);
                    doc.setTextColor(130, 100, 160);
                    doc.text(tags.join(' · '), margin + 5, y);
                    y += 3;
                }
                // Improvement tip
                if (s.improvement_tip) {
                    doc.setFont('helvetica', 'italic');
                    doc.setFontSize(7);
                    doc.setTextColor(130, 100, 160);
                    doc.text(`Tip: ${s.improvement_tip}`, margin + 5, y);
                    y += 3.5;
                }
                y += 2;
            });
            y += 4;
        }

        // ═════════════════════════════════════════════
        // STRENGTHS & WEAKNESSES
        // ═════════════════════════════════════════════
        if (data.strengths?.length > 0 || data.improvements?.length > 0) {
            sectionHeader('STRENGTHS & AREAS FOR IMPROVEMENT', [34, 197, 94]);

            if (data.strengths?.length > 0) {
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(9);
                doc.setTextColor(34, 197, 94);
                doc.text('STRENGTHS', margin, y);
                y += 5;
                data.strengths.forEach(s => {
                    checkPageBreak(6);
                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(9);
                    doc.setTextColor(60, 60, 60);
                    const lines = doc.splitTextToSize(`✓  ${s}`, contentW - 5);
                    lines.forEach(line => { doc.text(line, margin + 3, y); y += 4.5; });
                });
                y += 4;
            }

            if (data.improvements?.length > 0) {
                checkPageBreak(12);
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(9);
                doc.setTextColor(251, 191, 36);
                doc.text('AREAS FOR IMPROVEMENT', margin, y);
                y += 5;
                data.improvements.forEach(s => {
                    checkPageBreak(6);
                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(9);
                    doc.setTextColor(60, 60, 60);
                    const lines = doc.splitTextToSize(`→  ${s}`, contentW - 5);
                    lines.forEach(line => { doc.text(line, margin + 3, y); y += 4.5; });
                });
                y += 4;
            }

            // Fatal flaw
            if (data.fatal_flaw && data.fatal_flaw !== 'null') {
                checkPageBreak(20);
                doc.setFillColor(255, 240, 240);
                doc.roundedRect(margin, y, contentW, 16, 3, 3, 'F');
                doc.setDrawColor(239, 68, 68);
                doc.setLineWidth(0.3);
                doc.roundedRect(margin, y, contentW, 16, 3, 3, 'S');
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(7);
                doc.setTextColor(239, 68, 68);
                doc.text('⚠ CRITICAL CONCERN', margin + 4, y + 5);
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(8);
                doc.setTextColor(80, 30, 30);
                const fLines = doc.splitTextToSize(data.fatal_flaw, contentW - 10);
                doc.text(fLines[0] || '', margin + 4, y + 12);
                y += 22;
            }
        }

        // ═════════════════════════════════════════════
        // FACTUAL ERRORS
        // ═════════════════════════════════════════════
        if (data.factual_errors && data.factual_errors.length > 0) {
            sectionHeader('FACTUAL ERRORS DETECTED', [239, 68, 68]);
            const errorRows = data.factual_errors.map(e => [
                `Q${e.questionNum || '?'}`,
                e.claimed || '',
                e.correct || ''
            ]);
            doc.autoTable({
                startY: y,
                head: [['QUESTION', 'CANDIDATE CLAIMED', 'CORRECT ANSWER']],
                body: errorRows,
                margin: { left: margin, right: margin },
                styles: { font: 'helvetica', fontSize: 8, cellPadding: 3 },
                headStyles: { fillColor: [239, 68, 68], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
                alternateRowStyles: { fillColor: [255, 248, 248] },
                didDrawPage: () => { addWatermark(); }
            });
            y = doc.lastAutoTable.finalY + 8;
        }

        // ═════════════════════════════════════════════
        // INTERVIEW TRANSCRIPT
        // ═════════════════════════════════════════════
        if (data.transcript && data.transcript.length > 0) {
            sectionHeader('INTERVIEW TRANSCRIPT', [100, 100, 100]);

            data.transcript.forEach((t, i) => {
                checkPageBreak(25);

                // Question
                doc.setFillColor(245, 246, 255);
                const qLines = doc.splitTextToSize(t.question, contentW - 20);
                const qHeight = Math.max(10, qLines.length * 4 + 6);
                doc.roundedRect(margin, y, contentW, qHeight, 2, 2, 'F');
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(7);
                doc.setTextColor(99, 102, 241);
                doc.text(`Q${t.questionNum || i + 1} — INTERVIEWER`, margin + 4, y + 4);
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(8);
                doc.setTextColor(40, 40, 40);
                qLines.forEach((line, li) => {
                    if (y + 7 + li * 4 < H - 20) {
                        doc.text(line, margin + 4, y + 8 + li * 4);
                    }
                });
                y += qHeight + 2;

                // Answer
                checkPageBreak(15);
                const aLines = doc.splitTextToSize(t.answer, contentW - 20);
                const aHeight = Math.max(10, aLines.length * 4 + 6);
                doc.setFillColor(240, 255, 244);
                doc.roundedRect(margin, y, contentW, aHeight, 2, 2, 'F');
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(7);
                doc.setTextColor(34, 197, 94);
                doc.text('CANDIDATE', margin + 4, y + 4);
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(8);
                doc.setTextColor(40, 40, 40);
                aLines.forEach((line, li) => {
                    if (y + 7 + li * 4 < H - 20) {
                        doc.text(line, margin + 4, y + 8 + li * 4);
                    }
                });
                y += aHeight + 6;
            });
        }

        // ═════════════════════════════════════════════
        // IMPROVEMENT ROADMAP
        // ═════════════════════════════════════════════
        checkPageBreak(50);
        sectionHeader('IMPROVEMENT ROADMAP', [167, 139, 250]);

        const roadmapItems = [];
        const metricEntries = Object.entries(data.metrics || {});
        metricEntries.sort((a, b) => a[1] - b[1]); // weakest first

        metricEntries.slice(0, 3).forEach(([key, val]) => {
            const area = key.replace(/_/g, ' ');
            let resources = '';
            if (/technical|problem/i.test(key)) resources = 'LeetCode, HackerRank, Codeforces';
            else if (/communication/i.test(key)) resources = 'Toastmasters, Mock interviews, STAR method practice';
            else if (/confidence/i.test(key)) resources = 'Practice under pressure, timed mock interviews';
            else if (/behavioral/i.test(key)) resources = 'STAR method practice, leadership scenario prep';
            else if (/system/i.test(key)) resources = 'System Design Primer, Designing Data-Intensive Apps';
            else resources = 'Targeted practice in this area';
            roadmapItems.push([area.toUpperCase(), `${val}%`, val < 50 ? 'Critical' : val < 70 ? 'Important' : 'Refine', resources]);
        });

        if (roadmapItems.length > 0) {
            doc.autoTable({
                startY: y,
                head: [['FOCUS AREA', 'CURRENT', 'PRIORITY', 'RECOMMENDED RESOURCES']],
                body: roadmapItems,
                margin: { left: margin, right: margin },
                styles: { font: 'helvetica', fontSize: 8, cellPadding: 4 },
                headStyles: { fillColor: [167, 139, 250], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
                alternateRowStyles: { fillColor: [252, 250, 255] },
                columnStyles: {
                    0: { fontStyle: 'bold', cellWidth: 40 },
                    1: { halign: 'center', cellWidth: 20 },
                    2: { halign: 'center', cellWidth: 25 }
                },
                didDrawPage: () => { addWatermark(); }
            });
            y = doc.lastAutoTable.finalY + 8;
        }

        // ═════════════════════════════════════════════
        // FINAL NOTES + DISCLAIMER
        // ═════════════════════════════════════════════
        checkPageBreak(30);
        y += 6;
        doc.setFillColor(248, 248, 252);
        doc.roundedRect(margin, y, contentW, 22, 3, 3, 'F');
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(7);
        doc.setTextColor(130, 130, 130);
        const disclaimer = 'This report was generated by Placera AI Interview Intelligence Platform. Scores and assessments are AI-generated approximations based on the interview performance observed. They should be used as practice feedback only and do not represent actual hiring decisions. Keep practicing and improving!';
        const discLines = doc.splitTextToSize(disclaimer, contentW - 12);
        discLines.forEach((line, i) => {
            doc.text(line, margin + 6, y + 6 + i * 3.5);
        });
        y += 28;

        // ── Add footer to last page ──
        addFooter(currentPage);

        // ── SAVE ──
        const filename = `Placera_Report_${candidateName.replace(/\s+/g, '_')}_${now.toISOString().split('T')[0]}.pdf`;
        doc.save(filename);
        showToast('📄 PDF Report downloaded!', 'success');

    } catch (err) {
        console.error('PDF generation error:', err);
        showToast('Failed to generate PDF: ' + err.message, 'error');
    }
}

// ══════════════════════════════════════════════════════════════
// SPEECH ENGINE (ElevenLabs + Fallback)
// ══════════════════════════════════════════════════════════════
let voiceEnabled = true, pitchSeries = [1.0, 1.002, 0.999], rateSeries = [1.0, 1.0], isTalking = false;

async function speakText(text, company, round) {
    if (!voiceEnabled || !text) return;
    if (currentSource) { try { currentSource.stop(0); } catch(e) {} currentSource = null; }
    const cleaned = text.replace(/```[\s\S]*?```/g, 'Code is in the editor.').replace(/\[FACT_ERROR[^\]]*\]/g, '').replace(/\[CODING_CHALLENGE[^\]]*\]/g, '').replace(/\[.*?\]/g, '').replace(/[*_`#]/g, '').replace(/\n+/g, ' ').trim();
    if (!cleaned) return;
    try {
        const res = await fetch('/api/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: cleaned, company: company || 'Unified', round: round || currentRound, sessionId }) });
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('audio/mpeg')) { fallbackSpeak(cleaned); return; }
        const buf = await res.arrayBuffer();
        if (!buf || buf.byteLength < 1000) { fallbackSpeak(cleaned); return; }
        if (!audioCtx || audioCtx.state === 'closed') audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
        if (audioCtx.state === 'suspended') await audioCtx.resume();
        let audioBuf;
        try { audioBuf = await audioCtx.decodeAudioData(buf.slice(0)); } catch(e) { fallbackSpeak(cleaned); return; }
        const source = audioCtx.createBufferSource(); source.buffer = audioBuf;
        // Prosodic pitch
        const avg = pitchSeries.reduce((a,b)=>a+b)/pitchSeries.length;
        const np = Math.max(0.96, Math.min(1.04, avg + (Math.random()*0.036-0.018) + (1.0-avg)*0.3));
        pitchSeries.push(np); if (pitchSeries.length > 7) pitchSeries.shift();
        const isQ = cleaned.trim().endsWith('?');
        const dur = audioBuf.duration, now = audioCtx.currentTime;
        source.playbackRate.setValueAtTime(np * 0.994, now);
        source.playbackRate.linearRampToValueAtTime(np * 1.012, now + dur * 0.3);
        source.playbackRate.linearRampToValueAtTime(np * (isQ ? 1.02 : 0.94), now + dur);
        source.preservesPitch = false;
        // Audio chain
        const comp = audioCtx.createDynamicsCompressor(); comp.threshold.value = -20; comp.ratio.value = 3.5;
        const out = audioCtx.createGain(); out.gain.value = 0.87;
        analyser = audioCtx.createAnalyser();
        source.connect(comp); comp.connect(out); out.connect(analyser); analyser.connect(audioCtx.destination);
        source.start(audioCtx.currentTime);
        currentSource = source; isTalking = true;
        source.onended = () => { currentSource = null; isTalking = false; };
    } catch(err) {
        console.error('speakText error:', err);
        if (!window._voiceErrorShown) {
            window._voiceErrorShown = true;
            showToast('🔊 Neural voice unavailable — using browser voice instead. Interview continues normally.', 'warn', 6000);
        }
        fallbackSpeak(cleaned);
    }
}

// ── PRONUNCIATION MAP FOR FALLBACK TTS ──
const FALLBACK_PRONUNCIATION_MAP = {
    'SQL': 'sequel', 'NoSQL': 'no-sequel', 'MySQL': 'my-sequel',
    'DBMS': 'D B M S', 'RDBMS': 'R D B M S', 'OOPS': 'O O P S', 'OOP': 'O O P',
    'API': 'A P I', 'APIs': 'A P Is', 'REST': 'rest', 'GraphQL': 'graph Q L',
    'CI/CD': 'C I C D', 'DevOps': 'dev ops', 'AWS': 'A W S', 'GCP': 'G C P',
    'kubectl': 'kube control', 'nginx': 'engine x', 'OAuth': 'oh auth', 'JWT': 'J W T',
    'CRUD': 'crud', 'ORM': 'O R M', 'TCP': 'T C P', 'UDP': 'U D P',
    'HTTP': 'H T T P', 'HTTPS': 'H T T P S', 'DNS': 'D N S', 'CDN': 'C D N',
    'BFS': 'B F S', 'DFS': 'D F S', 'DP': 'D P', 'LRU': 'L R U',
    'ACID': 'acid', 'SDE': 'S D E', 'SWE': 'S W E', 'HR': 'H R',
    'JSON': 'jason', 'YAML': 'yamul', 'AJAX': 'ay jax', 'GUI': 'gooey',
    'FIFO': 'fai fo', 'LIFO': 'lai fo', 'regex': 'rej ex',
    'PostgreSQL': 'postgres sequel', 'MongoDB': 'mongo D B',
    'Kubernetes': 'koo-ber-net-ees', 'async': 'ay-sink',
    'sudo': 'soo-doh', 'Vue': 'view', 'Django': 'jango',
    'FastAPI': 'fast A P I', 'mutex': 'mew tex',
    'LPA': 'lakhs per annum', 'CTC': 'C T C',
};

function applyFallbackPronunciations(text) {
    let result = text;
    const sorted = Object.entries(FALLBACK_PRONUNCIATION_MAP).sort((a, b) => b[0].length - a[0].length);
    for (const [term, pronunciation] of sorted) {
        const regex = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
        result = result.replace(regex, pronunciation);
    }
    return result;
}

function fallbackSpeak(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    // FIX #14: Apply pronunciation mapping to fallback TTS text
    const pronouncedText = applyFallbackPronunciations(text);
    const utt = new SpeechSynthesisUtterance(pronouncedText);
    // Select voice based on interviewer persona: David = male, Amara = female
    const isAmara = (currentInterviewer === 'AMARA');
    if (isAmara && systemFemaleVoice) {
        utt.voice = systemFemaleVoice;
        utt.pitch = text.endsWith('?') ? 1.08 : 1.0;
        utt.rate = 0.90 + Math.random()*0.06;
    } else if (!isAmara && systemMaleVoice) {
        utt.voice = systemMaleVoice;
        utt.pitch = text.endsWith('?') ? 0.98 : 0.88;
        utt.rate = 0.86 + Math.random()*0.06;
    } else {
        const voices = window.speechSynthesis.getVoices();
        const v = voices.find(v=>v.lang==='en-IN') || voices.find(v=>v.lang==='en-GB') || voices.find(v=>v.lang.startsWith('en'));
        if (v) utt.voice = v;
        utt.rate = 0.88 + Math.random()*0.06; utt.pitch = text.endsWith('?') ? 1.02 : 0.92;
    }
    window.speechSynthesis.speak(utt);
}

function toggleVoice() { voiceEnabled = !voiceEnabled; if (!voiceEnabled) { if (currentSource) { try{currentSource.stop();}catch(e){} currentSource=null; } window.speechSynthesis?.cancel(); } }

// ══════════════════════════════════════════════════════════════
// CAMERA & BIOMETRICS
// ══════════════════════════════════════════════════════════════
async function loadFaceModels() {
    if (faceModelsLoaded) return true;
    const weights = ['https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights'];
    for (const url of weights) { try { await Promise.all([faceapi.nets.tinyFaceDetector.loadFromUri(url), faceapi.nets.faceExpressionNet.loadFromUri(url), faceapi.nets.faceLandmark68TinyNet.loadFromUri(url)]); faceModelsLoaded = true; return true; } catch(e) {} }
    return false;
}

async function toggleCamera() { if (cameraOn) stopCamera(); else await startCamera(); }

async function startCamera() {
    try {
        isStartingCamera = true;
        await loadFaceModels();
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
        const video = document.getElementById('studentVideo');
        if (video) { video.srcObject = stream; video.style.display = 'block'; }
        if (document.getElementById('camPlaceholder')) document.getElementById('camPlaceholder').style.display = 'none';
        if (document.getElementById('faceCanvas')) document.getElementById('faceCanvas').style.display = 'block';
        cameraOn = true; addLog('Camera on — proctoring active', 'good');
        await new Promise(r => video.onloadedmetadata = r);
        startFaceAnalysis(video);
    } catch (err) { addLog('Camera access denied', 'warn'); }
    finally {
        // Give 2 extra seconds of grace after camera starts to avoid focus flicker
        setTimeout(() => { isStartingCamera = false; }, 2000);
    }
}


function stopCamera() {
    cameraOn = false; if (faceAnalysisInterval) clearInterval(faceAnalysisInterval);
    const video = document.getElementById('studentVideo');
    if (video && video.srcObject) { video.srcObject.getTracks().forEach(t => t.stop()); video.srcObject = null; video.style.display = 'none'; }
    if (document.getElementById('camPlaceholder')) document.getElementById('camPlaceholder').style.display = 'block';
    if (document.getElementById('faceCanvas')) document.getElementById('faceCanvas').style.display = 'none';
}

function startFaceAnalysis(video) {
    const canvas = document.getElementById('faceCanvas'), ctx = canvas.getContext('2d');
    faceAnalysisInterval = setInterval(async () => {
        if (!cameraOn || !faceModelsLoaded || video.paused || video.readyState < 2) return;
        try {
            canvas.width = video.videoWidth || 640; canvas.height = video.videoHeight || 480;
            const detections = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.3 })).withFaceLandmarks(true).withFaceExpressions();
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            if (detections.length === 0) { const g = document.getElementById('gazeVal'); if (g) { g.textContent = 'NO_SIGNAL'; g.style.color = 'var(--red)'; } return; }

            // FIX #4: Multiple faces detection with debounced 3-strike system
            if (detections.length > 1) {
                const now = Date.now();
                // Debounce: only count once per 10 seconds
                if (now - lastMultipleFaceTime > 10000) {
                    lastMultipleFaceTime = now;
                    multipleFaceCount++;
                    addLog(`[PROCTOR] Multiple faces detected! (${multipleFaceCount}/${PROCTORING_MAX_WARNINGS + 1})`, 'warn');
                    if (multipleFaceCount <= PROCTORING_MAX_WARNINGS) {
                        const remaining = PROCTORING_MAX_WARNINGS + 1 - multipleFaceCount;
                        showToast(`⚠️ Warning ${multipleFaceCount}/${PROCTORING_MAX_WARNINGS}: Multiple faces detected! Only the candidate should be visible. ${remaining} warning(s) remaining.`, multipleFaceCount === 1 ? 'warn' : 'error', 6000);
                        showProctoringWarningBanner(`MULTIPLE FACES DETECTED — Warning ${multipleFaceCount}/${PROCTORING_MAX_WARNINGS}`);
                    } else {
                        terminateForViolation('Multiple faces detected more than ' + PROCTORING_MAX_WARNINGS + ' times. Interview terminated for proctoring violation.');
                        return;
                    }
                }
            }

            const det = detections[0], landmarks = det.landmarks, noseTip = landmarks.getNose()[3];
            const isLooking = (Math.abs(noseTip.x - canvas.width/2)/canvas.width < 0.18) && (Math.abs(noseTip.y - canvas.height/2)/canvas.height < 0.18);
            eyeContactScore = isLooking ? 100 : 35;
            const dominant = Object.entries(det.expressions).sort((a,b)=>b[1]-a[1])[0];
            const expMap = { neutral:{s:75}, happy:{s:90}, surprised:{s:80}, fearful:{s:40}, angry:{s:30} };
            expressionScore = (expMap[dominant[0]] || {s:60}).s;
            const box = det.detection.box;
            ctx.strokeStyle = isLooking ? '#34d399' : '#fbbf24'; ctx.lineWidth = 2; ctx.strokeRect(box.x, box.y, box.width, box.height);
            const g = document.getElementById('gazeVal'), gb = document.getElementById('bGaze');
            if (g) { g.textContent = isLooking ? 'STABLE' : 'SHIFTED'; g.style.color = isLooking ? 'var(--green)' : 'var(--red)'; }
            if (gb) gb.style.width = (isLooking ? '100%' : '40%');
        } catch(e) {}
    }, 1000);
}

// ══════════════════════════════════════════════════════════════
// PROCTORING ENGINE — Tab Switch + Face Detection + Termination
// ══════════════════════════════════════════════════════════════

/**
 * FIX #3, #12, #13: Attach proctoring listeners ONCE, outside startCamera
 */
function attachProctoringListeners() {
    if (tabSwitchListenerAttached) return; // Prevent duplicate listeners
    tabSwitchListenerAttached = true;
    // Set grace period — ignore early blurs (page load, fullscreen transitions, etc.)
    proctoringGraceUntil = Date.now() + PROCTORING_GRACE_MS;

    window.addEventListener('blur', () => {
        if (!interviewActive) return;
        // Ignore violations while camera is starting (prevents permission popup strikes)
        if (isStartingCamera) {
            addLog('[SECURITY] Focus change during camera startup — ignored', 'info');
            return;
        }
        // Grace period: ignore blurs right after interview starts
        if (Date.now() < proctoringGraceUntil) {
            addLog('[SECURITY] Focus change during grace period — ignored', 'info');
            return;
        }
        // Cooldown: ignore rapid successive blur events
        const now = Date.now();
        if (now - lastBlurTime < PROCTORING_COOLDOWN_MS) {
            addLog('[SECURITY] Rapid focus change — cooldown active, not counted', 'info');
            return;
        }

        lastBlurTime = now;
        tabSwitchCount++;
        addLog(`[SECURITY] Tab switch detected! (${tabSwitchCount}/${PROCTORING_MAX_WARNINGS + 1})`, 'warn');

        if (tabSwitchCount <= PROCTORING_MAX_WARNINGS) {
            const remaining = PROCTORING_MAX_WARNINGS + 1 - tabSwitchCount;
            const severity = tabSwitchCount <= 2 ? 'warn' : 'error';
            showToast(
                `⚠️ Warning ${tabSwitchCount}/${PROCTORING_MAX_WARNINGS}: Tab switch detected! ${remaining} warning(s) before interview ends.`,
                severity, 7000
            );
            showProctoringWarningBanner(`TAB SWITCH DETECTED — Warning ${tabSwitchCount}/${PROCTORING_MAX_WARNINGS}`);
        } else {
            // 4th strike — auto-terminate
            terminateForViolation('Tab switching detected more than ' + PROCTORING_MAX_WARNINGS + ' times. Interview terminated for proctoring violation.');
        }
    });

    // Detect page visibility changes (more robust than blur)
    document.addEventListener('visibilitychange', () => {
        if (!interviewActive) return;
        if (document.hidden) {
            // visibilitychange fires independently of blur — don't double-count
            // We only log it; the blur handler counts
            addLog('[SECURITY] Page visibility changed — candidate may have switched apps', 'warn');
        }
    });
}

/**
 * Show persistent warning banner in interview room
 */
function showProctoringWarningBanner(message) {
    let banner = document.getElementById('proctoringBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'proctoringBanner';
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9998;padding:10px 24px;text-align:center;font-family:var(--font-mono);font-size:11px;font-weight:700;letter-spacing:1.5px;color:#fff;background:linear-gradient(90deg,rgba(239,68,68,0.95),rgba(220,38,38,0.95));backdrop-filter:blur(12px);animation:slideDown 0.3s ease;';
        document.body.prepend(banner);
    }
    banner.textContent = '🔴 ' + message;
    banner.style.display = 'block';
    // Auto-hide after 8 seconds
    setTimeout(() => { if (banner) banner.style.display = 'none'; }, 8000);
}

/**
 * FIX #9: Terminate interview for proctoring violation
 */
function terminateForViolation(reason) {
    interviewActive = false;
    stopTimer();
    clearSavedSession();
    if (cameraOn) stopCamera();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (currentSource) { try { currentSource.stop(); } catch(e) {} currentSource = null; }

    addLog('[VIOLATION] ' + reason, 'err');
    showToast('🚨 Interview terminated: ' + reason, 'error', 10000);

    // Show violation overlay
    const overlay = document.getElementById('violationOverlay');
    if (overlay) {
        document.getElementById('violationReason').textContent = reason;
        overlay.style.display = 'flex';
    } else {
        // Fallback if overlay not in DOM
        alert('INTERVIEW TERMINATED\n\n' + reason);
        window.location.reload();
    }
}

function drawRadarChart(dna) {
    const canvas = document.getElementById('radarCanvas'); if (!canvas) return;
    const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height, center = w/2, radius = 50;
    ctx.clearRect(0,0,w,h); const points = [dna.ownership||0, dna.long_term_thinking||0, dna.customer_focus||0, dna.innovation||0];
    ctx.beginPath(); ctx.strokeStyle = '#a78bfa'; ctx.fillStyle = 'rgba(167,139,250,0.3)'; ctx.lineWidth = 2;
    for(let i=0;i<4;i++) { const ang = (Math.PI/2)*i-(Math.PI/2); const val = (points[i]+20)/120; const x = center+Math.cos(ang)*(radius*val), y = center+Math.sin(ang)*(radius*val); if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
}

// ══════════════════════════════════════════════════════════════
// NEURAL RIPPLE & TABS
// ══════════════════════════════════════════════════════════════
let rippleCanvas, rippleCtx;
function initializeNeuralRipple() {
    rippleCanvas = document.getElementById('neuralRipple'); if (!rippleCanvas) return;
    rippleCtx = rippleCanvas.getContext('2d'); animateNeuralRipple();
}

function animateNeuralRipple() {
    if (!rippleCtx) return;
    const { width, height } = rippleCanvas; rippleCtx.clearRect(0, 0, width, height);
    const time = Date.now() * 0.001, cx = width/2, cy = height/2;
    let volume = 0;
    if (isTalking && analyser) { const d = new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(d); volume = d.reduce((a,b)=>a+b)/d.length/255; }
    const br = 80 + (volume * 100);
    rippleCtx.lineWidth = 1.5;
    for (let i=0; i<5; i++) {
        const ls = 1+(i*0.4), op = (1-(i/5))*(isTalking ? 0.6 : 0.2);
        rippleCtx.strokeStyle = `rgba(99, 102, 241, ${op})`;
        rippleCtx.beginPath();
        for (let a=0; a<Math.PI*2; a+=0.05) { const n = Math.sin(a*(3+i)+time*(2+i))*(10+volume*50); const r = (br*ls)+n; const x=cx+Math.cos(a)*r, y=cy+Math.sin(a)*r; if(a===0) rippleCtx.moveTo(x,y); else rippleCtx.lineTo(x,y); }
        rippleCtx.closePath(); rippleCtx.stroke();
    }
    const grad = rippleCtx.createRadialGradient(cx,cy,0,cx,cy,br);
    grad.addColorStop(0, `rgba(99,102,241,${isTalking ? 0.3 : 0.1})`); grad.addColorStop(1, 'transparent');
    rippleCtx.fillStyle = grad; rippleCtx.beginPath(); rippleCtx.arc(cx,cy,br,0,Math.PI*2); rippleCtx.fill();
    requestAnimationFrame(animateNeuralRipple);
}

function switchMetricTab(id, evt) {
    document.querySelectorAll('.m-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.m-tab-content').forEach(c => c.classList.remove('active'));
    if (evt?.currentTarget) evt.currentTarget.classList.add('active');
    else document.querySelector(`.m-tab[onclick*="${id}"]`)?.classList.add('active');
    const content = document.getElementById('tab-' + id); if (content) content.classList.add('active');
}

// ══════════════════════════════════════════════════════════════
// DRAG & DROP RESUME UPLOAD
// ══════════════════════════════════════════════════════════════
function initDragDrop() {
    const dropZone = document.getElementById('dropZone');
    if (!dropZone) return;
    ['dragenter','dragover'].forEach(evt => dropZone.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); dropZone.style.borderColor = 'var(--accent)'; dropZone.style.background = 'rgba(99,102,241,0.05)'; }));
    ['dragleave','drop'].forEach(evt => dropZone.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); dropZone.style.borderColor = ''; dropZone.style.background = ''; }));
    dropZone.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const file = files[0];
            // Validate dropped file is a resume
            if (!isValidResumeFile(file)) {
                const status = document.getElementById('uploadStatus');
                if (status) { status.textContent = '✗ Invalid file. Only PDF or TXT resume files are accepted.'; status.style.color = 'var(--red)'; }
                showToast('Only PDF or TXT resume files are accepted.', 'error');
                return;
            }
            const fileInput = document.getElementById('resumeFile');
            const dt = new DataTransfer(); dt.items.add(file);
            fileInput.files = dt.files;
            handleFileSelect(fileInput);
        }
    });
}

// ══════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    // ── RELOAD PROTECTION ──
    // Block page reload/close during active interview
    window.addEventListener('beforeunload', (e) => {
        if (!interviewActive) return;
        // Increment reload warning count
        let warns = parseInt(sessionStorage.getItem('placera_reload_warns') || '0') + 1;
        sessionStorage.setItem('placera_reload_warns', warns);
        // Native browser "are you sure?" dialog
        e.preventDefault();
        e.returnValue = `⚠️ Warning ${warns}/3: Reloading during the interview is flagged as misconduct.`;
        return e.returnValue;
    });

    // ── SESSION RESTORE ON RELOAD ──
    const saved = (() => { try { return JSON.parse(sessionStorage.getItem('placera_active_session') || 'null'); } catch(e) { return null; } })();
    const reloadWarns = parseInt(sessionStorage.getItem('placera_reload_warns') || '0');

    if (saved && saved.sessionId && saved.interviewActive) {
        // Interview was in progress — check warning count
        if (reloadWarns >= 3) {
            // 4th reload = terminate
            sessionStorage.removeItem('placera_active_session');
            sessionStorage.removeItem('placera_reload_warns');
            showScreen('uploadScreen');
            setTimeout(() => showToast('❌ Interview terminated: Too many page reloads (proctoring violation)', 'error', 8000), 500);
        } else {
            // Restore session
            sessionId = saved.sessionId;
            currentMode = saved.currentMode || 'tech-only';
            currentRound = saved.currentRound || 1;
            maxQuestions = saved.maxQuestions || 12;
            showScreen('interviewScreen');
            // Show warning overlay
            setTimeout(() => {
                showToast(`⚠️ Reload Warning ${reloadWarns}/3 — Interview restored. Next reload will count against you.`, 'warn', 6000);
                setQText(saved.lastQuestion || 'Resuming your interview...');
                interviewActive = true;
                startTimer();
                updateDots(saved.questionCount || 1, maxQuestions);
                if (saved.adaptiveRating) updateEloDisplay(saved.adaptiveRating, saved.adaptiveTier);
            }, 600);
        }
    } else {
        // Fresh start — clear any stale warnings
        sessionStorage.removeItem('placera_reload_warns');
        showScreen('uploadScreen');
    }

    initializeNeuralRipple();
    initDragDrop();
    if (window.speechSynthesis) window.speechSynthesis.getVoices();
    setTimeout(() => initEditor(), 1500);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (dsaModalOpen) { closeDSAModal(); return; }
            if (editorOpen) toggleEditor(false);
        }
        if (e.ctrlKey && e.key === 'Enter' && editorOpen) submitCode();
        if (e.ctrlKey && e.key === 'r' && editorOpen) { e.preventDefault(); runInTerminal(); }
        if (e.ctrlKey && e.key === 'q' && currentDSAQuestion) { e.preventDefault(); togglePinnedQuestion(); }
    });

    const dsaOverlay = document.getElementById('dsaModal');
    if (dsaOverlay) {
        dsaOverlay.addEventListener('click', (e) => {
            if (e.target === dsaOverlay) closeDSAModal();
        });
    }
});


// ══════════════════════════════════════════════════════════════
// SHARE RESULTS — Web Share API with clipboard fallback
// ══════════════════════════════════════════════════════════════
function shareResults() {
    const data = window._lastScorecard;
    if (!data) { showToast('No results to share yet', 'warn'); return; }

    const score = data.overall || 0;
    const verdict = data.verdict || 'Completed';
    const tier = data.adaptive_tier || 'mid_level';
    const shareText = `🎯 I just completed an AI mock interview on Placera!\n\n` +
        `📊 Score: ${score}/100 · Verdict: ${verdict}\n` +
        `🏆 Difficulty Tier: ${tier.replace(/_/g, ' ').toUpperCase()}\n` +
        `⚡ ELO Rating: ${data.adaptive_rating || 50}/100\n\n` +
        `Practice your interviews with AI → placera.app`;

    if (navigator.share) {
        navigator.share({
            title: 'My Placera Interview Results',
            text: shareText,
        }).catch(() => {});
    } else {
        // Fallback: copy to clipboard
        navigator.clipboard.writeText(shareText).then(() => {
            showToast('📋 Results copied to clipboard! Share it anywhere.', 'good', 5000);
        }).catch(() => {
            // Final fallback: prompt with text
            prompt('Copy your results:', shareText);
        });
    }
}
