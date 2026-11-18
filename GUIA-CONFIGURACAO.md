# edgekanbann: execução e publicação

O app usa Express, autenticação própria e um banco relacional. Para desenvolvimento local, os dados ficam em SQLite. No Render, configure um PostgreSQL para que os quadros continuem salvos após reinicializações e possam ser compartilhados entre usuários.

## Executar localmente

Requisitos: Node.js 22.5 ou superior.

```powershell
npm install
npm start
```

Abra `http://localhost:3000` e crie uma conta com senha de pelo menos 8 caracteres. O SQLite é criado automaticamente em `data/edgekanban.sqlite`; essa pasta é ignorada pelo Git.

Para usar os recursos de IA, abra **Configurar IA** na barra superior após entrar. Cada conta pode escolher um provedor, modelo e chave. A chave é enviada ao backend, criptografada antes de ser persistida e nunca é devolvida à interface.

Provedores disponíveis: OpenAI, Gemini, Anthropic Claude e API compatível com OpenAI. Para a opção compatível, informe também a URL base HTTPS e o identificador do modelo. Uma conta precisa configurar apenas o provedor que deseja usar. O botão **Testar conexão** valida chave, endpoint e modelo sem salvar a chave digitada; **Salvar configuração** persiste os dados da conta.

Para desenvolvimento local, gere uma chave de criptografia uma única vez com `openssl rand -base64 32`. Guarde o resultado em segredo e reutilize exatamente o mesmo valor:

```powershell
$env:AI_SETTINGS_ENCRYPTION_KEY = "COLE_AQUI_O_VALOR_GERADO"
npm start
```

Também é possível continuar usando as variáveis legadas `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` e `AI_BASE_URL` como configuração global inicial. As configurações pessoais salvas têm precedência. Sem uma chave de IA, o Kanban e as tarefas continuam disponíveis.

## Publicar no Render

1. Publique o repositório como um **Web Service** com `npm install` no build e `npm start` no start.
2. Crie um banco **Render PostgreSQL** e configure `DATABASE_URL` no Web Service com a URL interna fornecida pelo Render.
3. Configure `APP_URL` com a URL pública do app, por exemplo `https://edgekanban.onrender.com`.
4. No ambiente do Web Service, crie `AI_SETTINGS_ENCRYPTION_KEY` com uma chave aleatória de 32 bytes codificada em Base64. Gere-a uma única vez com `openssl rand -base64 32`; mantenha o mesmo valor em deploys futuros para descriptografar as chaves já salvas.
5. Opcionalmente, cadastre as variáveis legadas `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` e `AI_BASE_URL` para oferecer uma configuração global inicial. Não coloque chaves no Git ou no frontend.
6. Faça um deploy e confira `https://seu-dominio/healthz`.

O app usa SQLite se `DATABASE_URL` não estiver definido. O disco do Web Service pode ser temporário; para preservar contas, quadros e configurações criptografadas em produção, configure PostgreSQL no Render. O servidor cria as tabelas necessárias na inicialização.

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
- Chat, criação de tarefas e geração de checklist por OpenAI, Gemini, Claude ou uma API compatível. As chaves são criptografadas no banco e todas as chamadas aos provedores ficam no backend.
- Tarefas com “Bug” no título ou descrição recebem automaticamente a label Bug e prioridade alta.

## Verificação rápida

1. Crie contas com dois e-mails diferentes.
2. No primeiro quadro, gere um convite de editor para o segundo e-mail; abra o link em outra sessão e aceite.
3. Confirme que ambos veem as alterações e que o dono consegue trocar o segundo usuário para leitor.
4. Como leitor, tente criar, mover ou editar uma tarefa: a interface deve bloquear a edição e o servidor deve responder com `403`.
5. Abra uma tarefa em nova aba, adicione comentário, responsável, prazo e checklist; confirme que as mudanças aparecem no quadro e na página.
6. Em **Configurar IA**, salve uma chave de teste em cada provedor disponível, teste a conexão, alterne o provedor e valide chat, criação de tarefa e checklist.
