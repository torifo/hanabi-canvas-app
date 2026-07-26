export interface MessagePalette {
  /** 開花の中心。輝度設計に従い脱彩した明色を使う */
  core: string;
  /** 中間の粒。色みはここから乗る */
  mid: string;
  /** 外殻の粒。最も色が濃い */
  outer: string;
  /** 金糸・きらめき */
  glitter: string;
}

interface NamedPalette extends MessagePalette {
  id: string;
}

// コアは常に #FFF6E0 系へ脱彩する。純彩色のコアはリニア輝度が低く、
// Bloom を前提とした加算合成で「光っている」ように見えないため。
const PALETTES: readonly NamedPalette[] = [
  { id: 'gold',    core: '#FFF6E0', mid: '#FFE0A8', outer: '#F0B460', glitter: '#FFE9C0' },
  { id: 'cyan',    core: '#F4FFFE', mid: '#BFF3F1', outer: '#5FC9C6', glitter: '#DFFAF8' },
  { id: 'rose',    core: '#FFF3EE', mid: '#FFC2C4', outer: '#E8687E', glitter: '#FFD9A0' },
  { id: 'azure',   core: '#F0F8FF', mid: '#AFD4F4', outer: '#5A93D8', glitter: '#CFE9FF' },
  { id: 'violet',  core: '#F8F2FF', mid: '#D2BEF0', outer: '#8E6FC8', glitter: '#E8DCFA' },
  { id: 'verdant', core: '#F4FFF2', mid: '#BCE8B4', outer: '#6FAF6A', glitter: '#DFF5D6' },
  { id: 'ember',   core: '#FFF4E8', mid: '#FFC49A', outer: '#E07848', glitter: '#FFD9A0' }
];

const PALETTE_BY_ID = new Map(PALETTES.map((palette) => [palette.id, palette]));

// 文面に含まれる語から色を決める。前方の項目が優先される。
const WORD_RULES: ReadonlyArray<{ palette: string; words: readonly string[] }> = [
  { palette: 'gold',    words: ['おめでとう', 'ありがとう', '祝', 'めでたい', '感謝', '乾杯', 'congrat', 'thank'] },
  { palette: 'cyan',    words: ['静か', 'しずか', '眠', 'ねむ', '雨', '涼', '波', '海', 'quiet', 'calm', 'rain'] },
  { palette: 'rose',    words: ['好き', 'すき', '恋', '愛', 'ずっと', '会いたい', 'love', 'miss'] },
  { palette: 'azure',   words: ['空', '星', '夜', '遠く', '旅', 'sky', 'star', 'night'] },
  { palette: 'violet',  words: ['夢', 'ゆめ', '願', 'いつか', '祈', 'dream', 'wish', 'hope'] },
  { palette: 'verdant', words: ['元気', '健康', 'また明日', 'おかえり', 'ただいま', 'welcome'] },
  { palette: 'ember',   words: ['明日', 'あした', '頑張', 'がんば', '負けない', '前へ', 'go', 'fight'] }
];

/**
 * 文面から色を導く純関数。
 *
 * 通信には色を含めない。同じ文面からは必ず同じ色が導かれるため、
 * 各端末が独立に計算しても全員の空で同じ色に咲く。
 */
export function messagePalette(text: string): MessagePalette {
  const normalized = text.toLowerCase();
  for (const rule of WORD_RULES) {
    if (rule.words.some((word) => normalized.includes(word))) {
      const palette = PALETTE_BY_ID.get(rule.palette);
      if (palette) return palette;
    }
  }
  return PALETTES[hashText(text) % PALETTES.length]!;
}

/** 文面の安定ハッシュ（FNV-1a 32bit）。実行環境に依らず同じ値を返す */
export function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
