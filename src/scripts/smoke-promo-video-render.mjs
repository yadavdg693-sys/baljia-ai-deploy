import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';

const tmp = path.join(os.tmpdir(), `baljia-promo-smoke-${Date.now()}.mp4`);
const serveUrl = await bundle({
  entryPoint: path.join(process.cwd(), 'src', 'remotion', 'promo', 'Root.tsx'),
});

const inputProps = {
  title: 'Smoke',
  companyName: 'Baljia',
  liveUrl: 'https://baljia.app',
  cta: 'Try Baljia',
  scenes: [
    {
      id: 's1',
      duration_seconds: 1,
      headline: 'Meet Baljia',
      caption: 'Demo video smoke',
      narration: 'Demo video smoke',
      asset_ref: null,
      motion: 'push',
    },
    {
      id: 's2',
      duration_seconds: 1,
      headline: 'See it work',
      caption: 'Rendered with Remotion',
      narration: 'Rendered with Remotion',
      asset_ref: null,
      motion: 'zoom',
    },
    {
      id: 's3',
      duration_seconds: 1,
      headline: 'Try Baljia',
      caption: 'Ready to share',
      narration: 'Ready to share',
      asset_ref: null,
      motion: 'hold',
      cta: 'Try Baljia',
    },
  ],
  assets: [],
  width: 540,
  height: 960,
  fps: 30,
  durationInFrames: 90,
  style: 'product_demo',
  aspectRatio: '9:16',
  audioUrl: null,
};

const composition = await selectComposition({
  serveUrl,
  id: 'PromoVideo',
  inputProps,
});

await renderMedia({
  composition,
  serveUrl,
  codec: 'h264',
  outputLocation: tmp,
  inputProps,
});

const stat = await fs.stat(tmp);
if (stat.size <= 0) {
  throw new Error(`Promo video smoke render produced an empty file at ${tmp}`);
}

console.log(JSON.stringify({ output: tmp, size: stat.size }));
await fs.rm(tmp, { force: true });
