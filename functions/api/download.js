// SK YT Download - Cloudflare Pages Function

const UPSTREAM = 'https://vidkraken.com/api/v2';
const FALLBACK_KEY = '4b025ffe-6a41-4a81-9fe3-ea49a487c9c1';

const FORMATS = new Set(['1080', '720', '480', '360', 'audio', 'audio-aac', 'audio-mp3']);
const YOUTUBE_URL = /^https:\/\/(youtu\.be\/[A-Za-z0-9_-]{11}|(www\.)?youtube\.com\/(watch\?v=|live\/|shorts\/)[A-Za-z0-9_-]{11})/;
const JOB_ID = /^[A-Za-z0-9_-]{6,64}$/;
const IDEMPOTENCY = /^[\x21-\x7e]{1,255}$/;

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra }
  });
}

export async function onRequest(context) {
  try {
    const { request, env, params } = context;
    const url = new URL(request.url);

    const origin = request.headers.get('Origin');
    if (origin) {
      let ok = false;
      try { ok = new URL(origin).host === url.host; } catch (_) {}
      if (!ok) return json({ error: 'Forbidden origin', code: 'FORBIDDEN' }, 403);
    }

    const key = env.VIDKRAKEN_API_KEY || FALLBACK_KEY;
    const rawPath = params.path;
    const parts = typeof rawPath === 'string' 
      ? rawPath.split('/').filter(Boolean) 
      : (Array.isArray(rawPath) ? rawPath : []);

    let target;
    const init = { method: request.method, headers: { Authorization: 'Bearer ' + key } };

    if (request.method === 'POST' && parts.length === 0) {
      let body;
      try { body = await request.json(); } catch (_) {
        return json({ error: 'Invalid JSON body', code: 'INVALID_REQUEST' }, 400);
      }
      const videoUrl = body && typeof body.url === 'string' ? body.url : '';
      const format = body && body.format;
      if (!YOUTUBE_URL.test(videoUrl)) return json({ error: 'Enter a valid YouTube link', code: 'INVALID_REQUEST' }, 400);
      if (!FORMATS.has(format)) return json({ error: 'Invalid format', code: 'INVALID_REQUEST' }, 400);

      init.body = JSON.stringify({ url: videoUrl, format });
      init.headers['Content-Type'] = 'application/json';
      const idem = request.headers.get('Idempotency-Key');
      if (idem && IDEMPOTENCY.test(idem)) init.headers['Idempotency-Key'] = idem;
      target = UPSTREAM + '/download';
    } else if (request.method === 'GET' && parts.length === 1 && JOB_ID.test(parts[0])) {
      target = UPSTREAM + '/download/' + parts[0];
    } else {
      return json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
    }

    let res;
    try {
      res = await fetch(target, init);
    } catch (_) {
      return json({ error: 'The download service is unreachable. Try again shortly.', code: 'UNAVAILABLE' }, 503);
    }

    let responseBody = null;
    try {
      responseBody = await res.text();
    } catch (_) {
      responseBody = JSON.stringify({ error: 'Upstream response error', code: 'UPSTREAM_ERROR' });
    }

    return new Response(responseBody, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('Content-Type') || 'application/json',
        'Cache-Control': 'no-store'
      }
    });
  } catch (err) {
    return json({ error: err.message || 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}