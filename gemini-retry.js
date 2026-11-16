const MAX_ATTEMPTS = 3;

function retryDelay(response, attempt) {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) return Math.max(0, retryAt - Date.now());
  }
  return 1000 * (2 ** attempt);
}

function waitForRetry(delay, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new Error('Request aborted'));
      return;
    }

    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason || new Error('Request aborted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delay);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function fetchGeminiWithRetry(url, options, fetchImpl = fetch) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const response = await fetchImpl(url, options);
    if (response.status !== 503 || attempt === MAX_ATTEMPTS - 1) return response;
    await response.body?.cancel();
    await waitForRetry(retryDelay(response, attempt), options.signal);
  }
}

export async function fetchGeminiWithFallback(urls, options, fetchImpl = fetch) {
  for (let index = 0; index < urls.length; index += 1) {
    const response = await fetchGeminiWithRetry(urls[index], options, fetchImpl);
    if (response.status !== 503 || index === urls.length - 1) {
      return { response, requestUrl: urls[index], fallbackUsed: index > 0 };
    }
    await response.body?.cancel();
  }
}
