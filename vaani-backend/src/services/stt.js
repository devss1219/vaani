import Groq from 'groq-sdk';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import os from 'os';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Minimum audio size threshold (in bytes) — silence wale chunks bahut chhote hote hain
const MIN_AUDIO_SIZE_BYTES = 12000; // ~12KB se chhota chunk usually silence/noise hai

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
            response_format: "verbose_json", // confidence scores + no_speech_prob milti hai
            // prompt intentionally removed — Whisper prompt ko transcription mein echo kar deta hai
        });

        // Temp file delete
        if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
        }

        const latency = Date.now() - startTime;

        // verbose_json mein segments hote hain with confidence scores
        const segments = transcription.segments || [];

        // Low confidence ya silence segments filter karo
        // avg_logprob < -0.5 = hallucination likely
        // no_speech_prob > 0.6 = Whisper khud bol raha hai silence hai
        const goodSegments = segments.filter(seg => {
            const isLowConfidence = seg.avg_logprob < -0.5;
            const isSilence = seg.no_speech_prob > 0.6;
            if (isLowConfidence || isSilence) {
                console.log(`🔇 Low-confidence segment dropped: "${seg.text.trim()}" (logprob: ${seg.avg_logprob?.toFixed(2)}, no_speech: ${seg.no_speech_prob?.toFixed(2)})`);
                return false;
            }
            return true;
        });

        // ⚠️ NO fallback to transcription.text — agar sab segments filter ho gaye
        // toh transcription.text mein wahi hallucinated text hoga, bypass nahi karna
        const text = goodSegments.map(s => s.text).join(" ").trim();

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