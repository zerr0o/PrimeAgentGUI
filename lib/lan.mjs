import { createServer, request } from 'node:http';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { imageBodyLimit } from './images.mjs';

export const hashAccessCode = (code, salt) => scryptSync(code, salt, 32).toString('hex');
export function isTailscaleIPv4(address) {
  if (typeof address !== 'string' || isIP(address) !== 4) return false;
  const [first, second] = address.split('.').map(Number);
  return first === 100 && second >= 64 && second <= 127;
}
export function isGatewayPeerAllowed(host, peer) {
  return peer === '127.0.0.1' || (isTailscaleIPv4(host) ? isTailscaleIPv4(peer) : isPrivateIPv4(peer));
}
export function isPrivateIPv4(address) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(String(address))) return false;
  const parts = String(address).split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}
const page = (
  error = '',
) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prime Agent Studio · Accès mobile</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100dvh;background:#1b1c1e;color:#ededea;font:16px/1.6 system-ui,sans-serif;display:grid;place-items:center;padding:24px}main{width:100%;max-width:410px}.brand{width:48px;height:48px;display:grid;place-items:center;background:#b7b2e7;color:#292737;border-radius:14px;font-size:30px;font-weight:700;margin-bottom:36px}h1{font-size:34px;line-height:1.2;letter-spacing:-1px;font-weight:600;margin:0 0 16px}p{color:#aaaab2;margin-bottom:30px}label{display:block;font-size:14px;margin:0 0 10px}input{display:block;width:100%;padding:16px;border:1px solid #575363;border-radius:12px;background:#242528;color:#fff;font:24px system-ui;letter-spacing:6px;text-align:center}input:focus{outline:2px solid #b7b2e7;outline-offset:3px}button{width:100%;background:#b7b2e7;color:#262437;border:0;border-radius:12px;padding:16px;font:600 15px system-ui;margin-top:18px;cursor:pointer}small{display:block;color:#a6a4b5;margin-top:22px;text-align:center;font-size:12px}.error{color:#f0adad;font-size:14px;margin:12px 0}</style></head><body><main><div class="brand">P</div><h1>Votre studio,<br>à portée de main.</h1><p>Retrouvez vos projets et vos sessions depuis votre téléphone.</p><form method="post" action="/lan/login"><label for="code">Code d’accès</label><input id="code" name="code" type="password" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{8,12}" required maxlength="12" placeholder="••••••••" autofocus>${error ? `<div class="error" role="alert">${error}</div>` : ''}<button type="submit">Ouvrir le studio</button></form><small>Accès au studio · réseau local</small></main></body></html>`;

/** Authenticated gateway bound to one LAN or Tailscale address; the engine stays loopback-only. */
export function createLanGateway({ host, upstreamPort, config }) {
  if (!isPrivateIPv4(host) && !isTailscaleIPv4(host) && host !== '127.0.0.1')
    throw new Error('L’accès mobile doit utiliser une adresse locale privée.');
  if (!/^[a-f0-9]{64}$/.test(config?.codeHash) || !/^[a-f0-9]{32}$/.test(config?.salt))
    throw new Error('Configuration du code d’accès invalide.');
  // Existing consultation configurations retain their permissions until explicitly upgraded.
  const readOnly = config.readOnly !== false;
  const sessions = new Map(),
    attempts = new Map();
  const cookieName = 'prime_studio_lan';
  function respond(res, status, data) {
    res.req.resume();
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  }
  function login(res, status, error = '') {
    res.req.resume();
    // Keep same-origin form POSTs identifiable; no-referrer makes browsers send Origin:null.
    res.setHeader('Referrer-Policy', 'same-origin');
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page(error));
  }
  const gateway = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    try {
      const authority = `${host}:${gateway.address()?.port}`;
      const url = new URL(req.url, `http://${authority}`);
      const landingNavigation =
        req.method === 'GET' &&
        (url.pathname === '/' || url.pathname === '/index.html') &&
        req.headers['sec-fetch-mode'] === 'navigate' &&
        req.headers['sec-fetch-dest'] === 'document';
      if (
        req.headers.host !== authority ||
        (req.headers.origin && req.headers.origin !== `http://${authority}`) ||
        (req.headers['sec-fetch-site'] === 'cross-site' && !landingNavigation)
      )
        return respond(res, 403, { error: 'Origine non autorisée.' });
      const peer = req.socket.remoteAddress?.replace(/^::ffff:/, '');
      if (!isGatewayPeerAllowed(host, peer))
        return respond(res, 403, { error: 'Accès limité au réseau privé configuré.' });
      const now = Date.now();
      for (const [token, expiry] of sessions) if (expiry <= now) sessions.delete(token);
      for (const [address, entry] of attempts) if (entry.until <= now) attempts.delete(address);
      if (req.method === 'POST' && url.pathname === '/lan/login') {
        const entry = attempts.get(peer) || { count: 0, until: now + 10 * 60 * 1000 };
        if (entry.count >= 5) {
          res.setHeader('Retry-After', Math.ceil((entry.until - now) / 1000));
          return login(res, 429, 'Trop de tentatives. Réessayez dans quelques minutes.');
        }
        if (!req.headers['content-type']?.startsWith('application/x-www-form-urlencoded'))
          return respond(res, 415, { error: 'Formulaire attendu.' });
        let body = '',
          length = 0;
        for await (const chunk of req) {
          length += chunk.length;
          if (length > 1024) return respond(res, 413, { error: 'Formulaire trop long.' });
          body += chunk;
        }
        const code = (new URLSearchParams(body).get('code') || '').replace(/\s/g, '');
        const match =
          /^\d{8}$/.test(code) &&
          timingSafeEqual(
            Buffer.from(hashAccessCode(code, config.salt), 'hex'),
            Buffer.from(config.codeHash, 'hex'),
          );
        if (!match) {
          entry.count++;
          if (attempts.size >= 256 && !attempts.has(peer)) attempts.delete(attempts.keys().next().value);
          attempts.set(peer, entry);
          return login(res, 401, 'Code incorrect. Réessayez.');
        }
        attempts.delete(peer);
        if (sessions.size >= 64) sessions.delete(sessions.keys().next().value);
        const token = randomBytes(32).toString('hex');
        sessions.set(token, now + 8 * 60 * 60 * 1000);
        res.writeHead(303, {
          Location: '/',
          'Set-Cookie': `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`,
        });
        res.end();
        return;
      }
      const token = (req.headers.cookie || '')
        .split(';')
        .map((s) => s.trim())
        .find((s) => s.startsWith(cookieName + '='))
        ?.slice(cookieName.length + 1);
      if (!token || !sessions.has(token)) {
        if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html'))
          return login(res, 200);
        return respond(res, 401, { error: 'Saisissez votre code d’accès sur la page d’accueil.' });
      }
      const reading = req.method === 'GET' || req.method === 'HEAD';
      if (!reading && readOnly)
        return respond(res, 405, { error: 'Cet accès permet uniquement de consulter les sessions.' });
      // Route and method pairs are explicit; local lifecycle/health endpoints stay private.
      const readRoute =
        /^\/api\/files\/[a-f0-9-]+$/.test(url.pathname) ||
        url.pathname === '/' ||
        url.pathname === '/index.html' ||
        url.pathname.startsWith('/public/') ||
        [
          '/vendor/marked.js',
          '/vendor/purify.js',
          '/api/bootstrap',
          '/api/overview',
          '/api/history',
          '/api/models',
          '/api/version',
          '/api/runs',
        ].includes(url.pathname) ||
        /^\/api\/runs\/[a-f0-9-]+\/events$/.test(url.pathname) ||
        url.pathname === '/api/live/capabilities' ||
        /^\/api\/live\/sessions\/[A-Za-z0-9_-]+$/.test(url.pathname) ||
        (!readOnly && url.pathname === '/api/check-cwd');
      const writeRoute =
        (req.method === 'POST' &&
          (['/api/projects', '/api/runs'].includes(url.pathname) ||
            /^\/api\/runs\/[a-f0-9-]+\/stop$/.test(url.pathname))) ||
        (req.method === 'POST' &&
          /^\/api\/live\/sessions\/[A-Za-z0-9_-]+\/(messages|queue)$/.test(url.pathname)) ||
        (req.method === 'PATCH' && ['/api/projects', '/api/sessions'].includes(url.pathname));
      const allowed = reading ? readRoute : !readOnly && writeRoute;
      if (!allowed) return respond(res, 404, { error: 'Route introuvable.' });
      const headers = { accept: req.headers.accept || '*/*' };
      if (req.headers['last-event-id']) headers['last-event-id'] = req.headers['last-event-id'];
      let body;
      if (!reading) {
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || ''))
          return respond(res, 415, { error: 'Un corps JSON est requis.' });
        const chunks = [];
        let length = 0;
        for await (const chunk of req) {
          length += chunk.length;
          if (length > imageBodyLimit(url.pathname))
            return respond(res, 413, { error: 'La demande dépasse la taille autorisée.' });
          chunks.push(chunk);
        }
        body = Buffer.concat(chunks);
        try {
          const value = JSON.parse(body.toString('utf8'));
          if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
          if (length > 512 * 1024 && !value.images?.length && !value.files?.length)
            return respond(res, 413, { error: 'La demande dépasse 512 Ko.' });
        } catch {
          return respond(res, 400, { error: 'La demande JSON est invalide.' });
        }
        headers['content-type'] = 'application/json';
        headers['content-length'] = body.length;
      }
      const proxy = request(
        {
          hostname: '127.0.0.1',
          port: upstreamPort,
          path: url.pathname + url.search,
          method: req.method,
          headers,
        },
        (upstream) => {
          upstream.on('error', () => res.destroy());
          if (url.pathname === '/api/bootstrap' && upstream.statusCode === 200 && req.method === 'GET') {
            const chunks = [];
            let size = 0;
            upstream.on('data', (chunk) => {
              size += chunk.length;
              if (size > 8 * 1024 * 1024) {
                proxy.destroy();
                return;
              }
              chunks.push(chunk);
            });
            upstream.on('end', () => {
              if (res.destroyed) return;
              try {
                const data = JSON.parse(Buffer.concat(chunks));
                data.preferences = { ...data.preferences, remote: true, readOnly };
                respond(res, 200, data);
              } catch {
                respond(res, 502, { error: 'Impossible de lire le studio local.' });
              }
            });
          } else {
            const forward = { ...upstream.headers };
            delete forward['set-cookie'];
            delete forward.connection;
            delete forward['transfer-encoding'];
            forward['referrer-policy'] = 'same-origin';
            res.writeHead(upstream.statusCode || 502, forward);
            upstream.pipe(res);
          }
        },
      );
      proxy.on('error', () => {
        if (!res.headersSent)
          respond(res, 502, { error: 'Le studio local ne répond pas. Réessayez dans un instant.' });
        else res.destroy();
      });
      proxy.setTimeout(35000, () => proxy.destroy());
      res.on('close', () => proxy.destroy());
      proxy.end(body);
    } catch {
      if (!res.headersSent) respond(res, 500, { error: 'Une erreur est survenue.' });
      else res.end();
    }
  });
  gateway.headersTimeout = 15000;
  gateway.requestTimeout = 20000;
  return gateway;
}
