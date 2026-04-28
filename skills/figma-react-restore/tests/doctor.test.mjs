import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { runDoctor } from '../dist/doctor/index.js';
import { assertReactProjectRoot } from '../dist/react/project.js';

function makeTempProject(prefix = 'frr-doctor-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('doctor does not create artifact root as a side effect', async () => {
  const projectRoot = makeTempProject();
  fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({ dependencies: { react: '^18.0.0' } }));

  await runDoctor({ projectRoot, checkBrowser: false });

  assert.equal(fs.existsSync(path.join(projectRoot, '.figma-react-restore')), false);
});

test('service preflight rejects non-React roots before artifact creation', () => {
  const parentRoot = makeTempProject('frr-parent-root-');
  fs.mkdirSync(path.join(parentRoot, 'app'));
  fs.writeFileSync(path.join(parentRoot, 'app', 'package.json'), JSON.stringify({ dependencies: { react: '^18.0.0' } }));

  assert.throws(
    () => assertReactProjectRoot(parentRoot),
    /Invalid React project root: .*package\.json not found.*react dependency not found/
  );
  assert.equal(fs.existsSync(path.join(parentRoot, '.figma-react-restore')), false);

  const cliPath = path.resolve('dist/cli/index.js');
  const result = spawnSync(process.execPath, [cliPath, 'service', 'start', '--project', parentRoot], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Invalid React project root/);
  assert.equal(fs.existsSync(path.join(parentRoot, '.figma-react-restore')), false);
});
