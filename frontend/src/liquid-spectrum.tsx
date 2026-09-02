import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Music2, Pause, Play, SkipBack, SkipForward, Upload } from 'lucide-react';
import './liquid-spectrum.css';

type AudioMode = 'synthetic' | 'file';

const formatTime = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
};

function useLiquidAudio() {
  const contextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const oscillatorsRef = useRef<OscillatorNode[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [mode, setMode] = useState<AudioMode>('synthetic');
  const [trackName, setTrackName] = useState('NIGHT CURRENT');
  const [duration, setDuration] = useState(222);
  const [currentTime, setCurrentTime] = useState(97);

  const ensureContext = useCallback(() => {
    if (contextRef.current) return contextRef.current;
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.82;
    const master = context.createGain();
    master.gain.value = 0.17;
    master.connect(analyser);
    analyser.connect(context.destination);
    contextRef.current = context;
    analyserRef.current = analyser;
    masterRef.current = master;
    return context;
  }, []);

  const startSynthetic = useCallback(async () => {
    const context = ensureContext();
    await context.resume();
    if (oscillatorsRef.current.length) return;
    const master = masterRef.current!;
    const pad = context.createOscillator();
    pad.type = 'sine';
    pad.frequency.value = 55;
    const shimmer = context.createOscillator();
    shimmer.type = 'triangle';
    shimmer.frequency.value = 220;
    const shimmerGain = context.createGain();
    shimmerGain.gain.value = 0.018;
    shimmer.connect(shimmerGain).connect(master);
    pad.connect(master);
    pad.start();
    shimmer.start();
    oscillatorsRef.current = [pad, shimmer];
  }, [ensureContext]);

  const stopSynthetic = useCallback(() => {
    oscillatorsRef.current.forEach((node) => node.stop());
    oscillatorsRef.current = [];
  }, []);

  const toggle = useCallback(async () => {
    if (mode === 'file') {
      const audio = audioRef.current;
      if (!audio) return;
      if (audio.paused) await audio.play(); else audio.pause();
      return;
    }
    if (isPlaying) {
      stopSynthetic();
      setIsPlaying(false);
    } else {
      await startSynthetic();
      setIsPlaying(true);
    }
  }, [isPlaying, mode, startSynthetic, stopSynthetic]);

  const loadFile = useCallback(async (file: File) => {
    stopSynthetic();
    const context = ensureContext();
    await context.resume();
    if (!audioRef.current) audioRef.current = new Audio();
    const audio = audioRef.current;
    if (!mediaSourceRef.current) {
      const source = context.createMediaElementSource(audio);
      source.connect(masterRef.current!);
      mediaSourceRef.current = source;
    }
    audio.src = URL.createObjectURL(file);
    audio.onloadedmetadata = () => { setDuration(audio.duration); setCurrentTime(0); };
    audio.ontimeupdate = () => setCurrentTime(audio.currentTime);
    audio.onplay = () => setIsPlaying(true);
    audio.onpause = () => setIsPlaying(false);
    audio.onended = () => setIsPlaying(false);
    setTrackName(file.name.replace(/\.[^/.]+$/, '').toUpperCase());
    setMode('file');
    await audio.play();
  }, [ensureContext, stopSynthetic]);

  const seek = useCallback((value: number) => {
    if (mode === 'file' && audioRef.current) audioRef.current.currentTime = value;
    setCurrentTime(value);
  }, [mode]);

  useEffect(() => () => {
    stopSynthetic();
    audioRef.current?.pause();
    contextRef.current?.close();
  }, [stopSynthetic]);

  return { analyserRef, currentTime, duration, isPlaying, loadFile, seek, toggle, trackName };
}

function LiquidCanvas({ analyserRef, playing }: { analyserRef: React.RefObject<AnalyserNode | null>; playing: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let frame = 0;
    let animation = 0;
    let frequency = new Uint8Array(256);
    const render = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr; canvas.height = height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      const analyser = analyserRef.current;
      if (analyser) { frequency = new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(frequency); }
      const energy = analyser ? frequency.slice(2, 55).reduce((sum, value) => sum + value, 0) / (53 * 255) : (playing ? 0.4 + Math.sin(frame * 0.03) * 0.13 : 0.12);
      ctx.clearRect(0, 0, width, height);
      const base = height * 0.61;
      const drawWave = (offset: number, stroke: string, fill: string, scale: number) => {
        ctx.beginPath();
        for (let x = -20; x <= width + 20; x += 4) {
          const ratio = x / width;
          const band = analyser ? frequency[Math.min(frequency.length - 1, Math.floor(ratio * 84) + 2)] / 255 : 0.5 + Math.sin(ratio * 18 + frame * 0.045) * 0.18;
          const amplitude = (35 + energy * 106 + band * 72) * scale;
          const y = base + offset + Math.sin(ratio * 19 + frame * 0.035) * amplitude * 0.36 + Math.sin(ratio * 43 - frame * 0.048) * amplitude * 0.13 - band * amplitude;
          if (x < 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.lineTo(width + 20, height + 20); ctx.lineTo(-20, height + 20); ctx.closePath();
        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, fill); gradient.addColorStop(0.46, '#6760ff'); gradient.addColorStop(0.7, '#d833ff'); gradient.addColorStop(1, '#ff5eae');
        ctx.fillStyle = gradient; ctx.globalAlpha = 0.42; ctx.fill(); ctx.globalAlpha = 1;
        ctx.strokeStyle = stroke; ctx.lineWidth = 2.2; ctx.shadowColor = stroke; ctx.shadowBlur = 19; ctx.stroke(); ctx.shadowBlur = 0;
      };
      drawWave(34, '#1ad9ff', '#004fff', 0.72);
      drawWave(0, '#e55cff', '#563cff', 1);
      drawWave(55, '#ff80cb', '#2d1d96', 0.56);
      const droplets = Math.max(7, Math.floor(energy * 36));
      for (let i = 0; i < droplets; i += 1) {
        const x = ((i * 137.5 + frame * (i % 2 ? 0.55 : -0.35)) % (width + 60)) - 30;
        const y = base - 30 - ((i * 71 + frame * 0.9) % (110 + energy * 170));
        const radius = 1.5 + (i % 4) * 0.85 + energy * 2;
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fillStyle = i % 3 ? '#8e6dff' : '#57deff'; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 12; ctx.fill(); ctx.shadowBlur = 0;
      }
      frame += 1;
      animation = requestAnimationFrame(render);
    };
    animation = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animation);
  }, [analyserRef, playing]);
  return <canvas ref={canvasRef} className="liquid-canvas" aria-hidden="true" />;
}

function LiquidSpectrum() {
  const fileInput = useRef<HTMLInputElement>(null);
  const { analyserRef, currentTime, duration, isPlaying, loadFile, seek, toggle, trackName } = useLiquidAudio();
  const progress = duration ? Math.min(100, currentTime / duration * 100) : 0;
  return <main className="spectrum-shell">
    <div className="ambient ambient-left" /><div className="ambient ambient-right" />
    <header className="spectrum-brand"><span className="brand-orbit" /><span>LIQUID</span><span className="brand-pink">SPECTRUM</span></header>
    <section className="visual-stage" aria-label="液态音乐频谱">
      <LiquidCanvas analyserRef={analyserRef} playing={isPlaying} />
      <div className="stage-fog" />
    </section>
    <section className="player-panel">
      <div className="track-meta"><p>{trackName}</p><span>{isPlaying ? 'LIVE REACTIVE' : 'DEMO MODE'}</span></div>
      <div className="album-art"><div className="album-orb" /></div>
      <div className="transport">
        <button aria-label="上一首"><SkipBack /></button>
        <button className="play-button" onClick={() => void toggle()} aria-label={isPlaying ? '暂停' : '播放'}>{isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button>
        <button aria-label="下一首"><SkipForward /></button>
      </div>
      <button className="upload-button" onClick={() => fileInput.current?.click()} title="上传本地音频驱动频谱"><Upload /><span>导入音乐</span></button>
      <input ref={fileInput} hidden type="file" accept="audio/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadFile(file); }} />
      <div className="timeline"><span>{formatTime(currentTime)}</span><input aria-label="播放进度" type="range" min="0" max={duration || 1} value={Math.min(currentTime, duration || 1)} onChange={(event) => seek(Number(event.target.value))} style={{ '--progress': `${progress}%` } as React.CSSProperties}/><span>{formatTime(duration)}</span></div>
    </section>
    <footer><Music2 /> 点击播放体验合成律动，或导入本地音乐</footer>
  </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><LiquidSpectrum /></StrictMode>);
