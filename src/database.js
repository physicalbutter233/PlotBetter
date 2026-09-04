const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const { DB_PATH, ensureDataDir } = require('./config');

let db = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  level INTEGER DEFAULT 3,
  phase INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS papers_pushed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER NOT NULL,
  arxiv_id TEXT NOT NULL,
  title TEXT NOT NULL,
  authors TEXT,
  abstract TEXT,
  url TEXT,
  pushed_at TEXT DEFAULT (date('now')),
  rating TEXT,
  FOREIGN KEY (topic_id) REFERENCES topics(id),
  UNIQUE(topic_id, arxiv_id)
);

CREATE TABLE IF NOT EXISTS quiz_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER NOT NULL,
  question TEXT,
  correct INTEGER,
  answered_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (topic_id) REFERENCES topics(id)
);

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS task_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  completed_date TEXT NOT NULL,
  completed_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('expense', 'income')),
  amount REAL NOT NULL CHECK(amount > 0),
  category TEXT,
  note TEXT,
  txn_date TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS backlog_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  fields_json TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
`;

async function initDb() {
  ensureDataDir();
  const SQL = await initSqlJs({
    locateFile: (file) =>
      path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file),
  });

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(SCHEMA);
  migratePaperSchema();
  dedupeTaskHistory();
  persist();
  return db;
}

function getTableColumns(tableName) {
  const cols = [];
  const stmt = db.prepare(`PRAGMA table_info(${tableName})`);
  while (stmt.step()) cols.push(stmt.getAsObject().name);
  stmt.free();
  return cols;
}

function migratePaperSchema() {
  if (!db) return;
  const cols = getTableColumns('papers_pushed');
  if (!cols.includes('read_status')) {
    db.run(`ALTER TABLE papers_pushed ADD COLUMN read_status TEXT DEFAULT 'unread'`);
  }
  if (!cols.includes('last_read_at')) {
    db.run(`ALTER TABLE papers_pushed ADD COLUMN last_read_at TEXT`);
  }
  if (!cols.includes('source')) {
    db.run(`ALTER TABLE papers_pushed ADD COLUMN source TEXT DEFAULT 'auto'`);
  }
}

function dedupeTaskHistory() {
  if (!db) return;
  db.run(`
    DELETE FROM task_history
    WHERE id NOT IN (
      SELECT MIN(id)
      FROM task_history
      GROUP BY text, completed_date
    )
  `);
}

function persist() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function isReady() {
  return Boolean(db);
}

function syncTopicsFromNames(names) {
  const seen = new Set();
  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    seen.add(trimmed.toLowerCase());
    db.run('INSERT OR IGNORE INTO topics (name) VALUES (?)', [trimmed]);
  }
  persist();
}

function getTopics() {
  const rows = [];
  const stmt = db.prepare('SELECT * FROM topics ORDER BY name');
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function getTopicByName(name) {
  const stmt = db.prepare('SELECT * FROM topics WHERE lower(name) = lower(?)');
  stmt.bind([name]);
  let row = null;
  if (stmt.step()) row = stmt.getAsObject();
  stmt.free();
  return row;
}

function updateTopicLevel(topicId, delta) {
  db.run(
    `UPDATE topics SET level = MIN(5, MAX(1, level + ?)), updated_at = datetime('now') WHERE id = ?`,
    [delta, topicId]
  );
  persist();
}

function setTopicLevel(topicId, level) {
  db.run(
    `UPDATE topics SET level = MIN(5, MAX(1, ?)), updated_at = datetime('now') WHERE id = ?`,
    [level, topicId]
  );
  persist();
}

function getPushedArxivIds(topicId) {
  const ids = [];
  const stmt = db.prepare('SELECT arxiv_id FROM papers_pushed WHERE topic_id = ?');
  stmt.bind([topicId]);
  while (stmt.step()) ids.push(stmt.getAsObject().arxiv_id);
  stmt.free();
  return ids;
}

function rowToPaperRecord(row) {
  if (!row) return null;
  return {
    id: row.id,
    arxivId: row.arxiv_id,
    title: row.title,
    authors: row.authors,
    abstract: row.abstract,
    url: row.url,
    pushedAt: row.pushed_at,
    rating: row.rating,
    readStatus: row.read_status || 'unread',
    lastReadAt: row.last_read_at,
    source: row.source || 'auto',
  };
}

function getPaperForDate(topicId, dateStr) {
  const stmt = db.prepare(
    'SELECT * FROM papers_pushed WHERE topic_id = ? AND pushed_at = ? ORDER BY id DESC LIMIT 1'
  );
  stmt.bind([topicId, dateStr]);
  let row = null;
  if (stmt.step()) row = stmt.getAsObject();
  stmt.free();
  return row;
}

function getTodayPaper(topicId) {
  return getPaperForDate(topicId, localDateString());
}

function getLatestIncompletePaper(topicId) {
  const stmt = db.prepare(
    `SELECT * FROM papers_pushed
     WHERE topic_id = ? AND (rating IS NULL OR rating = '')
       AND COALESCE(read_status, 'unread') != 'done'
     ORDER BY pushed_at DESC, id DESC LIMIT 1`
  );
  stmt.bind([topicId]);
  let row = null;
  if (stmt.step()) row = stmt.getAsObject();
  stmt.free();
  return row;
}

function getPaperResumeHint(topicId) {
  const today = localDateString();
  const todayRow = getPaperForDate(topicId, today);
  if (todayRow) {
    return {
      hasTodayPaper: true,
      todayPaper: rowToPaperRecord(todayRow),
      continueCandidate: null,
      shouldPrompt: false,
    };
  }

  const incomplete = getLatestIncompletePaper(topicId);
  if (!incomplete || incomplete.pushed_at >= today) {
    return {
      hasTodayPaper: false,
      todayPaper: null,
      continueCandidate: null,
      shouldPrompt: false,
    };
  }

  return {
    hasTodayPaper: false,
    todayPaper: null,
    continueCandidate: rowToPaperRecord(incomplete),
    shouldPrompt: true,
  };
}

function savePaperPush(topicId, paper, options = {}) {
  const {
    rating = null,
    pushedAt = localDateString(),
    readStatus = 'unread',
    source = 'auto',
    lastReadAt = null,
  } = options;

  db.run(
    `INSERT OR REPLACE INTO papers_pushed
     (topic_id, arxiv_id, title, authors, abstract, url, pushed_at, rating, read_status, source, last_read_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      topicId,
      paper.arxivId,
      paper.title,
      paper.authors,
      paper.abstract,
      paper.url,
      pushedAt,
      rating,
      readStatus,
      source,
      lastReadAt,
    ]
  );
  persist();
}

function assignPaperForDate(topicId, paper, dateStr, source = 'manual') {
  db.run('DELETE FROM papers_pushed WHERE topic_id = ? AND pushed_at = ?', [topicId, dateStr]);
  db.run('DELETE FROM papers_pushed WHERE topic_id = ? AND arxiv_id = ?', [topicId, paper.arxivId]);
  savePaperPush(topicId, paper, {
    pushedAt: dateStr,
    source,
    readStatus: paper.readStatus || 'unread',
    lastReadAt: paper.lastReadAt || null,
  });
  return getPaperForDate(topicId, dateStr);
}

function continuePaperToToday(topicId) {
  const incomplete = getLatestIncompletePaper(topicId);
  if (!incomplete) return null;
  const today = localDateString();
  db.run('DELETE FROM papers_pushed WHERE topic_id = ? AND pushed_at = ?', [topicId, today]);
  db.run(
    `UPDATE papers_pushed
     SET pushed_at = ?, source = 'continued', read_status = 'in_progress', last_read_at = datetime('now')
     WHERE id = ?`,
    [today, incomplete.id]
  );
  persist();
  return getPaperForDate(topicId, today);
}

function updatePaperReading(topicId, arxivId, { readStatus, touchLastRead = true } = {}) {
  const fields = [];
  const values = [];
  if (readStatus) {
    fields.push('read_status = ?');
    values.push(readStatus);
  }
  if (touchLastRead) {
    fields.push("last_read_at = datetime('now')");
  }
  if (fields.length === 0) return;
  values.push(topicId, arxivId);
  db.run(
    `UPDATE papers_pushed SET ${fields.join(', ')} WHERE topic_id = ? AND arxiv_id = ?`,
    values
  );
  persist();
}

function rateTodayPaper(topicId, rating) {
  const today = localDateString();
  db.run(
    `UPDATE papers_pushed
     SET rating = ?, read_status = 'done', last_read_at = COALESCE(last_read_at, datetime('now'))
     WHERE topic_id = ? AND pushed_at = ?`,
    [rating, topicId, today]
  );
  persist();
}

function ratePaperForDate(topicId, dateStr, rating) {
  db.run(
    `UPDATE papers_pushed
     SET rating = ?, read_status = 'done', last_read_at = COALESCE(last_read_at, datetime('now'))
     WHERE topic_id = ? AND pushed_at = ?`,
    [rating, topicId, dateStr]
  );
  persist();
}

function clearTodayPaper(topicId) {
  db.run('DELETE FROM papers_pushed WHERE topic_id = ? AND pushed_at = ?', [
    topicId,
    localDateString(),
  ]);
  persist();
}

function logQuiz(topicId, question, correct) {
  db.run(
    'INSERT INTO quiz_log (topic_id, question, correct) VALUES (?, ?, ?)',
    [topicId, question, correct ? 1 : 0]
  );
  persist();
}

function getState(key) {
  const stmt = db.prepare('SELECT value FROM app_state WHERE key = ?');
  stmt.bind([key]);
  let val = null;
  if (stmt.step()) val = stmt.getAsObject().value;
  stmt.free();
  return val;
}

function setState(key, value) {
  db.run('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)', [key, value]);
  persist();
}

function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addCompletedTask(text, completedDate = localDateString()) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return;

  const existing = db.prepare(
    'SELECT id FROM task_history WHERE text = ? AND completed_date = ? LIMIT 1'
  );
  existing.bind([trimmed, completedDate]);
  if (existing.step()) {
    existing.free();
    return;
  }
  existing.free();

  db.run('INSERT INTO task_history (text, completed_date) VALUES (?, ?)', [
    trimmed,
    completedDate,
  ]);
  persist();
}

function getTaskHistoryGrouped() {
  const rows = [];
  const stmt = db.prepare(
    'SELECT id, text, completed_date FROM task_history ORDER BY completed_date DESC, id DESC'
  );
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();

  const map = new Map();
  for (const row of rows) {
    const date = row.completed_date;
    if (!map.has(date)) map.set(date, []);
    map.get(date).push({ id: row.id, text: row.text, completed_date: date });
  }

  return [...map.entries()].map(([date, tasks]) => ({ date, tasks }));
}

function deleteCompletedTask(id) {
  db.run('DELETE FROM task_history WHERE id = ?', [id]);
  persist();
}

function getBacklogTasks() {
  const rows = [];
  const stmt = db.prepare(
    'SELECT id, text, created_at FROM backlog_tasks ORDER BY id ASC'
  );
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function addBacklogTask(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('Task text is required');
  db.run('INSERT INTO backlog_tasks (text) VALUES (?)', [trimmed]);
  persist();
  return getBacklogTasks();
}

function updateBacklogTask(id, text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('Task text is required');
  db.run('UPDATE backlog_tasks SET text = ? WHERE id = ?', [trimmed, id]);
  persist();
  return getBacklogTasks();
}

function deleteBacklogTask(id) {
  db.run('DELETE FROM backlog_tasks WHERE id = ?', [id]);
  persist();
  return getBacklogTasks();
}

function completeBacklogTask(id) {
  const stmt = db.prepare('SELECT text FROM backlog_tasks WHERE id = ?');
  stmt.bind([id]);
  let text = null;
  if (stmt.step()) text = stmt.getAsObject().text;
  stmt.free();
  if (!text) return { backlog: getBacklogTasks(), history: getTaskHistoryGrouped() };
  addCompletedTask(text);
  db.run('DELETE FROM backlog_tasks WHERE id = ?', [id]);
  persist();
  return { backlog: getBacklogTasks(), history: getTaskHistoryGrouped() };
}

function normalizeYearMonth(yearMonth) {
  if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  return yearMonth;
}

function addTransaction({ type, amount, category = '', note = '', txnDate = localDateString() }) {
  const txnType = type === 'income' ? 'income' : 'expense';
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Amount must be a positive number');
  }
  db.run(
    'INSERT INTO transactions (type, amount, category, note, txn_date) VALUES (?, ?, ?, ?, ?)',
    [txnType, value, category.trim(), note.trim(), txnDate]
  );
  persist();
}

function deleteTransaction(id) {
  db.run('DELETE FROM transactions WHERE id = ?', [id]);
  persist();
}

function getTransactionsGrouped(yearMonth) {
  const ym = normalizeYearMonth(yearMonth);
  const rows = [];
  const stmt = db.prepare(
    `SELECT id, type, amount, category, note, txn_date
     FROM transactions
     WHERE txn_date LIKE ?
     ORDER BY txn_date DESC, id DESC`
  );
  stmt.bind([`${ym}%`]);
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();

  const map = new Map();
  for (const row of rows) {
    const date = row.txn_date;
    if (!map.has(date)) map.set(date, []);
    map.get(date).push({
      id: row.id,
      type: row.type,
      amount: row.amount,
      category: row.category,
      note: row.note,
      txn_date: date,
    });
  }

  return [...map.entries()].map(([date, items]) => ({ date, items }));
}

function getMonthlySummary(yearMonth) {
  const ym = normalizeYearMonth(yearMonth);
  const stmt = db.prepare(
    `SELECT type, COALESCE(SUM(amount), 0) AS total
     FROM transactions
     WHERE txn_date LIKE ?
     GROUP BY type`
  );
  stmt.bind([`${ym}%`]);
  let income = 0;
  let expense = 0;
  while (stmt.step()) {
    const row = stmt.getAsObject();
    if (row.type === 'income') income = row.total;
    if (row.type === 'expense') expense = row.total;
  }
  stmt.free();
  return {
    yearMonth: ym,
    income,
    expense,
    balance: income - expense,
  };
}

const DEFAULT_RECIPE_FIELDS = [
  { label: 'Ingredients', value: '' },
  { label: 'Steps', value: '' },
  { label: 'Notes', value: '' },
];

function parseRecipeFields(json) {
  try {
    const parsed = JSON.parse(json || '[]');
    if (!Array.isArray(parsed)) return [...DEFAULT_RECIPE_FIELDS];
    return parsed.map((f) => ({
      label: String(f.label || '').trim(),
      value: String(f.value ?? ''),
    }));
  } catch {
    return [...DEFAULT_RECIPE_FIELDS];
  }
}

function serializeRecipeFields(fields) {
  const list = Array.isArray(fields) ? fields : [];
  return JSON.stringify(
    list.map((f) => ({
      label: String(f.label || '').trim(),
      value: String(f.value ?? ''),
    }))
  );
}

function rowToRecipe(row) {
  return {
    id: row.id,
    name: row.name,
    fields: parseRecipeFields(row.fields_json),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getRecipes() {
  const rows = [];
  const stmt = db.prepare('SELECT * FROM recipes ORDER BY sort_order ASC, id ASC');
  while (stmt.step()) rows.push(rowToRecipe(stmt.getAsObject()));
  stmt.free();
  return rows;
}

function getRecipe(id) {
  const stmt = db.prepare('SELECT * FROM recipes WHERE id = ?');
  stmt.bind([id]);
  let row = null;
  if (stmt.step()) row = rowToRecipe(stmt.getAsObject());
  stmt.free();
  return row;
}

function nextRecipeSortOrder() {
  const stmt = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM recipes');
  stmt.step();
  const next = stmt.getAsObject().next;
  stmt.free();
  return next;
}

function addRecipe({ name, fields }) {
  const trimmed = String(name || 'Untitled').trim() || 'Untitled';
  const sortOrder = nextRecipeSortOrder();
  const fieldsJson = serializeRecipeFields(fields?.length ? fields : DEFAULT_RECIPE_FIELDS);
  db.run(
    'INSERT INTO recipes (name, fields_json, sort_order) VALUES (?, ?, ?)',
    [trimmed, fieldsJson, sortOrder]
  );
  persist();
  const stmt = db.prepare('SELECT * FROM recipes ORDER BY id DESC LIMIT 1');
  stmt.step();
  const row = stmt.getAsObject();
  stmt.free();
  return row ? rowToRecipe(row) : null;
}

function updateRecipe(id, { name, fields }) {
  const existing = getRecipe(id);
  if (!existing) return null;
  const trimmed = name !== undefined ? String(name).trim() || 'Untitled' : existing.name;
  const fieldsJson =
    fields !== undefined
      ? serializeRecipeFields(fields)
      : serializeRecipeFields(existing.fields);
  db.run(
    `UPDATE recipes SET name = ?, fields_json = ?, updated_at = datetime('now') WHERE id = ?`,
    [trimmed, fieldsJson, id]
  );
  persist();
  return getRecipe(id);
}

function deleteRecipe(id) {
  db.run('DELETE FROM recipes WHERE id = ?', [id]);
  persist();
}

module.exports = {
  initDb,
  isReady,
  persist,
  syncTopicsFromNames,
  getTopics,
  getTopicByName,
  updateTopicLevel,
  setTopicLevel,
  getPushedArxivIds,
  getPaperForDate,
  getTodayPaper,
  getLatestIncompletePaper,
  getPaperResumeHint,
  savePaperPush,
  assignPaperForDate,
  continuePaperToToday,
  updatePaperReading,
  rateTodayPaper,
  ratePaperForDate,
  clearTodayPaper,
  rowToPaperRecord,
  logQuiz,
  getState,
  setState,
  localDateString,
  addCompletedTask,
  dedupeTaskHistory,
  getTaskHistoryGrouped,
  deleteCompletedTask,
  getBacklogTasks,
  addBacklogTask,
  updateBacklogTask,
  deleteBacklogTask,
  completeBacklogTask,
  addTransaction,
  deleteTransaction,
  getTransactionsGrouped,
  getMonthlySummary,
  getRecipes,
  getRecipe,
  addRecipe,
  updateRecipe,
  deleteRecipe,
  DEFAULT_RECIPE_FIELDS,
};
