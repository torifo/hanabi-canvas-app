import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SoundEngine } from '../src/audio/SoundEngine';
import type { MoodProfile } from '../src/types';

type Automation = {
  kind: 'set' | 'target' | 'ramp' | 'cancel';
  value?: number;
  time: number;
  timeConstant?: number;
};

class FakeAudioParam {
  value = 0;
  readonly automation: Automation[] = [];

  setValueAtTime(value: number, time: number): void {
    this.value = value;
    this.automation.push({ kind: 'set', value, time });
  }

  setTargetAtTime(value: number, time: number, timeConstant: number): void {
    this.value = value;
    this.automation.push({ kind: 'target', value, time, timeConstant });
  }

  exponentialRampToValueAtTime(value: number, time: number): void {
    this.value = value;
    this.automation.push({ kind: 'ramp', value, time });
  }

  cancelScheduledValues(time: number): void {
    this.automation.push({ kind: 'cancel', time });
  }
}

class FakeNode {
  connect(destination: unknown): unknown {
    return destination;
  }

  disconnect(): void {}
}

class FakeGainNode extends FakeNode {
  readonly gain = new FakeAudioParam();
}

class FakeFilterNode extends FakeNode {
  type: BiquadFilterType = 'lowpass';
  readonly frequency = new FakeAudioParam();
  readonly Q = new FakeAudioParam();
}

class FakeSourceNode extends FakeNode {
  buffer: AudioBuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  readonly starts: number[] = [];

  start(when = 0): void {
    this.starts.push(when);
  }

  stop(): void {}
}

class FakeOscillatorNode extends FakeNode {
  type: OscillatorType = 'sine';
  readonly frequency = new FakeAudioParam();
  readonly starts: number[] = [];
  readonly stops: number[] = [];

  start(when = 0): void {
    this.starts.push(when);
  }

  stop(when = 0): void {
    this.stops.push(when);
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];

  state: AudioContextState = 'suspended';
  onstatechange: (() => void) | null = null;
  readonly sampleRate = 48_000;
  readonly currentTime = 4;
  readonly destination = new FakeNode();
  readonly gains: FakeGainNode[] = [];
  readonly filters: FakeFilterNode[] = [];
  readonly sources: FakeSourceNode[] = [];
  readonly oscillators: FakeOscillatorNode[] = [];
  readonly resume = vi.fn(async () => {
    this.state = 'running';
  });
  readonly close = vi.fn(async () => {
    this.state = 'closed';
  });
  readonly decodeAudioData = vi.fn(async () => ({ duration: 8 } as AudioBuffer));

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createGain(): FakeGainNode {
    const node = new FakeGainNode();
    this.gains.push(node);
    return node;
  }

  createBiquadFilter(): FakeFilterNode {
    const node = new FakeFilterNode();
    this.filters.push(node);
    return node;
  }

  createBufferSource(): FakeSourceNode {
    const node = new FakeSourceNode();
    this.sources.push(node);
    return node;
  }

  createOscillator(): FakeOscillatorNode {
    const node = new FakeOscillatorNode();
    this.oscillators.push(node);
    return node;
  }

  addEventListener(type: string, handler: () => void): void {
    if (type === 'statechange') this.onstatechange = handler;
  }

  removeEventListener(type: string, handler: () => void): void {
    if (type === 'statechange' && this.onstatechange === handler) this.onstatechange = null;
  }
}

const quiet: MoodProfile = {
  id: 'quiet',
  bloomStrength: 0.8,
  colorGrade: 'cyan-darknavy',
  particleSpeed: 0.5,
  lowpassFreq: 900,
};

const sparkle: MoodProfile = {
  id: 'sparkle',
  bloomStrength: 1.8,
  colorGrade: 'sunset-navy',
  particleSpeed: 1,
  lowpassFreq: null,
};

let addEventListener: ReturnType<typeof vi.fn>;
let visibilityChange: (() => void) | undefined;
let documentDouble: { hidden: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };

beforeEach(() => {
  FakeAudioContext.instances = [];
  addEventListener = vi.fn();
  visibilityChange = undefined;
  documentDouble = {
    hidden: false,
    addEventListener: vi.fn((type: string, handler: () => void) => {
      if (type === 'visibilitychange') visibilityChange = handler;
    }),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('window', {
    AudioContext: FakeAudioContext,
    addEventListener,
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('document', documentDouble);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function context(index = 0): FakeAudioContext {
  const instance = FakeAudioContext.instances[index];
  if (!instance) throw new Error('SoundEngine did not construct an AudioContext.');
  return instance;
}

function lastTarget(param: FakeAudioParam): Automation | undefined {
  return [...param.automation].reverse().find((entry) => entry.kind === 'target');
}

describe('SoundEngine', () => {
  it('returns from init without waiting for assets and can synthesize the first sparkle', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
    const sound = new SoundEngine();

    const initialized = sound.init();
    const audio = context();
    expect(audio.gains).toHaveLength(3);
    expect(audio.filters).toHaveLength(1);
    expect(audio.resume).toHaveBeenCalledTimes(1);

    await expect(initialized).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(5);

    sound.playSparkle();
    expect(audio.oscillators).toHaveLength(1);
    expect(audio.oscillators[0]?.starts).toEqual([4]);
  });

  it('eases ambience gain and lowpass values for both moods', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    const sound = new SoundEngine();
    await sound.init();
    const audio = context();

    sound.setMood(quiet);
    expect(lastTarget(audio.gains[1]!.gain)).toMatchObject({
      value: 0.48,
      time: 4,
      timeConstant: 0.4,
    });
    expect(lastTarget(audio.filters[0]!.frequency)).toMatchObject({
      value: 900,
      time: 4,
      timeConstant: 0.4,
    });

    sound.setMood(sparkle);
    expect(lastTarget(audio.gains[1]!.gain)).toMatchObject({ value: 0.68, timeConstant: 0.4 });
    expect(lastTarget(audio.filters[0]!.frequency)).toMatchObject({ value: 23_900, timeConstant: 0.4 });
  });

  it('eases the master gain for mute and unmute', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    const sound = new SoundEngine();
    await sound.init();
    const masterGain = context().gains[0]!.gain;

    sound.setMuted(true);
    expect(lastTarget(masterGain)).toMatchObject({ value: 0.0001, time: 4, timeConstant: 0.16 });
    sound.setMuted(false);
    expect(lastTarget(masterGain)).toMatchObject({ value: 0.78, time: 4, timeConstant: 0.16 });
  });

  it('keeps mute ownership in AppCore by not subscribing to DOM mute events', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    const sound = new SoundEngine();
    await sound.init();

    expect(addEventListener).not.toHaveBeenCalledWith('hanabi:mute', expect.any(Function));
  });

  it('safely resumes once after an iOS interruption or visible foreground return', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    const sound = new SoundEngine();
    await sound.init();
    const audio = context();
    expect(visibilityChange).toBeTypeOf('function');

    audio.state = 'interrupted' as AudioContextState;
    audio.onstatechange?.();
    audio.onstatechange?.();
    await vi.waitFor(() => expect(audio.resume).toHaveBeenCalledTimes(2));

    documentDouble.hidden = true;
    audio.state = 'suspended';
    audio.onstatechange?.();
    expect(audio.resume).toHaveBeenCalledTimes(2);

    documentDouble.hidden = false;
    visibilityChange?.();
    await vi.waitFor(() => expect(audio.resume).toHaveBeenCalledTimes(3));
  });

  it('removes interruption and visibility listeners on disposal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    const sound = new SoundEngine();
    await sound.init();
    const audio = context();
    expect(audio.onstatechange).toBeTypeOf('function');

    sound.dispose();
    expect(audio.onstatechange).toBeNull();
    expect(documentDouble.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it('drops old asset completions after dispose and a later init', async () => {
    let resolveFirstFetch: ((response: { ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> }) => void) | undefined;
    const firstFetch = new Promise<{ ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> }>((resolve) => {
      resolveFirstFetch = resolve;
    });
    let loadingOldGeneration = true;
    vi.stubGlobal('fetch', vi.fn(() => (
      loadingOldGeneration ? firstFetch : new Promise<Response>(() => undefined)
    )));
    const sound = new SoundEngine();
    await sound.init();
    const firstContext = context();

    sound.dispose();
    loadingOldGeneration = false;
    await sound.init();
    const secondContext = context(1);
    resolveFirstFetch?.({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(10));
    expect(firstContext.decodeAudioData).not.toHaveBeenCalled();
    expect(secondContext.decodeAudioData).not.toHaveBeenCalled();
    expect(firstContext.sources).toHaveLength(0);
    expect(secondContext.sources).toHaveLength(0);

    sound.playSparkle();
    expect(secondContext.oscillators).toHaveLength(1);
    expect(secondContext.sources).toHaveLength(0);
  });

  it('can retry initialization after a transient constructor failure', async () => {
    const AudioContextConstructor = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('device unavailable');
      })
      .mockImplementation(() => new FakeAudioContext());
    vi.stubGlobal('window', {
      AudioContext: AudioContextConstructor,
      addEventListener,
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    const sound = new SoundEngine();

    await expect(sound.init()).rejects.toThrow('device unavailable');
    await expect(sound.init()).resolves.toBeUndefined();
    expect(AudioContextConstructor).toHaveBeenCalledTimes(2);
  });

  it('continues with the remaining ambience tracks when one asset fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: !url.includes('crackle-loop.wav'),
      arrayBuffer: async () => new ArrayBuffer(8),
    })));
    const sound = new SoundEngine();
    await sound.init();

    await vi.waitFor(() => expect(context().sources).toHaveLength(3));
    expect(context().sources.every((source) => source.loop && source.starts.length === 1)).toBe(true);
  });
});
