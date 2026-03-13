export function formatDebugNumber(v, digits = 3) {
  return Number.isFinite(v) ? v.toFixed(digits) : "na";
}

export function pushDebugPerfValue(arr, value, limit = 300) {
  if (!Array.isArray(arr)) return;
  if (!Number.isFinite(value)) return;
  arr.push(value);
  if (arr.length > limit) arr.splice(0, arr.length - limit);
}

export function debugPerfMean(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return NaN;
  let sum = 0;
  for (const v of arr) sum += v;
  return sum / arr.length;
}

export function debugPerfMax(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return NaN;
  let maxV = -Infinity;
  for (const v of arr) if (v > maxV) maxV = v;
  return maxV;
}

export function debugPerfPercentile(arr, p = 0.95) {
  if (!Array.isArray(arr) || arr.length === 0) return NaN;
  const sorted = arr.slice().sort((a, b) => a - b);
  const clampedP = Math.min(1, Math.max(0, p));
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * clampedP)));
  return sorted[idx] || 0;
}
