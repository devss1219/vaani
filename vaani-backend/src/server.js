import 'dotenv/config';
import express from 'express';
import { WebSocketServer } from 'ws';
import { transcribeAudio } from './services/stt.js';
import { generateResponse, clearHistory } from './services/llm.js';

const app = express();
const PORT = process.env.PORT || 8080;

app.get('/health', (req, res) => res.json({ status: "Gateway is healthy 🚀" }));

const server = app.listen(PORT, () => {
    console.log(`🚀 REST API running on http://localhost:${PORT}`);
});

const wss = new WebSocketServer({ server });

// ═══════════════════════════════════════════════════════════════
//  Hallucination Filter — Whisper silence pe ye generate karta hai
// ═══════════════════════════════════════════════════════════════
const HALLUCINATION_PATTERNS = [
    // Subtitles and video artifacts (classic Whisper hallucinations on silence)
    /thanks for watching/i,
    /thank you for watching/i,
    /please subscribe/i,
    /like and subscribe/i,
    /like and share/i,
    /subtitles by/i,
    /amara\.org/i,
    /translated by/i,
    /captioned by/i,
    /copyright/i,
    /all rights reserved/i,
    /धन्यवाद/i,
    /सब्सक्राइब/i,
];

/**
 * Check if transcription is a hallucination
 */
function isHallucination(text) {
    if (!text || text.trim().length < 2) return true;

    const trimmed = text.trim();

    // Check against known hallucination patterns
    for (const pattern of HALLUCINATION_PATTERNS) {
        if (pattern.test(trimmed)) {
            return true;
        }
    }

    // Agar text sirf punctuation aur whitespace hai
    const withoutPunctuation = trimmed.replace(/[.,!?।\s"':\-()]/g, "").trim();
    if (withoutPunctuation.length < 2) {
        return true;
    }

    // Repetitive patterns check (Whisper loops on silence, e.g. "जो जो जोड़ो", "कि अजया कि अजया")
    const words = trimmed.split(/\s+/);
    if (words.length >= 4) {
        const uniqueWords = new Set(words.map(w => w.toLowerCase()));
        if (uniqueWords.size <= Math.ceil(words.length / 3)) {
            return true;
        }
    }

    // Single repeated word check (e.g. "हाँ हाँ हाँ")
    if (words.length >= 3 && new Set(words).size === 1) {
        return true;
    }

    return false;
}

// ═══════════════════════════════════════════════════════════════
//  WebSocket Connection Handler
// ═══════════════════════════════════════════════════════════════
wss.on('connection', (ws) => {
    console.log('🟢 New Client Connected to Voice Gateway');

    // Per-connection state
    let sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    let textBuffer = "";             // User ke words collect karo
    let debounceTimer = null;        // Debounce timer — user ke bolna khatam hone ka wait karo
    let isProcessingLLM = false;     // LLM already processing hai toh duplicate calls mat karo
    const DEBOUNCE_DELAY_MS = 1200;  // 1.2 sec silence ke baad LLM ko bhejo

    ws.on('message', async (message) => {
        try {
            const event = JSON.parse(message);

            if (event.type === 'session_start') {
                sessionId = event.tenantId || sessionId;
                console.log(`[Session] Started: ${sessionId}`);
            }
            else if (event.type === 'audio_chunk') {

                // Step 1: Audio ko transcribe karo
                const sttResult = await transcribeAudio(event.data);

                if (!sttResult || !sttResult.text) {
                    return; // Silent chunk — ignore
                }

                let cleanText = sttResult.text.trim();

                // Step 2: Hallucination check
                if (isHallucination(cleanText)) {
                    console.log(`🔇 Hallucination blocked: "${cleanText}"`);
                    return;
                }

                console.log(`🎙️ STT: "${cleanText}" (${sttResult.latency}ms)`);

                // Step 3: User ko transcript dikhao (immediate feedback)
                ws.send(JSON.stringify({
                    type: 'stt_transcript',
                    text: cleanText,
                    latencyMs: sttResult.latency
                }));

                // Step 4: Text buffer mein add karo (debounce ke liye)
                textBuffer += (textBuffer ? " " : "") + cleanText;

                // Step 5: Debounce timer reset karo
                if (debounceTimer) {
                    clearTimeout(debounceTimer);
                }

                debounceTimer = setTimeout(async () => {
                    // User ne bolna band kiya — ab LLM ko bhejo
                    if (textBuffer.trim() && !isProcessingLLM) {
                        isProcessingLLM = true;
                        const fullText = textBuffer.trim();
                        textBuffer = ""; // Buffer clear karo

                        console.log(`🧠 Generating AI reply for: "${fullText}"`);

                        // Frontend ko notify karo ki Vaani soch rahi hai
                        if (ws.readyState === ws.OPEN) {
                            ws.send(JSON.stringify({ type: 'agent_thinking' }));
                        }

                        try {
                            const llmResult = await generateResponse(fullText, sessionId);

                            // Check ki connection abhi bhi open hai
                            if (ws.readyState === ws.OPEN) {
                                ws.send(JSON.stringify({
                                    type: 'agent_response',
                                    text: llmResult.text,
                                    latencyMs: llmResult.latencyMs
                                }));
                            }
                        } catch (err) {
                            console.error('❌ LLM Processing Error:', err.message);
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
        // Cleanup
        if (debounceTimer) clearTimeout(debounceTimer);
        clearHistory(sessionId);
    });
});