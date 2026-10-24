import Groq from 'groq-sdk';
import 'dotenv/config';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Per-session conversation history store karna — taaki agent ko context mile
const sessionHistories = new Map();

// Max history messages per session (zyada se memory na bhare)
const MAX_HISTORY = 20;

/**
 * Session ki history initialize ya fetch karo
 */
export function getOrCreateHistory(sessionId) {
    if (!sessionHistories.has(sessionId)) {
        sessionHistories.set(sessionId, []);
    }
    return sessionHistories.get(sessionId);
}

/**
 * Session khatam hone par history clean karo
 */
export function clearHistory(sessionId) {
    sessionHistories.delete(sessionId);
}

/**
 * AI response generate karo with conversation context
 */
export async function generateResponse(userText, sessionId = 'default') {
    try {
        const startTime = Date.now();

        // Session history fetch karo
        const history = getOrCreateHistory(sessionId);

        // User ka message history mein add karo
        history.push({ role: "user", content: userText });

        // History ko limit mein rakho (puraane messages hatao)
        while (history.length > MAX_HISTORY) {
            history.shift();
        }

        const systemPrompt = `You are Vaani, a warm, polite, and intelligent Indian AI voice assistant.
STRICT GUIDELINES:
1. LANGUAGE RULE (most important): Always reply in the SAME language the user is speaking.
   - If user speaks English → reply in clear, natural English.
   - If user speaks Hindi or Hinglish → reply in friendly Hinglish (Hindi words written in English alphabet, NOT Devanagari). Example: "Haan bilkul, main aapki madad kar sakti hoon!"
   - If user switches language mid-conversation → you switch too, immediately.
2. Keep replies concise (1 to 2 short sentences max) — this will be spoken aloud.
3. NEVER use Devanagari script (no characters like 'मेरी आवाज'). Always use English alphabet.
4. Do NOT use markdown, bold, italics, bullet points, numbers, or emojis. Plain speakable text only.
5. If the user asks if you can hear them or tests their mic, warmly confirm you can hear them clearly.
6. Remember previous conversation context for natural continuity.`;

        const messages = [
            { role: "system", content: systemPrompt },
            ...history
        ];

        const completion = await groq.chat.completions.create({
            messages: messages,
            model: "qwen/qwen3.8-27b",
            temperature: 0.6,
            max_tokens: 80,
        });

        const latency = Date.now() - startTime;

        let responseText = completion.choices[0]?.message?.content || "Sorry, mujhe samajh nahi aaya.";

        // 🧹 Clean up: <think> tags (agar Qwen model sochte hue tags emit kare)
        responseText = responseText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

        // 🧹 Clean up: Markdown formatting aur special characters hatao
        responseText = responseText
            .replace(/\*\*/g, '')
            .replace(/\*/g, '')
            .replace(/#{1,6}\s/g, '')
            .replace(/`/g, '')
            .replace(/^["]|["]$/g, '')
            .trim();

        // Assistant ka response history mein add karo
        history.push({ role: "assistant", content: responseText });

        return {
            text: responseText,
            latencyMs: latency
        };
    } catch (error) {
        console.error("❌ Groq LLM Error:", error.message || error);
        return { text: "Ek second, network thoda slow hai. Kya aap dobara bol sakte hain?", latencyMs: 0 };
    }
}