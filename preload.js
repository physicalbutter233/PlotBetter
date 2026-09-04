const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('plotBetter', {
  getDaily: () => ipcRenderer.invoke('get-daily'),
  getTopics: () => ipcRenderer.invoke('get-topics'),
  completeTask: (lineIndex, expectedText) =>
    ipcRenderer.invoke('complete-task', lineIndex, expectedText),
  getTaskHistory: () => ipcRenderer.invoke('get-task-history'),
  deleteCompletedTask: (id) => ipcRenderer.invoke('delete-completed-task', id),
  getBacklogTasks: () => ipcRenderer.invoke('get-backlog-tasks'),
  addBacklogTask: (text) => ipcRenderer.invoke('add-backlog-task', text),
  updateBacklogTask: (id, text) => ipcRenderer.invoke('update-backlog-task', id, text),
  deleteBacklogTask: (id) => ipcRenderer.invoke('delete-backlog-task', id),
  completeBacklogTask: (id) => ipcRenderer.invoke('complete-backlog-task', id),
  moveBacklogToToday: (id) => ipcRenderer.invoke('move-backlog-to-today', id),
  addTransaction: (payload) => ipcRenderer.invoke('add-transaction', payload),
  deleteTransaction: (id, yearMonth) => ipcRenderer.invoke('delete-transaction', id, yearMonth),
  getTransactions: (yearMonth) => ipcRenderer.invoke('get-transactions', yearMonth),
  getMonthlySummary: (yearMonth) => ipcRenderer.invoke('get-monthly-summary', yearMonth),
  getRecipes: () => ipcRenderer.invoke('get-recipes'),
  getRecipe: (id) => ipcRenderer.invoke('get-recipe', id),
  addRecipe: (payload) => ipcRenderer.invoke('add-recipe', payload),
  updateRecipe: (id, payload) => ipcRenderer.invoke('update-recipe', id, payload),
  deleteRecipe: (id) => ipcRenderer.invoke('delete-recipe', id),
  saveDaily: (content) => ipcRenderer.invoke('save-daily', content),
  addTask: (text) => ipcRenderer.invoke('add-task', text),
  updateTask: (lineIndex, text) => ipcRenderer.invoke('update-task', lineIndex, text),
  deleteTask: (lineIndex) => ipcRenderer.invoke('delete-task', lineIndex),
  addTopic: (name) => ipcRenderer.invoke('add-topic', name),
  deleteTopic: (lineIndex) => ipcRenderer.invoke('delete-topic', lineIndex),
  openDaily: () => ipcRenderer.invoke('open-daily'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  getConfig: () => ipcRenderer.invoke('get-config'),
  getAutoLaunchInfo: () => ipcRenderer.invoke('get-auto-launch-info'),
  saveConfig: (partial) => ipcRenderer.invoke('save-config', partial),
  pickZoteroDir: () => ipcRenderer.invoke('pick-zotero-dir'),
  zoteroTest: () => ipcRenderer.invoke('zotero-test'),
  zoteroAddPaper: (paper) => ipcRenderer.invoke('zotero-add-paper', paper),
  zoteroOpenPaper: (paper) => ipcRenderer.invoke('zotero-open-paper', paper),
  getTodayPaper: (topicName, options) => ipcRenderer.invoke('get-today-paper', topicName, options),
  getPaperResumeHint: (topicName) => ipcRenderer.invoke('get-paper-resume-hint', topicName),
  continuePaper: (topicName) => ipcRenderer.invoke('continue-paper', topicName),
  assignPaper: (topicName, arxivInput, targetDate) =>
    ipcRenderer.invoke('assign-paper', topicName, arxivInput, targetDate),
  markPaperReading: (topicName, arxivId, readStatus) =>
    ipcRenderer.invoke('mark-paper-reading', topicName, arxivId, readStatus),
  ratePaper: (topicName, rating) => ipcRenderer.invoke('rate-paper', topicName, rating),
  getQuiz: (topicName) => ipcRenderer.invoke('get-quiz', topicName),
  submitQuiz: (topicName, question, selectedIndex, correctIndex) =>
    ipcRenderer.invoke('submit-quiz', topicName, question, selectedIndex, correctIndex),
  refreshDaily: () => ipcRenderer.invoke('refresh-daily'),
  onDailyUpdated: (callback) => {
    ipcRenderer.on('daily-updated', (_e, data) => callback(data));
  },
  onServicesReady: (callback) => {
    ipcRenderer.on('services-ready', () => callback());
  },
  onZoteroOpenProgress: (callback) => {
    ipcRenderer.on('zotero-open-progress', (_e, progress) => callback(progress));
  },
  widgetExpand: () => ipcRenderer.invoke('widget-expand'),
  widgetCollapse: () => ipcRenderer.invoke('widget-collapse'),
  widgetScheduleCollapse: () => ipcRenderer.invoke('widget-schedule-collapse'),
  widgetTogglePin: () => ipcRenderer.invoke('widget-toggle-pin'),
  widgetGetState: () => ipcRenderer.invoke('widget-get-state'),
  onWidgetState: (callback) => {
    ipcRenderer.on('widget-state', (_e, state) => callback(state));
  },
});
