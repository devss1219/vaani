import Groq from 'groq-sdk';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import os from 'os';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Minimum audio size threshold (in bytes) — silence wale chunks bahut chhote hote hain
const MIN_AUDIO_SIZE_BYTES = 5000; // ~5KB se chhota chunk usually silence hai

export async function transcribeAudio(base64Audio) {
    let tempFilePath = "";
    try {
        // 🛑 Pehle check: Agar audio chunk bahut chhota hai, toh API call mat karo
        const audioBuffer = Buffer.from(base64Audio, 'base64');

        if (audioBuffer.length < MIN_AUDIO_SIZE_BYTES) {
            console.log(`🔇 Audio chunk too small (${audioBuffer.length} bytes), skipping STT`);
            return null;
        }

        const startTime = Date.now();

        // Temporary file path create karna
        tempFilePath = path.join(os.tmpdir(), `audio_chunk_${Date.now()}.webm`);

        // Buffer ko file mein save karna
        fs.writeFileSync(tempFilePath, audioBuffer);

        // Groq Whisper API call — turbo model for speed
        const transcription = await groq.audio.transcriptions.create({
            file: fs.createReadStream(tempFilePath),
            model: "whisper-large-v3-turbo",
            temperature: 0.0,
            prompt: "Vaani Indian AI voice assistant.",
        });

        // Temp file delete
        if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
        }

        const latency = Date.now() - startTime;
        const text = (transcription.text || "").trim();

        // Empty transcription check
        if (!text) {
            return null;
        }

        return {
            text: text,
            latency: latency
        };

    } catch (error) {
        console.error("❌ Groq STT Error:", error.message);

        // Error pe bhi file cleanup
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
        }

        return null;
    }
}