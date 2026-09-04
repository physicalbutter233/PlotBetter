let state = {
  daily: null,
  topics: [],
  config: null,
  taskHistory: [],
  backlogTasks: [],
  financeHistory: [],
  financeSummary: null,
  financeType: 'expense',
  currentPaper: null,
  currentQuiz: null,
  selectedQuizIndex: null,
  editorDirty: false,
  saveTimer: null,
  recipes: [],
  editingRecipeId: null,
};

const els = {
  dailyEditor: document.getElementById('daily-editor'),
  editorStatus: document.getElementById('editor-status'),
  taskListToday: document.getElementById('task-list-today'),
  taskListBacklog: document.getElementById('task-list-backlog'),
  tasksGreeting: document.getElementById('tasks-greeting'),
  tasksSubline: document.getElementById('tasks-subline'),
  tasksProgressArc: document.getElementById('tasks-progress-arc'),
  tasksProgressPct: document.getElementById('tasks-progress-pct'),
  statTodayCount: document.getElementById('stat-today-count'),
  statBacklogCount: document.getElementById('stat-backlog-count'),
  statDoneCount: document.getElementById('stat-done-count'),
  taskHistory: document.getElementById('task-history'),
  todayDateLabel: document.getElementById('today-date-label'),
  tasksEmpty: document.getElementById('tasks-empty'),
  backlogEmpty: document.getElementById('backlog-empty'),
  historyEmpty: document.getElementById('history-empty'),
  newTaskInput: document.getElementById('new-task-input'),
  newBacklogInput: document.getElementById('new-backlog-input'),
  topicList: document.getElementById('topic-list'),
  topicsEmpty: document.getElementById('topics-empty'),
  newTopicInput: document.getElementById('new-topic-input'),
  paperTopic: document.getElementById('paper-topic'),
  quizTopic: document.getElementById('quiz-topic'),
  paperResumeBanner: document.getElementById('paper-resume-banner'),
  paperResumeTitle: document.getElementById('paper-resume-title'),
  paperResumeDesc: document.getElementById('paper-resume-desc'),
  paperArxivInput: document.getElementById('paper-arxiv-input'),
  paperAssignDate: document.getElementById('paper-assign-date'),
  paperCard: document.getElementById('paper-card'),
  paperLabel: document.getElementById('paper-label'),
  paperReadBadge: document.getElementById('paper-read-badge'),
  paperDateLine: document.getElementById('paper-date-line'),
  paperLoading: document.getElementById('paper-loading'),
  paperError: document.getElementById('paper-error'),
  paperTitle: document.getElementById('paper-title'),
  paperAuthors: document.getElementById('paper-authors'),
  paperWhy: document.getElementById('paper-why'),
  paperTakeaways: document.getElementById('paper-takeaways'),
  paperAbstract: document.getElementById('paper-abstract'),
  quizCard: document.getElementById('quiz-card'),
  quizEmpty: document.getElementById('quiz-empty'),
  quizHint: document.getElementById('quiz-hint'),
  quizQuestion: document.getElementById('quiz-question'),
  quizOptions: document.getElementById('quiz-options'),
  quizResult: document.getElementById('quiz-result'),
  btnOpenZotero: document.getElementById('btn-open-zotero'),
  paperZoteroHint: document.getElementById('paper-zotero-hint'),
  paperZoteroMsg: document.getElementById('paper-zotero-msg'),
  setZoteroEnabled: document.getElementById('set-zotero-enabled'),
  zoteroOptions: document.getElementById('zotero-options'),
  setZoteroSkip: document.getElementById('set-zotero-skip'),
  setZoteroAuto: document.getElementById('set-zotero-auto'),
  setZoteroLinkOpen: document.getElementById('set-zotero-link-open'),
  setZoteroAttachmentMode: document.getElementById('set-zotero-attachment-mode'),
  setZoteroUserId: document.getElementById('set-zotero-userid'),
  setZoteroApiKey: document.getElementById('set-zotero-apikey'),
  setZoteroDataDir: document.getElementById('set-zotero-datadir'),
  setZoteroCollection: document.getElementById('set-zotero-collection'),
  zoteroTestResult: document.getElementById('zotero-test-result'),
  settingsSaved: document.getElementById('settings-saved'),
  setWidgetEdge: document.getElementById('set-widget-edge'),
  setAutoLaunch: document.getElementById('set-auto-launch'),
  autoLaunchStatus: document.getElementById('auto-launch-status'),
  setQuizLanguage: document.getElementById('set-quiz-language'),
  financeMonth: document.getElementById('finance-month'),
  financeIncomeTotal: document.getElementById('finance-income-total'),
  financeExpenseTotal: document.getElementById('finance-expense-total'),
  financeBalanceTotal: document.getElementById('finance-balance-total'),
  financeAmount: document.getElementById('finance-amount'),
  financeCategory: document.getElementById('finance-category'),
  financeDate: document.getElementById('finance-date'),
  financeNote: document.getElementById('finance-note'),
  financeHistory: document.getElementById('finance-history'),
  financeEmpty: document.getElementById('finance-empty'),
  recipeGrid: document.getElementById('recipe-grid'),
  recipeScroll: document.getElementById('recipe-scroll'),
  recipeEmptyHint: document.getElementById('recipe-empty-hint'),
  recipeEditor: document.getElementById('recipe-editor'),
  recipeEditorName: document.getElementById('recipe-editor-name'),
  recipeEditorFields: document.getElementById('recipe-editor-fields'),
};

function switchTab(tabId) {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.id === `tab-${tabId}`);
  });
  if (tabId === 'alltasks') loadTaskHistory();
  if (tabId === 'tasks') {
    loadBacklogTasks();
    updateTasksDashboard();
  }
  if (tabId === 'finance') loadFinance();
  if (tabId === 'recipes') loadRecipes();
  if (tabId === 'paper') refreshPaperPanel();
}

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

document.getElementById('btn-open-note').addEventListener('click', () => window.plotBetter.openDaily());
document.getElementById('btn-refresh').addEventListener('click', () => loadAll());

// --- Daily Note editor ---

function setEditorStatus(dirty) {
  state.editorDirty = dirty;
  els.editorStatus.textContent = dirty ? 'Unsaved changes' : 'Saved';
  els.editorStatus.classList.toggle('dirty', dirty);
}

function loadEditorContent(content) {
  if (state.editorDirty) return;
  els.dailyEditor.value = content;
  setEditorStatus(false);
}

async function saveDailyEditor() {
  const content = els.dailyEditor.value;
  const updated = await window.plotBetter.saveDaily(content);
  applyDailyUpdate(updated, { syncEditor: true });
  setEditorStatus(false);
}

function scheduleAutoSave() {
  setEditorStatus(true);
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => saveDailyEditor(), 1200);
}

els.dailyEditor.addEventListener('input', scheduleAutoSave);

document.getElementById('btn-save-daily').addEventListener('click', () => saveDailyEditor());

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    const dailyTab = document.getElementById('tab-daily');
    if (dailyTab.classList.contains('active')) {
      e.preventDefault();
      saveDailyEditor();
    }
  }
});

// --- Tasks ---

function tasksGreetingText() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 21) return 'Good evening';
  return 'Good night';
}

const TASKS_RING_LEN = 188.5;

function setTasksProgress(pct) {
  const clamped = Math.max(0, Math.min(100, pct));
  if (els.tasksProgressArc) {
    els.tasksProgressArc.style.strokeDashoffset = String(TASKS_RING_LEN * (1 - clamped / 100));
  }
  if (els.tasksProgressPct) {
    els.tasksProgressPct.textContent = `${Math.round(clamped)}%`;
  }
}

function countDoneInHistory(groups) {
  if (!groups?.length) return 0;
  return groups.reduce((sum, g) => sum + (g.tasks?.length || 0), 0);
}

function updateTasksDashboard() {
  const daily = state.daily;
  const pending = daily?.pendingTasks || daily?.tasks?.filter((t) => !t.done) || [];
  const allToday = daily?.tasks || [];
  const todayDone = allToday.filter((t) => t.done).length;
  const todayTotal = allToday.length;
  const backlogCount = state.backlogTasks?.length || 0;
  const doneTotal = countDoneInHistory(state.taskHistory);

  if (els.tasksGreeting) els.tasksGreeting.textContent = tasksGreetingText();
  if (els.statTodayCount) els.statTodayCount.textContent = String(pending.length);
  if (els.statBacklogCount) els.statBacklogCount.textContent = String(backlogCount);
  if (els.statDoneCount) els.statDoneCount.textContent = String(doneTotal);

  let pct = 0;
  if (todayTotal > 0) {
    pct = (todayDone / todayTotal) * 100;
  } else if (pending.length === 0) {
    pct = 100;
  }

  setTasksProgress(pct);

  if (els.tasksSubline) {
    if (pending.length === 0 && backlogCount === 0) {
      els.tasksSubline.textContent = 'All clear — enjoy the momentum ✦';
    } else if (pending.length === 0) {
      els.tasksSubline.textContent = `Today is clear · ${backlogCount} in backlog`;
    } else if (pending.length === 1) {
      els.tasksSubline.textContent = '1 task left today — you’ve got this';
    } else {
      els.tasksSubline.textContent = `${pending.length} tasks left today`;
    }
  }
}

function animateTaskComplete(li) {
  if (!li) return;
  li.classList.add('task-item-completing');
  setTimeout(() => li.classList.remove('task-item-completing'), 520);
}

function autoResizeTaskEdit(el) {
  el.style.height = 'auto';
  el.style.height = `${Math.max(el.scrollHeight, 28)}px`;
}

function createTaskEditField(initialText, onCommit) {
  const field = document.createElement('textarea');
  field.className = 'task-edit';
  field.rows = 1;
  field.value = initialText;
  field.spellcheck = false;
  let prevText = initialText;

  const resize = () => autoResizeTaskEdit(field);
  field.addEventListener('input', resize);
  requestAnimationFrame(resize);

  field.addEventListener('blur', async () => {
    const next = field.value.trim();
    await onCommit(next, prevText);
    prevText = field.value.trim();
  });

  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      field.blur();
    }
  });

  return field;
}

function mountTaskItem(list, li, index) {
  li.classList.add('task-item-enter');
  li.style.animationDelay = `${Math.min(index * 45, 320)}ms`;
  list.appendChild(li);
}

function formatDisplayDate(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', weekday: 'short' });
}

function localTodayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayDateLabel() {
  return formatDisplayDate(localTodayIso());
}

function renderTodayTasks(daily) {
  els.taskListToday.innerHTML = '';
  els.todayDateLabel.textContent = todayDateLabel();

  const pending = daily.pendingTasks || daily.tasks.filter((t) => !t.done);

  if (pending.length === 0) {
    els.tasksEmpty.classList.remove('hidden');
    updateTasksDashboard();
    return;
  }
  els.tasksEmpty.classList.add('hidden');

  pending.forEach((task, index) => {
    const li = document.createElement('li');
    li.className = 'task-item';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'task-check';
    cb.title = 'Mark complete';
    cb.addEventListener('change', async () => {
      if (!cb.checked || cb.dataset.completing === '1') {
        if (!cb.checked) cb.dataset.completing = '';
        return;
      }
      cb.dataset.completing = '1';
      cb.disabled = true;
      try {
        animateTaskComplete(li);
        const result = await window.plotBetter.completeTask(task.lineIndex, task.text);
        applyDailyUpdate(result.daily, { history: result.history });
      } catch {
        cb.checked = false;
        cb.disabled = false;
        cb.dataset.completing = '';
      }
    });

    const input = createTaskEditField(task.text, async (next, prevText) => {
      if (!next) {
        const updated = await window.plotBetter.deleteTask(task.lineIndex);
        applyDailyUpdate(updated);
        return;
      }
      if (next !== prevText) {
        const updated = await window.plotBetter.updateTask(task.lineIndex, next);
        applyDailyUpdate(updated);
      }
    });

    const del = document.createElement('button');
    del.className = 'icon-btn';
    del.title = 'Delete task';
    del.textContent = '×';
    del.addEventListener('click', async () => {
      const updated = await window.plotBetter.deleteTask(task.lineIndex);
      applyDailyUpdate(updated);
    });

    const actions = document.createElement('div');
    actions.className = 'task-actions';
    actions.appendChild(del);

    li.append(cb, input, actions);
    mountTaskItem(els.taskListToday, li, index);
  });
  updateTasksDashboard();
}

function renderBacklogTasks(tasks) {
  els.taskListBacklog.innerHTML = '';
  if (!tasks || tasks.length === 0) {
    els.backlogEmpty.classList.remove('hidden');
    updateTasksDashboard();
    return;
  }
  els.backlogEmpty.classList.add('hidden');

  tasks.forEach((task, index) => {
    const li = document.createElement('li');
    li.className = 'task-item backlog-item';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'task-check';
    cb.title = 'Mark complete';
    cb.addEventListener('change', async () => {
      if (!cb.checked) return;
      animateTaskComplete(li);
      const result = await window.plotBetter.completeBacklogTask(task.id);
      state.backlogTasks = result.backlog;
      renderBacklogTasks(result.backlog);
      if (result.history) {
        state.taskHistory = result.history;
        renderTaskHistory(result.history);
      }
    });

    const input = createTaskEditField(task.text, async (next, prevText) => {
      if (!next) {
        state.backlogTasks = await window.plotBetter.deleteBacklogTask(task.id);
        renderBacklogTasks(state.backlogTasks);
        return;
      }
      if (next !== prevText) {
        state.backlogTasks = await window.plotBetter.updateBacklogTask(task.id, next);
        renderBacklogTasks(state.backlogTasks);
      }
    });

    const todayBtn = document.createElement('button');
    todayBtn.className = 'ghost-btn task-today-btn';
    todayBtn.title = 'Move to today';
    todayBtn.textContent = '→ Today';
    todayBtn.addEventListener('click', async () => {
      const result = await window.plotBetter.moveBacklogToToday(task.id);
      state.backlogTasks = result.backlog;
      renderBacklogTasks(result.backlog);
      applyDailyUpdate(result.daily);
    });

    const del = document.createElement('button');
    del.className = 'icon-btn';
    del.title = 'Delete task';
    del.textContent = '×';
    del.addEventListener('click', async () => {
      state.backlogTasks = await window.plotBetter.deleteBacklogTask(task.id);
      renderBacklogTasks(state.backlogTasks);
    });

    const actions = document.createElement('div');
    actions.className = 'task-actions';
    actions.append(todayBtn, del);

    li.append(cb, input, actions);
    mountTaskItem(els.taskListBacklog, li, index);
  });
  updateTasksDashboard();
}

async function loadBacklogTasks() {
  state.backlogTasks = await window.plotBetter.getBacklogTasks();
  renderBacklogTasks(state.backlogTasks);
}

function renderTaskHistory(groups) {
  els.taskHistory.innerHTML = '';
  if (!groups || groups.length === 0) {
    els.historyEmpty.classList.remove('hidden');
    return;
  }
  els.historyEmpty.classList.add('hidden');

  groups.forEach((group) => {
    const section = document.createElement('div');
    section.className = 'history-group';

    const title = document.createElement('div');
    title.className = 'history-group-title';
    title.textContent = formatDisplayDate(group.date);

    section.appendChild(title);

    group.tasks.forEach((task) => {
      const row = document.createElement('div');
      row.className = 'history-item';

      const mark = document.createElement('span');
      mark.className = 'history-check';
      mark.textContent = '✓';

      const text = document.createElement('span');
      text.className = 'history-item-text';
      text.textContent = task.text;

      const del = document.createElement('button');
      del.className = 'icon-btn';
      del.title = 'Remove from history';
      del.textContent = '×';
      del.addEventListener('click', async () => {
        const history = await window.plotBetter.deleteCompletedTask(task.id);
        state.taskHistory = history;
        renderTaskHistory(history);
      });

      row.append(mark, text, del);
      section.appendChild(row);
    });

    els.taskHistory.appendChild(section);
  });
}

async function loadTaskHistory() {
  state.taskHistory = await window.plotBetter.getTaskHistory();
  renderTaskHistory(state.taskHistory);
}

document.getElementById('btn-add-task').addEventListener('click', addTaskFromInput);
els.newTaskInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addTaskFromInput();
});

async function addTaskFromInput() {
  const text = els.newTaskInput.value.trim();
  if (!text) return;
  const updated = await window.plotBetter.addTask(text);
  els.newTaskInput.value = '';
  applyDailyUpdate(updated);
}

async function addBacklogFromInput() {
  const text = els.newBacklogInput.value.trim();
  if (!text) return;
  state.backlogTasks = await window.plotBetter.addBacklogTask(text);
  els.newBacklogInput.value = '';
  renderBacklogTasks(state.backlogTasks);
}

document.getElementById('btn-add-backlog').addEventListener('click', addBacklogFromInput);
els.newBacklogInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addBacklogFromInput();
});

// --- Finance ---

function currentFinanceMonth() {
  return els.financeMonth?.value || new Date().toISOString().slice(0, 7);
}

function formatMoney(amount) {
  const n = Number(amount) || 0;
  return `¥${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function setFinanceType(type) {
  state.financeType = type === 'income' ? 'income' : 'expense';
  document.querySelectorAll('.finance-type-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.type === state.financeType);
  });
}

function renderFinanceSummary(summary) {
  if (!summary) return;
  state.financeSummary = summary;
  els.financeIncomeTotal.textContent = formatMoney(summary.income);
  els.financeExpenseTotal.textContent = formatMoney(summary.expense);
  els.financeBalanceTotal.textContent = formatMoney(summary.balance);
  els.financeBalanceTotal.classList.toggle('negative', summary.balance < 0);
}

function renderFinanceHistory(groups) {
  els.financeHistory.innerHTML = '';
  if (!groups || groups.length === 0) {
    els.financeEmpty.classList.remove('hidden');
    return;
  }
  els.financeEmpty.classList.add('hidden');

  groups.forEach((group) => {
    const section = document.createElement('div');
    section.className = 'history-group';

    const title = document.createElement('div');
    title.className = 'history-group-title';
    title.textContent = formatDisplayDate(group.date);
    section.appendChild(title);

    group.items.forEach((item) => {
      const row = document.createElement('div');
      row.className = `history-item finance-item ${item.type}`;

      const mark = document.createElement('span');
      mark.className = 'finance-type-mark';
      mark.textContent = item.type === 'income' ? '+' : '−';

      const main = document.createElement('div');
      main.className = 'finance-item-main';

      const amount = document.createElement('span');
      amount.className = 'finance-item-amount';
      amount.textContent = formatMoney(item.amount);

      const meta = document.createElement('span');
      meta.className = 'finance-item-meta';
      const parts = [item.category, item.note].filter(Boolean);
      meta.textContent = parts.join(' · ') || (item.type === 'income' ? '收入' : '支出');

      main.append(amount, meta);

      const del = document.createElement('button');
      del.className = 'icon-btn';
      del.title = '删除';
      del.textContent = '×';
      del.addEventListener('click', async () => {
        const result = await window.plotBetter.deleteTransaction(item.id, currentFinanceMonth());
        state.financeHistory = result.history;
        renderFinanceHistory(result.history);
        renderFinanceSummary(result.summary);
      });

      row.append(mark, main, del);
      section.appendChild(row);
    });

    els.financeHistory.appendChild(section);
  });
}

async function loadFinance() {
  const yearMonth = currentFinanceMonth();
  const [history, summary] = await Promise.all([
    window.plotBetter.getTransactions(yearMonth),
    window.plotBetter.getMonthlySummary(yearMonth),
  ]);
  state.financeHistory = history;
  renderFinanceHistory(history);
  renderFinanceSummary(summary);
}

function initFinanceForm() {
  const today = new Date().toISOString().slice(0, 10);
  els.financeDate.value = today;
  els.financeMonth.value = today.slice(0, 7);

  document.getElementById('finance-type-expense')?.addEventListener('click', () => setFinanceType('expense'));
  document.getElementById('finance-type-income')?.addEventListener('click', () => setFinanceType('income'));

  els.financeMonth?.addEventListener('change', () => loadFinance());

  async function addTransactionFromForm() {
    const amount = Number(els.financeAmount.value);
    if (!Number.isFinite(amount) || amount <= 0) {
      els.financeAmount.focus();
      return;
    }
    const txnDate = els.financeDate.value || today;
    const result = await window.plotBetter.addTransaction({
      type: state.financeType,
      amount,
      category: els.financeCategory.value.trim(),
      note: els.financeNote.value.trim(),
      txnDate,
    });
    els.financeAmount.value = '';
    els.financeNote.value = '';
    state.financeHistory = result.history;
    renderFinanceHistory(result.history);
    renderFinanceSummary(result.summary);
    if (txnDate.slice(0, 7) !== currentFinanceMonth()) {
      els.financeMonth.value = txnDate.slice(0, 7);
      await loadFinance();
    }
  }

  document.getElementById('btn-add-transaction')?.addEventListener('click', addTransactionFromForm);
  els.financeNote?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addTransactionFromForm();
  });
  els.financeAmount?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addTransactionFromForm();
  });
}

// --- Recipes ---

const DEFAULT_RECIPE_FIELDS = [
  { label: 'Ingredients', value: '' },
  { label: 'Steps', value: '' },
  { label: 'Notes', value: '' },
];

function isStepsField(label) {
  const t = String(label || '').trim();
  return (
    t === 'Steps' ||
    t === 'Step' ||
    t === '步骤' ||
    /^步骤[\d]*$/.test(t) ||
    /^steps?$/i.test(t) ||
    /^step[\d]*$/i.test(t)
  );
}

function recipePreviewRows(recipe) {
  const fields = (recipe.fields || []).filter((f) => f.label || f.value);
  return fields.map((f) => {
    const row = document.createElement('div');
    const isSteps = isStepsField(f.label);
    row.className = isSteps
      ? 'recipe-preview-row recipe-preview-row--steps'
      : 'recipe-preview-row recipe-preview-row--compact';
    const label = f.label || 'Untitled';
    const text = f.value ? f.value.trim() : '(empty)';
    if (isSteps) {
      row.innerHTML = `<strong>${escapeHtml(label)}</strong><div class="recipe-preview-steps-body">${escapeHtml(text)}</div>`;
    } else {
      row.innerHTML = `<strong>${escapeHtml(label)}</strong>${escapeHtml(text.replace(/\s+/g, ' '))}`;
    }
    return row;
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function updateRecipeExpandSize() {
  if (!els.recipeScroll) return;
  const w = els.recipeScroll.clientWidth;
  const h = els.recipeScroll.clientHeight;
  const expandW = Math.max(280, Math.round(w * 0.78));
  const expandH = Math.max(320, Math.round(h * 0.82));
  els.recipeScroll.style.setProperty('--recipe-expand-w', `${expandW}px`);
  els.recipeScroll.style.setProperty('--recipe-expand-h', `${expandH}px`);
}

function clampExpandedCard(card) {
  const surface = card.querySelector('.recipe-card-surface');
  const scroll = els.recipeScroll;
  if (!surface || !scroll || card.classList.contains('recipe-card-add')) return;

  updateRecipeExpandSize();
  const expandW = parseInt(getComputedStyle(scroll).getPropertyValue('--recipe-expand-w'), 10) || 400;
  const expandH = parseInt(getComputedStyle(scroll).getPropertyValue('--recipe-expand-h'), 10) || 480;

  const scrollRect = scroll.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();

  const maxW = Math.min(expandW, scrollRect.width - 12);
  const maxH = Math.min(expandH, scrollRect.height - 12);

  let offsetLeft = 0;
  let offsetTop = 0;

  const overflowRight = cardRect.left + maxW - scrollRect.right;
  if (overflowRight > 0) {
    offsetLeft = -Math.min(overflowRight, cardRect.left - scrollRect.left);
  }

  const overflowBottom = cardRect.top + maxH - scrollRect.bottom;
  if (overflowBottom > 0) {
    offsetTop = -Math.min(overflowBottom, cardRect.top - scrollRect.top);
  }

  surface.style.width = `${maxW}px`;
  surface.style.height = `${maxH}px`;
  surface.style.left = `${offsetLeft}px`;
  surface.style.top = `${offsetTop}px`;
}

function resetExpandedCard(card) {
  const surface = card.querySelector('.recipe-card-surface');
  if (!surface) return;
  surface.style.width = '';
  surface.style.height = '';
  surface.style.left = '';
  surface.style.top = '';
}

function bindRecipeCardHover(card) {
  if (card.classList.contains('recipe-card-add')) return;
  card.addEventListener('mouseenter', () => clampExpandedCard(card));
  card.addEventListener('mouseleave', () => resetExpandedCard(card));
}

function createRecipeCard(recipe) {
  const card = document.createElement('article');
  card.className = 'recipe-card';
  card.dataset.id = String(recipe.id);

  const surface = document.createElement('div');
  surface.className = 'recipe-card-surface';

  const name = document.createElement('div');
  name.className = 'recipe-card-name';
  name.textContent = recipe.name;

  const preview = document.createElement('div');
  preview.className = 'recipe-card-preview';
  recipePreviewRows(recipe).forEach((row) => preview.appendChild(row));

  surface.appendChild(name);
  surface.appendChild(preview);
  card.appendChild(surface);

  card.addEventListener('click', () => openRecipeEditor(recipe.id));
  bindRecipeCardHover(card);
  return card;
}

function createRecipeAddCard() {
  const card = document.createElement('article');
  card.className = 'recipe-card recipe-card-add';

  const surface = document.createElement('div');
  surface.className = 'recipe-card-surface';
  surface.innerHTML =
    '<span class="recipe-add-icon">+</span><span class="recipe-add-label">Add recipe</span>';

  card.appendChild(surface);
  card.addEventListener('click', () => createAndOpenRecipe());
  return card;
}

function renderRecipeGrid(recipes) {
  if (!els.recipeGrid) return;
  els.recipeGrid.innerHTML = '';

  recipes.forEach((recipe) => {
    els.recipeGrid.appendChild(createRecipeCard(recipe));
  });
  els.recipeGrid.appendChild(createRecipeAddCard());

  if (els.recipeEmptyHint) {
    els.recipeEmptyHint.classList.toggle('hidden', recipes.length > 0);
  }
}

async function loadRecipes() {
  updateRecipeExpandSize();
  const recipes = await window.plotBetter.getRecipes();
  state.recipes = recipes;
  renderRecipeGrid(recipes);
}

async function createAndOpenRecipe() {
  const recipe = await window.plotBetter.addRecipe({
    name: 'New recipe',
    fields: DEFAULT_RECIPE_FIELDS.map((f) => ({ ...f })),
  });
  state.recipes = await window.plotBetter.getRecipes();
  renderRecipeGrid(state.recipes);
  openRecipeEditor(recipe.id);
}

function collectEditorFields() {
  const rows = els.recipeEditorFields.querySelectorAll('.recipe-field-row');
  return [...rows].map((row) => ({
    label: row.querySelector('.recipe-field-label')?.value.trim() || '',
    value: row.querySelector('.recipe-field-value')?.value ?? '',
  }));
}

function renderEditorFields(fields) {
  els.recipeEditorFields.innerHTML = '';
  const list = fields?.length ? fields : [{ label: '', value: '' }];

  list.forEach((field, index) => {
    const row = document.createElement('div');
    const steps = isStepsField(field.label);
    row.className = steps ? 'recipe-field-row recipe-field-row--steps' : 'recipe-field-row';

    const head = document.createElement('div');
    head.className = 'recipe-field-row-head';

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'recipe-field-label';
    labelInput.placeholder = index === 0 ? 'Ingredients' : index === 1 ? 'Steps' : 'Field name';
    labelInput.value = field.label || '';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'recipe-field-remove';
    removeBtn.title = 'Remove field';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      if (els.recipeEditorFields.querySelectorAll('.recipe-field-row').length <= 1) return;
      row.remove();
      requestAnimationFrame(() => syncStepsFieldHeight());
    });

    labelInput.addEventListener('input', () => {
      const nowSteps = isStepsField(labelInput.value);
      row.classList.toggle('recipe-field-row--steps', nowSteps);
      valueInput.classList.toggle('recipe-field-value--steps', nowSteps);
      requestAnimationFrame(() => syncStepsFieldHeight());
    });

    head.appendChild(labelInput);
    head.appendChild(removeBtn);

    const valueInput = document.createElement('textarea');
    valueInput.className = steps ? 'recipe-field-value recipe-field-value--steps' : 'recipe-field-value';
    valueInput.placeholder = steps
      ? 'Enter steps (multi-line)…'
      : index === 0
        ? 'Enter ingredients…'
        : 'Enter content…';
    valueInput.value = field.value || '';

    row.appendChild(head);
    row.appendChild(valueInput);
    els.recipeEditorFields.appendChild(row);
  });

  if (!els.recipeEditor.classList.contains('hidden')) {
    requestAnimationFrame(() => syncStepsFieldHeight());
  }
}

function syncStepsFieldHeight() {
  const panel = document.querySelector('.recipe-editor-panel');
  const fields = els.recipeEditorFields;
  if (!panel || !fields) return;

  const stepsRow = fields.querySelector('.recipe-field-row--steps');
  const textarea = stepsRow?.querySelector('.recipe-field-value--steps');
  if (!stepsRow || !textarea) return;

  const header = panel.querySelector('.recipe-editor-header');
  const addBtn = document.getElementById('btn-recipe-add-field');
  const panelStyle = getComputedStyle(panel);
  const padY =
    parseFloat(panelStyle.paddingTop) + parseFloat(panelStyle.paddingBottom);

  let othersHeight = 0;
  fields.querySelectorAll('.recipe-field-row:not(.recipe-field-row--steps)').forEach((row) => {
    othersHeight += row.offsetHeight;
  });
  othersHeight += Math.max(0, fields.children.length - 1) * 12;

  const reserved =
    (header?.offsetHeight || 0) +
    (addBtn?.offsetHeight || 0) +
    padY +
    36;
  const available = panel.clientHeight - reserved - othersHeight - stepsRow.querySelector('.recipe-field-row-head')?.offsetHeight - 24;
  const h = Math.max(160, available);
  textarea.style.height = `${h}px`;
}

function openRecipeEditor(id) {
  const recipe = state.recipes.find((r) => r.id === id);
  if (!recipe) return;

  state.editingRecipeId = id;
  els.recipeEditorName.value = recipe.name;
  renderEditorFields(recipe.fields);
  els.recipeEditor.classList.remove('hidden');
  els.recipeEditor.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => syncStepsFieldHeight());
  els.recipeEditorName.focus();
  els.recipeEditorName.select();
}

function closeRecipeEditor() {
  state.editingRecipeId = null;
  els.recipeEditor.classList.add('hidden');
  els.recipeEditor.setAttribute('aria-hidden', 'true');
}

async function saveRecipeEditor() {
  if (!state.editingRecipeId) return;
  const name = els.recipeEditorName.value.trim() || 'Untitled';
  const fields = collectEditorFields();
  await window.plotBetter.updateRecipe(state.editingRecipeId, { name, fields });
  state.recipes = await window.plotBetter.getRecipes();
  renderRecipeGrid(state.recipes);
  closeRecipeEditor();
}

async function deleteRecipeEditor() {
  if (!state.editingRecipeId) return;
  if (!confirm('Delete this recipe?')) return;
  state.recipes = await window.plotBetter.deleteRecipe(state.editingRecipeId);
  renderRecipeGrid(state.recipes);
  closeRecipeEditor();
}

function initRecipes() {
  document.getElementById('btn-recipe-save')?.addEventListener('click', () => saveRecipeEditor());
  document.getElementById('btn-recipe-close')?.addEventListener('click', () => closeRecipeEditor());
  document.getElementById('btn-recipe-delete')?.addEventListener('click', () => deleteRecipeEditor());
  document.querySelector('.recipe-editor-backdrop')?.addEventListener('click', () => closeRecipeEditor());
  document.getElementById('btn-recipe-add-field')?.addEventListener('click', () => {
    const fields = collectEditorFields();
    fields.push({ label: '', value: '' });
    renderEditorFields(fields);
    requestAnimationFrame(() => syncStepsFieldHeight());
    const rows = els.recipeEditorFields.querySelectorAll('.recipe-field-row');
    rows[rows.length - 1]?.querySelector('.recipe-field-label')?.focus();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.recipeEditor.classList.contains('hidden')) {
      closeRecipeEditor();
    }
  });

  window.addEventListener('resize', () => {
    updateRecipeExpandSize();
    if (!els.recipeEditor.classList.contains('hidden')) syncStepsFieldHeight();
  });
}

// --- Topics ---

function renderTopics(topics) {
  els.topicList.innerHTML = '';
  fillTopicSelects(topics);

  if (topics.length === 0) {
    els.topicsEmpty.classList.remove('hidden');
    return;
  }
  els.topicsEmpty.classList.add('hidden');

  topics.forEach((topic) => {
    const parsed = state.daily?.topics?.find(
      (t) => t.name.toLowerCase() === topic.name.toLowerCase()
    );
    const lineIndex = parsed?.lineIndex;
    const li = document.createElement('li');
    li.className = 'topic-item';

    const name = document.createElement('span');
    name.textContent = topic.name;

    const right = document.createElement('div');
    right.style.display = 'flex';
    right.style.alignItems = 'center';
    right.style.gap = '10px';

    const badge = document.createElement('span');
    badge.className = 'level-badge';
    const pct = (topic.level / 5) * 100;
    badge.innerHTML = `
      Level ${topic.level}/5
      <span class="level-bar"><span class="level-fill" style="width:${pct}%"></span></span>
    `;

    const del = document.createElement('button');
    del.className = 'icon-btn';
    del.title = 'Remove topic';
    del.textContent = '×';
    del.addEventListener('click', async () => {
      if (lineIndex === undefined) return;
      const updated = await window.plotBetter.deleteTopic(lineIndex);
      applyDailyUpdate(updated);
    });

    right.append(badge, del);
    li.append(name, right);
    els.topicList.appendChild(li);
  });
}

document.getElementById('btn-add-topic').addEventListener('click', addTopicFromInput);
els.newTopicInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addTopicFromInput();
});

async function addTopicFromInput() {
  const name = els.newTopicInput.value.trim();
  if (!name) return;
  const updated = await window.plotBetter.addTopic(name);
  els.newTopicInput.value = '';
  applyDailyUpdate(updated);
}

function fillTopicSelects(topics) {
  [els.paperTopic, els.quizTopic].forEach((select) => {
    const prev = select.value;
    select.innerHTML = '';
    topics.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.name;
      opt.textContent = t.name;
      select.appendChild(opt);
    });
    if (prev && topics.some((t) => t.name === prev)) select.value = prev;
  });
}

function applyDailyUpdate(daily, { syncEditor = true, history = null } = {}) {
  state.daily = daily;
  renderTodayTasks(daily);
  if (history) {
    state.taskHistory = history;
    renderTaskHistory(history);
  }
  updateTasksDashboard();
  if (syncEditor) loadEditorContent(daily.content);
  window.plotBetter.getTopics().then((topics) => {
    state.topics = topics;
    renderTopics(topics);
  });
}

// --- Paper ---

function formatPaperDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  });
}

function paperSourceLabel(source) {
  if (source === 'manual') return 'Manually assigned';
  if (source === 'continued') return 'Continued reading';
  return 'Recommended for you';
}

function paperReadStatusLabel(status) {
  if (status === 'done') return 'Finished';
  if (status === 'in_progress') return 'In progress';
  return 'Unread';
}

function hidePaperResumeBanner() {
  els.paperResumeBanner?.classList.add('hidden');
}

function showPaperResumeBanner(candidate) {
  if (!els.paperResumeBanner || !candidate) return;
  els.paperResumeTitle.textContent = candidate.title || 'Unfinished paper';
  const dateLabel = formatPaperDate(candidate.pushedAt);
  const status = paperReadStatusLabel(candidate.readStatus);
  els.paperResumeDesc.textContent = `From ${dateLabel} · ${status} · arXiv:${candidate.arxivId}. Continue where you left off?`;
  els.paperResumeBanner.classList.remove('hidden');
}

function renderPaperCard(paper) {
  state.currentPaper = paper;
  els.paperTitle.textContent = paper.title;
  els.paperAuthors.textContent = paper.authors;
  els.paperWhy.textContent = paper.whyRelevant;
  els.paperAbstract.textContent = paper.displayAbstract;

  els.paperTakeaways.innerHTML = '';
  const ul = document.createElement('ul');
  (paper.takeaways || []).forEach((t) => {
    const li = document.createElement('li');
    li.textContent = t;
    ul.appendChild(li);
  });
  els.paperTakeaways.appendChild(ul);

  if (els.paperLabel) {
    els.paperLabel.textContent = paperSourceLabel(paper.source);
  }
  if (els.paperReadBadge) {
    const status = paper.readStatus || 'unread';
    els.paperReadBadge.textContent = paperReadStatusLabel(status);
    els.paperReadBadge.className = `paper-read-badge status-${status}`;
    els.paperReadBadge.classList.remove('hidden');
  }
  if (els.paperDateLine) {
    if (paper.pushedAt) {
      const readNote = paper.lastReadAt ? ` · Last opened ${formatPaperDate(paper.lastReadAt.slice(0, 10))}` : '';
      els.paperDateLine.textContent = `Assigned for ${formatPaperDate(paper.pushedAt)} · arXiv:${paper.arxivId}${readNote}`;
      els.paperDateLine.classList.remove('hidden');
    } else {
      els.paperDateLine.classList.add('hidden');
    }
  }

  updateZoteroPaperUi(paper);
  els.paperCard.classList.remove('hidden');
  hidePaperResumeBanner();

  if (paper.arxivId && paper.readStatus !== 'done') {
    const topicName = els.paperTopic.value;
    window.plotBetter.markPaperReading(topicName, paper.arxivId, 'in_progress').catch(() => {});
  }
}

async function refreshPaperPanel() {
  const topicName = els.paperTopic.value;
  if (!topicName) return;

  try {
    const hint = await window.plotBetter.getPaperResumeHint(topicName);
    if (hint.hasTodayPaper) {
      hidePaperResumeBanner();
      await loadPaper({ skipResumeCheck: true });
      return;
    }
    if (hint.shouldPrompt && hint.continueCandidate) {
      showPaperResumeBanner(hint.continueCandidate);
      els.paperCard.classList.add('hidden');
      return;
    }
    hidePaperResumeBanner();
  } catch (err) {
    console.warn('[paper resume]', err);
    hidePaperResumeBanner();
  }
}

async function loadPaper({ forceNew = false, skipResumeCheck = false } = {}) {
  const topicName = els.paperTopic.value;
  if (!topicName) return;

  if (!skipResumeCheck && !forceNew) {
    const hint = await window.plotBetter.getPaperResumeHint(topicName);
    if (hint.shouldPrompt && hint.continueCandidate) {
      showPaperResumeBanner(hint.continueCandidate);
      return;
    }
  }

  els.paperError.classList.add('hidden');
  els.paperCard.classList.add('hidden');
  els.paperLoading.classList.remove('hidden');

  try {
    const paper = await window.plotBetter.getTodayPaper(
      topicName,
      forceNew ? { forceNew: true } : undefined
    );
    renderPaperCard(paper);
  } catch (err) {
    els.paperError.textContent = err.message || String(err);
    els.paperError.classList.remove('hidden');
  } finally {
    els.paperLoading.classList.add('hidden');
  }
}

document.getElementById('btn-load-paper').addEventListener('click', () => loadPaper());
document.getElementById('btn-continue-paper')?.addEventListener('click', async () => {
  const topicName = els.paperTopic.value;
  if (!topicName) return;
  els.paperError.classList.add('hidden');
  els.paperLoading.classList.remove('hidden');
  try {
    const paper = await window.plotBetter.continuePaper(topicName);
    renderPaperCard(paper);
  } catch (err) {
    els.paperError.textContent = err.message || String(err);
    els.paperError.classList.remove('hidden');
  } finally {
    els.paperLoading.classList.add('hidden');
  }
});
document.getElementById('btn-new-paper-today')?.addEventListener('click', () => loadPaper({ forceNew: true, skipResumeCheck: true }));
document.getElementById('btn-assign-paper')?.addEventListener('click', async () => {
  const topicName = els.paperTopic.value;
  const arxivInput = els.paperArxivInput?.value?.trim();
  const targetDate = els.paperAssignDate?.value || 'today';
  if (!topicName || !arxivInput) {
    els.paperError.textContent = 'Enter an arXiv ID or URL.';
    els.paperError.classList.remove('hidden');
    return;
  }
  els.paperError.classList.add('hidden');
  els.paperLoading.classList.remove('hidden');
  try {
    const paper = await window.plotBetter.assignPaper(topicName, arxivInput, targetDate);
    renderPaperCard(paper);
    if (els.paperArxivInput) els.paperArxivInput.value = '';
  } catch (err) {
    els.paperError.textContent = err.message || String(err);
    els.paperError.classList.remove('hidden');
  } finally {
    els.paperLoading.classList.add('hidden');
  }
});
els.paperArxivInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-assign-paper')?.click();
});
els.paperTopic?.addEventListener('change', () => refreshPaperPanel());
document.getElementById('btn-open-paper').addEventListener('click', () => {
  if (!state.currentPaper?.url) return;
  const topicName = els.paperTopic.value;
  if (topicName && state.currentPaper.arxivId) {
    window.plotBetter.markPaperReading(topicName, state.currentPaper.arxivId, 'in_progress').catch(() => {});
  }
  window.plotBetter.openExternal(state.currentPaper.url);
});

function updateZoteroPaperUi(paper) {
  els.paperZoteroMsg.classList.add('hidden');
  if (paper.canOpenInZotero) {
    els.btnOpenZotero.classList.remove('hidden');
    els.btnOpenZotero.disabled = false;
    els.btnOpenZotero.textContent = 'View PDF in Zotero';
    els.paperZoteroHint.classList.remove('hidden');
    const folder = paper.dailyPaperFolder || paper.dailyPaperCollection || 'daily_paper';
    els.paperZoteroHint.innerHTML = `下载 PDF（以论文标题命名）到 <code>data/${folder}</code>，并在 Zotero 中打开。默认以 <strong>Stored</strong> 写入 Zotero storage（可跨设备同步）；大文件可能需要数分钟。`;
  } else {
    els.btnOpenZotero.classList.add('hidden');
    els.paperZoteroHint.classList.add('hidden');
  }
}

els.btnOpenZotero.addEventListener('click', async () => {
  if (!state.currentPaper) return;
  const topicName = els.paperTopic.value;
  if (topicName && state.currentPaper.arxivId) {
    window.plotBetter.markPaperReading(topicName, state.currentPaper.arxivId, 'in_progress').catch(() => {});
  }
  els.btnOpenZotero.disabled = true;
  els.btnOpenZotero.textContent = 'Downloading 0%...';
  els.paperZoteroMsg.classList.add('hidden');

  const onProgress = (progress) => {
    if (progress.cached) {
      els.btnOpenZotero.textContent = 'Opening cached PDF...';
      return;
    }
    if (progress.stage === 'link') {
      els.btnOpenZotero.textContent = 'Preparing in Zotero...';
      return;
    }
    if (progress.stage === 'open') {
      els.btnOpenZotero.textContent = 'Opening...';
      return;
    }
    if (progress.percent != null) {
      els.btnOpenZotero.textContent = `Downloading ${progress.percent}%...`;
    } else {
      els.btnOpenZotero.textContent = 'Downloading...';
    }
  };
  window.plotBetter.onZoteroOpenProgress(onProgress);

  try {
    const result = await window.plotBetter.zoteroOpenPaper(state.currentPaper);
    els.paperZoteroMsg.textContent = result.message || 'Opened in Zotero.';
    els.paperZoteroMsg.classList.remove('hidden');
    els.btnOpenZotero.textContent = 'PDF opened ✓';
  } catch (err) {
    els.paperZoteroMsg.textContent = err.message || String(err);
    els.paperZoteroMsg.classList.remove('hidden');
    els.btnOpenZotero.disabled = false;
    els.btnOpenZotero.textContent = 'View PDF in Zotero';
  }
});

document.querySelectorAll('.rate-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const topicName = els.paperTopic.value;
    if (!topicName) return;
    const result = await window.plotBetter.ratePaper(topicName, btn.dataset.rate);
    state.topics = await window.plotBetter.getTopics();
    renderTopics(state.topics);
    btn.textContent = btn.dataset.rate === 'just_right' ? 'Saved ✓' : `${btn.textContent.replace(/ ✓$/, '')} ✓`;
    if (result?.zoteroResult) {
      els.paperZoteroMsg.textContent = result.zoteroResult.ok
        ? result.zoteroResult.message
        : `Zotero: ${result.zoteroResult.message}`;
      els.paperZoteroMsg.classList.remove('hidden');
    }
    if (state.currentPaper) {
      state.currentPaper.readStatus = 'done';
      renderPaperCard(state.currentPaper);
    }
  });
});

// --- Quiz ---

async function loadQuiz() {
  const topicName = els.quizTopic.value;
  if (!topicName) return;

  els.quizEmpty.classList.add('hidden');
  els.quizResult.classList.add('hidden');
  state.selectedQuizIndex = null;

  try {
    const q = await window.plotBetter.getQuiz(topicName);
    state.currentQuiz = q;
    els.quizHint.textContent = q.topicHint;
    els.quizQuestion.textContent = q.question;
    els.quizOptions.innerHTML = '';

    q.options.forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.className = 'quiz-option';
      btn.textContent = `${String.fromCharCode(65 + idx)}. ${opt}`;
      btn.addEventListener('click', () => selectQuizOption(idx, btn));
      els.quizOptions.appendChild(btn);
    });

    els.quizCard.classList.remove('hidden');
  } catch (err) {
    els.quizResult.textContent = err.message;
    els.quizResult.className = 'quiz-result bad';
    els.quizResult.classList.remove('hidden');
  }
}

function selectQuizOption(idx, btnEl) {
  state.selectedQuizIndex = idx;
  document.querySelectorAll('.quiz-option').forEach((b) => b.classList.remove('selected'));
  btnEl.classList.add('selected');
  submitQuiz();
}

async function submitQuiz() {
  const topicName = els.quizTopic.value;
  const q = state.currentQuiz;
  if (!q || state.selectedQuizIndex === null) return;

  const logQuestion = q.questionEn || q.question;
  const result = await window.plotBetter.submitQuiz(
    topicName,
    logQuestion,
    state.selectedQuizIndex,
    q.answer
  );

  els.quizResult.classList.remove('hidden');
  if (result.correct) {
    els.quizResult.textContent = `Correct! Your level is now ${result.topic.level}/5.`;
    els.quizResult.className = 'quiz-result ok';
  } else {
    els.quizResult.textContent = `Not quite. Correct answer: ${String.fromCharCode(65 + q.answer)}. Level is now ${result.topic.level}/5.`;
    els.quizResult.className = 'quiz-result bad';
  }

  state.topics = await window.plotBetter.getTopics();
  renderTopics(state.topics);
}

document.getElementById('btn-load-quiz').addEventListener('click', loadQuiz);

// --- Settings ---

function toggleZoteroOptions(show) {
  els.zoteroOptions.classList.toggle('hidden', !show);
}

function renderSettings(config) {
  const z = config.zotero || {};
  const w = config.widget || {};
  if (els.setAutoLaunch) {
    els.setAutoLaunch.checked = Boolean(config.autoLaunch);
    refreshAutoLaunchStatus();
  }
  if (els.setWidgetEdge) els.setWidgetEdge.value = w.edge === 'left' ? 'left' : 'right';
  if (els.setQuizLanguage) {
    const lang = config.quizLanguage || 'auto';
    els.setQuizLanguage.value = ['auto', 'bi-ch&en', 'eng-only'].includes(lang) ? lang : 'auto';
  }
  els.setZoteroEnabled.checked = Boolean(z.enabled);
  els.setZoteroSkip.checked = z.skipLibraryItems !== false;
  els.setZoteroAuto.checked = Boolean(z.autoAddOnJustRight);
  if (els.setZoteroLinkOpen) els.setZoteroLinkOpen.checked = z.linkOnOpen !== false;
  if (els.setZoteroAttachmentMode) {
    els.setZoteroAttachmentMode.value = z.attachmentMode === 'linked' ? 'linked' : 'stored';
  }
  els.setZoteroUserId.value = z.userId || '';
  els.setZoteroApiKey.value = z.apiKey || '';
  els.setZoteroDataDir.value = z.dataDir || '';
  els.setZoteroCollection.value = z.dailyPaperCollection || 'daily_paper';
  toggleZoteroOptions(Boolean(z.enabled));
}

els.setZoteroEnabled.addEventListener('change', () => {
  toggleZoteroOptions(els.setZoteroEnabled.checked);
});

async function refreshAutoLaunchStatus() {
  if (!els.autoLaunchStatus) return;
  try {
    const info = await window.plotBetter.getAutoLaunchInfo();
    if (info.systemActive) {
      els.autoLaunchStatus.textContent = '系统自启动：已启用';
      els.autoLaunchStatus.className = 'field-hint ok';
    } else if (els.setAutoLaunch?.checked) {
      els.autoLaunchStatus.textContent = '配置已开启，但系统未注册成功。请取消勾选再重新勾选。';
      els.autoLaunchStatus.className = 'field-hint bad';
    } else {
      els.autoLaunchStatus.textContent = '系统自启动：未启用';
      els.autoLaunchStatus.className = 'field-hint muted';
    }
  } catch {
    els.autoLaunchStatus.textContent = '';
  }
}

async function saveAutoLaunchSetting() {
  state.config = await window.plotBetter.saveConfig({
    autoLaunch: els.setAutoLaunch?.checked === true,
  });
  renderSettings(state.config);
}

if (els.setAutoLaunch) {
  els.setAutoLaunch.addEventListener('change', () => {
    saveAutoLaunchSetting().catch((err) => {
      if (els.autoLaunchStatus) {
        els.autoLaunchStatus.textContent = err.message || String(err);
        els.autoLaunchStatus.className = 'field-hint bad';
      }
    });
  });
}

document.getElementById('link-zotero-keys').addEventListener('click', (e) => {
  e.preventDefault();
  window.plotBetter.openExternal('https://www.zotero.org/settings/keys');
});

document.getElementById('btn-browse-zotero').addEventListener('click', async () => {
  const dir = await window.plotBetter.pickZoteroDir();
  if (dir) els.setZoteroDataDir.value = dir;
});

function collectZoteroSettings() {
  return {
    enabled: els.setZoteroEnabled.checked,
    skipLibraryItems: els.setZoteroSkip.checked,
    autoAddOnJustRight: els.setZoteroAuto.checked,
    linkOnOpen: els.setZoteroLinkOpen?.checked !== false,
    attachmentMode: els.setZoteroAttachmentMode?.value === 'linked' ? 'linked' : 'stored',
    userId: els.setZoteroUserId.value.trim(),
    apiKey: els.setZoteroApiKey.value.trim(),
    dataDir: els.setZoteroDataDir.value.trim(),
    dailyPaperCollection: els.setZoteroCollection.value.trim() || 'daily_paper',
  };
}

document.getElementById('btn-save-settings').addEventListener('click', async () => {
  state.config = await window.plotBetter.saveConfig({
    autoLaunch: els.setAutoLaunch?.checked === true,
    widget: { edge: els.setWidgetEdge?.value === 'left' ? 'left' : 'right' },
    quizLanguage: els.setQuizLanguage?.value || 'auto',
    zotero: collectZoteroSettings(),
  });
  renderSettings(state.config);
  els.settingsSaved.classList.remove('hidden');
  setTimeout(() => els.settingsSaved.classList.add('hidden'), 2500);
});

document.getElementById('btn-test-zotero').addEventListener('click', async () => {
  await window.plotBetter.saveConfig({ zotero: collectZoteroSettings() });
  els.zoteroTestResult.classList.remove('hidden');
  els.zoteroTestResult.textContent = 'Testing...';
  try {
    const report = await window.plotBetter.zoteroTest();
    const lines = [];
    if (report.localLibrary) {
      if (report.localLibrary.ok) {
        lines.push(
          `Local library: OK (${report.localLibrary.arxivItems} arXiv items)\n  ${report.localLibrary.path}`
        );
      } else if (report.localLibrary.optional) {
        lines.push(`Local library: skipped (optional)`);
        if (report.localLibrary.hint) lines.push(`  ${report.localLibrary.hint}`);
        else if (report.localLibrary.path) {
          lines.push(`  ${report.localLibrary.path} — ${report.localLibrary.error}`);
        }
      } else {
        lines.push(
          `Local library: Failed — ${report.localLibrary.error}\n  ${report.localLibrary.path}`
        );
      }
    }
    if (report.api) {
      lines.push(
        report.api.ok
          ? `Zotero API: OK (${report.api.arxivItems} arXiv-related items scanned)`
          : `Zotero API: ${report.api.error}`
      );
    }
    if (report.collection) {
      lines.push(
        report.collection.ok
          ? `Collection "${report.collection.name}": OK`
          : `Collection "${report.collection.name}": ${report.collection.error}`
      );
    }
    if (report.localApi) {
      lines.push(
        report.localApi.ok
          ? `Local API: OK — ${report.localApi.hint}`
          : `Local API: 未就绪 — ${report.localApi.hint}`
      );
    }
    if (report.zoteroRunning === false) {
      lines.push('Zotero: 未运行（请先打开 Zotero 再测试跳转）');
    }
    lines.push(`\nTotal arXiv IDs usable for dedup: ~${report.arxivCount}`);
    els.zoteroTestResult.textContent = lines.join('\n');
  } catch (err) {
    els.zoteroTestResult.textContent = err.message || String(err);
  }
});

async function loadAll() {
  state.daily = await window.plotBetter.getDaily();
  renderTodayTasks(state.daily);
  updateTasksDashboard();
  loadEditorContent(state.daily.content);
  initWidget();

  Promise.all([
    window.plotBetter.getTopics(),
    loadTaskHistory(),
    loadBacklogTasks(),
    window.plotBetter.getConfig(),
  ]).then(([topics, , , config]) => {
    state.topics = topics;
    state.config = config;
    renderTopics(topics);
    renderSettings(config);
    if (topics.length > 0) {
      refreshPaperPanel().catch(() => {});
    }
  });

  initFinanceForm();
  initRecipes();
}

function applyWidgetState(state) {
  const root = document.getElementById('widget-root');
  const pinBtn = document.getElementById('btn-widget-pin');
  if (!root) return;

  const mode = state.mode || 'docked';
  const edge = state.edge === 'left' ? 'left' : 'right';
  const visualMode = mode === 'expanding' || mode === 'collapsing' ? mode : mode;

  widgetUiMode = mode === 'expanded' || mode === 'expanding' ? 'expanded' : 'docked';
  root.className = `widget-root ${visualMode} edge-${edge}`;
  document.body.className = `widget ${visualMode} edge-${edge}${state.pinned ? ' pinned' : ''}`;

  if (pinBtn) pinBtn.classList.toggle('pinned', Boolean(state.pinned));
}

let widgetUiMode = 'docked';

function initWidget() {
  const dockRail = document.getElementById('dock-rail');
  const appShell = document.getElementById('app-shell');
  const pinBtn = document.getElementById('btn-widget-pin');
  const dockBtn = document.getElementById('btn-widget-dock');

  window.plotBetter.onWidgetState(applyWidgetState);
  window.plotBetter.widgetGetState().then(applyWidgetState);

  const requestExpand = () => window.plotBetter.widgetExpand();
  const requestCollapse = () => {
    if (widgetUiMode !== 'expanded') return;
    window.plotBetter.widgetScheduleCollapse();
  };

  dockRail?.addEventListener('mouseenter', requestExpand);
  dockRail?.addEventListener('click', requestExpand);

  appShell?.addEventListener('mouseleave', (e) => {
    if (e.relatedTarget && appShell.contains(e.relatedTarget)) return;
    requestCollapse();
  });

  document.addEventListener('mouseleave', () => {
    requestCollapse();
  });

  pinBtn?.addEventListener('click', () => {
    window.plotBetter.widgetTogglePin();
  });

  dockBtn?.addEventListener('click', () => {
    window.plotBetter.widgetCollapse();
  });
}

window.plotBetter.onDailyUpdated((data) => {
  applyDailyUpdate(data, { syncEditor: !state.editorDirty });
});

window.plotBetter.onServicesReady(() => {
  Promise.all([
    window.plotBetter.getTopics(),
    loadTaskHistory(),
    loadBacklogTasks(),
  ]).then(([topics]) => {
    state.topics = topics;
    renderTopics(topics);
    updateTasksDashboard();
  });
});

loadAll().catch((err) => console.error('[loadAll]', err));
