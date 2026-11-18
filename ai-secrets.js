import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function encryptionKey() {
  const configured = process.env.AI_SETTINGS_ENCRYPTION_KEY?.trim() || '';
  let key;
  if (/^[A-Fa-f0-9]{64}$/.test(configured)) {
    key = Buffer.from(configured, 'hex');
  } else {
    key = Buffer.from(configured, 'base64');
  }
  if (key.length !== 32) {
    const error = new Error(
      'Configure AI_SETTINGS_ENCRYPTION_KEY como uma chave base64 ou hexadecimal de 32 bytes.'
    );
    error.status = 503;
    throw error;
  }
  return key;
}

export function encryptSecret(secret) {
  if (typeof secret !== 'string' || !secret) throw new TypeError('A chave da API está vazia.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptSecret(encrypted) {
  if (typeof encrypted !== 'string') throw new TypeError('A credencial criptografada está inválida.');
  const [version, ivText, tagText, ciphertextText, extra] = encrypted.split('.');
  if (version !== 'v1' || !ivText || !tagText || !ciphertextText || extra !== undefined) {
    throw new Error('O formato da credencial criptografada está inválido.');
  }
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey(),
      Buffer.from(ivText, 'base64url')
    );
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, 'base64url')),
      decipher.final()
    ]).toString('utf8');
  } catch (error) {
    if (error.status) throw error;
    const decryptError = new Error(
      'Não foi possível descriptografar a chave. Verifique se AI_SETTINGS_ENCRYPTION_KEY não foi alterada.'
    );
    decryptError.status = 503;
    throw decryptError;
  }
}
