import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decryptSecret, encryptSecret } from '../ai-secrets.js';

const originalKey = process.env.AI_SETTINGS_ENCRYPTION_KEY;
const validKey = Buffer.alloc(32, 7).toString('base64');

test('encrypts API keys at rest and decrypts them only with the configured master key', () => {
  process.env.AI_SETTINGS_ENCRYPTION_KEY = validKey;
  const plaintext = 'provider-api-secret';
  const ciphertext = encryptSecret(plaintext);

  assert.notEqual(ciphertext, plaintext);
  assert.equal(ciphertext.includes(plaintext), false);
  assert.equal(decryptSecret(ciphertext), plaintext);
});

test('rejects missing encryption key instead of storing an unencrypted credential', () => {
  delete process.env.AI_SETTINGS_ENCRYPTION_KEY;
  assert.throws(
    () => encryptSecret('provider-api-secret'),
    error => error.status === 503 && /AI_SETTINGS_ENCRYPTION_KEY/.test(error.message)
  );
});

test('does not decrypt credentials with a different master key', () => {
  process.env.AI_SETTINGS_ENCRYPTION_KEY = validKey;
  const ciphertext = encryptSecret('provider-api-secret');
  process.env.AI_SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString('base64');
  assert.throws(() => decryptSecret(ciphertext), /não foi possível descriptografar/i);
});

test.after(() => {
  if (originalKey === undefined) delete process.env.AI_SETTINGS_ENCRYPTION_KEY;
  else process.env.AI_SETTINGS_ENCRYPTION_KEY = originalKey;
});
