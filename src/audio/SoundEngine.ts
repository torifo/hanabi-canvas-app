import { MOOD_TRANSITION_MS, type MoodProfile, type SoundEngine as SoundEngineContract } from '../types';

type TrackId = 'crackle' | 'waves' | 'rain' | 'insects';

interface TrackDefinition {
  id: TrackId;
  file: string;
  sparkleGain: number;
  quietGain: number;
}

interface ActiveTrack {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

const TRACKS: readonly TrackDefinition[] = [
  // Do not present procedural substitutes as a firework recording. These stay
  // muted until a licensed, authored field recording replaces the placeholders.
  { id: 'crackle', file: 'crackle-loop.wav', sparkleGain: 0, quietGain: 0 },
  { id: 'waves', file: 'waves-loop.wav', sparkleGain: 0, quietGain: 0 },
  { id: 'rain', file: 'rain-loop.wav', sparkleGain: 0, quietGain: 0 },
  { id: 'insects', file: 'insects-loop.wav', sparkleGain: 0, quietGain: 0 },
];

const QUIET_AMBIENT_GAIN = 0.48;
const SPARKLE_AMBIENT_GAIN = 0.68;
const MUTED_GAIN = 0.0001;
// No synthetic ambience is audible until it can be replaced with a licensed,
// authored recording that fits the illustration and the chosen location.
const MOBILE_SPEAKER_MASTER_GAIN = 0.78;
// 契約 D4: ムード遷移は MOOD_TRANSITION_MS (1200ms) を graphics と共用。
// setTargetAtTime は指数収束のため、遷移時間の 1/3 を時定数とする (3τ ≒ 95% 収束)
const TRANSITION_SECONDS = MOOD_TRANSITION_MS / 3000;

/**
 * Web Audio implementation used by AppCore.
 *
 * Ambient assets are generated in-repository and are periodic WAVs.  The
 * buffers can therefore use native loop points without introducing a fade or
 * re-scheduling gap at each iteration. Every track has a per-mood gain, while
 * one shared filter and master gain make mood changes coherent.
 */
export class SoundEngine implements SoundEngineContract {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private ambienceGain: GainNode | null = null;
  private lowpass: BiquadFilterNode | null = null;
  private sparkleGain: GainNode | null = null;
  private readonly tracks = new Map<TrackId, ActiveTrack>();
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
    for (const track of TRACKS) {
      const active = this.tracks.get(track.id);
      if (active) this.smoothParameter(active.gain.gain, this.gainForMood(track), now);
    }
  }

  playSparkle(): void {
    // A synthesized "shush" or chime is not a hand-held firework. Stay silent
    // rather than suggesting a false sound until an authored recording exists.
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
    // Track errors intentionally remain isolated: an offline cache miss or a
    // malformed asset must not block a later switch to authored recordings.
    await Promise.allSettled(TRACKS.map((track) => this.loadAndStartTrack(track, lifecycle, context)));
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
    gain.gain.exponentialRampToValueAtTime(this.gainForMood(track), startAt + 0.2);
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

  private gainForMood(track: TrackDefinition): number {
    return this.mood?.id === 'quiet' ? Math.max(MUTED_GAIN, track.quietGain) : track.sparkleGain;
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
