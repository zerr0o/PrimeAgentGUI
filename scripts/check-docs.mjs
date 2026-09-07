import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const documentationHash = (text) =>
  createHash('sha256').update(text.replace(/\r\n?/g, '\n')).digest('hex');
const slug = (text) =>
  text
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}_ -]/gu, '')
    .replace(/ /g, '-');

function parseDocument(source) {
  const links = [],
    headings = [],
    anchors = new Set(),
    counts = new Map(),
    seen = new WeakSet();
  function heading(depth, text) {
    headings.push(depth);
    const base = slug(text),
      count = counts.get(base) || 0;
    counts.set(base, count + 1);
    anchors.add(base + (count ? '-' + count : ''));
  }
  function walk(token) {
    if (!token || typeof token !== 'object' || seen.has(token)) return;
    seen.add(token);
    if (token.type === 'code' || token.type === 'codespan') return;
    if (token.type === 'heading') heading(token.depth, token.text);
    if (token.type === 'link' || token.type === 'image') links.push(token.href);
    if (token.type === 'html') {
      for (const match of token.text.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/g))
        links.push(match[1].replaceAll('&amp;', '&'));
      for (const match of token.text.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g))
        heading(Number(match[1]), match[2]);
      for (const match of token.text.matchAll(/\b(?:id|name)\s*=\s*["']([^"']+)["']/g)) anchors.add(match[1]);
    }
    for (const value of Object.values(token)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') walk(value);
    }
  }
  marked.lexer(source).forEach(walk);
  return { links, headings, anchors };
}

export async function checkDocumentation({ root = ROOT, verifyReviews = true } = {}) {
  const manifest = JSON.parse(await readFile(resolve(root, 'docs/documentation.json'), 'utf8'));
  const errors = [],
    documents = new Map(),
    ids = new Set(),
    registered = new Set();
  if (manifest.version !== 1 || !Array.isArray(manifest.pages) || !Array.isArray(manifest.languages))
    throw new Error('Invalid documentation registry.');
  const languages = manifest.languages;
  if (
    !languages.includes('fr') ||
    !languages.includes('en') ||
    new Set(languages).size !== languages.length ||
    languages.some((id) => !/^[a-z]{2,3}$/.test(id))
  )
    throw new Error('Invalid documentation languages.');
  const insideRoot = (file) => file === resolve(root) || file.startsWith(resolve(root) + sep);
  for (const page of manifest.pages) {
    if (!/^[a-z][a-z0-9-]*$/.test(page.id) || ids.has(page.id))
      errors.push(`Invalid or duplicate page ID: ${page.id}`);
    ids.add(page.id);
    const variants = [];
    for (const language of languages) {
      const path = page[language];
      if (
        typeof path !== 'string' ||
        !/^(?:README(?:\.[a-z]+)?\.md|docs\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.md)$/.test(path) ||
        registered.has(path)
      ) {
        errors.push(`${page.id}: invalid or duplicate ${language} path`);
        continue;
      }
      registered.add(path);
      try {
        const source = await readFile(resolve(root, path), 'utf8');
        const document = { ...parseDocument(source), source, hash: documentationHash(source), path };
        documents.set(path, document);
        variants.push(document);
        if (verifyReviews && page.reviewed?.[language] !== document.hash)
          errors.push(
            `${page.id}: review both languages after changes to ${path}, then run npm run docs:sync -- ${page.id}`,
          );
      } catch (error) {
        errors.push(`${path}: cannot read page (${error.code || error.message})`);
      }
    }
    if (variants.length === languages.length) {
      const reference = JSON.stringify(variants[0].headings);
      if (
        !variants[0].headings.length ||
        variants.some((variant) => JSON.stringify(variant.headings) !== reference)
      )
        errors.push(`${page.id}: heading structure differs between languages`);
      for (const variant of variants) {
        const targets = new Set(
          variant.links
            .filter((href) => !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(href))
            .map((href) => resolve(root, dirname(variant.path), decodeURIComponent(href.split('#')[0]))),
        );
        for (const other of variants)
          if (variant !== other && !targets.has(resolve(root, other.path)))
            errors.push(`${variant.path}: missing language link to ${other.path}`);
      }
    }
  }
  const inventory = (await readdir(root)).filter((name) => /^README(?:\.[a-z]+)?\.md$/.test(name));
  async function scan(folder) {
    for (const item of await readdir(resolve(root, folder), { withFileTypes: true })) {
      const path = folder + '/' + item.name;
      if (item.isDirectory()) await scan(path);
      else if (item.isFile() && item.name.endsWith('.md')) inventory.push(path);
    }
  }
  await scan('docs');
  for (const path of inventory)
    if (!registered.has(path)) errors.push(`${path}: page missing from documentation registry`);
  let linkCount = 0;
  for (const document of documents.values()) {
    for (const href of document.links) {
      if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(href)) continue;
      linkCount++;
      let path, anchor;
      try {
        const separator = href.indexOf('#');
        path = decodeURIComponent((separator < 0 ? href : href.slice(0, separator)).split('?')[0]);
        anchor = separator < 0 ? '' : decodeURIComponent(href.slice(separator + 1));
      } catch {
        errors.push(`${document.path}: invalid URL ${href}`);
        continue;
      }
      const target = path ? resolve(root, dirname(document.path), path) : resolve(root, document.path);
      if (!insideRoot(target) || !(await stat(target).catch(() => null))) {
        errors.push(`${document.path}: missing local target ${href}`);
        continue;
      }
      if (anchor && target.endsWith('.md')) {
        const key = relative(root, target).split(sep).join('/');
        let parsed = documents.get(key);
        if (!parsed) parsed = parseDocument(await readFile(target, 'utf8'));
        if (!parsed.anchors.has(anchor)) errors.push(`${document.path}: missing anchor ${href}`);
      }
    }
  }
  return { errors, manifest, documents, linkCount };
}

export async function recordDocumentationReview(ids, { root = ROOT } = {}) {
  if (!ids.length)
    throw new Error('Specify reviewed page IDs, for example: npm run docs:sync -- readme configuration');
  const result = await checkDocumentation({ root, verifyReviews: false });
  if (result.errors.length) throw new Error(result.errors.join('\n'));
  const wanted = new Set(ids);
  for (const id of wanted)
    if (!result.manifest.pages.some((page) => page.id === id))
      throw new Error(`Unknown documentation page: ${id}`);
  for (const page of result.manifest.pages)
    if (wanted.has(page.id)) {
      page.reviewed = Object.fromEntries(
        result.manifest.languages.map((language) => [language, result.documents.get(page[language]).hash]),
      );
    }
  const path = resolve(root, 'docs/documentation.json');
  const { format, resolveConfig } = await import('prettier');
  await writeFile(
    path,
    await format(JSON.stringify(result.manifest), { ...(await resolveConfig(path)), parser: 'json' }),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args[0] === '--record') await recordDocumentationReview(args.slice(1));
    else if (args.length) throw new Error('Usage: node scripts/check-docs.mjs [--record page-id ...]');
    const result = await checkDocumentation();
    if (result.errors.length) throw new Error(result.errors.join('\n'));
    console.log(
      `${result.manifest.pages.length} documentation pairs and ${result.linkCount} local links verified (${result.manifest.languages.join(' / ')}).`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
