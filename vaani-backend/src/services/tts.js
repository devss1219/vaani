import 'dotenv/config';

export async function generateSpeech(text) {
    try {
        const startTime = Date.now();
        // Jessica voice — premade, free plan compatible (warm, playful, clear)
        // Rachel (21m00...) was a library voice — paid plan only
        const VOICE_ID = 'cgSgspJ2msm6clMCkdW9'; // Jessica
        const API_KEY = process.env.ELEVENLABS_API_KEY;

        if (!API_KEY) throw new Error("ElevenLabs API Key missing in .env");

        // Native fetch use kar rahe hain, extra package ki zaroorat nahi
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
            method: 'POST',
            headers: {
                'Accept': 'audio/mpeg',
                'xi-api-key': API_KEY,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                text: text,
                model_id: 'eleven_turbo_v2_5', // Free plan compatible + multilingual Hinglish support
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.75,
                }
            })
        });

        if (!response.ok) {
            throw new Error(`ElevenLabs API error: ${response.status} ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64Audio = buffer.toString('base64');

        console.log(`🔊 TTS Generated in ${Date.now() - startTime}ms`);
        return base64Audio;

    } catch (error) {
        console.error("❌ TTS Error:", error.message);
        return null;
    }
}