// Standalone HTTP/browser fixture. No Prime Agent runtime or real session is contacted.
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve('.');
const fixture = {
  available: true,
  steering: ['Priorité un', 'Priorité deux'],
  followUps: ['Après la réponse'],
  failNext: false,
  delayNext: 0,
  unavailableSnapshot: false,
};
const requests = [],
  accepted = new Map();
const json = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
};
const client = `import {createLiveMessages} from '/public/live-messages.js';
const state={runId:'fixture-run',sessionId:'fixture-session',cwd:'C:\\\\fixture\\\\project',running:true,stopping:false,readOnly:false,online:true};
const sent=[],errors=[];
const composer=document.getElementById('composer');
document.getElementById('welcome').hidden=true;
document.getElementById('project-overview').hidden=true;
document.getElementById('remote-view-banner').hidden=true;
document.getElementById('run-status').hidden=false;
document.getElementById('run-status-label').textContent='Exécution de vérification';
document.getElementById('model-picker-label').textContent='Modèle de vérification très long';
document.getElementById('thinking-select').value='xhigh';
const api=async(path,options={})=>{const response=await fetch(path,{method:options.method||'GET',signal:options.signal,headers:options.body?{'Content-Type':'application/json'}:undefined,body:options.body?JSON.stringify(options.body):undefined});const value=await response.json();if(!response.ok){const error=new Error(value.error);error.status=response.status;throw error;}return value;};
let live;
const update=()=>{document.getElementById('send-button').disabled=!composer.value.trim();document.getElementById('send-button').hidden=state.running;document.getElementById('stop-button').hidden=!state.running;live?.update();};
live=createLiveMessages({api,getContext:()=>state,onSent:(value,detail)=>{sent.push({value,detail});update();},onError:error=>errors.push(error.message)});
composer.addEventListener('input',update);
document.getElementById('composer-form').addEventListener('submit',event=>{event.preventDefault();void live.submitDraft();});
window.fixtureUI={state,sent,errors,live,setContext:(value)=>{Object.assign(state,value);update();}};update();
`;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/') {
      const html = (await readFile(resolve(root, 'index.html'), 'utf8')).replace(
        '/public/app.js',
        '/fixture.js',
      );
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (url.pathname === '/fixture.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      res.end(client);
      return;
    }
    if (/^\/public\/[a-zA-Z0-9._-]+$/.test(url.pathname)) {
      const content = await readFile(resolve(root, '.' + url.pathname));
      res.writeHead(200, { 'Content-Type': url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript' });
      res.end(content);
      return;
    }
    if (url.pathname.startsWith('/api/live/sessions/')) {
      if (req.method === 'GET')
        return fixture.available
          ? json(res, 200, {
              available: !fixture.unavailableSnapshot,
              steering: fixture.steering,
              followUps: fixture.followUps,
            })
          : json(res, 404, { error: 'Session indisponible' });
      let body = '';
      for await (const chunk of req) body += chunk;
      body = JSON.parse(body);
      requests.push({ path: url.pathname, body });
      if (url.pathname.endsWith('/messages')) {
        if (fixture.failNext) {
          fixture.failNext = false;
          return json(res, 503, { error: 'Réseau temporairement indisponible' });
        }
        if (fixture.delayNext) {
          const delay = fixture.delayNext;
          fixture.delayNext = 0;
          await new Promise((done) => setTimeout(done, delay));
        }
        if (!['steer', 'follow_up'].includes(body.mode)) return json(res, 400, { error: 'Mode invalide' });
        if (!accepted.has(body.requestId)) {
          (body.mode === 'steer' ? fixture.steering : fixture.followUps).push(body.message);
          accepted.set(body.requestId, body.message);
        }
        return json(res, 200, { accepted: true, deliveryStatus: 'queued' });
      }
      if (url.pathname.endsWith('/queue')) {
        const lane = body.lane === 'steering' ? fixture.steering : fixture.followUps;
        if (lane[body.index] !== body.expectedText) return json(res, 409, { error: 'La file a changé' });
        const mutation = body.mutation;
        if (mutation.type === 'delete') lane.splice(body.index, 1);
        else if (mutation.type === 'move') {
          const target = body.index + mutation.direction;
          if (target < 0 || target >= lane.length) return json(res, 400, { error: 'Position invalide' });
          const [value] = lane.splice(body.index, 1);
          lane.splice(target, 0, value);
        } else if (mutation.type === 'replace') {
          const target = mutation.lane === 'steering' ? fixture.steering : fixture.followUps;
          if (target === lane) lane[body.index] = mutation.text;
          else {
            lane.splice(body.index, 1);
            target.push(mutation.text);
          }
        } else return json(res, 400, { error: 'Mutation invalide' });
        return json(res, 200, { accepted: true });
      }
    }
    json(res, 404, { error: 'Fixture route introuvable' });
  } catch (error) {
    json(res, 500, { error: error.message });
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}`;
const checks = [];
let browser, page;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  page = await browser.newPage({ locale: 'fr-FR', viewport: { width: 390, height: 844 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(url);
  await expect(page.locator('.live-queue-count')).toHaveText('3');
  await expect(page.locator('#stop-button')).toBeVisible();
  await expect(page.locator('#send-button')).toBeHidden();
  await expect(page.locator('#live-mode-row')).toBeHidden();
  await page.locator('#composer').fill('Mon brouillon préservé');
  await expect(page.locator('#send-button')).toBeEnabled();
  await expect(page.locator('#stop-button')).toBeVisible();
  await expect(page.locator('#live-mode-row')).toBeVisible();
  await expect(page.locator('[data-mode="steer"]')).toHaveAttribute('aria-pressed', 'true');
  await mkdir(resolve(root, 'test-results'), { recursive: true });
  for (const width of [320, 390, 480, 760, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const boxes = await page.evaluate(() =>
      ['#stop-button', '#send-button', '#model-picker-button', '#thinking-select'].map((selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return {
          selector,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      }),
    );
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i],
          b = boxes[j];
        const overlap =
          Math.min(a.right, b.right) > Math.max(a.left, b.left) + 0.5 &&
          Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 0.5;
        expect(overlap, `${a.selector} overlaps ${b.selector} at ${width}px`).toBe(false);
      }
    for (const box of boxes) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(width + 1);
    }
    for (const box of boxes.slice(0, 2)) {
      expect(box.width).toBe(44);
      expect(box.height).toBe(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({
      path: resolve(root, 'test-results', `live-message-draft-${width}.png`),
      animations: 'disabled',
    });
  }
  checks.push(
    'Brouillon actif : envoyer et arrêter restent accessibles, boutons de 44 px sans chevauchement sur cinq largeurs',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#live-queue > summary').click();
  const mobileTargets = await page.locator('.live-mode-option, .live-queue-action').evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return { width: box.width, height: box.height };
    }),
  );
  for (const target of mobileTargets) {
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
  }
  const rows = page.locator('.live-queue-item');
  await rows
    .filter({ hasText: 'Priorité un' })
    .getByRole('button', { name: 'Modifier le message', exact: true })
    .click();
  await page.locator('#live-queue-edit-text').fill('Priorité modifiée');
  await page.locator('#live-queue-editor').getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(rows.filter({ hasText: 'Priorité modifiée' })).toHaveCount(1);
  await expect(page.locator('#composer')).toHaveValue('Mon brouillon préservé');
  await rows
    .filter({ hasText: 'Priorité deux' })
    .getByRole('button', { name: 'Monter le message', exact: true })
    .click();
  await expect(page.locator('.live-queue-lane[data-lane="steering"] .live-queue-text').first()).toHaveText(
    'Priorité deux',
  );
  await rows
    .filter({ hasText: 'Priorité modifiée' })
    .getByRole('button', { name: 'Passer à la suite', exact: true })
    .click();
  await expect(page.locator('.live-queue-lane[data-lane="followUp"]')).toContainText('Priorité modifiée');
  await rows
    .filter({ hasText: 'Après la réponse' })
    .getByRole('button', { name: 'Retirer le message', exact: true })
    .click();
  await expect(rows.filter({ hasText: 'Après la réponse' })).toHaveCount(0);
  await expect(page.locator('#composer')).toHaveValue('Mon brouillon préservé');
  checks.push(
    'File native : édition indépendante du brouillon, réorganisation, changement de voie et suppression',
  );

  await page.locator('[data-mode="follow_up"]').click();
  await page.locator('#send-button').click();
  await expect(page.locator('#composer')).toHaveValue('');
  expect(requests.filter((request) => request.path.endsWith('/messages')).at(-1).body.mode).toBe('follow_up');
  await expect(rows.filter({ hasText: 'Mon brouillon préservé' })).toHaveCount(1);
  await expect(page.locator('#messages')).toBeEmpty();
  await page.locator('#composer').fill('Nouvelle consigne urgente');
  await page.locator('[data-mode="steer"]').click();
  fixture.failNext = true;
  await page.locator('#send-button').click();
  await expect.poll(() => page.evaluate(() => window.fixtureUI.errors.length)).toBe(1);
  await expect(page.locator('#composer')).toHaveValue('Nouvelle consigne urgente');
  await page.locator('#send-button').click();
  await expect(page.locator('#composer')).toHaveValue('');
  const sendRequests = requests.filter((request) => request.path.endsWith('/messages'));
  expect(sendRequests.at(-1).body.requestId).toBe(sendRequests.at(-2).body.requestId);
  expect(sendRequests.at(-1).body.mode).toBe('steer');
  checks.push(
    'Envoi steering/follow-up, aucune duplication optimiste du transcript, brouillon et clé d’idempotence conservés après échec',
  );

  fixture.delayNext = 300;
  await page.locator('#composer').fill('Message accepté plus tard');
  await page.locator('#send-button').click();
  await page.locator('#composer').fill('');
  await page.locator('#composer').fill('Message accepté plus tard');
  await expect.poll(() => page.evaluate(() => window.fixtureUI.sent.length)).toBe(3);
  await expect(page.locator('#composer')).toHaveValue('Message accepté plus tard');
  await rows
    .filter({ hasText: 'Priorité deux' })
    .getByRole('button', { name: 'Modifier le message', exact: true })
    .click();
  await page.locator('#live-queue-edit-text').fill('Modification conservée après consommation');
  fixture.steering.shift();
  await page.evaluate(() => window.fixtureUI.live.refresh());
  await expect(page.locator('.live-queue-edit-notice')).toBeVisible();
  await expect(page.locator('#live-queue-edit-text')).toHaveValue(
    'Modification conservée après consommation',
  );
  await expect(page.locator('.live-queue-save')).toBeDisabled();
  await expect(page.locator('#composer')).toHaveValue('Message accepté plus tard');
  checks.push(
    'Courses : un nouveau brouillon survit à l’acceptation précédente et une édition survit à la consommation du message',
  );
  fixture.delayNext = 350;
  const previousRequestCount = requests.filter((request) => request.path.endsWith('/messages')).length;
  const previousAcceptedCount = accepted.size;
  await page.locator('#composer').fill('Consigne identique pour une nouvelle exécution');
  await page.locator('#send-button').click();
  await expect
    .poll(() => requests.filter((request) => request.path.endsWith('/messages')).length)
    .toBe(previousRequestCount + 1);
  await page.evaluate(() => window.fixtureUI.setContext({ runId: 'fixture-next-run' }));
  await page.locator('#composer').fill('Consigne identique pour une nouvelle exécution');
  await expect.poll(() => accepted.size).toBe(previousAcceptedCount + 1);
  await expect(page.locator('#composer')).toHaveValue('Consigne identique pour une nouvelle exécution');
  expect(await page.evaluate(() => window.fixtureUI.sent.length)).toBe(3);
  await page.locator('#send-button').click();
  await expect(page.locator('#composer')).toHaveValue('');
  await expect.poll(() => page.evaluate(() => window.fixtureUI.sent.length)).toBe(4);
  const differentRunRequests = requests.filter((request) => request.path.endsWith('/messages')).slice(-2);
  expect(differentRunRequests[0].body.requestId).not.toBe(differentRunRequests[1].body.requestId);
  checks.push(
    'Une réponse tardive de l’exécution précédente conserve le brouillon identique du nouveau run ; sa clé de retry est renouvelée',
  );
  await page.reload();
  await expect(page.locator('.live-queue-count')).toHaveText(
    String(fixture.steering.length + fixture.followUps.length),
  );
  await page.locator('#composer').fill('Essai indisponible');
  fixture.available = false;
  await page.evaluate(() => window.fixtureUI.live.refresh());
  await expect(page.locator('#send-button')).toBeDisabled();
  await expect(page.locator('#live-message-status')).toContainText('pas disponible');
  await expect(page.locator('#composer')).toHaveValue('Essai indisponible');
  fixture.available = true;
  await page.evaluate(() => window.fixtureUI.live.refresh());
  await expect(page.locator('#send-button')).toBeEnabled();
  await page.evaluate(() => window.fixtureUI.setContext({ online: false }));
  await expect(page.locator('#send-button')).toBeDisabled();
  fixture.followUps.push('Message ajouté pendant la déconnexion');
  await page.evaluate(() => window.fixtureUI.setContext({ online: true }));
  await expect(page.locator('.live-queue-count')).toHaveText(
    String(fixture.steering.length + fixture.followUps.length),
  );
  await expect(page.locator('#send-button')).toBeEnabled();
  fixture.steering = [];
  fixture.followUps = [];
  await page.evaluate(() =>
    window.fixtureUI.setContext({ runId: 'availability-transition-run', running: true }),
  );
  await page.evaluate(() => window.fixtureUI.live.refresh());
  await expect(page.locator('#send-button')).toBeEnabled();
  fixture.unavailableSnapshot = true;
  await page.evaluate(() => window.fixtureUI.setContext({ running: false }));
  await page.evaluate(() => window.fixtureUI.live.refresh());
  fixture.unavailableSnapshot = false;
  await page.evaluate(() => {
    window.fixtureUI.setContext({ running: true });
    window.fixtureUI.streamUpdates = setInterval(() => window.fixtureUI.live.update(), 10);
  });
  try {
    await expect(page.locator('#send-button')).toBeEnabled({ timeout: 2500 });
  } finally {
    await page.evaluate(() => clearInterval(window.fixtureUI.streamUpdates));
  }
  checks.push(
    'Après un snapshot idle indisponible, une reprise de la même session réarme le polling malgré des mises à jour de streaming fréquentes',
  );
  await page.evaluate(() => window.fixtureUI.setContext({ running: false }));
  await expect(page.locator('#stop-button')).toBeHidden();
  await expect(page.locator('#send-button')).toBeVisible();
  await expect(page.locator('#live-mode-row')).toBeHidden();
  expect(pageErrors).toEqual([]);
  checks.push('Rechargement de la file native et disponibilité 404 gérée sans perdre le brouillon');
  await writeFile(
    resolve(root, 'test-results', 'live-messages-ui-report.json'),
    JSON.stringify({ passed: true, checks }, null, 2),
  );
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} catch (error) {
  console.error(error);
  if (page)
    await page
      .screenshot({
        path: resolve(root, 'test-results', 'live-messages-ui-failure.png'),
        animations: 'disabled',
      })
      .catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
