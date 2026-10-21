import 'dotenv/config'; // Sabse pehli line: .env file ko load karega
import express from 'express';
import { WebSocketServer } from 'ws';
import { transcribeAudio } from './services/stt.js';

const app = express();
const PORT = process.env.PORT || 8080;

app.get('/health', (req, res) => res.json({ status: "Gateway is healthy 🚀" }));

const server = app.listen(PORT, () => {
    console.log(`🚀 REST API running on http://localhost:${PORT}`);
});

// WebSocket Server Setup
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    console.log('🟢 New Client Connected to Voice Gateway');

    ws.on('message', async (message) => {
        try {
            const event = JSON.parse(message);

            if (event.type === 'session_start') {
                console.log(`[Session] Started for tenant: ${event.tenantId}`);
            }
            else if (event.type === 'audio_chunk') {
                console.log('📥 Received audio chunk from frontend...');

                const result = await transcribeAudio(event.data);

                if (result && result.text) {
                    ws.send(JSON.stringify({
                        type: 'stt_transcript',
                        text: result.text,
                        latencyMs: result.latency
                    }));
                }
            }
        } catch (error) {
            console.error('❌ WebSocket Message Error:', error.message);
        }
    });

    ws.on('close', () => {
        console.log('🔴 Client Disconnected');
    });
});