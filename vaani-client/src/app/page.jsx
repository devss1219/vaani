"use client";

import { useState, useRef, useEffect, useCallback } from "react";

export default function Home() {
    const [isConnected, setIsConnected] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [transcript, setTranscript] = useState("");
    const [agentReply, setAgentReply] = useState("");
    const [isThinking, setIsThinking] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [latency, setLatency] = useState(null);
    const [llmLatency, setLlmLatency] = useState(null);
    const [micVolume, setMicVolume] = useState(0);

    const wsRef = useRef(null);
    const mediaRecorderRef = useRef(null);
    const intervalRef = useRef(null);
    const audioContextRef = useRef(null);
    const analyserRef = useRef(null);
    const volumeCheckIntervalRef = useRef(null);
    const speechDetectedRef = useRef(false);
    const isSpeakingRef = useRef(false);
    const utteranceRef = useRef(null);

    // Keep ref in sync with state for callbacks
    useEffect(() => {
        isSpeakingRef.current = isSpeaking;
    }, [isSpeaking]);

    // 🔊 Agent Voice Synthesis (Browser TTS fallback — ElevenLabs ke bina)
    const speakAgentText = useCallback((text) => {
        if (typeof window === "undefined" || !('speechSynthesis' in window) || !text) return;

        try {
            window.speechSynthesis.cancel();
            window.speechSynthesis.resume();

            const utterance = new SpeechSynthesisUtterance(text);
            utteranceRef.current = utterance;

            const voices = window.speechSynthesis.getVoices();

            // Google neural voices prefer karo — ye sabse smooth hoti hain
            // Priority: Google Hindi > Google en-IN > Google UK Female > Google US English > any en-IN > any en
            const selectedVoice =
                voices.find(v => v.name === 'Google हिन्दी') ||
                voices.find(v => v.name === 'Google Hindi') ||
                voices.find(v => v.name.includes('Google') && (v.lang === 'hi-IN' || v.lang === 'hi_IN')) ||
                voices.find(v => v.name.includes('Google') && (v.lang === 'en-IN' || v.lang === 'en_IN')) ||
                voices.find(v => v.name === 'Google UK English Female') ||
                voices.find(v => v.name === 'Google US English') ||
                voices.find(v => v.name.includes('Google') && v.lang.startsWith('en')) ||
                voices.find(v => v.lang === 'en-IN' || v.lang === 'en_IN') ||
                voices.find(v => v.lang.startsWith('en')) ||
                voices[0];

            if (selectedVoice) {
                utterance.voice = selectedVoice;
                utterance.lang = selectedVoice.lang || 'en-IN';
            } else {
                utterance.lang = 'en-IN';
            }

            // Slightly slower = clearer Hinglish pronunciation
            utterance.rate = 0.95;
            utterance.pitch = 1.05;
            utterance.volume = 1.0;

            utterance.onstart = () => {
                setIsSpeaking(true);
                isSpeakingRef.current = true;
            };

            utterance.onend = () => {
                setIsSpeaking(false);
                isSpeakingRef.current = false;
                utteranceRef.current = null;
            };

            utterance.onerror = () => {
                setIsSpeaking(false);
                isSpeakingRef.current = false;
                utteranceRef.current = null;
            };

            window.speechSynthesis.speak(utterance);
        } catch (e) {
            console.error("SpeechSynthesis error:", e);
            setIsSpeaking(false);
            isSpeakingRef.current = false;
        }
    }, []);

    // ═══════════════════════════════════════════════════════════
    //  WebSocket Connection
    // ═══════════════════════════════════════════════════════════
    useEffect(() => {
        if (typeof window !== "undefined" && 'speechSynthesis' in window) {
            window.speechSynthesis.getVoices();
            window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
        }

        const ws = new WebSocket("ws://localhost:8080");

        ws.onopen = () => {
            console.log("✅ Connected to Voice Gateway");
            setIsConnected(true);
            ws.send(JSON.stringify({ type: "session_start", tenantId: "tenant_123" }));
        };

        ws.onmessage = (message) => {
            try {
                const event = JSON.parse(message.data);

                if (event.type === "stt_transcript") {
                    setTranscript(prev => (prev ? prev + " " + event.text : event.text));
                    setLatency(event.latencyMs);
                }
                else if (event.type === "agent_thinking") {
                    setIsThinking(true);
                }
                else if (event.type === "agent_response") {
                    setIsThinking(false);
                    setAgentReply(event.text);
                    setLlmLatency(event.latencyMs);
                    // Purana window.speechSynthesis hata diya hai, ab agent_audio event ka wait karenge
                }
                // 🔊 NAYA EVENT: Backend se aayi premium aawaz ko play karna
                else if (event.type === "agent_audio") {
                    const audio = new Audio(`data:audio/mp3;base64,${event.audio}`);
                    audio.play().catch(e => console.error("Audio play error:", e));
                }
                // ⚠️ FALLBACK: ElevenLabs fail hone par browser TTS use karo
                else if (event.type === "agent_audio_error") {
                    console.warn("⚠️ ElevenLabs unavailable, using browser TTS as fallback");
                    speakAgentText(event.text);
                }
            } catch (err) {
                console.error("Failed to parse WS message", err);
            }
        };

        ws.onclose = () => {
            console.log("🔴 Disconnected from Voice Gateway");
            setIsConnected(false);
        };

        ws.onerror = () => {};

        wsRef.current = ws;

        return () => {
            ws.close();
            if (intervalRef.current) clearInterval(intervalRef.current);
            if (volumeCheckIntervalRef.current) clearInterval(volumeCheckIntervalRef.current);
            if (typeof window !== "undefined" && 'speechSynthesis' in window) {
                window.speechSynthesis.cancel();
            }
        };
    }, [speakAgentText]);

    // ═══════════════════════════════════════════════════════════
    //  Stop Recording Helper
    // ═══════════════════════════════════════════════════════════
    const stopRecording = () => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
        if (volumeCheckIntervalRef.current) {
            clearInterval(volumeCheckIntervalRef.current);
            volumeCheckIntervalRef.current = null;
        }
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
            try {
                mediaRecorderRef.current.stop();
                mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
            } catch (e) {
                console.error("Error stopping recorder", e);
            }
            mediaRecorderRef.current = null;
        }
        if (audioContextRef.current) {
            try {
                audioContextRef.current.close();
            } catch (e) {}
            audioContextRef.current = null;
        }
        setIsRecording(false);
        setMicVolume(0);
        speechDetectedRef.current = false;
    };

    // ═══════════════════════════════════════════════════════════
    //  Recording Toggle with Silence & Echo Prevention
    // ═══════════════════════════════════════════════════════════
    const toggleRecording = async () => {
        if (isRecording) {
            stopRecording();
        } else {
            try {
                setTranscript("");
                setAgentReply("");
                setIsThinking(false);
                setLatency(null);
                setLlmLatency(null);

                // Unlock audio context on click
                if (typeof window !== "undefined" && 'speechSynthesis' in window) {
                    window.speechSynthesis.cancel();
                    const unlock = new SpeechSynthesisUtterance('');
                    unlock.volume = 0;
                    window.speechSynthesis.speak(unlock);
                }

                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                    }
                });

                // Setup Web Audio API volume monitoring (VAD)
                const AudioContextClass = window.AudioContext || window.webkitAudioContext;
                const audioCtx = new AudioContextClass();
                const source = audioCtx.createMediaStreamSource(stream);
                const analyser = audioCtx.createAnalyser();
                analyser.fftSize = 256;
                source.connect(analyser);

                audioContextRef.current = audioCtx;
                analyserRef.current = analyser;
                speechDetectedRef.current = false;

                const dataArray = new Uint8Array(analyser.frequencyBinCount);

                // Monitor volume continuously (every 80ms)
                volumeCheckIntervalRef.current = setInterval(() => {
                    // Agar Vaani bol rahi hai toh mic input ko echo manke ignore karo
                    if (isSpeakingRef.current) {
                        setMicVolume(0);
                        return;
                    }

                    analyser.getByteFrequencyData(dataArray);
                    let sum = 0;
                    for (let i = 0; i < dataArray.length; i++) {
                        sum += dataArray[i];
                    }
                    const avg = sum / dataArray.length;
                    setMicVolume(Math.min(100, Math.round((avg / 60) * 100)));

                    // Threshold: ambient noise 5-12 hota hai, clear speech 20+
                    // 20 se kam = background noise / AC / fan ignore karo
                    if (avg > 20) {
                        speechDetectedRef.current = true;
                    }
                }, 80);

                const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });

                mediaRecorder.ondataavailable = (event) => {
                    // Sirf tab bhejo agar agent nahi bol raha hai aur speech detect hui hai
                    if (
                        event.data.size > 0 &&
                        wsRef.current?.readyState === WebSocket.OPEN &&
                        !isSpeakingRef.current &&
                        speechDetectedRef.current
                    ) {
                        const reader = new FileReader();
                        reader.readAsDataURL(event.data);
                        reader.onloadend = () => {
                            const base64String = reader.result.split(",")[1];
                            wsRef.current.send(JSON.stringify({
                                type: "audio_chunk",
                                data: base64String
                            }));
                        };
                    } else if (!speechDetectedRef.current) {
                        console.log("🔇 Silence skipped, chunk dropped");
                    }
                    // Reset speech flag for next slice
                    speechDetectedRef.current = false;
                };

                mediaRecorder.start();
                mediaRecorderRef.current = mediaRecorder;
                setIsRecording(true);

                // Har 3 second pe slice lo — longer slice = better context for Whisper
                intervalRef.current = setInterval(() => {
                    if (mediaRecorder.state === "recording") {
                        mediaRecorder.stop();
                        mediaRecorder.start();
                    }
                }, 3000);

            } catch (err) {
                console.error("Mic error:", err);
                alert("Please allow microphone access!");
                stopRecording();
            }
        }
    };

    // Reset conversation
    const handleReset = () => {
        setTranscript("");
        setAgentReply("");
        setIsThinking(false);
        setLatency(null);
        setLlmLatency(null);
        if (typeof window !== "undefined" && 'speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }
        setIsSpeaking(false);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "session_start", tenantId: "tenant_123" }));
        }
    };

    return (
        <main className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-slate-100 selection:bg-indigo-500 selection:text-white">
            {/* Header */}
            <div className="text-center mb-8">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900/80 border border-slate-800 text-xs font-medium text-slate-400 mb-4">
                    <span className="relative flex h-2 w-2">
                        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isConnected ? 'bg-emerald-400' : 'bg-rose-400'}`}></span>
                        <span className={`relative inline-flex rounded-full h-2 w-2 ${isConnected ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
                    </span>
                    {isConnected ? "Gateway Connected" : "Connecting..."}
                </div>

                <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight bg-gradient-to-r from-blue-400 via-indigo-300 to-purple-400 bg-clip-text text-transparent mb-3">
                    Vaani Voice Agent
                </h1>
                <p className="text-slate-400 text-base md:text-lg max-w-md mx-auto">
                    Natural Hindi & English Voice Assistant with instant low-latency responses.
                </p>
            </div>

            {/* Central Voice Button & Wave */}
            <div className="relative flex flex-col items-center justify-center my-6">
                {/* Glow ring */}
                <div className={`absolute w-36 h-36 rounded-full blur-2xl transition-all duration-500 ${
                    isSpeaking ? "bg-emerald-500/30 scale-125" :
                    isRecording ? "bg-rose-500/30 scale-110" :
                    "bg-indigo-500/20"
                }`} />

                <button
                    id="mic-toggle-btn"
                    onClick={toggleRecording}
                    disabled={!isConnected}
                    aria-label={isRecording ? "Stop Listening" : "Start Speaking"}
                    className={`relative z-10 group flex items-center justify-center w-28 h-28 rounded-full transition-all duration-300 shadow-2xl ${
                        !isConnected ? "bg-slate-800 cursor-not-allowed opacity-50" :
                        isSpeaking ? "bg-emerald-600 hover:bg-emerald-500 ring-4 ring-emerald-400/40 scale-105" :
                        isRecording ? "bg-rose-600 hover:bg-rose-500 ring-4 ring-rose-400/40 scale-105" :
                        "bg-indigo-600 hover:bg-indigo-500 hover:scale-105 ring-4 ring-indigo-500/30"
                    }`}
                >
                    {isRecording && !isSpeaking && (
                        <div className="absolute inset-0 rounded-full border-4 border-rose-400 animate-ping opacity-60"></div>
                    )}

                    {isRecording ? (
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-10 h-10 text-white">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 7.5A2.25 2.25 0 0 1 7.5 5.25h9a2.25 2.25 0 0 1 2.25 2.25v9a2.25 2.25 0 0 1-2.25 2.25h-9a2.25 2.25 0 0 1-2.25-2.25v-9Z" />
                        </svg>
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-10 h-10 text-white">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
                        </svg>
                    )}
                </button>

                {/* State Tag */}
                <div className="mt-5 text-center min-h-[32px] flex items-center justify-center">
                    {isSpeaking ? (
                        <div className="flex items-center space-x-2 text-emerald-400 font-medium text-sm animate-pulse">
                            <span className="flex space-x-1 items-end h-4">
                                <span className="w-1 bg-emerald-400 h-2 animate-bounce" style={{ animationDelay: '0ms' }}></span>
                                <span className="w-1 bg-emerald-400 h-4 animate-bounce" style={{ animationDelay: '150ms' }}></span>
                                <span className="w-1 bg-emerald-400 h-3 animate-bounce" style={{ animationDelay: '300ms' }}></span>
                            </span>
                            <span>Vaani is speaking...</span>
                        </div>
                    ) : isThinking ? (
                        <div className="flex items-center space-x-2 text-amber-300 font-medium text-sm animate-pulse">
                            <div className="w-2 h-2 rounded-full bg-amber-400 animate-ping"></div>
                            <span>Vaani is thinking...</span>
                        </div>
                    ) : isRecording ? (
                        <div className="flex flex-col items-center space-y-1">
                            <span className="text-rose-400 text-sm font-medium">Listening... speak naturally</span>
                            {/* Live volume level meter */}
                            <div className="w-32 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-emerald-500 to-rose-500 transition-all duration-75"
                                    style={{ width: `${micVolume}%` }}
                                />
                            </div>
                        </div>
                    ) : (
                        <span className="text-slate-400 text-sm">Click mic to start talking</span>
                    )}
                </div>
            </div>

            {/* Transcript & Response Cards */}
            <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                {/* User Card */}
                <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-6 shadow-xl backdrop-blur flex flex-col justify-between min-h-[200px] relative transition-all duration-300 hover:border-slate-700">
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                                You Said (Live Transcript)
                            </span>
                        </div>
                        {transcript ? (
                            <p className="text-lg leading-relaxed text-slate-100 font-normal">
                                {transcript}
                            </p>
                        ) : (
                            <div className="h-28 flex items-center justify-center text-slate-500 text-sm italic">
                                {isRecording ? "Listening to your voice..." : "Click mic and speak in Hindi or English..."}
                            </div>
                        )}
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between text-xs font-mono text-slate-400">
                        <span>Speed</span>
                        {latency !== null ? (
                            <span className="text-indigo-400 font-semibold">STT: {latency}ms</span>
                        ) : (
                            <span className="text-slate-600">—</span>
                        )}
                    </div>
                </div>

                {/* Agent Card */}
                <div className="bg-gradient-to-br from-slate-900/90 to-indigo-950/30 border border-indigo-500/20 rounded-2xl p-6 shadow-xl backdrop-blur flex flex-col justify-between min-h-[200px] relative transition-all duration-300 hover:border-indigo-500/40">
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                                Agent Vaani
                            </span>
                            {agentReply && (
                                <button
                                    onClick={() => speakAgentText(agentReply)}
                                    title="Replay Voice"
                                    className="text-xs px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
                                >
                                    🔊 Replay
                                </button>
                            )}
                        </div>
                        {agentReply ? (
                            <p className="text-lg leading-relaxed text-emerald-200 font-medium">
                                {agentReply}
                            </p>
                        ) : isThinking ? (
                            <div className="h-28 flex items-center justify-center text-amber-300 text-sm font-medium animate-pulse">
                                Vaani is drafting a reply...
                            </div>
                        ) : (
                            <div className="h-28 flex items-center justify-center text-slate-500 text-sm italic">
                                Vaani will reply here...
                            </div>
                        )}
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between text-xs font-mono text-slate-400">
                        <span>AI Latency</span>
                        {llmLatency !== null && llmLatency > 0 ? (
                            <span className="text-emerald-400 font-semibold">LLM: {llmLatency}ms</span>
                        ) : (
                            <span className="text-slate-600">—</span>
                        )}
                    </div>
                </div>
            </div>

            {/* Action Bar */}
            <div className="mt-8 flex items-center gap-4 text-xs text-slate-400">
                <button
                    onClick={handleReset}
                    className="px-4 py-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 hover:text-slate-200 transition-colors flex items-center gap-1.5 shadow-sm"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                    </svg>
                    New Conversation
                </button>
            </div>
        </main>
    );
}