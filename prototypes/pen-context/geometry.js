/**
 * PROTOTYPE — stroke geometry and gesture classification.
 *
 * Everything here is heuristic on purpose. The question this prototype answers
 * is "does pen marking feel like a good way to build agent context?", not
 * "is this the best recognizer?".
 */

/** @typedef {{ x: number, y: number, p: number, t: number }} InkPoint */

export function bounds(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function pathLength(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += distance(points[index - 1], points[index]);
  }
  return total;
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Closed shapes get treated as a lasso; the gap is measured against the shape size. */
function closureRatio(points) {
  const box = bounds(points);
  const diagonal = Math.hypot(box.width, box.height);
  if (diagonal === 0) return 1;
  return distance(points[0], points[points.length - 1]) / diagonal;
}

/** 1 means a perfectly straight stroke; a scribble tends toward 0. */
function straightness(points) {
  const length = pathLength(points);
  if (length === 0) return 1;
  return distance(points[0], points[points.length - 1]) / length;
}

/**
 * Classifies one stroke into the prototype's gesture vocabulary.
 * Returns { kind, box, points } where kind is one of:
 * tap | lasso | line | arrow | scribble
 */
export function classify(points) {
  const box = bounds(points);
  const length = pathLength(points);
  if (points.length < 3 || length < 14) return { kind: "tap", box, points };

  const straight = straightness(points);
  const closure = closureRatio(points);
  const diagonal = Math.hypot(box.width, box.height);

  if (straight > 0.86) {
    return { kind: "line", box, points, horizontal: box.width > box.height * 2.2 };
  }
  if (closure < 0.34 && length > diagonal * 1.9 && box.width > 24 && box.height > 18) {
    return { kind: "lasso", box, points };
  }
  if (looksLikeArrow(points)) return { kind: "arrow", box, points };
  return { kind: "scribble", box, points };
}

/** An arrow is a mostly straight shaft with a sharp turn in the final quarter. */
function looksLikeArrow(points) {
  if (points.length < 8) return false;
  const cut = Math.floor(points.length * 0.72);
  const shaft = points.slice(0, cut);
  const head = points.slice(cut);
  if (shaft.length < 4 || head.length < 3) return false;
  if (straightness(shaft) < 0.8) return false;
  const shaftAngle = angle(shaft[0], shaft[shaft.length - 1]);
  const headAngle = angle(head[0], head[head.length - 1]);
  const turn = Math.abs(normalizeAngle(headAngle - shaftAngle));
  return turn > 1.0 && turn < 2.7;
}

function angle(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function normalizeAngle(value) {
  let result = value;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
}

export function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses = a.y > point.y !== b.y > point.y;
    if (!crosses) continue;
    const atX = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (point.x < atX) inside = !inside;
  }
  return inside;
}

/** How much of a rect the stroke's polygon covers, sampled on a small grid. */
export function polygonCoverage(rect, polygon) {
  const samples = [];
  for (let ix = 1; ix <= 3; ix += 1) {
    for (let iy = 1; iy <= 3; iy += 1) {
      samples.push({ x: rect.left + (rect.width * ix) / 4, y: rect.top + (rect.height * iy) / 4 });
    }
  }
  const hits = samples.filter((sample) => pointInPolygon(sample, polygon)).length;
  return hits / samples.length;
}

/** True when a straight stroke crosses the rect horizontally. */
export function lineCrossesRect(points, rect) {
  return points.some((point) => point.x >= rect.left - 4 && point.x <= rect.right + 4 && point.y >= rect.top - 4 && point.y <= rect.bottom + 4);
}
