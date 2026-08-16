#!/usr/bin/env node
/**
 * 全国の花火大会の名簿と開催日を自動で集め、public/data/hanabi-schedule.json を更新する。
 *
 * 情報源は日本語版Wikipedia「日本の花火大会一覧」(CC BY-SA)。まとめサイトのHTMLを
 * 転載するのではなく、再利用が許諾された一覧から名称・開催地・公式URL・開催日の表現を
 * 取り出し、対象年の日付へ解決する。日付は事実であり、解決結果は自前の表現で持つ。
 *
 * 開催日は「7月最終土曜日」のような相対表現も多く、実際の告知とずれることがあるため、
 * 自動で入れた分は status: 'provisional' のままにする。人が公式発表で確認したものは
 * verified: true を立てれば、以降この収集で上書きされない。
 */

import { readFile, writeFile } from 'node:fs/promises';

const SOURCE_TITLE = '日本の花火大会一覧';
const SOURCE_URL = `https://ja.wikipedia.org/wiki/${encodeURIComponent(SOURCE_TITLE)}`;
const SCHEDULE_PATH = new URL('../public/data/hanabi-schedule.json', import.meta.url);
// 開始時刻まではこの一覧に無い。夜の大会の一般的な時刻を暫定値として置く
const DEFAULT_HOUR = 19;
const DEFAULT_MINUTE = 30;

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** 対象年。既定は「これから来る花火」を集めたいので当年と翌年 */
function targetYears(now) {
  const year = now.getFullYear();
  // 花火は夏に集中するため、秋以降は翌年の分を集めにいく
  return now.getMonth() >= 9 ? [year, year + 1] : [year];
}

async function fetchWikitext() {
  const url = `https://ja.wikipedia.org/w/index.php?title=${encodeURIComponent(SOURCE_TITLE)}&action=raw`;
  const response = await fetch(url, {
    headers: { 'user-agent': 'hanabi-canvas-schedule-collector/1.0 (personal project)' }
  });
  if (!response.ok) throw new Error(`Wikipedia の取得に失敗しました: ${response.status}`);
  return response.text();
}

/** 表の1行から、大会1件ぶんの素材を取り出す */
export function parseRow(line) {
  if (!line.startsWith('|style="text-align:left"|{{Sort|')) return null;
  const cells = line.split('||');
  if (cells.length < 3) return null;

  const place = cells[0] ?? '';
  const prefecture = place.match(/\{\{Flagicon2\|([^}|]+)\}\}/)?.[1]?.trim();
  const municipality = place.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]\s*\}\}\s*$/)?.[1]?.trim();
  const name = cells[1]?.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
  const displayName = (name?.[2] ?? name?.[1])?.trim() ?? stripMarkup(cells[1] ?? '');
  const dateExpression = stripMarkup(cells[2] ?? '');
  const officialUrl = line.match(/\[(https?:\/\/[^\s\]]+)/)?.[1];

  if (!prefecture || !displayName || !dateExpression) return null;
  return { prefecture, municipality, name: displayName, dateExpression, officialUrl };
}

function stripMarkup(cell) {
  return cell
    .replace(/\{\{Display none\|[^}]*\}\}/g, '')
    .replace(/\{\{Sort\|[^|]*\|/g, '')
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/<ref[^>]*>.*?<\/ref>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[{}[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 「8月2日」「7月最終土曜日」「8月第1土曜日」を対象年の日付へ解決する。
 * 期間指定（「4月下旬 - 10月」など）や解決できない表現は null を返して見送る。
 */
export function resolveDate(expression, year) {
  const text = expression.replace(/\s/g, '');
  if (/[-–—〜~]/.test(text)) return null; // 期間物は「次の1件」に向かない

  const fixed = text.match(/^(\d{1,2})月(\d{1,2})日/);
  if (fixed) {
    const month = Number(fixed[1]);
    const day = Number(fixed[2]);
    return buildDate(year, month, day);
  }

  // 「第5」は先に最終週として扱う。5週目が存在する月ではそれが最終週であり、
  // 存在しない月では最終週が意図に最も近い
  const last = text.match(/^(\d{1,2})月(?:最終|第5)([日月火水木金土])曜日/);
  if (last) return lastWeekday(year, Number(last[1]), WEEKDAYS.indexOf(last[2]));

  const nth = text.match(/^(\d{1,2})月第(\d)([日月火水木金土])曜日/);
  if (nth) return nthWeekday(year, Number(nth[1]), Number(nth[2]), WEEKDAYS.indexOf(nth[3]));

  return null;
}

function buildDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null; // 2月30日のような表現を弾く
  return format(year, month, day);
}

function nthWeekday(year, month, nth, weekday) {
  if (weekday < 0) return null;
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const day = 1 + ((weekday - first + 7) % 7) + (nth - 1) * 7;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCMonth() === month - 1 ? format(year, month, day) : null;
}

function lastWeekday(year, month, weekday) {
  if (weekday < 0) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastDow = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
  const day = lastDay - ((lastDow - weekday + 7) % 7);
  return format(year, month, day);
}

function format(year, month, day) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}T${pad(DEFAULT_HOUR)}:${pad(DEFAULT_MINUTE)}:00+09:00`;
}

/** 名称と都道府県から、年をまたいでも安定するIDを作る */
export function buildId(name, prefecture, year) {
  const slug = `${prefecture}-${name}`
    .replace(/[\s　]/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .slice(0, 40);
  return `wp-${slug}-${year}`;
}

/**
 * 収集結果を既存データへ統合する。
 * 人が確認した予定（verified: true）と、収集の対象外（source が無い手入力）は触らない。
 */
export function mergeSchedule(existing, collected) {
  const byId = new Map(existing.map((event) => [event.id, event]));
  const added = [];
  const updated = [];

  for (const event of collected) {
    const current = byId.get(event.id);
    if (!current) {
      byId.set(event.id, event);
      added.push(event);
      continue;
    }
    // 公式発表で確認済みのものは、収集結果で塗り替えない
    if (current.verified) continue;
    if (current.date !== event.date || current.officialUrl !== event.officialUrl) {
      const merged = { ...current, ...event };
      byId.set(event.id, merged);
      updated.push({ before: current, after: merged });
    }
  }

  const events = [...byId.values()].sort((left, right) => left.date.localeCompare(right.date));
  return { events, added, updated };
}

async function main() {
  const now = new Date();
  const years = targetYears(now);
  const wikitext = await fetchWikitext();

  const rows = wikitext
    .split('\n')
    .map(parseRow)
    .filter((row) => row !== null);

  const collected = [];
  let unresolved = 0;
  for (const row of rows) {
    for (const year of years) {
      const date = resolveDate(row.dateExpression, year);
      if (!date) {
        if (year === years[0]) unresolved += 1;
        continue;
      }
      const event = {
        id: buildId(row.name, row.prefecture, year),
        name: row.name,
        prefecture: row.prefecture,
        date,
        // Wikipedia は公式発表そのものではないため、確認されるまで暫定として扱う
        status: 'provisional',
        source: 'wikipedia',
        sourceUrl: SOURCE_URL
      };
      if (row.municipality) event.municipality = row.municipality;
      if (row.officialUrl) event.officialUrl = row.officialUrl;
      collected.push(event);
    }
  }

  const existing = JSON.parse(await readFile(SCHEDULE_PATH, 'utf8'));
  const { events, added, updated } = mergeSchedule(existing, collected);
  await writeFile(SCHEDULE_PATH, `${JSON.stringify(events, null, 2)}\n`, 'utf8');

  console.log(`一覧の行: ${rows.length} 件`);
  console.log(`日付を解決できなかった表現: ${unresolved} 件（期間物・不定形のため見送り）`);
  console.log(`収集: ${collected.length} 件 / 追加: ${added.length} 件 / 更新: ${updated.length} 件`);
  console.log(`合計: ${events.length} 件`);
  for (const event of added.slice(0, 10)) {
    console.log(`  + ${event.date.slice(0, 10)} ${event.prefecture} ${event.name}`);
  }
  if (added.length > 10) console.log(`  … ほか ${added.length - 10} 件`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
