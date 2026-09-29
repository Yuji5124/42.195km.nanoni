// すべての自作マテリアルに共通の「見た目のスイッチ」を差し込む。
//   uSnap … PS1 風の頂点スナップ（0 = なし。値が小さいほどカクカク）
// Modifier は uniform を変えるだけ（マテリアルを作り直さない = シェーダーのコンパイル待ちが出ない）

export const GLOBAL_UNIFORMS = {
  uSnap: { value: 0 },
};

export function patchMaterial(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uSnap = GLOBAL_UNIFORMS.uSnap;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uSnap;')
      .replace(
        '#include <fog_vertex>',
        `if (uSnap > 0.0) { gl_Position.xy = floor(gl_Position.xy / gl_Position.w * uSnap + 0.5) / uSnap * gl_Position.w; }
        #include <fog_vertex>`
      );
  };
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|nn-snap`;
  return mat;
}
