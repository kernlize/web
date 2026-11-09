/*
 * The stage's three programs. Everything is placed in clip space by the shaders themselves, so no camera
 * maths is involved: x runs from -1 (left) to 1 (right), and the rail stands at `uRail`.
 *
 * A mark is born off the right edge, travels left to the rail, and there meets one of the guard's three
 * answers: refused (it stops and fades), held (it crawls on a little and fades), or passed (it carries on).
 */

/** `position` carries a mark's lane, speed and phase; `aFate` its answer at the rail and whether this vertex is the trailing end. */
export const FLOW_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uRail;
uniform float uGate;
uniform float uDpr;
attribute vec2 aFate;
varying float vAlpha;
varying float vHeat;
varying float vPassed;

void main() {
  float life = fract(uTime * position.y + position.z);
  float at = max(life - aFate.y * 0.05, 0.0);
  float before = clamp(at / uGate, 0.0, 1.0);
  float after = clamp((at - uGate) / (1.0 - uGate), 0.0, 1.0);
  float x = mix(1.08, uRail, before);
  float alpha = smoothstep(0.0, 0.06, at);
  vHeat = 0.0;
  vPassed = 0.0;
  if (aFate.x < 0.5) {
    alpha *= 1.0 - smoothstep(0.0, 0.2, after);
    vHeat = smoothstep(0.0, 0.03, after);
  } else if (aFate.x < 0.74) {
    x = mix(uRail, uRail - 0.26, after);
    alpha *= 1.0 - smoothstep(0.3, 1.0, after);
    vHeat = 0.6 * smoothstep(0.0, 0.03, after);
  } else {
    x = mix(uRail, -1.08, after);
    alpha *= 1.0 - smoothstep(0.0, 0.45, after);
    vPassed = smoothstep(0.0, 0.05, after);
  }
  float wobble = sin(at * 42.0 + position.z * 61.0) * 0.045 * (1.0 - before) * (1.0 - before);
  vAlpha = alpha * (1.0 - aFate.y);
  gl_Position = vec4(x, position.x + wobble, 0.0, 1.0);
  gl_PointSize = 2.6 * uDpr;
}
`;

export const FLOW_FRAGMENT = /* glsl */ `
uniform float uFlow;
uniform vec3 uInk;
uniform vec3 uBright;
uniform vec3 uAccent;
varying float vAlpha;
varying float vHeat;
varying float vPassed;

void main() {
  float alpha = vAlpha * uFlow;
  #ifdef ROUND
  alpha *= 1.0 - smoothstep(0.2, 0.5, length(gl_PointCoord - 0.5));
  #endif
  vec3 color = mix(mix(uInk, uBright, vPassed), uAccent, vHeat);
  gl_FragColor = vec4(color * alpha, alpha);
}
`;

export const SCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** One full-screen pass draws the rail and, between pages, the curtain: a panel between `uLead` and `uTrail` that crosses right to left. */
export const SCREEN_FRAGMENT = /* glsl */ `
uniform vec2 uSize;
uniform float uTime;
uniform float uDpr;
uniform float uRail;
uniform float uFlow;
uniform float uLead;
uniform float uTrail;
uniform vec3 uAccent;
uniform vec3 uPanel;
varying vec2 vUv;

void main() {
  float bow = sin(vUv.y * 3.14159) * 0.06;
  float lead = uLead - bow;
  float trail = uTrail - bow;
  float soft = 1.5 / uSize.x;
  float cover = smoothstep(lead - soft, lead + soft, vUv.x) * (1.0 - smoothstep(trail - soft, trail + soft, vUv.x));
  float band = 4.0 * uDpr / uSize.x;
  float edge = max(1.0 - step(lead + band, vUv.x), step(trail - band, vUv.x)) * cover;
  float reach = uSize.x / (48.0 * uDpr);
  float ahead = exp(-(lead - vUv.x) * reach) * step(vUv.x, lead) * step(uLead, 1.1);
  float behind = exp(-(vUv.x - trail) * reach) * step(trail, vUv.x) * step(uTrail, 1.1);
  float spill = max(ahead, behind) * 0.3;

  float away = abs(vUv.x - (uRail * 0.5 + 0.5)) * uSize.x / uDpr;
  float ends = smoothstep(0.02, 0.24, vUv.y) * (1.0 - smoothstep(0.76, 0.98, vUv.y));
  float core = 1.0 - smoothstep(0.4, 1.2, away);
  float glow = exp(-away / 28.0) * (0.14 + 0.04 * sin(uTime * 1.3));
  float rail = (core * 0.85 + glow) * ends * uFlow * (1.0 - cover);

  float light = max(rail, spill);
  vec3 color = mix(uPanel, uAccent, edge) * cover + uAccent * light;
  gl_FragColor = vec4(color, max(cover, light));
}
`;
