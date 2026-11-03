/** Fade sections in as they scroll into view; everything is visible immediately when motion is reduced. */
export function startReveal(): void {
  const targets = document.querySelectorAll<HTMLElement>('.reveal');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || !('IntersectionObserver' in window)) {
    for (const target of targets) target.classList.add('in');
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('in');
      observer.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -10% 0px' });
  for (const target of targets) observer.observe(target);
  // A missed intersection must never hide content for good: after a short grace period everything shows.
  setTimeout(() => {
    for (const target of targets) target.classList.add('in');
    observer.disconnect();
  }, 2500);
}
