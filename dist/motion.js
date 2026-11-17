// Delegated feedback survives the app's synchronous DOM replacements.
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const effects = new Set();

function play(node, keyframes, options) {
  const animation = node.animate(keyframes, options);
  const effect = { node, animation };
  effects.add(effect);
  const dispose = () => { node.remove(); effects.delete(effect); };
  animation.finished.then(dispose, dispose);
  return animation;
}

function feedback(button, event) {
  const rect = button.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const style = getComputedStyle(button);
  const layer = document.createElement('span');
  layer.className = 'button-feedback';
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, {
    left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`,
    height: `${rect.height}px`, borderRadius: style.borderRadius, color: style.color,
  });
  const ripple = document.createElement('span');
  const x = event.detail ? Math.max(0, Math.min(rect.width, event.clientX - rect.left)) : rect.width / 2;
  const y = event.detail ? Math.max(0, Math.min(rect.height, event.clientY - rect.top)) : rect.height / 2;
  const diameter = Math.hypot(rect.width, rect.height) * 2;
  Object.assign(ripple.style, {
    left: `${x - diameter / 2}px`, top: `${y - diameter / 2}px`,
    width: `${diameter}px`, height: `${diameter}px`,
  });
  layer.append(ripple);
  document.body.append(layer);
  ripple.animate([
    { transform: 'scale(0.08)', opacity: 0.22 },
    { opacity: 0.12, offset: 0.4 },
    { transform: 'scale(1)', opacity: 0 },
  ], { duration: 480, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' });
  play(layer, [{ opacity: 1 }, { opacity: 1 }], { duration: 480 });
}

function tabIndicator(previous) {
  const selected = document.querySelector('.tabs .tab.active');
  if (!selected || !previous) return;
  const next = selected.getBoundingClientRect();
  const line = document.createElement('span');
  line.className = 'tab-motion-indicator';
  line.setAttribute('aria-hidden', 'true');
  Object.assign(line.style, {
    left: `${previous.left}px`, top: `${previous.bottom - 2}px`,
    width: `${previous.width}px`,
  });
  document.body.append(line);
  selected.classList.add('tab-indicator-moving');
  const animation = play(line, [
    { transform: 'translate(0, 0) scaleX(1)', opacity: 0.65 },
    { transform: `translate(${next.left - previous.left}px, ${next.bottom - previous.bottom}px) scaleX(${next.width / previous.width})`, opacity: 1 },
  ], { duration: 300, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' });
  animation.finished.then(() => selected.classList.remove('tab-indicator-moving'), () => selected.classList.remove('tab-indicator-moving'));
}

document.addEventListener('click', event => {
  const button = event.target.closest('button, a.btn');
  if (!button || button.matches(':disabled, [aria-disabled="true"]') || reducedMotion.matches) return;
  feedback(button, event);
  const isTab = button.classList.contains('tab');
  const previous = isTab ? document.querySelector('.tabs .tab.active')?.getBoundingClientRect() : null;
  const changedTab = isTab && !button.classList.contains('active');
  // Run after the click handler has replaced the tabs/content, without delaying the action.
  requestAnimationFrame(() => {
    if (reducedMotion.matches) return;
    if (isTab) tabIndicator(previous);
    if (changedTab) {
      const panel = document.querySelector('.work-area, .page > .context-panel, .page > .asset-grid');
      panel?.animate([{ opacity: 0.5, transform: 'translateY(5px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 220, easing: 'cubic-bezier(.22,1,.36,1)' });
    }
  });
}, { capture: true });

function clearEffects() {
  for (const effect of effects) effect.animation.cancel();
}
// Fixed-position ripples should not linger in the old position after scrolling.
window.addEventListener('scroll', clearEffects, { passive: true });
window.addEventListener('resize', clearEffects, { passive: true });
reducedMotion.addEventListener('change', event => { if (event.matches) clearEffects(); });
