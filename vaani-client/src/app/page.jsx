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
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

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
    const handleMouseMove = (e) => {
        setMousePos({ x: e.clientX, y: e.clientY });
    };

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

        const ws = new WebSocket("wss://vaani-v7q6.onrender.com");

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
        <main className="h-screen w-full bg-[#ebf0f5] relative overflow-hidden flex flex-col justify-center items-center px-4 md:px-8 xl:px-12 text-slate-800 font-sans selection:bg-cyan-200 selection:text-cyan-900">

            {/* 🌟 Background: Subtle Dot Grid & Corner Glows */}
            <div className="absolute inset-0 z-0 bg-[radial-gradient(#d1d5db_1px,transparent_1px)] [background-size:24px_24px] opacity-50"></div>
            <div className="absolute top-[0%] left-[-10%] w-[600px] h-[600px] bg-cyan-200/20 rounded-full filter blur-[100px] pointer-events-none"></div>
            <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] bg-indigo-200/20 rounded-full filter blur-[100px] pointer-events-none"></div>

            {/* 🚨 Alert Box (Absolute Top) */}
            {alertMsg && (
                <div className="absolute top-6 z-50 max-w-2xl w-full bg-white/90 backdrop-blur-xl border border-rose-100 text-rose-600 px-5 py-4 rounded-2xl flex items-start space-x-3 shadow-[8px_8px_16px_#d1d9e6,-8px_-8px_16px_#ffffff] animate-fade-in-up">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5 mt-0.5 shrink-0 text-rose-500">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div className="flex-1 text-sm font-semibold">{alertMsg}</div>
                    <button onClick={() => setAlertMsg(null)} className="text-rose-400 hover:text-rose-600 transition-colors">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>
            )}

            {/* ✨ Header (Compact & Centered above the grid) */}
            <div className="relative z-10 text-center mb-8 max-w-3xl shrink-0 mt-4">
                <h1 className="text-3xl md:text-4xl font-black tracking-tight text-slate-800 mb-2 drop-shadow-sm">
                    Vaani <span className="text-slate-400">Enterprise</span>
                </h1>
                <p className="text-slate-500 font-medium text-xs md:text-sm max-w-xl mx-auto leading-relaxed">
                    Multilingual Voice AI for Sales, Support, and Collections. Experience context-aware conversations powered by real-time CRM Integration.
                </p>
            </div>

            {/* 🌟 3-Panel Neumorphic Layout (FIXED HEIGHT h-[550px] so it doesn't stretch!) */}
            <div className="w-full max-w-[1250px] relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-6 xl:gap-8 h-[550px] shrink-0">

                {/* --- PANEL 1: Active Workflows --- */}
                <div className="lg:col-span-3 bg-[#ebf0f5] rounded-[2rem] p-5 shadow-[10px_10px_20px_#d1d9e6,-10px_-10px_20px_#ffffff] flex flex-col h-full overflow-hidden border border-white/40">
                    <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-4 px-2 shrink-0">Active Workflows</h3>

                    {/* Inner Scroll only */}
                    <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-2">
                        {/* Selected Item */}
                        <button className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-2xl bg-[#0f1115] text-white shadow-[0_10px_25px_rgba(0,0,0,0.2)] transition-all">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 shrink-0 text-white"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" /></svg>
                            <div className="flex-1">
                                <div className="font-bold text-[13px]">Cart Recovery</div>
                                <div className="text-[9px] text-slate-400 mt-0.5 font-medium">E-commerce calls</div>
                            </div>
                        </button>

                        {/* Other Items */}
                        {[
                            { title: "Loan Sales", desc: "Collections & Sales", icon: "M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z", active: false },
                            { title: "Support Helpdesk", desc: "B2B Queries", icon: "M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z", active: false },
                            { title: "Appointments", desc: "Clinic Bookings", icon: "M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5", active: false },
                            { title: "AI Sachiv", desc: "Citizen Services", icon: "M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0 0 12 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75Z", active: false },
                            { title: "Lead Qualification", desc: "SaaS Inbound", icon: "M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z", active: false },
                            { title: "Billing Reminders", desc: "Invoice Dunning", icon: "M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z", active: false }
                        ].map((item, idx) => (
                            <button key={idx} className="w-full text-left flex items-center gap-3 px-4 py-2.5 rounded-2xl text-slate-500 hover:bg-slate-200/50 transition-all group">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 shrink-0"><path strokeLinecap="round" strokeLinejoin="round" d={item.icon} /></svg>
                                <div className="flex-1">
                                    <div className="font-bold text-[13px] text-slate-700">{item.title}</div>
                                    <div className="text-[9px] text-slate-400 font-medium">{item.desc}</div>
                                </div>
                                <div className={`w-1.5 h-1.5 rounded-full ${item.active ? 'bg-cyan-400 shadow-[0_0_8px_#22d3ee]' : 'bg-indigo-300 shadow-[0_0_8px_#a5b4fc] opacity-50 group-hover:opacity-100'}`}></div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* --- PANEL 2: The 3D Neumorphic Cyber Orb --- */}
                <div className="lg:col-span-5 relative flex flex-col items-center justify-center rounded-[2.5rem] bg-[#ebf0f5] shadow-[10px_10px_20px_#d1d9e6,-10px_-10px_20px_#ffffff] border border-white/50 h-full overflow-hidden">

                    <div className="absolute inset-0 rounded-[2.5rem] border-2 border-transparent bg-[linear-gradient(to_right,#ebf0f5,#ebf0f5),linear-gradient(to_right,#00f0ff,#8b5cf6)] bg-clip-padding [background-origin:border-box] opacity-20 pointer-events-none"></div>

                    <div className="relative flex items-center justify-center w-[260px] h-[260px] mb-8">

                        <div className="absolute inset-0 flex items-center justify-center gap-1 opacity-20 z-0">
                            {[24, 45, 76, 34, 88, 56, 92, 41, 78, 63, 85, 39, 91, 52, 74, 31, 82, 47, 68, 29].map((height, i) => (
                                <div key={i} className="w-1 bg-gradient-to-b from-transparent via-indigo-400 to-transparent rounded-full transition-all duration-200"
                                    style={{ height: `${height}%`, opacity: Math.abs(10 - i) > 5 ? 0.3 : 1 }}></div>
                            ))}
                        </div>

                        <div
                            className={`absolute rounded-full transition-all ease-out z-0 ${isRecording ? "bg-gradient-to-r from-cyan-400 to-blue-500 opacity-30 blur-2xl" :
                                isSpeaking ? "bg-gradient-to-r from-violet-500 to-fuchsia-500 opacity-30 blur-2xl" : "bg-cyan-200 opacity-20 blur-2xl"
                                }`}
                            style={{
                                width: '220px', height: '220px',
                                transform: `scale(${1 + (isRecording ? (micVolume / 100) * 1.5 : isSpeaking ? 0.3 : 0)})`,
                                transitionDuration: isRecording ? '75ms' : '500ms'
                            }}
                        />

                        <div className="absolute w-[200px] h-[200px] rounded-full bg-[#ebf0f5] shadow-[12px_12px_24px_#c3c9d1,-12px_-12px_24px_#ffffff] z-10 flex items-center justify-center">
                            <div className="w-[150px] h-[150px] rounded-full bg-gradient-to-br from-[#353945] to-[#141518] shadow-[inset_0_4px_10px_rgba(0,0,0,0.6)] flex items-center justify-center">
                                <div className="w-[120px] h-[120px] rounded-full bg-[#141518] border border-[#2a2d35] flex items-center justify-center relative shadow-[0_10px_20px_rgba(0,0,0,0.5)]">

                                    <div className={`absolute inset-1 rounded-full border border-white/10 transition-all ${isRecording ? 'bg-cyan-500/20 shadow-[0_0_30px_#06b6d4]' :
                                        isSpeaking ? 'bg-violet-500/20 shadow-[0_0_30px_#8b5cf6]' : ''
                                        }`}
                                        style={{
                                            transform: `scale(${1 + (isRecording ? (micVolume / 100) * 0.5 : 0)})`
                                        }}></div>

                                    <button
                                        onClick={toggleRecording}
                                        disabled={!isConnected}
                                        className="relative z-20 w-[80px] h-[80px] rounded-full bg-gradient-to-b from-[#2a2d35] to-[#0f1115] shadow-[inset_0_2px_4px_rgba(255,255,255,0.1),0_10px_20px_rgba(0,0,0,0.8)] flex items-center justify-center group transition-transform hover:scale-105"
                                    >
                                        {isRecording ? (
                                            <div className="flex gap-1.5 items-center justify-center">
                                                <div className="w-1 bg-cyan-400 shadow-[0_0_10px_#22d3ee] rounded-full" style={{ height: `${Math.max(10, micVolume)}px` }}></div>
                                                <div className="w-1 bg-white shadow-[0_0_10px_#fff] rounded-full" style={{ height: `${Math.max(16, micVolume * 1.5)}px` }}></div>
                                                <div className="w-1 bg-cyan-400 shadow-[0_0_10px_#22d3ee] rounded-full" style={{ height: `${Math.max(10, micVolume)}px` }}></div>
                                            </div>
                                        ) : (
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-8 h-8 transition-colors ${isSpeaking ? 'text-violet-300 animate-pulse' : 'text-slate-300 group-hover:text-white'}`}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
                                            </svg>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="absolute bottom-6 z-10 px-5 py-2 rounded-full bg-[#ebf0f5] shadow-[6px_6px_12px_#c3c9d1,-6px_-6px_12px_#ffffff] border border-white/40 font-bold text-[9px] tracking-[0.2em] uppercase">
                        {isSpeaking ? (
                            <span className="text-violet-600 animate-pulse">Agent Speaking</span>
                        ) : isThinking ? (
                            <span className="text-slate-500">Processing Intent...</span>
                        ) : isRecording ? (
                            <span className="text-cyan-600">Listening [ {Math.round(micVolume)} dB ]</span>
                        ) : (
                            <span className="text-slate-400">Awaiting Input</span>
                        )}
                    </div>
                </div>

                {/* --- PANEL 3: Transcript & Analytics --- */}
                <div className="lg:col-span-4 bg-[#ebf0f5] rounded-[2rem] shadow-[10px_10px_20px_#d1d9e6,-10px_-10px_20px_#ffffff] border border-white/40 flex flex-col h-full overflow-hidden">

                    <div className="px-5 py-4 flex flex-wrap gap-2 shrink-0">
                        {['Multilingual AI', 'CRM Synced', 'Memory Active'].map((tag, idx) => (
                            <div key={idx} className="flex items-center gap-1.5 px-3 py-1 bg-[#ebf0f5] shadow-[inset_2px_2px_5px_#c3c9d1,inset_-2px_-2px_5px_#ffffff] rounded-full">
                                <span className="text-[8px] font-bold text-slate-500 uppercase tracking-wider">{tag}</span>
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_5px_#34d399]"></div>
                            </div>
                        ))}
                    </div>

                    <div className="px-5 py-2 flex justify-between items-center shrink-0">
                        <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Live Transcript</h3>
                        <button onClick={handleReset} className="px-3 py-1 rounded-full bg-[#ebf0f5] shadow-[4px_4px_8px_#c3c9d1,-4px_-4px_8px_#ffffff] text-[9px] font-bold text-slate-500 hover:text-slate-700 transition-all active:shadow-[inset_2px_2px_5px_#c3c9d1,inset_-2px_-2px_5px_#ffffff]">
                            Clear
                        </button>
                    </div>

                    {/* Inner Scroll only */}
                    <div className="flex-1 p-5 overflow-y-auto space-y-4 custom-scrollbar">
                        {chatHistory.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-3">
                                <div className="w-10 h-10 rounded-full flex items-center justify-center bg-[#ebf0f5] shadow-[inset_4px_4px_8px_#c3c9d1,inset_-4px_-4px_8px_#ffffff]">
                                    <svg className="w-4 h-4 text-cyan-500 drop-shadow-[0_0_8px_#06b6d4]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                                </div>
                                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Call Analytics Pending</p>
                            </div>
                        ) : (
                            chatHistory.map((msg, index) => (
                                <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[85%] px-4 py-2.5 text-[12px] leading-relaxed font-semibold shadow-[4px_4px_10px_#c3c9d1,-4px_-4px_10px_#ffffff] transition-all ${msg.role === 'user'
                                        ? 'bg-[#ebf0f5] text-slate-700 rounded-2xl rounded-br-sm'
                                        : 'bg-[#1a1c23] text-white rounded-2xl rounded-bl-sm'
                                        }`}>
                                        {msg.text}
                                    </div>
                                </div>
                            ))
                        )}
                        {isThinking && (
                            <div className="flex justify-start">
                                <div className="px-4 py-3 rounded-2xl bg-[#1a1c23] shadow-md rounded-bl-sm flex items-center space-x-1.5">
                                    <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></div>
                                    <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                                    <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                                </div>
                            </div>
                        )}
                        <div ref={chatEndRef} />
                    </div>
                </div>
            </div>

            {/* Custom Neumorphic Scrollbar (Sirf Inner Panels ke liye) */}
            <style jsx>{`
                .custom-scrollbar::-webkit-scrollbar { width: 5px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
            `}</style>
        </main>
    );
}