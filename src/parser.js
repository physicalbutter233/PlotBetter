/**
 * Parse daily.txt: @topic lines and - [ ] task lines.
 */
function parseDaily(content) {
  const lines = content.split(/\r?\n/);
  const topics = [];
  const tasks = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const topicMatch = line.match(/^@topic:\s*(.+)$/i);
    if (topicMatch) {
      topics.push({ name: topicMatch[1].trim(), lineIndex: i });
      continue;
    }
    const taskMatch = line.match(/^-\s*\[([ xX])\]\s*(.+)$/);
    if (taskMatch) {
      tasks.push({
        done: taskMatch[1].toLowerCase() === 'x',
        text: taskMatch[2].trim(),
        lineIndex: i,
      });
    }
  }

  return { topics, tasks, lines };
}

function toggleTaskLine(lines, lineIndex, done) {
  const updated = [...lines];
  const line = updated[lineIndex];
  if (!line) return updated;
  if (done) {
    updated[lineIndex] = line.replace(/^(-\s*)\[[ xX]\]/, '$1[x]');
  } else {
    updated[lineIndex] = line.replace(/^(-\s*)\[[ xX]\]/, '$1[ ]');
  }
  return updated;
}

function addTask(lines, text) {
  const trimmed = text.trim();
  if (!trimmed) return lines;
  return [...lines, `- [ ] ${trimmed}`];
}

function updateTaskText(lines, lineIndex, text) {
  const updated = [...lines];
  const line = updated[lineIndex];
  if (!line) return updated;
  const m = line.match(/^(-\s*\[[ xX]\]\s*)(.*)$/);
  if (!m) return updated;
  updated[lineIndex] = `${m[1]}${text.trim()}`;
  return updated;
}

function deleteLine(lines, lineIndex) {
  return lines.filter((_, i) => i !== lineIndex);
}

function addTopic(lines, name) {
  const trimmed = name.trim();
  if (!trimmed) return lines;
  const updated = [...lines];
  let insertAt = 0;
  for (let i = 0; i < updated.length; i++) {
    if (/^@topic:/i.test(updated[i])) insertAt = i + 1;
  }
  if (insertAt === 0 && updated.length && /^#/.test(updated[0])) insertAt = 1;
  updated.splice(insertAt, 0, `@topic: ${trimmed}`);
  return updated;
}

function linesToContent(lines) {
  return lines.join('\n');
}

/** Remove completed task lines and return their texts (for archiving). */
function extractCompletedTasks(lines) {
  const completed = [];
  const remaining = [];
  for (const line of lines) {
    const m = line.match(/^-\s*\[[xX]\]\s*(.+)$/);
    if (m) {
      completed.push(m[1].trim());
    } else {
      remaining.push(line);
    }
  }
  return { completed, remaining };
}

function getPendingTasks(parsed) {
  return parsed.tasks.filter((t) => !t.done);
}

module.exports = {
  parseDaily,
  toggleTaskLine,
  addTask,
  updateTaskText,
  deleteLine,
  addTopic,
  linesToContent,
  extractCompletedTasks,
  getPendingTasks,
};
