export interface Circle {
  x: number;
  y: number;
  r: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacementArea {
  /** 花火を置ける帯（シーン座標） */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface PlacementRequest {
  area: PlacementArea;
  radius: number;
  /** 常駐の三輪・既存のメッセージ花火など、避けたい円 */
  occupied: readonly Circle[];
  /** UIの占有域（シーン座標へ投影済み） */
  avoidRects: readonly Rect[];
  /** 候補点の数。多いほど散らばりが良くなる */
  samples?: number;
  random?: () => number;
}

const DEFAULT_SAMPLES = 24;

/**
 * 空いている場所を選ぶ（best-candidate サンプリング）。
 *
 * 候補点をばらまき、既存の占有物から最も遠い点を選ぶ。格子配置より自然に
 * 散らばり、空きがある限り必ず離れる。空きが尽きても最良の候補を返すため、
 * 呼び出し側が「置けない」を扱う必要はない。
 */
export function findPlacement(request: PlacementRequest): { x: number; y: number } {
  const { area, radius, occupied, avoidRects } = request;
  const random = request.random ?? Math.random;
  const samples = Math.max(1, request.samples ?? DEFAULT_SAMPLES);

  // 半径ぶん内側に寄せて、輪が帯からはみ出さないようにする
  const minX = Math.min(area.minX + radius, area.maxX);
  const maxX = Math.max(area.maxX - radius, area.minX);
  const minY = Math.min(area.minY + radius, area.maxY);
  const maxY = Math.max(area.maxY - radius, area.minY);

  let best = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  let bestScore = -Infinity;

  for (let i = 0; i < samples; i++) {
    const x = minX + random() * (maxX - minX);
    const y = minY + random() * (maxY - minY);
    const score = clearance(x, y, radius, occupied, avoidRects);
    if (score > bestScore) {
      bestScore = score;
      best = { x, y };
    }
  }
  return best;
}

/**
 * その点の「余裕」。大きいほど何からも離れている。
 * 円までの縁どうしの距離と、矩形までの距離の最小値。
 */
export function clearance(
  x: number,
  y: number,
  radius: number,
  occupied: readonly Circle[],
  avoidRects: readonly Rect[]
): number {
  let min = Infinity;
  for (const c of occupied) {
    const d = Math.hypot(x - c.x, y - c.y) - c.r - radius;
    if (d < min) min = d;
  }
  for (const rect of avoidRects) {
    const d = distanceToRect(x, y, rect) - radius;
    if (d < min) min = d;
  }
  return min;
}

/** 矩形の外側までの距離。内側なら負の値（めり込み量） */
export function distanceToRect(x: number, y: number, rect: Rect): number {
  const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.w));
  const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.h));
  if (dx === 0 && dy === 0) {
    // 内側: 最も近い辺までの距離を負で返す
    const inset = Math.min(x - rect.x, rect.x + rect.w - x, y - rect.y, rect.y + rect.h - y);
    return -inset;
  }
  return Math.hypot(dx, dy);
}
