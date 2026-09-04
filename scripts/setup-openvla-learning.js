/**
 * One-time setup: OpenVLA learning path — reset topics, level 1, clear paper cache.
 * Run: node scripts/setup-openvla-learning.js
 */
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(__dirname, '..', 'data', 'plotbetter.db');
const OLD_TOPICS = ['machine learning', 'attention mechanism'];
const TARGET_TOPIC = 'OpenVLA';

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.log('No database yet — first launch will create OpenVLA topic from daily.txt.');
    return;
  }

  const SQL = await initSqlJs({
    locateFile: (file) =>
      path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file),
  });
  const buffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buffer);

  for (const name of OLD_TOPICS) {
    const stmt = db.prepare('SELECT id FROM topics WHERE lower(name) = lower(?)');
    stmt.bind([name]);
    if (stmt.step()) {
      const id = stmt.getAsObject().id;
      db.run('DELETE FROM papers_pushed WHERE topic_id = ?', [id]);
      db.run('DELETE FROM quiz_log WHERE topic_id = ?', [id]);
      db.run('DELETE FROM topics WHERE id = ?', [id]);
      console.log(`Removed old topic: ${name}`);
    }
    stmt.free();
  }

  db.run('INSERT OR IGNORE INTO topics (name, level) VALUES (?, 1)', [TARGET_TOPIC]);
  db.run(
    `UPDATE topics SET level = 1, updated_at = datetime('now') WHERE lower(name) = lower(?)`,
    [TARGET_TOPIC]
  );

  const topicStmt = db.prepare('SELECT id FROM topics WHERE lower(name) = lower(?)');
  topicStmt.bind([TARGET_TOPIC]);
  if (topicStmt.step()) {
    const topicId = topicStmt.getAsObject().id;
    db.run('DELETE FROM papers_pushed WHERE topic_id = ?', [topicId]);
    console.log(`Reset OpenVLA: level=1, cleared paper history (anchor 2406.09246 on next load).`);
  }
  topicStmt.free();

  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  db.close();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
