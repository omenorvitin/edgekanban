import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchGeminiWithRetry } from '../gemini-retry.js';

test('retries Gemini overload and returns a later successful response', async () => {
  let calls = 0;
  const response = await fetchGeminiWithRetry('https://example.test', {
    signal: new AbortController().signal
  }, async () => {
    calls += 1;
    return calls === 1
      ? new Response('busy', { status: 503, headers: { 'retry-after': '0' } })
      : new Response('ok', { status: 200 });
  });

  assert.equal(calls, 2);
  assert.equal(response.status, 200);
});

test('does not retry non-overload errors', async () => {
  let calls = 0;
  const response = await fetchGeminiWithRetry('https://example.test', {}, async () => {
    calls += 1;
    return new Response('invalid key', { status: 400 });
  });

  assert.equal(calls, 1);
  assert.equal(response.status, 400);
});

test('limits overload requests to three attempts', async () => {
  let calls = 0;
  const response = await fetchGeminiWithRetry('https://example.test', {}, async () => {
    calls += 1;
    return new Response('busy', { status: 503, headers: { 'retry-after': '0' } });
  });

  assert.equal(calls, 3);
  assert.equal(response.status, 503);
});
