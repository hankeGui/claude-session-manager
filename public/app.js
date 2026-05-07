const state = {
  projects: [],
  currentProject: null,
  sessions: [],
  selected: new Set(),
  sortField: 'modified',
  sortOrder: 'desc',
};

// DOM elements
const projectList = document.getElementById('project-list');
const sessionList = document.getElementById('session-list');
const contentTitle = document.getElementById('content-title');
const batchActions = document.getElementById('batch-actions');
const selectedCount = document.getElementById('selected-count');
const statsBadge = document.getElementById('stats-badge');
const searchInput = document.getElementById('search-input');
const sortField = document.getElementById('sort-field');
const sortOrder = document.getElementById('sort-order');
const filterEmpty = document.getElementById('filter-empty');
const modalOverlay = document.getElementById('modal-overlay');
const confirmOverlay = document.getElementById('confirm-overlay');

// Init
document.addEventListener('DOMContentLoaded', () => {
  loadProjects();
  loadStats();

  document.getElementById('btn-refresh').addEventListener('click', () => {
    loadProjects();
    loadStats();
  });
  document.getElementById('btn-select-all').addEventListener('click', selectAll);
  document.getElementById('btn-select-empty').addEventListener('click', selectEmpty);
  document.getElementById('btn-ai-rename-selected').addEventListener('click', batchAutoRename);
  document.getElementById('btn-delete-selected').addEventListener('click', deleteSelected);
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('confirm-cancel').addEventListener('click', closeConfirm);

  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  sortField.addEventListener('change', () => {
    state.sortField = sortField.value;
    sortAndRender();
  });
  sortOrder.addEventListener('change', () => {
    state.sortOrder = sortOrder.value;
    sortAndRender();
  });

  let searchTimeout;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(doSearch, 300);
  });
  filterEmpty.addEventListener('change', () => {
    if (state.currentProject) {
      loadSessions(state.currentProject);
    } else {
      doSearch();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
      closeConfirm();
    }
  });
});

async function loadStats() {
  const res = await fetch('/api/stats');
  const data = await res.json();
  statsBadge.textContent = `${data.totalProjects} projects | ${data.totalSessions} sessions | ${data.emptySessions} empty`;
}

async function loadProjects() {
  const res = await fetch('/api/projects');
  const data = await res.json();
  state.projects = data.projects;
  renderProjects();
}

function renderProjects() {
  projectList.innerHTML = '';

  // "All" option
  const allLi = document.createElement('li');
  allLi.innerHTML = `<span class="project-name">All Projects</span><span class="project-count">${state.projects.reduce((s, p) => s + p.sessionCount, 0)}</span>`;
  allLi.addEventListener('click', () => {
    state.currentProject = null;
    document.querySelectorAll('#project-list li').forEach(l => l.classList.remove('active'));
    allLi.classList.add('active');
    searchInput.value = '';
    doSearch();
  });
  projectList.appendChild(allLi);

  for (const project of state.projects) {
    if (project.sessionCount === 0) continue;
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="project-name" title="${project.projectPath}">${project.displayName}</span>
      <span class="project-count">${project.sessionCount}${project.emptyCount ? ' / ' + project.emptyCount + ' empty' : ''}</span>
    `;
    li.addEventListener('click', () => {
      state.currentProject = project.dirName;
      document.querySelectorAll('#project-list li').forEach(l => l.classList.remove('active'));
      li.classList.add('active');
      searchInput.value = '';
      loadSessions(project.dirName);
    });
    projectList.appendChild(li);
  }
}

async function loadSessions(dirName) {
  const empty = filterEmpty.value;
  let url = `/api/projects/${encodeURIComponent(dirName)}/sessions?`;
  if (empty) url += `empty=${empty}&`;

  const res = await fetch(url);
  const data = await res.json();
  state.sessions = data.sessions.map(s => ({ ...s, projectPath: data.projectPath || '' }));
  state.selected.clear();
  contentTitle.textContent = data.displayName;
  batchActions.classList.remove('hidden');
  sortSessions();
  renderSessions();
}

async function doSearch() {
  const q = searchInput.value.trim();
  const empty = filterEmpty.value;

  let url = `/api/search?`;
  if (q) url += `q=${encodeURIComponent(q)}&`;
  if (empty) url += `empty=${empty}&`;
  if (state.currentProject) url += `project=${encodeURIComponent(state.currentProject)}&`;

  const res = await fetch(url);
  const data = await res.json();
  state.sessions = data.results;
  state.selected.clear();
  contentTitle.textContent = q ? `Search: "${q}" (${data.total} results)` : `All Sessions (${data.total})`;
  batchActions.classList.remove('hidden');
  sortSessions();
  renderSessions();
}

async function deepSearch(q) {
  const btn = document.getElementById('btn-deep-search');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Searching...';
  }
  showToast('AI deep searching sessions...', 'info');

  try {
    const res = await fetch('/api/search/deep', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(`AI search failed: ${data.error || 'Unknown error'}`, 'error');
      return;
    }
    state.sessions = data.results;
    state.selected.clear();
    contentTitle.textContent = `AI Search: "${q}" (${data.total} results)`;
    batchActions.classList.remove('hidden');
    sortSessions();
    renderSessions();
    showToast(`AI found ${data.total} matching session(s)`, 'success');
  } catch (err) {
    showToast(`AI search failed: ${err.message}`, 'error');
  }
}

function sortAndRender() {
  sortSessions();
  renderSessions();
}

function sortSessions() {
  const field = state.sortField;
  const desc = state.sortOrder === 'desc';
  state.sessions.sort((a, b) => {
    let cmp = 0;
    if (field === 'modified' || field === 'created') {
      cmp = (a[field] || '').localeCompare(b[field] || '');
    } else {
      cmp = (a[field] || 0) - (b[field] || 0);
    }
    return desc ? -cmp : cmp;
  });
}

function renderSessions() {
  sessionList.innerHTML = '';
  updateSelectedCount();

  if (state.sessions.length === 0) {
    const q = searchInput.value.trim();
    if (q) {
      sessionList.innerHTML = `
        <div style="padding: 20px; text-align: center;">
          <p style="color: var(--text-muted); margin-bottom: 12px;">No sessions found for "${escapeHtml(q)}"</p>
          <button id="btn-deep-search" class="btn-auto-rename">AI Deep Search</button>
        </div>
      `;
      document.getElementById('btn-deep-search').addEventListener('click', () => deepSearch(q));
    } else {
      sessionList.innerHTML = '<p style="color: var(--text-muted); padding: 20px;">No sessions found.</p>';
    }
    return;
  }

  for (const session of state.sessions) {
    const card = document.createElement('div');
    card.className = `session-card${session.isEmpty ? ' empty' : ''}`;
    card.innerHTML = `
      <input type="checkbox" class="session-checkbox" data-id="${session.sessionId}" ${state.selected.has(session.sessionId) ? 'checked' : ''}>
      <div class="session-info">
        <div class="session-summary">
          ${session.isEmpty ? '<span class="badge badge-empty">Empty</span> ' : ''}
          ${session.customTitle ? `<span class="custom-title">${escapeHtml(session.customTitle)}</span>` : escapeHtml(session.summary || session.firstPrompt || 'No summary')}
        </div>
        ${session.customTitle ? `<div class="session-prompt">${escapeHtml(session.summary || session.firstPrompt || '')}</div>` : `<div class="session-prompt">${escapeHtml(session.firstPrompt || '')}</div>`}
        <div class="session-meta">
          <span>${session.messageCount} msgs</span>
          <span>${formatSize(session.diskSize)}</span>
          <span>${formatDate(session.modified)}</span>
          ${session.gitBranch ? `<span class="badge badge-branch">${escapeHtml(session.gitBranch)}</span>` : ''}
          ${session.projectDisplayName ? `<span>${escapeHtml(session.projectDisplayName)}</span>` : ''}
        </div>
      </div>
      <div class="session-actions">
        <button class="btn-auto-rename" data-id="${session.sessionId}" title="AI auto rename">AI</button>
        <button class="btn-rename" data-id="${session.sessionId}" title="Manual rename">Rename</button>
        <button class="btn-resume" data-id="${session.sessionId}" title="Resume in terminal">Resume</button>
        <button class="btn-view" data-id="${session.sessionId}">View</button>
        <button class="btn-del danger" data-id="${session.sessionId}">Del</button>
      </div>
    `;

    const checkbox = card.querySelector('.session-checkbox');
    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      if (checkbox.checked) {
        state.selected.add(session.sessionId);
      } else {
        state.selected.delete(session.sessionId);
      }
      updateSelectedCount();
    });

    card.querySelector('.btn-auto-rename').addEventListener('click', (e) => {
      e.stopPropagation();
      autoRenameSession(session, card.querySelector('.btn-auto-rename'));
    });

    card.querySelector('.btn-rename').addEventListener('click', (e) => {
      e.stopPropagation();
      renameSession(session);
    });

    card.querySelector('.btn-resume').addEventListener('click', (e) => {
      e.stopPropagation();
      const cwd = session.projectPath || '~';
      const baseCmd = `cd ${cwd} && claude --resume ${session.sessionId}`;
      const dangerCmd = `cd ${cwd} && claude --dangerously-skip-permissions --resume ${session.sessionId}`;
      confirmAction(null, () => {
        const checkbox = document.getElementById('confirm-skip-permissions');
        const skip = checkbox && checkbox.checked;
        return resumeSession(session.sessionId, skip);
      }, {
        okText: 'Resume',
        okClass: '',
        html: `<div class="confirm-title">Resume Session</div>
               <div class="confirm-session-name">${escapeHtml(session.customTitle || session.summary || session.firstPrompt || 'Untitled')}</div>
               <div class="confirm-cmd"><code id="confirm-cmd-text">${escapeHtml(baseCmd)}</code></div>
               <label class="confirm-option"><input type="checkbox" id="confirm-skip-permissions"> --dangerously-skip-permissions</label>`,
      });
      // Update command preview when checkbox changes
      setTimeout(() => {
        const cb = document.getElementById('confirm-skip-permissions');
        const cmdEl = document.getElementById('confirm-cmd-text');
        if (cb && cmdEl) {
          cb.addEventListener('change', () => {
            cmdEl.textContent = cb.checked ? dangerCmd : baseCmd;
          });
        }
      }, 0);
    });

    card.querySelector('.btn-view').addEventListener('click', (e) => {
      e.stopPropagation();
      openSessionDetail(session.sessionId);
    });

    card.querySelector('.btn-del').addEventListener('click', (e) => {
      e.stopPropagation();
      confirmAction(`Delete this session?\n\n"${session.summary || session.firstPrompt || session.sessionId}"`, async () => {
        try {
          const res = await fetch(`/api/sessions/${session.sessionId}`, { method: 'DELETE' });
          const result = await res.json();
          if (!res.ok || !result.success) {
            showToast(`Delete failed: ${result.error || 'Unknown error'}`, 'error');
            return;
          }
          state.sessions = state.sessions.filter(s => s.sessionId !== session.sessionId);
          state.selected.delete(session.sessionId);
          renderSessions();
          loadStats();
          loadProjects();
          showToast(`Deleted session (freed ${formatSize(result.freedBytes)})`, 'success');
        } catch (err) {
          showToast(`Delete failed: ${err.message}`, 'error');
        }
      }, { okText: 'Delete', okClass: 'danger' });
    });

    sessionList.appendChild(card);
  }
}

function selectAll() {
  const allSelected = state.selected.size === state.sessions.length;
  state.selected.clear();
  if (!allSelected) {
    for (const s of state.sessions) {
      state.selected.add(s.sessionId);
    }
  }
  renderSessions();
}

function selectEmpty() {
  state.selected.clear();
  for (const s of state.sessions) {
    if (s.isEmpty) state.selected.add(s.sessionId);
  }
  renderSessions();
}

function deleteSelected() {
  if (state.selected.size === 0) return;
  confirmAction(`Delete ${state.selected.size} selected session(s)? This cannot be undone.`, async () => {
    const ids = [...state.selected];
    try {
      const res = await fetch('/api/sessions/batch-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionIds: ids }),
      });
      const result = await res.json();
      if (!res.ok) {
        showToast(`Batch delete failed: ${result.error || 'Unknown error'}`, 'error');
        return;
      }
      const deletedSet = new Set(result.deleted);
      state.sessions = state.sessions.filter(s => !deletedSet.has(s.sessionId));
      state.selected.clear();
      renderSessions();
      loadStats();
      loadProjects();
      const msg = `Deleted ${result.deleted.length} session(s), freed ${formatSize(result.totalFreedBytes)}`;
      if (result.errors.length > 0) {
        showToast(`${msg}. ${result.errors.length} failed.`, 'warning');
      } else {
        showToast(msg, 'success');
      }
    } catch (err) {
      showToast(`Batch delete failed: ${err.message}`, 'error');
    }
  }, { okText: 'Delete', okClass: 'danger' });
}

async function batchAutoRename() {
  if (state.selected.size === 0) return;
  const sessions = state.sessions.filter(s => state.selected.has(s.sessionId));
  showToast(`AI renaming ${sessions.length} session(s)...`, 'info');

  let success = 0;
  let failed = 0;
  for (const session of sessions) {
    try {
      const res = await fetch(`/api/sessions/${session.sessionId}/auto-rename`, { method: 'POST' });
      const result = await res.json();
      if (res.ok && result.success) {
        session.customTitle = result.title;
        success++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }
  renderSessions();
  showToast(`AI renamed ${success} session(s)${failed ? `, ${failed} failed` : ''}`, success ? 'success' : 'error');
}

async function autoRenameSession(session, btn) {
  btn.disabled = true;
  btn.textContent = '...';
  try {
    const res = await fetch(`/api/sessions/${session.sessionId}/auto-rename`, { method: 'POST' });
    const result = await res.json();
    if (!res.ok || !result.success) {
      showToast(`Auto rename failed: ${result.error || 'Unknown error'}`, 'error');
      return;
    }
    session.customTitle = result.title;
    renderSessions();
    showToast(`Renamed: "${result.title}"`, 'success');
  } catch (err) {
    showToast(`Auto rename failed: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'AI';
  }
}

async function renameSession(session) {
  const currentTitle = session.customTitle || session.summary || session.firstPrompt || '';
  const newTitle = prompt('Enter a custom title for this session:', currentTitle);
  if (newTitle === null) return; // cancelled

  try {
    const res = await fetch(`/api/sessions/${session.sessionId}/title`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle }),
    });
    const result = await res.json();
    if (!res.ok || !result.success) {
      showToast(`Rename failed: ${result.error || 'Unknown error'}`, 'error');
      return;
    }
    session.customTitle = newTitle;
    renderSessions();
    showToast('Title updated', 'success');
  } catch (err) {
    showToast(`Rename failed: ${err.message}`, 'error');
  }
}

async function resumeSession(sessionId, skipPermissions = false) {
  try {
    const res = await fetch(`/api/sessions/${sessionId}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skipPermissions }),
    });
    const result = await res.json();
    if (!res.ok || !result.success) {
      showToast(`Failed to resume: ${result.error || 'Unknown error'}`, 'error');
      return;
    }
    showToast(`Opened in ${result.terminal}${skipPermissions ? ' (skip permissions)' : ''} — cd ${result.cwd}`, 'success');
  } catch (err) {
    showToast(`Failed to resume: ${err.message}`, 'error');
  }
}

let modalMessages = [];

async function openSessionDetail(sessionId) {
  const res = await fetch(`/api/sessions/${sessionId}/messages?limit=500`);
  const data = await res.json();

  document.getElementById('modal-title').textContent = data.session.summary || data.session.firstPrompt || 'Session Detail';
  document.getElementById('modal-meta').innerHTML = `
    <span>Project: ${escapeHtml(data.project.displayName)}</span>
    <span>Branch: ${escapeHtml(data.session.gitBranch || 'N/A')}</span>
    <span>Messages: ${data.total}</span>
    <span>Created: ${formatDate(data.session.created)}</span>
    <span>Modified: ${formatDate(data.session.modified)}</span>
    <span>Size: ${formatSize(data.session.diskSize)}</span>
  `;

  modalMessages = data.messages;

  // Setup toolbar buttons
  const btnAll = document.getElementById('btn-show-all');
  const btnUser = document.getElementById('btn-show-user');
  btnAll.className = 'active';
  btnUser.className = '';
  btnAll.onclick = () => { btnAll.className = 'active'; btnUser.className = ''; renderModalMessages('all'); };
  btnUser.onclick = () => { btnUser.className = 'active'; btnAll.className = ''; renderModalMessages('user'); };

  renderModalMessages('all');

  modalOverlay.classList.remove('hidden');
}

function renderModalMessages(filter) {
  const messagesEl = document.getElementById('modal-messages');
  messagesEl.innerHTML = '';

  const msgs = filter === 'user'
    ? modalMessages.filter(m => m.type === 'user')
    : modalMessages;

  document.getElementById('modal-msg-count').textContent = `Showing ${msgs.length} of ${modalMessages.length}`;

  if (msgs.length === 0) {
    messagesEl.innerHTML = '<p style="color: var(--text-muted);">No messages.</p>';
    return;
  }

  for (const msg of msgs) {
    const div = document.createElement('div');
    const cleanedContent = cleanMessageContent(msg.content || '');
    const hasContent = cleanedContent.trim().length > 0;
    const isUser = msg.type === 'user';

    div.className = `message message-${msg.type}`;

    if (isUser) {
      if (!hasContent) {
        // Skip empty user messages entirely
        continue;
      } else {
        div.innerHTML = `
          <div class="message-role">User ${msg.timestamp ? '- ' + formatDate(msg.timestamp) : ''}</div>
          <div class="message-content">${escapeHtml(cleanedContent)}</div>
        `;
      }
    } else {
      const isLong = cleanedContent.length > 500;
      const toolsHtml = msg.toolCalls
        ? `<div class="message-tools">Tools: ${msg.toolCalls.map(t => t.name).join(', ')}</div>`
        : '';

      if (!hasContent && msg.toolCalls) {
        div.innerHTML = `
          <div class="message-role">Assistant ${msg.timestamp ? '- ' + formatDate(msg.timestamp) : ''}</div>
          ${toolsHtml}
        `;
      } else if (!hasContent && !msg.toolCalls) {
        // Skip completely empty assistant messages
        continue;
      } else {
        div.innerHTML = `
          <div class="message-role">Assistant ${msg.timestamp ? '- ' + formatDate(msg.timestamp) : ''}</div>
          <div class="message-content ${isLong ? 'collapsed' : ''}">${escapeHtml(cleanedContent)}</div>
          ${isLong ? '<button class="btn-expand">Show more</button>' : ''}
          ${toolsHtml}
        `;
      }
    }

    messagesEl.appendChild(div);
  }

  messagesEl.querySelectorAll('.btn-expand').forEach(btn => {
    btn.addEventListener('click', () => {
      const content = btn.previousElementSibling;
      content.classList.toggle('collapsed');
      btn.textContent = content.classList.contains('collapsed') ? 'Show more' : 'Show less';
    });
  });
}

function closeModal() {
  modalOverlay.classList.add('hidden');
}

// Confirm dialog
let confirmCallback = null;

function confirmAction(text, callback, { okText = 'Confirm', okClass = '', html = '' } = {}) {
  const textEl = document.getElementById('confirm-text');
  if (html) {
    textEl.innerHTML = html;
  } else {
    textEl.textContent = text;
  }
  const okBtn = document.getElementById('confirm-ok');
  okBtn.textContent = okText;
  okBtn.className = okClass || '';
  confirmCallback = callback;
  confirmOverlay.classList.remove('hidden');
  okBtn.onclick = async () => {
    const cb = confirmCallback;
    confirmCallback = null;
    confirmOverlay.classList.add('hidden');
    if (cb) await cb();
  };
}

function closeConfirm() {
  confirmOverlay.classList.add('hidden');
  confirmCallback = null;
}

// Helpers
function updateSelectedCount() {
  selectedCount.textContent = state.selected.size;
  const btn = document.getElementById('btn-select-all');
  btn.textContent = (state.selected.size === state.sessions.length && state.sessions.length > 0) ? 'Unselect All' : 'Select All';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function truncateContent(text) {
  if (!text) return '';
  if (text.length > 2000) return text.substring(0, 2000) + '\n... (truncated)';
  return text;
}

function cleanMessageContent(text) {
  if (!text) return '';
  // Remove XML-like system tags and their content
  return text
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '')
    .replace(/<command-name>([\s\S]*?)<\/command-name>/g, '/$1')
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, '')
    .replace(/<command-args>[\s\S]*?<\/command-args>/g, '')
    .replace(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/g, '→ $1')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<[\s\S]*?<\/antml:[^>]*>/g, '')
    .replace(/<\/?antml:[^>]*>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Toast notifications
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  // Trigger animation
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
