import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('gunshot audio manifest skips silent lead-in for delayed files', async () => {
  const source = await readFile(new URL('../src/game/AudioManager.ts', import.meta.url), 'utf8');

  assert.match(source, /'gun-ar':\s*\{\s*startOffsetMs:\s*340,\s*maxDurationMs:\s*150\s*\}/);
  assert.match(source, /'gun-sniper':\s*\{\s*startOffsetMs:\s*430,\s*maxDurationMs:\s*390\s*\}/);
  assert.match(source, /'gun-smg':\s*\{\s*startOffsetMs:\s*0,\s*maxDurationMs:\s*125\s*\}/);
  assert.match(source, /'gun-mg':\s*\{\s*startOffsetMs:\s*0,\s*maxDurationMs:\s*190\s*\}/);
  assert.match(source, /playHitmarker\(killed: boolean\): void \{\s*this\.play\('hitmarker', \{ volume: killed \? 1 : 0\.92/);
});
