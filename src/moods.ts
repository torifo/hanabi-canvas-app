import type { MoodId, MoodProfile } from './types';

export const MOOD_PROFILES: Readonly<Record<MoodId, MoodProfile>> = {
  sparkle: {
    id: 'sparkle',
    bloomStrength: 1.8,
    colorGrade: 'sunset-navy',
    particleSpeed: 1.15,
    lowpassFreq: null
  },
  quiet: {
    id: 'quiet',
    bloomStrength: 0.8,
    colorGrade: 'cyan-darknavy',
    particleSpeed: 0.62,
    lowpassFreq: 1200
  }
};
