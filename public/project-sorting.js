// Pointer events work inside WebView2 and allow a touch handle without blocking list scrolling.
export function createProjectSorting({ root, canSort, move, refresh, render, reportError }) {
  let gesture = null,
    saving = false,
    frame = 0,
    suppressClickUntil = 0;
  const entries = () => [...root.querySelectorAll('.project-entry')];
  const clearTargets = () => {
    for (const entry of entries()) delete entry.dataset.drop;
  };
  async function commit(body, focusHandle = false) {
    saving = true;
    root.setAttribute('aria-busy', 'true');
    try {
      await move(body);
      await refresh();
    } catch (error) {
      reportError(error);
    } finally {
      saving = false;
      root.removeAttribute('aria-busy');
      render();
      if (focusHandle)
        entries()
          .find((entry) => entry.dataset.cwd === body.cwd)
          ?.querySelector('.project-drag-handle')
          ?.focus({ preventScroll: true });
    }
  }
  function targetAtPointer() {
    clearTargets();
    gesture.target = null;
    const bounds = root.getBoundingClientRect();
    if (
      gesture.x < bounds.left ||
      gesture.x > bounds.right ||
      gesture.y < bounds.top - 20 ||
      gesture.y > bounds.bottom + 20
    )
      return;
    const group = entries().filter((entry) => entry.dataset.pinned === gesture.entry.dataset.pinned);
    // Only allow the pinned/unpinned group under the pointer, not a hidden group above it.
    const first = group[0]?.getBoundingClientRect(),
      last = group.at(-1)?.getBoundingClientRect();
    if (!first || gesture.y < first.top - 8 || gesture.y > last.bottom + 8) return;
    const candidates = group.filter((entry) => entry !== gesture.entry);
    const target =
      candidates.find((entry) => {
        const rect = entry.getBoundingClientRect();
        return gesture.y < rect.top + rect.height / 2;
      }) || candidates.at(-1);
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const position = gesture.y < rect.top + rect.height / 2 ? 'before' : 'after';
    // Dropping back in the original slot is a no-op.
    const from = group.indexOf(gesture.entry),
      to = group.indexOf(target);
    if ((position === 'before' && to === from + 1) || (position === 'after' && to === from - 1)) return;
    target.dataset.drop = position;
    gesture.target = { targetCwd: target.dataset.cwd, position };
  }
  function autoScroll() {
    if (!gesture?.dragging) return;
    const bounds = root.getBoundingClientRect();
    if (gesture.x >= bounds.left && gesture.x <= bounds.right) {
      const edge = 32;
      const speed = gesture.y < bounds.top + edge ? -8 : gesture.y > bounds.bottom - edge ? 8 : 0;
      if (speed) {
        root.scrollTop += speed;
        targetAtPointer();
      }
    }
    frame = requestAnimationFrame(autoScroll);
  }
  function finish(cancelled = false) {
    if (!gesture) return;
    const current = gesture;
    gesture = null;
    cancelAnimationFrame(frame);
    if (root.hasPointerCapture(current.pointerId)) root.releasePointerCapture(current.pointerId);
    clearTargets();
    current.entry.classList.remove('project-dragging');
    root.classList.remove('project-sorting');
    if (!current.dragging) return;
    suppressClickUntil = performance.now() + 350;
    if (!cancelled && current.target && canSort())
      void commit({ cwd: current.entry.dataset.cwd, ...current.target });
    else render();
  }
  root.addEventListener('pointerdown', (event) => {
    if (!canSort() || saving || gesture || event.button !== 0 || !event.isPrimary) return;
    const entry = event.target.closest('.project-entry');
    const handle = event.target.closest('.project-drag-handle');
    if (!entry || event.target.closest('.project-more') || (event.pointerType === 'touch' && !handle)) return;
    if (!handle && !event.target.closest('.project-row')) return;
    gesture = {
      entry,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      dragging: false,
      target: null,
    };
  });
  window.addEventListener(
    'pointermove',
    (event) => {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      gesture.x = event.clientX;
      gesture.y = event.clientY;
      if (!gesture.dragging) {
        if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < 6) return;
        gesture.dragging = true;
        root.setPointerCapture(event.pointerId);
        gesture.entry.classList.add('project-dragging');
        root.classList.add('project-sorting');
        autoScroll();
      }
      event.preventDefault();
      targetAtPointer();
    },
    { passive: false },
  );
  window.addEventListener('pointerup', (event) => {
    if (gesture?.pointerId === event.pointerId) finish();
  });
  root.addEventListener('lostpointercapture', (event) => {
    // Touch starts with implicit capture on the handle; transferring it to the list
    // must not be mistaken for cancelling the drag.
    if (event.target === root) finish(true);
  });
  window.addEventListener('pointercancel', () => finish(true));
  window.addEventListener('blur', () => finish(true));
  document.addEventListener('keydown', (event) => {
    if (gesture && event.key === 'Escape') {
      event.preventDefault();
      finish(true);
    }
  });
  root.addEventListener(
    'click',
    (event) => {
      if (performance.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
  root.addEventListener('dragstart', (event) => event.preventDefault());
  root.addEventListener('keydown', (event) => {
    const handle = event.target.closest('.project-drag-handle');
    if (!handle || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    if (saving || gesture || !canSort()) return;
    const entry = handle.closest('.project-entry'),
      group = entries();
    const direction = event.key === 'ArrowUp' ? -1 : 1;
    const next = group[group.indexOf(entry) + direction];
    if (!next || next.dataset.pinned !== entry.dataset.pinned) return;
    void commit({ cwd: entry.dataset.cwd, direction }, true);
  });
  return {
    get active() {
      return !!gesture || saving;
    },
  };
}
