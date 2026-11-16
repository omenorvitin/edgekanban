import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGeminiModelLoader, orderGeminiModels } from '../gemini-models.js';

test('prefers the newest compatible Flash model and excludes unsupported models', () => {
  const models = orderGeminiModels([
    { name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.8-flash-preview', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-4-pro', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-4-flash', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/other-flash', supportedGenerationMethods: ['generateContent'] }
  ]);

  assert.deepEqual(models, [
    'gemini-3.8-flash',
    'gemini-3.8-flash-preview',
    'gemini-3.6-flash',
    'gemini-4-pro'
  ]);
});

test('uses the first compatible Gemini model when no Flash model is listed', () => {
  const models = orderGeminiModels([
    { name: 'models/gemini-pro', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-reasoning', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['embedContent'] }
  ]);

  assert.deepEqual(models, ['gemini-pro', 'gemini-reasoning']);
});

test('fetches the model list once and caches the result in memory', async () => {
  let calls = 0;
  let requestUrl;
  let requestMethod;
  const getModels = createGeminiModelLoader('test-key', async (url, options) => {
    calls += 1;
    requestUrl = url;
    requestMethod = options.method;
    return new Response(JSON.stringify({
      models: [{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }]
    }));
  });

  const [first, second] = await Promise.all([getModels(), getModels()]);

  assert.equal(calls, 1);
  assert.equal(requestMethod, 'GET');
  assert.equal(requestUrl.pathname, '/v1beta/models');
  assert.equal(requestUrl.searchParams.get('key'), 'test-key');
  assert.deepEqual(first, ['gemini-3.8-flash']);
  assert.deepEqual(second, first);
});

test('logs status and full response text when model discovery fails', async () => {
  const responseBody = '{"error":"invalid API key"}';
  const errors = [];
  const getModels = createGeminiModelLoader('test-key', async () => (
    new Response(responseBody, { status: 403 })
  ), { error: message => errors.push(message) });

  await assert.rejects(getModels(), /status 403/);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /403/);
  assert.ok(errors[0].includes(responseBody));
});
