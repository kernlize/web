import { BufferAttribute, BufferGeometry, Camera, LineSegments, Mesh, PlaneGeometry, Points, Scene, ShaderMaterial, Vector2, Vector3, WebGLRenderer } from 'three';
import { PARKED } from './curtain';
import { readPalette, type Rgb } from './palette';
import { FLOW_FRAGMENT, FLOW_VERTEX, SCREEN_FRAGMENT, SCREEN_VERTEX } from './shaders';

/** What the motion code animates. `flow` and `fade` multiply into the field's strength; `lead` and `trail` are the curtain's two edges, in screen widths. */
export interface StageState {
  flow: number;
  fade: number;
  lead: number;
  trail: number;
}

export interface Stage {
  readonly state: StageState;
  /** Whether a frame drawn now would show anything. */
  busy(): boolean;
  render(seconds: number): void;
  resize(): void;
  /** Re-read the theme tokens after the colour scheme changes. */
  repaint(): void;
}

const MARKS = 320;
const WIDE = 960;
/** Mirrors the static rail in `motion.css`: right of the copy on a wide screen, in the gutter on a narrow one. */
const railAt = (width: number): number => (width >= WIDE ? 0.3 : 1 - 16 / width);

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** One vertex per mark for the heads, two for the streaks; both draw from the same seed so a head rides its own streak. */
function marks(ends: 1 | 2): BufferGeometry {
  const random = seeded(7);
  const position = new Float32Array(MARKS * ends * 3);
  const fate = new Float32Array(MARKS * ends * 2);
  for (let mark = 0; mark < MARKS; mark += 1) {
    const lane = (random() * 2 - 1) * 0.86;
    const speed = 0.045 + random() * 0.05;
    const phase = random();
    const answer = random();
    for (let end = 0; end < ends; end += 1) {
      const at = mark * ends + end;
      position.set([lane, speed, phase], at * 3);
      fate.set([answer, end], at * 2);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('aFate', new BufferAttribute(fate, 2));
  return geometry;
}

const colour = (): { value: Vector3 } => ({ value: new Vector3() });

/**
 * Build the stage on a canvas. Throws when the browser has no WebGL; the caller then leaves the page as it is.
 */
export function createStage(canvas: HTMLCanvasElement): Stage {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' });
  const state: StageState = { flow: 0, fade: 1, lead: PARKED, trail: PARKED };
  const uniforms = {
    uTime: { value: 0 },
    uDpr: { value: 1 },
    uSize: { value: new Vector2(1, 1) },
    uRail: { value: 0.3 },
    uGate: { value: 0.36 },
    uFlow: { value: 0 },
    uLead: { value: PARKED },
    uTrail: { value: PARKED },
    uInk: colour(),
    uBright: colour(),
    uAccent: colour(),
    uPanel: colour(),
  };
  const material = (vertexShader: string, fragmentShader: string, defines: Record<string, string> = {}): ShaderMaterial =>
    new ShaderMaterial({ uniforms, vertexShader, fragmentShader, defines, transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false });

  const scene = new Scene();
  const camera = new Camera();
  const layers = [
    new LineSegments(marks(2), material(FLOW_VERTEX, FLOW_FRAGMENT)),
    new Points(marks(1), material(FLOW_VERTEX, FLOW_FRAGMENT, { ROUND: '' })),
    new Mesh(new PlaneGeometry(2, 2), material(SCREEN_VERTEX, SCREEN_FRAGMENT)),
  ];
  layers.forEach((layer, order) => {
    layer.frustumCulled = false;
    layer.renderOrder = order;
    scene.add(layer);
  });

  let strength = 1;
  const resize = (): void => {
    const dpr = Math.min(devicePixelRatio, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(innerWidth, innerHeight, false);
    const rail = railAt(innerWidth);
    uniforms.uDpr.value = dpr;
    uniforms.uSize.value.set(innerWidth * dpr, innerHeight * dpr);
    uniforms.uRail.value = rail;
    // Marks keep one speed across the rail whatever the screen's shape.
    uniforms.uGate.value = (1.08 - rail) / 2.16;
    strength = innerWidth >= WIDE ? 1 : 0.55;
  };
  const repaint = (): void => {
    const style = getComputedStyle(document.documentElement);
    const palette = readPalette((token) => style.getPropertyValue(token));
    const set = (uniform: { value: Vector3 }, rgb: Rgb): void => void uniform.value.set(...rgb);
    set(uniforms.uInk, palette.ink);
    set(uniforms.uBright, palette.bright);
    set(uniforms.uAccent, palette.accent);
    set(uniforms.uPanel, palette.panel);
  };
  resize();
  repaint();

  return {
    state,
    resize,
    repaint,
    busy: () => state.flow * state.fade > 0.002 || state.lead < PARKED - 0.05,
    render(seconds) {
      uniforms.uTime.value = seconds;
      uniforms.uFlow.value = state.flow * state.fade * strength;
      uniforms.uLead.value = state.lead;
      uniforms.uTrail.value = state.trail;
      renderer.render(scene, camera);
    },
  };
}
