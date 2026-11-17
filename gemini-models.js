function modelVersion(name) {
  const match = name.match(/^gemini-(\d+(?:\.\d+)*)(?:-|$)/i);
  return match ? match[1].split('.').map(Number) : [];
}

function compareFlashModels(a, b) {
  const aVersion = modelVersion(a);
  const bVersion = modelVersion(b);
  for (let index = 0; index < Math.max(aVersion.length, bVersion.length); index += 1) {
    const difference = (bVersion[index] || 0) - (aVersion[index] || 0);
    if (difference) return difference;
  }

  const aPreview = /preview|experimental/i.test(a);
  const bPreview = /preview|experimental/i.test(b);
  if (aPreview !== bPreview) return aPreview ? 1 : -1;

  const aLite = /flash-lite/i.test(a);
  const bLite = /flash-lite/i.test(b);
  if (aLite !== bLite) return aLite ? 1 : -1;
  return a.localeCompare(b);
}

export function orderGeminiModels(models) {
  if (!Array.isArray(models)) return [];

  const compatible = [];
  const seen = new Set();
  for (const model of models) {
    if (typeof model?.name !== 'string' ||
      !model.name.startsWith('models/gemini-') ||
      !Array.isArray(model.supportedGenerationMethods) ||
      !model.supportedGenerationMethods.includes('generateContent')) continue;
    const name = model.name.slice('models/'.length);
    if (!seen.has(name)) {
      seen.add(name);
      compatible.push(name);
    }
  }

  const flashModels = compatible.filter(name => /flash/i.test(name)).sort(compareFlashModels);
  return [...flashModels, ...compatible.filter(name => !/flash/i.test(name))];
}

export function createGeminiModelLoader(apiKey, fetchImpl = fetch, logger = console) {
  let modelsPromise;
  return function getGeminiModels() {
    if (!modelsPromise) {
      modelsPromise = fetchGeminiModels(apiKey, fetchImpl, logger).catch(error => {
        modelsPromise = undefined;
        throw error;
      });
    }
    return modelsPromise;
  };
}

async function fetchGeminiModels(apiKey, fetchImpl, logger) {
  const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
  url.searchParams.set('key', apiKey);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let response;
  let responseText;
  try {
    response = await fetchImpl(url, { method: 'GET', signal: controller.signal });
    responseText = await response.text();
  } catch (error) {
    logger.error('Falha ao consultar os modelos do Gemini:', error.message);
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    logger.error(`Gemini models respondeu com status ${response.status}: ${responseText}`);
    throw new Error(`Gemini models respondeu com status ${response.status}.`);
  }

  let data;
  try {
    data = JSON.parse(responseText);
  } catch (error) {
    logger.error(`Resposta inválida da API de modelos do Gemini (status ${response.status}): ${responseText}`);
    throw new Error(`Resposta inválida da API de modelos do Gemini: ${error.message}`);
  }

  const models = orderGeminiModels(data.models);
  if (!models.length) {
    logger.error(`Nenhum modelo Gemini compatível (status ${response.status}): ${responseText}`);
    throw new Error('Nenhum modelo Gemini compatível com generateContent está disponível.');
  }
  return models;
}
