import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { fetchGeminiWithFallback } from './gemini-retry.js';
import { createGeminiModelLoader } from './gemini-models.js';

export const AI_PROVIDERS = Object.freeze({
  openai: { label: 'OpenAI', defaultModel: 'gpt-4o-mini' },
  gemini: { label: 'Google Gemini', defaultModel: 'gemini-2.5-flash' },
  anthropic: { label: 'Anthropic Claude', defaultModel: 'claude-sonnet-4-5' },
  'openai-compatible': { label: 'API compatível com OpenAI', defaultModel: '' }
});

export class AIProviderError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'AIProviderError';
    this.status = status;
  }
}

export function validateAIProviderConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AIProviderError(400, 'Envie uma configuração de IA válida.');
  }
  const provider = input.provider;
  const definition = AI_PROVIDERS[provider];
  if (!definition) throw new AIProviderError(400, 'Escolha um provedor de IA suportado.');
  const model = typeof input.model === 'string' ? input.model.trim() : '';
  if (!model || model.length > 160 || /[\u0000-\u001f]/.test(model)) {
    throw new AIProviderError(400, 'Informe um identificador de modelo válido.');
  }
  const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  if (apiKey.length > 4096) throw new AIProviderError(400, 'A chave de API excede o tamanho permitido.');

  let baseUrl = '';
  if (provider === 'openai-compatible') {
    baseUrl = validateCompatibleBaseUrl(input.baseUrl);
  }
  return { provider, model, apiKey, baseUrl };
}

export function validateCompatibleBaseUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) {
    throw new AIProviderError(400, 'Informe o endereço HTTPS base do provedor compatível.');
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new AIProviderError(400, 'O endereço do provedor compatível não é válido.');
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port && url.port !== '443') ||
    !hostname.includes('.') ||
    hostname.endsWith('.') ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    isIP(hostname)
  ) {
    throw new AIProviderError(400, 'Use um domínio público HTTPS sem credenciais, porta personalizada ou parâmetros.');
  }
  if (url.pathname.split('/').some(part => part === '.' || part === '..')) {
    throw new AIProviderError(400, 'O caminho base do provedor não é válido.');
  }
  return url.toString().replace(/\/+$/, '');
}

function providerStatusError(provider, status) {
  const label = AI_PROVIDERS[provider].label;
  if (status === 401 || status === 403) {
    return new AIProviderError(502, `${label} recusou a chave ou não autorizou este modelo (HTTP ${status}).`);
  }
  if (status === 404) {
    return new AIProviderError(502, `${label} não encontrou o modelo ou endpoint configurado (HTTP 404).`);
  }
  if (status === 429) {
    return new AIProviderError(502, `${label} atingiu o limite de uso ou de créditos (HTTP 429).`);
  }
  if (status >= 500) {
    return new AIProviderError(502, `${label} está temporariamente indisponível (HTTP ${status}).`);
  }
  return new AIProviderError(502, `${label} rejeitou a solicitação (HTTP ${status}). Confira modelo e configuração.`);
}

async function responseJSON(provider, response) {
  const contentLength = Number(response.headers?.get?.('content-length') || 0);
  if (contentLength > 1024 * 1024) {
    throw new AIProviderError(502, `${AI_PROVIDERS[provider].label} retornou uma resposta muito grande.`);
  }
  const text = await response.text();
  if (text.length > 1024 * 1024) {
    throw new AIProviderError(502, `${AI_PROVIDERS[provider].label} retornou uma resposta muito grande.`);
  }
  if (!response.ok) throw providerStatusError(provider, response.status);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AIProviderError(502, `${AI_PROVIDERS[provider].label} retornou uma resposta inválida.`);
  }
  return data;
}

function extractText(provider, data) {
  let answer;
  if (provider === 'gemini') {
    answer = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
  } else if (provider === 'anthropic') {
    answer = data.content?.filter(part => part.type === 'text').map(part => part.text).join('').trim();
  } else {
    const content = data.choices?.[0]?.message?.content;
    answer = typeof content === 'string'
      ? content.trim()
      : Array.isArray(content)
        ? content.filter(part => part.type === 'text').map(part => part.text || '').join('').trim()
        : '';
  }
  if (typeof answer !== 'string' || !answer) {
    throw new AIProviderError(502, `${AI_PROVIDERS[provider].label} retornou uma resposta vazia ou bloqueada.`);
  }
  return answer;
}

function compatibleResponse(url, apiKey, payload, signal, requestImpl, addressResolver) {
  return new Promise((resolve, reject) => {
    let responseBody = '';
    const request = requestImpl({
      protocol: 'https:',
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      servername: url.hostname,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      lookup: (_hostname, options, callback) => {
        addressResolver(url.hostname).then(address => {
          if (options && options.all) callback(null, [address]);
          else callback(null, address.address, address.family);
        }, callback);
      }
    }, response => {
      response.setEncoding('utf8');
      response.on('data', chunk => {
        responseBody += chunk;
        if (responseBody.length > 1024 * 1024) {
          request.destroy(new AIProviderError(502, 'A resposta do provedor excedeu o tamanho permitido.'));
        }
      });
      response.on('end', () => resolve({
        ok: response.statusCode >= 200 && response.statusCode < 300,
        status: response.statusCode || 502,
        text: async () => responseBody
      }));
    });

    const abort = () => request.destroy(new AIProviderError(504, 'A solicitação ao provedor de IA foi cancelada por tempo limite.'));
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    request.setTimeout(45000, abort);
    request.on('error', error => reject(signal?.aborted
      ? new AIProviderError(504, 'A conexão com o provedor de IA excedeu o tempo limite.')
      : error instanceof AIProviderError
        ? error
        : new AIProviderError(502, 'Não foi possível conectar ao provedor compatível. Confira o endereço e tente novamente.')));
    request.on('close', () => signal?.removeEventListener('abort', abort));
    request.end(JSON.stringify(payload));
  });
}

function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    const parts = address.split('.').map(Number);
    const [a, b, c] = parts;
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (family !== 6) return false;
  const normalized = address.toLowerCase();
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice('::ffff:'.length);
    if (isIP(mapped) === 4) return isPublicAddress(mapped);
    return false;
  }
  const firstSegment = Number.parseInt(normalized.split(':')[0] || '0', 16);
  return (firstSegment & 0xe000) === 0x2000 && !normalized.startsWith('2001:db8:');
}

async function resolvePublicAddress(hostname) {
  let addresses;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new AIProviderError(400, 'Não foi possível localizar o domínio do provedor compatível.');
  }
  if (!addresses.length || addresses.some(address => !isPublicAddress(address.address))) {
    throw new AIProviderError(400, 'O endereço do provedor compatível precisa resolver somente para IPs públicos.');
  }
  return addresses[0];
}

function openAIRequestUrl(config) {
  if (config.provider === 'openai') return 'https://api.openai.com/v1/chat/completions';
  return `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

async function callProvider(
  config,
  instructions,
  messages,
  signal,
  getGeminiModels,
  fetchImpl,
  requestImpl,
  addressResolver
) {
  const payload = config.provider === 'gemini'
    ? {
        systemInstruction: { parts: [{ text: instructions }] },
        contents: messages.map(message => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }]
        })),
        generationConfig: { maxOutputTokens: 700, temperature: 0.3 }
      }
    : config.provider === 'anthropic'
      ? {
          model: config.model,
          max_tokens: 700,
          system: instructions,
          messages: messages.map(message => ({ role: message.role, content: message.content }))
        }
      : {
          model: config.model,
          messages: [
            { role: 'system', content: instructions },
            ...messages.map(message => ({ role: message.role, content: message.content }))
          ],
          max_tokens: 700,
          temperature: 0.3
        };

  if (config.provider === 'gemini') {
    let models = [config.model];
    if (config.model === 'auto' && getGeminiModels) {
      try {
        models = await getGeminiModels();
      } catch (error) {
        if (error.name === 'AbortError' || signal?.aborted) {
          throw new AIProviderError(504, 'A busca de modelos do Gemini excedeu o tempo limite.');
        }
        const status = error.message.match(/status (\d{3})/)?.[1];
        if (status) throw providerStatusError('gemini', Number(status));
        throw new AIProviderError(502, 'Não foi possível carregar a lista de modelos do Gemini.');
      }
    }
    const modelUrls = models.slice(0, 3).map(model => {
      const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`);
      url.searchParams.set('key', config.apiKey);
      return url;
    });
    const { response } = await fetchGeminiWithFallback(modelUrls, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify(payload)
    }, fetchImpl);
    return extractText('gemini', await responseJSON('gemini', response));
  }

  if (config.provider === 'openai-compatible') {
    const url = new URL(openAIRequestUrl(config));
    const response = await compatibleResponse(url, config.apiKey, payload, signal, requestImpl, addressResolver);
    return extractText(config.provider, await responseJSON(config.provider, response));
  }

  const url = config.provider === 'anthropic'
    ? 'https://api.anthropic.com/v1/messages'
    : openAIRequestUrl(config);
  const headers = config.provider === 'anthropic'
    ? {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      }
    : {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      };
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify(payload)
    });
  } catch (error) {
    if (signal?.aborted || error.name === 'AbortError') {
      throw new AIProviderError(504, `A chamada ao ${AI_PROVIDERS[config.provider].label} excedeu o tempo limite.`);
    }
    throw new AIProviderError(502, `Não foi possível conectar ao ${AI_PROVIDERS[config.provider].label}.`);
  }
  return extractText(config.provider, await responseJSON(config.provider, response));
}

export async function generateAIResponse(config, instructions, messages, options = {}) {
  if (!config.apiKey) throw new AIProviderError(503, 'Configure uma chave de API para o provedor selecionado.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 60000);
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    return await callProvider(
      config,
      instructions,
      messages,
      controller.signal,
      options.getGeminiModels,
      options.fetchImpl || fetch,
      options.requestImpl || httpsRequest,
      options.addressResolver || resolvePublicAddress
    );
  } catch (error) {
    if (error instanceof AIProviderError) throw error;
    if (controller.signal.aborted || error.name === 'AbortError') {
      throw new AIProviderError(504, `A chamada ao ${AI_PROVIDERS[config.provider].label} excedeu o tempo limite.`);
    }
    throw new AIProviderError(502, `Não foi possível conectar ao ${AI_PROVIDERS[config.provider].label}.`);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}

export function testAIProvider(config, options = {}) {
  return generateAIResponse(
    config,
    'Responda somente com OK.',
    [{ role: 'user', content: 'Teste de conexão. Responda somente OK.' }],
    options
  );
}
