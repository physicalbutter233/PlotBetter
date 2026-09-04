const { screen } = require('electron');

const DOCK = { width: 26, height: 104 };
const EXPANDED = {
  minWidth: 880,
  minHeight: 620,
  maxWidth: 1080,
  maxHeight: 760,
  widthRatio: 0.72,
  heightRatio: 0.76,
};
const ANIM = {
  expandMs: 90,
  collapseMs: 95,
  tickMs: 6,
  hoverPad: 20,
  hoverPollMs: 16,
};

function getWorkArea() {
  return screen.getPrimaryDisplay().workArea;
}

function clampDockY(y, height = DOCK.height) {
  const wa = getWorkArea();
  const minY = wa.y;
  const maxY = wa.y + Math.max(0, wa.height - height);
  return Math.min(maxY, Math.max(minY, Math.round(y)));
}

/**
 * Dock Y from expanded window.
 * Prefer cursor Y only when the pointer leaves near the dock edge,
 * so clicking the Dock button does not move the strip to the chrome.
 */
function dockYFromBounds(fromBounds, cursorPoint = null, edge = 'right') {
  if (!fromBounds) {
    const wa = getWorkArea();
    return clampDockY(wa.y + Math.round((wa.height - DOCK.height) / 2));
  }

  if (cursorPoint && typeof cursorPoint.y === 'number' && typeof cursorPoint.x === 'number') {
    const inVertical =
      cursorPoint.y >= fromBounds.y - 48 &&
      cursorPoint.y <= fromBounds.y + fromBounds.height + 48;
    const nearDockSide =
      edge === 'left'
        ? cursorPoint.x <= fromBounds.x + 56
        : cursorPoint.x >= fromBounds.x + fromBounds.width - 56;
    if (inVertical && nearDockSide) {
      return clampDockY(cursorPoint.y - Math.round(DOCK.height / 2));
    }
  }

  const centerY = fromBounds.y + Math.round(fromBounds.height / 2);
  return clampDockY(centerY - Math.round(DOCK.height / 2));
}

function expandedBounds(edge = 'right', preferredDockY = null) {
  const wa = getWorkArea();
  const maxW = Math.max(480, wa.width - 12);
  const maxH = Math.max(420, wa.height - 12);
  const width = Math.min(
    maxW,
    EXPANDED.maxWidth,
    Math.max(Math.min(EXPANDED.minWidth, maxW), Math.round(wa.width * EXPANDED.widthRatio))
  );
  const height = Math.min(
    maxH,
    EXPANDED.maxHeight,
    Math.max(Math.min(EXPANDED.minHeight, maxH), Math.round(wa.height * EXPANDED.heightRatio))
  );

  let y;
  if (typeof preferredDockY === 'number' && Number.isFinite(preferredDockY)) {
    const dockCenter = preferredDockY + Math.round(DOCK.height / 2);
    y = clampDockY(dockCenter - Math.round(height / 2), height);
  } else {
    y = wa.y + Math.round((wa.height - height) / 2);
  }

  if (edge === 'left') {
    return { x: wa.x, y, width, height };
  }
  return {
    x: wa.x + wa.width - width,
    y,
    width,
    height,
  };
}

function dockBounds(edge = 'right', preferredY = null) {
  const wa = getWorkArea();
  const y =
    typeof preferredY === 'number' && Number.isFinite(preferredY)
      ? clampDockY(preferredY)
      : clampDockY(wa.y + Math.round((wa.height - DOCK.height) / 2));
  if (edge === 'left') {
    return { x: wa.x, y, width: DOCK.width, height: DOCK.height };
  }
  return {
    x: wa.x + wa.width - DOCK.width,
    y,
    width: DOCK.width,
    height: DOCK.height,
  };
}

function easeInCubic(t) {
  return t * t * t;
}

function easeInQuint(t) {
  return t * t * t * t * t;
}

function easeOutQuint(t) {
  return 1 - (1 - t) ** 5;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function easeOutBack(t) {
  const c1 = 1.525;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function boundsClose(a, b, tolerance = 4) {
  return (
    Math.abs(a.x - b.x) <= tolerance &&
    Math.abs(a.y - b.y) <= tolerance &&
    Math.abs(a.width - b.width) <= tolerance &&
    Math.abs(a.height - b.height) <= tolerance
  );
}

function unlockWindowSize(win) {
  win.setResizable(true);
  win.setMinimumSize(1, 1);
  win.setMaximumSize(99999, 99999);
}

function snapBounds(win, target) {
  if (!win || win.isDestroyed()) return false;
  unlockWindowSize(win);
  win.setBounds(target, false);
  const got = win.getBounds();
  if (!boundsClose(got, target, 8)) {
    win.setBounds(target, true);
  }
  return boundsClose(win.getBounds(), target, 12);
}

function createBoundsAnimator() {
  let timer = null;
  let runId = 0;

  function stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function cancel() {
    runId += 1;
    stopTimer();
  }

  function animateBounds(win, toBounds, { duration = 320, easing = easeOutQuint, onProgress } = {}) {
    cancel();
    const id = runId;
    if (!win || win.isDestroyed()) return Promise.resolve(false);

    unlockWindowSize(win);
    const from = win.getBounds();
    const start = performance.now();

    return new Promise((resolve) => {
      const finish = (completed) => {
        if (id !== runId) {
          resolve(false);
          return;
        }
        stopTimer();
        if (completed) snapBounds(win, toBounds);
        resolve(completed);
      };

      const tick = () => {
        if (id !== runId || win.isDestroyed()) {
          finish(false);
          return;
        }
        const t = Math.min(1, (performance.now() - start) / duration);
        const e = easing(t);
        if (typeof onProgress === 'function') onProgress(t, e);
        win.setBounds(
          {
            x: lerp(from.x, toBounds.x, e),
            y: lerp(from.y, toBounds.y, e),
            width: Math.max(DOCK.width, lerp(from.width, toBounds.width, e)),
            height: Math.max(DOCK.height, lerp(from.height, toBounds.height, e)),
          },
          false
        );
        if (t >= 1) {
          finish(true);
          return;
        }
        setTimeout(tick, ANIM.tickMs);
      };

      tick();
    });
  }

  function animateGrow(win, toBounds, options = {}) {
    return animateBounds(win, toBounds, options);
  }

  return { animateGrow, animateBounds, cancel, snapBounds };
}

function isCursorInsideBounds(bounds, pad = 12) {
  const pt = screen.getCursorScreenPoint();
  return (
    pt.x >= bounds.x - pad &&
    pt.x <= bounds.x + bounds.width + pad &&
    pt.y >= bounds.y - pad &&
    pt.y <= bounds.y + bounds.height + pad
  );
}

function isCursorInsideWindow(win, pad = 12) {
  if (!win || win.isDestroyed()) return false;
  return isCursorInsideBounds(win.getBounds(), pad);
}

function isCursorNearDock(edge = 'right', pad = ANIM.hoverPad, preferredY = null) {
  return isCursorInsideBounds(dockBounds(edge, preferredY), pad);
}

function defaultWidgetConfig() {
  return { enabled: true, edge: 'right', pinned: false, dockY: null };
}

function normalizeWidgetConfig(raw = {}) {
  const dockYRaw = raw.dockY;
  const dockY =
    typeof dockYRaw === 'number' && Number.isFinite(dockYRaw) ? Math.round(dockYRaw) : null;
  return {
    enabled: raw.enabled !== false,
    edge: raw.edge === 'left' ? 'left' : 'right',
    pinned: Boolean(raw.pinned),
    dockY,
  };
}

module.exports = {
  DOCK,
  EXPANDED,
  ANIM,
  clampDockY,
  dockYFromBounds,
  dockBounds,
  expandedBounds,
  easeOutBack,
  easeOutCubic,
  easeOutQuint,
  easeInQuint,
  easeInCubic,
  easeInOutCubic,
  createBoundsAnimator,
  isCursorInsideWindow,
  isCursorNearDock,
  defaultWidgetConfig,
  normalizeWidgetConfig,
};
