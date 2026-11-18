import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import {
  AIProviderError,
  generateAIResponse,
  validateAIProviderConfig
} from '../ai-providers.js';

const prompt = [{ role: 'user', content: 'Oi' }];

test('sends OpenAI requests from the backend using the selected model', async () => {
  let requestUrl;
  let requestOptions;
  const answer = await generateAIResponse({
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'secret-key',
    baseUrl: ''
  }, 'System instruction', prompt, {
    fetchImpl: async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'Resposta OpenAI' } }]
      }));
    }
  });

  assert.equal(requestUrl, 'https://api.openai.com/v1/chat/completions');
  assert.equal(requestOptions.headers.Authorization, 'Bearer secret-key');
  assert.equal(JSON.parse(requestOptions.body).model, 'gpt-test');
  assert.equal(answer, 'Resposta OpenAI');
});

test('sends Gemini requests to the selected model and extracts its response', async () => {
  let requestUrl;
  let requestBody;
  const answer = await generateAIResponse({
    provider: 'gemini',
    model: 'gemini-test-flash',
    apiKey: 'gemini-secret',
    baseUrl: ''
  }, 'System instruction', prompt, {
    fetchImpl: async (url, options) => {
      requestUrl = new URL(url);
      requestBody = JSON.parse(options.body);
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'Resposta Gemini' }] } }]
      }));
    }
  });

  assert.match(requestUrl.pathname, /models\/gemini-test-flash:generateContent$/);
  assert.equal(requestUrl.searchParams.get('key'), 'gemini-secret');
  assert.equal(requestBody.systemInstruction.parts[0].text, 'System instruction');
  assert.equal(answer, 'Resposta Gemini');
});

test('sends Anthropic requests with its required headers and message format', async () => {
  let requestUrl;
  let requestOptions;
  const answer = await generateAIResponse({
    provider: 'anthropic',
    model: 'claude-test',
    apiKey: 'anthropic-secret',
    baseUrl: ''
  }, 'System instruction', prompt, {
    fetchImpl: async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: 'Resposta Claude' }]
      }));
    }
  });

  assert.equal(requestUrl, 'https://api.anthropic.com/v1/messages');
  assert.equal(requestOptions.headers['x-api-key'], 'anthropic-secret');
  assert.equal(requestOptions.headers['anthropic-version'], '2023-06-01');
  assert.equal(JSON.parse(requestOptions.body).model, 'claude-test');
  assert.equal(answer, 'Resposta Claude');
});

test('sends OpenAI-compatible requests to the configured HTTPS endpoint', async () => {
  let requestOptions;
  let requestBody;
  const answer = await generateAIResponse({
    provider: 'openai-compatible',
    model: 'provider/model-x',
    apiKey: 'compatible-secret',
    baseUrl: 'https://api.example.com/v1'
  }, 'System instruction', prompt, {
    addressResolver: async () => ({ address: '93.184.216.34', family: 4 }),
    requestImpl: (options, onResponse) => {
      requestOptions = options;
      const request = new EventEmitter();
      request.setTimeout = () => request;
      request.end = body => {
        requestBody = JSON.parse(body);
        const response = new EventEmitter();
        response.statusCode = 200;
        response.setEncoding = () => {};
        options.lookup(options.hostname, {}, error => {
          assert.ifError(error);
          onResponse(response);
          process.nextTick(() => {
            response.emit('data', JSON.stringify({
              choices: [{ message: { content: 'Resposta compatível' } }]
            }));
            response.emit('end');
            request.emit('close');
          });
        });
      };
      request.destroy = error => {
        if (error) process.nextTick(() => request.emit('error', error));
        return request;
      };
      return request;
    }
  });

  assert.equal(requestOptions.hostname, 'api.example.com');
  assert.equal(requestOptions.path, '/v1/chat/completions');
  assert.equal(requestOptions.headers.Authorization, 'Bearer compatible-secret');
  assert.equal(requestBody.model, 'provider/model-x');
  assert.equal(answer, 'Resposta compatível');
});

test('maps provider authentication failures to a clear message', async () => {
  await assert.rejects(
    generateAIResponse({
      provider: 'openai',
      model: 'gpt-test',
      apiKey: 'invalid-key'
    }, '', prompt, {
      fetchImpl: async () => new Response('{}', { status: 401 })
    }),
    error => error instanceof AIProviderError && /recusou a chave/.test(error.message)
  );
});

test('rejects insecure or private OpenAI-compatible endpoints', () => {
  assert.throws(() => validateAIProviderConfig({
    provider: 'openai-compatible',
    model: 'model-x',
    apiKey: 'secret',
    baseUrl: 'http://api.example.com/v1'
  }), /HTTPS/);
  assert.throws(() => validateAIProviderConfig({
    provider: 'openai-compatible',
    model: 'model-x',
    apiKey: 'secret',
    baseUrl: 'https://127.0.0.1/v1'
  }), /HTTPS/);
  assert.throws(() => validateAIProviderConfig({
    provider: 'openai-compatible',
    model: 'model-x',
    apiKey: 'secret',
    baseUrl: 'https://api.example.com/v1?key=leak'
  }), /HTTPS/);
});

test('accepts a public HTTPS OpenAI-compatible endpoint', () => {
  const config = validateAIProviderConfig({
    provider: 'openai-compatible',
    model: 'provider/model-x',
    apiKey: 'secret',
    baseUrl: 'https://api.example.com/v1'
  });

  assert.equal(config.baseUrl, 'https://api.example.com/v1');
  assert.equal(config.model, 'provider/model-x');
});
