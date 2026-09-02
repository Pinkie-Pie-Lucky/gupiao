import { StrictMode, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import './water-ripple.css';

type Ripple = { x: number; y: number; age: number; power: number; splash: boolean };

function WaterRipple() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ripples = useRef<Ripple[]>([{ x: .5, y: .58, age: 0, power: 1, splash: true }]);
  useEffect(() => {
    const canvas = canvasRef.current!; const ctx = canvas.getContext('2d')!; let raf = 0; let last = performance.now();
    const draw = (now: number) => {
      const dt = Math.min(0.04, (now - last) / 1000); last = now; const w = canvas.clientWidth; const h = canvas.clientHeight; const dpr = Math.min(2, devicePixelRatio || 1);
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
      ctx.clearRect(0, 0, w, h); const lakeTop = h * .38;
      const sky = ctx.createLinearGradient(0, 0, 0, lakeTop); sky.addColorStop(0, '#020615'); sky.addColorStop(.65, '#111751'); sky.addColorStop(1, '#7360bd'); ctx.fillStyle = sky; ctx.fillRect(0, 0, w, lakeTop);
      const water = ctx.createLinearGradient(0, lakeTop, 0, h); water.addColorStop(0, '#18235e'); water.addColorStop(.4, '#061441'); water.addColorStop(1, '#010512'); ctx.fillStyle = water; ctx.fillRect(0, lakeTop, w, h);
      const moon = ctx.createRadialGradient(w*.5, h*.15, 1, w*.5, h*.15, 94); moon.addColorStop(0, 'rgba(255,245,255,.96)'); moon.addColorStop(.13, 'rgba(194,155,255,.88)'); moon.addColorStop(1, 'rgba(150,90,255,0)'); ctx.fillStyle = moon; ctx.fillRect(0, 0, w, h*.42);
      ctx.fillStyle = 'rgba(171,136,255,.22)'; ctx.fillRect(w*.495, lakeTop, w*.01, h*.58);
      for (let i=0;i<36;i++) { const y = lakeTop + i * h*.018; ctx.fillStyle = `rgba(107,142,255,${.035 + (i%4)*.012})`; ctx.fillRect(0, y, w, 1); }
      ripples.current.forEach(r => { r.age += dt; const cx = r.x*w, cy = r.y*h; const base = r.age * Math.min(w,h) * .36; for(let n=0;n<6;n++) { const radius = base - n*38*r.power; if(radius<2) continue; const opacity = Math.max(0, .62 - r.age*.15 - n*.06); ctx.beginPath(); ctx.ellipse(cx, cy, radius, radius*.24, 0, 0, Math.PI*2); ctx.strokeStyle = n%2 ? `rgba(95,221,255,${opacity})` : `rgba(218,115,255,${opacity})`; ctx.lineWidth = 1.3 + r.power*1.4; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur=13; ctx.stroke(); }
        if (r.splash && r.age<.8) { const height=(.8-r.age)*70*r.power; ctx.beginPath(); ctx.moveTo(cx-18*r.power,cy); ctx.quadraticCurveTo(cx,cy-height,cx+18*r.power,cy); ctx.strokeStyle=`rgba(205,222,255,${.6-r.age*.6})`;ctx.lineWidth=2;ctx.stroke(); for(let d=0;d<5;d++){const angle=d*1.26+r.age*3;const distance=18+r.age*70;ctx.beginPath();ctx.arc(cx+Math.cos(angle)*distance,cy-height*.6+Math.sin(angle)*distance*.3,2.2,0,7);ctx.fillStyle='rgba(183,193,255,.9)';ctx.fill();} }
      }); ripples.current = ripples.current.filter(r => r.age < 4.4);
      if (!ripples.current.length) ripples.current.push({x:.5,y:.58,age:0,power:1,splash:true}); raf=requestAnimationFrame(draw);
    }; raf=requestAnimationFrame(draw); return()=>cancelAnimationFrame(raf);
  }, []);
  return <main className="ripple-scene" onPointerDown={(event)=>{const box=event.currentTarget.getBoundingClientRect();ripples.current.push({x:(event.clientX-box.left)/box.width,y:Math.max(.39,(event.clientY-box.top)/box.height),age:0,power:.68+Math.random()*.62,splash:true});}}><canvas ref={canvasRef}/><div className="ripple-copy"><span>WATER STUDY</span><h1>一滴，便是整个湖面</h1><p>点击湖面，投下一滴水。</p></div><div className="drop" aria-hidden="true"/></main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><WaterRipple/></StrictMode>);
