import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { getEffectiveDbPath } from './dbLocation';

/** Spoken clips live beside the active database, same as portraits. */
export function getTtsDir(): string {
  return path.join(path.dirname(getEffectiveDbPath()), 'tts');
}

export function isTtsLibraryPath(filePath: string): boolean {
  const dir = getTtsDir();
  const resolved = path.resolve(filePath);
  return resolved === dir || resolved.startsWith(dir + path.sep);
}

/** Best-effort unlink -- an orphaned WAV is wasted disk, not a correctness problem. */
export function deleteTtsAudioFile(filePath: string | null | undefined): void {
  if (!filePath || !isTtsLibraryPath(filePath)) return;
  try {
    fs.unlinkSync(filePath);
  } catch {
    // already gone, or in use
  }
}

export function writeTtsWav(bytes: Buffer): string {
  const dir = getTtsDir();
  fs.mkdirSync(dir, { recursive: true });
  const destPath = path.join(dir, `${uuidv4()}.wav`);
  fs.writeFileSync(destPath, bytes);
  return destPath;
}

interface WavFormat {
  audioFormat: number;
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
  data: Buffer;
}

function parseWav(buf: Buffer): WavFormat {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a WAV file');
  }
  let offset = 12;
  let audioFormat = 1;
  let numChannels = 1;
  let sampleRate = 24000;
  let bitsPerSample = 16;
  let data: Buffer | null = null;
  let sawFmt = false;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = Math.min(start + size, buf.length);
    if (id === 'fmt ' && size >= 16) {
      audioFormat = buf.readUInt16LE(start);
      numChannels = buf.readUInt16LE(start + 2);
      sampleRate = buf.readUInt32LE(start + 4);
      bitsPerSample = buf.readUInt16LE(start + 14);
      sawFmt = true;
    } else if (id === 'data') {
      data = buf.subarray(start, end);
    }
    offset = start + size + (size % 2);
  }
  if (!sawFmt || !data) throw new Error('WAV missing fmt or data chunk');
  return { audioFormat, numChannels, sampleRate, bitsPerSample, data };
}

function encodeWav(pcm: Buffer, fmt: Omit<WavFormat, 'data'>): Buffer {
  const headerSize = 44;
  const buf = Buffer.alloc(headerSize + pcm.length);
  const byteRate = fmt.sampleRate * fmt.numChannels * (fmt.bitsPerSample / 8);
  const blockAlign = fmt.numChannels * (fmt.bitsPerSample / 8);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + pcm.length, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(fmt.audioFormat, 20);
  buf.writeUInt16LE(fmt.numChannels, 22);
  buf.writeUInt32LE(fmt.sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(fmt.bitsPerSample, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(pcm.length, 40);
  pcm.copy(buf, 44);
  return buf;
}

/** Joins same-format PCM WAVs. A single clip is returned unchanged. */
export function concatenateWavBuffers(clips: Buffer[]): Buffer {
  if (clips.length === 0) throw new Error('No audio clips');
  if (clips.length === 1) return clips[0];
  const parsed = clips.map(parseWav);
  const first = parsed[0];
  for (const clip of parsed) {
    if (
      clip.audioFormat !== first.audioFormat ||
      clip.numChannels !== first.numChannels ||
      clip.sampleRate !== first.sampleRate ||
      clip.bitsPerSample !== first.bitsPerSample
    ) {
      throw new Error('Audio clips have different formats');
    }
  }
  return encodeWav(Buffer.concat(parsed.map((clip) => clip.data)), first);
}
