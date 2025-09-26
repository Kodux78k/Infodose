
// === OpenRouter Free‑Only Guard — v1 ===
// Purpose: enforce ONE global free model for *all* OpenRouter calls in this app.
// How it works:
//  - If localStorage['dual.freeOnly'] === 'true':
//      • If localStorage['dual.freeModel'] is set, force *that* model on every call.
//      • Else, if payload.model does not look free (':free' substring), block the call and warn.
//  - It never changes non‑OpenRouter requests. Safe to include after other scripts.
//  - This keeps you in full control and prevents accidental paid usage.
//
// Quick setup in the browser console (or wire it in your Brain UI):
//   localStorage.setItem('dual.freeOnly', 'true');
//   localStorage.setItem('dual.freeModel', 'meta-llama/llama-3.1-8b-instruct:free'); // EXAMPLE slug — set yours.

(function(){
  const ORIGIN = 'https://openrouter.ai/api/v1/chat/completions';
  const origFetch = window.fetch;
  if (!origFetch) return;

  function isFreeSlug(model){
    // Conservative heuristic: consider slugs containing ":free" as free.
    // (You can adjust below if your provider uses a different convention.)
    return typeof model === 'string' && /:free\b/i.test(model);
  }
  function getFlag(k){ try { return (localStorage.getItem(k)||'').trim().toLowerCase() === 'true'; } catch { return false; } }
  function getStr(k){ try { return (localStorage.getItem(k)||'').trim(); } catch { return ''; } }

  async function cloneReq(req){
    const headers = {};
    req.headers && req.headers.forEach && req.headers.forEach((v,k)=>headers[k]=v);
    const body = req.method && req.method.toUpperCase() === 'POST' ? await req.clone().text() : undefined;
    return { url: req.url, method: req.method||'GET', headers, body, mode: req.mode, credentials: req.credentials, cache: req.cache, redirect: req.redirect, referrer: req.referrer, integrity: req.integrity };
  }

  function warn(msg){
    try { if (typeof showArchMessage === 'function') showArchMessage(msg, 'warn'); } catch {}
    console.warn('[free-guard]', msg);
  }

  window.fetch = async function(input, init){
    try {
      const url = (typeof input === 'string') ? input : (input && input.url) || '';
      const method = (init && init.method) || (typeof input !== 'string' && input.method) || 'GET';
      const isOR = url.startsWith(ORIGIN) && String(method).toUpperCase() === 'POST';
      if (!isOR) return origFetch(input, init);

      const freeOnly = getFlag('dual.freeOnly');
      if (!freeOnly) return origFetch(input, init);

      // Build a normalized request object we can edit
      let req = null;
      if (typeof input === 'string') {
        req = { url: input, method: method, headers: (init && init.headers) || {}, body: (init && init.body) || '' };
      } else {
        req = await cloneReq(input);
        if (init) {
          // Merge explicit overrides
          req.method = init.method || req.method;
          req.headers = Object.assign({}, req.headers, init.headers||{});
          if (typeof init.body !== 'undefined') req.body = init.body;
        }
      }

      // If body is JSON, inspect/modify
      let payload = {};
      try { payload = req.body ? JSON.parse(req.body) : {}; } catch { payload = {}; }

      const forced = getStr('dual.freeModel'); // e.g., 'meta-llama/llama-3.1-8b-instruct:free'
      if (forced) {
        payload.model = forced;
      } else {
        // No forced slug. If the chosen model doesn't look "free", block.
        if (!isFreeSlug(payload.model||'')) {
          warn('Bloqueado: modelo não marcado como free. Defina localStorage["dual.freeModel"] com um slug free.');
          const res = new Response(JSON.stringify({ error: { message: 'Free‑only guard: modelo não permitido.', type: 'policy' } }), { status: 400, headers: { 'Content-Type': 'application/json' } });
          return res;
        }
      }

      // Rebuild body + headers
      req.body = JSON.stringify(payload);
      if (req.headers && typeof req.headers === 'object') {
        req.headers['Content-Type'] = 'application/json';
      }

      // Dispatch with patched payload
      return origFetch(req.url, { method: req.method||'POST', headers: req.headers, body: req.body, mode: req.mode, credentials: req.credentials, cache: req.cache, redirect: req.redirect, referrer: req.referrer, integrity: req.integrity });
    } catch (e) {
      console.warn('free-guard error:', e);
      return origFetch(input, init);
    }
  };
})();
