// 1 パスにまとめたデジタル映像表現（postprocessing ライブラリの Glitch / ChromaticAberration /
// Pixelation / Noise / Scanline / Vignette の考え方を最小限で再実装）。
// パスを増やさないことで、モバイルでも負荷を抑える。

export const DigitalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uRes: { value: [1, 1] },
    uTime: { value: 0 },
    uAberr: { value: 0.0012 },
    uScan: { value: 0 },
    uPixel: { value: 0 },
    uGlitch: { value: 0 },
    uNoise: { value: 0.02 },
    uVignette: { value: 0.45 },
    uPosterize: { value: 0 },
    uSpeed: { value: 0 },
    uFlash: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uRes;
    uniform float uTime, uAberr, uScan, uPixel, uGlitch, uNoise, uVignette, uPosterize, uSpeed, uFlash;
    varying vec2 vUv;
    float h21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      if (uPixel > 1.5) {
        vec2 px = uRes / uPixel;
        uv = (floor(uv * px) + 0.5) / px;
      }
      if (uGlitch > 0.001) {
        float band = floor(uv.y * 28.0);
        float tt = floor(uTime * 24.0);
        float r = h21(vec2(band, tt));
        if (r < uGlitch * 0.45) uv.x += (h21(vec2(band, tt + 3.0)) - 0.5) * 0.14 * uGlitch;
        if (h21(vec2(tt, 9.0)) < uGlitch * 0.15) uv.y += (h21(vec2(tt, 5.0)) - 0.5) * 0.04;
      }
      vec2 dir = uv - 0.5;
      float ab = uAberr + uGlitch * 0.012 + uSpeed * 0.006 * length(dir);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dir * ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir * ab).b;

      if (uSpeed > 0.01) {
        float ang = atan(dir.y, dir.x);
        float line = step(0.975, h21(vec2(floor(ang * 90.0), floor(uTime * 14.0))));
        col += line * uSpeed * smoothstep(0.28, 0.75, length(dir)) * 0.5;
      }
      if (uPosterize > 1.0) col = floor(col * uPosterize + 0.5) / uPosterize;
      if (uScan > 0.001) {
        float s = 0.5 + 0.5 * sin(vUv.y * uRes.y * 1.3 + uTime * 6.0);
        col *= 1.0 - uScan * s * 0.6;
      }
      col += (h21(vUv * uRes + fract(uTime) * 100.0) - 0.5) * uNoise;
      float v = smoothstep(0.9, 0.25, length(dir));
      col *= mix(1.0, v, uVignette);
      col += uFlash;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export const FX_PRESETS = {
  none: { aberr: 0.0012, scan: 0, pixel: 0, noise: 0.018, vignette: 0.45, posterize: 0, bloom: 0.55 },
  broadcast: { aberr: 0.0022, scan: 0.22, pixel: 0, noise: 0.05, vignette: 0.62, posterize: 0, bloom: 0.5 },
  retro: { aberr: 0, scan: 0.14, pixel: 4, noise: 0, vignette: 0.3, posterize: 14, bloom: 0.35 },
  goal: { aberr: 0.001, scan: 0, pixel: 0, noise: 0.01, vignette: 0.35, posterize: 0, bloom: 0.8 },
};
