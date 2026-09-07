import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { checkDocumentation, recordDocumentationReview, documentationHash } from '../scripts/check-docs.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'prime-docs-'));
  t.after(async () => {
    assert.equal(dirname(root), resolve(tmpdir()));
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, 'docs'));
  await writeFile(
    join(root, 'docs/documentation.json'),
    JSON.stringify({
      version: 1,
      languages: ['fr', 'en'],
      pages: [{ id: 'readme', fr: 'README.fr.md', en: 'README.md' }],
    }),
  );
  await writeFile(
    join(root, 'README.fr.md'),
    '# Guide français\n\n[English](README.md)\n\n[Image](docs/sample.svg)\n\n## Installation\n\n[Retour](#guide-français)\n',
  );
  await writeFile(
    join(root, 'README.md'),
    '# English guide\n\n[Français](README.fr.md)\n\n![Image](docs/sample.svg)\n\n## Setup\n\n[Top](#english-guide)\n',
  );
  await writeFile(join(root, 'docs/sample.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  return root;
}

test('documentation review records both versions and detects later edits in either language', async (t) => {
  const root = await fixture(t);
  await assert.rejects(recordDocumentationReview([], { root }), /Specify reviewed/);
  await recordDocumentationReview(['readme'], { root });
  assert.deepEqual((await checkDocumentation({ root })).errors, []);
  assert.equal(documentationHash('Line\r\n'), documentationHash('Line\n'));
  const file = join(root, 'README.md');
  await writeFile(file, (await readFile(file, 'utf8')) + '\nNew English instruction.\n');
  assert.ok(
    (await checkDocumentation({ root })).errors.some((error) => error.includes('review both languages')),
  );
  await recordDocumentationReview(['readme'], { root });
  assert.deepEqual((await checkDocumentation({ root })).errors, []);
});

test('documentation checks broken links and anchors, and cannot record a broken pair', async (t) => {
  const root = await fixture(t);
  await writeFile(
    join(root, 'README.md'),
    '# English guide\n\n[Français](README.fr.md)\n\n## Setup\n\n[Missing](README.fr.md#missing)\n\n![Gone](docs/gone.png)\n',
  );
  const { errors } = await checkDocumentation({ root, verifyReviews: false });
  assert.ok(errors.some((error) => error.includes('missing anchor')));
  assert.ok(errors.some((error) => error.includes('missing local target')));
  await assert.rejects(recordDocumentationReview(['readme'], { root }), /missing/);
});

test('documentation checks missing counterparts, unregistered guides and unequal sections', async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, 'docs/new.md'), '# New guide\n');
  await writeFile(join(root, 'README.md'), '# English guide\n\n## Setup\n\n## Extra section\n');
  let result = await checkDocumentation({ root, verifyReviews: false });
  assert.ok(result.errors.some((error) => error.includes('heading structure differs')));
  assert.ok(result.errors.some((error) => error.includes('missing language link')));
  assert.ok(result.errors.some((error) => error.includes('page missing from documentation registry')));
  await unlink(join(root, 'README.fr.md'));
  result = await checkDocumentation({ root, verifyReviews: false });
  assert.ok(result.errors.some((error) => error.includes('cannot read page')));
});
