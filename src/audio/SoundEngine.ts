import { MOOD_TRANSITION_MS, type MoodProfile, type SoundEngine as SoundEngineContract } from '../types';

type TrackId = 'crackle' | 'waves' | 'rain' | 'insects';

interface TrackDefinition {
  id: TrackId;
  file: string;
  gain: number;
}

interface ActiveTrack {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

const TRACKS: readonly TrackDefinition[] = [
  { id: 'crackle', file: 'crackle-loop.wav', gain: 0.13 },
  { id: 'waves', file: 'waves-loop.wav', gain: 0.21 },
  { id: 'rain', file: 'rain-loop.wav', gain: 0.16 },
  { id: 'insects', file: 'insects-loop.wav', gain: 0.09 },
];

const QUIET_AMBIENT_GAIN = 0.48;
const SPARKLE_AMBIENT_GAIN = 0.68;
const MUTED_GAIN = 0.0001;
// Mobile speaker calibration: the four ambience tracks can sum to 0.59 before
// mood scaling.  0.59 × 0.68 × 0.78 ≈ 0.31 leaves headroom for the sparkle
// one-shot instead of asking small iPhone/Android speakers to reproduce a
// brittle, clipped peak. Adjust only after listening on real mobile hardware.
const MOBILE_SPEAKER_MASTER_GAIN = 0.78;
// 契約 D4: ムード遷移は MOOD_TRANSITION_MS (1200ms) を graphics と共用。
// setTargetAtTime は指数収束のため、遷移時間の 1/3 を時定数とする (3τ ≒ 95% 収束)
const TRANSITION_SECONDS = MOOD_TRANSITION_MS / 3000;

/**
 * Web Audio implementation used by AppCore.
 *
 * Ambient assets are generated in-repository and are periodic WAVs.  The
 * buffers can therefore use native loop points without introducing a fade or
 * re-scheduling gap at each iteration.  Every track has an independent gain,
 * while one shared filter and master gain make mood changes coherent.
 */
export class SoundEngine implements SoundEngineContract {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private ambienceGain: GainNode | null = null;
  private lowpass: BiquadFilterNode | null = null;
  private sparkleGain: GainNode | null = null;
  private readonly tracks = new Map<TrackId, ActiveTrack>();
  private sparkleBuffer: AudioBuffer | null = null;
  private initPromise: Promise<void> | null = null;
  private initialized = false;
  private lifecycle = 0;
  private resumePromise: Promise<void> | null = null;
  private resumeRetryQueued = false;
  private muted = false;
  private mood: MoodProfile | null = null;
  private readonly onVisibilityChange = (): void => {
    if (!document.hidden) void this.resumeIfNeeded();
  };

  async init(): Promise<void> {
    if (this.initialized) {
      await this.resumeIfNeeded();
      return;
    }

    if (!this.initPromise) {
      this.initPromise = this.initialize().catch((error: unknown) => {
        this.initPromise = null;
        throw error;
      });
    }

    await this.initPromise;
  }

  setMood(profile: MoodProfile): void {
    this.mood = profile;
    if (!this.context || !this.ambienceGain || !this.lowpass) {
      return;
    }

    const now = this.context.currentTime;
    const targetGain = profile.id === 'quiet' ? QUIET_AMBIENT_GAIN : SPARKLE_AMBIENT_GAIN;
    this.smoothParameter(this.ambienceGain.gain, targetGain, now);

    // A near-Nyquist cutoff is an audible no-op, so this is effectively a
    // bypass without disconnecting and reconnecting the graph mid-transition.
    const bypassFrequency = Math.max(1_000, this.context.sampleRate / 2 - 100);
    const targetFrequency = profile.lowpassFreq ?? bypassFrequency;
    this.smoothParameter(this.lowpass.frequency, targetFrequency, now);
    this.smoothParameter(this.lowpass.Q, profile.lowpassFreq === null ? 0.0001 : 0.45, now);
  }

  playSparkle(): void {
    if (!this.context || !this.sparkleGain || this.muted) {
      return;
    }

    void this.resumeIfNeeded();
    const now = this.context.currentTime;
    if (this.sparkleBuffer) {
      const source = this.context.createBufferSource();
      source.buffer = this.sparkleBuffer;
      const gain = this.context.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.28, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + Math.min(this.sparkleBuffer.duration, 0.36));
      source.connect(gain).connect(this.sparkleGain);
      source.start(now);
      return;
    }

    this.playSynthesizedSparkle(now);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!this.context || !this.masterGain) {
      return;
    }

    this.smoothParameter(
      this.masterGain.gain,
      muted ? MUTED_GAIN : MOBILE_SPEAKER_MASTER_GAIN,
      this.context.currentTime,
      0.16
    );
  }

  dispose(): void {
    // Invalidate pending fetch/decode tasks before tearing down the graph.
    // They may resolve after a later init() has created a new AudioContext.
    this.lifecycle += 1;
    this.resumePromise = null;
    this.resumeRetryQueued = false;
    for (const { source, gain } of this.tracks.values()) {
      try {
        source.stop();
      } catch {
        // A source may already have been stopped while closing the context.
      }
      source.disconnect();
      gain.disconnect();
    }
    this.tracks.clear();

    this.sparkleGain?.disconnect();
    this.ambienceGain?.disconnect();
    this.lowpass?.disconnect();
    this.masterGain?.disconnect();

    const context = this.context;
    context?.removeEventListener('statechange', this.onContextStateChange);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
    this.context = null;
    this.masterGain = null;
    this.ambienceGain = null;
    this.lowpass = null;
    this.sparkleGain = null;
    this.sparkleBuffer = null;
    this.initialized = false;
    this.initPromise = null;

    if (context && context.state !== 'closed') {
      void context.close().catch(() => undefined);
    }
  }

  private async initialize(): Promise<void> {
    const AudioContextConstructor = window.AudioContext ?? (window as Window & {
      webkitAudioContext?: typeof AudioContext;
    }).webkitAudioContext;
    if (!AudioContextConstructor) {
      throw new Error('Web Audio API is not supported by this browser.');
    }

    const context = new AudioContextConstructor();
    const masterGain = context.createGain();
    const ambienceGain = context.createGain();
    const lowpass = context.createBiquadFilter();
    const sparkleGain = context.createGain();

    lowpass.type = 'lowpass';
    lowpass.frequency.value = Math.max(1_000, context.sampleRate / 2 - 100);
    lowpass.Q.value = 0.0001;
    masterGain.gain.value = this.muted ? MUTED_GAIN : MOBILE_SPEAKER_MASTER_GAIN;
    ambienceGain.gain.value = SPARKLE_AMBIENT_GAIN;
    sparkleGain.gain.value = 0.8;

    ambienceGain.connect(lowpass);
    sparkleGain.connect(lowpass);
    lowpass.connect(masterGain);
    masterGain.connect(context.destination);

    this.context = context;
    this.masterGain = masterGain;
    this.ambienceGain = ambienceGain;
    this.lowpass = lowpass;
    this.sparkleGain = sparkleGain;

    this.initialized = true;
    const lifecycle = ++this.lifecycle;
    context.addEventListener('statechange', this.onContextStateChange);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
    if (this.mood) {
      this.setMood(this.mood);
    }

    // The graph is ready before any fetch starts. A first pointer gesture can
    // therefore schedule the synthesized sparkle immediately; ambience and
    // the authored one-shot replace it only after their background loads end.
    void this.loadAssetsInBackground(lifecycle);
    await this.resumeIfNeeded();
  }

  private async loadAssetsInBackground(lifecycle: number): Promise<void> {
    const context = this.requireContext();
    const sparkle = this.loadBuffer('sparkle.wav', lifecycle, context)
      .then((buffer) => {
        if (this.isCurrentLifecycle(lifecycle)) {
          this.sparkleBuffer = buffer;
        }
      })
      .catch(() => undefined);
    // Track errors intentionally remain isolated: an offline cache miss or a
    // malformed asset must not prevent the other ambience layers from playing.
    await Promise.allSettled([
      ...TRACKS.map((track) => this.loadAndStartTrack(track, lifecycle, context)),
      sparkle,
    ]);
  }

  private async loadAndStartTrack(
    track: TrackDefinition,
    lifecycle: number,
    context: AudioContext
  ): Promise<void> {
    const ambienceGain = this.requireAmbienceGain();
    const buffer = await this.loadBuffer(track.file, lifecycle, context);
    if (!this.isCurrentLifecycle(lifecycle) || this.context !== context || this.ambienceGain !== ambienceGain) {
      return;
    }
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = buffer.duration;
    const startAt = context.currentTime;
    gain.gain.setValueAtTime(MUTED_GAIN, startAt);
    gain.gain.exponentialRampToValueAtTime(track.gain, startAt + 0.12);
    source.connect(gain).connect(ambienceGain);
    source.start(startAt);
    this.tracks.set(track.id, { source, gain });
  }

  private async loadBuffer(file: string, lifecycle: number, context: AudioContext): Promise<AudioBuffer> {
    const response = await fetch(`${import.meta.env.BASE_URL}audio/${file}`);
    if (!response.ok) {
      throw new Error(`Could not load audio asset: ${file}`);
    }
    const encoded = await response.arrayBuffer();
    if (!this.isCurrentLifecycle(lifecycle) || this.context !== context) {
      throw new Error(`Discarded stale audio asset: ${file}`);
    }
    return context.decodeAudioData(encoded);
  }

  private playSynthesizedSparkle(now: number): void {
    const context = this.requireContext();
    const output = this.requireSparkleGain();
    const gain = context.createGain();
    const oscillator = context.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(1_540, now);
    oscillator.frequency.exponentialRampToValueAtTime(640, now + 0.16);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.15, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    oscillator.connect(gain).connect(output);
    oscillator.start(now);
    oscillator.stop(now + 0.2);
  }

  private smoothParameter(parameter: AudioParam, value: number, now: number, timeConstant = TRANSITION_SECONDS): void {
    parameter.cancelScheduledValues(now);
    parameter.setTargetAtTime(Math.max(MUTED_GAIN, value), now, timeConstant);
  }

  private async resumeIfNeeded(): Promise<void> {
    const context = this.context;
    if (!context || !isResumableState(context.state)) return;
    if (this.resumePromise) {
      // A foreground event can race with completion of a prior resume. Queue
      // one follow-up attempt instead of issuing concurrent resume() calls.
      this.resumeRetryQueued = true;
      return this.resumePromise;
    }

    try {
      let settled: Promise<void>;
      settled = context.resume().catch(() => undefined).finally(() => {
        if (this.resumePromise !== settled) return;
        this.resumePromise = null;
        const retry = this.resumeRetryQueued;
        this.resumeRetryQueued = false;
        if (retry && this.context === context && isResumableState(context.state) && isDocumentVisible()) {
          void this.resumeIfNeeded();
        }
      });
      this.resumePromise = settled;
      return settled;
    } catch {
      // Some iOS interruption paths throw synchronously. The next visible
      // gesture/statechange will retry without breaking the visual experience.
    }
  }

  private readonly onContextStateChange = (): void => {
    if (!this.context || !isResumableState(this.context.state)) return;
    if (!isDocumentVisible()) return;
    void this.resumeIfNeeded();
  };

  private isCurrentLifecycle(lifecycle: number): boolean {
    return this.initialized && this.lifecycle === lifecycle && this.context !== null;
  }

  private requireContext(): AudioContext {
    if (!this.context) throw new Error('SoundEngine has not been initialized.');
    return this.context;
  }

  private requireAmbienceGain(): GainNode {
    if (!this.ambienceGain) throw new Error('SoundEngine has not been initialized.');
    return this.ambienceGain;
  }

  private requireSparkleGain(): GainNode {
    if (!this.sparkleGain) throw new Error('SoundEngine has not been initialized.');
    return this.sparkleGain;
  }
}

function isResumableState(state: AudioContextState | 'interrupted'): boolean {
  // WebKit exposes the non-standard-but-documented `interrupted` state during
  // calls, route changes, and other iOS audio-focus interruptions.
  return state === 'suspended' || state === 'interrupted';
}

function isDocumentVisible(): boolean {
  return typeof document === 'undefined' || !document.hidden;
}

export default SoundEngine;
