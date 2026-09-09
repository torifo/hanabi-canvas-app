// 気配の火花の置き場所。受信座標は相対位置として自端末の可視範囲へ射影する
// （設計: specs/hanabi-canvas/remote-spark-depth-design.md）

export interface SceneView {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface SceneCloud {
  cx: number;
  cy: number;
  R: number;
}

export interface ScenePoint {
  x: number;
  y: number;
}

/** 端に張り付かないための内側マージン (scene px) */
export const REMOTE_MARGIN = 48;
/** cloudAt と同じ判定半径 */
const CLOUD_HIT = 1.12;
/** 押し出し先の距離 */
const CLOUD_ESCAPE = 1.28;
/** 輪の楕円率（cloudAt と同じ） */
const CLOUD_ASPECT = 0.94;
const MAX_ESCAPES = 2;
const FALLBACK_SAMPLES = 12;

/** 相対位置 (0-1) を可視範囲へ線形に射影する */
export function projectToView(x: number, y: number, view: SceneView, margin = REMOTE_MARGIN): ScenePoint {
  const w = Math.max(0, view.maxX - view.minX - margin * 2);
  const h = Math.max(0, view.maxY - view.minY - margin * 2);
  return { x: view.minX + margin + x * w, y: view.minY + margin + y * h };
}

function cloudContaining(p: ScenePoint, clouds: readonly SceneCloud[]): SceneCloud | null {
  for (const c of clouds) {
    const dx = p.x - c.cx;
    const dy = (p.y - c.cy) / CLOUD_ASPECT;
    if (dx * dx + dy * dy <= (c.R * CLOUD_HIT) ** 2) return c;
  }
  return null;
}

function isInside(p: ScenePoint, view: SceneView): boolean {
  return p.x >= view.minX && p.x <= view.maxX && p.y >= view.minY && p.y <= view.maxY;
}

/**
 * 輪の内側なら、中心から見た同じ方向へ R×1.28 まで押し出す。
 * 押し出し先が可視範囲を出るなら反対方向へ。中心そのものは真上へ。
 */
export function escapeClouds(p: ScenePoint, clouds: readonly SceneCloud[], view: SceneView): ScenePoint {
  let point = p;
  for (let i = 0; i < MAX_ESCAPES; i++) {
    const c = cloudContaining(point, clouds);
    if (!c) return point;
    let dx = point.x - c.cx;
    let dy = (point.y - c.cy) / CLOUD_ASPECT;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) { dx = 0; dy = -1; } else { dx /= len; dy /= len; }
    const dist = c.R * CLOUD_ESCAPE;
    const forward = { x: c.cx + dx * dist, y: c.cy + dy * dist * CLOUD_ASPECT };
    if (isInside(forward, view)) { point = forward; continue; }
    const backward = { x: c.cx - dx * dist, y: c.cy - dy * dist * CLOUD_ASPECT };
    point = isInside(backward, view) ? backward : forward;
  }
  return point;
}

/** 可視範囲に候補を撒き、どの輪からも最も遠い点を返す（最後の逃げ道） */
function farthestFromClouds(view: SceneView, clouds: readonly SceneCloud[], random: () => number): ScenePoint {
  let best: ScenePoint = { x: (view.minX + view.maxX) / 2, y: (view.minY + view.maxY) / 2 };
  let bestScore = -Infinity;
  for (let i = 0; i < FALLBACK_SAMPLES; i++) {
    const p = projectToView(random(), random(), view);
    let score = Infinity;
    for (const c of clouds) {
      const d = Math.hypot(p.x - c.cx, (p.y - c.cy) / CLOUD_ASPECT) - c.R * CLOUD_HIT;
      if (d < score) score = d;
    }
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}

/** 射影 → 輪の回避 → それでも駄目なら最遠点 */
export function placeRemoteSpark(
  x: number,
  y: number,
  view: SceneView,
  clouds: readonly SceneCloud[],
  random: () => number = Math.random
): ScenePoint {
  const projected = projectToView(x, y, view);
  const escaped = escapeClouds(projected, clouds, view);
  if (!cloudContaining(escaped, clouds) && isInside(escaped, view)) return escaped;
  // 候補は輪の外に落ちるまで少し粘る
  for (let attempt = 0; attempt < 4; attempt++) {
    const candidate = farthestFromClouds(view, clouds, random);
    if (!cloudContaining(candidate, clouds)) return candidate;
  }
  return farthestFromClouds(view, clouds, random);
}
