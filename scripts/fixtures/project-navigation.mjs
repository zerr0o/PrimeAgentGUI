import { mkdir, writeFile, utimes } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createStabilityFixture } from './session-stability.mjs';

export async function createNavigationFixture() {
  const fixture = await createStabilityFixture();
  const projects = [
    [fixture.cwd, true, 'SoundsPerfect'],
    [join(fixture.root, 'Atelier'), true, 'Atelier'],
    [join(fixture.root, 'Documentation'), false, 'Documentation'],
  ];
  const titles = [
    'Comparer les mesures avant et après calibration',
    'Préparer la prochaine version Windows',
    'Retrouver les décisions sur les filtres Dirac',
    'Améliorer la lisibilité des courbes',
    'Vérifier le chemin des fichiers audio',
    'Une ancienne conversation à retrouver',
    'Documenter les limites connues',
  ];
  for (const [cwd, pinned, name] of projects) {
    await fixture.app.store.project({ cwd, pinned }, true);
    for (let i = 0; i < (name === 'SoundsPerfect' ? titles.length : 2); i++) {
      const id = `${name.toLowerCase()}-${i}`;
      const timestamp = new Date(Date.now() - (i + 1) * 86400000).toISOString();
      await writeFile(
        join(fixture.root, 'sessions', `${id}.jsonl`),
        [
          { type: 'session', id, cwd, timestamp },
          {
            type: 'message',
            id: `${id}-u`,
            parentId: null,
            timestamp,
            message: { role: 'user', content: titles[i], timestamp },
          },
          {
            type: 'message',
            id: `${id}-a`,
            parentId: `${id}-u`,
            timestamp,
            message: {
              role: 'assistant',
              content: `Résultat conservé dans ${name}.`,
              stopReason: 'stop',
              timestamp,
            },
          },
        ]
          .map(JSON.stringify)
          .join('\n') + '\n',
      );
      await utimes(join(fixture.root, 'sessions', `${id}.jsonl`), new Date(timestamp), new Date(timestamp));
    }
  }
  await fixture.app.store.patchSession({ id: 'documentation-1', archived: true });
  return fixture;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const fixture = await createNavigationFixture();
  await mkdir(resolve('.local'), { recursive: true });
  await writeFile(
    resolve('.local/project-navigation-preview.json'),
    JSON.stringify(
      {
        url: fixture.url,
        cwd: fixture.cwd,
        pid: process.pid,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ url: fixture.url, pid: process.pid }));
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, async () => {
      await fixture.close();
      process.exit();
    });
}
