const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const chokidar = require('chokidar');

const { loadConfig, saveConfig, getDailyPath, ensureDataDir } = require('./src/config');
const { parseDaily, toggleTaskLine, addTask, updateTaskText, deleteLine, addTopic, linesToContent, getPendingTasks } = require('./src/parser');
const db = require('./src/database');
const widgetWindow = require('./src/widgetWindow');
const autoLaunch = require('./src/autoLaunch');

function loadPapers() {
  return require('./src/papers');
}

function loadQuiz() {
  return require('./src/quiz');
}

function loadZotero() {
  return require('./src/zotero');
}

let mainWindow = null;
let tray = null;
let watcher = null;
let dailyPath = null;
let internalWriteUntil = 0;
let appIsQuitting = false;
let widgetState = { mode: 'docked', pinned: false, edge: 'right', dockY: null };
let collapseTimer = null;
let expandGraceUntil = 0;
let isAnimating = false;
let widgetOpChain = Promise.resolve();
const boundsAnimator = widgetWindow.createBoundsAnimator();
let dockHoverTimer = null;
let expandedHoverTimer = null;
/** Bumped to cancel in-flight expand when minimizing to tray. */
let widgetSession = 0;

function isDisplayReady() {
  try {
    const wa = screen.getPrimaryDisplay().workArea;
    return wa.width > 200 && wa.height > 200;
  } catch {
    return false;
  }
}

function isStartupLaunchMode() {
  return (
    process.argv.includes('--startup') ||
    app.commandLine.hasSwitch('startup')
  );
}

const isStartupLaunch = isStartupLaunchMode();
let widgetUserVisible = false;
let dbReadyPromise = null;
let dbInitScheduled = false;
let backgroundServicesReady = false;
let watcherStarted = false;

function ensureDbReady({ force = false } = {}) {
  if (isStartupLaunch && !force && !dbReadyPromise && dbInitScheduled) {
    return new Promise((resolve, reject) => {
      const wait = () => {
        if (dbReadyPromise) {
          dbReadyPromise.then(resolve).catch(reject);
          return;
        }
        if (backgroundServicesReady) {
          reject(new Error('Database failed to initialize'));
          return;
        }
        setTimeout(wait, 40);
      };
      wait();
    });
  }
  if (!dbReadyPromise) {
    dbReadyPromise = db.initDb().catch((err) => {
      dbReadyPromise = null;
      throw err;
    });
  }
  return dbReadyPromise;
}

async function initBackgroundServices({ startFileWatcher = true } = {}) {
  if (backgroundServicesReady) return;
  await ensureDbReady({ force: true });
  db.dedupeTaskHistory();
  syncCompletedTasksFromDisk();
  readDailyFile({ syncTopics: true });
  if (startFileWatcher && !watcherStarted) {
    startWatcher();
    watcherStarted = true;
  }
  backgroundServicesReady = true;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('services-ready');
  }
}

function scheduleBackgroundServices() {
  dbInitScheduled = true;
  const delayMs = isStartupLaunch ? 3500 : 0;
  const run = () => {
    initBackgroundServices({ startFileWatcher: !isStartupLaunch }).catch((err) => {
      console.error('[startup] background init failed:', err);
    });
  };
  if (delayMs > 0) {
    setTimeout(run, delayMs);
  } else {
    run();
  }
}

function ensureBackgroundForExpand() {
  return initBackgroundServices({ startFileWatcher: true });
}

function runWidgetOp(fn) {
  widgetOpChain = widgetOpChain.then(fn).catch((err) => {
    console.error('[widget]', err);
    isAnimating = false;
  });
  return widgetOpChain;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWidgetShellAnimation(win, className, ms) {
  if (!win || win.isDestroyed()) return;
  try {
    await win.webContents.executeJavaScript(
      `(function(){
        return new Promise(function(resolve) {
          var root = document.getElementById('widget-root');
          if (!root) { resolve(); return; }
          root.classList.remove('expand-anim', 'collapse-anim');
          root.classList.add('${className}');
          var shell = document.getElementById('app-shell');
          var finish = function() {
            root.classList.remove('${className}');
            if (shell) shell.style.willChange = '';
            resolve();
          };
          if (shell) shell.style.willChange = 'opacity';
          root.addEventListener('animationend', finish, { once: true });
          setTimeout(finish, ${ms + 32});
        });
      })();`,
      true
    );
  } catch {
    await sleep(ms);
  }
}

/** Launch Zotero directly to avoid Chromium "Allow this site to open zotero link" prompts. */
function openZoteroUri(uri, zoteroConfig, options = {}) {
  const zotero = loadZotero();
  const cfg = zotero.normalizeZoteroConfig(zoteroConfig || {});
  const exe = cfg.zoteroExePath || zotero.detectZoteroExePath();
  const useExternal = options.preferExternal || options.running;

  if (useExternal || !exe || !fs.existsSync(exe)) {
    shell.openExternal(uri);
    return { mode: 'protocol' };
  }
  spawn(exe, [uri], { detached: true, stdio: 'ignore' }).unref();
  return { mode: 'exe', path: exe };
}

function openLocalPdfWithZotero(filePath, zoteroConfig) {
  const zotero = loadZotero();
  const cfg = zotero.normalizeZoteroConfig(zoteroConfig || {});
  const exe = cfg.zoteroExePath || zotero.detectZoteroExePath();
  const normalized = path.resolve(filePath);
  if (exe && fs.existsSync(exe)) {
    spawn(exe, [normalized], { detached: true, stdio: 'ignore' }).unref();
    return true;
  }
  return false;
}

async function openPaperPdfResult(result, zoteroConfig) {
  const normalized = path.resolve(result.filePath);
  if (!fs.existsSync(normalized)) {
    throw new Error(`PDF not found at ${normalized}`);
  }
  if (openLocalPdfWithZotero(normalized, zoteroConfig)) return '';
  return shell.openPath(normalized);
}

function canOpenPaperInZotero(z) {
  const zotero = loadZotero();
  const cfg = zotero.normalizeZoteroConfig(z || {});
  const exe = cfg.zoteroExePath || zotero.detectZoteroExePath();
  return Boolean(cfg.enabled && exe && fs.existsSync(exe));
}

function isInternalWrite() {
  return Date.now() < internalWriteUntil;
}

function writeDailyContent(content) {
  internalWriteUntil = Date.now() + 800;
  fs.writeFileSync(dailyPath, content, 'utf8');
  if (db.isReady()) {
    db.setState(DAILY_MIGRATE_HASH_KEY, dailyContentHash(content));
  }
  return readDailyFile({ syncTopics: true });
}

function writeDailyLines(lines) {
  return writeDailyContent(linesToContent(lines));
}

const DAILY_MIGRATE_HASH_KEY = 'daily_migrate_hash';

function dailyContentHash(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 24);
}

function migrateCompletedTasks(content, { force = false } = {}) {
  const parsed = parseDaily(content);
  const doneTasks = parsed.tasks.filter((t) => t.done);
  if (doneTasks.length === 0) return content;

  if (!force && db.isReady()) {
    const sourceHash = dailyContentHash(content);
    if (db.getState(DAILY_MIGRATE_HASH_KEY) === sourceHash) {
      return content;
    }
  }

  const today = db.localDateString();
  for (const task of doneTasks) {
    db.addCompletedTask(task.text, today);
  }

  let lines = [...parsed.lines];
  for (const task of [...doneTasks].sort((a, b) => b.lineIndex - a.lineIndex)) {
    lines = deleteLine(lines, task.lineIndex);
  }
  const result = linesToContent(lines);

  if (db.isReady()) {
    db.setState(DAILY_MIGRATE_HASH_KEY, dailyContentHash(content));
  }
  return result;
}

function syncCompletedTasksFromDisk() {
  if (!dailyPath || !fs.existsSync(dailyPath) || !db.isReady()) return;
  let content = fs.readFileSync(dailyPath, 'utf8');
  const migrated = migrateCompletedTasks(content);
  if (migrated === content) return;
  internalWriteUntil = Date.now() + 800;
  fs.writeFileSync(dailyPath, migrated, 'utf8');
}

function readDailyFile({ syncTopics = false } = {}) {
  if (!dailyPath || !fs.existsSync(dailyPath)) {
    ensureDataDir();
    if (!dailyPath || !fs.existsSync(dailyPath)) {
      fs.writeFileSync(
        dailyPath,
        '@topic: OpenVLA\n\n- [ ] Load today\'s paper (Today\'s Paper)\n',
        'utf8'
      );
    }
  }
  const content = fs.readFileSync(dailyPath, 'utf8');
  if (syncTopics && db.isReady()) {
    const parsedForTopics = parseDaily(content);
    const topicNames = parsedForTopics.topics.map((t) => t.name);
    db.syncTopicsFromNames(topicNames);
  }
  const parsed = parseDaily(content);
  const pendingTasks = getPendingTasks(parsed);
  return { content, ...parsed, pendingTasks, path: dailyPath };
}

function broadcastDailyUpdate() {
  if (isInternalWrite()) return;
  if (db.isReady()) {
    syncCompletedTasksFromDisk();
  }
  const data = readDailyFile({ syncTopics: db.isReady() });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('daily-updated', data);
  }
}

function startWatcher() {
  if (watcher) watcher.close();
  watcher = chokidar.watch(dailyPath, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 300 } });
  watcher.on('change', () => broadcastDailyUpdate());
}

function sendWidgetState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('widget-state', { ...widgetState });
  }
}

async function forceRendererMode(win, mode) {
  if (!win || win.isDestroyed()) return;
  const edge = widgetState.edge === 'left' ? 'left' : 'right';
  const pinned = widgetState.pinned ? ' pinned' : '';
  const allowed = new Set(['docked', 'expanded', 'expanding', 'collapsing']);
  const safeMode = allowed.has(mode) ? mode : 'expanded';
  try {
    await win.webContents.executeJavaScript(
      `(function(){
        var root = document.getElementById('widget-root');
        if (root) root.className = 'widget-root ${safeMode} edge-${edge}';
        document.body.className = 'widget ${safeMode} edge-${edge}${pinned}';
      })();`,
      true
    );
  } catch (err) {
    console.error('[widget] forceRendererMode failed:', err.message || err);
  }
}

async function waitForRenderer(win) {
  if (!win || win.isDestroyed()) return;
  if (!win.webContents.isLoadingMainFrame?.() && !win.webContents.isLoading()) return;
  await new Promise((resolve) => {
    const done = () => resolve();
    win.webContents.once('did-finish-load', done);
    setTimeout(done, 5000);
  });
}

function stopDockHoverWatch() {
  if (dockHoverTimer) {
    clearInterval(dockHoverTimer);
    dockHoverTimer = null;
  }
}

function startDockHoverWatch() {
  stopDockHoverWatch();
  dockHoverTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (widgetState.mode !== 'docked' || isAnimating) return;
    const onStrip = widgetWindow.isCursorInsideWindow(mainWindow, 6);
    const nearEdge = widgetWindow.isCursorNearDock(
      widgetState.edge,
      widgetWindow.ANIM.hoverPad,
      widgetState.dockY
    );
    if (onStrip || nearEdge) {
      expandWidget({ focus: false });
    }
  }, widgetWindow.ANIM.hoverPollMs);
}

function stopExpandedHoverWatch() {
  if (expandedHoverTimer) {
    clearInterval(expandedHoverTimer);
    expandedHoverTimer = null;
  }
}

function startExpandedHoverWatch() {
  stopExpandedHoverWatch();
  expandedHoverTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (widgetState.pinned || isAnimating) return;
    if (widgetState.mode !== 'expanded') return;
    if (Date.now() < expandGraceUntil) return;

    if (widgetWindow.isCursorInsideWindow(mainWindow, 8)) {
      if (collapseTimer) {
        clearTimeout(collapseTimer);
        collapseTimer = null;
      }
      return;
    }
    scheduleCollapse();
  }, widgetWindow.ANIM.hoverPollMs);
}

function persistWidgetDockY(dockY) {
  const y = widgetWindow.clampDockY(dockY);
  widgetState.dockY = y;
  try {
    const config = loadConfig();
    config.widget = {
      ...widgetWindow.normalizeWidgetConfig(config.widget),
      dockY: y,
    };
    saveConfig(config);
  } catch (err) {
    console.warn('[widget] persist dockY failed:', err.message || err);
  }
  return y;
}

function resolveDockY(win, { fromCurrentWindow = false } = {}) {
  if (fromCurrentWindow && win && !win.isDestroyed()) {
    let cursorPoint = null;
    try {
      cursorPoint = screen.getCursorScreenPoint();
    } catch {
      cursorPoint = null;
    }
    return widgetWindow.dockYFromBounds(win.getBounds(), cursorPoint, widgetState.edge);
  }
  if (typeof widgetState.dockY === 'number' && Number.isFinite(widgetState.dockY)) {
    return widgetWindow.clampDockY(widgetState.dockY);
  }
  return widgetWindow.dockYFromBounds(null);
}

async function applyDocked(win, { animate = true, keepHidden = false } = {}) {
  if (!win || win.isDestroyed()) return;
  clearTimeout(collapseTimer);
  boundsAnimator.cancel();
  stopDockHoverWatch();
  stopExpandedHoverWatch();

  widgetSession += 1;
  const session = widgetSession;
  const fromExpanded = widgetState.mode === 'expanded';
  const dockY = resolveDockY(win, { fromCurrentWindow: fromExpanded });
  if (fromExpanded) persistWidgetDockY(dockY);
  const target = widgetWindow.dockBounds(widgetState.edge, dockY);
  const shouldAnimate = animate && win.isVisible() && fromExpanded && !keepHidden;
  isAnimating = true;
  widgetUserVisible = !keepHidden;

  try {
    await waitForRenderer(win);
    if (session !== widgetSession || win.isDestroyed()) return;

    win.setSkipTaskbar(true);
    win.setAlwaysOnTop(true, 'screen-saver');
    if (typeof win.setHasShadow === 'function') win.setHasShadow(false);

    if (shouldAnimate) {
      widgetState.mode = 'docked';
      sendWidgetState();
      await forceRendererMode(win, 'docked');
      if (session !== widgetSession || win.isDestroyed()) return;

      unlockWidgetSize(win);
      win.setResizable(true);
      await boundsAnimator.animateBounds(win, target, {
        duration: widgetWindow.ANIM.collapseMs,
        easing: widgetWindow.easeInCubic,
      });
      if (session !== widgetSession || win.isDestroyed()) return;
    } else {
      boundsAnimator.snapBounds(win, target);
      widgetState.mode = 'docked';
      sendWidgetState();
      await forceRendererMode(win, 'docked');
    }

    win.setMinimumSize(target.width, target.height);
    win.setMaximumSize(target.width, target.height);
    win.setResizable(false);

    ensureTray();

    if (keepHidden) {
      win.hide();
    } else {
      win.showInactive();
      startDockHoverWatch();
    }
  } finally {
    isAnimating = false;
    collapseTimer = null;
  }
}

function unlockWidgetSize(win) {
  win.setResizable(true);
  win.setMinimumSize(1, 1);
  win.setMaximumSize(99999, 99999);
}

async function applyExpanded(win, { animate = true } = {}) {
  if (!win || win.isDestroyed()) return;
  clearTimeout(collapseTimer);
  boundsAnimator.cancel();
  stopDockHoverWatch();
  stopExpandedHoverWatch();

  const session = ++widgetSession;
  await waitForRenderer(win);
  if (session !== widgetSession || win.isDestroyed()) return;

  const dockY = resolveDockY(win);
  const target = widgetWindow.expandedBounds(widgetState.edge, dockY);
  const fromDocked = widgetState.mode === 'docked';
  const shouldAnimate = animate && fromDocked;
  isAnimating = true;
  widgetUserVisible = true;

  try {
    unlockWidgetSize(win);
    win.setAlwaysOnTop(true, 'floating');
    win.setSkipTaskbar(false);
    if (typeof win.setHasShadow === 'function') win.setHasShadow(true);

    widgetState.mode = 'expanded';
    sendWidgetState();
    await forceRendererMode(win, 'expanded');
    if (session !== widgetSession || win.isDestroyed()) return;

    boundsAnimator.snapBounds(win, target);
    win.setMinimumSize(400, 320);
    win.setMaximumSize(99999, 99999);
    win.setResizable(true);

    if (!win.isVisible()) win.showInactive();
    win.show();
    win.focus();

    if (shouldAnimate) {
      await runWidgetShellAnimation(win, 'expand-anim', widgetWindow.ANIM.expandMs);
    }

    sendWidgetState();
  } finally {
    isAnimating = false;
    if (
      session === widgetSession &&
      !win.isDestroyed() &&
      widgetState.mode === 'expanded' &&
      !widgetState.pinned
    ) {
      startExpandedHoverWatch();
    }
  }
}

function collapseToDock() {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve();
  if (widgetState.pinned) return Promise.resolve();
  if (widgetState.mode === 'docked' && mainWindow.isVisible()) {
    startDockHoverWatch();
    return Promise.resolve();
  }
  if (isAnimating) return Promise.resolve();
  return applyDockedQueued(mainWindow, { animate: true, keepHidden: false });
}

/** Fully hide window; tray remains for Quit / reopen. */
function minimizeToTray() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  return applyDockedQueued(mainWindow, { animate: false, keepHidden: true });
}

function applyDockedQueued(win, opts) {
  return runWidgetOp(() => applyDocked(win, opts));
}

function applyExpandedQueued(win, opts) {
  return runWidgetOp(() => applyExpanded(win, opts));
}

function expandWidget({ focus = false } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve();
  if (widgetState.mode === 'expanded' && mainWindow.isVisible()) {
    if (focus) mainWindow.focus();
    return Promise.resolve();
  }
  if (isAnimating) return Promise.resolve();

  clearTimeout(collapseTimer);
  expandGraceUntil = Date.now() + (focus ? 320 : 160);
  widgetUserVisible = true;

  return ensureBackgroundForExpand()
    .catch((err) => console.error('[startup] expand preload failed:', err))
    .then(() => applyExpandedQueued(mainWindow, { animate: true }))
    .then(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (focus) mainWindow.focus();
    });
}

function scheduleCollapse() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (widgetState.pinned || isAnimating) return;
  if (widgetState.mode !== 'expanded') return;
  if (collapseTimer) return;
  collapseTimer = setTimeout(() => {
    collapseTimer = null;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (widgetState.pinned || isAnimating) return;
    if (widgetState.mode !== 'expanded') return;
    if (widgetWindow.isCursorInsideWindow(mainWindow, 8)) return;
    collapseToDock();
  }, 320);
}

function createWindow() {
  const config = loadConfig();
  const widgetCfg = widgetWindow.normalizeWidgetConfig(config.widget);
  widgetState.edge = widgetCfg.edge;
  widgetState.pinned = widgetCfg.pinned;
  widgetState.dockY =
    typeof widgetCfg.dockY === 'number' ? widgetWindow.clampDockY(widgetCfg.dockY) : null;

  const dock = widgetWindow.dockBounds(widgetState.edge, widgetState.dockY);
  mainWindow = new BrowserWindow({
    width: dock.width,
    height: dock.height,
    x: dock.x,
    y: dock.y,
    frame: false,
    transparent: false,
    thickFrame: false,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    title: 'PlotBetter',
    backgroundColor: '#05080e',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile('index.html');
  mainWindow.webContents.on('did-finish-load', () => {
    sendWidgetState();
    forceRendererMode(mainWindow, widgetState.mode).catch(() => {});
  });

  mainWindow.once('ready-to-show', async () => {
    try {
      if (widgetState.pinned) {
        await expandWidget({ focus: true });
        return;
      }
      await applyDockedQueued(mainWindow, { animate: false, keepHidden: false });
    } catch (err) {
      console.error('[widget] ready-to-show failed:', err);
      try {
        await applyDockedQueued(mainWindow, { animate: false, keepHidden: false });
      } catch (err2) {
        console.error('[widget] dock fallback failed:', err2);
      }
    }
  });

  mainWindow.on('close', (e) => {
    if (!appIsQuitting) {
      e.preventDefault();
      collapseToDock();
    }
  });

  mainWindow.on('minimize', (e) => {
    e.preventDefault();
    collapseToDock();
  });

  mainWindow.on('blur', () => {
    if (widgetState.mode === 'expanded' && !widgetState.pinned && !isAnimating) {
      scheduleCollapse();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function repositionWidgetWindow() {
  if (!mainWindow || mainWindow.isDestroyed() || isAnimating) return;
  if (!mainWindow.isVisible()) return;
  if (widgetState.mode === 'expanded') {
    applyExpandedQueued(mainWindow, { animate: false });
  } else if (widgetState.mode === 'docked') {
    applyDockedQueued(mainWindow, { animate: false, keepHidden: false });
  }
}

function createTrayIcon() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  if (fs.existsSync(iconPath)) {
    const fromFile = nativeImage.createFromPath(iconPath);
    if (!fromFile.isEmpty()) {
      const sized = fromFile.resize({ width: 16, height: 16 });
      return sized.isEmpty() ? fromFile : sized;
    }
  }

  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - 7.5;
      const dy = y - 7.5;
      const inCircle = dx * dx + dy * dy <= 36;
      const i = (y * size + x) * 4;
      buf[i] = inCircle ? 0 : 0;
      buf[i + 1] = inCircle ? 234 : 0;
      buf[i + 2] = inCircle ? 255 : 0;
      buf[i + 3] = inCircle ? 255 : 0;
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

function ensureTray() {
  if (tray) return true;
  try {
    createTray();
    return Boolean(tray);
  } catch (err) {
    console.error('[tray] create failed:', err);
    return false;
  }
}

function createTray() {
  if (tray) {
    try {
      tray.destroy();
    } catch {
      /* ignore */
    }
    tray = null;
  }

  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('PlotBetter — double-click to open');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Show PlotBetter',
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) expandWidget({ focus: true });
          else createWindow();
        },
      },
      {
        label: 'Open daily note',
        click: () => {
          if (dailyPath) shell.openPath(dailyPath);
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          appIsQuitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on('double-click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) expandWidget({ focus: true });
  });
  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) expandWidget({ focus: true });
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      expandWidget({ focus: true });
    }
  });
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.plotbetter.app');
  }
  ensureDataDir();
  const config = loadConfig();
  dailyPath = getDailyPath(config);
  ensureTray();
  createWindow();
  scheduleBackgroundServices();
  const syncAutoLaunch = () => autoLaunch.syncAutoLaunchFromConfig(config);
  if (isStartupLaunch) {
    setTimeout(syncAutoLaunch, 8000);
  } else {
    syncAutoLaunch();
  }
  screen.on('display-metrics-changed', repositionWidgetWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Keep running in tray on Windows
  }
});

app.on('before-quit', () => {
  appIsQuitting = true;
  stopDockHoverWatch();
  stopExpandedHoverWatch();
  boundsAnimator.cancel();
  if (watcher) watcher.close();
});

ipcMain.handle('widget-expand', () => {
  expandWidget();
  return { ...widgetState };
});

ipcMain.handle('widget-collapse', () => {
  collapseToDock();
  return { ...widgetState };
});

ipcMain.handle('widget-schedule-collapse', () => {
  scheduleCollapse();
  return { ...widgetState };
});

ipcMain.handle('widget-toggle-pin', () => {
  widgetState.pinned = !widgetState.pinned;
  const config = loadConfig();
  config.widget = { ...widgetWindow.normalizeWidgetConfig(config.widget), pinned: widgetState.pinned };
  saveConfig(config);
  if (widgetState.pinned) {
    stopExpandedHoverWatch();
    clearTimeout(collapseTimer);
  } else if (widgetState.mode === 'expanded') {
    startExpandedHoverWatch();
  }
  sendWidgetState();
  return { ...widgetState };
});

ipcMain.handle('widget-get-state', () => ({ ...widgetState }));

ipcMain.handle('get-auto-launch-info', () => autoLaunch.getAutoLaunchInfo());

ipcMain.handle('get-daily', async () => {
  if (!db.isReady()) {
    return readDailyFile();
  }
  return readDailyFile({ syncTopics: true });
});

ipcMain.handle('get-topics', async () => {
  if (!db.isReady()) {
    await ensureDbReady();
  }
  return db.getTopics();
});

ipcMain.handle('toggle-task', async (_e, lineIndex, done) => {
  await ensureDbReady();
  if (!done) return readDailyFile();
  const data = readDailyFile();
  const task = data.tasks.find((t) => t.lineIndex === lineIndex);
  if (!task || task.done) return data;
  db.addCompletedTask(task.text);
  return writeDailyLines(deleteLine(data.lines, lineIndex));
});

ipcMain.handle('complete-task', async (_e, lineIndex, expectedText) => {
  await ensureDbReady();
  const data = readDailyFile();
  const expected = typeof expectedText === 'string' ? expectedText.trim() : '';
  if (!expected) {
    return { daily: data, history: db.getTaskHistoryGrouped() };
  }

  let task = data.tasks.find((t) => t.lineIndex === lineIndex);
  if (task && (task.done || task.text !== expected)) {
    task = null;
  }
  if (!task) {
    const matches = data.tasks.filter((t) => !t.done && t.text === expected);
    if (matches.length === 1) task = matches[0];
  }
  if (!task || task.done) {
    return { daily: data, history: db.getTaskHistoryGrouped() };
  }

  db.addCompletedTask(task.text);
  const daily = writeDailyLines(deleteLine(data.lines, task.lineIndex));
  return { daily, history: db.getTaskHistoryGrouped() };
});

ipcMain.handle('get-task-history', async () => {
  await ensureDbReady();
  return db.getTaskHistoryGrouped();
});

ipcMain.handle('delete-completed-task', (_e, id) => {
  db.deleteCompletedTask(id);
  return db.getTaskHistoryGrouped();
});

ipcMain.handle('get-backlog-tasks', async () => {
  await ensureDbReady();
  return db.getBacklogTasks();
});

ipcMain.handle('add-backlog-task', (_e, text) => db.addBacklogTask(text));

ipcMain.handle('update-backlog-task', (_e, id, text) => db.updateBacklogTask(id, text));

ipcMain.handle('delete-backlog-task', (_e, id) => db.deleteBacklogTask(id));

ipcMain.handle('complete-backlog-task', (_e, id) => db.completeBacklogTask(id));

ipcMain.handle('move-backlog-to-today', (_e, id) => {
  const tasks = db.getBacklogTasks();
  const task = tasks.find((t) => t.id === id);
  if (!task) return { daily: readDailyFile(), backlog: tasks };
  const data = readDailyFile();
  const daily = writeDailyLines(addTask(data.lines, task.text));
  db.deleteBacklogTask(id);
  return { daily, backlog: db.getBacklogTasks() };
});

ipcMain.handle('add-transaction', (_e, payload) => {
  db.addTransaction(payload);
  const yearMonth = payload?.txnDate?.slice(0, 7);
  return {
    history: db.getTransactionsGrouped(yearMonth),
    summary: db.getMonthlySummary(yearMonth),
  };
});

ipcMain.handle('delete-transaction', (_e, id, yearMonth) => {
  db.deleteTransaction(id);
  return {
    history: db.getTransactionsGrouped(yearMonth),
    summary: db.getMonthlySummary(yearMonth),
  };
});

ipcMain.handle('get-transactions', (_e, yearMonth) => db.getTransactionsGrouped(yearMonth));

ipcMain.handle('get-monthly-summary', (_e, yearMonth) => db.getMonthlySummary(yearMonth));

ipcMain.handle('get-recipes', () => db.getRecipes());

ipcMain.handle('get-recipe', (_e, id) => db.getRecipe(id));

ipcMain.handle('add-recipe', (_e, payload) => db.addRecipe(payload || {}));

ipcMain.handle('update-recipe', (_e, id, payload) => db.updateRecipe(id, payload || {}));

ipcMain.handle('delete-recipe', (_e, id) => {
  db.deleteRecipe(id);
  return db.getRecipes();
});

ipcMain.handle('save-daily', async (_e, content) => {
  await ensureDbReady();
  const migrated = migrateCompletedTasks(content, { force: true });
  return writeDailyContent(migrated);
});

ipcMain.handle('add-task', (_e, text) => {
  const data = readDailyFile();
  return writeDailyLines(addTask(data.lines, text));
});

ipcMain.handle('update-task', (_e, lineIndex, text) => {
  const data = readDailyFile();
  return writeDailyLines(updateTaskText(data.lines, lineIndex, text));
});

ipcMain.handle('delete-task', (_e, lineIndex) => {
  const data = readDailyFile();
  return writeDailyLines(deleteLine(data.lines, lineIndex));
});

ipcMain.handle('add-topic', (_e, name) => {
  const data = readDailyFile();
  return writeDailyLines(addTopic(data.lines, name));
});

ipcMain.handle('delete-topic', (_e, lineIndex) => {
  const data = readDailyFile();
  return writeDailyLines(deleteLine(data.lines, lineIndex));
});

ipcMain.handle('open-daily', () => shell.openPath(dailyPath));

ipcMain.handle('open-external', (_e, url) => shell.openExternal(url));

ipcMain.handle('get-config', () => {
  const config = loadConfig();
  return { ...config, dailyPath };
});

ipcMain.handle('save-config', (_e, partial) => {
  const config = loadConfig();
  if (partial.dailyFile !== undefined) config.dailyFile = partial.dailyFile;
  if (partial.pushHour !== undefined) config.pushHour = partial.pushHour;
  if (partial.zotero) {
    config.zotero = loadZotero().normalizeZoteroConfig({ ...config.zotero, ...partial.zotero });
  }
  if (partial.widget) {
    config.widget = widgetWindow.normalizeWidgetConfig({ ...config.widget, ...partial.widget });
    widgetState.edge = config.widget.edge;
    if (typeof config.widget.dockY === 'number') {
      widgetState.dockY = widgetWindow.clampDockY(config.widget.dockY);
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (widgetState.mode === 'docked') {
        applyDockedQueued(mainWindow, { animate: false, keepHidden: !mainWindow.isVisible() });
      } else if (mainWindow.isVisible()) {
        applyExpandedQueued(mainWindow, { animate: false });
      }
    }
  }
  if (partial.autoLaunch !== undefined) {
    config.autoLaunch = Boolean(partial.autoLaunch);
    const applied = autoLaunch.applyAutoLaunch(config.autoLaunch);
    config.autoLaunch = applied;
  }
  if (partial.quizLanguage !== undefined) {
    const { normalizeQuizLanguage } = loadQuiz();
    config.quizLanguage = normalizeQuizLanguage(partial.quizLanguage);
  }
  saveConfig(config);
  return loadConfig();
});

ipcMain.handle('pick-zotero-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Zotero data folder',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('zotero-test', async () => {
  const config = loadConfig();
  return loadZotero().testConnection(config.zotero);
});

ipcMain.handle('zotero-add-paper', async (_e, paper) => {
  const config = loadConfig();
  if (!config.zotero?.enabled) {
    throw new Error('Enable Zotero integration in Settings first.');
  }
  return loadZotero().addPaperToLibrary(config.zotero, paper);
});

ipcMain.handle('zotero-open-paper', async (event, paper) => {
  const config = loadConfig();
  const z = config.zotero || {};
  if (!z.enabled) {
    throw new Error('Enable Zotero integration in Settings first.');
  }
  const zotero = loadZotero();
  const sendProgress = (progress) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('zotero-open-progress', progress);
    }
  };
  const result = await zotero.openPaperInZotero(z, paper, sendProgress);
  return result;
});

async function getExcludeArxivIds(topicId) {
  const exclude = db.getPushedArxivIds(topicId);
  const config = loadConfig();
  if (config.zotero?.enabled && config.zotero?.skipLibraryItems) {
    try {
      const zotero = loadZotero();
      const libraryIds = await zotero.getLibraryArxivIds(config.zotero);
      return [...new Set([...exclude, ...libraryIds])];
    } catch (err) {
      console.warn('Zotero exclude list failed:', err.message);
    }
  }
  return exclude;
}

function normalizeAssignDate(input) {
  if (!input || input === 'today') return db.localDateString();
  if (input === 'yesterday') {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return db.localDateString(d);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(input))) return String(input);
  throw new Error('Invalid date. Use today, yesterday, or YYYY-MM-DD.');
}

function buildPaperCardFromRow(row, topic, config) {
  const { buildPaperCard } = loadPapers();
  const zotero = loadZotero();
  const card = buildPaperCard(
    {
      arxivId: row.arxiv_id,
      title: row.title,
      authors: row.authors,
      abstract: row.abstract,
      url: row.url,
    },
    topic.name,
    topic.level
  );
  card.pushedAt = row.pushed_at;
  card.readStatus = row.read_status || 'unread';
  card.lastReadAt = row.last_read_at;
  card.source = row.source || 'auto';
  card.rating = row.rating;
  card.zoteroEnabled = Boolean(config.zotero?.enabled);
  card.canOpenInZotero = canOpenPaperInZotero(config.zotero);
  card.dailyPaperCollection = config.zotero?.dailyPaperCollection || 'daily_paper';
  card.dailyPaperFolder = path.basename(zotero.getDailyPaperDir(config.zotero || {}));
  return card;
}

ipcMain.handle('get-paper-resume-hint', async (_e, topicName) => {
  await ensureDbReady();
  const topic = db.getTopicByName(topicName);
  if (!topic) throw new Error('Topic not found');
  return db.getPaperResumeHint(topic.id);
});

ipcMain.handle('continue-paper', async (_e, topicName) => {
  await ensureDbReady();
  const topic = db.getTopicByName(topicName);
  if (!topic) throw new Error('Topic not found');
  const row = db.continuePaperToToday(topic.id);
  if (!row) throw new Error('No unfinished paper to continue.');
  return buildPaperCardFromRow(row, topic, loadConfig());
});

ipcMain.handle('assign-paper', async (_e, topicName, arxivInput, targetDate) => {
  await ensureDbReady();
  const topic = db.getTopicByName(topicName);
  if (!topic) throw new Error('Topic not found');
  const { fetchArxivByIds, parseArxivId } = loadPapers();
  const arxivId = parseArxivId(arxivInput);
  if (!arxivId) throw new Error('Invalid arXiv ID or URL.');
  const [paper] = await fetchArxivByIds([arxivId]);
  if (!paper) throw new Error(`Paper ${arxivId} not found on arXiv.`);
  const dateStr = normalizeAssignDate(targetDate);
  db.assignPaperForDate(topic.id, paper, dateStr, 'manual');
  const row = db.getPaperForDate(topic.id, dateStr);
  return buildPaperCardFromRow(row, topic, loadConfig());
});

ipcMain.handle('mark-paper-reading', async (_e, topicName, arxivId, readStatus = 'in_progress') => {
  await ensureDbReady();
  const topic = db.getTopicByName(topicName);
  if (!topic) throw new Error('Topic not found');
  if (!arxivId) throw new Error('Paper ID required');
  db.updatePaperReading(topic.id, arxivId, { readStatus, touchLastRead: true });
  return { ok: true };
});

ipcMain.handle('get-today-paper', async (_e, topicName, options = {}) => {
  await ensureDbReady();
  const topic = db.getTopicByName(topicName);
  const { recommendPaper, buildPaperCard } = loadPapers();
  if (!topic) throw new Error('Topic not found');

  const config = loadConfig();
  const forceNew = Boolean(options?.forceNew);

  if (forceNew) {
    db.clearTodayPaper(topic.id);
  }

  let paper = forceNew ? null : db.getTodayPaper(topic.id);
  if (paper) {
    return buildPaperCardFromRow(paper, topic, config);
  }

  const exclude = await getExcludeArxivIds(topic.id);
  const recommended = await recommendPaper(topic.name, topic.level, exclude);
  const card = buildPaperCard(recommended, topic.name, topic.level);
  db.savePaperPush(topic.id, card, { source: 'auto', readStatus: 'unread' });
  const row = db.getTodayPaper(topic.id);
  return buildPaperCardFromRow(row || { ...card, arxiv_id: card.arxivId, pushed_at: db.localDateString(), read_status: 'unread', source: 'auto', rating: null, last_read_at: null }, topic, config);
});

ipcMain.handle('rate-paper', async (_e, topicName, rating) => {
  await ensureDbReady();
  const topic = db.getTopicByName(topicName);
  if (!topic) return null;
  db.rateTodayPaper(topic.id, rating);
  if (rating === 'too_hard') db.updateTopicLevel(topic.id, -1);
  else if (rating === 'too_easy') db.updateTopicLevel(topic.id, 1);

  let zoteroResult = null;
  if (rating === 'just_right') {
    const config = loadConfig();
    if (config.zotero?.enabled && config.zotero?.autoAddOnJustRight) {
      const paper = db.getTodayPaper(topic.id);
      if (paper && config.zotero.apiKey && config.zotero.userId) {
        try {
          zoteroResult = await loadZotero().addPaperToLibrary(config.zotero, {
            arxivId: paper.arxiv_id,
            title: paper.title,
            authors: paper.authors,
            abstract: paper.abstract,
            url: paper.url,
          });
        } catch (err) {
          zoteroResult = { ok: false, message: err.message };
        }
      }
    }
  }

  return { topic: db.getTopicByName(topicName), zoteroResult };
});

ipcMain.handle('get-quiz', async (_e, topicName) => {
  await ensureDbReady();
  const topic = db.getTopicByName(topicName);
  if (!topic) throw new Error('Topic not found');
  const config = loadConfig();
  const { getQuestionForTopic } = loadQuiz();
  return getQuestionForTopic(topic.name, topic.level, config.quizLanguage);
});

ipcMain.handle('submit-quiz', (_e, topicName, question, selectedIndex, correctIndex) => {
  const topic = db.getTopicByName(topicName);
  if (!topic) return null;
  const correct = selectedIndex === correctIndex;
  db.logQuiz(topic.id, question, correct);
  if (correct) db.updateTopicLevel(topic.id, 1);
  else db.updateTopicLevel(topic.id, -1);
  return { correct, topic: db.getTopicByName(topicName) };
});

ipcMain.handle('refresh-daily', () => {
  broadcastDailyUpdate();
  return readDailyFile();
});
