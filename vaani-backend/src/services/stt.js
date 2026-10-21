import Groq from "groq-sdk";
import fs from "fs";
import path from "path";
import os from "os";

const groq = new Groq();

export async function transcribeAudio(base64Audio) {
    try {
        const startTime = Date.now();
        const audioBuffer = Buffer.from(base64Audio, 'base64');
        const tempFilePath = path.join(os.tmpdir(), `audio_${Date.now()}.webm`);
        fs.writeFileSync(tempFilePath, audioBuffer);

        console.log('🎙️ Sending audio to Groq Whisper...');
        const transcription = await groq.audio.transcriptions.create({
            file: fs.createReadStream(tempFilePath),
            model: "whisper-large-v3",
            response_format: "json",
            language: "en",
        });

        fs.unlinkSync(tempFilePath); // Cleanup temp file

        const latency = Date.now() - startTime;
        console.log(`✅ STT Complete in ${latency}ms: "${transcription.text}"`);

        return { text: transcription.text, latency };
    } catch (error) {
        console.error("❌ Groq STT Error:", error.message);
        throw error;
    }
}