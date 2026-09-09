import { describe, expect, it } from 'vitest';
import { REMOTE_MARGIN, escapeClouds, placeRemoteSpark, projectToView } from '../src/graphics/remoteSpark';
import type { SceneView, SceneCloud } from '../src/graphics/remoteSpark';

// 横 16:9 はシーン全体が見える
const LANDSCAPE: SceneView = { minX: 0, maxX: 1440, minY: 0, maxY: 810 };
// 縦 390×844 の cover クロップ
const PORTRAIT: SceneView = { minX: 533, maxX: 907, minY: 0, maxY: 810 };
// 21:9 は上下が切れる
const ULTRAWIDE: SceneView = { minX: 0, maxX: 1440, minY: 96, maxY: 714 };

const CLOUDS: SceneCloud[] = [
  { cx: 372, cy: 216, R: 178 },
  { cx: 1068, cy: 216, R: 178 },
  { cx: 720, cy: 126, R: 86 }
];
const PORTRAIT_CLOUDS: SceneCloud[] = [
  { cx: 742, cy: 226, R: 112 },
  { cx: 800, cy: 420, R: 100 },
  { cx: 686, cy: 122, R: 52 }
];

const inside = (p: { x: number; y: number }, view: SceneView) =>
  p.x >= view.minX && p.x <= view.maxX && p.y >= view.minY && p.y <= view.maxY;

const hitsCloud = (p: { x: number; y: number }, clouds: readonly SceneCloud[]) =>
  clouds.some((c) => {
    const dx = p.x - c.cx;
    const dy = (p.y - c.cy) / 0.94;
    return dx * dx + dy * dy <= (c.R * 1.12) ** 2;
  });

describe('projectToView', () => {
  it('横 16:9 ではマージン分を除き恒等になる', () => {
    expect(projectToView(0, 0, LANDSCAPE)).toEqual({ x: REMOTE_MARGIN, y: REMOTE_MARGIN });
    expect(projectToView(1, 1, LANDSCAPE)).toEqual({ x: 1440 - REMOTE_MARGIN, y: 810 - REMOTE_MARGIN });
    const mid = projectToView(0.5, 0.5, LANDSCAPE);
    expect(mid.x).toBeCloseTo(720);
    expect(mid.y).toBeCloseTo(405);
  });

  it('縦画面では x=0.1 / x=0.9 がともに可視帯の内側に入る', () => {
    const left = projectToView(0.1, 0.4, PORTRAIT);
    const right = projectToView(0.9, 0.4, PORTRAIT);
    expect(inside(left, PORTRAIT)).toBe(true);
    expect(inside(right, PORTRAIT)).toBe(true);
    expect(left.x).toBeLessThan(right.x);
  });

  it('21:9 では y が圧縮されて可視範囲内に収まる', () => {
    const top = projectToView(0.5, 0, ULTRAWIDE);
    const bottom = projectToView(0.5, 1, ULTRAWIDE);
    expect(inside(top, ULTRAWIDE)).toBe(true);
    expect(inside(bottom, ULTRAWIDE)).toBe(true);
    expect(top.y).toBe(96 + REMOTE_MARGIN);
    expect(bottom.y).toBe(714 - REMOTE_MARGIN);
  });
});

describe('escapeClouds', () => {
  it('輪の内側の点は中心から同じ方向へ R×1.28 に押し出される', () => {
    const cloud = CLOUDS[0]!;
    const start = { x: cloud.cx + 30, y: cloud.cy };
    const out = escapeClouds(start, CLOUDS, LANDSCAPE);
    expect(out.y).toBeCloseTo(cloud.cy);
    expect(out.x).toBeCloseTo(cloud.cx + cloud.R * 1.28);
    expect(hitsCloud(out, CLOUDS)).toBe(false);
  });

  it('押し出し先が可視範囲外なら反対方向へ出る', () => {
    // 縦帯の左端近くに輪の中心があり、左へ押すと帯を出る
    const cloud: SceneCloud = { cx: 560, cy: 300, R: 100 };
    const start = { x: cloud.cx - 20, y: cloud.cy };
    const out = escapeClouds(start, [cloud], PORTRAIT);
    expect(inside(out, PORTRAIT)).toBe(true);
    expect(out.x).toBeGreaterThan(cloud.cx);
  });

  it('輪の中心そのものは真上へ押し出す', () => {
    const cloud = CLOUDS[1]!;
    const out = escapeClouds({ x: cloud.cx, y: cloud.cy }, CLOUDS, LANDSCAPE);
    expect(out.x).toBeCloseTo(cloud.cx);
    expect(out.y).toBeLessThan(cloud.cy);
  });

  it('外側の点はそのまま返る', () => {
    const p = { x: 720, y: 600 };
    expect(escapeClouds(p, CLOUDS, LANDSCAPE)).toEqual(p);
  });
});

describe('placeRemoteSpark', () => {
  it('縦画面でどの相対位置を受けても可視帯に入り、輪に当たらない', () => {
    const random = seeded(7);
    for (let i = 0; i <= 20; i++) {
      for (let j = 0; j <= 20; j++) {
        const p = placeRemoteSpark(i / 20, j / 20, PORTRAIT, PORTRAIT_CLOUDS, random);
        expect(inside(p, PORTRAIT)).toBe(true);
        expect(hitsCloud(p, PORTRAIT_CLOUDS)).toBe(false);
      }
    }
  });

  it('横画面で輪の外に届いた点は射影後の位置をそのまま使う', () => {
    const p = placeRemoteSpark(0.5, 0.8, LANDSCAPE, CLOUDS, seeded(1));
    expect(p.x).toBeCloseTo(720);
    expect(p.y).toBeCloseTo(REMOTE_MARGIN + 0.8 * (810 - REMOTE_MARGIN * 2));
  });
});

function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
