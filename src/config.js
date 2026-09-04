const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const DB_PATH = path.join(DATA_DIR, 'plotbetter.db');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadConfig() {
  ensureDataDir();
  const widget = require('./widgetWindow');
  if (!fs.existsSync(CONFIG_PATH)) {
    const defaultConfig = {
      dailyFile: 'daily.txt',
      pushHour: 9,
      autoLaunch: false,
      quizLanguage: 'auto',
      widget: widget.defaultWidgetConfig(),
      zotero: require('./zotero').defaultZoteroConfig(),
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2), 'utf8');
    return defaultConfig;
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  config.widget = widget.normalizeWidgetConfig(config.widget);
  config.zotero = require('./zotero').normalizeZoteroConfig(config.zotero);
  if (config.autoLaunch === undefined) config.autoLaunch = false;
  if (!config.quizLanguage) config.quizLanguage = 'auto';
  return config;
}

function saveConfig(config) {
  ensureDataDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

function getDailyPath(config) {
  const rel = config.dailyFile || 'daily.txt';
  if (path.isAbsolute(rel)) return rel;
  return path.join(DATA_DIR, rel);
}

module.exports = {
  DATA_DIR,
  CONFIG_PATH,
  DB_PATH,
  ensureDataDir,
  loadConfig,
  saveConfig,
  getDailyPath,
};
