// 画質プリセット。演出（Modifier）の種類は変えず、重さだけを変える。
export const QUALITY = {
  low: { name: 'LOW', pixelRatio: 0.85, crowd: 90, standRows: 8, particles: 300, bloom: false, shadows: false, reflectAll: false },
  medium: { name: 'MEDIUM', pixelRatio: 1.25, crowd: 260, standRows: 14, particles: 900, bloom: true, shadows: false, reflectAll: false },
  high: { name: 'HIGH', pixelRatio: 1.75, crowd: 520, standRows: 20, particles: 1800, bloom: true, shadows: true, reflectAll: true },
};

export function pickQuality(param) {
  if (param && QUALITY[param]) return param;
  const mobile = window.matchMedia?.('(pointer: coarse)').matches;
  return mobile ? 'low' : 'medium';
}
