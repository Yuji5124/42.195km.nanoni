// URL デバッグ。AI（や人）がゲームを「観察しやすく」するための入口。
//   ?seed=5124            乱数固定（同じ seed = 同じなのに。の順番）
//   ?distance=400         400m 地点から開始
//   ?autopilot=1          プレイヤーも自動操縦（必ず完走する）
//   ?modifier=fisheye,giant_player,tv   指定した Modifier だけを常時オン（ChaosDirector は止まる）
//   ?camera=tv            カメラ固定
//   ?chaos=1              常に最大の混沌
//   ?legendary=space      レア演出を強制
//   ?quality=low|medium|high   ?fast=4（検証用に 4 倍速）   ?mute=1   ?debug=1（パネルを開く）
//   ?start=1              タイトルを飛ばしてすぐスタート（autopilot では自動）

export function readParams(search = location.search) {
  const q = new URLSearchParams(search);
  const num = (k, d) => {
    const v = parseFloat(q.get(k));
    return Number.isFinite(v) ? v : d;
  };
  const flag = (k) => q.has(k) && q.get(k) !== '0' && q.get(k) !== 'false';
  const list = (k) =>
    (q.get(k) ?? '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  return {
    seed: q.has('seed') ? Math.max(0, Math.floor(num('seed', 0))) : null,
    distance: Math.max(0, Math.min(790, num('distance', 0))),
    autopilot: flag('autopilot') || flag('auto'),
    // 自動操縦の走り方: good（リズムも合わせる）/ naive（普通の人: リズムなし、最後だけ頑張る）
    autopilotStyle: /^(naive|good)$/.test(q.get('autopilot') ?? '') ? q.get('autopilot') : 'good',
    modifiers: list('modifier'),
    camera: q.get('camera')?.toUpperCase() ?? null,
    chaos: q.has('chaos') ? Math.max(0, Math.min(1, num('chaos', 1))) : null,
    legendary: q.get('legendary')?.toUpperCase() ?? null,
    quality: q.get('quality'),
    fast: Math.max(1, Math.min(8, Math.floor(num('fast', 1)))),
    mute: flag('mute'),
    debug: flag('debug'),
    start: flag('start'),
  };
}
