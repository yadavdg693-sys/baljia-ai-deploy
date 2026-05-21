import React from 'react';
import { AbsoluteFill, Audio, Img, interpolate, useCurrentFrame } from 'remotion';

type Scene = {
  id: string;
  duration_seconds: number;
  headline: string;
  caption: string;
  narration: string;
  asset_ref: string | null;
  motion: 'push' | 'pan' | 'zoom' | 'hold' | 'reveal';
  scene_type?: 'hook' | 'pain' | 'product_reveal' | 'walkthrough' | 'benefit' | 'proof' | 'cta';
  callout?: string;
  cta?: string;
};

type Asset = {
  id: string;
  label: string;
  kind: 'screenshot' | 'static' | 'fallback';
  url: string | null;
  width?: number;
  height?: number;
  primaryText?: string;
  summary?: string;
  buttons?: string[];
  focusRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  cursorTarget?: {
    x: number;
    y: number;
  };
  shotType?: 'wide' | 'focus' | 'click' | 'cta';
};

export type PromoVideoProps = {
  title: string;
  companyName: string;
  liveUrl: string;
  cta: string;
  scenes: Scene[];
  assets: Asset[];
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  style: 'product_demo' | 'clean_saas' | 'cinematic_ui';
  aspectRatio: '9:16' | '16:9' | '1:1';
  audioUrl?: string | null;
  phase?: 'preview' | 'final';
  visualMode?: 'capture' | 'designed_mockup' | 'cinematic_story';
};

export const DEFAULT_PROMO_VIDEO_PROPS: PromoVideoProps = {
  title: 'Baljia promo',
  companyName: 'Baljia',
  liveUrl: 'https://baljia.app',
  cta: 'Try it today',
  scenes: [
    {
      id: 'scene_1',
      duration_seconds: 5,
      headline: 'Meet the product',
      caption: 'A fast product demo made for launch.',
      narration: 'A fast product demo made for launch.',
      asset_ref: null,
      motion: 'push',
    },
    {
      id: 'scene_2',
      duration_seconds: 5,
      headline: 'See it work',
      caption: 'Clear screens, clear value.',
      narration: 'Clear screens, clear value.',
      asset_ref: null,
      motion: 'zoom',
    },
    {
      id: 'scene_3',
      duration_seconds: 5,
      headline: 'Try it today',
      caption: 'The next step is simple.',
      narration: 'The next step is simple.',
      asset_ref: null,
      motion: 'hold',
      cta: 'Try it today',
    },
  ],
  assets: [],
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 450,
  style: 'product_demo',
  aspectRatio: '9:16',
  audioUrl: null,
  phase: 'final',
  visualMode: 'capture',
};

function getSceneAtFrame(scenes: Scene[], frame: number, fps: number): { scene: Scene; localFrame: number; sceneFrames: number } {
  let cursor = 0;
  for (const scene of scenes) {
    const sceneFrames = Math.max(1, Math.round(scene.duration_seconds * fps));
    if (frame < cursor + sceneFrames) {
      return { scene, localFrame: frame - cursor, sceneFrames };
    }
    cursor += sceneFrames;
  }
  const last = scenes[scenes.length - 1] ?? DEFAULT_PROMO_VIDEO_PROPS.scenes[0];
  return { scene: last, localFrame: 0, sceneFrames: Math.max(1, Math.round(last.duration_seconds * fps)) };
}

function splitCaption(value: string): string[] {
  if (value.length <= 68) return [value];
  const midpoint = Math.floor(value.length / 2);
  const splitAt = value.indexOf(' ', midpoint);
  if (splitAt === -1) return [value.slice(0, 68), value.slice(68)];
  return [value.slice(0, splitAt), value.slice(splitAt + 1)];
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function focusTarget(asset: Asset | undefined): { x: number; y: number } | null {
  if (asset?.cursorTarget) {
    const hasButtonHint = (asset.buttons?.length ?? 0) > 0;
    const isActionShot = asset.shotType === 'click' || asset.shotType === 'cta';
    if (hasButtonHint && isActionShot && asset.cursorTarget.y < 0.12) {
      return {
        x: clamp(asset.cursorTarget.x, 0.13, 0.28),
        y: asset.shotType === 'cta' ? 0.86 : 0.55,
      };
    }
    if (hasButtonHint && isActionShot) {
      return {
        x: clamp(asset.cursorTarget.x + 0.045, 0.08, 0.92),
        y: clamp(asset.cursorTarget.y + 0.005, 0.08, 0.9),
      };
    }
    return asset.cursorTarget;
  }
  if (!asset?.focusRect) return null;
  return {
    x: clamp(asset.focusRect.x + asset.focusRect.width / 2, 0, 1),
    y: clamp(asset.focusRect.y + asset.focusRect.height / 2, 0, 1),
  };
}

function shortText(value: string | null | undefined, fallback: string, maxLength = 72): string {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim() || fallback;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trim()}...` : normalized;
}

function cleanProductItem(value: string | null | undefined): string | null {
  const normalized = (value ?? '')
    .replace(/\btran\s+action\b/gi, 'transaction')
    .replace(/\btransactions?\s+history\b/gi, 'Transaction history')
    .replace(/\bstart tracking free\b/gi, 'Start tracking')
    .replace(/\bget started\b/gi, 'Start tracking')
    .replace(/\bcreate alert\b/gi, 'Price alerts')
    .replace(/\badd transaction\b/gi, 'Add transaction')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized || /\bsign in\b/i.test(normalized)) return null;
  return normalized;
}

function uniqueItems(items: Array<string | null>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const key = item?.toLowerCase();
    if (!item || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function productItems(scene: Scene, asset: Asset | undefined): string[] {
  const buttonItems = (asset?.buttons ?? [])
    .map(cleanProductItem)
    .filter((item): item is string => Boolean(item))
    .slice(0, 4);
  const sceneItems = uniqueItems([
    cleanProductItem(scene.callout),
    cleanProductItem(scene.cta),
    cleanProductItem(scene.headline),
  ]).slice(0, 2);
  const captionWords = scene.caption
    .split(/[,.;:-]/)
    .map(cleanProductItem)
    .filter((item): item is string => item !== null && item.length > 3)
    .slice(0, 2);
  return uniqueItems([...sceneItems, ...buttonItems, ...captionWords, 'Live dashboard', 'Clear next step', 'One dashboard'])
    .slice(0, 4);
}

function cinematicSceneKind(scene: Scene): 'portfolio' | 'fallback' | 'alerts' | 'transactions' | 'reliability' | 'cta' {
  const text = `${scene.headline} ${scene.caption} ${scene.callout ?? ''} ${scene.scene_type ?? ''}`.toLowerCase();
  if (scene.scene_type === 'cta' || scene.cta) return 'cta';
  if (scene.scene_type === 'hook') return 'portfolio';
  if (text.includes('transaction')) return 'transactions';
  if (text.includes('alert')) return 'alerts';
  if (text.includes('missing') || text.includes('last-known') || text.includes('dark')) return 'fallback';
  if (text.includes('reli') || text.includes('visibility')) return 'reliability';
  return 'portfolio';
}

function MiniLineChart({ progress, accent, kind }: { progress: number; accent: string; kind: 'up' | 'stable' | 'alert' }) {
  const points = kind === 'alert'
    ? [[0, 68], [18, 62], [36, 70], [54, 42], [72, 34], [100, 20]]
    : kind === 'stable'
      ? [[0, 48], [18, 45], [36, 47], [54, 44], [72, 45], [100, 42]]
      : [[0, 72], [18, 66], [36, 54], [54, 58], [72, 34], [100, 22]];
  const path = points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
  return (
    <svg viewBox="0 0 100 80" style={{ width: '100%', height: 128, overflow: 'visible' }}>
      <path d="M 0 78 L 100 78" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
      <path d={path} fill="none" stroke={accent} strokeWidth="4" strokeLinecap="round" strokeDasharray="160" strokeDashoffset={interpolate(progress, [0, 0.72], [160, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })} />
      <circle cx={points[points.length - 1][0]} cy={points[points.length - 1][1]} r={interpolate(progress, [0.48, 0.72, 1], [0, 7, 6], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })} fill={accent} />
    </svg>
  );
}

function OrbitalCoin({ label, left, top, delay, progress, accent }: { label: string; left: number; top: number; delay: number; progress: number; accent: string }) {
  const lift = Math.sin((progress + delay) * Math.PI * 2) * 14;
  const glow = interpolate(progress, [0, 0.2, 1], [0.3, 1, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div
      style={{
        position: 'absolute',
        left,
        top: top + lift,
        width: 78,
        height: 78,
        borderRadius: 999,
        background: `radial-gradient(circle at 32% 28%, #fff2bc, ${accent})`,
        color: '#061016',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 22,
        fontWeight: 950,
        boxShadow: `0 18px 56px rgba(246,200,95,${0.18 + glow * 0.18})`,
      }}
    >
      {label}
    </div>
  );
}

function CinematicVisual({ kind, progress, accent, cta }: { kind: ReturnType<typeof cinematicSceneKind>; progress: number; accent: string; cta: string }) {
  const enter = interpolate(progress, [0, 0.18, 1], [42, 0, -8], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const pop = interpolate(progress, [0, 0.2, 1], [0.94, 1, 1.012], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const pulse = interpolate(progress, [0.36, 0.54, 0.72], [0, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const rows = kind === 'transactions'
    ? ['Buy ETH', 'Sell SOL', 'Transfer BTC', 'Fee synced']
    : ['BTC threshold', 'ETH watchlist', 'SOL movement', 'Portfolio alert'];
  return (
    <div
      style={{
        position: 'absolute',
        right: 86,
        top: 82,
        width: 890,
        height: 804,
        transform: `translateY(${enter}px) scale(${pop})`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 36,
          background: 'linear-gradient(155deg, rgba(17,25,34,0.96), rgba(4,7,12,0.98))',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 48px 150px rgba(0,0,0,0.54)',
          overflow: 'hidden',
        }}
      >
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.028) 1px, transparent 1px)', backgroundSize: '46px 46px', opacity: 0.42 }} />
        {kind === 'portfolio' ? (
          <>
            <OrbitalCoin label="BTC" left={610} top={72} delay={0.1} progress={progress} accent={accent} />
            <OrbitalCoin label="ETH" left={706} top={226} delay={0.36} progress={progress} accent={accent} />
            <OrbitalCoin label="SOL" left={578} top={394} delay={0.66} progress={progress} accent={accent} />
            <div style={{ position: 'absolute', left: 58, top: 64, width: 488, padding: 34, borderRadius: 28, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.11)' }}>
              <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 18, fontWeight: 850 }}>Portfolio value</div>
              <div style={{ marginTop: 14, fontSize: 58, fontWeight: 950 }}>$82,450</div>
              <div style={{ marginTop: 10, color: accent, fontSize: 20, fontWeight: 900 }}>+8.4% this week</div>
              <div style={{ marginTop: 30 }}><MiniLineChart progress={progress} accent={accent} kind="up" /></div>
            </div>
            <div style={{ position: 'absolute', left: 58, right: 58, bottom: 56, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
              {['Holdings', 'Alerts', 'History'].map((item, index) => (
                <div key={item} style={{ padding: 22, borderRadius: 20, background: index === 0 ? 'rgba(246,200,95,0.16)' : 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <div style={{ color: accent, fontSize: 15, fontWeight: 950 }}>0{index + 1}</div>
                  <div style={{ marginTop: 14, fontSize: 24, fontWeight: 950 }}>{item}</div>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {kind === 'fallback' ? (
          <>
            <div style={{ position: 'absolute', left: 58, top: 70, right: 58, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
              <div style={{ padding: 30, borderRadius: 28, background: 'rgba(255,70,70,0.1)', border: '1px solid rgba(255,92,92,0.28)' }}>
                <div style={{ color: '#ff7979', fontSize: 18, fontWeight: 950 }}>Market feed</div>
                <div style={{ marginTop: 18, fontSize: 42, fontWeight: 950 }}>Offline</div>
                <div style={{ marginTop: 24, height: 16, borderRadius: 999, background: 'rgba(255,255,255,0.09)', overflow: 'hidden' }}>
                  <div style={{ width: `${interpolate(progress, [0, 0.48, 1], [100, 18, 18], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}%`, height: '100%', background: '#ff7979' }} />
                </div>
              </div>
              <div style={{ padding: 30, borderRadius: 28, background: 'rgba(246,200,95,0.14)', border: '1px solid rgba(246,200,95,0.36)' }}>
                <div style={{ color: accent, fontSize: 18, fontWeight: 950 }}>Last-known price</div>
                <div style={{ marginTop: 18, fontSize: 42, fontWeight: 950 }}>Locked</div>
                <div style={{ marginTop: 22, color: 'rgba(255,255,255,0.72)', fontSize: 21, lineHeight: 1.25, fontWeight: 780 }}>The dashboard stays useful even when live feeds drop.</div>
              </div>
            </div>
            <div style={{ position: 'absolute', left: 58, right: 58, bottom: 80, padding: 30, borderRadius: 28, background: 'rgba(255,255,255,0.075)', border: '1px solid rgba(255,255,255,0.12)' }}>
              <MiniLineChart progress={progress} accent={accent} kind="stable" />
            </div>
          </>
        ) : null}

        {kind === 'alerts' ? (
          <>
            <div style={{ position: 'absolute', left: 64, top: 78, width: 460, padding: 32, borderRadius: 30, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}>
              <div style={{ color: accent, fontSize: 18, fontWeight: 950 }}>Create alert</div>
              <div style={{ marginTop: 20, fontSize: 34, fontWeight: 950 }}>BTC above $72k</div>
              <div style={{ marginTop: 34, height: 14, borderRadius: 999, background: 'rgba(255,255,255,0.1)' }}>
                <div style={{ width: `${interpolate(progress, [0, 0.72], [18, 82], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}%`, height: '100%', borderRadius: 999, background: accent }} />
              </div>
              <div style={{ marginTop: 28 }}><MiniLineChart progress={progress} accent={accent} kind="alert" /></div>
            </div>
            <div style={{ position: 'absolute', right: 64, top: 170, width: 292, padding: 26, borderRadius: 26, background: 'rgba(246,200,95,0.18)', border: '1px solid rgba(246,200,95,0.36)', transform: `scale(${1 + pulse * 0.04})` }}>
              <div style={{ fontSize: 54 }}>!</div>
              <div style={{ marginTop: 14, fontSize: 26, fontWeight: 950 }}>Alert triggered</div>
              <div style={{ marginTop: 10, color: 'rgba(255,255,255,0.72)', fontSize: 18, fontWeight: 750 }}>Threshold crossed just now</div>
            </div>
            <div style={{ position: 'absolute', left: 64, right: 64, bottom: 72, display: 'grid', gap: 14 }}>
              {rows.map((row, index) => (
                <div key={row} style={{ height: 66, borderRadius: 18, padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: index === 0 ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <span style={{ fontSize: 20, fontWeight: 900 }}>{row}</span>
                  <span style={{ color: index === 0 ? accent : 'rgba(255,255,255,0.45)', fontSize: 16, fontWeight: 950 }}>{index === 0 ? 'live' : 'ready'}</span>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {kind === 'transactions' ? (
          <div style={{ position: 'absolute', left: 58, right: 58, top: 76 }}>
            <div style={{ fontSize: 22, color: accent, fontWeight: 950 }}>Transaction ledger</div>
            <div style={{ marginTop: 22, display: 'grid', gap: 15 }}>
              {['Buy ETH', 'Transfer BTC', 'Sell SOL', 'Fee synced', 'Portfolio updated'].map((row, index) => (
                <div key={row} style={{ height: 78, borderRadius: 20, padding: '0 26px', display: 'grid', gridTemplateColumns: '1.1fr 0.8fr 0.5fr', alignItems: 'center', background: index === 0 ? 'rgba(246,200,95,0.15)' : 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', transform: `translateX(${interpolate(progress, [0, 0.22 + index * 0.055], [70, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}px)`, opacity: interpolate(progress, [0, 0.18 + index * 0.055], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
                  <span style={{ fontSize: 24, fontWeight: 950 }}>{row}</span>
                  <span style={{ color: 'rgba(255,255,255,0.64)', fontSize: 18, fontWeight: 800 }}>May 20</span>
                  <span style={{ color: index === 0 ? accent : '#77e6a3', fontSize: 18, fontWeight: 950 }}>{index === 0 ? '+$2.4k' : 'synced'}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {kind === 'reliability' || kind === 'cta' ? (
          <>
            <div style={{ position: 'absolute', left: 82, top: 78, width: 310, height: 310, borderRadius: 999, background: `conic-gradient(from ${progress * 180}deg, ${accent}, rgba(255,255,255,0.08), ${accent})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 232, height: 232, borderRadius: 999, background: '#071016', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24, fontSize: 30, lineHeight: 1.05, fontWeight: 950 }}>
                {kind === 'cta' ? 'Start now' : 'Always visible'}
              </div>
            </div>
            <div style={{ position: 'absolute', right: 72, top: 90, width: 390, padding: 32, borderRadius: 30, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}>
              <div style={{ color: accent, fontSize: 18, fontWeight: 950 }}>{kind === 'cta' ? 'Next step' : 'Reliability'}</div>
              <div style={{ marginTop: 18, fontSize: 38, lineHeight: 1.05, fontWeight: 950 }}>{kind === 'cta' ? cta : 'No blank states'}</div>
              <div style={{ marginTop: 20, color: 'rgba(255,255,255,0.68)', fontSize: 20, lineHeight: 1.3, fontWeight: 760 }}>{kind === 'cta' ? 'Open the portfolio and start tracking with context.' : 'Holdings, alerts, and history stay readable when live data is stale.'}</div>
            </div>
            <div style={{ position: 'absolute', left: 72, right: 72, bottom: 82, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
              {['Holdings', 'Alerts', kind === 'cta' ? 'Open portfolio' : 'History'].map((item, index) => (
                <div key={item} style={{ padding: 24, height: 120, borderRadius: 22, background: index === 2 ? 'rgba(246,200,95,0.16)' : 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <div style={{ color: index === 2 ? accent : 'rgba(255,255,255,0.48)', fontSize: 15, fontWeight: 950 }}>0{index + 1}</div>
                  <div style={{ marginTop: 15, fontSize: 23, fontWeight: 950 }}>{item}</div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function CinematicStoryVideo(input: {
  props: PromoVideoProps;
  scene: Scene;
  progress: number;
  headlineOpacity: number;
  styleAccent: string;
}) {
  const { props, scene, progress, headlineOpacity, styleAccent } = input;
  const kind = cinematicSceneKind(scene);
  const captionLines = splitCaption(scene.caption);
  const titleY = interpolate(progress, [0, 0.18, 1], [58, 0, -8], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const titleScale = interpolate(progress, [0, 0.7, 1], [0.97, 1, 1.01], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const wash = interpolate(progress, [0, 1], [0, 1]);

  return (
    <AbsoluteFill
      style={{
        background: '#04070b',
        color: '#fff',
        fontFamily: 'Inter, Arial, sans-serif',
        overflow: 'hidden',
      }}
    >
      {props.audioUrl ? <Audio src={props.audioUrl} /> : null}
      <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(circle at ${62 + wash * 9}% ${18 + wash * 12}%, rgba(246,200,95,0.16), transparent 28%), radial-gradient(circle at 8% 84%, rgba(46,131,255,0.13), transparent 34%), linear-gradient(120deg, #04070b, #071017 58%, #030508)` }} />
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.026) 1px, transparent 1px)', backgroundSize: '64px 64px', opacity: 0.2 }} />

      <div style={{ position: 'absolute', left: 96, top: 86, transform: `translateY(${titleY}px) scale(${titleScale})`, transformOrigin: '0 45%', opacity: headlineOpacity }}>
        <div style={{ width: 'fit-content', padding: '10px 16px', borderRadius: 999, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', color: styleAccent, fontSize: 16, fontWeight: 900 }}>
          {props.companyName}
        </div>
        <div style={{ marginTop: 26, width: 700, fontSize: 72, lineHeight: 0.96, fontWeight: 950, letterSpacing: 0 }}>
          {shortText(scene.headline, props.title, 64)}
        </div>
        <div style={{ marginTop: 28, display: 'grid', gap: 9 }}>
          {captionLines.map((line) => (
            <div key={line} style={{ width: 'fit-content', maxWidth: 650, padding: '10px 15px', borderRadius: 999, background: 'rgba(255,255,255,0.09)', border: '1px solid rgba(255,255,255,0.12)', fontSize: 22, lineHeight: 1.12, fontWeight: 820 }}>
              {line}
            </div>
          ))}
        </div>
      </div>

      <CinematicVisual kind={kind} progress={progress} accent={styleAccent} cta={props.cta} />
    </AbsoluteFill>
  );
}

function DesignedPromoVideo(input: {
  props: PromoVideoProps;
  scene: Scene;
  asset: Asset | undefined;
  progress: number;
  headlineOpacity: number;
  styleAccent: string;
}) {
  const { props, scene, asset, progress, headlineOpacity, styleAccent } = input;
  const items = productItems(scene, asset);
  const captionLines = splitCaption(scene.caption);
  const slideIn = interpolate(progress, [0, 0.18, 1], [44, 0, 0]);
  const panelScale = interpolate(progress, [0, 0.8, 1], [0.985, 1.012, 1.012]);
  const cursorX = interpolate(progress, [0, 0.56, 1], [66, 74, 74]);
  const cursorY = interpolate(progress, [0, 0.56, 1], [74, 79, 79]);
  const clickPulse = interpolate(progress, [0.48, 0.62, 0.76], [0, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const isCta = scene.scene_type === 'cta' || Boolean(scene.cta);
  const primaryTitle = shortText(scene.headline, props.companyName, 48);
  const supportingText = shortText(scene.caption, scene.narration, 96);

  return (
    <AbsoluteFill
      style={{
        background: '#05070a',
        color: '#fff',
        fontFamily: 'Inter, Arial, sans-serif',
        overflow: 'hidden',
      }}
    >
      {props.audioUrl ? <Audio src={props.audioUrl} /> : null}
      {asset?.url ? (
        <Img
          src={asset.url}
          style={{
            position: 'absolute',
            inset: -24,
            width: 'calc(100% + 48px)',
            height: 'calc(100% + 48px)',
            objectFit: 'cover',
            filter: 'blur(18px) saturate(0.72)',
            opacity: 0.16,
          }}
        />
      ) : null}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(circle at 74% 30%, rgba(28,117,188,0.28), transparent 30%), linear-gradient(120deg, rgba(5,7,10,0.94), rgba(5,7,10,0.78) 52%, rgba(5,7,10,0.96))',
        }}
      />

      <div
        style={{
          position: 'absolute',
          left: 96,
          top: 84,
          width: 640,
          transform: `translateY(${slideIn}px)`,
          opacity: headlineOpacity,
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: '9px 13px',
            borderRadius: 999,
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.13)',
            color: styleAccent,
            fontSize: 16,
            fontWeight: 850,
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: 999, background: styleAccent }} />
          {props.companyName}
        </div>
        <div
          style={{
            marginTop: 28,
            fontSize: 64,
            lineHeight: 0.98,
            fontWeight: 950,
            letterSpacing: 0,
          }}
        >
          {scene.headline}
        </div>
        <div style={{ marginTop: 24, display: 'grid', gap: 8 }}>
          {captionLines.map((line) => (
            <div
              key={line}
              style={{
                width: 'fit-content',
                maxWidth: 610,
                padding: '9px 14px',
                borderRadius: 999,
                background: 'rgba(255,255,255,0.09)',
                border: '1px solid rgba(255,255,255,0.13)',
                color: 'rgba(255,255,255,0.92)',
                fontSize: 21,
                lineHeight: 1.15,
                fontWeight: 800,
              }}
            >
              {line}
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          right: 88,
          top: 86,
          width: 880,
          height: 800,
          transform: `scale(${panelScale})`,
          transformOrigin: '60% 50%',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 28,
            background: 'linear-gradient(160deg, rgba(17,24,32,0.96), rgba(8,10,13,0.96))',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 44px 140px rgba(0,0,0,0.5)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '30px 34px',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <div>
              <div style={{ fontSize: 18, color: 'rgba(255,255,255,0.52)', fontWeight: 800 }}>Live workspace</div>
              <div style={{ marginTop: 8, fontSize: 30, fontWeight: 950 }}>{primaryTitle}</div>
            </div>
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 999,
                background: styleAccent,
                color: '#081016',
                fontSize: 17,
                fontWeight: 950,
              }}
            >
              active
            </div>
          </div>

          <div style={{ position: 'absolute', left: 34, right: 34, top: 136, display: 'grid', gridTemplateColumns: '1.08fr 0.92fr', gap: 20 }}>
            <div
              style={{
                minHeight: 318,
                borderRadius: 20,
                padding: 28,
                background: 'rgba(255,255,255,0.055)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <div style={{ color: styleAccent, fontSize: 16, fontWeight: 950 }}>Overview</div>
              <div style={{ marginTop: 18, fontSize: 28, lineHeight: 1.08, fontWeight: 950 }}>{shortText(scene.callout, primaryTitle, 66)}</div>
              <div style={{ marginTop: 20, color: 'rgba(255,255,255,0.64)', fontSize: 18, lineHeight: 1.35, fontWeight: 700 }}>{supportingText}</div>
              <div style={{ marginTop: 28, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {items.slice(0, 4).map((item, index) => (
                  <div
                    key={item}
                    style={{
                      padding: '13px 14px',
                      borderRadius: 12,
                      background: index === 0 ? 'rgba(28,117,188,0.22)' : 'rgba(255,255,255,0.06)',
                      border: `1px solid ${index === 0 ? 'rgba(74,163,255,0.34)' : 'rgba(255,255,255,0.09)'}`,
                      fontSize: 16,
                      fontWeight: 850,
                    }}
                  >
                    {shortText(item, `Step ${index + 1}`, 28)}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gap: 14 }}>
              {[0, 1, 2, 3].map((index) => (
                <div
                  key={index}
                  style={{
                    height: 72,
                    borderRadius: 16,
                    background: index === 0 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.055)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0 18px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
                    <div style={{ width: 12, height: 12, borderRadius: 999, background: index === 0 ? styleAccent : 'rgba(255,255,255,0.32)' }} />
                    <div style={{ fontSize: 17, fontWeight: 850 }}>{shortText(items[index], `Product step ${index + 1}`, 34)}</div>
                  </div>
                  <div style={{ color: index === 0 ? styleAccent : 'rgba(255,255,255,0.45)', fontSize: 15, fontWeight: 900 }}>
                    {index === 0 ? 'now' : 'ready'}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              position: 'absolute',
              left: 34,
              right: 34,
              bottom: 32,
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 16,
            }}
          >
            {['Clear status', 'Faster action', isCta ? props.cta : 'One dashboard'].map((item, index) => (
              <div
                key={item}
                style={{
                  height: 112,
                  borderRadius: 18,
                  padding: 20,
                  background: index === 2 ? 'rgba(255,255,255,0.11)' : 'rgba(255,255,255,0.055)',
                  border: '1px solid rgba(255,255,255,0.09)',
                }}
              >
                <div style={{ color: index === 2 ? styleAccent : 'rgba(255,255,255,0.46)', fontSize: 15, fontWeight: 950 }}>0{index + 1}</div>
                <div style={{ marginTop: 15, fontSize: 20, fontWeight: 950 }}>{item}</div>
              </div>
            ))}
          </div>
        </div>

        {(scene.scene_type === 'walkthrough' || scene.scene_type === 'cta' || asset?.shotType === 'click') ? (
          <div
            style={{
              position: 'absolute',
              left: `${cursorX}%`,
              top: `${cursorY}%`,
              width: 24,
              height: 24,
              transform: 'rotate(-18deg)',
              filter: 'drop-shadow(0 9px 18px rgba(0,0,0,0.42))',
            }}
          >
            <div style={{ width: 0, height: 0, borderTop: '25px solid #ffffff', borderRight: '15px solid transparent' }} />
            <div
              style={{
                position: 'absolute',
                left: -16,
                top: -16,
                width: 52,
                height: 52,
                borderRadius: 999,
                border: `2px solid ${styleAccent}`,
                opacity: clickPulse * 0.74,
                transform: `scale(${interpolate(clickPulse, [0, 1], [0.62, 1.2])})`,
              }}
            />
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
}

export function PromoVideoComposition(props: PromoVideoProps) {
  const frame = useCurrentFrame();
  const fps = props.fps || 30;
  const scenes = props.scenes.length > 0 ? props.scenes : DEFAULT_PROMO_VIDEO_PROPS.scenes;
  const { scene, localFrame, sceneFrames } = getSceneAtFrame(scenes, frame, fps);
  const progress = Math.min(1, localFrame / Math.max(1, sceneFrames));
  const asset = props.assets.find((item) => item.id === scene.asset_ref && item.url) ?? props.assets.find((item) => item.url);
  const target = focusTarget(asset);
  const focusRect = asset?.focusRect;
  const isFocusShot = Boolean(
    focusRect
      && (asset?.shotType === 'focus'
        || asset?.shotType === 'click'
        || asset?.shotType === 'cta'
        || scene.scene_type === 'walkthrough'
        || scene.scene_type === 'cta'),
  );
  const imageScale = isFocusShot
    ? interpolate(progress, [0, 0.82, 1], [1, 1.012, 1.012])
    : scene.motion === 'zoom'
      ? interpolate(progress, [0, 1], [1, 1.018])
      : scene.motion === 'push'
        ? interpolate(progress, [0, 1], [1.012, 1])
        : 1;
  const imageX = scene.motion === 'pan' ? interpolate(progress, [0, 1], [-32, 32]) : 0;
  const headlineY = interpolate(progress, [0, 0.16, 1], [24, 0, 0]);
  const headlineOpacity = interpolate(progress, [0, 0.12, 0.9, 1], [0, 1, 1, 0.9]);
  const isLandscape = props.aspectRatio === '16:9';
  const isSquare = props.aspectRatio === '1:1';
  const frameInsetXRatio = isLandscape ? 0 : isSquare ? 0.055 : 0.06;
  const frameTopRatio = isLandscape ? 0 : isSquare ? 0.055 : 0.046;
  const frameBottomRatio = isLandscape ? 0 : isSquare ? 0.06 : 0.052;
  const browserBarHeight = isLandscape ? 0 : isSquare ? 50 : 58;
  const screenWidthPx = props.width * (1 - frameInsetXRatio * 2);
  const screenHeightPx = props.height * (1 - frameTopRatio - frameBottomRatio);
  const screenContentHeightPx = Math.max(1, screenHeightPx - browserBarHeight);
  const assetAspect = asset?.width && asset.height ? asset.width / asset.height : props.aspectRatio === '16:9' ? 16 / 9 : props.aspectRatio === '1:1' ? 1 : 1080 / 1800;
  const contentAspect = screenWidthPx / screenContentHeightPx;
  const imageWidthPx = isLandscape
    ? assetAspect > contentAspect ? screenContentHeightPx * assetAspect : screenWidthPx
    : assetAspect > contentAspect ? screenWidthPx : screenContentHeightPx * assetAspect;
  const imageHeightPx = isLandscape
    ? assetAspect > contentAspect ? screenContentHeightPx : screenWidthPx / assetAspect
    : assetAspect > contentAspect ? screenWidthPx / assetAspect : screenContentHeightPx;
  const imageLeftPx = (screenWidthPx - imageWidthPx) / 2;
  const imageTopPx = browserBarHeight + (screenContentHeightPx - imageHeightPx) / 2;
  const targetXInScreen = target ? (imageLeftPx + imageWidthPx * clamp(target.x, 0, 1)) / screenWidthPx : 0.68;
  const targetYInScreen = target ? (imageTopPx + imageHeightPx * clamp(target.y, 0, 1)) / screenHeightPx : 0.22;
  const transformOrigin = target
    ? `${clamp(target.x, 0.08, 0.92) * 100}% ${clamp(target.y, 0.12, 0.88) * 100}%`
    : scene.motion === 'zoom'
      ? '58% 48%'
      : 'center';
  const headlineSize = isLandscape ? 48 : isSquare ? 62 : 70;
  const captionSize = isLandscape ? 22 : isSquare ? 25 : 29;
  const captionLines = splitCaption(scene.caption);
  const useCompactCaption = isLandscape;
  const activeCaptionSize = useCompactCaption ? 18 : captionSize;
  const styleAccent = props.style === 'cinematic_ui' ? '#8bd3ff' : props.style === 'clean_saas' ? '#3dd6a3' : '#f6c85f';
  const focusAccent = props.style === 'cinematic_ui' ? '#d9f3ff' : props.style === 'clean_saas' ? '#ddfff2' : '#ffffff';
  const focusGlow = props.style === 'cinematic_ui'
    ? 'rgba(139,211,255,0.34)'
    : props.style === 'clean_saas'
      ? 'rgba(61,214,163,0.3)'
      : 'rgba(246,200,95,0.24)';
  const callout = scene.callout ?? scene.cta ?? '';
  const calloutOpacity = interpolate(progress, [0, 0.18, 0.82, 1], [0, 1, 1, 0]);
  const showCalloutChip = Boolean(callout && (asset?.shotType === 'click' || scene.scene_type === 'walkthrough' || scene.scene_type === 'cta'));
  const showCursor = Boolean(target && (asset?.shotType === 'click' || scene.scene_type === 'walkthrough' || scene.scene_type === 'cta'));
  const cursorEndX = clamp(targetXInScreen * 100, 5, 92);
  const cursorEndY = clamp(targetYInScreen * 100, 8, 86);
  const cursorStartX = clamp(cursorEndX + (targetXInScreen > 0.54 ? -24 : 22), 8, 88);
  const cursorStartY = clamp(cursorEndY - 18, 10, 82);
  const cursorX = interpolate(progress, [0, 0.54, 1], [cursorStartX, cursorEndX, cursorEndX]);
  const cursorY = interpolate(progress, [0, 0.54, 1], [cursorStartY, cursorEndY, cursorEndY]);
  const clickPulse = interpolate(progress, [0.48, 0.58, 0.72], [0, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const focusOpacity = focusRect
    ? interpolate(progress, [0, 0.16, 0.84, 1], [0, 0.82, 0.82, 0])
    : 0;
  const hasUsefulFocusRect = Boolean(
    focusRect
      && focusRect.width >= 0.045
      && focusRect.height >= 0.045
      && focusRect.width <= 0.58,
  );
  const showFocusMarker = Boolean(
    !isLandscape
      && hasUsefulFocusRect
      && asset?.shotType !== 'click'
      && asset?.shotType !== 'cta',
  );
  const focusCornerSize = isLandscape ? 14 : 20;
  const focusCornerThickness = isLandscape ? 2 : 3;

  if (props.visualMode === 'cinematic_story' && isLandscape) {
    return (
      <CinematicStoryVideo
        props={props}
        scene={scene}
        progress={progress}
        headlineOpacity={headlineOpacity}
        styleAccent={styleAccent}
      />
    );
  }

  if (props.visualMode === 'designed_mockup' && isLandscape) {
    return (
      <DesignedPromoVideo
        props={props}
        scene={scene}
        asset={asset}
        progress={progress}
        headlineOpacity={headlineOpacity}
        styleAccent={styleAccent}
      />
    );
  }

  return (
    <AbsoluteFill
      style={{
        background: '#0b0f12',
        color: '#fff',
        fontFamily: 'Inter, Arial, sans-serif',
        overflow: 'hidden',
      }}
    >
      {props.audioUrl ? <Audio src={props.audioUrl} /> : null}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(145deg, #0b0f12 0%, #171717 54%, #10151a 100%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
          opacity: 0.12,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: '6%',
          right: '6%',
          top: '3.2%',
          alignItems: 'center',
          justifyContent: 'space-between',
          color: 'rgba(255,255,255,0.8)',
          fontSize: 20,
          fontWeight: 800,
          display: 'none',
        }}
      >
        <span>{props.companyName}</span>
        {props.phase === 'preview' ? (
          <span style={{ color: styleAccent }}>Preview</span>
        ) : (
          <span>{props.liveUrl.replace(/^https?:\/\//, '')}</span>
        )}
      </div>

      <div
        style={{
          position: 'absolute',
          left: `${frameInsetXRatio * 100}%`,
          right: `${frameInsetXRatio * 100}%`,
          top: `${frameTopRatio * 100}%`,
          bottom: `${frameBottomRatio * 100}%`,
          borderRadius: isLandscape ? 0 : 34,
          overflow: 'hidden',
          background: '#0b0f12',
          boxShadow: isLandscape ? 'none' : '0 38px 130px rgba(0,0,0,0.42)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            zIndex: 3,
            left: 0,
            right: 0,
            top: 0,
            height: browserBarHeight,
            display: isLandscape ? 'none' : 'flex',
            alignItems: 'center',
            gap: 10,
            padding: isLandscape ? '0 20px' : '0 24px',
            background: 'rgba(10,11,12,0.92)',
            color: '#fff',
          }}
        >
          <span style={{ width: 12, height: 12, borderRadius: 999, background: '#ef4444' }} />
          <span style={{ width: 12, height: 12, borderRadius: 999, background: '#f59e0b' }} />
          <span style={{ width: 12, height: 12, borderRadius: 999, background: '#10b981' }} />
          <span
            style={{
              marginLeft: 14,
              flex: 1,
              borderRadius: 999,
              background: 'rgba(255,255,255,0.12)',
              padding: '9px 16px',
              fontSize: 18,
              color: 'rgba(255,255,255,0.75)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {props.liveUrl.replace(/^https?:\/\//, '')}
          </span>
          {showCalloutChip ? (
            <span
              style={{
                maxWidth: isLandscape ? 220 : 250,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                borderRadius: 999,
                background: 'rgba(255,255,255,0.14)',
                border: '1px solid rgba(255,255,255,0.18)',
                padding: isLandscape ? '7px 11px' : '8px 13px',
                color: '#ffffff',
                fontSize: isLandscape ? 15 : 18,
                fontWeight: 850,
                opacity: calloutOpacity,
              }}
            >
              {callout}
            </span>
          ) : null}
        </div>
        {asset?.url ? (
          <div
            style={{
              position: 'absolute',
              left: imageLeftPx,
              top: imageTopPx,
              width: imageWidthPx,
              height: imageHeightPx,
              transform: `translateX(${imageX}px) scale(${imageScale})`,
              transformOrigin,
              background: '#ffffff',
              overflow: 'hidden',
            }}
          >
            <Img
              src={asset.url}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'fill',
                background: '#ffffff',
              }}
            />
            {showFocusMarker && focusRect ? (
              <div
                style={{
                  position: 'absolute',
                  left: `${clamp(focusRect.x, 0, 1) * 100}%`,
                  top: `${clamp(focusRect.y, 0, 1) * 100}%`,
                  width: `${clamp(focusRect.width, 0.02, 1) * 100}%`,
                  height: `${clamp(focusRect.height, 0.018, 1) * 100}%`,
                  borderRadius: isLandscape ? 10 : 14,
                  boxShadow: `0 0 34px ${focusGlow}, 0 0 0 999px rgba(0,0,0,0.11)`,
                  opacity: focusOpacity,
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width: focusCornerSize,
                    height: focusCornerSize,
                    borderLeft: `${focusCornerThickness}px solid ${focusAccent}`,
                    borderTop: `${focusCornerThickness}px solid ${focusAccent}`,
                    borderTopLeftRadius: isLandscape ? 7 : 10,
                  }}
                />
                <span
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: 0,
                    width: focusCornerSize,
                    height: focusCornerSize,
                    borderRight: `${focusCornerThickness}px solid ${focusAccent}`,
                    borderTop: `${focusCornerThickness}px solid ${focusAccent}`,
                    borderTopRightRadius: isLandscape ? 7 : 10,
                  }}
                />
                <span
                  style={{
                    position: 'absolute',
                    left: 0,
                    bottom: 0,
                    width: focusCornerSize,
                    height: focusCornerSize,
                    borderLeft: `${focusCornerThickness}px solid ${focusAccent}`,
                    borderBottom: `${focusCornerThickness}px solid ${focusAccent}`,
                    borderBottomLeftRadius: isLandscape ? 7 : 10,
                  }}
                />
                <span
                  style={{
                    position: 'absolute',
                    right: 0,
                    bottom: 0,
                    width: focusCornerSize,
                    height: focusCornerSize,
                    borderRight: `${focusCornerThickness}px solid ${focusAccent}`,
                    borderBottom: `${focusCornerThickness}px solid ${focusAccent}`,
                    borderBottomRightRadius: isLandscape ? 7 : 10,
                  }}
                />
              </div>
            ) : null}
          </div>
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#f8f4ea',
              color: '#16110a',
              fontSize: headlineSize * 0.58,
              fontWeight: 850,
              textAlign: 'center',
              padding: 64,
            }}
          >
            {props.companyName}
          </div>
        )}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: isLandscape
              ? 'linear-gradient(180deg, rgba(0,0,0,0.03) 0%, rgba(0,0,0,0) 42%, rgba(0,0,0,0.18) 100%)'
              : 'linear-gradient(180deg, rgba(0,0,0,0.06) 0%, rgba(0,0,0,0) 44%, rgba(0,0,0,0.68) 100%)',
          }}
        />
        {showCursor ? (
          <div
            style={{
              position: 'absolute',
              zIndex: 5,
              left: `${cursorX}%`,
              top: `${cursorY}%`,
              width: 22,
              height: 22,
              transform: 'rotate(-18deg)',
              filter: 'drop-shadow(0 8px 14px rgba(0,0,0,0.36))',
            }}
          >
            <div
              style={{
                width: 0,
                height: 0,
                borderTop: '23px solid #ffffff',
                borderRight: '14px solid transparent',
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: -14,
                top: -14,
                width: 48,
                height: 48,
                borderRadius: 999,
                border: `2px solid ${focusAccent}`,
                opacity: clickPulse * 0.72,
                transform: `scale(${interpolate(clickPulse, [0, 1], [0.62, 1.18])})`,
              }}
            />
          </div>
        ) : null}
        <div
          style={{
            position: 'absolute',
            left: 36,
            right: 36,
            bottom: 30,
            display: isLandscape ? 'none' : 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 18,
            color: '#fff',
            fontSize: 24,
            fontWeight: 750,
            opacity: 0,
          }}
        >
          <span>{asset?.label ?? props.liveUrl.replace(/^https?:\/\//, '')}</span>
          <span style={{ color: styleAccent }}>{props.companyName}</span>
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          zIndex: 6,
          left: useCompactCaption ? '18%' : `${frameInsetXRatio * 100 + (isLandscape ? 2.2 : 3)}%`,
          right: useCompactCaption ? '18%' : `${frameInsetXRatio * 100 + (isLandscape ? 2.2 : 3)}%`,
          bottom: `${frameBottomRatio * 100 + (useCompactCaption ? 2.2 : isLandscape ? 4.2 : 4.8)}%`,
          transform: `translateY(${headlineY}px)`,
          opacity: headlineOpacity,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          alignItems: useCompactCaption ? 'center' : 'flex-start',
          maxWidth: useCompactCaption ? '64%' : isLandscape ? '54%' : isSquare ? '74%' : '86%',
          textShadow: '0 10px 28px rgba(0,0,0,0.48)',
        }}
      >
        <div
          style={{
            display: useCompactCaption ? 'none' : 'inline-flex',
            width: 'fit-content',
            marginBottom: isLandscape ? 10 : 16,
            padding: isLandscape ? '6px 10px' : '8px 13px',
            borderRadius: 999,
            background: 'rgba(8,9,10,0.58)',
            border: '1px solid rgba(255,255,255,0.18)',
            color: styleAccent,
            fontSize: isLandscape ? 15 : 20,
            fontWeight: 800,
            letterSpacing: 0,
            backdropFilter: 'blur(10px)',
          }}
        >
          {props.title}
        </div>
        <div
          style={{
            display: useCompactCaption ? 'none' : 'block',
            fontSize: headlineSize,
            lineHeight: isLandscape ? 1.02 : 0.96,
            fontWeight: 900,
            letterSpacing: 0,
            maxWidth: '100%',
          }}
        >
          {scene.headline}
        </div>
        <div style={{ marginTop: isLandscape ? 12 : 18, display: 'grid', gap: isLandscape ? 6 : 8 }}>
          {captionLines.map((line) => (
            <div
              key={line}
              style={{
                display: 'inline-flex',
                width: 'fit-content',
                maxWidth: '100%',
                padding: useCompactCaption ? '7px 12px' : isLandscape ? '7px 11px' : '9px 13px',
                borderRadius: useCompactCaption ? 999 : isLandscape ? 8 : 10,
                background: useCompactCaption ? 'rgba(8,9,10,0.52)' : 'rgba(8,9,10,0.66)',
                border: '1px solid rgba(255,255,255,0.16)',
                color: '#ffffff',
                fontSize: activeCaptionSize,
                lineHeight: 1.16,
                fontWeight: 800,
                backdropFilter: 'blur(10px)',
              }}
            >
              {line}
            </div>
          ))}
        </div>
        {!useCompactCaption && (scene.cta || progress > 0.72) && (
          <div
            style={{
              display: useCompactCaption ? 'none' : 'inline-flex',
              marginTop: isLandscape ? 16 : 30,
              width: 'fit-content',
              padding: isLandscape ? '10px 16px' : '14px 22px',
              borderRadius: isLandscape ? 10 : 12,
              background: styleAccent,
              color: '#16110a',
              fontSize: captionSize,
              fontWeight: 900,
            }}
          >
            {scene.cta ?? props.cta}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
}
