// ══════════════════════════════════════════════════════════════
// PLACERA v3.1 — PRODUCTION-READY SERVER
// ══════════════════════════════════════════════════════════════
// Secured, rate-limited, memory-managed, graceful shutdown

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const os = require('os');

const express = require('express');
const axios = require('axios');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

// ── MODULAR IMPORTS ──
const { COMPANY_PROFILES, detectDomain, getDomainHRContext } = require('./config/companies');
const { AdaptiveDifficultyEngine } = require('./config/adaptive');
const {
  buildUnifiedFullAssessmentPrompt,
  buildTechOnlyPrompt,
  buildHROnlyPrompt,
  markQuestionUsed,
  usedQuestions
} = require('./prompts/unified');

// ── HELPERS ──
function sanitize(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/<[^>]*>?/gm, '').trim();
}

// ── ENV VALIDATION (warn, don't crash) ──
if (!process.env.ELEVENLABS_VOICE_ID) {
  console.warn("⚠️ WARNING: ELEVENLABS_VOICE_ID not set — voice will use fallback");
} else {
  console.log("✅ Voice ID confirmed:", process.env.ELEVENLABS_VOICE_ID);
}

const app = express();

// ── SECURITY MIDDLEWARE ──
app.use(cors()); // Allow everything
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Helmet disabled for maximum compatibility during launch



// ── RATE LIMITING ──
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment and try again.' },
});
app.use('/api/', apiLimiter);

// ── UPLOAD LIMITER (stricter) ──
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many uploads. Please wait.' },
});

// ── FILE SIZE LIMIT ──
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// ── GLOBAL ERROR HANDLERS — prevents server crash ──
process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Unhandled Rejection:', reason);
});

// ══════════════════════════════════════════════════════════════
// GROQ KEY ROTATION — auto-switches when limit is reached
// ══════════════════════════════════════════════════════════════
const GROQ_KEYS = [
  process.env.GROQ_API_KEY_1 || process.env.GROQ_API_KEY,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
  process.env.GROQ_API_KEY_4,
  process.env.GROQ_API_KEY_5,
].filter(Boolean);

if (GROQ_KEYS.length === 0) {
  console.error("❌ CRITICAL: No GROQ API keys found! Set GROQ_API_KEY_1 in environment variables.");
} else {
  console.log(`✅ Groq keys loaded: ${GROQ_KEYS.length} key(s) [${GROQ_KEYS.map((k,i) => `Key${i+1}:${k.substring(0,8)}...`).join(', ')}]`);
}
console.log(`🔧 ENV check: ELEVENLABS_API_KEY=${process.env.ELEVENLABS_API_KEY ? 'SET' : 'MISSING'}, ELEVENLABS_VOICE_ID=${process.env.ELEVENLABS_VOICE_ID ? 'SET' : 'MISSING'}, PORT=${process.env.PORT || '3000(default)'}`);

let currentKeyIndex = 0;

function getGroqClient() {
  return new Groq({ apiKey: GROQ_KEYS[currentKeyIndex] });
}

function rotateKey() {
  currentKeyIndex = (currentKeyIndex + 1) % GROQ_KEYS.length;
  console.log(`Rotated to Groq key ${currentKeyIndex + 1} of ${GROQ_KEYS.length}`);
}

async function groqChat(params, retries = 0) {
  try {
    const client = getGroqClient();
    return await client.chat.completions.create(params);
  } catch (err) {
    const isRateLimit = err.status === 429 || (err.message && err.message.includes('rate'));
    if (isRateLimit && GROQ_KEYS.length > 1 && retries < GROQ_KEYS.length - 1) {
      console.log(`Key ${currentKeyIndex + 1} rate limited — switching...`);
      rotateKey();
      return groqChat(params, retries + 1);
    }
    throw err;
  }
}

// ══════════════════════════════════════════════════════════════
// GEMINI INTEGRATION
// ══════════════════════════════════════════════════════════════
async function geminiChat(params) {
  try {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");
    
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // Use gemini-1.5-flash for speed/cost, or pro for reasoning
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const systemMsg = params.messages.find(m => m.role === 'system')?.content;
    let history = params.messages
      .filter(m => m.role !== 'system')
      .slice(0, -1)
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));
    
    // Gemini requires first message to be 'user'
    if (history.length > 0 && history[0].role === 'model') {
      history.unshift({ role: 'user', parts: [{ text: "Hello, I'm ready for the interview." }] });
    }
    
    const lastMsg = params.messages.filter(m => m.role !== 'system').pop()?.content || "";

    const chat = model.startChat({
      history,
      systemInstruction: systemMsg,
      generationConfig: {
        maxOutputTokens: params.max_tokens || 1000,
        temperature: params.temperature || 0.7,
      }
    });

    const result = await chat.sendMessage(lastMsg);
    const response = await result.response;
    return {
      choices: [{ message: { content: response.text() } }]
    };
  } catch (err) {
    console.error("Gemini Error:", err.message);
    throw err;
  }
}

// ── UNIFIED AI CHAT — Prioritizes Gemini, falls back to Groq ──
async function aiChat(params) {
  if (process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.startsWith('#')) {
    try {
      return await geminiChat(params);
    } catch (err) {
      console.warn("Gemini failed, falling back to Groq...");
    }
  }
  
  // Map Gemini-style temperature/params to Groq if needed
  const groqParams = { ...params };
  if (!groqParams.model) groqParams.model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  
  return await groqChat(groqParams);
}

app.use(express.json({ limit: '1mb' }));
// Force no-cache on JS/CSS so browser always loads latest code
app.use((req, res, next) => {
  if (req.url.endsWith('.js') || req.url.endsWith('.css')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
app.use(express.static('public'));

// ══════════════════════════════════════════════════════════════
// SESSION MANAGEMENT — with TTL cleanup
// ══════════════════════════════════════════════════════════════
const sessions = {};
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // every 10 minutes

function cleanupSessions() {
  const now = Date.now();
  let cleaned = 0;
  for (const id of Object.keys(sessions)) {
    if (now - (sessions[id].lastActivity || 0) > SESSION_TTL_MS) {
      delete sessions[id];
      if (usedQuestions[id]) delete usedQuestions[id];
      cleaned++;
    }
  }
  if (cleaned > 0) console.log(`[CLEANUP] Removed ${cleaned} expired sessions. Active: ${Object.keys(sessions).length}`);
}
setInterval(cleanupSessions, CLEANUP_INTERVAL_MS);

function touchSession(session) {
  session.lastActivity = Date.now();
}

// ── INPUT SANITIZER ──
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').substring(0, 5000);
}

// ══════════════════════════════════════════════════════════════
// CONVERSATION MEMORY ENGINE — makes AI remember everything
// ══════════════════════════════════════════════════════════════
function initSessionMemory(session) {
  if (!session.memory) {
    session.memory = {
      candidateClaims: [],
      techStrengths: [],
      techWeaknesses: [],
      keyMoments: [],
      emotionalState: 'neutral',
      energyLevel: 100,
      contradictions: [],
      followUpQueue: [],
      answerDepths: [],
      consecutiveWeakAnswers: 0,
      consecutiveStrongAnswers: 0,
      interviewMood: 'warm',
      totalWordsSpoken: 0,
      avgResponseLength: 0,
      responseCount: 0,
      answerTimestamps: [],
    };
  }
  return session.memory;
}

function extractClaims(answer) {
  const claims = [];
  const projectPatterns = [
    /(?:I|we|my team)\s+(?:built|created|developed|designed|implemented|worked on|made)\s+(.{10,80})/gi,
    /(?:my|our)\s+project\s+(?:was|is|called|about)\s+(.{10,60})/gi,
  ];
  projectPatterns.forEach(p => {
    const matches = answer.matchAll(p);
    for (const m of matches) claims.push({ type: 'project', text: m[1].trim(), raw: m[0] });
  });

  const techPatterns = [
    /(?:I|we)\s+(?:used|worked with|know|am familiar with|have experience in)\s+(.{5,60})/gi,
    /(?:proficient|experienced|skilled)\s+(?:in|with)\s+(.{5,40})/gi,
  ];
  techPatterns.forEach(p => {
    const matches = answer.matchAll(p);
    for (const m of matches) claims.push({ type: 'skill', text: m[1].trim(), raw: m[0] });
  });

  const expPatterns = [
    /(\d+)\s+(?:years?|months?)\s+(?:of\s+)?(?:experience|working)/gi,
    /(?:I\s+have|with)\s+(\d+)\s+(?:years?|months?)/gi,
  ];
  expPatterns.forEach(p => {
    const matches = answer.matchAll(p);
    for (const m of matches) claims.push({ type: 'experience', text: m[0].trim() });
  });

  return claims;
}

function updateMemory(session, answer, qualityResult) {
  const mem = initSessionMemory(session);
  const wordCount = (answer || '').split(/\s+/).length;
  mem.totalWordsSpoken += wordCount;
  mem.responseCount++;
  mem.avgResponseLength = Math.round(mem.totalWordsSpoken / mem.responseCount);
  mem.answerTimestamps.push(Date.now());

  const claims = extractClaims(answer || '');
  mem.candidateClaims.push(...claims);

  const quality = qualityResult?.quality || 'ok';
  if (quality === 'clear') {
    mem.consecutiveStrongAnswers++;
    mem.consecutiveWeakAnswers = 0;
    mem.answerDepths.push('moderate');
  } else if (quality === 'vague' || quality === 'unclear') {
    mem.consecutiveWeakAnswers++;
    mem.consecutiveStrongAnswers = 0;
    mem.answerDepths.push('surface');
  }

  // Emotional state detection
  if (wordCount < 10) mem.emotionalState = 'nervous';
  else if (wordCount > 150) mem.emotionalState = 'confident';
  else if (mem.consecutiveWeakAnswers >= 2) mem.emotionalState = 'struggling';
  else mem.emotionalState = 'relaxed';

  mem.energyLevel = Math.max(20, mem.energyLevel - 3);

  // ── UPDATE ADAPTIVE ENGINE ──
  if (session.adaptiveEngine) {
    const scoreMap = { 'clear': 75, 'vague': 40, 'unclear': 20, 'ok': 55, 'off_topic': 15 };
    const answerScore = scoreMap[quality] || 50;
    const lastTs = mem.answerTimestamps.length >= 2
      ? mem.answerTimestamps[mem.answerTimestamps.length - 1] - mem.answerTimestamps[mem.answerTimestamps.length - 2]
      : 15000;
    const questionType = session.codingPhase === 'DSA' ? 'dsa' :
                         session.codingPhase === 'SYSTEM_DESIGN' ? 'system_design' :
                         session.round === 2 ? 'behavioral' : 'general';

    session.adaptiveEngine.updateRating(answerScore, questionType, lastTs);
    console.log(`[ELO] Rating: ${Math.round(session.adaptiveEngine.rating)} | Tier: ${session.adaptiveEngine.getTier()} | Momentum: ${session.adaptiveEngine.momentum}`);
  }

  console.log(`[MEMORY] Emotional: ${mem.emotionalState}, Claims: ${mem.candidateClaims.length}, Avg words: ${mem.avgResponseLength}`);
}

function buildMemoryContext(session) {
  const mem = session.memory;
  if (!mem) return '';

  let ctx = '\n═══ LIVE INTERVIEW INTELLIGENCE ═══\n';
  ctx += `CANDIDATE STATE: ${mem.emotionalState} | Energy: ${mem.energyLevel}% | Avg response: ${mem.avgResponseLength} words\n`;

  if (session.adaptiveEngine) {
    ctx += `\nADAPTIVE DIFFICULTY RATING: ${Math.round(session.adaptiveEngine.rating)}/100 | TIER: ${session.adaptiveEngine.getTier().toUpperCase().replace(/_/g, ' ')}\n`;
    ctx += session.adaptiveEngine.getAIBehaviorInstructions() + '\n';
  }

  if (mem.candidateClaims.length > 0) {
    const recentClaims = mem.candidateClaims.slice(-5);
    ctx += `\nTHINGS CANDIDATE SAID (use for callbacks):\n`;
    recentClaims.forEach(c => { ctx += `- [${c.type}] "${c.text}"\n`; });
    ctx += `→ Weave these in: "You mentioned earlier that..." or "Going back to what you said about..."\n`;
  }

  if (mem.contradictions.length > 0) {
    ctx += `\nCONTRADICTIONS DETECTED — probe these:\n`;
    mem.contradictions.forEach(c => ctx += `- ${c}\n`);
  }

  if (mem.followUpQueue.length > 0) {
    ctx += `\nINTERESTING THREADS TO REVISIT:\n`;
    mem.followUpQueue.slice(0, 3).forEach(f => ctx += `- ${f}\n`);
  }

  if (mem.avgResponseLength < 20 && mem.responseCount > 2) {
    ctx += `\n⚠️ Candidate gives VERY SHORT answers. Encourage elaboration.\n`;
  } else if (mem.avgResponseLength > 120 && mem.responseCount > 2) {
    ctx += `\n⚠️ Candidate is VERBOSE. Politely steer them.\n`;
  }

  ctx += '═══ END LIVE INTELLIGENCE ═══\n';
  return ctx;
}

async function checkContradictions(session, currentAnswer) {
  const mem = session.memory;
  if (!mem || mem.candidateClaims.length < 2) return null;
  const pastClaims = mem.candidateClaims.map(c => `[${c.type}] ${c.text}`).join('\n');
  try {
    const result = await aiChat({
      model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
      max_tokens: 100,
      messages: [{ role: 'user', content: `Check if this answer contradicts past claims.\n\nPAST CLAIMS:\n${pastClaims}\n\nNEW ANSWER: "${currentAnswer}"\n\nReturn ONLY JSON: {"has_contradiction": true/false, "detail": "brief description or null"}` }]
    });
    const raw = result.choices[0].message.content.trim();
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw);
    if (parsed.has_contradiction && parsed.detail) {
      mem.contradictions.push(parsed.detail);
      return parsed.detail;
    }
  } catch (e) { /* silent fail */ }
  return null;
}

// ══════════════════════════════════════════════════════════════
// API ROUTES
// ══════════════════════════════════════════════════════════════

// ── HEALTH CHECK ──
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '3.1.0',
    uptime: Math.round(process.uptime()),
    activeSessions: Object.keys(sessions).length,
    groqKeysAvailable: GROQ_KEYS.length,
    timestamp: new Date().toISOString(),
  });
});

// ── TRANSCRIBE ──
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  const logMsg = (msg) => { console.log(msg); try { fs.appendFileSync('transcribe.log', new Date().toISOString() + ' ' + msg + '\n'); } catch(e) {} };
  
  logMsg(`[TRANSCRIBE] Request received. File: ${!!req.file}, Size: ${req.file?.size || 0}`);
  if (!req.file) return res.status(400).json({ error: 'No audio file' });
  
  let tempPath = null;
  try {
    const mimeType = req.file.mimetype || 'audio/webm';
    const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
    
    // Write to temp file — most reliable approach for Groq SDK
    tempPath = path.join(os.tmpdir(), `placera_${Date.now()}.${ext}`);
    fs.writeFileSync(tempPath, req.file.buffer);
    logMsg(`[TRANSCRIBE] Saved ${req.file.size} bytes as ${tempPath}`);
    
    // Try transcription with key rotation on failure
    let lastErr = null;
    const models = ['whisper-large-v3-turbo', 'whisper-large-v3'];
    
    for (let attempt = 0; attempt < GROQ_KEYS.length * models.length; attempt++) {
      const modelIdx = Math.floor(attempt / GROQ_KEYS.length) % models.length;
      const model = models[modelIdx];
      
      try {
        const client = getGroqClient();
        logMsg(`[TRANSCRIBE] Attempt ${attempt + 1}: key ${currentKeyIndex + 1}, model ${model}`);
        
        const transcription = await client.audio.transcriptions.create({
          file: fs.createReadStream(tempPath),
          model,
          language: 'en',
          response_format: 'json',
          prompt: 'This is a job interview. The candidate is answering technical and behavioral questions about programming, data structures, algorithms, projects, and work experience.'
        });
        
        // Filter Whisper hallucinations (empty/dot-only responses)
        const text = (transcription.text || '').trim();
        const isHallucination = !text || /^[\s.,!?…]+$/.test(text) || text === 'you' || text === 'Thank you.' || text.length < 2;
        if (isHallucination) {
          logMsg(`[TRANSCRIBE] FILTERED hallucination: "${text}" — returning empty`);
          return res.json({ text: '' });
        }
        
        logMsg(`[TRANSCRIBE] SUCCESS: "${text.substring(0, 100)}"`);
        return res.json({ text });
      } catch (err) {
        lastErr = err;
        const isRateLimit = err.status === 429 || (err.message && err.message.includes('rate'));
        logMsg(`[TRANSCRIBE] Attempt ${attempt + 1} FAILED: ${err.status || 'unknown'} ${(err.message || '').substring(0, 120)}`);
        
        if (isRateLimit && GROQ_KEYS.length > 1) {
          rotateKey(); // Rotate BEFORE next iteration creates a new client
        } else if (!isRateLimit) {
          // Non-rate-limit error on this model — skip to next model
          break;
        }
      }
    }
    
    logMsg(`[TRANSCRIBE] ALL ATTEMPTS FAILED. Last error: ${lastErr?.status} ${lastErr?.message?.substring(0, 200)}`);
    res.status(500).json({ error: 'Transcription failed. Please try again.' });
  } catch (err) {
    logMsg(`[TRANSCRIBE] CRITICAL ERROR: ${err.message || JSON.stringify(err)}`);
    res.status(500).json({ error: 'Transcription failed. Please try again.' });
  } finally {
    if (tempPath) try { fs.unlinkSync(tempPath); } catch(e) {}
  }
});

// ── UPLOAD RESUME ──
app.post('/api/upload-resume', uploadLimiter, upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // ── STEP 1: File type validation ──
    const allowedTypes = ['application/pdf', 'text/plain', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!allowedTypes.includes(req.file.mimetype) && !req.file.originalname.match(/\.(pdf|txt|doc|docx)$/i)) {
      return res.status(400).json({ error: 'Invalid file type. Please upload a PDF, DOC, DOCX, or TXT resume.' });
    }

    let resumeText = '';
    const isDocx = req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || req.file.originalname.match(/\.docx$/i);
    const isDoc = req.file.mimetype === 'application/msword' || req.file.originalname.match(/\.doc$/i);

    if (req.file.mimetype === 'application/pdf' || req.file.originalname.match(/\.pdf$/i)) {
      resumeText = (await pdfParse(req.file.buffer)).text;
    } else if (isDocx || isDoc) {
      // mammoth handles both .docx and some .doc files
      try {
        const result = await mammoth.extractRawText({ buffer: req.file.buffer });
        resumeText = result.value;
        if (!resumeText || resumeText.trim().length < 50) throw new Error('empty');
      } catch (e) {
        // For old .doc files mammoth can't parse, try raw text
        resumeText = req.file.buffer.toString('utf-8').replace(/[^\x20-\x7E\n\r\t]/g, ' ');
        if (resumeText.trim().length < 100) {
          return res.status(400).json({ error: 'Could not read this Word file. Please save it as .docx or .pdf and re-upload.' });
        }
      }
    } else {
      resumeText = req.file.buffer.toString('utf-8');
    }


    // ── STEP 2: Minimum content check ──
    const cleanText = resumeText.replace(/\s+/g, ' ').trim();
    if (cleanText.length < 100) {
      return res.status(400).json({ error: 'Document too short. Please upload a complete resume with your details.' });
    }
    if (cleanText.length > 50000) {
      return res.status(400).json({ error: 'Document too long. Please upload a concise resume (not a thesis or book).' });
    }

    // ── STEP 3: Fast heuristic resume detection ──
    const textLower = cleanText.toLowerCase();
    // Positive signals: keywords typically found in resumes
    const resumeSignals = [
      /\b(experience|work\s*experience|professional\s*experience)\b/i,
      /\b(education|bachelor|master|b\.?tech|m\.?tech|b\.?e|m\.?e|b\.?sc|m\.?sc|b\.?ca|m\.?ca|ph\.?d|diploma)\b/i,
      /\b(skills|technical\s*skills|core\s*competencies|proficiency)\b/i,
      /\b(project|projects|personal\s*project|academic\s*project)\b/i,
      /\b(internship|intern|trainee|apprentice)\b/i,
      /\b(contact|email|phone|mobile|linkedin|github)\b/i,
      /\b(resume|curriculum\s*vitae|cv|biodata)\b/i,
      /\b(certification|certified|course|training)\b/i,
      /\b(objective|summary|profile\s*summary|about\s*me)\b/i,
      /\b(achievement|award|honour|honor|accomplishment)\b/i,
    ];
    // Negative signals: keywords that indicate non-resume documents
    const nonResumeSignals = [
      /\b(abstract|introduction|methodology|literature\s*review|conclusion|references|bibliography|acknowledgement)\b/i,
      /\b(hypothesis|theorem|proof|lemma|corollary|proposition)\b/i,
      /\b(fig\.\s*\d|figure\s*\d|table\s*\d|equation\s*\d)\b/i,
      /\b(journal|volume|issue|doi:|issn|arxiv|ieee|springer|elsevier)\b/i,
      /\b(chapter\s*\d|section\s*\d\.\d|appendix)\b/i,
      /\b(research\s*paper|white\s*paper|case\s*study|thesis|dissertation)\b/i,
      /\b(dear\s*(sir|madam|hiring|recruiter)|to\s*whom\s*it\s*may\s*concern|sincerely|regards)\b/i,
      /\b(invoice|receipt|order|payment|shipping|tracking)\b/i,
      /\b(terms\s*and\s*conditions|privacy\s*policy|license\s*agreement)\b/i,
    ];

    const resumeScore = resumeSignals.filter(p => p.test(textLower)).length;
    const nonResumeScore = nonResumeSignals.filter(p => p.test(textLower)).length;

    // Quick reject: strong non-resume signals with weak resume signals
    if (nonResumeScore >= 3 && resumeScore <= 2) {
      console.log(`[RESUME REJECT] Heuristic: resumeScore=${resumeScore}, nonResumeScore=${nonResumeScore}`);
      return res.status(400).json({
        error: 'This doesn\'t appear to be a resume. It looks like a research paper, article, or other document. Please upload your actual resume/CV.',
        detail: 'resume_mismatch'
      });
    }

    // ── STEP 4: AI-powered resume verification (for ambiguous cases) ──
    if (resumeScore < 3 || nonResumeScore >= 2) {
      try {
        const verifyResult = await aiChat({
          model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant', max_tokens: 100,
          messages: [{ role: 'user', content: `Classify this document. Is it a RESUME/CV or something else (research paper, essay, article, letter, invoice, random text)?

DOCUMENT (first 1500 chars):
"""
${cleanText.substring(0, 1500)}
"""

Return ONLY valid JSON:
{"is_resume": true/false, "document_type": "resume" or "research_paper" or "cover_letter" or "essay" or "article" or "invoice" or "unknown", "confidence": 0.0-1.0}` }]
        });
        const verifyRaw = verifyResult.choices[0].message.content.trim();
        const verify = JSON.parse(verifyRaw.match(/\{[\s\S]*\}/)?.[0] || verifyRaw);

        if (verify.is_resume === false && verify.confidence >= 0.7) {
          const docType = verify.document_type || 'non-resume document';
          console.log(`[RESUME REJECT] AI classified as: ${docType} (confidence: ${verify.confidence})`);
          return res.status(400).json({
            error: `This document appears to be a ${docType.replace(/_/g, ' ')}, not a resume. Please upload your actual resume/CV with your education, skills, and experience.`,
            detail: 'ai_classification_reject'
          });
        }
      } catch (verifyErr) {
        // If AI verification fails, fall through to heuristic decision
        console.warn('[RESUME VERIFY] AI check failed, using heuristic:', verifyErr.message);
        if (resumeScore < 2) {
          return res.status(400).json({
            error: 'We couldn\'t verify this as a resume. Please ensure your document contains your name, education, skills, and experience.',
            detail: 'verification_failed'
          });
        }
      }
    }

    console.log(`[RESUME ACCEPTED] resumeScore=${resumeScore}, nonResumeScore=${nonResumeScore}, length=${cleanText.length}`);

    // ── STEP 5: Extract resume data ──
    const extraction = await aiChat({
      model: 'llama-3.3-70b-versatile', max_tokens: 800,
      messages: [{ role: 'user', content: `Extract from this resume. Return ONLY valid JSON, no extra text:\n${resumeText.substring(0, 4000)}\n\nReturn exactly:\n{"name":"","degree":"","college":"","skills":[],"primary_language":"Python","domain":"General","projects":[{"name":"","description":"","tech":[],"highlights":""}],"internships":[{"company":"","role":"","description":""}],"achievements":[]}` }]
    });

    let resumeData;
    try {
      const raw = extraction.choices[0].message.content.trim();
      resumeData = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw);
    } catch {
      resumeData = { name: 'Candidate', skills: [], projects: [], internships: [], achievements: [], domain: 'General', primary_language: 'Python' };
    }

    // Sanitize parsed data to prevent XSS
    if (resumeData.name) resumeData.name = sanitize(resumeData.name);
    if (resumeData.degree) resumeData.degree = sanitize(resumeData.degree);
    if (resumeData.college) resumeData.college = sanitize(resumeData.college);
    if (resumeData.domain) resumeData.domain = sanitize(resumeData.domain);
    if (resumeData.skills) resumeData.skills = resumeData.skills.map(s => sanitize(s));

    const sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    sessions[sessionId] = {
      resumeText: resumeText.substring(0, 4000),
      resumeData,
      round: 1,
      history: [],
      questionCount: 0,
      company: null,
      factErrors: [],
      codingPhase: null,
      unclearCount: {},
      adaptiveEngine: new AdaptiveDifficultyEngine(),
      lastActivity: Date.now(),
    };
    usedQuestions[sessionId] = new Set();
    res.json({ sessionId, resumeData });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Resume processing failed. Please try again.' });
  }
});

// ── START ROUND ──
app.post('/api/start-round', async (req, res) => {
  try {
    const { sessionId, company, round, mode } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });
    const session = sessions[sessionId];
    if (!session) return res.status(400).json({ error: 'Session not found. Please re-upload your resume.' });

    touchSession(session);
    session.company = company || 'Unified';
    session.round = round;
    session.mode = mode || 'standard';
    session.history = [];
    session.questionCount = 0;
    session.factErrors = [];
    session.codingPhase = null;
    session.unclearCount = {};
    session.detectedDomain = detectDomain(session.resumeData);
    session.lastQuestionTime = Date.now();
    if (!session.adaptiveEngine) session.adaptiveEngine = new AdaptiveDifficultyEngine();
    initSessionMemory(session);
    console.log(`[DOMAIN DETECTED] ${session.detectedDomain} for session ${sessionId}`);

    const rd = session.resumeData;
    const resumeSummary = `Name: ${rd.name || 'Candidate'} | Degree: ${rd.degree || 'B.Tech'} | College: ${rd.college || ''}
Primary Language: ${rd.primary_language || 'Python'} | Domain: ${rd.domain || 'General'} | Detected Domain: ${session.detectedDomain} | Skills: ${(rd.skills || []).join(', ')}
Projects: ${(rd.projects || []).map(p => `${p.name} [${(p.tech || []).join(',')}]: ${p.description || '(unclear)'} — ${p.highlights || ''}`).join(' || ')}
Internships: ${(rd.internships || []).map(i => `${i.role} at ${i.company}: ${i.description}`).join(' | ') || 'None'}
Achievements: ${(rd.achievements || []).join(', ') || 'None'}`;

    let systemPrompt;
    switch (session.mode) {
      case 'hr-only':
        systemPrompt = buildHROnlyPrompt(rd, resumeSummary, sessionId, session.adaptiveEngine);
        break;
      case 'tech-only':
      default:
        systemPrompt = buildTechOnlyPrompt(rd, resumeSummary, sessionId, session.adaptiveEngine);
        break;
    }

    const maxQMap = { 'hr-only': 10, 'tech-only': 12 };
    session.maxQuestions = maxQMap[session.mode] || 12;

    const openingMsg = session.mode === 'hr-only'
      ? `Greet the candidate warmly and ask them to introduce themselves. One sentence max. Be natural.`
      : `You just joined a video call with the candidate. Start naturally — "Hey, good to finally connect!" — then ask them to introduce themselves. One sentence max.`;

    const response = await aiChat({
      model: 'llama-3.3-70b-versatile', max_tokens: 250,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: openingMsg }]
    });
    let question = response.choices[0].message.content.replace(/\[FACT_ERROR:[^\]]*\]/g, '').replace(/\[CODING_CHALLENGE:[^\]]*\]/g, '').trim();
    session.history = [{ role: 'system', content: systemPrompt }, { role: 'assistant', content: question }];
    session.questionCount = 1;
    markQuestionUsed(sessionId, question);

    const needsTerminal = (session.mode === 'tech-only');
    const isHRMode = (session.mode === 'hr-only');
    const interviewerName = isHRMode ? 'Amara' : 'David';
    session.interviewerName = interviewerName;

    res.json({
      sessionId, question,
      interviewer: interviewerName,
      interviewerName,
      round, domain: session.detectedDomain,
      primaryLanguage: rd.primary_language,
      maxQuestions: session.maxQuestions,
      needsTerminal,
      adaptiveRating: Math.round(session.adaptiveEngine.rating),
      adaptiveTier: session.adaptiveEngine.getTier(),
    });
  } catch (err) {
    console.error('start-round error:', err);
    res.status(500).json({ error: 'Failed to start interview. Please try again.' });
  }
});

// ── ANSWER QUALITY EVALUATION ──
async function evaluateAnswerQuality(answer, lastQuestion, session) {
  const metaRegex = /pardon|repeat|say again|not audible|can't hear|cannot hear|voice is breaking|breaking up|speak louder|hear you|not clear|quiet|louder|again please|didn't catch|sorry what|am i audible|can you hear me|is my voice|is my mic|mic working|audio working/i;
  const audibilityCheckRegex = /am i audible|can you hear me|is my voice|is my mic|are you able to hear|hello.*can.*hear/i;
  const banterRegex = /how are you|how is it going|nice weather|nice office|you look good|good morning|hello|hi there/i;

  if (audibilityCheckRegex.test(answer.trim())) {
    // Candidate asking if they're audible — confirm and continue
    return { quality: 'audibility_check', is_meta: true, is_audibility: true, needs_clarification: false };
  }
  if (metaRegex.test(answer.trim())) {
    return { quality: 'meta_feedback', is_meta: true, is_audibility: false, needs_clarification: false };
  }
  if (banterRegex.test(answer.trim()) && answer.length < 30) {
    return { quality: 'off_topic', is_meta: false, needs_clarification: true, clarification_prompt: "Let's stick to the interview. " + lastQuestion };
  }
  if (!answer || answer.length < 3) return { quality: 'unclear', needs_clarification: true };

  try {
    const result = await aiChat({
      model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
      max_tokens: 150,
      messages: [{ role: 'user', content: `Classify intent of this interview response: "${answer}"\n\nIntents: "clear", "vague", "unclear", "meta_feedback", "off_topic"\n\nReturn ONLY JSON: {"quality":"clear"|"vague"|"unclear"|"meta_feedback"|"off_topic","is_meta":true|false,"needs_clarification":true|false,"clarification_prompt":"Redirect or probe"}` }]
    });
    const raw = result.choices[0].message.content.trim();
    return JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw);
  } catch {
    return { quality: 'ok', needs_clarification: false, is_meta: false };
  }
}

function detectDistraction(answer) {
  const distractionPatterns = [
    /what is (?:my |the )?(?:ctc|salary|package|stipend)/i,
    /how much (?:will|do) (?:i|you|the company)/i,
    /are you (?:an |a )?(?:ai|robot|bot|machine)/i,
    /who (?:made|built|created) you/i,
    /tell me about (?:the )?company/i,
    /can we (?:talk|discuss|chat)/i,
    /i (?:don't|dont) want to answer/i,
    /skip (?:this|the) question/i,
  ];
  const isDistraction = distractionPatterns.some(p => p.test(answer));
  const isClarification = /(?:don't|dont|not|isn't) (?:understand|get|follow|clear)|(?:can|could) you (?:\w+ )?(?:repeat|rephrase|explain|clarify)|what do you mean/i.test(answer);
  return { isDistraction, isClarification };
}

// ── SEND ANSWER ──
app.post('/api/answer', async (req, res) => {
  const { sessionId, answer, dontKnow, codeSubmission, codeLanguage } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });
  const session = sessions[sessionId];
  if (!session) return res.status(400).json({ error: 'Session not found. Please re-upload your resume.' });

  touchSession(session);
  initSessionMemory(session);
  const maxQ = session.maxQuestions || 12;
  const sanitizedAnswer = sanitize(answer || '');
  const userMsg = dontKnow
    ? "I'm not sure about this one."
    : codeSubmission
    ? `Here's my ${codeLanguage || 'code'} solution:\n\`\`\`${codeLanguage || ''}\n${codeSubmission}\n\`\`\``
    : sanitizedAnswer;

  const { isDistraction, isClarification } = detectDistraction(sanitizedAnswer);
  let qualityCheck = { quality: 'ok', needs_clarification: false, is_meta: false };

  if (isDistraction || isClarification || dontKnow) {
    session.isCodingPhase = false;
  }

  if (isDistraction) {
    session.history.push({ role: 'user', content: userMsg });
    session.history.push({ role: 'system', content: `ALERT: Candidate going off-topic. Answer briefly, redirect, repeat previous question.` });
  } else if (isClarification) {
    session.history.push({ role: 'user', content: userMsg });
    session.history.push({ role: 'system', content: `Candidate asking for clarification — genuine, not distraction. Rephrase same question simpler.` });
  } else if (dontKnow) {
    session.history.push({ role: 'user', content: userMsg });
    session.history.push({ role: 'system', content: `Candidate doesn't know. Acknowledge neutrally, move to next question immediately. Do NOT teach.` });
  } else {
    // Normal answer — deep analysis
    if (!dontKnow && !codeSubmission && sanitizedAnswer && sanitizedAnswer.length > 2) {
      const lastMsg = session.history.filter(h => h.role === 'assistant').slice(-1)[0]?.content || '';
      qualityCheck = await evaluateAnswerQuality(sanitizedAnswer, lastMsg, session);
    }

    updateMemory(session, sanitizedAnswer, qualityCheck);

    // Contradiction check (async)
    if (sanitizedAnswer && sanitizedAnswer.length > 30 && session.memory.candidateClaims.length >= 2) {
      checkContradictions(session, sanitizedAnswer).then(contradiction => {
        if (contradiction) session.memory.followUpQueue.push(`Probe contradiction: ${contradiction}`);
      }).catch(() => {});
    }

    session.history.push({ role: 'user', content: userMsg });
  }

  // Meta-feedback handling
  if (qualityCheck.is_audibility) {
    // Candidate asking "am I audible?" — confirm naturally and repeat the question
    const lastQ = session.history.filter(h => h.role === 'assistant').slice(-1)[0]?.content || '';
    session.history.push({ role: 'system', content: `The candidate just asked if they are audible. Respond BRIEFLY and naturally: "Yes, I can hear you perfectly fine! Let's continue." Then repeat your last question: "${lastQ.substring(0, 200)}" — Do NOT go into troubleshooting mode. Stay in interviewer character.` });
  } else if (qualityCheck.is_meta) {
    const lastQ = session.history.filter(h => h.role === 'assistant').slice(-1)[0]?.content || '';
    session.history.push({ role: 'system', content: `Candidate reporting a technical audio issue. Briefly acknowledge: "Sorry about that, let me repeat." Then repeat: "${lastQ.substring(0, 200)}"` });
  } else if (qualityCheck.needs_clarification) {
    session.history.push({ role: 'system', content: `Respond to vague answer: "${qualityCheck.clarification_prompt || 'Can you elaborate?'}" Don't move to next question yet.` });
  }

  // Track unclear answers to avoid infinite loop
  if (!session.unclearCount) session.unclearCount = {};
  const qKey = 'q' + session.questionCount;
  if (qualityCheck.needs_clarification || qualityCheck.is_meta) {
    session.unclearCount[qKey] = (session.unclearCount[qKey] || 0) + 1;
    if (session.unclearCount[qKey] >= 2) {
      session.history.push({ role: 'system', content: `Candidate gave unclear answers twice. Say "Okay, let's move on" and go to next topic.` });
    }
  } else {
    session.unclearCount[qKey] = 0;
  }

  if (session.questionCount >= maxQ) {
    const closeMsg = 'Close the interview. Thank them, give brief honest feedback, tell them results in 2-3 days. 2-3 sentences.';
    try {
      const r = await aiChat({ model: 'llama-3.3-70b-versatile', max_tokens: 150, messages: [...session.history, { role: 'user', content: closeMsg }] });
      return res.json({
        question: r.choices[0].message.content.replace(/\[FACT_ERROR:[^\]]*\]/g, '').trim(),
        end: true, round: session.round, factErrors: session.factErrors,
        adaptiveRating: Math.round(session.adaptiveEngine?.rating || 50),
        adaptiveTier: session.adaptiveEngine?.getTier() || 'mid_level',
      });
    } catch {
      return res.json({ question: 'Thank you for your time. We will be in touch shortly.', end: true, round: session.round, factErrors: session.factErrors });
    }
  }

  try {
    let activeMessages = [...session.history];
    if (qualityCheck.is_audibility) {
      // For audibility checks, keep interviewer persona — don't switch to troubleshooter
      // The system message already handles it
    } else if (qualityCheck.is_meta) {
      const lastQ = session.history.filter(h => h.role === 'assistant').slice(-1)[0]?.content || '';
      const troubleshootName = session.interviewerName || 'David';
      activeMessages[0] = { role: 'system', content: `You are ${troubleshootName}. The candidate reported an audio issue. Say "Sorry about that, let me repeat" and repeat: "${lastQ.substring(0, 200)}". Stay in interviewer character. DO NOT ask new questions.` };
    } else if (session.memory) {
      const memoryCtx = buildMemoryContext(session);
      if (memoryCtx) activeMessages.push({ role: 'system', content: memoryCtx });
    }

    const response = await aiChat({ model: 'llama-3.3-70b-versatile', max_tokens: 300, messages: activeMessages });
    let rawResponse = response.choices[0].message.content;

    // Extract fact errors
    [...rawResponse.matchAll(/\[FACT_ERROR:\s*([^\]]+)\]/g)].forEach(m => {
      const parts = m[1].split('|');
      if (parts.length === 2) session.factErrors.push({ claimed: parts[0].trim(), correct: parts[1].trim(), questionNum: session.questionCount });
    });

    // Detect coding challenge — primary: explicit tag, fallback: pattern matching
    const codingMatch = rawResponse.match(/\[CODING_CHALLENGE:([^:]+):([^\]]+)\]/);
    let isCodingChallenge = false, codingType = null, codingLanguage = session.resumeData.primary_language || 'Python';
    if (codingMatch) {
      isCodingChallenge = true;
      codingType = codingMatch[1].trim();
      codingLanguage = codingMatch[2].trim();
      session.codingPhase = codingType;
    } else {
      // FALLBACK DSA DETECTION: Catch problems where AI forgot the tag
      const dsaSignals = [
        /PROBLEM SPECIFICATION/i,
        /EXAMPLE CASES/i,
        /CONSTRAINTS.*PERFORMANCE/i,
        /\[TECHNICAL_CHALLENGE/i,
        /\bInput\s*\d+?\s*:.*\bOutput\s*\d+?\s*:/s,
        /Expected\s*Time\s*:\s*O\(/i
      ];
      const dsaScore = dsaSignals.filter(p => p.test(rawResponse)).length;
      if (dsaScore >= 2 && rawResponse.length > 200) {
        isCodingChallenge = true;
        codingType = 'DSA';
        session.codingPhase = 'DSA';
        console.log(`[DSA-FALLBACK] Detected untagged DSA problem (${dsaScore} signals matched)`);
      }
    }

    const cleanQuestion = rawResponse.replace(/\[FACT_ERROR:[^\]]*\]/g, '').replace(/\[CODING_CHALLENGE:[^\]]*\]/g, '').trim();
    session.history.push({ role: 'assistant', content: cleanQuestion });
    markQuestionUsed(sessionId, cleanQuestion);

    // ── FIXED: question count advances for any non-meta, non-clarification response ──
    const shouldAdvance = !qualityCheck.is_meta && !qualityCheck.needs_clarification;
    if (shouldAdvance) {
      session.questionCount++;
      session.frustration = Math.max(0, (session.frustration || 0) - 5);
    }
    if (qualityCheck.quality === 'vague' || qualityCheck.quality === 'off_topic') {
      session.frustration = (session.frustration || 0) + 10;
    }

    res.json({
      question: cleanQuestion,
      questionCount: session.questionCount,
      maxQuestions: maxQ,
      agentAction: qualityCheck.is_meta ? 'repeating question' :
                   qualityCheck.needs_clarification ? 'asking for clarification' :
                   qualityCheck.quality === 'vague' ? 'probing deeper' : 'next topic',
      answerQuality: qualityCheck.quality,
      end: false, round: session.round,
      isCodingChallenge, codingType, codingLanguage,
      factErrorsCount: session.factErrors.length,
      needsTerminal: isCodingChallenge,
      adaptiveRating: Math.round(session.adaptiveEngine?.rating || 50),
      adaptiveTier: session.adaptiveEngine?.getTier() || 'mid_level',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to process answer. Please try again.' });
  }
});

// ── LIVE SCORING ──
app.post('/api/live-score', async (req, res) => {
  const { sessionId, answer, questionType } = req.body;
  const session = sessions[sessionId];
  if (!session) return res.status(400).json({ error: 'Session not found' });
  touchSession(session);

  const isHR = session.round === 2 || session.mode === 'hr-only';
  const prompt = isHR
    ? `Score this HR interview answer. Evaluate based on BIG TECH standards.\n\nAnswer: "${answer}"\n\nReturn ONLY JSON:\n{"empathy":0-100,"leadership":0-100,"cultural_sync":0-100,"communication":0-100,"overall":0-100,"dna":{"ownership":0-100,"long_term_thinking":0-100,"customer_focus":0-100,"innovation":0-100},"coach_tip":"One SHORT tip (max 12 words)"}`
    : `Score this technical interview answer STRICTLY. High scores (80+) ONLY for perfect answers.\n\nAnswer: "${answer}"\nType: ${questionType || 'technical'}\n\nReturn ONLY JSON:\n{"technical_depth":0-100,"problem_solving":0-100,"communication":0-100,"confidence":0-100,"factual_accuracy":0-100,"overall":0-100,"coach_tip":"One SHORT tip (max 12 words)"}`;

  try {
    const result = await aiChat({ model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant', max_tokens: 150, messages: [{ role: 'user', content: prompt }] });
    const raw = result.choices[0].message.content.trim();
    const scores = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw);

    if (!session.runningScores) session.runningScores = {};
    Object.keys(scores).forEach(key => {
      if (typeof scores[key] === 'number') {
        session.runningScores[key] = session.runningScores[key]
          ? Math.round(session.runningScores[key] * 0.7 + scores[key] * 0.3)
          : scores[key];
      }
    });
    res.json(session.runningScores);
  } catch {
    res.status(500).json({ error: 'Scoring failed' });
  }
});

// ── STAR ANALYSIS ──
app.post('/api/star-analyze', async (req, res) => {
  const { sessionId, answer, questionContext } = req.body;
  const session = sessions[sessionId];
  if (!session) return res.status(400).json({ error: 'Session not found' });
  touchSession(session);

  try {
    const result = await aiChat({
      model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant', max_tokens: 300,
      messages: [{ role: 'user', content: `Analyze this behavioral interview answer using STAR framework:\n\nQUESTION: "${questionContext}"\nANSWER: "${answer}"\n\nReturn ONLY JSON:\n{"situation":{"score":0-20,"present":true/false,"feedback":"one sentence"},"task":{"score":0-20,"present":true/false,"feedback":"one sentence"},"action":{"score":0-40,"present":true/false,"feedback":"one sentence"},"result":{"score":0-20,"present":true/false,"feedback":"one sentence"},"total_score":0-100,"star_grade":"A/B/C/D/F","missing_components":["list"],"improvement_tip":"One tip (max 15 words)","used_we_vs_i":"we-heavy"|"i-focused"|"balanced","has_metrics":true/false}` }]
    });
    const raw = result.choices[0].message.content.trim();
    const starData = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw);
    // Store question context with STAR data for rich report generation
    starData.questionContext = (questionContext || '').substring(0, 300);
    starData.answerPreview = (answer || '').substring(0, 300);
    if (!session.starScores) session.starScores = [];
    session.starScores.push(starData);
    res.json(starData);
  } catch {
    res.status(500).json({ error: 'STAR analysis failed' });
  }
});

// ── AI CODE VERIFICATION ──
app.post('/api/verify-code', async (req, res) => {
  const { sessionId, code, language, question, testCases, expectedOutputs, isSubmit } = req.body;
  const session = sessions[sessionId];
  if (!session) return res.status(400).json({ error: 'Session not found' });
  touchSession(session);

  if (!code || !code.trim()) return res.status(400).json({ error: 'No code provided' });

  const testContext = testCases && testCases.length > 0
    ? `\nTest Inputs: ${testCases.join(' | ')}\nExpected Outputs: ${(expectedOutputs || []).join(' | ')}`
    : '';

  const prompt = `You are a code review engine. Analyze this ${language} code solution.

PROBLEM:
${question || 'General coding problem'}
${testContext}

CODE:
\`\`\`${language}
${code}
\`\`\`

Evaluate the code and return ONLY valid JSON (no markdown, no explanation):
{
  "accepted": true/false,
  "feedback": "1-2 sentence analysis of correctness",
  "complexity": { "time": "O(?)", "space": "O(?)" },
  "issues": ["list of specific issues if any"],
  "suggestion": "one optimization hint or empty string",
  "testResults": [
    ${(testCases || []).map((tc, i) => `{"input": "${tc}", "expected": "${(expectedOutputs || [])[i] || '?'}", "actual": "predicted output", "pass": true/false}`).join(',\n    ') || ''}
  ]
}`;

  try {
    const result = await aiChat({
      model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    });
    const raw = result.choices[0].message.content.trim();
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw);
    res.json(parsed);
  } catch (err) {
    console.error('Code verify error:', err.message);
    res.status(500).json({ error: 'Code verification failed' });
  }
});

// ── SCORECARD ──
app.post('/api/scorecard', async (req, res) => {
  const { sessionId } = req.body;
  const session = sessions[sessionId];
  if (!session) return res.status(400).json({ error: 'Session not found' });
  touchSession(session);

  const factSummary = session.factErrors.length > 0
    ? `\nFACTUAL ERRORS (${session.factErrors.length}):\n${session.factErrors.map(e => `- Claimed: "${e.claimed}" | Correct: "${e.correct}"`).join('\n')}`
    : '\nNo factual errors detected.';

  const adaptiveInfo = session.adaptiveEngine
    ? `\nADAPTIVE PERFORMANCE: Final Rating ${Math.round(session.adaptiveEngine.rating)}/100 | Peak: ${Math.round(session.adaptiveEngine.peakRating)}/100 | Tier: ${session.adaptiveEngine.getTier()}`
    : '';

  // STAR analysis summary for scorecard
  const starScores = session.starScores || [];
  let starSummary = '';
  if (starScores.length > 0) {
    const avgTotal = Math.round(starScores.reduce((s, x) => s + (x.total_score || 0), 0) / starScores.length);
    const grades = starScores.map(x => x.star_grade || '?').join(', ');
    starSummary = `\nSTAR BEHAVIORAL ANALYSIS (${starScores.length} answers): Average Score: ${avgTotal}/100 | Grades: ${grades}`;
    starScores.forEach((s, i) => {
      starSummary += `\n  Answer ${i+1}: S=${s.situation?.score||0}/20 T=${s.task?.score||0}/20 A=${s.action?.score||0}/40 R=${s.result?.score||0}/20 Grade=${s.star_grade||'?'}`;
      if (s.used_we_vs_i) starSummary += ` | Pronoun: ${s.used_we_vs_i}`;
      if (s.has_metrics !== undefined) starSummary += ` | HasMetrics: ${s.has_metrics}`;
      if (s.missing_components?.length > 0) starSummary += ` | Missing: ${s.missing_components.join(',')}`;
    });
  }

  const isHR = session.mode === 'hr-only' || session.round === 2;
  const metricsKeys = isHR
    ? '"communication":0,"behavioral":0,"leadership":0,"cultural_fit":0,"star_method":0,"confidence":0'
    : '"technical_depth":0,"problem_solving":0,"communication":0,"confidence":0,"behavioral":0,"system_design":0';
  const starAssessmentField = starScores.length > 0
    ? ',"star_assessment":{"overall_grade":"A/B/C/D/F","avg_score":0,"strongest_component":"situation/task/action/result","weakest_component":"situation/task/action/result","recommendation":"1-2 sentence STAR-specific hiring recommendation","pronoun_pattern":"we-heavy/i-focused/balanced","uses_metrics_in_answers":true/false}'
    : '';
  const strictRule = '\nCRITICAL GRADING RULE: If the candidate provided very short, vague, or no substantive answers (effectively remaining silent), the overall score MUST be extremely low (0-20), the verdict MUST be "No hire", and all metrics must be heavily penalized. Do not invent positive attributes if the candidate did not speak substantially. Be brutal but honest.';
  const starWeightRule = starScores.length > 0 ? `\nSTAR WEIGHT RULE: The STAR behavioral analysis carries significant weight in the final verdict. A candidate with poor STAR scores (avg < 50) should have "behavioral" and "star_method" metrics heavily penalized. The "star_assessment" must honestly reflect their ability to structure behavioral answers. The star_method metric should reflect how well the candidate used the STAR method across all answers.` : '';
  const prompt = `Based on this interview, generate an honest, detailed scorecard.${factSummary}${adaptiveInfo}${starSummary}${strictRule}${starWeightRule}\n\nReturn ONLY valid JSON:\n{"overall":0,"metrics":{${metricsKeys}},"strengths":["specific strength","another"],"improvements":["specific improvement","another"],"fatal_flaw":"critical issue or null","factual_errors":${JSON.stringify(session.factErrors)},"verdict":"Strong hire or Hire or Maybe or No hire","offer_likelihood":0,"next_step":"next step","detailed_feedback":"2-3 sentence honest assessment","adaptive_rating":${Math.round(session.adaptiveEngine?.rating || 50)},"adaptive_tier":"${session.adaptiveEngine?.getTier() || 'mid_level'}"${starAssessmentField}}`;

  try {
    const response = await aiChat({
      model: 'llama-3.3-70b-versatile', max_tokens: 800,
      messages: [...session.history.slice(1), { role: 'user', content: prompt }]
    });
    const raw = response.choices[0].message.content.trim();
    const scorecard = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw);

    // ── ENRICH with transcript & ELO data for PDF report ──
    // Build Q&A transcript from session history
    const transcript = [];
    const historyMsgs = session.history.filter(h => h.role === 'assistant' || h.role === 'user');
    for (let i = 0; i < historyMsgs.length; i += 2) {
      if (historyMsgs[i]?.role === 'assistant' && historyMsgs[i + 1]?.role === 'user') {
        transcript.push({
          question: historyMsgs[i].content.replace(/\[FACT_ERROR:[^\]]*\]/g, '').replace(/\[CODING_CHALLENGE:[^\]]*\]/g, '').trim().substring(0, 500),
          answer: historyMsgs[i + 1].content.substring(0, 500),
          questionNum: Math.ceil((i + 1) / 2)
        });
      }
    }

    // ELO progression data
    const eloHistory = session.adaptiveEngine?.history?.map(h => ({
      rating: Math.round(h.newRating),
      delta: Math.round(h.delta * 10) / 10,
      type: h.questionType,
      score: h.answerScore
    })) || [];

    // Candidate info
    const candidate = {
      name: session.resumeData?.name || 'Candidate',
      skills: session.resumeData?.skills || [],
      degree: session.resumeData?.degree || '',
      college: session.resumeData?.college || '',
      domain: session.resumeData?.domain || 'General'
    };

    // Interview metadata
    const interviewMeta = {
      mode: session.mode || 'tech-only',
      questionsAsked: session.questionCount || 0,
      maxQuestions: session.maxQuestions || 12,
      startTime: session.startTime,
      interviewerName: session.interviewerName || 'David'
    };

    res.json({
      ...scorecard,
      transcript,
      eloHistory,
      candidate,
      interviewMeta,
      factual_errors: session.factErrors,
      runningScores: session.runningScores || {},
      starScores: session.starScores || []
    });
  } catch {
    res.status(500).json({ error: 'Could not generate scorecard' });
  }
});

// ══════════════════════════════════════════════════════════════
// VOICE ENGINE
// ══════════════════════════════════════════════════════════════

// ── QUESTION CLASSIFIER ──
function classifyQuestion(text) {
  const t = text.toLowerCase();
  if (/tell me about yourself|introduce|walk me through your background/i.test(t)) return 'warm_opening';
  if (/why did you|what made you|how did you decide/i.test(t)) return 'curious_probing';
  if (/can you code|write a|implement|algorithm|complexity|o\(|optimize/i.test(t)) return 'technical';
  if (/what if|scale|million users|how would you handle|design a system/i.test(t)) return 'deep_thinking';
  if (/anything else|questions for me|wrap up|thank you|good luck/i.test(t)) return 'closing';
  if (/tell me about a time|conflict|situation|challenge you faced/i.test(t)) return 'behavioural';
  if (/hmm|that's not quite|are you sure|think again|actually/i.test(t)) return 'challenging';
  if (/nice|great answer|clever|impressive|good point/i.test(t)) return 'acknowledging';
  if (/take your time|no rush|it's okay|don't worry/i.test(t)) return 'empathetic';
  if (/wait|really|oh|interesting|huh|fascinating/i.test(t)) return 'surprised';
  if (/now let's|moving on|next|let's shift/i.test(t)) return 'transitional';
  if (/earlier you|you mentioned|going back|you said/i.test(t)) return 'callback';
  return 'professional';
}

// ── PRONUNCIATION DICTIONARY ──
const PRONUNCIATION_MAP = {
  // Databases & Storage
  'SQL': 'sequel', 'NoSQL': 'no-sequel', 'MySQL': 'my-sequel',
  'PostgreSQL': 'post-gress-sequel', 'MongoDB': 'mongo D-B', 'Redis': 'redis',
  'DBMS': 'D-B-M-S', 'RDBMS': 'R-D-B-M-S', 'SQLite': 'S-Q-lite',
  // OOP & CS
  'OOPS': 'O-O-P-S', 'OOP': 'O-O-P', 'SOLID': 'solid',
  'DRY': 'D-R-Y', 'KISS': 'kiss', 'YAGNI': 'yag-nee',
  // APIs & Web
  'API': 'A-P-I', 'APIs': 'A-P-Is', 'REST': 'rest', 'GraphQL': 'graph-Q-L',
  'JSON': 'jay-son', 'YAML': 'yam-ul', 'XML': 'X-M-L', 'AJAX': 'ay-jax',
  'CORS': 'cors', 'CSRF': 'C-S-R-F', 'XSS': 'X-S-S',
  'OAuth': 'oh-auth', 'JWT': 'J-W-T', 'CRUD': 'crud', 'ORM': 'O-R-M',
  'GUI': 'goo-ee', 'CLI': 'C-L-I', 'SDK': 'S-D-K', 'IDE': 'I-D-E',
  // DevOps & Cloud
  'CI/CD': 'C-I C-D', 'DevOps': 'dev-ops', 'AWS': 'A-W-S', 'GCP': 'G-C-P',
  'kubectl': 'kube-control', 'nginx': 'engine-x', 'Docker': 'docker',
  'Kubernetes': 'koo-ber-net-ees', 'K8s': 'kates',
  'SaaS': 'sass', 'PaaS': 'pass', 'IaaS': 'eye-ass',
  // Networking
  'TCP': 'T-C-P', 'UDP': 'U-D-P', 'IP': 'I-P',
  'HTTP': 'H-T-T-P', 'HTTPS': 'H-T-T-P-S', 'DNS': 'D-N-S', 'CDN': 'C-D-N',
  'SMTP': 'S-M-T-P', 'SSH': 'S-S-H', 'SSL': 'S-S-L', 'TLS': 'T-L-S',
  'FIFO': 'fai-fo', 'LIFO': 'lai-fo', 'TTL': 'T-T-L',
  // Algorithms & DS
  'BFS': 'B-F-S', 'DFS': 'D-F-S', 'DP': 'D-P', 'LRU': 'L-R-U', 'LCA': 'L-C-A',
  'BST': 'B-S-T', 'AVL': 'A-V-L', 'DAG': 'dag',
  'ACID': 'acid', 'CAP': 'cap', 'BASE': 'base',
  'regex': 'rej-ex', 'stdin': 'standard-in', 'stdout': 'standard-out',
  // Programming
  'async': 'ay-sink', 'sudo': 'soo-doh', 'grep': 'grep',
  'Vue': 'view', 'Django': 'jango', 'FastAPI': 'fast-A-P-I',
  'pthread': 'P-thread', 'mutex': 'mew-tex', 'semaphore': 'seh-ma-for',
  'npm': 'N-P-M', 'yarn': 'yarn', 'pip': 'pip',
  // Job & HR Terms
  'SDE': 'S-D-E', 'SWE': 'S-W-E', 'PM': 'P-M', 'EM': 'E-M',
  'LPA': 'lakhs per annum', 'CTC': 'C-T-C', 'ESOP': 'E-S-O-P',
  'RSU': 'R-S-U', 'RSUs': 'R-S-Us', 'KPI': 'K-P-I', 'ROI': 'R-O-I',
  'STAR': 'star', 'HR': 'H-R', 'BATNA': 'bat-na', 'WFH': 'work from home',
  'B2B': 'B-to-B', 'B2C': 'B-to-C', 'POC': 'P-O-C', 'MVP': 'M-V-P',
  // Industry Terms
  'IEEE': 'eye-triple-E', 'FAANG': 'fang', 'MAANG': 'mang',
  'DSA': 'D-S-A', 'OS': 'O-S', 'CN': 'C-N',
};

function applyPronunciations(text) {
  let result = text;
  const sorted = Object.entries(PRONUNCIATION_MAP).sort((a, b) => b[0].length - a[0].length);
  for (const [term, pronunciation] of sorted) {
    const regex = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
    result = result.replace(regex, pronunciation);
  }
  return result;
}

function humaniseText(text, company) {
  let result = applyPronunciations(text);
  const emotion = classifyQuestion(text);

  result = result
    .replace(/\. ([A-Z])/g, (_, next) => {
      const bridges = [' and ', ' so ', ' — ', ' now ', ' right, ', ' also ', ' then ', ' plus ', ' but '];
      if (Math.random() < 0.50) return bridges[Math.floor(Math.random() * bridges.length)] + next.toLowerCase();
      return '.  ' + next;
    })
    .replace(/\? /g, '?  ')
    .replace(/\! /g, '!  ')
    .replace(/: /g, ' — ')
    .replace(/\. \./g, '.')
    .replace(/  +/g, '  ');

  const openers = {
    warm_opening: ['So,', 'Alright,', 'Okay,', 'Right,', 'Hey,', 'Great,'],
    curious_probing: ['Hmm,', 'Interesting,', 'Okay so,', 'Accha,', 'Right so,'],
    technical: ['Alright,', 'Okay,', 'Right,', 'So,', 'Now,'],
    deep_thinking: ['Hmm,', 'So,', 'Right,', 'Interesting,'],
    behavioural: ['So,', 'Okay,', 'Alright,', 'Right,'],
    closing: ['Alright,', 'Okay,', 'So,', 'Great,', 'Well,'],
    professional: ['Okay,', 'Right,', 'Sure,', 'So,'],
    challenging: ['Hmm,', 'Well,', 'Okay,', 'Right,', 'Hold on,'],
    acknowledging: ['Nice,', 'Great,', 'Good,', 'Oh nice,'],
    empathetic: ['Hey,', 'Look,', "It's okay,", 'No worries,'],
    surprised: ['Oh,', 'Wait,', 'Huh,', 'Really,'],
    transitional: ['Okay so,', 'Now,', 'Right,', 'Alright,'],
    callback: ['Going back to,', 'You know,', 'Earlier you said,'],
  };
  const list = openers[emotion] || openers.professional;
  result = list[Math.floor(Math.random() * list.length)] + ' ' + result.charAt(0).toLowerCase() + result.slice(1);

  const fillers = [', you know,', ', right,', ', basically,', ', actually,', ', see,', ', like,'];
  let usedFiller = false;
  result = result.replace(/([a-z]{5,})\. ([A-Z])/g, (match, word, next) => {
    if (!usedFiller && Math.random() < 0.22) {
      usedFiller = true;
      return word + fillers[Math.floor(Math.random() * fillers.length)] + ' ' + next.toLowerCase();
    }
    return match;
  });

  if (Math.random() < 0.15 && !result.endsWith('?')) {
    const endings = [', right?', ', you see?', ', na?', ", isn't it?"];
    result = result.replace(/\.(\s*)$/, endings[Math.floor(Math.random() * endings.length)] + '$1');
  }

  result = result.replace(
    /\b(specifically|honestly|actually|essentially|importantly|literally|obviously|clearly|absolutely|definitely)\b/gi,
    '... $1'
  );

  return result.trim();
}

function getVoiceSettings(text) {
  const emotion = classifyQuestion(text);
  const base = {
    warm_opening: { stability: 0.22, similarity_boost: 0.58, style: 0.65 },
    curious_probing: { stability: 0.17, similarity_boost: 0.52, style: 0.62 },
    technical: { stability: 0.36, similarity_boost: 0.70, style: 0.25 },
    deep_thinking: { stability: 0.19, similarity_boost: 0.55, style: 0.55 },
    behavioural: { stability: 0.24, similarity_boost: 0.60, style: 0.52 },
    closing: { stability: 0.30, similarity_boost: 0.62, style: 0.58 },
    professional: { stability: 0.25, similarity_boost: 0.58, style: 0.42 },
    challenging: { stability: 0.15, similarity_boost: 0.50, style: 0.68 },
    acknowledging: { stability: 0.28, similarity_boost: 0.65, style: 0.72 },
    empathetic: { stability: 0.32, similarity_boost: 0.62, style: 0.60 },
    surprised: { stability: 0.12, similarity_boost: 0.48, style: 0.75 },
    transitional: { stability: 0.30, similarity_boost: 0.60, style: 0.35 },
    callback: { stability: 0.20, similarity_boost: 0.55, style: 0.50 },
  };
  const s = base[emotion] || base.professional;
  return {
    stability: Math.max(0.08, Math.min(0.50, s.stability + (Math.random() * 0.10 - 0.05))),
    similarity_boost: Math.max(0.40, Math.min(0.80, s.similarity_boost + (Math.random() * 0.08 - 0.04))),
    style: Math.max(0.15, Math.min(0.85, s.style + (Math.random() * 0.12 - 0.06))),
    use_speaker_boost: true
  };
}

// ── SPEAK ENDPOINT ──
app.post('/api/speak', async (req, res) => {
  const { text, company, round, sessionId } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });

  // ── DYNAMIC VOICE SELECTION: Amara (female) for HR/salary, David (male) for tech ──
  const session = sessionId ? sessions[sessionId] : null;
  const isHR = session && (session.mode === 'hr-only' || session.round === 2);
  const voiceId = isHR
    ? (process.env.ELEVENLABS_HR_VOICE_ID || process.env.ELEVENLABS_VOICE_ID)
    : process.env.ELEVENLABS_VOICE_ID;
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!voiceId || !apiKey) return res.json({ fallback: true, humanText: text });
  const voiceName = isHR ? 'Amara (female)' : 'David (male)';
  console.log(`[VOICE] Using ${voiceName} voice: ${voiceId}`);

  const modelId = process.env.ELEVENLABS_MODEL || 'eleven_turbo_v2_5';
  const humanText = humaniseText(text, company);

  try {
    const elevenRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?optimize_streaming_latency=2`,
      {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
        body: JSON.stringify({
          text: humanText.substring(0, 5000),
          model_id: modelId,
          voice_settings: getVoiceSettings(text),
          seed: Math.floor(Math.random() * 999999)
        })
      }
    );

    if (!elevenRes.ok) {
      const errText = await elevenRes.text();
      console.error('[ELEVENLABS ERROR]', elevenRes.status, errText);
      return res.json({ fallback: true, humanText: text });
    }

    res.set({ 'Content-Type': 'audio/mpeg', 'Transfer-Encoding': 'chunked', 'Cache-Control': 'no-cache' });
    const reader = elevenRes.body.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { res.end(); return; }
        res.write(Buffer.from(value));
      }
    };
    await pump();
  } catch (err) {
    console.error('[ELEVENLABS ERROR]', err.message);
    res.json({ fallback: true, humanText: text });
  }
});

// ── ADAPTIVE ENGINE STATUS ──
app.get('/api/adaptive-status/:sessionId', (req, res) => {
  const session = sessions[req.params.sessionId];
  if (!session || !session.adaptiveEngine) return res.status(404).json({ error: 'Session not found' });
  res.json(session.adaptiveEngine.toJSON());
});

// ══════════════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN
// ══════════════════════════════════════════════════════════════
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  const server = app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Placera v3.1 production server live on port ${PORT}`));


  function gracefulShutdown(signal) {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    server.close(() => {
      console.log('✅ Server closed. Active sessions:', Object.keys(sessions).length);
      process.exit(0);
    });
    setTimeout(() => { console.error('Forced shutdown'); process.exit(1); }, 5000);
  }

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

module.exports = app;