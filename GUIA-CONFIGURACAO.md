# edgekanbann: execução e publicação

O app usa Express, autenticação própria e um banco relacional. Para desenvolvimento local, os dados ficam em SQLite. No Render, configure um PostgreSQL para que os quadros continuem salvos após reinicializações e possam ser compartilhados entre usuários.

## Executar localmente

Requisitos: Node.js 22.5 ou superior.

```powershell
npm install
npm start
```

Abra `http://localhost:3000` e crie uma conta com senha de pelo menos 8 caracteres. O SQLite é criado automaticamente em `data/edgekanban.sqlite`; essa pasta é ignorada pelo Git.

Para habilitar o chat e a criação de checklist por IA, configure a chave somente no servidor:

```powershell
$env:AI_PROVIDER = "gemini"
$env:AI_API_KEY = "sua-chave"
npm start
```

O Gemini seleciona automaticamente o modelo Flash compatível mais recente disponível para a chave configurada, com cache em memória, novas tentativas para sobrecarga e fallback para outro modelo compatível. Também é possível usar `AI_PROVIDER=openai` e, opcionalmente, `AI_MODEL=gpt-4o-mini`. A interface nunca recebe a chave da IA. Sem uma chave válida, os recursos de IA informam que estão indisponíveis; quadros e tarefas continuam funcionando.

## Publicar no Render

1. Publique o repositório como um **Web Service** com `npm install` no build e `npm start` no start.
2. Crie um banco **Render PostgreSQL** e configure `DATABASE_URL` no Web Service com a URL interna fornecida pelo Render.
3. Configure `APP_URL` com a URL pública do app, por exemplo `https://edgekanbann-ai.onrender.com`.
4. Para os recursos de IA, cadastre `AI_PROVIDER` e `AI_API_KEY` nas variáveis do serviço. `AI_MODEL` é opcional somente para OpenAI; o Gemini descobre o modelo compatível automaticamente.
5. Faça um deploy e confira `https://seu-dominio/healthz`.

O app usa SQLite se `DATABASE_URL` não estiver definido. O disco do Web Service pode ser temporário; para preservar os dados em produção, configure PostgreSQL no Render. O servidor cria as tabelas necessárias na inicialização.

## Contas, quadros e convites

- Cada cadastro cria uma conta e um quadro próprio.
- O dono pode compartilhar por e-mail como editor ou leitor, alterar o papel de membros e remover o acesso.
- Se a pessoa já tem conta, o acesso é concedido ao e-mail informado. Se ainda não tem conta, o app gera um link de uso único válido por 7 dias; copie e envie o link. Para aceitar, a pessoa deve criar uma conta usando exatamente esse endereço.
- Editores podem criar e alterar tarefas e configurações do quadro. Leitores podem visualizar, mas o servidor também bloqueia as operações de edição.
- Tarefas abrem em `/tasks/:id`; o link funciona para membros autenticados do quadro.

## Recursos implementados

- Quadros próprios e compartilhados, papéis OWNER/EDITOR/VIEWER e proteção das rotas de escrita.
- Kanban com colunas personalizáveis, limite WIP validado pelo servidor, prioridade, labels e histórico.
- Página de tarefa com prazo, responsável do quadro, comentários com autor/data, checklist, story points, sprint, critérios de aceite e Definition of Done.
- Backlog e sprints Scrum; tarefas podem ser movidas entre backlog e sprints.
- Chat de IA que consulta apenas tarefas do quadro autorizado e geração de checklist por IA. As chaves e chamadas aos provedores ficam no backend.
- Tarefas com “Bug” no título ou descrição recebem automaticamente a label Bug e prioridade alta.

## Verificação rápida

1. Crie contas com dois e-mails diferentes.
2. No primeiro quadro, gere um convite de editor para o segundo e-mail; abra o link em outra sessão e aceite.
3. Confirme que ambos veem as alterações e que o dono consegue trocar o segundo usuário para leitor.
4. Como leitor, tente criar, mover ou editar uma tarefa: a interface deve bloquear a edição e o servidor deve responder com `403`.
5. Abra uma tarefa em nova aba, adicione comentário, responsável, prazo e checklist; confirme que as mudanças aparecem no quadro e na página.
6. Configure a IA no Render e teste uma pergunta sobre tarefas e a geração de checklist.
