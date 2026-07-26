import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const audioDirectory = resolve(here, '../public/audio');
const sampleRate = 22_050;
const durationSeconds = 8;
const sampleCount = sampleRate * durationSeconds;

function periodicNoise(sample, seed, harmonics, amplitude) {
  let result = 0;
  for (let harmonic = 1; harmonic <= harmonics; harmonic += 1) {
    const phase = (seed * harmonic * 0.61803398875) % (Math.PI * 2);
    result += Math.sin((Math.PI * 2 * harmonic * sample) / sampleCount + phase) / harmonic;
  }
  return result * amplitude;
}

function createSamples(kind) {
  const samples = new Float32Array(sampleCount);
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const time = sample / sampleRate;
    const loopPhase = sample / sampleCount;
    let value = 0;

    if (kind === 'waves') {
      const swell = 0.55 + 0.45 * Math.sin(Math.PI * 2 * 0.25 * loopPhase - 0.7);
      value = periodicNoise(sample, 13, 33, 0.06) * swell;
      value += Math.sin(Math.PI * 2 * 2 * loopPhase + 0.4) * 0.014;
    } else if (kind === 'rain') {
      value = periodicNoise(sample, 29, 96, 0.075);
      value += periodicNoise(sample, 5, 17, 0.018) * Math.sin(Math.PI * 2 * 3 * loopPhase);
    } else if (kind === 'insects') {
      const chirp = Math.max(0, Math.sin(Math.PI * 2 * 7 * loopPhase)) ** 7;
      value = chirp * (Math.sin(Math.PI * 2 * 3_700 * time) + Math.sin(Math.PI * 2 * 4_280 * time)) * 0.022;
      value += periodicNoise(sample, 41, 9, 0.004);
    } else if (kind === 'crackle') {
      value = periodicNoise(sample, 71, 58, 0.023);
      for (let spark = 0; spark < 17; spark += 1) {
        const center = ((spark * 0.61803398875 + 0.11) % 1) * durationSeconds;
        const distance = Math.min(Math.abs(time - center), durationSeconds - Math.abs(time - center));
        const envelope = Math.exp(-distance * 85);
        value += envelope * Math.sin(Math.PI * 2 * (2_100 + spark * 170) * time) * 0.055;
      }
    } else if (kind === 'sparkle') {
      const envelope = Math.sin(Math.PI * Math.min(1, time / 0.34)) ** 2;
      value = envelope * (
        Math.sin(Math.PI * 2 * (1_900 - time * 2_900) * time) * 0.19 +
        periodicNoise(sample, 97, 28, 0.035)
      );
    }

    samples[sample] = Math.max(-0.95, Math.min(0.95, value));
  }
  return samples;
}

function wavBuffer(samples) {
  const dataSize = samples.length * 2;
  const output = Buffer.alloc(44 + dataSize);
  output.write('RIFF', 0);
  output.writeUInt32LE(36 + dataSize, 4);
  output.write('WAVE', 8);
  output.write('fmt ', 12);
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write('data', 36);
  output.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < samples.length; index += 1) {
    output.writeInt16LE(Math.round(samples[index] * 32_767), 44 + index * 2);
  }
  return output;
}

await mkdir(audioDirectory, { recursive: true });
for (const name of ['crackle', 'waves', 'rain', 'insects']) {
  await writeFile(resolve(audioDirectory, `${name}-loop.wav`), wavBuffer(createSamples(name)));
}
await writeFile(resolve(audioDirectory, 'sparkle.wav'), wavBuffer(createSamples('sparkle').subarray(0, Math.floor(sampleRate * 0.4))));
console.log(`Generated self-authored procedural audio in ${audioDirectory}`);
