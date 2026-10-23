import Groq from 'groq-sdk';
import 'dotenv/config';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function checkModels() {
    try {
        const models = await groq.models.list();
        console.log("✅ Tumhare account par yeh models active hain:");
        models.data.forEach(m => console.log("👉", m.id));
    } catch (error) {
        console.error("❌ Error fetching models:", error.message);
    }
}

checkModels();