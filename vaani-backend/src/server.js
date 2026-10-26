import 'dotenv/config';
import express from 'express';
import { WebSocketServer } from 'ws';
import { transcribeAudio } from './services/stt.js';
import { generateResponse, clearHistory } from './services/llm.js';
import { generateSpeech } from './services/tts.js';

const app = express();
const PORT = process.env.PORT || 8080;

app.get('/health', (req, res) => res.json({ status: "Gateway is healthy 🚀" }));

const server = app.listen(PORT, () => {
    console.log(`🚀 REST API running on http://localhost:${PORT}`);
});

const wss = new WebSocketServer({ server });

// ═══════════════════════════════════════════════════════════════
//  Hallucination Filter (Upgraded)
// ═══════════════════════════════════════════════════════════════
const HALLUCINATION_PATTERNS = [
    // YouTube/media hallucinations
    /thanks for watching/i, /thank you for watching/i, /please subscribe/i,
    /like and subscribe/i, /like and share/i, /subtitles by/i,
    /amara\.org/i, /translated by/i, /captioned by/i,
    /copyright/i, /all rights reserved/i, /धन्यवाद/i, /सब्सक्राइब/i,

    // Presentation/slide hallucinations (screenshot wale)
    /next slide/i, /going to the next/i, /click here/i,
    /on the screen/i, /as you can see/i, /in this slide/i,

    // Generic filler hallucinations Whisper generate karta hai
    /^(hello|hi|hey)[.,!]?\s*$/i,                    // sirf "Hello." ya "Hi!"
    /^thank you[.,!]?\s*$/i,                          // sirf "Thank you."
    /^(okay|ok|alright|sure)[.,!]?\s*$/i,             // sirf "Okay."
    /^(hmm+|uh+|um+|ah+)[.,!]?\s*$/i,                // sirf filler sounds
    /^(yes|no|yeah|nope)[.,!]?\s*$/i,                 // sirf "Yes." / "No."
    /^(bye|goodbye|see you)[.,!]?\s*$/i,

    // Common Whisper English hallucinations
    /hello miriam/i, /hello maria/i, /hello michael/i,
    /how are you doing/i,
    /i'll be right back/i, /we'll be right back/i,
    /stay tuned/i, /don't go anywhere/i,
    /this is a test/i,
    /\[music\]/i, /\[applause\]/i, /\[laughter\]/i,
];

function isHallucination(text) {
    if (!text || text.trim().length < 2) return true;
    const trimmed = text.trim();

    // Check against the upgraded pattern list
    for (const pattern of HALLUCINATION_PATTERNS) {
        if (pattern.test(trimmed)) return true;
    }

    const withoutPunctuation = trimmed.replace(/[.,!?।\s"':\-()]/g, "").trim();
    if (withoutPunctuation.length < 2) return true;

    const words = trimmed.split(/\s+/);
    if (words.length >= 4) {
        const uniqueWords = new Set(words.map(w => w.toLowerCase()));
        if (uniqueWords.size <= Math.ceil(words.length / 3)) return true;
    }
    if (words.length >= 3 && new Set(words).size === 1) return true;
    return false;
}

// ═══════════════════════════════════════════════════════════════
//  WebSocket Connection Handler
// ═══════════════════════════════════════════════════════════════
wss.on('connection', (ws) => {
    console.log('🟢 New Client Connected to Voice Gateway');

    let sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    let textBuffer = "";
    let debounceTimer = null;
    let isProcessingLLM = false;
    const DEBOUNCE_DELAY_MS = 1200;

    ws.on('message', async (message) => {
        try {
            const event = JSON.parse(message);

            if (event.type === 'session_start') {
                sessionId = event.tenantId || sessionId;
                console.log(`[Session] Started: ${sessionId}`);
            }
            else if (event.type === 'audio_chunk') {
                const sttResult = await transcribeAudio(event.data);

                if (!sttResult || !sttResult.text) return;

                let cleanText = sttResult.text.trim();

                if (isHallucination(cleanText)) {
                    console.log(`🔇 Hallucination blocked: "${cleanText}"`);
                    return;
                }

                console.log(`🎙️ STT: "${cleanText}" (${sttResult.latency}ms)`);

                ws.send(JSON.stringify({
                    type: 'stt_transcript',
                    text: cleanText,
                    latencyMs: sttResult.latency
                }));

                textBuffer += (textBuffer ? " " : "") + cleanText;

                if (debounceTimer) clearTimeout(debounceTimer);

                debounceTimer = setTimeout(async () => {
                    if (textBuffer.trim() && !isProcessingLLM) {
                        isProcessingLLM = true;
                        const fullText = textBuffer.trim();
                        textBuffer = "";

                        console.log(`🧠 Generating AI reply for: "${fullText}"`);

                        if (ws.readyState === ws.OPEN) {
                            // 🟢 FIX: User ka poora sentence frontend ko bheja ja raha hai taaki Blue Bubble bane
                            ws.send(JSON.stringify({ type: 'user_final_text', text: fullText }));

                            // Phir Agent ki thinking state
                            ws.send(JSON.stringify({ type: 'agent_thinking' }));
                        }

                        try {
                            const llmResult = await generateResponse(fullText, sessionId);

                            if (ws.readyState === ws.OPEN) {
                                // 1. Pehle Text bhejo taaki UI turant update ho
                                ws.send(JSON.stringify({
                                    type: 'agent_response',
                                    text: llmResult.text,
                                    latencyMs: llmResult.latencyMs
                                }));

                                // 2. Phir ElevenLabs se Audio generate karke bhejo
                                console.log(`🔊 Generating Voice for: "${llmResult.text}"`);
                                const audioBase64 = await generateSpeech(llmResult.text);

                                if (audioBase64 && ws.readyState === ws.OPEN) {
                                    ws.send(JSON.stringify({
                                        type: 'agent_audio',
                                        audio: audioBase64
                                    }));
                                } else if (ws.readyState === ws.OPEN) {
                                    // TTS failed — fallback error bhejo
                                    ws.send(JSON.stringify({
                                        type: 'agent_audio_error',
                                        text: llmResult.text
                                    }));
                                }
                            }
                        } catch (err) {
                            console.error('❌ LLM/TTS Processing Error:', err.message);
                        } finally {
                            isProcessingLLM = false;
                        }
                    }
                }, DEBOUNCE_DELAY_MS);
            }
        } catch (error) {
            console.error('❌ WebSocket Message Error:', error.message);
        }
    });

    ws.on('close', () => {
        console.log(`🔴 Client Disconnected: ${sessionId}`);
        if (debounceTimer) clearTimeout(debounceTimer);
        clearHistory(sessionId);
    });
});