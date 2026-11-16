const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const loginScreen = $('#loginScreen');
const appHeader = $('#appHeader');
const workspace = $('#workspace');
const taskPage = $('#taskPage');
const loginForm = $('#loginForm');
const loginMessage = $('#loginMessage');
const syncStatus = $('#syncStatus');
const taskSyncStatus = $('#taskSyncStatus');
const taskIdFromPath = location.pathname.match(/^\/tasks\/([^/]+)\/?$/)?.[1] || null;

let token = localStorage.getItem('edgekanban-token') || '';
let currentUser = null;
let boards = [];
let currentBoard = null;
let chatHistory = [];
let draggedTaskId = null;
let aiStatusChecked = false;
let invitationToken = new URLSearchParams(location.search).get('invite') ||
  location.pathname.match(/^\/invite\/([^/]+)\/?$/)?.[1] || '';
let refreshTimer = null;

function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function setMessage(node, text, isError = false) {
  node.textContent = text || '';
  node.classList.toggle('is-error', isError);
  node.hidden = !text;
}

function setSync(message, error = false) {
  syncStatus.textContent = message;
  syncStatus.classList.toggle('is-error', error);
}

function setTaskSync(message, error = false) {
  taskSyncStatus.textContent = message;
  taskSyncStatus.classList.toggle('is-error', error);
}

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, {
    ...options,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  let result = {};
  try {
    result = await response.json();
  } catch {
    if (response.ok) return {};
  }
  if (!response.ok) {
    if (response.status === 401 && token) {
      token = '';
      localStorage.removeItem('edgekanban-token');
      showLogin();
    }
    throw new Error(result.error || `A solicitação falhou (${response.status}).`);
  }
  return result;
}

function showLogin() {
  clearInterval(refreshTimer);
  currentUser = null;
  currentBoard = null;
  appHeader.hidden = true;
  workspace.hidden = true;
  taskPage.hidden = true;
  loginScreen.hidden = false;
}

function saveSession(session) {
  token = session.token;
  currentUser = session.user;
  localStorage.setItem('edgekanban-token', token);
}

function setAuthenticatedView() {
  loginScreen.hidden = true;
  appHeader.hidden = false;
  $('#accountEmail').textContent = currentUser.email;
  if (taskIdFromPath) {
    workspace.hidden = true;
    taskPage.hidden = false;
  } else {
    workspace.hidden = false;
    taskPage.hidden = true;
  }
}

async function startApp() {
  setAuthenticatedView();
  let invitationError = '';
  if (invitationToken) {
    try {
      await api('/api/invitations/accept', { method: 'POST', body: { token: invitationToken } });
      invitationToken = '';
      history.replaceState(null, '', '/');
    } catch (error) {
      invitationError = error.message;
    }
  }
  if (taskIdFromPath) {
    await loadTaskPage(true);
    if (invitationError) setTaskSync(invitationError, true);
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      if (!taskPage.hidden && !$('.task-detail').contains(document.activeElement)) loadTaskPage(false);
    }, 5000);
    return;
  }
  try {
    await loadBoards();
  } catch (error) {
    setSync(error.message, true);
  }
  if (invitationError) setSync(invitationError, true);
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (currentBoard && !workspace.hidden) refreshBoard();
  }, 5000);
}

function setAuthMode(create) {
  $('#loginTitle').textContent = create ? 'Comece por aqui.' : 'Seu espaço de trabalho.';
  $('#authDescription').textContent = create
    ? 'Crie sua conta para organizar e compartilhar seus quadros.'
    : 'Entre para acessar seus quadros.';
  $('#authSubmit').textContent = create ? 'Criar conta' : 'Entrar';
  $('#authModeToggle').textContent = create ? 'Já tenho uma conta' : 'Criar uma conta';
  $('#passwordInput').autocomplete = create ? 'new-password' : 'current-password';
  loginForm.dataset.mode = create ? 'create' : 'login';
  setMessage(loginMessage, '');
}

loginForm.addEventListener('input', () => setMessage(loginMessage, ''));
loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!loginForm.reportValidity()) return;
  const endpoint = loginForm.dataset.mode === 'create' ? '/api/auth/register' : '/api/auth/login';
  const button = $('#authSubmit');
  button.disabled = true;
  try {
    const result = await api(endpoint, {
      method: 'POST',
      body: {
        email: $('#emailInput').value.trim().toLowerCase(),
        password: $('#passwordInput').value
      }
    });
    saveSession(result);
    await startApp();
  } catch (error) {
    setMessage(loginMessage, error.message, true);
  } finally {
    button.disabled = false;
  }
});

$('#authModeToggle').addEventListener('click', () => {
  setAuthMode(loginForm.dataset.mode !== 'create');
});

$('#logoutBtn').addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch (error) {
    setSync(error.message, true);
  } finally {
    token = '';
    localStorage.removeItem('edgekanban-token');
    showLogin();
  }
});

async function loadBoards(selectId = '') {
  const result = await api('/api/boards');
  boards = result.boards;
  renderBoardLists();
  const rememberedId = selectId || localStorage.getItem('edgekanban-board') || currentBoard?.id;
  const selected = boards.find(board => board.id === rememberedId) || boards[0];
  if (selected) await loadBoard(selected.id);
  else setSync('Crie seu primeiro quadro para começar.');
}

function renderBoardLists() {
  const myBoards = $('#myBoards');
  const sharedBoards = $('#sharedBoards');
  myBoards.replaceChildren();
  sharedBoards.replaceChildren();
  for (const board of boards) {
    const button = element('button', `board-link${board.id === currentBoard?.id ? ' is-active' : ''}`, board.name);
    button.type = 'button';
    button.addEventListener('click', () => loadBoard(board.id));
    (board.shared ? sharedBoards : myBoards).append(button);
  }
  if (!myBoards.childElementCount) myBoards.append(element('p', 'sidebar-empty', 'Nenhum quadro próprio'));
  if (!sharedBoards.childElementCount) sharedBoards.append(element('p', 'sidebar-empty', 'Nenhum quadro compartilhado'));
}

async function loadBoard(boardId) {
  setSync('Carregando quadro…');
  try {
    const result = await api(`/api/boards/${encodeURIComponent(boardId)}`);
    currentBoard = result.board;
    localStorage.setItem('edgekanban-board', boardId);
    $('#boardTitle').textContent = currentBoard.name;
    $('#boardRole').textContent = currentBoard.role === 'OWNER'
      ? 'DONO DO QUADRO'
      : currentBoard.role === 'EDITOR' ? 'EDITOR' : 'LEITOR';
    $('#openShare').hidden = currentBoard.role !== 'OWNER';
    $('#openColumns').hidden = currentBoard.role === 'VIEWER';
    $('#openModal').hidden = currentBoard.role === 'VIEWER';
    $('#createSprint').hidden = currentBoard.role === 'VIEWER';
    renderBoardLists();
    renderBoard();
    renderBacklog();
    if (!$('#activityView').hidden) await loadBoardActivity();
    setSync('Sincronizado');
  } catch (error) {
    setSync(error.message, true);
  }
}

async function refreshBoard() {
  if (!currentBoard) return;
  try {
    const result = await api(`/api/boards/${encodeURIComponent(currentBoard.id)}`);
    if (result.board.id !== currentBoard.id) return;
    currentBoard = result.board;
    $('#boardTitle').textContent = currentBoard.name;
    renderBoard();
    renderBacklog();
    renderBoardLists();
  } catch (error) {
    setSync(error.message, true);
  }
}

function renderBoard() {
  if (!currentBoard) return;
  const board = $('#board');
  board.replaceChildren();
  const canEdit = currentBoard.role !== 'VIEWER';
  for (const column of currentBoard.columns) {
    const tasks = currentBoard.tasks.filter(task => task.status === column.id);
    const section = element('section', 'column');
    section.dataset.columnId = column.id;
    section.style.setProperty('--column-color', column.position % 3 === 1 ? '#687cff' : column.position % 3 === 2 ? '#7e9eb9' : '#18d8e6');
    const header = element('div', 'column-head');
    const heading = element('h2', '', column.name);
    const countWrap = element('div', 'column-count-wrap');
    const count = element('span', 'count', String(tasks.length));
    countWrap.append(count);
    if (column.wipLimit) {
      const limit = element('span', `wip-label${tasks.length > column.wipLimit ? ' is-over' : ''}`, `WIP ${column.wipLimit}`);
      countWrap.append(limit);
    }
    header.append(heading, countWrap);
    const list = element('div', 'cards');
    list.dataset.columnId = column.id;
    if (!tasks.length) list.append(element('div', 'empty', 'Arraste uma tarefa para esta coluna.'));
    for (const task of tasks) list.append(cardElement(task, canEdit));
    section.append(header, list);

    section.addEventListener('dragover', event => {
      if (!draggedTaskId || !canEdit) return;
      event.preventDefault();
      section.classList.add('drag-over');
    });
    section.addEventListener('dragleave', event => {
      if (!section.contains(event.relatedTarget)) section.classList.remove('drag-over');
    });
    section.addEventListener('drop', event => {
      event.preventDefault();
      section.classList.remove('drag-over');
      if (draggedTaskId && canEdit) moveTask(draggedTaskId, column.id);
    });
    board.append(section);
  }
  board.style.gridTemplateColumns = `repeat(${Math.min(currentBoard.columns.length, 4)}, minmax(250px, 1fr))`;
}

function cardElement(task, canEdit) {
  const card = element('article', 'card');
  card.dataset.taskId = task.id;
  card.draggable = canEdit;
  const titleLink = element('a', 'card-title-link', task.title);
  titleLink.href = `/tasks/${encodeURIComponent(task.id)}`;
  titleLink.target = '_blank';
  titleLink.rel = 'noopener';
  titleLink.setAttribute('aria-label', `Abrir tarefa em nova aba: ${task.title}`);
  card.append(titleLink);
  if (task.description) card.append(element('p', 'card-description', task.description));

  const metadata = element('div', 'card-metadata');
  if (task.priority === 'high') metadata.append(element('span', 'priority-badge is-high', 'Alta'));
  else if (task.priority === 'low') metadata.append(element('span', 'priority-badge is-low', 'Baixa'));
  for (const label of task.labels) {
    const chip = element('span', 'label-chip', label.name);
    chip.style.setProperty('--label-color', label.color);
    metadata.append(chip);
  }
  if (task.dueDate) metadata.append(element('span', 'task-date', `Prazo ${formatDate(task.dueDate)}`));
  if (task.assigneeEmail) metadata.append(element('span', 'assignee-chip', task.assigneeEmail));
  if (task.storyPoints !== null && task.storyPoints !== undefined) {
    metadata.append(element('span', 'story-points', `${task.storyPoints} pts`));
  }
  if (metadata.childElementCount) card.append(metadata);

  const footer = element('div', 'card-foot');
  footer.append(element('span', 'task-date', formatDate(task.createdAt)));
  if (canEdit) {
    const remove = element('button', 'btn-del', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Excluir tarefa: ${task.title}`);
    remove.addEventListener('click', () => deleteTask(task.id));
    footer.append(remove);
  }
  card.append(footer);
  if (canEdit) {
    card.addEventListener('dragstart', event => {
      draggedTaskId = task.id;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', task.id);
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => {
      draggedTaskId = null;
      card.classList.remove('dragging');
      $$('.drag-over').forEach(column => column.classList.remove('drag-over'));
    });
  }
  return card;
}

function formatDate(value) {
  if (!value) return '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00`)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

async function moveTask(taskId, status) {
  try {
    await api(`/api/tasks/${encodeURIComponent(taskId)}`, { method: 'PATCH', body: { status } });
    await refreshBoard();
    setSync('Tarefa movida');
  } catch (error) {
    setSync(error.message, true);
  }
}

async function deleteTask(taskId) {
  if (!confirm('Excluir esta tarefa e seus comentários?')) return;
  try {
    await api(`/api/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
    await refreshBoard();
    setSync('Tarefa excluída');
  } catch (error) {
    setSync(error.message, true);
  }
}

function selectedLabels(root) {
  return $$('input[type="checkbox"]:checked', root).map(input => input.value);
}

function renderLabelChoices(root, selected = [], disabled = false) {
  root.replaceChildren();
  for (const label of currentBoard.labels) {
    const choice = element('label', 'label-choice');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = label.name;
    input.checked = selected.includes(label.name);
    input.disabled = disabled;
    const chip = element('span', 'label-chip', label.name);
    chip.style.setProperty('--label-color', label.color);
    choice.append(input, chip);
    root.append(choice);
  }
}

$('#openModal').addEventListener('click', () => {
  if (!currentBoard || currentBoard.role === 'VIEWER') return;
  $('#taskForm').reset();
  populateAssigneeSelect($('#newAssignee'), '', false);
  renderLabelChoices($('#newLabels'));
  $('#modal').showModal();
  $('#titleInput').focus();
});
$('#cancelBtn').addEventListener('click', () => $('#modal').close());
$('#modal').addEventListener('click', event => {
  if (event.target === $('#modal')) $('#modal').close();
});
$('#taskForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('button[type="submit"]', event.currentTarget);
  button.disabled = true;
  try {
    await api(`/api/boards/${encodeURIComponent(currentBoard.id)}/tasks`, {
      method: 'POST',
      body: {
        title: $('#titleInput').value.trim(),
        description: $('#descInput').value.trim(),
        priority: $('#newPriority').value,
        dueDate: $('#newDueDate').value || null,
        assigneeId: $('#newAssignee').value || null,
        labels: selectedLabels($('#newLabels'))
      }
    });
    $('#modal').close();
    await refreshBoard();
  } catch (error) {
    setSync(error.message, true);
  } finally {
    button.disabled = false;
  }
});

function populateAssigneeSelect(select, selectedId, includeAll = true) {
  select.replaceChildren();
  select.append(new Option(includeAll ? 'Qualquer membro' : 'Sem responsável', ''));
  for (const member of currentBoard.members) {
    select.append(new Option(member.email, member.id, false, member.id === selectedId));
  }
}

function renderBacklog() {
  if (!currentBoard) return;
  const sprints = $('#sprintList');
  const backlog = $('#backlogList');
  sprints.replaceChildren();
  backlog.replaceChildren();
  const canEdit = currentBoard.role !== 'VIEWER';
  const backlogTasks = currentBoard.tasks.filter(task => !task.sprintId);
  $('#backlogCount').textContent = String(backlogTasks.length);
  if (!backlogTasks.length) backlog.append(element('p', 'sidebar-empty', 'O backlog está vazio.'));
  for (const task of backlogTasks) backlog.append(scrumTaskRow(task, canEdit));

  if (!currentBoard.sprints.length) {
    sprints.append(element('p', 'sidebar-empty', 'Ainda não há sprints.'));
    return;
  }
  for (const sprint of currentBoard.sprints) {
    const card = element('section', 'sprint-card');
    const header = element('div', 'sprint-card-head');
    const titleWrap = element('div');
    titleWrap.append(element('h3', '', sprint.name));
    titleWrap.append(element('p', 'task-date', [sprint.start_date, sprint.end_date].filter(Boolean).join(' → ')));
    header.append(titleWrap, element('span', `sprint-state is-${sprint.state.toLowerCase()}`, sprintStateName(sprint.state)));
    if (canEdit) {
      const controls = element('div', 'sprint-controls');
      if (sprint.state === 'PLANNED') controls.append(actionButton('Iniciar', () => updateSprint(sprint.id, { state: 'ACTIVE' })));
      if (sprint.state === 'ACTIVE') controls.append(actionButton('Concluir', () => updateSprint(sprint.id, { state: 'COMPLETED' })));
      controls.append(actionButton('Excluir', () => deleteSprint(sprint.id), 'text-button danger-text'));
      header.append(controls);
    }
    card.append(header);
    const tasks = currentBoard.tasks.filter(task => task.sprintId === sprint.id);
    if (!tasks.length) card.append(element('p', 'sidebar-empty', 'Nenhuma tarefa neste sprint.'));
    for (const task of tasks) card.append(scrumTaskRow(task, canEdit));
    sprints.append(card);
  }
}

function sprintStateName(state) {
  return { PLANNED: 'Planejado', ACTIVE: 'Ativo', COMPLETED: 'Concluído' }[state] || state;
}

function actionButton(text, action, className = 'btn-ghost') {
  const button = element('button', className, text);
  button.type = 'button';
  button.addEventListener('click', action);
  return button;
}

function scrumTaskRow(task, canEdit) {
  const row = element('article', 'backlog-task');
  const link = element('a', 'card-title-link', task.title);
  link.href = `/tasks/${encodeURIComponent(task.id)}`;
  link.target = '_blank';
  link.rel = 'noopener';
  row.append(link);
  if (task.storyPoints !== null && task.storyPoints !== undefined) {
    row.append(element('span', 'story-points', `${task.storyPoints} pts`));
  }
  if (canEdit) {
    const select = document.createElement('select');
    select.setAttribute('aria-label', `Sprint da tarefa ${task.title}`);
    select.append(new Option('Backlog', ''));
    for (const sprint of currentBoard.sprints) {
      select.append(new Option(`${sprint.name} (${sprintStateName(sprint.state)})`, sprint.id, false, sprint.id === task.sprintId));
    }
    select.value = task.sprintId || '';
    select.addEventListener('change', async () => {
      try {
        await api(`/api/tasks/${encodeURIComponent(task.id)}`, {
          method: 'PATCH', body: { sprintId: select.value || null }
        });
        await refreshBoard();
      } catch (error) {
        setSync(error.message, true);
      }
    });
    row.append(select);
  }
  return row;
}

$('#createSprint').addEventListener('click', () => {
  $('#sprintForm').reset();
  $('#sprintDialog').showModal();
});
$('#sprintForm').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await api(`/api/boards/${encodeURIComponent(currentBoard.id)}/sprints`, {
      method: 'POST',
      body: {
        name: $('#sprintName').value.trim(),
        startDate: $('#sprintStart').value || null,
        endDate: $('#sprintEnd').value || null,
        state: $('#sprintStartNow').checked ? 'ACTIVE' : 'PLANNED'
      }
    });
    $('#sprintDialog').close();
    await refreshBoard();
  } catch (error) {
    setSync(error.message, true);
  }
});

async function updateSprint(sprintId, body) {
  try {
    await api(`/api/boards/${encodeURIComponent(currentBoard.id)}/sprints/${encodeURIComponent(sprintId)}`, {
      method: 'PATCH', body
    });
    await refreshBoard();
  } catch (error) {
    setSync(error.message, true);
  }
}

async function deleteSprint(sprintId) {
  if (!confirm('Excluir este sprint? As tarefas voltarão ao backlog.')) return;
  try {
    await api(`/api/boards/${encodeURIComponent(currentBoard.id)}/sprints/${encodeURIComponent(sprintId)}`, {
      method: 'DELETE'
    });
    await refreshBoard();
  } catch (error) {
    setSync(error.message, true);
  }
}

$$('.view-tab').forEach(tab => tab.addEventListener('click', async () => {
  $$('.view-tab').forEach(item => {
    item.classList.toggle('is-active', item === tab);
    item.setAttribute('aria-selected', String(item === tab));
  });
  $('#kanbanView').hidden = tab.dataset.view !== 'kanban';
  $('#scrumView').hidden = tab.dataset.view !== 'scrum';
  $('#activityView').hidden = tab.dataset.view !== 'activity';
  if (tab.dataset.view === 'activity') await loadBoardActivity();
}));

async function loadBoardActivity() {
  if (!currentBoard) return;
  const list = $('#activityList');
  list.replaceChildren();
  try {
    const result = await api(`/api/boards/${encodeURIComponent(currentBoard.id)}/activity`);
    if (!result.activity.length) list.append(element('li', 'sidebar-empty', 'Ainda não há atividade.'));
    for (const item of result.activity) list.append(activityItem(item));
  } catch (error) {
    list.append(element('li', 'form-message is-error', error.message));
  }
}

function activityItem(item) {
  const row = element('li', 'activity-item');
  const details = item.details ? ` — ${item.details}` : '';
  row.append(element('p', '', `${item.actorEmail} ${activityLabel(item.action)}${details}`));
  row.append(element('time', 'task-date', new Date(item.createdAt).toLocaleString('pt-BR')));
  if (item.taskId) {
    const link = element('a', 'text-button', 'Abrir tarefa');
    link.href = `/tasks/${encodeURIComponent(item.taskId)}`;
    link.target = '_blank';
    link.rel = 'noopener';
    row.append(link);
  }
  return row;
}

function activityLabel(action) {
  return ({
    task_created: 'criou uma tarefa',
    task_moved: 'moveu uma tarefa',
    task_updated: 'atualizou uma tarefa',
    task_deleted: 'excluiu uma tarefa',
    comment_added: 'comentou em uma tarefa',
    checklist_item_added: 'adicionou uma subtarefa',
    columns_updated: 'atualizou as colunas',
    member_joined: 'entrou no quadro',
    member_invited: 'convidou uma pessoa',
    member_removed: 'removeu um membro',
    member_role_changed: 'alterou uma permissão',
    sprint_created: 'criou um sprint',
    sprint_updated: 'atualizou um sprint',
    sprint_deleted: 'removeu um sprint'
  })[action] || 'registrou uma atividade';
}

$('#createBoard').addEventListener('click', () => {
  $('#boardForm').reset();
  $('#boardDialog').showModal();
});
$('#boardForm').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const result = await api('/api/boards', {
      method: 'POST', body: { name: $('#boardNameInput').value.trim() }
    });
    $('#boardDialog').close();
    await loadBoards(result.board.id);
  } catch (error) {
    setSync(error.message, true);
  }
});

$('#openShare').addEventListener('click', () => {
  if (!currentBoard || currentBoard.role !== 'OWNER') return;
  $('#inviteForm').reset();
  $('#inviteUrl').value = '';
  $('#copyInvite').disabled = true;
  setMessage($('#inviteMessage'), '');
  renderMembers();
  $('#shareDialog').showModal();
});

function renderMembers() {
  const list = $('#memberList');
  list.replaceChildren();
  for (const member of currentBoard.members) {
    const row = element('li', 'member-row');
    const name = element('span', '', `${member.email}${member.role === 'OWNER' ? ' (dono)' : ''}`);
    row.append(name);
    if (member.role !== 'OWNER') {
      const role = document.createElement('select');
      role.setAttribute('aria-label', `Permissão de ${member.email}`);
      role.append(new Option('Editor', 'EDITOR', false, member.role === 'EDITOR'));
      role.append(new Option('Leitor', 'VIEWER', false, member.role === 'VIEWER'));
      role.addEventListener('change', async () => {
        try {
          await api(`/api/boards/${encodeURIComponent(currentBoard.id)}/members/${encodeURIComponent(member.id)}`, {
            method: 'PATCH', body: { role: role.value }
          });
          await refreshBoard();
          renderMembers();
        } catch (error) {
          setMessage($('#inviteMessage'), error.message, true);
        }
      });
      const remove = actionButton('Remover', async () => {
        if (!confirm(`Remover ${member.email} deste quadro?`)) return;
        try {
          await api(`/api/boards/${encodeURIComponent(currentBoard.id)}/members/${encodeURIComponent(member.id)}`, {
            method: 'DELETE'
          });
          await refreshBoard();
          renderMembers();
        } catch (error) {
          setMessage($('#inviteMessage'), error.message, true);
        }
      }, 'text-button danger-text');
      row.append(role, remove);
    }
    list.append(row);
  }
}

$('#inviteForm').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const result = await api(`/api/boards/${encodeURIComponent(currentBoard.id)}/invitations`, {
      method: 'POST',
      body: { email: $('#inviteEmail').value.trim(), role: $('#inviteRole').value }
    });
    if (result.memberAdded) {
      $('#inviteUrl').value = '';
      $('#copyInvite').disabled = true;
      await refreshBoard();
      renderMembers();
      setMessage($('#inviteMessage'), `Acesso de ${result.role === 'EDITOR' ? 'editor' : 'leitor'} concedido a ${result.email}.`);
    } else {
      $('#inviteUrl').value = result.invitationUrl;
      $('#copyInvite').disabled = false;
      setMessage($('#inviteMessage'), `Convite para ${result.email} criado. Expira em 7 dias; copie e envie o link.`);
    }
  } catch (error) {
    setMessage($('#inviteMessage'), error.message, true);
  }
});
$('#copyInvite').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#inviteUrl').value);
    setMessage($('#inviteMessage'), 'Link copiado. Envie-o para o e-mail convidado.');
  } catch {
    $('#inviteUrl').select();
    setMessage($('#inviteMessage'), 'Selecione e copie o link do convite.');
  }
});

$('#openColumns').addEventListener('click', () => {
  if (!currentBoard || currentBoard.role === 'VIEWER') return;
  renderColumnSettings();
  setMessage($('#columnsMessage'), '');
  $('#columnsDialog').showModal();
});

function renderColumnSettings() {
  const settings = $('#columnSettings');
  settings.replaceChildren();
  for (const column of currentBoard.columns) settings.append(columnSettingRow(column));
}

function columnSettingRow(column = { id: '', name: '', wipLimit: null }) {
  const row = element('div', 'column-setting-row');
  row.dataset.columnId = column.id;
  const name = document.createElement('input');
  name.value = column.name;
  name.maxLength = 40;
  name.required = true;
  name.placeholder = 'Nome da coluna';
  name.setAttribute('aria-label', 'Nome da coluna');
  const wip = document.createElement('input');
  wip.type = 'number';
  wip.min = '1';
  wip.max = '999';
  wip.placeholder = 'Sem limite';
  wip.value = column.wipLimit || '';
  wip.setAttribute('aria-label', `Limite WIP para ${column.name || 'nova coluna'}`);
  const moveUp = actionButton('↑', () => {
    const previous = row.previousElementSibling;
    if (previous) row.parentElement.insertBefore(row, previous);
  }, 'icon-button column-order');
  moveUp.setAttribute('aria-label', 'Mover coluna para cima');
  const moveDown = actionButton('↓', () => {
    const next = row.nextElementSibling;
    if (next) row.parentElement.insertBefore(next, row);
  }, 'icon-button column-order');
  moveDown.setAttribute('aria-label', 'Mover coluna para baixo');
  const remove = actionButton('Remover', () => row.remove(), 'text-button danger-text');
  row.append(name, wip, moveUp, moveDown, remove);
  return row;
}

$('#addColumn').addEventListener('click', () => {
  $('#columnSettings').append(columnSettingRow());
});
$('#columnsForm').addEventListener('submit', async event => {
  event.preventDefault();
  const columns = $$('.column-setting-row', $('#columnSettings')).map(row => {
    const [name, wip] = $$('input', row);
    return {
      id: row.dataset.columnId,
      name: name.value.trim(),
      wipLimit: wip.value ? Number(wip.value) : null
    };
  });
  try {
    const result = await api(`/api/boards/${encodeURIComponent(currentBoard.id)}/columns`, {
      method: 'PUT', body: { columns }
    });
    currentBoard.columns = result.columns;
    $('#columnsDialog').close();
    await refreshBoard();
  } catch (error) {
    setMessage($('#columnsMessage'), error.message, true);
  }
});

$$('[data-close-dialog]').forEach(button => button.addEventListener('click', () => {
  $(`#${button.dataset.closeDialog}`).close();
}));
$$('dialog').forEach(dialog => dialog.addEventListener('click', event => {
  if (event.target === dialog) dialog.close();
}));

async function loadTaskPage(showError) {
  try {
    setTaskSync('Carregando tarefa…');
    const result = await api(`/api/tasks/${encodeURIComponent(taskIdFromPath)}`);
    renderTaskDetails(result.task);
    setTaskSync('Sincronizado');
  } catch (error) {
    setTaskSync(error.message, true);
    if (showError) {
      $('#taskBoardName').textContent = 'Tarefa indisponível';
      $('#detailTitle').value = error.message;
      $('.task-detail').classList.add('is-unavailable');
    }
  }
}

function renderTaskDetails(task) {
  const root = $('.task-detail');
  currentBoard = {
    id: task.boardId,
    name: task.boardName,
    role: task.role,
    columns: task.columns,
    members: task.members,
    sprints: task.sprints,
    labels: task.boardLabels
  };
  root.classList.remove('is-unavailable');
  $('#taskBoardName').textContent = task.boardName;
  $('#taskBackLink').href = '/';
  $('#detailTitle').value = task.title;
  $('#detailDescription').value = task.description;
  $('#detailPriority').value = task.priority;
  $('#detailDueDate').value = task.dueDate || '';
  $('#detailStoryPoints').value = task.storyPoints ?? '';
  $('#detailAcceptance').value = task.acceptanceCriteria;
  $('#detailDod').value = task.definitionOfDone;
  const canEdit = task.role !== 'VIEWER';
  for (const control of $$('input, textarea, select, button', $('.task-detail-main'))) control.disabled = !canEdit;
  $('#commentInput').disabled = !canEdit;
  $('#commentForm').querySelector('button').disabled = !canEdit;
  $('#checklistInput').disabled = !canEdit;
  $('#checklistForm').querySelector('button').disabled = !canEdit;
  $('#generateChecklist').disabled = !canEdit;

  const status = $('#detailStatus');
  status.replaceChildren();
  for (const column of task.columns) status.append(new Option(column.name, column.id, false, task.status === column.id));
  populateAssigneeSelect($('#detailAssignee'), task.assigneeId, false);
  $('#detailAssignee').value = task.assigneeId || '';
  const sprintSelect = $('#detailSprint');
  sprintSelect.replaceChildren(new Option('Backlog', ''));
  for (const sprint of task.sprints) {
    sprintSelect.append(new Option(`${sprint.name} (${sprintStateName(sprint.state)})`, sprint.id));
  }
  sprintSelect.value = task.sprintId || '';
  $('#detailSprint').disabled = !canEdit;
  renderLabelChoices($('#detailLabels'), task.labels.map(label => label.name), !canEdit);
  renderChecklist(task);
  renderComments(task.comments, canEdit);
  renderActivityList($('#taskActivity'), task.activity);
  setMessage($('#detailSaveStatus'), '');
  for (const field of ['detailTitle', 'detailDescription', 'detailStatus', 'detailPriority', 'detailDueDate',
    'detailAssignee', 'detailStoryPoints', 'detailSprint', 'detailAcceptance', 'detailDod']) {
    const node = $(`#${field}`);
    if (node.dataset.bound === 'true') continue;
    node.dataset.bound = 'true';
    if (field === 'detailTitle' || field === 'detailDescription' || field === 'detailAcceptance' || field === 'detailDod') {
      node.addEventListener('blur', () => saveTaskField(field));
    } else node.addEventListener('change', () => saveTaskField(field));
  }
  $('#detailLabels').onchange = () => saveTaskField('detailLabels');
}

const taskFieldMap = {
  detailTitle: ['title', input => input.value.trim()],
  detailDescription: ['description', input => input.value],
  detailStatus: ['status', input => input.value],
  detailPriority: ['priority', input => input.value],
  detailDueDate: ['dueDate', input => input.value || null],
  detailAssignee: ['assigneeId', input => input.value || null],
  detailStoryPoints: ['storyPoints', input => input.value === '' ? null : Number(input.value)],
  detailSprint: ['sprintId', input => input.value || null],
  detailAcceptance: ['acceptanceCriteria', input => input.value],
  detailDod: ['definitionOfDone', input => input.value]
};

async function saveTaskField(field) {
  if (!token || taskPage.hidden) return;
  const body = field === 'detailLabels'
    ? { labels: selectedLabels($('#detailLabels')) }
    : { [taskFieldMap[field][0]]: taskFieldMap[field][1]($(`#${field}`)) };
  try {
    setMessage($('#detailSaveStatus'), 'Salvando…');
    await api(`/api/tasks/${encodeURIComponent(taskIdFromPath)}`, { method: 'PATCH', body });
    setMessage($('#detailSaveStatus'), 'Alterações salvas.');
  } catch (error) {
    setMessage($('#detailSaveStatus'), error.message, true);
  }
}

function renderChecklist(task) {
  const list = $('#checklist');
  list.replaceChildren();
  const done = task.checklist.filter(item => item.done).length;
  if (task.checklist.length) {
    const progress = element('li', 'checklist-progress', `${done} de ${task.checklist.length} concluídas`);
    list.append(progress);
  }
  if (!task.checklist.length) list.append(element('li', 'sidebar-empty', 'Adicione subtarefas para acompanhar o progresso.'));
  for (const item of task.checklist) {
    const row = element('li', 'checklist-item');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = item.done;
    checkbox.disabled = task.role === 'VIEWER';
    checkbox.setAttribute('aria-label', `Concluir ${item.text}`);
    checkbox.addEventListener('change', async () => {
      try {
        await api(`/api/tasks/${encodeURIComponent(task.id)}/checklist/${encodeURIComponent(item.id)}`, {
          method: 'PATCH', body: { done: checkbox.checked }
        });
        await loadTaskPage(false);
      } catch (error) {
        setTaskSync(error.message, true);
      }
    });
    row.append(checkbox, element('span', item.done ? 'is-complete' : '', item.text));
    if (task.role !== 'VIEWER') {
      row.append(actionButton('×', async () => {
        try {
          await api(`/api/tasks/${encodeURIComponent(task.id)}/checklist/${encodeURIComponent(item.id)}`, {
            method: 'DELETE'
          });
          await loadTaskPage(false);
        } catch (error) {
          setTaskSync(error.message, true);
        }
      }, 'btn-del'));
    }
    list.append(row);
  }
}

$('#checklistForm').addEventListener('submit', async event => {
  event.preventDefault();
  const input = $('#checklistInput');
  try {
    await api(`/api/tasks/${encodeURIComponent(taskIdFromPath)}/checklist`, {
      method: 'POST', body: { text: input.value.trim() }
    });
    input.value = '';
    await loadTaskPage(false);
  } catch (error) {
    setTaskSync(error.message, true);
  }
});

$('#generateChecklist').addEventListener('click', async () => {
  const button = $('#generateChecklist');
  button.disabled = true;
  button.textContent = 'Gerando…';
  try {
    const result = await api('/api/ai/checklist', {
      method: 'POST', body: { taskId: taskIdFromPath }
    });
    for (const text of result.items) {
      await api(`/api/tasks/${encodeURIComponent(taskIdFromPath)}/checklist`, {
        method: 'POST', body: { text }
      });
    }
    await loadTaskPage(false);
  } catch (error) {
    setTaskSync(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = 'Gerar com IA';
  }
});

function renderComments(comments, canEdit) {
  const list = $('#commentList');
  list.replaceChildren();
  if (!comments.length) list.append(element('li', 'sidebar-empty', 'Ainda não há comentários.'));
  for (const comment of comments) {
    const row = element('li', 'comment-item');
    const head = element('div', 'comment-head');
    head.append(element('strong', '', comment.author.email));
    head.append(element('time', 'task-date', new Date(comment.createdAt).toLocaleString('pt-BR')));
    row.append(head, element('p', '', comment.text));
    list.append(row);
  }
  $('#commentForm').hidden = !canEdit;
}

$('#commentForm').addEventListener('submit', async event => {
  event.preventDefault();
  const input = $('#commentInput');
  try {
    await api(`/api/tasks/${encodeURIComponent(taskIdFromPath)}/comments`, {
      method: 'POST', body: { text: input.value.trim() }
    });
    input.value = '';
    await loadTaskPage(false);
  } catch (error) {
    setTaskSync(error.message, true);
  }
});

function renderActivityList(list, entries) {
  list.replaceChildren();
  if (!entries.length) list.append(element('li', 'sidebar-empty', 'Ainda não há atividade.'));
  for (const entry of entries) {
    const row = element('li', 'activity-item');
    row.append(element('p', '', `${entry.actorEmail} ${activityLabel(entry.action)}${entry.details ? ` — ${entry.details}` : ''}`));
    row.append(element('time', 'task-date', new Date(entry.createdAt).toLocaleString('pt-BR')));
    list.append(row);
  }
}

const chatPanel = $('#projectChat');
async function openChat() {
  chatPanel.hidden = false;
  $('#openChat').setAttribute('aria-expanded', 'true');
  $('#chatInput').focus();
  if (aiStatusChecked) return;
  aiStatusChecked = true;
  try {
    const status = await api('/api/ai/status');
    if (!status.available) {
      appendChatMessage('IA indisponível: configure AI_API_KEY no servidor para habilitar Gemini ou OpenAI.', 'assistant', true);
    }
  } catch (error) {
    appendChatMessage(error.message, 'assistant', true);
  }
}
function closeChat() {
  chatPanel.hidden = true;
  $('#openChat').setAttribute('aria-expanded', 'false');
}
function appendChatMessage(content, role, isError = false) {
  const message = element('p', `chat-message is-${role}${isError ? ' is-error' : ''}`, content);
  $('#chatMessages').append(message);
  $('#chatMessages').scrollTop = $('#chatMessages').scrollHeight;
}
$('#openChat').addEventListener('click', openChat);
$('#closeChat').addEventListener('click', closeChat);
$('#chatForm').addEventListener('submit', async event => {
  event.preventDefault();
  const input = $('#chatInput');
  const question = input.value.trim();
  if (!question || !currentBoard) return;
  input.value = '';
  appendChatMessage(question, 'user');
  const messages = [...chatHistory, { role: 'user', content: question }].slice(-9);
  const button = $('#chatSubmit');
  button.disabled = true;
  try {
    const result = await api('/api/ai/chat', {
      method: 'POST',
      body: { boardId: currentBoard.id, messages }
    });
    chatHistory = [...messages, { role: 'assistant', content: result.answer }].slice(-10);
    appendChatMessage(result.answer, 'assistant');
  } catch (error) {
    appendChatMessage(error.message, 'assistant', true);
  } finally {
    button.disabled = false;
    input.focus();
  }
});

async function initialize() {
  if (!token) {
    showLogin();
    return;
  }
  try {
    const result = await api('/api/me');
    currentUser = result.user;
  } catch {
    token = '';
    localStorage.removeItem('edgekanban-token');
    showLogin();
    return;
  }
  await startApp();
}

setAuthMode(false);
initialize();
