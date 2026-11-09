import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

const show = (targets: Iterable<Element>): void => {
  for (const target of targets) target.classList.add('in');
};

/** Show every reveal at once, for people who asked for less motion. */
export function showAll(): void {
  show(document.querySelectorAll('.reveal'));
}

/**
 * Raise each `.reveal` into place as it scrolls into view, a row at a time. `holdSeconds` keeps the first
 * row back while the curtain is still crossing the page.
 */
export function startReveal(holdSeconds = 0): void {
  const due = performance.now() + holdSeconds * 1000;
  ScrollTrigger.batch('.reveal:not(.in)', {
    start: 'top 92%',
    once: true,
    onEnter(batch) {
      gsap.to(batch, {
        opacity: 1,
        y: 0,
        duration: 0.9,
        ease: 'power3.out',
        stagger: 0.08,
        delay: Math.max(0, due - performance.now()) / 1000,
        onComplete() {
          show(batch);
          gsap.set(batch, { clearProps: 'opacity,transform' });
        },
      });
    },
  });
}

/** Drop the page's scroll triggers before its elements are replaced. */
export function stopReveal(): void {
  for (const trigger of ScrollTrigger.getAll()) trigger.kill();
}
