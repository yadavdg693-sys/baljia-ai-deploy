import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createLogger } from '@/lib/logger';

const execFileAsync = promisify(execFile);
const log = createLogger('Supertonic');

const DEFAULT_PYTHON_COMMAND = 'python';
const DEFAULT_VOICE = 'F3';
const DEFAULT_LANG = 'en';
const DEFAULT_STEPS = 5;
const DEFAULT_SPEED = 1.05;

export interface SupertonicTextToSpeechOptions {
  voice?: string;
  lang?: string;
  steps?: number;
  speed?: number;
}

export interface SupertonicAudioResult {
  audio: Buffer;
  contentType: string;
  voice: string;
}

interface SupertonicPayload {
  text: string;
  voice: string;
  lang: string;
  steps: number;
  speed: number;
}

export function isSupertonicConfigured(): boolean {
  return process.env.PROMO_VIDEO_TTS_PROVIDER?.trim().toLowerCase() === 'supertonic'
    || process.env.SUPERTONIC_ENABLED?.trim().toLowerCase() === 'true';
}

function supertonicPythonCommand(): string {
  return process.env.SUPERTONIC_PYTHON_COMMAND?.trim()
    || process.env.PYTHON_COMMAND?.trim()
    || DEFAULT_PYTHON_COMMAND;
}

function optionNumber(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function buildSupertonicPayload(
  text: string,
  options: SupertonicTextToSpeechOptions = {},
): SupertonicPayload {
  const voice = options.voice?.trim() || process.env.SUPERTONIC_VOICE?.trim() || DEFAULT_VOICE;
  const lang = options.lang?.trim() || process.env.SUPERTONIC_LANG?.trim() || DEFAULT_LANG;
  const steps = optionNumber(options.steps, envNumber('SUPERTONIC_STEPS', DEFAULT_STEPS));
  const speed = optionNumber(options.speed, envNumber('SUPERTONIC_SPEED', DEFAULT_SPEED));

  return {
    text,
    voice,
    lang,
    steps,
    speed,
  };
}

export function buildSupertonicPythonScript(): string {
  return String.raw`
import json
import sys

from supertonic import TTS


def main():
    input_path = sys.argv[1]
    output_path = sys.argv[2]
    with open(input_path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)

    tts = TTS(auto_download=True)
    style = tts.get_voice_style(voice_name=payload["voice"])
    wav, duration = tts.synthesize(
        text=payload["text"],
        lang=payload["lang"],
        voice_style=style,
        total_steps=int(payload["steps"]),
        speed=float(payload["speed"]),
    )
    tts.save_audio(wav, output_path)
    try:
        rendered_duration = float(duration[0])
    except Exception:
        rendered_duration = None
    print(json.dumps({"duration": rendered_duration, "voice": payload["voice"]}))


if __name__ == "__main__":
    main()
`.trimStart();
}

export async function textToSpeech(
  text: string,
  options: SupertonicTextToSpeechOptions = {},
): Promise<SupertonicAudioResult> {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) throw new Error('Supertonic text-to-speech requires non-empty text');

  const tempDir = await mkdtemp(join(tmpdir(), 'baljia-supertonic-'));
  const inputPath = join(tempDir, 'input.json');
  const scriptPath = join(tempDir, 'render_supertonic.py');
  const outputPath = join(tempDir, 'voiceover.wav');
  const payload = buildSupertonicPayload(trimmed, options);
  const command = supertonicPythonCommand();

  try {
    await writeFile(inputPath, JSON.stringify(payload), 'utf8');
    await writeFile(scriptPath, buildSupertonicPythonScript(), 'utf8');

    await execFileAsync(command, [scriptPath, inputPath, outputPath], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      timeout: Number(process.env.SUPERTONIC_TIMEOUT_MS ?? 10 * 60_000),
      maxBuffer: 1024 * 1024 * 10,
      windowsHide: true,
    });

    const audio = await readFile(outputPath);
    if (audio.byteLength === 0) throw new Error('Supertonic text-to-speech returned empty audio');
    log.info('Supertonic voiceover generated', { bytes: audio.byteLength, voice: payload.voice });
    return {
      audio,
      contentType: 'audio/wav',
      voice: payload.voice,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Supertonic text-to-speech failed: ${message.slice(0, 800)}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
