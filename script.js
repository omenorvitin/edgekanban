import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  doc,
  getFirestore,
  onSnapshot,
  runTransaction,
  updateDoc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const COLUMNS = ['todo', 'doing', 'done'];
const LABELS = { todo: 'A fazer', doing: 'Em andamento', done: 'Concluído' };
const EMPTY = {
  todo: 'Seu próximo passo começa aqui.',
  doing: 'O que está em movimento aparece aqui.',
  done: 'Tarefas concluídas ficam por aqui.'
};
const TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5"/></svg>';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (selector, root = document) => root.querySelector(selector);
const loginScreen = $('#loginScreen');
const loginForm = $('#loginForm');
const appHeader = $('#appHeader');
const workspace = $('#workspace');
const modal = $('#modal');
const form = $('#taskForm');
const passwordInput = $('#passwordInput');
const loginMessage = $('#loginMessage');
const syncStatus = $('#syncStatus');
const chatPanel = $('#projectChat');
const chatForm = $('#chatForm');
const chatInput = $('#chatInput');
const chatMessages = $('#chatMessages');
const chatSubmit = $('#chatSubmit');

let authMode = 'login';
let tasks = [];
let chatHistory = [];
let draggedId = null;
let boardRef = null;
let unsubscribeBoard = null;
let pendingWrites = 0;
let writeQueue = Promise.resolve();
let boardGeneration = 0;

function authErrorMessage(error) {
  const messages = {
    'auth/email-already-in-use': 'Este e-mail já possui uma conta. Entre com sua senha.',
    'auth/invalid-email': 'Informe um endereço de e-mail válido.',
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'auth/weak-password': 'Escolha uma senha com pelo menos 8 caracteres.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde um pouco e tente novamente.',
    'auth/network-request-failed': 'Sem conexão com o Firebase. Verifique a internet e tente novamente.',
    'auth/operation-not-allowed': 'O login por e-mail e senha não está ativado no Firebase.'
  };
  return messages[error.code] || `Não foi possível concluir a solicitação: ${error.message}`;
}

function setLoginMessage(message, isError = true) {
  loginMessage.textContent = message;
  loginMessage.hidden = !message;
  loginMessage.classList.toggle('is-error', isError);
}

function setAuthMode(mode) {
  authMode = mode;
  const creating = mode === 'create';
  $('#loginTitle').textContent = creating ? 'Comece por aqui.' : 'Seu espaço de trabalho.';
  $('#authDescription').textContent = creating
    ? 'Crie sua conta para organizar suas tarefas.'
    : 'Entre para acessar seu quadro.';
  $('#authSubmit').textContent = creating ? 'Criar conta' : 'Entrar';
  $('#authModeToggle').textContent = creating ? 'Já tenho uma conta' : 'Criar uma conta';
  $('#resetPassword').hidden = creating;
  passwordInput.autocomplete = creating ? 'new-password' : 'current-password';
  setLoginMessage('');
}

function setSyncStatus(message, isError = false) {
  syncStatus.textContent = message;
  syncStatus.classList.toggle('is-error', isError);
}

function setAuthenticatedView(user) {
  loginScreen.hidden = Boolean(user);
  appHeader.hidden = !user;
  workspace.hidden = !user;
  if (!user) closeChat();
  if (user) $('#accountEmail').textContent = user.email || '';
}

function openChat() {
  chatPanel.hidden = false;
  $('#openChat').setAttribute('aria-expanded', 'true');
  chatInput.focus();
}

function closeChat() {
  chatPanel.hidden = true;
  $('#openChat').setAttribute('aria-expanded', 'false');
}

function appendChatMessage(content, role, isError = false) {
  const message = document.createElement('p');
  message.className = `chat-message is-${role}${isError ? ' is-error' : ''}`;
  message.textContent = content;
  chatMessages.append(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function resetChat() {
  chatHistory = [];
  chatMessages.replaceChildren();
  const welcome = document.createElement('p');
  welcome.className = 'chat-welcome';
  welcome.textContent = 'Pergunte sobre suas tarefas, o que está atrasado ou o que falta fazer.';
  chatMessages.append(welcome);
}

function stopBoardListener() {
  boardGeneration += 1;
  if (unsubscribeBoard) unsubscribeBoard();
  unsubscribeBoard = null;
  boardRef = null;
  tasks = [];
  pendingWrites = 0;
  writeQueue = Promise.resolve();
}

function isTask(task) {
  return task &&
    typeof task.id === 'string' &&
    typeof task.title === 'string' &&
    typeof task.desc === 'string' &&
    COLUMNS.includes(task.status) &&
    Number.isFinite(task.createdAt);
}

async function openBoard(user) {
  stopBoardListener();
  const generation = boardGeneration;
  boardRef = doc(db, 'boards', user.uid);
  setSyncStatus('Conectando ao quadro…');

  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(boardRef);
    if (!snapshot.exists()) {
      transaction.set(boardRef, {
        name: 'Meu quadro',
        ownerId: user.uid,
        tasks: [],
        columns: COLUMNS.map(id => ({ id, name: LABELS[id] })),
        wipLimits: {}
      });
    }
  });

  if (generation !== boardGeneration) return;
  unsubscribeBoard = onSnapshot(boardRef, snapshot => {
    if (generation !== boardGeneration) return;
    if (!snapshot.exists()) {
      setSyncStatus('O quadro não foi encontrado. Saia e entre novamente.', true);
      return;
    }
    const remoteTasks = snapshot.data().tasks;
    if (!Array.isArray(remoteTasks) || !remoteTasks.every(isTask)) {
      setSyncStatus('Os dados do quadro estão em um formato inválido.', true);
      return;
    }
    if (pendingWrites > 0) return;
    tasks = remoteTasks;
    render();
    setSyncStatus('Sincronizado');
  }, error => {
    if (generation !== boardGeneration) return;
    setSyncStatus(`Falha ao sincronizar: ${error.message}`, true);
  });
}

function persistTasks() {
  if (!boardRef) {
    setSyncStatus('Não há uma conta conectada para salvar as tarefas.', true);
    return;
  }
  const targetRef = boardRef;
  const generation = boardGeneration;
  const savedTasks = tasks.map(task => ({ ...task }));
  pendingWrites += 1;
  setSyncStatus('Salvando…');
  writeQueue = writeQueue
    .then(() => updateDoc(targetRef, { tasks: savedTasks }))
    .then(() => {
      if (generation !== boardGeneration) return;
      pendingWrites -= 1;
      if (pendingWrites === 0) setSyncStatus('Sincronizado');
    })
    .catch(error => {
      if (generation !== boardGeneration) return;
      pendingWrites -= 1;
      setSyncStatus(`Não foi possível salvar: ${error.message}`, true);
    });
}

loginForm.addEventListener('input', () => setLoginMessage(''));
loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!loginForm.reportValidity()) return;
  const email = $('#emailInput').value.trim().toLowerCase();
  const password = passwordInput.value;
  try {
    if (authMode === 'create') {
      await createUserWithEmailAndPassword(auth, email, password);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
    setLoginMessage('');
  } catch (error) {
    setLoginMessage(authErrorMessage(error));
  }
});

$('#authModeToggle').addEventListener('click', () => {
  setAuthMode(authMode === 'login' ? 'create' : 'login');
});

$('#resetPassword').addEventListener('click', async () => {
  const email = $('#emailInput').value.trim().toLowerCase();
  if (!email) {
    setLoginMessage('Informe seu e-mail para receber o link de redefinição.');
    $('#emailInput').focus();
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    setLoginMessage('Se esse e-mail tiver uma conta, você receberá um link para redefinir a senha.', false);
  } catch (error) {
    setLoginMessage(authErrorMessage(error));
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  try {
    await signOut(auth);
  } catch (error) {
    setSyncStatus(`Não foi possível sair: ${error.message}`, true);
  }
});

$('#openChat').addEventListener('click', openChat);
$('#closeChat').addEventListener('click', closeChat);
chatForm.addEventListener('submit', async event => {
  event.preventDefault();
  const message = chatInput.value.trim();
  const user = auth.currentUser;
  if (!message || !user || chatSubmit.disabled) return;

  chatInput.value = '';
  appendChatMessage(message, 'user');
  const conversation = [...chatHistory, { role: 'user', content: message }].slice(-9);
  chatSubmit.disabled = true;
  chatSubmit.textContent = '...';

  try {
    const token = await user.getIdToken();
    const response = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ messages: conversation })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível consultar o projeto.');
    if (typeof result.answer !== 'string' || !result.answer.trim()) {
      throw new Error('A IA retornou uma resposta vazia. Tente novamente.');
    }
    chatHistory = [...conversation, { role: 'assistant', content: result.answer }].slice(-10);
    appendChatMessage(result.answer, 'assistant');
  } catch (error) {
    appendChatMessage(error.message || 'Não foi possível consultar o projeto.', 'assistant', true);
  } finally {
    chatSubmit.disabled = false;
    chatSubmit.textContent = 'Enviar';
    chatInput.focus();
  }
});

onAuthStateChanged(auth, user => {
  if (!user) {
    stopBoardListener();
    resetChat();
    setAuthenticatedView(null);
    return;
  }
  resetChat();
  setAuthenticatedView(user);
  openBoard(user).catch(error => {
    setSyncStatus(`Não foi possível abrir o quadro: ${error.message}`, true);
  });
}, error => {
  setLoginMessage(`Não foi possível verificar sua sessão: ${error.message}`);
});

function render() {
  COLUMNS.forEach(status => {
    const list = $(`[data-list="${status}"]`);
    const items = tasks.filter(task => task.status === status);
    list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = EMPTY[status];
      list.append(empty);
    }
    items.forEach(task => list.append(cardEl(task)));
    $(`[data-count="${status}"]`).textContent = items.length;
  });
}

function cardEl(task) {
  const element = document.createElement('article');
  element.className = 'card';
  element.draggable = true;
  element.dataset.id = task.id;

  const heading = document.createElement('h3');
  heading.textContent = task.title;
  element.append(heading);

  if (task.desc) {
    const description = document.createElement('p');
    description.textContent = task.desc;
    element.append(description);
  }

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'btn-del';
  deleteButton.innerHTML = TRASH;
  deleteButton.setAttribute('aria-label', `Excluir tarefa: ${task.title}`);
  deleteButton.addEventListener('click', () => removeTask(task.id));
  element.append(deleteButton);

  const footer = document.createElement('div');
  footer.className = 'card-foot';
  const date = document.createElement('span');
  date.textContent = new Date(task.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  const move = document.createElement('div');
  move.className = 'move';
  const index = COLUMNS.indexOf(task.status);
  [[-1, '←'], [1, '→']].forEach(([direction, symbol]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = symbol;
    const target = COLUMNS[index + direction];
    button.disabled = !target;
    if (target) button.setAttribute('aria-label', `Mover para ${LABELS[target]}`);
    button.addEventListener('click', () => moveTask(task.id, target));
    move.append(button);
  });
  footer.append(date, move);
  element.append(footer);

  element.addEventListener('dragstart', event => {
    draggedId = task.id;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', task.id);
    requestAnimationFrame(() => element.classList.add('dragging'));
  });
  element.addEventListener('dragend', () => {
    draggedId = null;
    element.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(column => column.classList.remove('drag-over'));
  });
  return element;
}

function uid() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function addTask(title, desc) {
  tasks.push({ id: uid(), title, desc, status: 'todo', createdAt: Date.now() });
  render();
  persistTasks();
}

function removeTask(id) {
  tasks = tasks.filter(task => task.id !== id);
  render();
  persistTasks();
}

function moveTask(id, status, beforeId = null) {
  if (!COLUMNS.includes(status)) return;
  const task = tasks.find(item => item.id === id);
  if (!task) return;
  tasks = tasks.filter(item => item.id !== id);
  task.status = status;
  const index = beforeId ? tasks.findIndex(item => item.id === beforeId) : -1;
  if (index >= 0) tasks.splice(index, 0, task);
  else tasks.push(task);
  render();
  persistTasks();
}

function cardAfterCursor(list, y) {
  const cards = [...list.querySelectorAll('.card:not(.dragging)')];
  return cards.find(card => {
    const box = card.getBoundingClientRect();
    return y < box.top + box.height / 2;
  });
}

document.querySelectorAll('.column').forEach(column => {
  const list = $('.cards', column);
  column.addEventListener('dragover', event => {
    if (!draggedId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    column.classList.add('drag-over');
  });
  column.addEventListener('dragleave', event => {
    if (!column.contains(event.relatedTarget)) column.classList.remove('drag-over');
  });
  column.addEventListener('drop', event => {
    event.preventDefault();
    column.classList.remove('drag-over');
    if (!draggedId) return;
    const next = cardAfterCursor(list, event.clientY);
    moveTask(draggedId, column.dataset.status, next ? next.dataset.id : null);
  });
});

$('#openModal').addEventListener('click', () => {
  form.reset();
  modal.showModal();
  $('#titleInput').focus();
});
$('#cancelBtn').addEventListener('click', () => modal.close());
modal.addEventListener('click', event => {
  if (event.target === modal) modal.close();
});
form.addEventListener('submit', event => {
  event.preventDefault();
  const title = $('#titleInput').value.trim();
  if (!title) return;
  addTask(title, $('#descInput').value.trim());
  modal.close();
});
