import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { openDB } from 'idb';

const PIX_KEY = '33988258007';
const WHATSAPP_GROUP_LINK = 'https://chat.whatsapp.com/GSV8gU29gYMCIjk1LY43RH';

// --- Database Setup ---
const dbPromise = openDB('revelacao-hoje-db', 1, {
  upgrade(db) {
    db.createObjectStore('revelacoes', { keyPath: 'date' });
  },
});

const getRevelationFromDB = async (date) => {
  const db = await dbPromise;
  return db.get('revelacoes', date);
};

const saveRevelationToDB = async (revelation) => {
  const db = await dbPromise;
  return db.put('revelacoes', revelation);
};

// --- Audio Helpers ---
const AudioCTX = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

async function decodePcmData(
  data, // Uint8Array
  ctx, // AudioContext
  sampleRate, // e.g., 24000
  numChannels // e.g., 1
) {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const useAudioPlayer = (audioBlob) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const audioBufferRef = useRef(null);
  const sourceRef = useRef(null);
  const timerRef = useRef(null);
  const startTimeRef = useRef(0);

  useEffect(() => {
    if (!audioBlob) return;
    const processAudio = async () => {
      try {
        const arrayBuffer = await audioBlob.arrayBuffer();
        const audioBuffer = await decodePcmData(new Uint8Array(arrayBuffer), AudioCTX, 24000, 1);
        audioBufferRef.current = audioBuffer;
        setDuration(audioBuffer.duration);
        setCurrentTime(0);
      } catch (error) {
        console.error("Error decoding audio data:", error);
      }
    };
    processAudio();

    return () => {
      if (sourceRef.current) {
        sourceRef.current.stop();
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [audioBlob]);

  const play = useCallback(() => {
    if (!audioBufferRef.current || isPlaying) return;

    sourceRef.current = AudioCTX.createBufferSource();
    sourceRef.current.buffer = audioBufferRef.current;
    sourceRef.current.connect(AudioCTX.destination);

    const offset = currentTime;
    startTimeRef.current = AudioCTX.currentTime - offset;
    sourceRef.current.start(0, offset);
    setIsPlaying(true);

    sourceRef.current.onended = () => {
        setIsPlaying(false);
        if (timerRef.current) clearInterval(timerRef.current);
        if (AudioCTX.currentTime - startTimeRef.current >= duration) {
            setCurrentTime(0);
        }
    };

    timerRef.current = setInterval(() => {
        const elapsed = AudioCTX.currentTime - startTimeRef.current;
        setCurrentTime(Math.min(elapsed, duration));
    }, 100);
  }, [isPlaying, currentTime, duration]);

  const pause = useCallback(() => {
    if (!isPlaying || !sourceRef.current) return;
    sourceRef.current.stop();
    sourceRef.current.disconnect();
    sourceRef.current = null;
    setIsPlaying(false);
    if (timerRef.current) clearInterval(timerRef.current);
  }, [isPlaying]);

  return { isPlaying, duration, currentTime, play, pause };
};

// --- Helper function to convert PCM blob to WAV blob ---
const pcmToWav = (pcmBlob: Blob, sampleRate: number, numChannels: number, bitsPerSample: number): Promise<Blob> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            const pcmData = e.target.result as ArrayBuffer;
            if (!pcmData) {
                return reject(new Error("Failed to read PCM data."));
            }
            const header = new ArrayBuffer(44);
            const view = new DataView(header);

            const writeString = (view: DataView, offset: number, string: string) => {
                for (let i = 0; i < string.length; i++) {
                    view.setUint8(offset + i, string.charCodeAt(i));
                }
            };

            const dataSize = pcmData.byteLength;
            const fileSize = 36 + dataSize;

            // RIFF chunk
            writeString(view, 0, 'RIFF');
            view.setUint32(4, fileSize, true); // little-endian
            writeString(view, 8, 'WAVE');

            // fmt chunk
            writeString(view, 12, 'fmt ');
            view.setUint32(16, 16, true); // Subchunk1Size for PCM
            view.setUint16(20, 1, true); // AudioFormat (1=PCM)
            view.setUint16(22, numChannels, true);
            view.setUint32(24, sampleRate, true);
            view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true); // ByteRate
            view.setUint16(32, numChannels * (bitsPerSample / 8), true); // BlockAlign
            view.setUint16(34, bitsPerSample, true);

            // data chunk
            writeString(view, 36, 'data');
            view.setUint32(40, dataSize, true);

            const wavBlob = new Blob([header, pcmData], { type: 'audio/wav' });
            resolve(wavBlob);
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(pcmBlob);
    });
}

// --- SVG Icons ---
const PlayIcon = ({ className = "w-6 h-6" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>
);
const PauseIcon = ({ className = "w-6 h-6" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"></path></svg>
);
const ShareIcon = ({ className = "w-5 h-5" }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12s-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.368a3 3 0 105.367 2.684 3 3 0 00-5.367 2.684z"></path>
    </svg>
);
const PixIcon = ({ className = "w-5 h-5" }) => (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <path d="M3.333 2.875A2.866 2.866 0 00.469 5.74v12.52a2.866 2.866 0 002.864 2.865h17.334a2.866 2.866 0 002.864-2.865V5.74a2.866 2.866 0 00-2.864-2.865H3.333zm11.45 4.394h2.235a.333.333 0 01.333.333v1.334a.333.333 0 01-.333.333h-2.235a.333.333 0 01-.333-.333V7.602c0-.184.15-.333.333-.333zm-5.786 5.337h2.234a.333.333 0 01.333.333v1.334a.333.333 0 01-.333.333H9a.333.333 0 01-.333-.333v-1.334a.333.333 0 01.333-.333zm.11-5.337c.734 0 1.333.6 1.333 1.333v2.667c0 .734-.6 1.333-1.333 1.333H6.333a.333.333 0 01-.333-.333V7.602c0-.184.15-.333.333-.333h2.778zm5.676.333v5.671a.333.333 0 01-.333.333h-2.667a.333.333 0 01-.333-.333V7.602c0-.184.15-.333.333-.333h2.667a.333.333 0 01.333.333z"></path>
    </svg>
);
const WhatsAppIcon = ({ className = "w-5 h-5" }) => (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
       <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.894 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.886-.001 2.267.655 4.398 1.908 6.161.257.36.124.803-.311 1.044l-1.015.632 2.144-.755.881.521zm-1.08-1.217l-.851-.5-2.021.715.698-1.932-.545-.88c-1.424-2.316-1.12-5.269.831-7.144 1.953-1.875 4.885-2.173 7.15-1.325 2.26.848 3.655 3.129 3.235 5.722-.42 2.593-2.685 4.6-5.378 4.6-.94.001-1.845-.276-2.635-.787z" />
    </svg>
);


// --- Gemini API ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

function getGeminiResponse(prompt: string, isAudio: true): Promise<Blob>;
function getGeminiResponse(prompt: string, isAudio?: false): Promise<string>;
async function getGeminiResponse(prompt: string, isAudio = false): Promise<string | Blob> {
    try {
        if (isAudio) {
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash-preview-tts",
                contents: [{ parts: [{ text: prompt }] }],
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: 'Fenrir' },
                        },
                    },
                },
            });
            const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (!base64Audio) throw new Error("No audio data received.");
            const byteString = atob(base64Audio);
            const byteArray = new Uint8Array(byteString.length);
            for (let i = 0; i < byteString.length; i++) {
                byteArray[i] = byteString.charCodeAt(i);
            }
            return new Blob([byteArray.buffer], { type: 'audio/pcm' });
        } else {
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt
            });
            return response.text;
        }
    } catch (error) {
        console.error("Error calling Gemini API:", error);
        throw error;
    }
}

// -- THEMES --
const VISIBLE_THEMES = ['Perdão', 'Fé', 'Amor', 'Gratidão', 'Propósito', 'Coragem', 'Humildade', 'Surpreenda-me'];
const ALL_THEMES = [...VISIBLE_THEMES.filter(t => t !== 'Surpreenda-me'), 'Esperança', 'Superação', 'Depressão', 'Finanças', 'Casamento', 'Família', 'Paciência', 'Perseverança', 'Confiança', 'Sabedoria', 'Transformação'];


// --- Components ---
const Header = () => (
    <header className="relative w-full py-12 text-center">
         <div className="relative z-10 flex flex-col items-center justify-center h-full text-white">
            <h1 className="text-4xl md:text-5xl font-black tracking-tighter" style={{ textShadow: '0 2px 10px rgba(0,0,0,0.5)' }}>
                REVELAÇÃO DE HOJE
            </h1>
        </div>
    </header>
);

const LoadingAnimation = () => (
    <div className="flex flex-col items-center justify-center p-8 text-center text-white">
        <div className="flex items-center justify-center space-x-2 h-32">
             <style>{`
                @keyframes pulsate-bar {
                    0%, 100% { transform: scaleY(0.5); opacity: 0.3; }
                    50% { transform: scaleY(1); opacity: 1; }
                }
                .bar {
                    width: 8px;
                    height: 48px;
                    background-color: #fff;
                    border-radius: 4px;
                    animation: pulsate-bar 1.2s ease-in-out infinite;
                }
            `}</style>
            <div className="bar" style={{ animationDelay: '0s' }}></div>
            <div className="bar" style={{ animationDelay: '0.2s' }}></div>
            <div className="bar" style={{ animationDelay: '0.4s' }}></div>
        </div>
        <p className="mt-4 text-xl font-medium">Buscando sua revelação...</p>
    </div>
);

const PersonalizationForm = ({ onSubmit, isLoading }) => {
    const [name, setName] = useState('');
    const [selectedTheme, setSelectedTheme] = useState(VISIBLE_THEMES[0]);

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!name.trim()) {
            alert("Por favor, digite seu nome.");
            return;
        }
        onSubmit({ name, theme: selectedTheme });
    };

    return (
        <div className="w-full max-w-lg p-8 space-y-6 bg-white/10 backdrop-blur-xl rounded-2xl shadow-lg border border-white/20 text-white">
            <h2 className="text-2xl font-bold text-center">Personalize sua Revelação</h2>
            <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                    <label htmlFor="name" className="block mb-2 text-sm font-medium text-gray-300">Seu nome</label>
                    <input
                        type="text"
                        id="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Digite seu nome aqui"
                        className="w-full px-4 py-3 text-white bg-black/20 border border-white/20 rounded-lg focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition"
                        required
                    />
                </div>
                <div>
                    <label className="block mb-3 text-sm font-medium text-gray-300">Escolha um tema</label>
                    <div className="flex flex-wrap gap-2 justify-center">
                        {VISIBLE_THEMES.map(theme => (
                            <button
                                key={theme}
                                type="button"
                                onClick={() => setSelectedTheme(theme)}
                                className={`px-4 py-2 text-sm font-medium rounded-full transition-all duration-200 border ${selectedTheme === theme ? 'bg-white text-gray-900 border-white shadow-lg scale-105' : 'border-white/20 bg-white/10 hover:bg-white/20'}`}
                            >
                                {theme}
                            </button>
                        ))}
                    </div>
                </div>
                <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full px-5 py-3 text-base font-bold text-center text-white bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg hover:from-blue-600 hover:to-purple-700 focus:ring-4 focus:outline-none focus:ring-blue-300 disabled:from-gray-500 disabled:to-gray-600 disabled:cursor-not-allowed transition-all active:scale-95 shadow-lg"
                >
                    {isLoading ? 'Gerando...' : 'Receber Revelação'}
                </button>
            </form>
        </div>
    );
};

const AudioPlayer = ({ isPlaying, duration, currentTime, onPlay, onPause }) => {
    const formatTime = (time) => {
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60).toString().padStart(2, '0');
        return `${minutes}:${seconds}`;
    };

    const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

    return (
        <div className="flex items-center gap-4 w-full p-3 bg-black/20 rounded-lg">
            <button
                onClick={isPlaying ? onPause : onPlay}
                className="p-2 text-white bg-gradient-to-br from-blue-500 to-purple-600 rounded-full hover:opacity-90 transition active:scale-95"
                aria-label={isPlaying ? "Pausar áudio" : "Tocar áudio"}
            >
                {isPlaying ? <PauseIcon className="w-6 h-6" /> : <PlayIcon className="w-6 h-6" />}
            </button>
            <div className="w-full">
                <div className="w-full bg-white/20 rounded-full h-1.5 cursor-pointer">
                    <div className="bg-white h-1.5 rounded-full" style={{ width: `${progress}%` }}></div>
                </div>
                <div className="text-xs text-right mt-1 opacity-70">
                    {formatTime(currentTime)} / {formatTime(duration)}
                </div>
            </div>
        </div>
    );
};


const RevelationCard = ({ revelation, prayer, onGeneratePrayer, isLoadingPrayer, onShare, playRevelation, pauseRevelation, isRevelationPlaying, revelationDuration, revelationTime, playPrayer, pausePrayer, isPrayerPlaying, prayerDuration, prayerTime }) => {
    return (
        <div className="w-full max-w-lg p-6 space-y-4 bg-white/10 backdrop-blur-xl rounded-2xl shadow-lg border border-white/20 text-white animate-fade-in">
            <style>{`@keyframes fade-in { 0% { opacity: 0; transform: translateY(20px); } 100% { opacity: 1; transform: translateY(0); } } .animate-fade-in { animation: fade-in 0.5s ease-out; }`}</style>
            <h2 className="text-xl font-bold">Sua revelação para hoje, {revelation.name}:</h2>
            <p className="text-gray-200 whitespace-pre-wrap leading-relaxed">{revelation.text}</p>
            {revelation.audio && (
                 <AudioPlayer
                    isPlaying={isRevelationPlaying}
                    duration={revelationDuration}
                    currentTime={revelationTime}
                    onPlay={playRevelation}
                    onPause={pauseRevelation}
                />
            )}
             <button
                onClick={() => onShare('revelation')}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition active:scale-95"
            >
                <ShareIcon /> Compartilhar no WhatsApp
            </button>

            <div className="border-t border-white/20 my-4"></div>

            {!prayer && (
                <button
                    onClick={onGeneratePrayer}
                    disabled={isLoadingPrayer}
                    className="w-full px-5 py-3 text-base font-bold text-center text-white bg-gradient-to-r from-purple-600 to-pink-600 rounded-lg hover:from-purple-700 hover:to-pink-700 focus:ring-4 focus:outline-none focus:ring-purple-300 disabled:from-gray-500 disabled:to-gray-600 transition-all active:scale-95 shadow-lg"
                >
                    {isLoadingPrayer ? 'Gerando Oração...' : 'Receber Oração do Dia'}
                </button>
            )}

            {prayer && (
                <div className="space-y-4 animate-fade-in">
                    <h3 className="text-lg font-bold">Sua oração do dia:</h3>
                    <p className="text-gray-200 whitespace-pre-wrap leading-relaxed">{prayer.text}</p>
                    {prayer.audio && (
                        <AudioPlayer
                            isPlaying={isPrayerPlaying}
                            duration={prayerDuration}
                            currentTime={prayerTime}
                            onPlay={playPrayer}
                            onPause={pausePrayer}
                        />
                    )}
                    <button
                        onClick={() => onShare('prayer')}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition active:scale-95"
                    >
                         <ShareIcon /> Compartilhar Oração
                    </button>
                </div>
            )}
        </div>
    );
};

const Footer = ({ onCopyPix }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        onCopyPix();
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <footer className="w-full max-w-lg text-center text-white py-6 mt-auto">
            <div className="flex justify-center items-center gap-4">
                <button onClick={handleCopy} className="flex items-center gap-2 px-4 py-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full hover:bg-white/20 transition-transform active:scale-95">
                    <PixIcon />
                    <span>{copied ? 'Copiado!' : 'Apoiar com PIX'}</span>
                </button>
                <a href={WHATSAPP_GROUP_LINK} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-4 py-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full hover:bg-white/20 transition-transform active:scale-95">
                    <WhatsAppIcon />
                    <span>Entrar no Grupo</span>
                </a>
            </div>
             <p className="text-xs mt-4 opacity-50">Desenvolvido com inspiração</p>
        </footer>
    );
};


export default function App() {
    const [todayString, setTodayString] = useState('');
    const [revelation, setRevelation] = useState(null);
    const [prayer, setPrayer] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingPrayer, setIsLoadingPrayer] = useState(false);
    const [error, setError] = useState('');
    const [playRevelationOnLoad, setPlayRevelationOnLoad] = useState(false);

    const { isPlaying: isRevelationPlaying, duration: revelationDuration, currentTime: revelationTime, play: playRevelation, pause: pauseRevelation } = useAudioPlayer(revelation?.audio);
    const { isPlaying: isPrayerPlaying, duration: prayerDuration, currentTime: prayerTime, play: playPrayer, pause: pausePrayer } = useAudioPlayer(prayer?.audio);

    useEffect(() => {
        const date = new Date().toLocaleDateString('pt-BR');
        setTodayString(date);
        const loadRevelation = async () => {
            const savedRevelation = await getRevelationFromDB(date);
            if (savedRevelation) {
                setRevelation(savedRevelation);
            }
        };
        loadRevelation();
    }, []);
    
    useEffect(() => {
        if (playRevelationOnLoad && revelation?.audio) {
            playRevelation();
            setPlayRevelationOnLoad(false);
        }
    }, [playRevelationOnLoad, revelation, playRevelation]);

    const handleGenerateRevelation = async ({ name, theme }) => {
        setIsLoading(true);
        setError('');
        setPrayer(null);
        
        let finalTheme = theme;
        if (theme === 'Surpreenda-me') {
            finalTheme = ALL_THEMES[Math.floor(Math.random() * ALL_THEMES.length)];
        }

        const promptText = `Crie uma reflexão bíblica inspiradora e pessoal para ${name} sobre o tema "${finalTheme}". A mensagem deve ser calorosa, encorajadora, direta e ter no máximo 1 minuto de duração quando lida. Não inclua saudações como "Olá" ou "Querido(a)". Vá direto para a mensagem.`;

        try {
            const text = await getGeminiResponse(promptText);
            const audio = await getGeminiResponse(text, true);

            const newRevelation = { date: todayString, text, audio, name, theme: finalTheme };
            setRevelation(newRevelation);
            await saveRevelationToDB(newRevelation);
            setPlayRevelationOnLoad(true);

        } catch (err) {
            setError('Não foi possível gerar a revelação. Tente novamente.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleGeneratePrayer = async () => {
        if (!revelation) return;
        setIsLoadingPrayer(true);
        setError('');

        const promptText = `Com base na reflexão sobre "${revelation.theme}" para ${revelation.name}, crie uma oração curta e inspiradora. A oração deve ter no máximo 1 minuto de duração quando lida.`;

        try {
            const text = await getGeminiResponse(promptText);
            const audio = await getGeminiResponse(text, true);
            setPrayer({ text, audio });
        } catch (err) {
            setError('Não foi possível gerar a oração. Tente novamente.');
        } finally {
            setIsLoadingPrayer(false);
        }
    };
    
    const handleShare = async (type) => {
        const content = type === 'prayer' ? prayer : revelation;
        if (!content) return;
        
        const message = `*Revelação de Hoje*\n\n_${content.text}_\n\nReceba sua revelação diária também!`;

        // Use Web Share API if available and there's audio
        if (navigator.share && content.audio) {
            try {
                const wavBlob = await pcmToWav(content.audio, 24000, 1, 16);
                const audioFile = new File([wavBlob], `revelacao-de-hoje-${type}.wav`, { type: 'audio/wav' });

                if (navigator.canShare && navigator.canShare({ files: [audioFile] })) {
                    await navigator.share({
                        title: `Revelação de Hoje: ${type === 'prayer' ? 'Oração' : 'Reflexão'}`,
                        text: message,
                        files: [audioFile],
                    });
                    return; // Success
                }
            } catch (error) {
                console.error("Could not share audio file, falling back to text.", error);
            }
        }
        
        // Fallback to text-only WhatsApp link
        const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
        window.open(whatsappUrl, '_blank');
    };

    const handleCopyPix = () => {
        navigator.clipboard.writeText(PIX_KEY);
    };

    return (
        <>
            <style>{`
                @keyframes moveGradient {
                    0% { background-position: 0% 50%; }
                    50% { background-position: 100% 50%; }
                    100% { background-position: 0% 50%; }
                }
                .animated-gradient {
                    background: linear-gradient(-45deg, #3b0764, #1e3a8a, #172554, #312e81);
                    background-size: 400% 400%;
                    animation: moveGradient 15s ease infinite;
                }
            `}</style>
            <div className="flex flex-col items-center min-h-screen font-sans p-4 relative overflow-x-hidden animated-gradient">
                <Header />
                <main className="flex-grow flex flex-col items-center justify-center w-full z-10">
                    {error && <p className="text-red-300 bg-red-900/50 p-3 rounded-lg my-4">{error}</p>}
                    
                    {isLoading ? (
                        <LoadingAnimation />
                    ) : revelation ? (
                        <RevelationCard
                            revelation={revelation}
                            prayer={prayer}
                            onGeneratePrayer={handleGeneratePrayer}
                            isLoadingPrayer={isLoadingPrayer}
                            onShare={handleShare}
                            playRevelation={playRevelation}
                            pauseRevelation={pauseRevelation}
                            isRevelationPlaying={isRevelationPlaying}
                            revelationDuration={revelationDuration}
                            revelationTime={revelationTime}
                            playPrayer={playPrayer}
                            pausePrayer={pausePrayer}
                            isPrayerPlaying={isPrayerPlaying}
                            prayerDuration={prayerDuration}
                            prayerTime={prayerTime}
                        />
                    ) : (
                        <PersonalizationForm onSubmit={handleGenerateRevelation} isLoading={isLoading} />
                    )}
                </main>
                <Footer onCopyPix={handleCopyPix} />
            </div>
        </>
    );
}