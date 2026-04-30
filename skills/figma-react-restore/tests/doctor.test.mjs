import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { runDoctor } from '../dist/doctor/index.js';
import { assertReactProjectRoot, inspectReactProject } from '../dist/react/project.js';

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

test('React project inspection discovers route ownership and token files', () => {
  const projectRoot = makeTempProject('frr-source-ownership-');
  fs.mkdirSync(path.join(projectRoot, 'app', 'dashboard'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'src', 'styles'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'src', 'components'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({
    scripts: { dev: 'next dev' },
    dependencies: { react: '^18.0.0', next: '^15.0.0' },
  }));
  fs.writeFileSync(path.join(projectRoot, 'app', 'layout.tsx'), 'export default function Layout({children}) { return children; }');
  fs.writeFileSync(path.join(projectRoot, 'app', 'dashboard', 'page.tsx'), 'export default function Page() { return null; }');
  fs.writeFileSync(path.join(projectRoot, 'app', 'dashboard', 'page.module.css'), '.root {}');
  fs.writeFileSync(path.join(projectRoot, 'tailwind.config.ts'), 'export default {};');
  fs.writeFileSync(path.join(projectRoot, 'src', 'styles', 'tokens.css'), ':root { --space-4: 16px; }');
  fs.writeFileSync(path.join(projectRoot, 'src', 'components', 'Hero.tsx'), 'export function Hero() { return null; }');

  const info = inspectReactProject(projectRoot, { route: 'http://localhost:3000/dashboard' });
  const likelyPaths = info.sourceOwnership.likelyFiles.map((file) => file.path);

  assert.equal(info.likelyFramework, 'next');
  assert.ok(likelyPaths.includes('app/dashboard/page.tsx'));
  assert.ok(likelyPaths.includes('tailwind.config.ts'));
  assert.ok(info.sourceOwnership.designTokenFiles.some((file) => file.path === 'src/styles/tokens.css'));
  assert.ok(info.sourceOwnership.styleFiles.some((file) => file.kind === 'css-module'));
});
