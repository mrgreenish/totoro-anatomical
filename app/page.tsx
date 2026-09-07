'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Expand, Hand, Leaf, Moon, Pause, Play, RotateCcw, Rotate3D, Sun, X } from 'lucide-react';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { SculptureController } from '@/lib/totoro-scene';

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const sculptureRef = useRef<SculptureController | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [animated, setAnimated] = useState(true);
  const [night, setNight] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const abort = new AbortController();
    let controller: SculptureController | undefined;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) setAnimated(false);
    import('@/lib/totoro-scene').then(async ({ createSculpture }) => {
      if (abort.signal.aborted || !canvasRef.current) return;
      controller = await createSculpture(canvasRef.current, {
        signal: abort.signal, animate: !reduced,
        onReady: () => setReady(true),
        onError: () => { if (!abort.signal.aborted) { setError(true); setReady(false); } },
      });
      if (abort.signal.aborted) controller.dispose();
      else sculptureRef.current = controller;
    }).catch(() => { if (!abort.signal.aborted) setError(true); });
    return () => { abort.abort(); controller?.dispose(); sculptureRef.current = null; };
  }, []);

  useEffect(() => {
    const onFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => document.removeEventListener('fullscreenchange', onFullscreen);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (mainRef.current?.requestFullscreen) await mainRef.current.requestFullscreen();
      else setFullscreen(value => !value);
    } catch { setFullscreen(value => !value); }
  };

  return (
    <TooltipProvider delay={350}>
      <main ref={mainRef} className={`gallery ${night ? 'is-night' : ''} ${fullscreen ? 'is-fullscreen' : ''}`}>
        <header className="gallery-header">
          <a className="wordmark" href="/" aria-label="Quiet Forest home">
            <span className="brand-icon"><Leaf size={20} strokeWidth={1.6} /></span>
            <span>quiet forest<span className="wordmark-dot">.</span></span>
          </a>
          <span className="header-note">A STUDY IN LITTLE WONDERS</span>
          <Toggle className="light-button" pressed={night} disabled={!ready} onPressedChange={value => { setNight(value); sculptureRef.current?.setNight(value); }} aria-label="Moonlight lighting">
            {night ? <Moon size={16} /> : <Sun size={16} />}<span>{night ? 'Moonlight' : 'Daylight'}</span>
          </Toggle>
        </header>
        <div className="background-word" aria-hidden="true">TOTORO</div>
        <div className="edition"><span className="edition-line" />THE FOREST SPIRIT<span className="edition-number">01</span></div>
        <section className={`sculpture ${ready ? 'is-ready' : ''}`} aria-label="Interactive Totoro sculpture">
          <img className="sculpture-poster" src="/totoro-poster.webp?v=grin-2" alt="A grey Totoro with a wide toothy grin, fluffy cheeks, an ivory belly, seven chevrons, and a green leaf hat." fetchPriority="high" />
          <canvas ref={canvasRef} tabIndex={0} aria-label="Rotate Totoro by dragging or using the arrow keys. Scroll, pinch, or use plus and minus to zoom. Press Home to reset." />
          {!ready && !error ? <div className="loading-status" role="status"><span className="loading-dot" />Waking the forest…</div> : null}
          {error ? <div className="render-error" role="status"><p>The interactive view couldn’t wake up.</p><button onClick={() => window.location.reload()}>Try again <ArrowUpRight size={14} /></button></div> : null}
        </section>
        <div className="sculpture-title">
          <div className="eyebrow"><span className="tiny-dot" />THE QUIET COLLECTION</div>
          <h1>Totoro<span>.</span></h1>
          <p>A little closer to the forest.</p>
          <div className="title-rule" />
          <span className="japanese-title" lang="ja">となりのトトロ</span>
        </div>
        <div className="vertical-note" aria-hidden="true"><span>森のともだち</span><span>A FOREST FRIEND</span></div>
        <div className="interaction-area">
          <div className="interaction-hint"><Hand size={14} strokeWidth={1.5} /><span>Drag to explore<span className="hint-separator">·</span>Scroll to get closer</span></div>
          <div className="controls" aria-label="Sculpture controls">
            <Toggle className="rotate-button" pressed={rotating} disabled={!ready} onPressedChange={value => { setRotating(value); sculptureRef.current?.setRotate(value); }} aria-label="Auto-rotate">
              <Rotate3D size={18} strokeWidth={1.6} /><span>Auto-rotate</span><span className={`toggle-led ${rotating ? 'active' : ''}`} />
            </Toggle>
            <span className="control-divider" />
            <Tooltip><TooltipTrigger className="icon-button" aria-label={animated ? 'Pause animation' : 'Play animation'} disabled={!ready} onClick={() => { const next = !animated; setAnimated(next); sculptureRef.current?.setAnimate(next); }}>
              {animated ? <Pause size={17} strokeWidth={1.6} /> : <Play size={17} strokeWidth={1.6} />}
            </TooltipTrigger><TooltipContent>{animated ? 'Pause the moment' : 'Bring to life'}</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger className="icon-button" aria-label="Reset view" disabled={!ready} onClick={() => { setRotating(false); sculptureRef.current?.reset(); }}><RotateCcw size={17} strokeWidth={1.6} /></TooltipTrigger><TooltipContent>Back to the beginning</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger className="icon-button" aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} onClick={toggleFullscreen}>{fullscreen ? <X size={18} strokeWidth={1.5} /> : <Expand size={18} strokeWidth={1.5} />}</TooltipTrigger><TooltipContent>{fullscreen ? 'Exit fullscreen' : 'A little more room'}</TooltipContent></Tooltip>
          </div>
        </div>
        <footer className="gallery-footer">
          <span>IMAGINED BY GHIBLI<span className="footer-slash">/</span>A FAN-MADE TRIBUTE</span>
          <span className="live-badge"><span className={ready ? 'live-dot' : 'pending-dot'} />{ready ? 'A little magic, in real time' : 'A moment of wonder'}</span>
        </footer>
      </main>
    </TooltipProvider>
  );
}
