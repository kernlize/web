import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { COVER_SECONDS, CROSSED, PARKED, UNCOVER_SECONDS } from './curtain';
import { showAll, startReveal, stopReveal } from './reveal';
import { changesPage, isSitePage } from './routes';
import type { Stage } from './stage';

const reduced = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = (): HTMLCanvasElement | null => document.querySelector('canvas[data-stage]');

let stage: Stage | undefined;
let covered = false;
let wasBusy = false;

function draw(seconds: number): void {
  if (!stage) return;
  const busy = stage.busy();
  // One more frame after the stage goes quiet clears what the last one drew.
  if (busy || wasBusy) stage.render(seconds);
  wasBusy = busy;
}

async function raiseStage(): Promise<void> {
  const target = canvas();
  if (stage || !target || reduced()) return;
  try {
    const { createStage } = await import('./stage');
    stage = createStage(target);
  } catch {
    // No WebGL: the page keeps its static rail and plain navigation.
    return;
  }
  target.dataset.live = '';
  gsap.ticker.add(draw);
  addEventListener('resize', stage.resize);
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', stage.repaint);
  new MutationObserver(stage.repaint).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  lightFlow(0);
}

/** The flow field belongs to the hero that asks for it, and thins out as that hero scrolls away. */
function lightFlow(holdSeconds: number): void {
  if (!stage) return;
  const { state } = stage;
  const hero = document.querySelector('[data-flow]');
  gsap.killTweensOf(state, 'flow');
  state.fade = 1;
  if (!hero) {
    state.flow = 0;
    return;
  }
  gsap.to(state, { flow: 1, duration: 1.6, delay: holdSeconds, ease: 'power2.out' });
  ScrollTrigger.create({
    trigger: hero,
    start: 'top top',
    end: 'bottom 40%',
    onUpdate: (self) => void (state.fade = 1 - self.progress),
  });
}

function park(): void {
  if (!stage) return;
  gsap.killTweensOf(stage.state, 'lead,trail');
  stage.state.lead = PARKED;
  stage.state.trail = PARKED;
  canvas()?.classList.remove('is-front');
  covered = false;
}

function cover(): Promise<void> {
  if (!stage) return Promise.resolve();
  const { state } = stage;
  // A second move made while the curtain is still down keeps it down instead of flashing the page between.
  gsap.killTweensOf(state, 'lead,trail');
  state.trail = PARKED;
  if (!covered) state.lead = PARKED;
  covered = true;
  canvas()?.classList.add('is-front');
  return new Promise((resolve) => {
    gsap.to(state, { lead: CROSSED, duration: COVER_SECONDS, ease: 'power3.inOut', onComplete: resolve });
  });
}

function uncover(): void {
  if (!stage || !covered) return;
  gsap.to(stage.state, { trail: CROSSED, duration: UNCOVER_SECONDS, ease: 'power3.inOut', onComplete: park });
}

function enterPage(): void {
  if (reduced()) {
    showAll();
    return;
  }
  const hold = covered ? UNCOVER_SECONDS * 0.55 : 0;
  startReveal(hold);
  lightFlow(hold);
  uncover();
  void raiseStage();
}

/**
 * Start the site's motion: reveals on scroll, the hero's flow field, and the curtain that crosses the screen
 * between pages (D-023). Runs once per visit; the router's events drive it from then on.
 */
export function startMotion(): void {
  gsap.registerPlugin(ScrollTrigger);
  document.dispatchEvent(new CustomEvent('kernl:motion'));
  document.addEventListener('astro:page-load', enterPage);
  document.addEventListener('astro:before-swap', stopReveal);
  document.addEventListener('astro:before-preparation', (event) => {
    if (!stage || reduced() || !isSitePage(event.to.pathname, import.meta.env.BASE_URL) || !changesPage(event.from, event.to)) return;
    const load = event.loader;
    event.loader = async () => {
      try {
        await Promise.all([load(), cover()]);
      } catch (error) {
        park();
        throw error;
      }
    };
  });
  // A page restored from the back-forward cache must not come back hidden behind the curtain it left under.
  addEventListener('pageshow', (event) => {
    if (event.persisted) park();
  });
}
