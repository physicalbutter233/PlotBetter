const fs = require('fs');
const path = require('path');
const z = require('../src/zotero');

const cfg = z.normalizeZoteroConfig(
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'config.json'), 'utf8')).zotero
);

const title = 'The Key to Going Linear';

async function main() {
  console.log('dataDir:', cfg.dataDir);
  console.log('running:', await z.isZoteroRunning());

  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({
    locateFile: (f) => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', f),
  });
  const dbPath = path.join(cfg.dataDir, 'zotero.sqlite');
  const db = new SQL.Database(fs.readFileSync(dbPath));

  const stmt = db.prepare(`
    SELECT i.key AS key, i.itemID AS itemID, v.value AS title
    FROM items i
    JOIN itemData d ON i.itemID = d.itemID
    JOIN itemDataValues v ON d.valueID = v.valueID
    JOIN fields f ON d.fieldID = f.fieldID
    WHERE f.fieldName = 'title' AND v.value LIKE ?
  `);
  stmt.bind([`%${title}%`]);
  const parents = [];
  while (stmt.step()) parents.push(stmt.getAsObject());
  stmt.free();

  console.log('parents:', parents);

  for (const p of parents) {
    const att = db.prepare(`
      SELECT i.key AS key, ia.path AS path, ia.linkMode AS linkMode, ia.contentType AS contentType
      FROM items i
      JOIN itemAttachments ia ON ia.itemID = i.itemID
      WHERE ia.parentItemID = ?
    `);
    att.bind([p.itemID]);
    const pdfs = [];
    while (att.step()) pdfs.push(att.getAsObject());
    att.free();
    console.log('attachments for', p.key, ':', pdfs);
  }

  db.close();

  const dailyDir = z.getDailyPaperDir(cfg);
  console.log('daily dir:', dailyDir, 'exists:', fs.existsSync(dailyDir));
  if (fs.existsSync(dailyDir)) {
    console.log('files:', fs.readdirSync(dailyDir).filter((f) => f.includes('Linear') || f.includes('Key')));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
