import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const audioDirectory = resolve(here, '../public/audio');
const sampleRate = 22_050;
const durationSeconds = 8;
const sampleCount = sampleRate * durationSeconds;

/** Deterministic but non-repeating-at-short-intervals random sequence. */
function mulberry32(seed) {
  return () => {
    let value = (seed += 0x6D2B79F5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function whiteNoise(length, seed) {
  const random = mulberry32(seed);
  const samples = new Float32Array(length);
  for (let index = 0; index < length; index += 1) samples[index] = random() * 2 - 1;
  return samples;
}

/**
 * A circular blur keeps the beginning and end of a loop in the same filter
 * history. It gives us broad-band, non-musical texture without a loop click.
 */
function smoothCircular(input, passes) {
  // Keep the caller's texture intact: bandNoise subtracts the slower filtered
  // copy from this one. Reusing input as the ping-pong buffer would overwrite
  // it whenever passes is even and silently turn that band into silence.
  let current = Float32Array.from(input);
  let next = new Float32Array(input.length);
  for (let pass = 0; pass < passes; pass += 1) {
    const last = current.length - 1;
    for (let index = 0; index < current.length; index += 1) {
      const previous = current[index === 0 ? last : index - 1];
      const following = current[index === last ? 0 : index + 1];
      next[index] = previous * 0.25 + current[index] * 0.5 + following * 0.25;
    }
    [current, next] = [next, current];
  }
  return current;
}

function normalizeRms(samples, target) {
  let power = 0;
  for (const sample of samples) power += sample * sample;
  const scale = target / Math.max(Math.sqrt(power / samples.length), 0.000001);
  for (let index = 0; index < samples.length; index += 1) samples[index] *= scale;
  return samples;
}

function bandNoise(length, seed, smoothingPasses, removeLowPasses, rms) {
  const fast = smoothCircular(whiteNoise(length, seed), smoothingPasses);
  const slow = smoothCircular(fast, removeLowPasses);
  const result = new Float32Array(length);
  for (let index = 0; index < result.length; index += 1) result[index] = fast[index] - slow[index];
  return normalizeRms(result, rms);
}

/** Match both samples at the loop point while spreading the correction gently. */
function sealLoop(samples, span = 384) {
  const midpoint = (samples[0] + samples[samples.length - 1]) / 2;
  const startDelta = midpoint - samples[0];
  const endDelta = midpoint - samples[samples.length - 1];
  for (let index = 0; index < span; index += 1) {
    const weight = ((span - index) / span) ** 2;
    samples[index] += startDelta * weight;
    samples[samples.length - 1 - index] += endDelta * weight;
  }
  return samples;
}

function limitPeak(samples, peak = 0.52) {
  let maximum = 0;
  for (const sample of samples) maximum = Math.max(maximum, Math.abs(sample));
  const scale = maximum > peak ? peak / maximum : 1;
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.max(-0.95, Math.min(0.95, samples[index] * scale));
  }
  return samples;
}

function circularDistance(time, center) {
  const difference = Math.abs(time - center);
  return Math.min(difference, durationSeconds - difference);
}

function createWaves() {
  // No permanent noise bed: four irregular washes leave real quiet between
  // them. A stationary broad-band loop reads as an air conditioner or fan.
  const undertow = normalizeRms(smoothCircular(whiteNoise(sampleCount, 13), 360), 0.002);
  const spray = bandNoise(sampleCount, 17, 14, 130, 0.09);
  const washes = [
    { center: 0.42, width: 0.28, level: 0.84 },
    { center: 2.26, width: 0.48, level: 0.54 },
    { center: 4.73, width: 0.34, level: 0.72 },
    { center: 6.77, width: 0.56, level: 0.62 },
  ];
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / sampleRate;
    let envelope = 0.015;
    for (const wash of washes) {
      const distance = circularDistance(time, wash.center);
      envelope += wash.level * Math.exp(-(distance * distance) / (2 * wash.width * wash.width));
    }
    samples[index] = undertow[index] + spray[index] * envelope;
  }
  return limitPeak(sealLoop(samples));
}

function createRain() {
  // Sparse grains preserve the sense of distant rain without a constant hiss.
  const grain = bandNoise(sampleCount, 29, 2, 54, 0.14);
  const random = mulberry32(103);
  const samples = new Float32Array(sampleCount);
  for (let drop = 0; drop < 92; drop += 1) {
    const center = Math.floor(random() * sampleCount);
    const width = Math.round(sampleRate * (0.003 + random() * 0.014));
    const level = 0.14 + random() * 0.42;
    for (let offset = -width; offset <= width; offset += 1) {
      const index = (center + offset + sampleCount) % sampleCount;
      const envelope = Math.max(0, 1 - Math.abs(offset) / width) ** 3;
      samples[index] += grain[index] * envelope * level;
    }
  }
  return limitPeak(sealLoop(samples));
}

function createNightTexture() {
  // The former two-tone insect chirp was perceived as an alarm. Keep only a
  // barely audible, unpitched night-air texture.
  return limitPeak(sealLoop(bandNoise(sampleCount, 41, 10, 135, 0.008)));
}

function createCrackle() {
  const bed = bandNoise(sampleCount, 71, 8, 100, 0.006);
  const grain = bandNoise(sampleCount, 73, 1, 22, 0.12);
  const samples = new Float32Array(sampleCount);
  for (let spark = 0; spark < 18; spark += 1) {
    const center = Math.floor(((spark * 0.61803398875 + 0.11) % 1) * sampleCount);
    const width = Math.round(sampleRate * (0.012 + ((spark * 37) % 23) / 1_000));
    for (let offset = -width; offset <= width; offset += 1) {
      const index = (center + offset + sampleCount) % sampleCount;
      const envelope = Math.max(0, 1 - Math.abs(offset) / width) ** 2;
      samples[index] += grain[index] * envelope * 0.9;
    }
  }
  for (let index = 0; index < samples.length; index += 1) samples[index] += bed[index];
  return limitPeak(sealLoop(samples));
}

function createSparkle() {
  const length = Math.floor(sampleRate * 0.4);
  const samples = new Float32Array(length);
  const partials = [
    { frequency: 1046.5, level: 0.2, decay: 9.5 }, // C6
    { frequency: 1569.75, level: 0.07, decay: 12.5 }, // G6 — a consonant fifth
    { frequency: 2093, level: 0.025, decay: 17 }, // C7
  ];
  for (let index = 0; index < length; index += 1) {
    const time = index / sampleRate;
    const attack = Math.sin(Math.PI * Math.min(1, time / 0.022) / 2);
    for (const partial of partials) {
      samples[index] += Math.sin(Math.PI * 2 * partial.frequency * time)
        * partial.level
        * attack
        * Math.exp(-time * partial.decay);
    }
  }
  return limitPeak(samples, 0.32);
}

function createSamples(kind) {
  if (kind === 'waves') return createWaves();
  if (kind === 'rain') return createRain();
  if (kind === 'insects') return createNightTexture();
  if (kind === 'crackle') return createCrackle();
  throw new Error(`Unknown loop type: ${kind}`);
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
await writeFile(resolve(audioDirectory, 'sparkle.wav'), wavBuffer(createSparkle()));
console.log(`Generated self-authored procedural audio in ${audioDirectory}`);
