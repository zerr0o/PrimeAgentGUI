import test from 'node:test';
import assert from 'node:assert/strict';
import { filePresentation, formatJson } from '../public/file-presentation.js';
import { isFileReference } from '../public/file-links.js';

test('file references distinguish local links and source locations from URLs and prose', () => {
  for (const path of [
    'md_files/PLAN.md',
    'C:\\Project\\notes.md',
    'file:///C:/Project/report.pdf',
    'src/app.ts:12:3',
    'src/app.ts#L4-L9',
    'notes.md',
  ])
    assert.equal(isFileReference(path), true, path);
  for (const value of [
    'https://example.com/file.md',
    'javascript:alert(1)',
    '#heading',
    '//example.com/file.md',
    'hello world',
    'x\n.md',
  ])
    assert.equal(isFileReference(value), false, value);
});

test('JSON preview preserves exact literals, duplicate keys and order while indenting', () => {
  const source =
    '{"id":9007199254740993123,"ratio":1.2300e+99,"zero":-0,"id":2,"text":"a \\\"b\\\" \\n","items":[{},[],true,null]}';
  const formatted = formatJson(source);
  assert.match(formatted, /\n  "id": 9007199254740993123,/);
  assert.match(formatted, /"ratio": 1\.2300e\+99/);
  assert.match(formatted, /"zero": -0/);
  assert.equal((formatted.match(/"id":/g) || []).length, 2);
  assert.deepEqual(JSON.parse(formatted), JSON.parse(source));
  assert.equal(formatJson('{"bad":}'), null);
  assert.equal(formatJson('['.repeat(81) + '0' + ']'.repeat(81)), null);
});

test('only supported text formats receive a rendered preview; source remains literal', () => {
  assert.equal(filePresentation('docs/README.MD', '# Titre').kind, 'markdown');
  assert.equal(filePresentation('config.json', '{"enabled":true}').text, '{\n  "enabled": true\n}');
  assert.deepEqual(filePresentation('broken.json', '{bad'), { kind: 'text', text: '{bad' });
  for (const path of ['page.html', 'image.svg', 'plain.txt', 'code.js']) {
    assert.deepEqual(filePresentation(path, '<script>run()</script>'), {
      kind: 'text',
      text: '<script>run()</script>',
    });
  }
});
