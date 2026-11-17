import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

let serverProcess;
let baseUrl;
let testDirectory;
let output = '';

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function request(url, token, method = 'GET', body) {
  const response = await fetch(`${baseUrl}${url}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

async function register(email) {
  const result = await request('/api/auth/register', '', 'POST', { email, password: 'secure-pass-123' });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body;
}

before(async () => {
  testDirectory = mkdtempSync(path.join(tmpdir(), 'edgekanban-test-'));
  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: '',
      DATABASE_PATH: path.join(testDirectory, 'test.sqlite'),
      AI_API_KEY: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  serverProcess.stdout.on('data', chunk => { output += chunk.toString(); });
  serverProcess.stderr.on('data', chunk => { output += chunk.toString(); });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) throw new Error(`Test server exited early:\n${output}`);
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Test server did not start:\n${output}`);
});

after(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill();
    await new Promise(resolve => serverProcess.once('exit', resolve));
  }
  if (testDirectory) rmSync(testDirectory, { recursive: true, force: true });
});

test('collaboration, server-side roles, task details, Scrum and WIP limits', async () => {
  const owner = await register('owner@example.com');
  const duplicateOwner = await request('/api/auth/register', '', 'POST', {
    email: 'owner@example.com',
    password: 'secure-pass-123'
  });
  assert.equal(duplicateOwner.status, 409);
  assert.equal(duplicateOwner.body.error, 'Este e-mail já possui uma conta. Entre com sua senha.');

  const boardsResult = await request('/api/boards', owner.token);
  const boardId = boardsResult.body.boards[0].id;
  const aiStatus = await request('/api/ai/status', owner.token);
  assert.equal(aiStatus.status, 200);
  assert.equal(aiStatus.body.available, false);
  assert.equal((await request('/api/ai/chat', owner.token, 'POST', {
    boardId,
    messages: [{ role: 'user', content: 'O que falta fazer?' }]
  })).status, 503);
  assert.equal((await request('/api/ai/task', owner.token, 'POST', {
    boardId,
    prompt: 'Criar tarefa para revisar o login'
  })).status, 503);

  const inviteViewer = await request(`/api/boards/${boardId}/invitations`, owner.token, 'POST', {
    email: 'viewer@example.com',
    role: 'VIEWER'
  });
  assert.equal(inviteViewer.status, 201);
  const inviteToken = new URL(inviteViewer.body.invitationUrl).searchParams.get('invite');
  const wrongAccount = await request('/api/invitations/accept', owner.token, 'POST', { token: inviteToken });
  assert.equal(wrongAccount.status, 403);
  const viewer = await register('viewer@example.com');
  const acceptedViewer = await request('/api/invitations/accept', viewer.token, 'POST', { token: inviteToken });
  assert.equal(acceptedViewer.status, 200);
  assert.equal(acceptedViewer.body.boardId, boardId);

  const editor = await register('editor@example.com');
  const inviteEditor = await request(`/api/boards/${boardId}/invitations`, owner.token, 'POST', {
    email: 'editor@example.com',
    role: 'EDITOR'
  });
  assert.equal(inviteEditor.body.memberAdded, true);

  const boardResponse = await request(`/api/boards/${boardId}`, owner.token);
  assert.equal(boardResponse.status, 200);
  const board = boardResponse.body.board;
  assert.equal(board.members.length, 3);
  assert.ok(board.columns.length >= 3);
  const [first, second] = board.columns;

  const savedColumns = board.columns.map((column, index) => ({
    id: column.id,
    name: column.name,
    wipLimit: index === 0 ? 1 : null
  }));
  assert.equal((await request(`/api/boards/${boardId}/columns`, owner.token, 'PUT', {
    columns: savedColumns
  })).status, 200);

  const taskResult = await request(`/api/boards/${boardId}/tasks`, owner.token, 'POST', {
    title: 'Bug no login',
    description: 'Não consigo entrar',
    dueDate: '2027-01-15',
    assigneeId: editor.user.id,
    labels: ['feature']
  });
  assert.equal(taskResult.status, 201);
  const taskId = taskResult.body.taskId;

  const boardAfterTask = (await request(`/api/boards/${boardId}`, owner.token)).body.board;
  const task = boardAfterTask.tasks.find(item => item.id === taskId);
  assert.equal(task.priority, 'high');
  assert.equal(task.dueDate, '2027-01-15');
  assert.equal(task.assigneeId, editor.user.id);
  assert.deepEqual(task.labels.map(label => label.name).sort(), ['Bug', 'Feature']);

  const secondTask = await request(`/api/boards/${boardId}/tasks`, owner.token, 'POST', {
    title: 'Planejar entrega',
    status: second.id
  });
  assert.equal(secondTask.status, 201);
  assert.equal((await request(`/api/boards/${boardId}/tasks`, owner.token, 'POST', {
    title: 'Exceder WIP'
  })).status, 409);
  assert.equal((await request(`/api/tasks/${secondTask.body.taskId}`, editor.token, 'PATCH', {
    status: first.id
  })).status, 409);

  const taskEdit = await request(`/api/tasks/${taskId}`, editor.token, 'PATCH', {
    storyPoints: 5,
    acceptanceCriteria: 'A pessoa consegue entrar.',
    definitionOfDone: 'Revisado e testado.',
    priority: 'medium'
  });
  assert.equal(taskEdit.status, 200, JSON.stringify(taskEdit.body));
  const sprintResult = await request(`/api/boards/${boardId}/sprints`, editor.token, 'POST', {
    name: 'Sprint de entrega',
    startDate: '2026-11-16',
    endDate: '2026-11-30',
    state: 'ACTIVE'
  });
  assert.equal(sprintResult.status, 201);
  assert.equal((await request(`/api/tasks/${taskId}`, editor.token, 'PATCH', {
    sprintId: sprintResult.body.sprint.id
  })).status, 200);

  const comment = await request(`/api/tasks/${taskId}/comments`, editor.token, 'POST', {
    text: 'Vou investigar esse erro.'
  });
  assert.equal(comment.status, 201);
  assert.equal(comment.body.comment.author.email, 'editor@example.com');
  const checklist = await request(`/api/tasks/${taskId}/checklist`, editor.token, 'POST', {
    text: 'Reproduzir o erro'
  });
  assert.equal(checklist.status, 201);
  assert.equal((await request(`/api/tasks/${taskId}/checklist/${checklist.body.item.id}`, editor.token, 'PATCH', {
    done: true
  })).status, 200);

  const details = await request(`/api/tasks/${taskId}`, viewer.token);
  assert.equal(details.status, 200);
  assert.equal(details.body.task.comments[0].author.email, 'editor@example.com');
  assert.equal(details.body.task.comments[0].text, 'Vou investigar esse erro.');
  assert.equal(details.body.task.checklist[0].done, true);
  assert.equal(details.body.task.storyPoints, 5);
  assert.equal(details.body.task.sprintId, sprintResult.body.sprint.id);
  assert.ok(details.body.task.activity.length >= 3);

  assert.equal((await request(`/api/boards/${boardId}/tasks`, viewer.token, 'POST', {
    title: 'Tentativa de leitor'
  })).status, 403);
  assert.equal((await request(`/api/tasks/${taskId}`, viewer.token, 'PATCH', {
    title: 'Tentativa de alteração'
  })).status, 403);
  assert.equal((await request(`/api/tasks/${taskId}/comments`, viewer.token, 'POST', {
    text: 'Não posso comentar como leitor.'
  })).status, 403);
  assert.equal((await request(`/api/boards/${boardId}/members/${viewer.user.id}`, owner.token, 'DELETE')).status, 200);
  assert.equal((await request(`/api/tasks/${taskId}`, viewer.token)).status, 404);

  const reordered = [savedColumns[1], savedColumns[0], savedColumns[2]];
  assert.equal((await request(`/api/boards/${boardId}/columns`, owner.token, 'PUT', {
    columns: reordered
  })).status, 200);
  const reorderedBoard = (await request(`/api/boards/${boardId}`, owner.token)).body.board;
  assert.equal(reorderedBoard.columns[0].id, second.id);
});
