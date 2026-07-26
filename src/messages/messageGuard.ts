export const MAX_MESSAGE_LENGTH = 30;

export type GuardRejection = 'empty' | 'too-long' | 'url' | 'control' | 'blocked';

export type GuardResult =
  | { ok: true; text: string }
  | { ok: false; reason: GuardRejection };

// 世界観を壊す投稿を軽く弾くための最小限の語。網羅は目的ではない。
const BLOCKED_PATTERNS: readonly RegExp[] = [
  /死ね/,
  /殺す/,
  /ころす/,
  /くたばれ/,
  /きえろ/i,
  /\bfuck\b/i,
  /\bshit\b/i,
  /\bbitch\b/i,
  /\bkill\s+you(rself)?\b/i
];

const URL_PATTERN = /(https?:\/\/|www\.|[\w-]+\.(com|net|org|jp|io|co|me|xyz|link)\b)/i;

// 改行・タブ（\n \r \t）は空白へ畳むので許し、それ以外の制御文字と
// 不可視の書式指定文字（ゼロ幅・双方向制御・BOM）は拒否する
// U+200D(ZWJ)は絵文字合字に必要なため除外する
const CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B\u200C\u200E\u200F\u202A-\u202E\uFEFF]/;

/**
 * 送信前の検証と正規化。
 *
 * 拒否は「送れない」だけを意味し、呼び出し側はエラーを目立たせない。
 * 連投は制限しない（サーバーのレート制限が最終的な安全弁）。
 */
export function guardMessage(raw: string): GuardResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'empty' };

  if (CONTROL_PATTERN.test(raw)) return { ok: false, reason: 'control' };

  // 改行・タブ・連続空白を1つの空白へ畳んでから前後を落とす
  const text = raw.replace(/[\r\n\t]+/g, ' ').replace(/[ 　]{2,}/g, ' ').trim();

  if (text.length === 0) return { ok: false, reason: 'empty' };
  if (countChars(text) > MAX_MESSAGE_LENGTH) return { ok: false, reason: 'too-long' };
  if (URL_PATTERN.test(text)) return { ok: false, reason: 'url' };
  if (BLOCKED_PATTERNS.some((pattern) => pattern.test(text))) return { ok: false, reason: 'blocked' };

  return { ok: true, text };
}

/** 絵文字などのサロゲートペアを1文字として数える */
export function countChars(text: string): number {
  return [...text].length;
}
