import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchGeminiWithFallback, fetchGeminiWithRetry } from '../gemini-retry.js';

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

test('uses the fallback model after repeated primary overloads', async () => {
  let calls = 0;
  const primaryUrl = new URL('https://example.test/models/gemini-3.8-flash:generateContent');
  const fallbackUrl = new URL('https://example.test/models/gemini-3.5-flash-lite:generateContent');
  const result = await fetchGeminiWithFallback([primaryUrl, fallbackUrl], {
    signal: new AbortController().signal
  }, async url => {
    calls += 1;
    return url === primaryUrl
      ? new Response('busy', { status: 503, headers: { 'retry-after': '0' } })
      : new Response('ok', { status: 200 });
  });

  assert.equal(calls, 4);
  assert.equal(result.response.status, 200);
  assert.equal(result.requestUrl, fallbackUrl);
  assert.equal(result.fallbackUsed, true);
});

test('continues through compatible models until one succeeds', async () => {
  const modelUrls = [
    new URL('https://example.test/models/gemini-newest-flash:generateContent'),
    new URL('https://example.test/models/gemini-next-flash:generateContent'),
    new URL('https://example.test/models/gemini-compatible:generateContent')
  ];
  let calls = 0;
  const result = await fetchGeminiWithFallback(modelUrls, {
    signal: new AbortController().signal
  }, async url => {
    calls += 1;
    return url === modelUrls[2]
      ? new Response('ok', { status: 200 })
      : new Response('busy', { status: 503, headers: { 'retry-after': '0' } });
  });

  assert.equal(calls, 7);
  assert.equal(result.response.status, 200);
  assert.equal(result.requestUrl, modelUrls[2]);
  assert.equal(result.fallbackUsed, true);
});
