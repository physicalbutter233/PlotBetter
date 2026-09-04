const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');
const { URL } = require('url');
const initSqlJs = require('sql.js');

const DATA_DIR = path.join(__dirname, '..', 'data');

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 6 });
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 6 });

const libraryArxivCache = { key: '', ids: null, at: 0 };
const LIBRARY_CACHE_MS = 15 * 60 * 1000;

const DEFAULT_ZOTERO = {
  enabled: false,
  skipLibraryItems: true,
  autoAddOnJustRight: false,
  apiKey: '',
  userId: '',
  dataDir: '',
  zoteroExePath: '',
  linkOnOpen: true,
  /** 'stored' = Zotero file sync; 'linked' = absolute/relative local path (no file sync) */
  attachmentMode: 'stored',
  linkedBaseDir: '',
  dailyPaperCollection: 'daily_paper',
};

function defaultZoteroConfig() {
  return {
    ...DEFAULT_ZOTERO,
    dataDir: detectDefaultDataDir(),
    zoteroExePath: detectZoteroExePath(),
  };
}

function detectZoteroExePath() {
  const candidates = [
    'D:\\Zotero\\zotero.exe',
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Zotero', 'zotero.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Zotero', 'zotero.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Zotero', 'zotero.exe'),
  ];
  for (const exe of candidates) {
    if (fs.existsSync(exe)) return exe;
  }
  return '';
}

function findDefaultProfileDir() {
  const appData = process.env.APPDATA || '';
  const profilesIni = path.join(appData, 'Zotero', 'Zotero', 'profiles.ini');
  if (!fs.existsSync(profilesIni)) return null;

  const ini = fs.readFileSync(profilesIni, 'utf8');
  let relPath = null;
  for (const line of ini.split(/\r?\n/)) {
    if (line.startsWith('Path=')) relPath = line.slice(5).trim();
  }
  if (!relPath) return null;
  return path.join(appData, 'Zotero', 'Zotero', relPath.replace(/\//g, path.sep));
}

function detectDefaultDataDir() {
  const home = os.homedir();
  const candidates = [
    findDefaultProfileDir(),
    path.join(home, 'Zotero'),
    path.join(process.env.APPDATA || '', 'Zotero', 'Zotero'),
  ].filter(Boolean);

  if (fs.existsSync('D:\\Zotero\\zotero.sqlite')) {
    candidates.unshift('D:\\Zotero');
  }

  for (const dir of candidates) {
    if (fs.existsSync(getSqlitePath(dir))) return dir;
  }
  return '';
}

function normalizeZoteroConfig(raw = {}) {
  const base = defaultZoteroConfig();
  const mode = String(raw.attachmentMode || base.attachmentMode || 'stored').toLowerCase();
  return {
    enabled: Boolean(raw.enabled),
    skipLibraryItems: raw.skipLibraryItems !== false,
    autoAddOnJustRight: Boolean(raw.autoAddOnJustRight),
    apiKey: String(raw.apiKey || ''),
    userId: String(raw.userId || ''),
    dataDir: String(raw.dataDir || base.dataDir),
    zoteroExePath: String(raw.zoteroExePath ?? base.zoteroExePath),
    linkOnOpen: raw.linkOnOpen !== false,
    attachmentMode: mode === 'linked' ? 'linked' : 'stored',
    linkedBaseDir: String(raw.linkedBaseDir || ''),
    dailyPaperCollection: String(raw.dailyPaperCollection || base.dailyPaperCollection),
  };
}

function requireApiConfig(cfg) {
  if (!cfg.apiKey || !cfg.userId) {
    throw new Error('Zotero API Key and User ID are required. Set them in Settings.');
  }
}

async function zoteroApi(cfg, apiPath, options = {}) {
  requireApiConfig(cfg);
  const timeoutMs = options.timeoutMs ?? 30000;
  const res = await fetch(`https://api.zotero.org${apiPath}`, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'Zotero-API-Key': cfg.apiKey,
      'Zotero-API-Version': '3',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Zotero API error (${res.status}): ${body.slice(0, 240)}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : null;
  if (parsed?.failed && Object.keys(parsed.failed).length) {
    const err = Object.values(parsed.failed)[0];
    throw new Error(`Zotero API error: ${err.message || err.code || 'write failed'}`);
  }
  return parsed;
}

function parseItemKeyFromWriteResponse(result) {
  if (result?.failed && Object.keys(result.failed).length) {
    const err = Object.values(result.failed)[0];
    throw new Error(`Zotero write failed: ${err.message || err.code}`);
  }
  if (result?.successful) {
    const first = Object.values(result.successful)[0];
    return first?.key || null;
  }
  if (Array.isArray(result?.success) && result.success[0]) {
    return result.success[0].key || null;
  }
  return null;
}

function isValidArxivId(id) {
  const m = String(id).match(/^(\d{2})(\d{2})\.(\d{4,5})/);
  if (!m) return false;
  const month = parseInt(m[2], 10);
  return month >= 1 && month <= 12;
}

function extractArxivId(text) {
  if (!text) return null;
  const s = String(text);
  const explicit = s.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/i);
  if (explicit) return explicit[1].replace(/v\d+$/i, '');
  const tagged = s.match(/arxiv:?\s*(\d{4}\.\d{4,5}(?:v\d+)?)/i);
  if (tagged) {
    const id = tagged[1].replace(/v\d+$/i, '');
    return isValidArxivId(id) ? id : null;
  }
  const bare = s.match(/\b(\d{4}\.\d{4,5})(?:v\d+)?\b/);
  if (bare && isValidArxivId(bare[1])) return bare[1];
  return null;
}

function getSqlitePath(dataDir) {
  return path.join(dataDir, 'zotero.sqlite');
}

async function openZoteroDbReadOnly(dataDir) {
  const dbPath = getSqlitePath(dataDir);
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Zotero library not found at ${dbPath}`);
  }

  const SQL = await initSqlJs({
    locateFile: (file) =>
      path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file),
  });

  try {
    const buffer = fs.readFileSync(dbPath);
    return new SQL.Database(buffer);
  } catch {
    const tmp = path.join(os.tmpdir(), `pb-zotero-${Date.now()}.sqlite`);
    fs.copyFileSync(dbPath, tmp);
    const buffer = fs.readFileSync(tmp);
    const db = new SQL.Database(buffer);
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    return db;
  }
}

async function readLocalArxivIds(dataDir) {
  const db = await openZoteroDbReadOnly(dataDir);
  const ids = new Set();

  try {
    const stmt = db.prepare(`
      SELECT v.value AS value
      FROM itemData d
      JOIN itemDataValues v ON d.valueID = v.valueID
      JOIN fields f ON d.fieldID = f.fieldID
      WHERE f.fieldName IN ('url', 'extra', 'DOI')
        AND (v.value LIKE '%arxiv%' OR v.value LIKE '%arXiv%')
    `);
    while (stmt.step()) {
      const row = stmt.getAsObject();
      const arxivId = extractArxivId(row.value);
      if (arxivId) ids.add(arxivId.toLowerCase());
    }
    stmt.free();
  } finally {
    db.close();
  }

  return [...ids];
}

function normalizeStoredPath(p) {
  return path.resolve(String(p || '')).replace(/\\/g, '/').toLowerCase();
}

function readLocalPdfAttachmentKeyForParent(db, parentItemID) {
  try {
    const stmt = db.prepare(`
      SELECT i.key AS key
      FROM items i
      JOIN itemAttachments ia ON ia.itemID = i.itemID
      WHERE ia.parentItemID = ?
        AND (
          ia.contentType = 'application/pdf'
          OR lower(coalesce(ia.path, '')) LIKE '%.pdf'
        )
      ORDER BY ia.linkMode ASC
      LIMIT 1
    `);
    stmt.bind([parentItemID]);
    let key = null;
    if (stmt.step()) key = stmt.getAsObject().key;
    stmt.free();
    return key || null;
  } catch {
    return null;
  }
}

async function readLocalAttachmentKeyByPath(dataDir, filePath) {
  const db = await openZoteroDbReadOnly(dataDir);
  const want = normalizeStoredPath(filePath);
  try {
    const stmt = db.prepare(`
      SELECT i.key AS key, ia.path AS path
      FROM items i
      JOIN itemAttachments ia ON ia.itemID = i.itemID
      WHERE ia.path IS NOT NULL AND ia.path != ''
    `);
    while (stmt.step()) {
      const row = stmt.getAsObject();
      if (normalizeStoredPath(row.path) === want) return row.key;
    }
    stmt.free();
    return null;
  } finally {
    db.close();
  }
}

async function readLocalAttachmentKeyByArxiv(dataDir, arxivId) {
  if (!arxivId) return null;
  const want = arxivId.toLowerCase();
  const db = await openZoteroDbReadOnly(dataDir);
  try {
    const stmt = db.prepare(`
      SELECT DISTINCT i.itemID AS itemID, v.value AS value
      FROM items i
      JOIN itemData d ON i.itemID = d.itemID
      JOIN itemDataValues v ON d.valueID = v.valueID
      JOIN fields f ON d.fieldID = f.fieldID
      WHERE f.fieldName IN ('url', 'extra', 'DOI')
        AND (v.value LIKE '%arxiv%' OR v.value LIKE '%arXiv%')
    `);
    while (stmt.step()) {
      const row = stmt.getAsObject();
      const found = extractArxivId(row.value);
      if (found && found.toLowerCase() === want) {
        const attachmentKey = readLocalPdfAttachmentKeyForParent(db, row.itemID);
        if (attachmentKey) return attachmentKey;
      }
    }
    stmt.free();
    return null;
  } finally {
    db.close();
  }
}

async function findRemotePdfAttachmentKey(cfg, arxivId) {
  if (!arxivId) return null;
  const itemKey = await searchItemKeyByArxiv(cfg, arxivId);
  if (!itemKey) return null;
  const pdfs = await findPdfAttachments(cfg, itemKey);
  if (!pdfs.length) return null;
  const linked = pdfs.find((att) => att.linkMode === 'linked_file');
  return (linked || pdfs[0]).key;
}

async function resolveAttachmentKeyForOpen(cfg, paper, filePath) {
  const arxivId = extractArxivId(paper.arxivId || paper.url) || paper.arxivId;

  if (cfg.dataDir && fs.existsSync(getSqlitePath(cfg.dataDir))) {
    try {
      let key = await readLocalAttachmentKeyByPath(cfg.dataDir, filePath);
      if (key) return key;
      if (arxivId) {
        key = await readLocalAttachmentKeyByArxiv(cfg.dataDir, arxivId);
        if (key) return key;
      }
    } catch (err) {
      console.warn('Local Zotero attachment lookup failed:', err.message);
    }
  }

  if (cfg.apiKey && cfg.userId && arxivId) {
    try {
      const key = await findRemotePdfAttachmentKey(cfg, arxivId);
      if (key) return key;
    } catch (err) {
      console.warn('Remote Zotero attachment lookup failed:', err.message);
    }
  }

  return null;
}

async function launchZoteroOpenPdf(cfg, attachmentKey, filePath, parentKey = null) {
  if (attachmentKey) {
    await openPdfViaZoteroUri(cfg, attachmentKey, filePath);
    return 'open-pdf';
  }

  await openZoteroProtocolUri(`file:///${path.resolve(filePath).replace(/\\/g, '/')}`, cfg);
  return 'file-uri';
}

async function openZoteroProtocolUri(uri, cfg = null) {
  const exe = (cfg && cfg.zoteroExePath) || detectZoteroExePath();

  if (process.platform === 'win32') {
    // shell.openExternal often only foregrounds Zotero without handling zotero:// on Windows.
    if (exe && fs.existsSync(exe)) {
      spawn(exe, [uri], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      return 'spawn-exe';
    }
    spawn('cmd.exe', ['/c', 'start', '', uri], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
    return 'cmd-start';
  }

  if (exe && fs.existsSync(exe)) {
    spawn(exe, [uri], { detached: true, stdio: 'ignore' }).unref();
    return 'spawn';
  }

  try {
    const { shell } = require('electron');
    await shell.openExternal(uri);
    return 'shell';
  } catch {
    throw new Error('无法打开 Zotero 链接');
  }
}

async function openPdfViaZoteroUri(cfg, attachmentKey, filePath = null) {
  const uri = `zotero://open-pdf/library/items/${attachmentKey}?page=1`;

  await openZoteroProtocolUri(uri, cfg);
  await sleep(450);
  await openZoteroProtocolUri(uri, cfg);
  await sleep(450);

  // Zotero 7 on Windows may ignore a single open-pdf; nudge with cmd start as well.
  if (process.platform === 'win32') {
    spawn('cmd.exe', ['/c', 'start', '', uri], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
    await sleep(500);
  }

  // If the attachment is a linked local PDF, opening the file via Zotero loads the built-in reader.
  const resolved = filePath ? path.resolve(filePath) : null;
  if (resolved && fs.existsSync(resolved)) {
    const exe = (cfg && cfg.zoteroExePath) || detectZoteroExePath();
    if (exe && fs.existsSync(exe)) {
      await sleep(250);
      spawn(exe, [resolved], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    }
  }
}

async function fetchWebLibraryArxivIds(apiKey, userId) {
  if (!apiKey || !userId) return [];

  const ids = new Set();
  let start = 0;
  const limit = 100;

  for (let page = 0; page < 20; page++) {
    const url = `https://api.zotero.org/users/${userId}/items/top?format=json&limit=${limit}&start=${start}&itemType=-attachment`;
    const res = await fetch(url, {
      headers: {
        'Zotero-API-Key': apiKey,
        'Zotero-API-Version': '3',
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Zotero API error (${res.status}): ${body.slice(0, 200)}`);
    }

    const items = await res.json();
    if (!items.length) break;

    for (const entry of items) {
      const data = entry.data || {};
      const candidates = [data.url, data.extra, data.DOI, data.title];
      for (const c of candidates) {
        const arxivId = extractArxivId(c);
        if (arxivId) ids.add(arxivId.toLowerCase());
      }
    }

    if (items.length < limit) break;
    start += limit;
  }

  return [...ids];
}

async function getLibraryArxivIds(zoteroConfig) {
  const cfg = normalizeZoteroConfig(zoteroConfig);
  if (!cfg.enabled || !cfg.skipLibraryItems) return [];

  const cacheKey = `${cfg.dataDir}|${cfg.userId}|${cfg.apiKey ? '1' : '0'}`;
  if (
    libraryArxivCache.ids &&
    libraryArxivCache.key === cacheKey &&
    Date.now() - libraryArxivCache.at < LIBRARY_CACHE_MS
  ) {
    return libraryArxivCache.ids;
  }

  const ids = new Set();
  let gotLocal = false;

  if (cfg.dataDir && fs.existsSync(getSqlitePath(cfg.dataDir))) {
    try {
      const local = await readLocalArxivIds(cfg.dataDir);
      local.forEach((id) => ids.add(id));
      gotLocal = local.length > 0;
    } catch (err) {
      console.warn('Zotero local read failed:', err.message);
    }
  }

  // Local library is enough for dedup — skip slow cloud API pagination when available.
  if (!gotLocal && cfg.apiKey && cfg.userId) {
    try {
      const remote = await fetchWebLibraryArxivIds(cfg.apiKey, cfg.userId);
      remote.forEach((id) => ids.add(id));
    } catch (err) {
      console.warn('Zotero API read failed:', err.message);
    }
  }

  const result = [...ids];
  libraryArxivCache.key = cacheKey;
  libraryArxivCache.ids = result;
  libraryArxivCache.at = Date.now();
  return result;
}

function parseAuthors(authorString) {
  if (!authorString) {
    return [{ creatorType: 'author', firstName: '', lastName: 'Unknown' }];
  }

  return authorString
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((name) => {
      const bits = name.split(/\s+/);
      if (bits.length === 1) {
        return { creatorType: 'author', firstName: '', lastName: bits[0] };
      }
      const lastName = bits.pop();
      const firstName = bits.join(' ');
      return { creatorType: 'author', firstName: firstName || '', lastName: lastName || 'Unknown' };
    });
}

function buildPaperItem(paper) {
  const arxivId = extractArxivId(paper.arxivId || paper.url) || paper.arxivId;
  const abstract = (paper.abstract || '').slice(0, 8000);
  return {
    itemType: 'journalArticle',
    title: (paper.title || 'Untitled').slice(0, 500),
    creators: parseAuthors(paper.authors),
    abstractNote: abstract,
    url: paper.url || `https://arxiv.org/abs/${arxivId}`,
    publicationTitle: 'arXiv',
    extra: arxivId ? `arXiv:${arxivId}` : undefined,
  };
}

async function listAllCollections(cfg) {
  const collections = [];
  let start = 0;
  for (let page = 0; page < 20; page++) {
    const batch = await zoteroApi(
      cfg,
      `/users/${cfg.userId}/collections?limit=100&start=${start}`
    );
    if (!batch?.length) break;
    collections.push(...batch);
    if (batch.length < 100) break;
    start += 100;
  }
  return collections;
}

async function getOrCreateCollection(cfg, name) {
  const collections = await listAllCollections(cfg);
  const found = collections.find((c) => c.data?.name === name);
  if (found) return found.data.key;

  const result = await zoteroApi(cfg, `/users/${cfg.userId}/collections`, {
    method: 'POST',
    body: JSON.stringify([{ name, parentCollection: false }]),
  });
  const key = parseItemKeyFromWriteResponse(result);
  if (!key) throw new Error(`Failed to create Zotero collection "${name}".`);
  return key;
}

async function searchItemKeyByArxiv(cfg, arxivId) {
  if (!arxivId) return null;
  const items = await zoteroApi(
    cfg,
    `/users/${cfg.userId}/items?q=${encodeURIComponent(arxivId)}&itemType=-attachment&limit=25`
  );
  for (const entry of items || []) {
    const data = entry.data || {};
    const fromUrl = extractArxivId(data.url);
    const fromExtra = extractArxivId(data.extra);
    if (fromUrl === arxivId || fromExtra === arxivId) return data.key;
  }
  return null;
}

async function getItemChildren(cfg, itemKey) {
  const children = await zoteroApi(cfg, `/users/${cfg.userId}/items/${itemKey}/children`);
  return children || [];
}

function getDailyPaperDir(cfg) {
  const folder = (cfg.dailyPaperCollection || 'daily_paper').replace(/[<>:"/\\|?*]/g, '_');
  return path.join(DATA_DIR, folder);
}

function localPdfPath(cfg, paper) {
  const arxivId = extractArxivId(paper.arxivId || paper.url) || paper.arxivId;
  const filename = sanitizePdfFilename(paper.title);
  return { filePath: path.join(getDailyPaperDir(cfg), filename), filename, arxivId };
}

function removeStaleLocalPdf(dir, filePath, arxivId) {
  if (!arxivId) return;
  const legacyPath = path.join(dir, `${arxivId}.pdf`);
  if (legacyPath !== filePath && fs.existsSync(legacyPath)) {
    try {
      fs.unlinkSync(legacyPath);
    } catch {
      /* ignore */
    }
  }
}

function isValidPdfFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  try {
    return fs.statSync(filePath).size >= 1024;
  } catch {
    return false;
  }
}

function findExistingLocalPdf(cfg, paper) {
  const dir = getDailyPaperDir(cfg);
  const { filePath, filename, arxivId } = localPdfPath(cfg, paper);
  if (isValidPdfFile(filePath)) {
    return { filePath, filename, arxivId, cached: true };
  }
  if (arxivId) {
    const legacyPath = path.join(dir, `${arxivId}.pdf`);
    if (isValidPdfFile(legacyPath)) {
      return { filePath: legacyPath, filename: path.basename(legacyPath), arxivId, cached: true };
    }
  }
  return null;
}

function arxivPdfUrls(paper) {
  const raw = extractArxivId(paper.arxivId || paper.url) || paper.arxivId;
  if (!raw) throw new Error('Could not determine arXiv PDF URL for this paper.');
  return [
    `https://arxiv.org/pdf/${raw}.pdf`,
    `https://export.arxiv.org/pdf/${raw}.pdf`,
  ];
}

function arxivPdfUrl(paper) {
  return arxivPdfUrls(paper)[0];
}

function downloadWithElectronNet(rawUrl, destPath, options = {}) {
  const { net } = require('electron');
  const onProgress = options.onProgress;
  const maxMs = options.maxMs ?? 1800000;
  const idleMs = options.idleMs ?? 60000;
  let startAt = 0;
  if (options.resume && fs.existsSync(destPath)) {
    startAt = fs.statSync(destPath).size;
    if (startAt < 1024) startAt = 0;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let received = startAt;
    let total = 0;
    let overallTimer = null;
    let idleTimer = null;
    let activeFile = null;

    function cleanup() {
      if (overallTimer) clearTimeout(overallTimer);
      if (idleTimer) clearTimeout(idleTimer);
      if (activeFile) {
        activeFile.destroy();
        activeFile = null;
      }
    }

    function finish(err, result) {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err);
      else resolve(result);
    }

    function resetIdle() {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(
        () => finish(new Error('Download stalled. Check your network and try again.')),
        idleMs
      );
    }

    overallTimer = setTimeout(
      () => finish(new Error('Download timed out. Very large PDFs can take 20+ minutes on slow networks.')),
      maxMs
    );

    function startRequest(url, redirectsLeft = 8) {
      const request = net.request({ method: 'GET', url, redirect: 'follow' });
      request.setHeader(
        'User-Agent',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36 PlotBetter/0.1'
      );
      request.setHeader('Accept', 'application/pdf,*/*');
      if (startAt > 0) request.setHeader('Range', `bytes=${startAt}-`);

      request.on('response', (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location && redirectsLeft > 0) {
          response.resume();
          startAt = 0;
          received = 0;
          return startRequest(response.headers.location, redirectsLeft - 1);
        }
        if (![200, 206].includes(response.statusCode)) {
          response.resume();
          return finish(new Error(`Could not download PDF (${response.statusCode}) from arXiv.`));
        }

        const chunkTotal = Number(response.headers['content-length'] || 0);
        total = response.statusCode === 206 && startAt > 0 ? startAt + chunkTotal : chunkTotal;
        const append = response.statusCode === 206 && startAt > 0;
        activeFile = fs.createWriteStream(destPath, { flags: append ? 'a' : 'w' });

        const report = () => {
          if (!onProgress) return;
          onProgress({
            received,
            total: total || received,
            percent: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null,
          });
        };

        response.on('data', (chunk) => {
          received += chunk.length;
          resetIdle();
          report();
        });

        response.pipe(activeFile);
        activeFile.on('finish', () => {
          const file = activeFile;
          activeFile = null;
          file.close(() => {
            if (received < 1024) {
              finish(new Error('Downloaded PDF file is too small or invalid.'));
              return;
            }
            finish(null, { path: destPath, size: received, total: total || received });
          });
        });
        activeFile.on('error', (err) => finish(err));
        response.on('error', (err) => finish(err));
        resetIdle();
        report();
      });

      request.on('error', (err) => finish(err));
      request.end();
    }

    startRequest(rawUrl);
  });
}

function downloadUrlToFileNode(rawUrl, destPath, options = {}) {
  const onProgress = options.onProgress;
  const maxMs = options.maxMs ?? 1800000;
  const idleMs = options.idleMs ?? 60000;

  return new Promise((resolve, reject) => {
    let overallTimer = null;
    let idleTimer = null;
    let settled = false;
    let activeReq = null;
    let activeRes = null;
    let activeFile = null;

    function cleanup() {
      if (overallTimer) clearTimeout(overallTimer);
      if (idleTimer) clearTimeout(idleTimer);
      if (activeReq) {
        activeReq.destroy();
        activeReq = null;
      }
      if (activeRes) {
        activeRes.destroy();
        activeRes = null;
      }
      if (activeFile) {
        activeFile.destroy();
        activeFile = null;
      }
    }

    function finish(err, result) {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err);
      else resolve(result);
    }

    function resetIdle() {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => finish(new Error('Download stalled. Check your network and try again.')), idleMs);
    }

    overallTimer = setTimeout(
      () => finish(new Error('Download timed out. Very large PDFs can take 20+ minutes on slow networks.')),
      maxMs
    );

    function request(url, redirectsLeft = 8) {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      const agent = parsed.protocol === 'https:' ? httpsAgent : httpAgent;
      let startAt = 0;
      if (options.resume && fs.existsSync(destPath)) {
        startAt = fs.statSync(destPath).size;
        if (startAt < 1024) startAt = 0;
      }

      activeReq = lib.get(
        parsed,
        {
          agent,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36 PlotBetter/0.1',
            Accept: 'application/pdf,*/*',
            ...(startAt > 0 ? { Range: `bytes=${startAt}-` } : {}),
          },
        },
        (res) => {
          activeRes = res;
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
            res.resume();
            activeRes = null;
            return request(new URL(res.headers.location, url).href, redirectsLeft - 1);
          }
          if (![200, 206].includes(res.statusCode)) {
            res.resume();
            return finish(new Error(`Could not download PDF (${res.statusCode}) from arXiv.`));
          }

          const chunkTotal = Number(res.headers['content-length'] || 0);
          const total = res.statusCode === 206 && startAt > 0 ? startAt + chunkTotal : chunkTotal;
          let received = startAt;
          activeFile = fs.createWriteStream(destPath, {
            flags: res.statusCode === 206 && startAt > 0 ? 'a' : 'w',
          });

          const report = () => {
            if (!onProgress) return;
            onProgress({
              received,
              total: total || received,
              percent: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null,
            });
          };

          res.on('data', (chunk) => {
            received += chunk.length;
            resetIdle();
            report();
          });

          res.pipe(activeFile);
          activeFile.on('finish', () => {
            const file = activeFile;
            activeFile = null;
            file.close(() => {
              if (received < 1024) {
                finish(new Error('Downloaded PDF file is too small or invalid.'));
                return;
              }
              finish(null, { path: destPath, size: received, total: total || received });
            });
          });
          activeFile.on('error', (err) => finish(err));
          res.on('error', (err) => finish(err));
          resetIdle();
          report();
        }
      );
      activeReq.on('error', (err) => finish(err));
    }

    request(rawUrl);
  });
}

function downloadUrlToFile(rawUrl, destPath, options = {}) {
  try {
    const { net } = require('electron');
    if (net?.request) {
      return downloadWithElectronNet(rawUrl, destPath, options);
    }
  } catch {
    /* fallback below */
  }
  return downloadUrlToFileNode(rawUrl, destPath, options);
}

async function downloadPaperToLocal(cfg, paper, onProgress) {
  const dir = getDailyPaperDir(cfg);
  fs.mkdirSync(dir, { recursive: true });

  const existing = findExistingLocalPdf(cfg, paper);
  if (existing) {
    if (onProgress) onProgress({ stage: 'download', received: 0, total: 0, percent: 100, cached: true });
    return { ...existing, folder: dir };
  }

  const { filePath, filename, arxivId } = localPdfPath(cfg, paper);
  const urls = arxivPdfUrls(paper);
  const tmpPath = `${filePath}.part`;

  if (onProgress) onProgress({ stage: 'download', received: 0, total: 0, percent: 0 });

  let lastErr = null;
  for (const url of urls) {
    try {
      await downloadUrlToFile(url, tmpPath, { onProgress, maxMs: 1800000, idleMs: 60000, resume: true });
      fs.renameSync(tmpPath, filePath);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
    }
  }

  if (lastErr) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
    throw lastErr;
  }

  removeStaleLocalPdf(dir, filePath, arxivId);

  if (!fs.existsSync(filePath) || fs.statSync(filePath).size < 1024) {
    throw new Error('Failed to save PDF locally.');
  }

  return { filePath, filename, arxivId, folder: dir };
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isZoteroRunning() {
  try {
    const res = await fetch('http://127.0.0.1:23119/connector/ping', {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function isLocalApiEnabled() {
  try {
    const res = await fetch('http://127.0.0.1:23119/api/users/0/items?limit=1', {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function localApiJson(apiPath) {
  const res = await fetch(`http://127.0.0.1:23119/api${apiPath}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 403) {
    throw new Error('LOCAL_API_DISABLED');
  }
  if (!res.ok) {
    throw new Error(`Zotero local API error (${res.status})`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function connectorSaveItems(payload) {
  const res = await fetch('http://127.0.0.1:23119/connector/saveItems', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Zotero-Connector-API-Version': '3',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok && res.status !== 201) {
    const body = await res.text();
    throw new Error(`Zotero connector failed (${res.status}): ${body.slice(0, 200)}`);
  }
}

async function connectorSaveAttachment(sessionID, parentItemID, filePath, title, sourceUrl = '') {
  const buffer = fs.readFileSync(filePath);
  const metadata = JSON.stringify({
    sessionID,
    parentItemID,
    title: title || path.basename(filePath),
    url: sourceUrl || '',
  });
  const res = await fetch('http://127.0.0.1:23119/connector/saveAttachment', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(buffer.length),
      'X-Metadata': metadata,
      'X-Zotero-Connector-API-Version': '3',
    },
    body: buffer,
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok && res.status !== 201) {
    const body = await res.text();
    throw new Error(`Zotero connector saveAttachment failed (${res.status}): ${body.slice(0, 200)}`);
  }
}

function readLocalAttachmentKeyByParentItemId(db, parentItemID) {
  return readLocalPdfAttachmentKeyForParent(db, parentItemID);
}

async function readLocalAttachmentKeyByParentKey(dataDir, parentKey) {
  const db = await openZoteroDbReadOnly(dataDir);
  try {
    const stmt = db.prepare('SELECT itemID FROM items WHERE key = ?');
    stmt.bind([parentKey]);
    if (!stmt.step()) {
      stmt.free();
      return null;
    }
    const parentItemID = stmt.getAsObject().itemID;
    stmt.free();
    return readLocalAttachmentKeyByParentItemId(db, parentItemID);
  } finally {
    db.close();
  }
}

async function findExistingPdfForParent(cfg, parentKey, filePath) {
  const wantPath = normalizeStoredPath(filePath);
  if (cfg.dataDir && fs.existsSync(getSqlitePath(cfg.dataDir))) {
    const byParent = await readLocalAttachmentKeyByParentKey(cfg.dataDir, parentKey);
    if (byParent) return byParent;
  }
  try {
    if (await isLocalApiEnabled()) {
      let key = await pickPdfAttachmentForParent(parentKey, wantPath);
      if (!key) key = await pickPdfAttachmentForParent(parentKey, '');
      if (key) return key;
    }
  } catch (err) {
    if (err.message !== 'LOCAL_API_DISABLED') throw err;
  }
  return null;
}

async function pickPdfAttachmentForParent(parentKey, wantPath = '') {
  const children = await localApiJson(`/users/0/items/${parentKey}/children`);
  const pdfs = [];
  for (const child of children || []) {
    const data = child.data || {};
    if (data.itemType !== 'attachment') continue;
    const isPdf =
      data.contentType === 'application/pdf' ||
      /\.pdf/i.test(data.filename || '') ||
      /\.pdf/i.test(data.title || '') ||
      /\.pdf/i.test(data.path || '');
    if (!isPdf) continue;
    pdfs.push({
      key: child.key,
      path: data.path || '',
      linkMode: data.linkMode || '',
      modified: data.dateModified || '',
    });
  }
  if (!pdfs.length) return null;

  pdfs.sort((a, b) => {
    const rank = (mode) => {
      if (mode === 'imported_file') return 0;
      if (mode === 'linked_file') return 2;
      return 1;
    };
    const byMode = rank(a.linkMode) - rank(b.linkMode);
    if (byMode !== 0) return byMode;
    return String(b.modified).localeCompare(String(a.modified));
  });

  if (wantPath) {
    const exact = pdfs.find((p) => p.path && normalizeStoredPath(p.path) === wantPath);
    if (exact) return exact.key;
  }

  return pdfs[0].key;
}

async function findLocalAttachmentKeyByExactPath(filePath) {
  const want = normalizeStoredPath(filePath);
  const base = path.basename(filePath);
  const items = await localApiJson(
    `/users/0/items?q=${encodeURIComponent(base)}&itemType=attachment&limit=50`
  );
  for (const entry of items || []) {
    const data = entry.data || {};
    if (data.path && normalizeStoredPath(data.path) === want) {
      return entry.key;
    }
  }
  return null;
}

async function getLocalAttachmentParentKey(attachmentKey) {
  const entry = await localApiJson(`/users/0/items/${attachmentKey}`);
  return entry?.data?.parentItem || null;
}

async function findLocalPdfAttachmentKey(paper, filePath) {
  const wantPath = normalizeStoredPath(filePath);

  const byPath = await findLocalAttachmentKeyByExactPath(filePath);
  if (byPath) return byPath;

  const arxivId = extractArxivId(paper.arxivId || paper.url);
  if (arxivId) {
    const items = await localApiJson(`/users/0/items?q=${encodeURIComponent(arxivId)}&limit=25`);
    for (const entry of items || []) {
      const data = entry.data || {};
      if (data.itemType === 'attachment') continue;
      const match =
        extractArxivId(data.url) === arxivId || extractArxivId(data.extra) === arxivId;
      if (!match) continue;
      const key = await pickPdfAttachmentForParent(entry.key, wantPath);
      if (key) return key;
    }
  }

  const title = (paper.title || '').trim();
  if (title) {
    const items = await localApiJson(`/users/0/items?q=${encodeURIComponent(title.slice(0, 80))}&limit=10`);
    for (const entry of items || []) {
      const data = entry.data || {};
      if (data.itemType === 'attachment') continue;
      if (data.title !== title) continue;
      const key = await pickPdfAttachmentForParent(entry.key, wantPath);
      if (key) return key;
    }
  }

  return null;
}

async function readLocalParentKeyByPaper(dataDir, paper) {
  const arxivId = extractArxivId(paper.arxivId || paper.url);
  if (!arxivId) return null;
  const want = arxivId.toLowerCase();
  const db = await openZoteroDbReadOnly(dataDir);
  try {
    const stmt = db.prepare(`
      SELECT DISTINCT i.itemID AS itemID, v.value AS value
      FROM items i
      JOIN itemData d ON i.itemID = d.itemID
      JOIN itemDataValues v ON d.valueID = v.valueID
      JOIN fields f ON d.fieldID = f.fieldID
      WHERE f.fieldName IN ('url', 'extra', 'DOI')
        AND (v.value LIKE '%arxiv%' OR v.value LIKE '%arXiv%')
    `);
    while (stmt.step()) {
      const row = stmt.getAsObject();
      const found = extractArxivId(row.value);
      if (found && found.toLowerCase() === want) {
        const keyStmt = db.prepare('SELECT key FROM items WHERE itemID = ?');
        keyStmt.bind([row.itemID]);
        if (keyStmt.step()) {
          const key = keyStmt.getAsObject().key;
          keyStmt.free();
          stmt.free();
          return key;
        }
        keyStmt.free();
      }
    }
    stmt.free();
    return null;
  } finally {
    db.close();
  }
}

async function readLocalParentKeyFromAttachmentKey(dataDir, attachmentKey) {
  const db = await openZoteroDbReadOnly(dataDir);
  try {
    const stmt = db.prepare(`
      SELECT p.key AS key
      FROM items a
      JOIN itemAttachments ia ON ia.itemID = a.itemID
      JOIN items p ON p.itemID = ia.parentItemID
      WHERE a.key = ?
      LIMIT 1
    `);
    stmt.bind([attachmentKey]);
    let key = null;
    if (stmt.step()) key = stmt.getAsObject().key;
    stmt.free();
    return key;
  } finally {
    db.close();
  }
}

async function findLocalParentKeySafe(cfg, paper) {
  try {
    if (await isLocalApiEnabled()) {
      return await findLocalParentKey(paper);
    }
  } catch (err) {
    if (err.message !== 'LOCAL_API_DISABLED') throw err;
  }
  if (cfg.dataDir && fs.existsSync(getSqlitePath(cfg.dataDir))) {
    return readLocalParentKeyByPaper(cfg.dataDir, paper);
  }
  return null;
}

async function findLocalAttachmentKeySafe(cfg, paper, filePath) {
  for (let i = 0; i < 40; i++) {
    await sleep(200);
    try {
      if (await isLocalApiEnabled()) {
        let key = await findLocalAttachmentKeyByExactPath(filePath);
        if (!key) key = await findLocalPdfAttachmentKey(paper, filePath);
        if (key) return key;
      }
    } catch (err) {
      if (err.message !== 'LOCAL_API_DISABLED') throw err;
    }
    if (cfg.dataDir && fs.existsSync(getSqlitePath(cfg.dataDir))) {
      const key = await readLocalAttachmentKeyByPath(cfg.dataDir, filePath);
      if (key) return key;
    }
  }
  return null;
}

async function getLocalAttachmentParentKeySafe(cfg, attachmentKey) {
  try {
    if (await isLocalApiEnabled()) {
      return await getLocalAttachmentParentKey(attachmentKey);
    }
  } catch (err) {
    if (err.message !== 'LOCAL_API_DISABLED') throw err;
  }
  if (cfg.dataDir && fs.existsSync(getSqlitePath(cfg.dataDir))) {
    return readLocalParentKeyFromAttachmentKey(cfg.dataDir, attachmentKey);
  }
  return null;
}

async function findLocalParentKey(paper) {
  const arxivId = extractArxivId(paper.arxivId || paper.url);
  if (!arxivId) return null;
  const items = await localApiJson(`/users/0/items?q=${encodeURIComponent(arxivId)}&limit=10`);
  for (const entry of items || []) {
    const data = entry.data || {};
    if (data.itemType === 'attachment') continue;
    if (extractArxivId(data.url) === arxivId || extractArxivId(data.extra) === arxivId) {
      return entry.key;
    }
  }
  return null;
}

async function ensurePaperInRunningZotero(paper, filePath, cfg) {
  const pdfUrl = arxivPdfUrl(paper);
  const wantStored = cfg.attachmentMode !== 'linked';
  const hasApi = Boolean(cfg.apiKey && cfg.userId);

  let parentKey = await findLocalParentKeySafe(cfg, paper);
  let attachmentKey = null;

  if (parentKey) {
    attachmentKey = await findExistingPdfForParent(cfg, parentKey, filePath);
  }

  if (!attachmentKey) {
    try {
      attachmentKey = await findLocalPdfAttachmentKey(paper, filePath);
    } catch (err) {
      if (err.message !== 'LOCAL_API_DISABLED') throw err;
    }
    if (attachmentKey && !parentKey) {
      parentKey = await getLocalAttachmentParentKeySafe(cfg, attachmentKey);
    }
  }

  // Upgrade absolute linked_file → stored so other devices can sync the PDF.
  if (wantStored && hasApi && parentKey) {
    let alreadyStored = false;
    try {
      if (await isLocalApiEnabled()) {
        const children = await localApiJson(`/users/0/items/${parentKey}/children`);
        alreadyStored = (children || []).some((child) => {
          const data = child.data || {};
          return (
            data.itemType === 'attachment' &&
            data.linkMode === 'imported_file' &&
            (data.contentType === 'application/pdf' || /\.pdf/i.test(data.filename || data.title || ''))
          );
        });
      } else {
        const remote = await findPdfAttachments(cfg, parentKey);
        alreadyStored = remote.some((att) => att.linkMode === 'imported_file');
      }
    } catch {
      alreadyStored = false;
    }

    if (!alreadyStored) {
      try {
        attachmentKey = await attachStoredLocalPdf(cfg, parentKey, filePath);
        return { attachmentKey, parentKey };
      } catch (err) {
        console.warn('Upgrade linked PDF to stored failed:', err.message);
      }
    } else if (attachmentKey) {
      return { attachmentKey, parentKey };
    } else {
      try {
        attachmentKey = await attachStoredLocalPdf(cfg, parentKey, filePath);
        return { attachmentKey, parentKey };
      } catch (err) {
        console.warn('Ensure stored PDF failed:', err.message);
      }
    }
  }

  if (attachmentKey) {
    if (!parentKey) parentKey = await getLocalAttachmentParentKeySafe(cfg, attachmentKey);
    return { attachmentKey, parentKey };
  }

  if (wantStored && hasApi) {
    const collectionName = cfg.dailyPaperCollection || 'daily_paper';
    const collectionKey = await getOrCreateCollection(cfg, collectionName);
    const saved = await savePaperToDailyCollection(cfg, collectionKey, paper, filePath);
    return { attachmentKey: saved.attachmentKey, parentKey: saved.itemKey };
  }

  if (wantStored) {
    const sessionID = `pb-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const connectorItemId = `item-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await connectorSaveItems({
      sessionID,
      uri: paper.url || pdfUrl,
      items: [{ id: connectorItemId, ...buildPaperItem(paper) }],
    });
    await connectorSaveAttachment(
      sessionID,
      connectorItemId,
      filePath,
      path.basename(filePath),
      pdfUrl
    );

    for (let i = 0; i < 40; i++) {
      await sleep(250);
      parentKey = await findLocalParentKeySafe(cfg, paper);
      if (!parentKey) continue;
      attachmentKey = await findExistingPdfForParent(cfg, parentKey, '');
      if (attachmentKey) break;
    }
    if (attachmentKey) return { attachmentKey, parentKey };
    throw new Error('PDF 已写入 Zotero storage，但未能定位附件。请在 Zotero 中同步后重试。');
  }

  // Linked mode (no Zotero file sync): absolute path; other devices need Linked Attachment Base Directory.
  parentKey = parentKey || (await findLocalParentKeySafe(cfg, paper));
  if (!parentKey) {
    const sessionID = `pb-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await connectorSaveItems({
      sessionID,
      uri: paper.url || pdfUrl,
      items: [{ ...buildPaperItem(paper) }],
    });
    for (let i = 0; i < 30; i++) {
      await sleep(200);
      parentKey = await findLocalParentKeySafe(cfg, paper);
      if (parentKey) break;
    }
    if (!parentKey) {
      throw new Error('无法在 Zotero 中创建文献条目，请确认 Zotero 正在运行。');
    }
  }

  const attachSession = `pb-a-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await connectorSaveItems({
    sessionID: attachSession,
    uri: pdfUrl,
    items: [
      {
        itemType: 'attachment',
        parentItem: parentKey,
        linkMode: 'linked_file',
        title: path.basename(filePath),
        contentType: 'application/pdf',
        path: path.resolve(filePath),
      },
    ],
  });

  attachmentKey = await findLocalAttachmentKeySafe(cfg, paper, filePath);
  if (!attachmentKey) {
    throw new Error(
      '已创建链接附件，但未能定位。链接附件不会跨设备同步；请在 Settings 使用 Stored (Zotero sync) 模式。'
    );
  }
  return { attachmentKey, parentKey };
}

async function openPaperViaCloudSync(cfg, paper, filePath) {
  const linked = await linkPaperToLibrary(cfg, paper, filePath);
  const { attachmentKey, itemKey: parentKey } = linked;

  for (let attempt = 0; attempt < 10; attempt++) {
    await sleep(800);
    await openPdfViaZoteroUri(cfg, attachmentKey, filePath);
    if (await isLocalApiEnabled()) {
      const localKey = await findLocalAttachmentKeyByExactPath(filePath);
      if (localKey) {
        return { attachmentKey: localKey, parentKey, openMode: 'open-pdf-cloud-synced' };
      }
    }
  }

  return { attachmentKey, parentKey, openMode: 'open-pdf-cloud' };
}

async function openPdfInRunningZotero(attachmentKey, parentKey, filePath, cfg) {
  await waitForLocalAttachment(attachmentKey, 8000);
  await openPdfViaZoteroUri(cfg, attachmentKey, filePath);
  return `zotero://open-pdf/library/items/${attachmentKey}`;
}

async function waitForLocalAttachment(attachmentKey, maxMs = 10000) {
  if (!attachmentKey) return false;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(`http://127.0.0.1:23119/api/users/0/items/${attachmentKey}`, {
        signal: AbortSignal.timeout(1200),
      });
      if (res.ok) return true;
    } catch {
      /* Zotero still syncing */
    }
    await sleep(400);
  }
  return false;
}

function filePathToZoteroUri(filePath) {
  const normalized = path.resolve(filePath).replace(/\\/g, '/');
  return `file:///${normalized}`;
}

function sanitizePdfFilename(title) {
  const base = (title || 'paper')
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'paper';
  return `${base}.pdf`;
}

async function downloadArxivPdf(paper) {
  const url = arxivPdfUrl(paper);
  const tmpPath = path.join(os.tmpdir(), `pb-arxiv-${Date.now()}.pdf`);
  try {
    const result = await downloadUrlToFile(url, tmpPath, { maxMs: 1800000, idleMs: 60000 });
    return fs.readFileSync(result.path);
  } finally {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
  }
}

async function deleteZoteroItem(cfg, itemKey) {
  const res = await fetch(`https://api.zotero.org/users/${cfg.userId}/items/${itemKey}`, {
    method: 'DELETE',
    headers: {
      'Zotero-API-Key': cfg.apiKey,
      'Zotero-API-Version': '3',
    },
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    throw new Error(`Failed to remove old Zotero attachment (${res.status}): ${body.slice(0, 160)}`);
  }
}

async function uploadPdfToAttachment(cfg, attachmentKey, filename, buffer) {
  const md5 = crypto.createHash('md5').update(buffer).digest('hex');
  const params = new URLSearchParams({
    filename,
    filesize: String(buffer.length),
    md5,
    mtime: String(Date.now()),
  });
  const res = await fetch(
    `https://api.zotero.org/users/${cfg.userId}/items/${attachmentKey}/file?${params}`,
    {
      method: 'POST',
      headers: {
        'Zotero-API-Key': cfg.apiKey,
        'Zotero-API-Version': '3',
        'Content-Type': 'application/pdf',
        'If-None-Match': '*',
      },
      body: buffer,
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Zotero PDF upload failed (${res.status}): ${body.slice(0, 240)}`);
  }
}

async function createFileAttachmentPlaceholder(cfg, itemKey, filename) {
  const attachment = {
    itemType: 'attachment',
    parentItem: itemKey,
    linkMode: 'imported_file',
    title: filename,
    filename,
    contentType: 'application/pdf',
  };
  const result = await zoteroApi(cfg, `/users/${cfg.userId}/items`, {
    method: 'POST',
    body: JSON.stringify([attachment]),
  });
  const key = parseItemKeyFromWriteResponse(result);
  if (!key) throw new Error('Failed to create PDF attachment in Zotero.');
  return key;
}

async function findPdfAttachments(cfg, itemKey) {
  const children = await getItemChildren(cfg, itemKey);
  return children
    .map((child) => child.data)
    .filter(
      (data) =>
        data?.itemType === 'attachment' &&
        (data.contentType === 'application/pdf' ||
          /\.pdf/i.test(data.filename || '') ||
          /arxiv\.org\/pdf/i.test(data.url || ''))
    );
}

async function attachLinkedLocalPdf(cfg, itemKey, filePath) {
  const zoteroPath = path.resolve(filePath);
  const existing = await findPdfAttachments(cfg, itemKey);
  const sameLinked = existing.find(
    (att) => att.linkMode === 'linked_file' && path.resolve(att.path || '') === zoteroPath
  );
  if (sameLinked) return sameLinked.key;

  for (const att of existing) {
    await deleteZoteroItem(cfg, att.key);
  }

  const attachment = {
    itemType: 'attachment',
    parentItem: itemKey,
    linkMode: 'linked_file',
    title: path.basename(filePath),
    contentType: 'application/pdf',
    path: zoteroPath,
  };
  const result = await zoteroApi(cfg, `/users/${cfg.userId}/items`, {
    method: 'POST',
    body: JSON.stringify([attachment]),
  });
  const key = parseItemKeyFromWriteResponse(result);
  if (!key) throw new Error('Failed to link PDF in Zotero.');
  return key;
}

/** Upload local PDF into Zotero storage (file sync works across devices). */
async function attachStoredLocalPdf(cfg, itemKey, filePath) {
  requireApiConfig(cfg);
  const filename = path.basename(filePath);
  const buffer = fs.readFileSync(filePath);
  if (!buffer || buffer.length < 1024) {
    throw new Error('Local PDF is missing or invalid.');
  }

  const existing = await findPdfAttachments(cfg, itemKey);
  const importedFile = existing.find((data) => data.linkMode === 'imported_file');

  if (importedFile) {
    try {
      await uploadPdfToAttachment(cfg, importedFile.key, filename, buffer);
      for (const att of existing) {
        if (att.key !== importedFile.key && att.linkMode === 'linked_file') {
          await deleteZoteroItem(cfg, att.key);
        }
      }
      return importedFile.key;
    } catch {
      await deleteZoteroItem(cfg, importedFile.key);
    }
  }

  for (const att of existing) {
    if (
      att.linkMode === 'linked_file' ||
      att.linkMode === 'linked_url' ||
      att.linkMode === 'imported_url'
    ) {
      await deleteZoteroItem(cfg, att.key);
    }
  }

  const attachmentKey = await createFileAttachmentPlaceholder(cfg, itemKey, filename);
  await uploadPdfToAttachment(cfg, attachmentKey, filename, buffer);
  return attachmentKey;
}

async function attachPdfForPaper(cfg, itemKey, filePath) {
  if (cfg.attachmentMode === 'linked') {
    return attachLinkedLocalPdf(cfg, itemKey, filePath);
  }
  return attachStoredLocalPdf(cfg, itemKey, filePath);
}

async function attachArxivPdf(cfg, itemKey, paper) {
  const filename = sanitizePdfFilename(paper.title);
  const pdfBuffer = await downloadArxivPdf(paper);
  const existing = await findPdfAttachments(cfg, itemKey);
  const importedFile = existing.find((data) => data.linkMode === 'imported_file');

  if (importedFile) {
    try {
      await uploadPdfToAttachment(cfg, importedFile.key, filename, pdfBuffer);
      return importedFile.key;
    } catch {
      await deleteZoteroItem(cfg, importedFile.key);
    }
  }

  for (const att of existing) {
    if (att.linkMode === 'linked_url' || att.linkMode === 'imported_url') {
      await deleteZoteroItem(cfg, att.key);
    }
  }

  const attachmentKey = await createFileAttachmentPlaceholder(cfg, itemKey, filename);
  await uploadPdfToAttachment(cfg, attachmentKey, filename, pdfBuffer);
  return attachmentKey;
}

async function getItemData(cfg, itemKey) {
  const entry = await zoteroApi(cfg, `/users/${cfg.userId}/items/${itemKey}`);
  if (entry?.data) return entry.data;
  if (entry?.key) return entry;
  throw new Error(`Could not load Zotero item ${itemKey}.`);
}

async function addItemToCollection(cfg, collectionKey, itemKey) {
  const data = await getItemData(cfg, itemKey);
  const current = data.collections || [];
  if (current.includes(collectionKey)) return data;

  const collections = [...new Set([...current, collectionKey])];
  await zoteroApi(cfg, `/users/${cfg.userId}/items/${itemKey}`, {
    method: 'PATCH',
    headers: data.version != null ? { 'If-Unmodified-Since-Version': String(data.version) } : {},
    body: JSON.stringify({ collections }),
  });

  return getItemData(cfg, itemKey);
}

async function verifyItemInCollection(cfg, collectionKey, itemKey) {
  const data = await getItemData(cfg, itemKey);
  if (!(data.collections || []).includes(collectionKey)) {
    throw new Error(
      `Paper was saved to Zotero (key: ${itemKey}) but is not in collection "${cfg.dailyPaperCollection || 'daily_paper'}". Try syncing Zotero manually.`
    );
  }
  return data;
}

async function createItemInLibrary(cfg, paper, collectionKey) {
  const item = {
    ...buildPaperItem(paper),
    collections: [collectionKey],
  };
  const result = await zoteroApi(cfg, `/users/${cfg.userId}/items`, {
    method: 'POST',
    body: JSON.stringify([item]),
  });
  const key = parseItemKeyFromWriteResponse(result);
  if (!key) throw new Error('Failed to create item in Zotero library.');

  let data = await getItemData(cfg, key);
  if (!(data.collections || []).includes(collectionKey)) {
    data = await addItemToCollection(cfg, collectionKey, key);
  }
  return { key, data };
}

async function savePaperToDailyCollection(cfg, collectionKey, paper, localFilePath = null) {
  const { filePath } = localFilePath
    ? { filePath: localFilePath }
    : await downloadPaperToLocal(cfg, paper);
  const arxivId = extractArxivId(paper.arxivId || paper.url) || paper.arxivId;
  let itemKey = await searchItemKeyByArxiv(cfg, arxivId);

  if (!itemKey) {
    const created = await createItemInLibrary(cfg, paper, collectionKey);
    itemKey = created.key;
  } else {
    await addItemToCollection(cfg, collectionKey, itemKey);
  }

  const data = await verifyItemInCollection(cfg, collectionKey, itemKey);
  const attachmentKey = await attachPdfForPaper(cfg, itemKey, filePath);
  return { itemKey, data, attachmentKey, filePath };
}

async function addPaperToCollection(cfg, collectionKey, paper) {
  const { itemKey } = await savePaperToDailyCollection(cfg, collectionKey, paper);
  return itemKey;
}

async function openPaperInZotero(zoteroConfig, paper, onProgress) {
  const cfg = normalizeZoteroConfig(zoteroConfig);
  const exe = cfg.zoteroExePath || detectZoteroExePath();
  if (!exe || !fs.existsSync(exe)) {
    throw new Error('Zotero not found. Install Zotero or set zotero.exe path in Settings.');
  }

  const { filePath, filename, cached } = await downloadPaperToLocal(cfg, paper, onProgress);
  let attachmentKey = null;
  let parentKey = null;
  let openMode = 'file-path';
  let apiHint = '';
  const running = await isZoteroRunning();
  const localApi = running ? await isLocalApiEnabled() : false;
  const hasSqlite = Boolean(cfg.dataDir && fs.existsSync(getSqlitePath(cfg.dataDir)));

  if (running && !localApi && !hasSqlite) {
    apiHint =
      '（建议：Zotero → 设置 → 高级 → 勾选 Allow other applications… 以更快跳转）';
  }

  if (onProgress) onProgress({ stage: 'link', percent: null });

  if (running && (localApi || hasSqlite)) {
    try {
      const resolved = await ensurePaperInRunningZotero(paper, filePath, cfg);
      attachmentKey = resolved.attachmentKey;
      parentKey = resolved.parentKey;
      if (onProgress) onProgress({ stage: 'open', percent: 100 });
      await openPdfInRunningZotero(attachmentKey, parentKey, filePath, cfg);
      openMode = 'open-pdf-local';
    } catch (err) {
      console.warn('Local Zotero open failed, falling back:', err.message);
      await localApiFallback();
    }
  } else if (running && cfg.apiKey && cfg.userId && cfg.linkOnOpen !== false) {
    try {
      if (onProgress) onProgress({ stage: 'open', percent: 50 });
      const synced = await openPaperViaCloudSync(cfg, paper, filePath);
      attachmentKey = synced.attachmentKey;
      parentKey = synced.parentKey;
      openMode = synced.openMode;
      if (onProgress) onProgress({ stage: 'open', percent: 100 });
    } catch (err) {
      console.warn('Cloud Zotero open failed:', err.message);
      await localApiFallback();
    }
  } else if (running) {
    await localApiFallback();
  } else {
    attachmentKey = await resolveAttachmentKeyForOpen(cfg, paper, filePath);
    if (!attachmentKey && cfg.apiKey && cfg.userId && cfg.linkOnOpen !== false) {
      try {
        const linked = await linkPaperToLibrary(cfg, paper, filePath);
        attachmentKey = linked.attachmentKey;
        parentKey = linked.itemKey;
      } catch (err) {
        console.warn('Zotero link before open failed:', err.message);
      }
    }
    if (onProgress) onProgress({ stage: 'open', percent: 100 });
    openMode = await launchZoteroOpenPdf(cfg, attachmentKey, filePath, parentKey);
  }

  async function localApiFallback() {
    attachmentKey = await resolveAttachmentKeyForOpen(cfg, paper, filePath);
    if (!attachmentKey && cfg.apiKey && cfg.userId && cfg.linkOnOpen !== false) {
      try {
        const linked = await linkPaperToLibrary(cfg, paper, filePath);
        attachmentKey = linked.attachmentKey;
        parentKey = linked.itemKey;
        await sleep(2000);
      } catch (err) {
        console.warn('Zotero link before open failed:', err.message);
      }
    }
    if (onProgress) onProgress({ stage: 'open', percent: 100 });
    if (attachmentKey) {
      await openPdfViaZoteroUri(cfg, attachmentKey, filePath);
      openMode = 'open-pdf-fallback';
    } else {
      spawn(exe, [path.resolve(filePath)], { detached: true, stdio: 'ignore' }).unref();
      openMode = 'file-path';
    }
  }

  const viaLibrary = openMode.startsWith('open-pdf');
  const storedHint =
    cfg.attachmentMode === 'linked'
      ? '（链接附件：不会经 Zotero 文件同步到其他设备；请在各设备设置 Linked Attachment Base Directory）'
      : '（已写入 Zotero storage，同步后其他设备可下载打开）';

  return {
    ok: true,
    filePath,
    filename,
    cached: Boolean(cached),
    attachmentKey,
    openMode,
    attachmentMode: cfg.attachmentMode,
    message: viaLibrary
      ? cached
        ? `已在 Zotero 阅读器中打开（本地 PDF 缓存）${storedHint}${apiHint}`
        : `已在 Zotero 阅读器中打开${storedHint}${apiHint}`
      : cached
        ? `使用本地缓存打开：${filePath}${apiHint}`
        : `已下载到 ${filePath}，正在 Zotero 中打开…${apiHint}`,
  };
}

async function linkPaperToLibrary(zoteroConfig, paper, localFilePath) {
  const cfg = normalizeZoteroConfig(zoteroConfig);
  requireApiConfig(cfg);
  const collectionName = cfg.dailyPaperCollection || 'daily_paper';
  const collectionKey = await getOrCreateCollection(cfg, collectionName);
  return savePaperToDailyCollection(cfg, collectionKey, paper, localFilePath);
}

async function addPaperToLibrary(zoteroConfig, paper) {
  const cfg = normalizeZoteroConfig(zoteroConfig);
  const collectionName = cfg.dailyPaperCollection || 'daily_paper';
  const collectionKey = await getOrCreateCollection(cfg, collectionName);
  const { itemKey, data, filePath } = await savePaperToDailyCollection(cfg, collectionKey, paper);

  return {
    ok: true,
    key: itemKey,
    collection: collectionName,
    title: data.title,
    filePath,
    message: `已下载到 ${filePath}，并加入 Zotero 收藏夹「${collectionName}」。`,
  };
}

async function testConnection(zoteroConfig) {
  const cfg = normalizeZoteroConfig(zoteroConfig);
  const report = {
    localLibrary: null,
    api: null,
    arxivCount: 0,
  };

  if (cfg.dataDir) {
    const dbPath = getSqlitePath(cfg.dataDir);
    if (fs.existsSync(dbPath)) {
      try {
        const ids = await readLocalArxivIds(cfg.dataDir);
        report.localLibrary = { ok: true, path: dbPath, arxivItems: ids.length };
        report.arxivCount += ids.length;
      } catch (err) {
        report.localLibrary = { ok: false, path: dbPath, error: err.message, optional: true };
      }
    } else {
      const isInstallDir = fs.existsSync(path.join(cfg.dataDir, 'zotero.exe'));
      report.localLibrary = {
        ok: false,
        path: dbPath,
        error: 'File not found',
        optional: true,
        hint: isInstallDir
          ? `${cfg.dataDir} is the Zotero program folder (contains zotero.exe), not your library database. Leave this field empty or point to the profile folder with zotero.sqlite.`
          : 'Local zotero.sqlite not found. This is optional if Zotero API shows OK.',
      };
    }
  } else {
    report.localLibrary = {
      ok: false,
      optional: true,
      hint: 'No local folder set. Using Zotero API only for dedup (this is fine).',
    };
  }

  if (cfg.apiKey && cfg.userId) {
    try {
      await zoteroApi(cfg, `/users/${cfg.userId}/items/top?limit=1`);
      const ids = await fetchWebLibraryArxivIds(cfg.apiKey, cfg.userId);
      const collectionName = cfg.dailyPaperCollection || 'daily_paper';
      let collectionOk = false;
      try {
        await getOrCreateCollection(cfg, collectionName);
        collectionOk = true;
      } catch (err) {
        report.collection = { ok: false, name: collectionName, error: err.message };
      }
      if (!report.collection) {
        report.collection = { ok: collectionOk, name: collectionName };
      }
      report.api = { ok: true, arxivItems: ids.length };
      report.arxivCount = Math.max(report.arxivCount, ids.length);
    } catch (err) {
      report.api = { ok: false, error: err.message };
    }
  } else {
    report.api = { ok: false, error: 'API Key or User ID not set' };
  }

  const running = await isZoteroRunning();
  report.zoteroRunning = running;
  if (running) {
    const localApi = await isLocalApiEnabled();
    report.localApi = {
      ok: localApi,
      hint: localApi
        ? '本地 API 已开启，PlotBetter 可直接跳转到目标 PDF。'
        : '本地 API 未开启：请在 Zotero → 设置 → 高级 → 勾选「Allow other applications on this computer to communicate with Zotero」，然后重启 Zotero。',
    };
  } else {
    report.localApi = { ok: false, hint: 'Zotero 未运行。' };
  }

  return report;
}

module.exports = {
  DEFAULT_ZOTERO,
  defaultZoteroConfig,
  detectDefaultDataDir,
  downloadPaperToLocal,
  filePathToZoteroUri,
  getDailyPaperDir,
  isZoteroRunning,
  waitForLocalAttachment,
  detectZoteroExePath,
  normalizeZoteroConfig,
  extractArxivId,
  findExistingLocalPdf,
  getLibraryArxivIds,
  addPaperToLibrary,
  linkPaperToLibrary,
  openPaperInZotero,
  testConnection,
};
