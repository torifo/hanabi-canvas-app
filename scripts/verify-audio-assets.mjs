import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const audioDirectory = resolve(import.meta.dirname, '../public/audio');
const loops = ['crackle-loop.wav', 'waves-loop.wav', 'rain-loop.wav', 'insects-loop.wav'];

for (const file of [...loops, 'sparkle.wav']) {
  test(`${file} is a mono 22.05kHz PCM WAV asset`, async () => {
    const wav = await readFile(resolve(audioDirectory, file));
    assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(wav.subarray(8, 12).toString('ascii'), 'WAVE');
    assert.equal(wav.readUInt16LE(20), 1);
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt32LE(24), 22_050);
    assert.equal(wav.readUInt16LE(34), 16);
    const samples = wav.readUInt32LE(40) / 2;
    let power = 0;
    for (let index = 0; index < samples; index += 1) {
      const value = wav.readInt16LE(44 + index * 2) / 32_768;
      power += value * value;
    }
    assert.ok(Math.sqrt(power / samples) > 0.001, 'asset must contain audible signal');
  });
}

for (const file of loops) {
  test(`${file} is an eight-second periodic loop`, async () => {
    const wav = await readFile(resolve(audioDirectory, file));
    const samples = wav.readUInt32LE(40) / 2;
    assert.equal(samples, 22_050 * 8);
    const firstSample = wav.readInt16LE(44);
    const lastSample = wav.readInt16LE(44 + (samples - 1) * 2);
    assert.equal(lastSample, firstSample, 'loop boundary must not introduce a click');
  });
}
