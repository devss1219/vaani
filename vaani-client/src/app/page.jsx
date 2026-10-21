"use client";

import { useState, useRef, useEffect } from "react";

export default function Home() {
    const [isConnected, setIsConnected] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [transcript, setTranscript] = useState("");
    const [latency, setLatency] = useState(null);

    const wsRef = useRef(null);
    const mediaRecorderRef = useRef(null);

    useEffect(() => {
        const ws = new WebSocket("ws://localhost:8080");

        ws.onopen = () => {
            console.log("Connected to Voice Gateway");
            setIsConnected(true);
            ws.send(JSON.stringify({ type: "session_start", tenantId: "tenant_123" }));
        };

        ws.onmessage = (message) => {
            const event = JSON.parse(message.data);
            if (event.type === "stt_transcript") {
                setTranscript((prev) => prev + " " + event.text);
                setLatency(event.latencyMs);
            }
        };

        ws.onclose = () => setIsConnected(false);
        wsRef.current = ws;

        return () => {
            // FIX 1: Sirf tabhi close karo jab connection actual mein ho
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.close();
            }
        };
    }, []);

    const toggleRecording = async () => {
        if (isRecording) {
            if (mediaRecorderRef.current) {
                mediaRecorderRef.current.stop();
                mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
            }
            setIsRecording(false);
        } else {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });

                mediaRecorder.ondataavailable = (event) => {
                    if (event.data.size > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
                        console.log("🎤 Audio chunk ready, size:", event.data.size); // Yeh line bataegi mic chal raha hai ya nahi
                        const reader = new FileReader();
                        reader.readAsDataURL(event.data);
                        reader.onloadend = () => {
                            const base64String = reader.result.split(",")[1];
                            console.log("🚀 Sending audio to backend..."); // Yeh line bataegi data send ho raha hai
                            wsRef.current?.send(JSON.stringify({ type: "audio_chunk", data: base64String }));
                        };
                    }
                };

                // FIX 2: 3 seconds ka chunk bhej rahe hain taaki STT ko clear aawaz mile
                mediaRecorder.start(3000);
                mediaRecorderRef.current = mediaRecorder;
                setIsRecording(true);
            } catch (err) {
                console.error("Mic error:", err);
                alert("Please allow microphone access!");
            }
        }
    };

    return (
        <main className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-slate-200">
            <div className="text-center mb-10">
                <h1 className="text-5xl font-extrabold tracking-tight bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent mb-4">
                    Vaani Voice Agent
                </h1>
                <p className="text-slate-400 text-lg">Speak naturally, and the agent will transcribe.</p>

                <div className="mt-4 flex items-center justify-center space-x-2">
                    <div className={`w-3 h-3 rounded-full ${isConnected ? "bg-emerald-500 shadow-[0_0_10px_#10b981]" : "bg-rose-500"}`}></div>
                    <span className="text-sm font-medium text-slate-300">
                        {isConnected ? "Gateway Connected" : "Connecting to Gateway..."}
                    </span>
                </div>
            </div>

            <button
                onClick={toggleRecording}
                disabled={!isConnected}
                className={`relative group flex items-center justify-center w-24 h-24 rounded-full transition-all duration-300 shadow-xl
          ${!isConnected ? "bg-slate-800 cursor-not-allowed opacity-50" :
                        isRecording ? "bg-rose-500 hover:bg-rose-600 scale-105" : "bg-indigo-600 hover:bg-indigo-500 hover:scale-105"
                    }`}
            >
                {isRecording && (
                    <div className="absolute inset-0 rounded-full border-4 border-rose-400 animate-ping opacity-75"></div>
                )}
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-10 h-10 text-white z-10">
                    {isRecording ? (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 7.5A2.25 2.25 0 0 1 7.5 5.25h9a2.25 2.25 0 0 1 2.25 2.25v9a2.25 2.25 0 0 1-2.25 2.25h-9a2.25 2.25 0 0 1-2.25-2.25v-9Z" />
                    ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
                    )}
                </svg>
            </button>

            <div className="mt-12 w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl min-h-[250px] relative">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">Live Transcript</h3>
                {transcript ? (
                    <p className="text-xl leading-relaxed text-slate-100 font-light">
                        {transcript}
                    </p>
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-slate-600 italic">
                        Waiting for audio...
                    </div>
                )}
            </div>

            {latency && (
                <div className="mt-6 flex items-center space-x-2 bg-slate-900 border border-indigo-500/30 px-4 py-2 rounded-full text-indigo-400 text-sm font-mono">
                    <span>⚡ STT Latency:</span>
                    <span className="font-bold">{latency}ms</span>
                </div>
            )}
        </main>
    );
}