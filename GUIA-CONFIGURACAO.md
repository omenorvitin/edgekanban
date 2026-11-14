# edgekanbann: configuração e publicação

O app usa Firebase Authentication para contas e Cloud Firestore para salvar as tarefas. Não há conta de demonstração nem dados de exemplo: cada pessoa cria a própria conta e recebe um quadro vazio.

## Preparar o Firebase

1. No [Firebase Console](https://console.firebase.google.com/), crie um projeto ou use um projeto existente.
2. Em **Authentication > Método de login**, ative **E-mail/senha**.
3. Em **Firestore Database**, crie o banco em **modo de produção**.
4. Registre um app Web e confira se `firebase-config.js` contém os dados do app. A configuração Web identifica o projeto; nunca coloque chaves privadas ou senhas nesse arquivo.
5. Em **Firestore Database > Regras**, publique o conteúdo de `firestore.rules`.
6. Em **Authentication > Configurações > Domínios autorizados**, adicione o domínio em que o app será publicado.

O app cria um documento em `boards/{uid}` no primeiro acesso autenticado. As regras permitem ao usuário acessar somente o próprio quadro. Não é necessário criar coleções manualmente.

## Configurar a IA

O chat usa um servidor Node.js e nunca envia a chave da IA ao navegador. É necessário configurar as credenciais do Firebase Admin e uma chave de IA no ambiente do servidor:

- `FIREBASE_SERVICE_ACCOUNT`: conteúdo JSON de uma conta de serviço do mesmo projeto Firebase. Localmente, também é possível configurar `GOOGLE_APPLICATION_CREDENTIALS` com o caminho do arquivo. Mantenha as credenciais somente no servidor; nunca as adicione ao Git ou ao `firebase-config.js`.
- `AI_PROVIDER`: `gemini` (padrão) ou `openai`.
- `AI_API_KEY`: chave de API do provedor selecionado.
- `AI_MODEL` (opcional): modelo a usar. Os padrões são `gemini-2.5-flash` e `gpt-4o-mini`, respectivamente.

Conceda à conta de serviço somente as permissões necessárias para ler os documentos do Firestore. A API valida o token do Firebase Authentication e busca as tarefas do quadro do próprio usuário antes de enviar o contexto à IA.

## Testar localmente

Instale o Node.js 22 ou superior e as dependências:

```powershell
npm install
$env:FIREBASE_SERVICE_ACCOUNT = Get-Content .\service-account.json -Raw
$env:AI_PROVIDER = "gemini"
$env:AI_API_KEY = "sua-chave"
npm start
```

O arquivo `service-account.json` deve ser baixado do Firebase Console e não deve ser enviado ao Git. Acesse `http://localhost:3000`; o endpoint `/healthz` confirma se o servidor está ativo.

1. Crie uma conta com e-mail e senha de pelo menos 8 caracteres.
2. Adicione tarefas, mova-as entre as colunas e recarregue a página para confirmar que foram salvas.
3. Abra **Pergunte ao seu projeto** e pergunte sobre tarefas do quadro.
4. Saia e entre novamente para confirmar que o quadro está associado à conta.

## Publicar no Render

1. Envie os arquivos do projeto para um repositório Git.
2. No Render, crie um **Web Service** conectado ao repositório.
3. Use `npm install` como comando de build e `npm start` como comando de inicialização.
4. Cadastre `FIREBASE_SERVICE_ACCOUNT`, `AI_PROVIDER` e `AI_API_KEY` nas variáveis de ambiente do serviço. Não grave credenciais em arquivos do repositório.
5. Depois da publicação, adicione o domínio `onrender.com` do serviço à lista de domínios autorizados do Firebase Authentication.

Se usar um domínio personalizado, autorize esse domínio no Firebase também.

## Solução de problemas

- **`auth/operation-not-allowed`**: ative o provedor E-mail/senha no Firebase Authentication.
- **`auth/unauthorized-domain`**: adicione o domínio publicado à lista de domínios autorizados do Firebase.
- **Falha ao carregar ou salvar o quadro**: confira se as regras de `firestore.rules` foram publicadas e se o Firestore foi criado no projeto indicado em `firebase-config.js`.
- **Módulos não carregam**: acesse o app por um servidor HTTP/HTTPS, não por `file://`.
