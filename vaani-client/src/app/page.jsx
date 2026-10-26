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
    const [chatHistory, setChatHistory] = useState([]);
    const [alertMsg, setAlertMsg] = useState(null);

    const wsRef = useRef(null);
    const mediaRecorderRef = useRef(null);
    const intervalRef = useRef(null);
    const audioContextRef = useRef(null);
    const analyserRef = useRef(null);
    const volumeCheckIntervalRef = useRef(null);
    const speechDetectedRef = useRef(false);
    const isSpeakingRef = useRef(false);
    const isRecordingRef = useRef(false);
    const hasSpokenRef = useRef(false);
    const utteranceRef = useRef(null);
    const chatEndRef = useRef(null);
    const noSpeechTimeoutRef = useRef(null);

    // Keep refs in sync with state for callbacks
    useEffect(() => {
        isSpeakingRef.current = isSpeaking;
    }, [isSpeaking]);

    useEffect(() => {
        isRecordingRef.current = isRecording;
    }, [isRecording]);

    // Auto-scroll to bottom of chat
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [chatHistory, isThinking]);

    // Auto-dismiss alert after 8 seconds
    useEffect(() => {
        if (alertMsg) {
            const timer = setTimeout(() => {
                setAlertMsg(null);
            }, 8000);
            return () => clearTimeout(timer);
        }
    }, [alertMsg]);

    // 🔊 Agent Voice Synthesis (Browser TTS fallback)
    const speakAgentText = useCallback((text) => {
        if (typeof window === "undefined" || !('speechSynthesis' in window) || !text) return;

        try {
            window.speechSynthesis.cancel();
            window.speechSynthesis.resume();

            const utterance = new SpeechSynthesisUtterance(text);
            utteranceRef.current = utterance;

            const voices = window.speechSynthesis.getVoices();
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
                else if (event.type === "user_final_text") {
                    setChatHistory(prev => [...prev, { role: "user", text: event.text }]);
                }
                else if (event.type === "agent_thinking") {
                    setIsThinking(true);
                }
                else if (event.type === "agent_response") {
                    setIsThinking(false);
                    setAgentReply(event.text);
                    setLlmLatency(event.latencyMs);
                    setChatHistory(prev => [...prev, { role: "agent", text: event.text }]);
                }
                else if (event.type === "agent_audio") {
                    setIsSpeaking(true);
                    const audio = new Audio(`data:audio/mp3;base64,${event.audio}`);

                    audio.onended = () => {
                        setIsSpeaking(false);
                    };

                    audio.play().catch(e => {
                        console.error("Audio play error:", e);
                        setIsSpeaking(false);
                    });
                }
                else if (event.type === "agent_audio_error") {
                    console.warn("⚠️ ElevenLabs unavailable, using browser TTS as fallback");
                    if (event.text) {
                        speakAgentText(event.text);
                    }
                }
            } catch (err) {
                console.error("Failed to parse WS message", err);
            }
        };

        ws.onclose = () => {
            console.log("🔴 Disconnected from Voice Gateway");
            setIsConnected(false);
        };

        ws.onerror = () => { };

        wsRef.current = ws;

        return () => {
            ws.close();
            if (intervalRef.current) clearInterval(intervalRef.current);
            if (volumeCheckIntervalRef.current) clearInterval(volumeCheckIntervalRef.current);
            if (noSpeechTimeoutRef.current) clearTimeout(noSpeechTimeoutRef.current);
            if (typeof window !== "undefined" && 'speechSynthesis' in window) {
                window.speechSynthesis.cancel();
            }
        };
    }, [speakAgentText]);

    // ═══════════════════════════════════════════════════════════
    //  Mic Recording & Permissions Logic
    // ═══════════════════════════════════════════════════════════
    const startRecording = async () => {
        setAlertMsg(null);
        hasSpokenRef.current = false;
        if (noSpeechTimeoutRef.current) {
            clearTimeout(noSpeechTimeoutRef.current);
            noSpeechTimeoutRef.current = null;
        }

        // Audio Context unlock on click
        if (typeof window !== "undefined" && 'speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const unlock = new SpeechSynthesisUtterance('');
            unlock.volume = 0;
            window.speechSynthesis.speak(unlock);
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                }
            });

            const audioTrack = stream.getAudioTracks()[0];
            if (audioTrack) {
                if (audioTrack.muted) {
                    setAlertMsg("Mic muted hai! Kripya apna mic check karein.");
                }
                audioTrack.onmute = () => {
                    setAlertMsg("Mic muted hai! Kripya apna mic check karein.");
                };
                audioTrack.onunmute = () => {
                    setAlertMsg(null);
                };
            }

            setIsRecording(true);
            isRecordingRef.current = true;
            speechDetectedRef.current = false;
            hasSpokenRef.current = false;

            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            const audioCtx = new AudioContextClass();
            const source = audioCtx.createMediaStreamSource(stream);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);

            audioContextRef.current = audioCtx;
            analyserRef.current = analyser;

            const dataArray = new Uint8Array(analyser.frequencyBinCount);

            volumeCheckIntervalRef.current = setInterval(() => {
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
                setMicVolume(Math.min(100, Math.round((avg / 25) * 100)));

                // Sensitive threshold: agar thodi si bhi aawaz aayi toh speech confirm
                if (avg > 3) {
                    speechDetectedRef.current = true;
                    hasSpokenRef.current = true;
                    // Jaise hi aawaz detect ho, silence alert clear karo
                    setAlertMsg(prev => (prev?.includes("aawaz nahi aa rahi") ? null : prev));
                }
            }, 80);

            const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });

            mediaRecorder.ondataavailable = (e) => {
                if (
                    e.data.size > 0 &&
                    wsRef.current?.readyState === WebSocket.OPEN &&
                    !isSpeakingRef.current
                ) {
                    // Send if speech detected or chunk has substantial audio data
                    if (speechDetectedRef.current || e.data.size > 10000) {
                        const reader = new FileReader();
                        reader.readAsDataURL(e.data);
                        reader.onloadend = () => {
                            const base64String = reader.result.split(",")[1];
                            if (wsRef.current?.readyState === WebSocket.OPEN) {
                                wsRef.current.send(JSON.stringify({
                                    type: "audio_chunk",
                                    data: base64String
                                }));
                            }
                        };
                    } else {
                        console.log("🔇 Silence skipped, chunk dropped");
                    }
                }
                speechDetectedRef.current = false;
            };

            mediaRecorder.start();
            mediaRecorderRef.current = mediaRecorder;

            // 3 second interval slice taaki har chunk complete WebM header ke sath ho
            intervalRef.current = setInterval(() => {
                if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
                    mediaRecorderRef.current.stop();
                    mediaRecorderRef.current.start();
                }
            }, 3000);

            // 🛑 4 second tak koi aawaz nahi aayi (mic off/muted/silent), toh alert show karo!
            noSpeechTimeoutRef.current = setTimeout(() => {
                if (isRecordingRef.current && !hasSpokenRef.current) {
                    setAlertMsg("Mic on hai par aawaz nahi aa rahi. Kripya apna mic check karein!");
                }
            }, 4000);

        } catch (err) {
            console.error("Mic Access Error:", err);
            setIsRecording(false);
            isRecordingRef.current = false;
            if (err.name === 'NotAllowedError') {
                setAlertMsg("Mic ki permission denied hai! Kripya browser settings mein jaakar mic allow karein.");
            } else if (err.name === 'NotFoundError') {
                setAlertMsg("Koi microphone nahi mila! Kripya apna device check karein.");
            } else {
                setAlertMsg("Mic access karne mein problem aayi: " + err.message);
            }
        }
    };

    const stopRecording = () => {
        setIsRecording(false);
        isRecordingRef.current = false;
        hasSpokenRef.current = false;
        speechDetectedRef.current = false;
        setMicVolume(0);
        setAlertMsg(null); // Mic off hote hi alert clear karo

        if (noSpeechTimeoutRef.current) {
            clearTimeout(noSpeechTimeoutRef.current);
            noSpeechTimeoutRef.current = null;
        }
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
            } catch (e) { }
            audioContextRef.current = null;
        }
    };

    const toggleRecording = () => {
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    };

    // Reset conversation
    const handleReset = () => {
        setTranscript("");
        setAgentReply("");
        setIsThinking(false);
        setLatency(null);
        setLlmLatency(null);
        setChatHistory([]);
        setAlertMsg(null);
        if (typeof window !== "undefined" && 'speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }
        setIsSpeaking(false);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "session_start", tenantId: "tenant_123" }));
        }
    };

    return (
        <main className="min-h-screen bg-[#f8fbff] flex flex-col items-center justify-center p-4 md:p-6 text-slate-800 selection:bg-blue-500 selection:text-white font-sans relative">

            {/* 🚨 Alert Box for Errors (Fixed Top Toast Notification) */}
            {alertMsg && (
                <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 max-w-md w-[92%] bg-rose-50/95 backdrop-blur border border-rose-200 text-rose-600 px-4 py-3 rounded-2xl flex items-start space-x-3 shadow-xl animate-fade-in-up">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 mt-0.5 shrink-0">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div className="flex-1 text-sm font-medium">
                        {alertMsg}
                    </div>
                    <button onClick={() => setAlertMsg(null)} className="text-rose-400 hover:text-rose-600">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            )}

            {/* ✨ Premium Header */}
            <div className="text-center mb-6">
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white border border-blue-100 shadow-sm text-xs font-semibold text-slate-500 mb-5">
                    <span className="relative flex h-2.5 w-2.5">
                        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isConnected ? 'bg-emerald-400' : 'bg-rose-400'}`}></span>
                        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isConnected ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
                    </span>
                    {isConnected ? "Gateway Connected" : "Connecting..."}
                </div>

                <h1 className="text-4xl md:text-5xl font-black tracking-tight bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-3 drop-shadow-sm">
                    Vaani Voice Agent
                </h1>
                <p className="text-slate-500 text-sm md:text-base max-w-md mx-auto font-medium">
                    Natural Hindi & English Voice Assistant with instant low-latency responses.
                </p>
            </div>

            {/* 🌊 Premium White-Blue Chat UI */}
            <div className="w-full max-w-4xl mx-auto bg-white border border-blue-50 rounded-[2rem] h-[480px] flex flex-col p-6 overflow-y-auto shadow-[0_20px_60px_-15px_rgba(37,99,235,0.1)]">
                {chatHistory.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-blue-300 space-y-4">
                        <svg className="w-16 h-16 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                        <p className="font-medium text-lg">Mic on karo aur Vaani se baat karna shuru karo...</p>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {chatHistory.map((msg, index) => (
                            <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>

                                {/* 🎙️ Agent Avatar & Speaking Wave */}
                                {msg.role === 'agent' && (
                                    <div className="flex items-end mr-3 mb-1">
                                        {isSpeaking && index === chatHistory.length - 1 ? (
                                            <div className="flex items-end space-x-1 h-6 w-8 pb-2">
                                                <div className="w-[4px] bg-blue-600 rounded-full wave-bar"></div>
                                                <div className="w-[4px] bg-blue-500 rounded-full wave-bar"></div>
                                                <div className="w-[4px] bg-blue-400 rounded-full wave-bar"></div>
                                                <div className="w-[4px] bg-blue-300 rounded-full wave-bar"></div>
                                            </div>
                                        ) : (
                                            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-500 shadow-md flex items-center justify-center text-white font-bold text-xs">
                                                V
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* 💬 Chat Bubbles */}
                                <div className={`max-w-[75%] p-4 rounded-3xl text-[15px] md:text-[16px] leading-relaxed shadow-sm ${msg.role === 'user'
                                    ? 'bg-blue-600 text-white rounded-br-sm shadow-blue-600/20'
                                    : 'bg-[#f4f7ff] border border-blue-100/50 text-slate-700 rounded-bl-sm shadow-sm'
                                    }`}>
                                    {msg.text}
                                </div>
                            </div>
                        ))}

                        {/* ⏳ Thinking Indicator */}
                        {isThinking && (
                            <div className="flex justify-start">
                                <div className="flex items-end mr-3 mb-1">
                                    <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center">
                                        <span className="animate-pulse text-blue-500 text-xl font-bold">...</span>
                                    </div>
                                </div>
                                <div className="max-w-[75%] px-6 py-3 rounded-3xl bg-[#f4f7ff] border border-blue-50 text-blue-400 text-sm italic rounded-bl-sm flex items-center space-x-2">
                                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"></div>
                                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                                </div>
                            </div>
                        )}
                        <div ref={chatEndRef} />
                    </div>
                )}
            </div>

            {/* 🎙️ Central Voice Button & Visualizer */}
            <div className="relative flex flex-col items-center justify-center mt-8 mb-4">
                {/* Clean Glow Effect for Light Theme */}
                <div className={`absolute w-36 h-36 rounded-full blur-3xl transition-all duration-500 ${isSpeaking ? "bg-emerald-400/20 scale-125" :
                    isRecording ? "bg-rose-400/20 scale-110" : "bg-blue-400/10"
                    }`} />

                <button
                    id="mic-toggle-btn"
                    onClick={toggleRecording}
                    disabled={!isConnected}
                    aria-label={isRecording ? "Stop Listening" : "Start Speaking"}
                    className={`relative z-10 group flex items-center justify-center w-24 h-24 rounded-full transition-all duration-300 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.2)] ${!isConnected ? "bg-slate-200 cursor-not-allowed text-slate-400" :
                        isSpeaking ? "bg-emerald-500 hover:bg-emerald-600 ring-4 ring-emerald-100 scale-105" :
                            isRecording ? "bg-rose-500 hover:bg-rose-600 ring-4 ring-rose-100 scale-105" :
                                "bg-blue-600 hover:bg-blue-700 hover:scale-105 ring-4 ring-blue-50"
                        }`}
                >
                    {isRecording && !isSpeaking && (
                        <div className="absolute inset-0 rounded-full border-4 border-rose-300 animate-ping opacity-50"></div>
                    )}

                    {isRecording ? (
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-10 h-10 text-white">
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
                        <div className="flex items-center space-x-2 text-emerald-600 font-semibold text-sm">
                            <span>Vaani is speaking...</span>
                        </div>
                    ) : isThinking ? (
                        <div className="flex items-center space-x-2 text-blue-500 font-semibold text-sm animate-pulse">
                            <span>Vaani is thinking...</span>
                        </div>
                    ) : isRecording ? (
                        <div className="flex flex-col items-center space-y-2">
                            <span className="text-rose-500 text-sm font-semibold">Listening... speak naturally</span>
                            <div className="w-32 h-1.5 bg-rose-100 rounded-full overflow-hidden">
                                <div className="h-full bg-rose-500 transition-all duration-75" style={{ width: `${micVolume}%` }} />
                            </div>
                        </div>
                    ) : (
                        <span className="text-slate-500 font-medium text-sm">Click mic to start talking</span>
                    )}
                </div>
            </div>

            {/* 🔄 Action Bar */}
            <div className="mt-2">
                <button
                    onClick={handleReset}
                    className="px-5 py-2.5 rounded-xl bg-white border border-slate-200 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 text-slate-600 font-medium text-sm transition-all flex items-center gap-2 shadow-sm"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                    </svg>
                    New Conversation
                </button>
            </div>
        </main>
    );
}
