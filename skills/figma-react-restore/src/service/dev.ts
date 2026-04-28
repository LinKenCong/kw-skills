import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT } from '../paths.js';

export type StartDevServiceOptions = {
  projectRoot: string;
  port?: number;
  compile?: boolean;
};

export function startDevRuntimeService(options: StartDevServiceOptions): void {
  const paths = resolveDevPaths();
  const port = options.port || DEFAULT_PORT;
  let serviceProcess: ChildProcess | null = null;
  let compilerProcess: ChildProcess | null = null;
  let watcher: fs.FSWatcher | null = null;
  let restartTimer: NodeJS.Timeout | null = null;
  let restarting = false;
  let shuttingDown = false;

  function serviceArgs(): string[] {
    return [paths.cliPath, 'service', 'start', '--project', path.resolve(options.projectRoot)];
  }

  function startService(reason = 'initial start'): void {
    process.stdout.write(`[service dev] ${reason}; starting runtime service\n`);
    serviceProcess = spawn(process.execPath, serviceArgs(), {
      cwd: paths.skillRoot,
      stdio: 'inherit',
      env: process.env,
    });
    serviceProcess.once('exit', (code, signal) => {
      if (shuttingDown || restarting) return;
      process.stderr.write(`[service dev] runtime service exited code=${String(code)} signal=${String(signal)}; waiting for next rebuild\n`);
    });
  }

  function restartService(reason: string): void {
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      restarting = true;
      const current = serviceProcess;
      const startNext = () => {
        restarting = false;
        startService(reason);
      };
      if (current && current.exitCode === null) {
        current.once('exit', startNext);
        current.kill('SIGTERM');
        setTimeout(() => {
          if (current.exitCode === null) current.kill('SIGKILL');
        }, 4000).unref();
      } else {
        startNext();
      }
    }, 300);
  }

  function startCompiler(): void {
    if (options.compile === false) return;
    if (!fs.existsSync(paths.tscPath)) {
      process.stderr.write(`[service dev] TypeScript compiler not found at ${paths.tscPath}; run npm install or use --no-compile\n`);
      return;
    }
    compilerProcess = spawn(process.execPath, [paths.tscPath, '-p', paths.tsconfigPath, '--watch', '--preserveWatchOutput'], {
      cwd: paths.skillRoot,
      stdio: 'inherit',
      env: process.env,
    });
  }

  function startWatcher(): void {
    watcher = watchDist(paths.distRoot, (fileName) => {
      if (!fileName || !fileName.endsWith('.js')) return;
      restartService(`detected rebuild: ${fileName}`);
    });
  }

  function cleanup(): void {
    shuttingDown = true;
    if (restartTimer) clearTimeout(restartTimer);
    watcher?.close();
    serviceProcess?.kill('SIGTERM');
    compilerProcess?.kill('SIGTERM');
  }

  process.once('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.once('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  process.stdout.write(`[service dev] watching ${paths.distRoot}; url=http://localhost:${port}\n`);
  startCompiler();
  startWatcher();
  startService();
}

function watchDist(distRoot: string, onChange: (fileName: string) => void): fs.FSWatcher {
  try {
    return fs.watch(distRoot, { recursive: true }, (_event, fileName) => onChange(String(fileName || '')));
  } catch (_error) {
    process.stderr.write('[service dev] recursive fs.watch is unavailable; watching dist root only\n');
    return fs.watch(distRoot, (_event, fileName) => onChange(String(fileName || '')));
  }
}

function resolveDevPaths(): { skillRoot: string; distRoot: string; cliPath: string; tscPath: string; tsconfigPath: string } {
  const currentFile = fileURLToPath(import.meta.url);
  const distRoot = path.resolve(path.dirname(currentFile), '..');
  const skillRoot = path.resolve(distRoot, '..');
  return {
    skillRoot,
    distRoot,
    cliPath: path.join(distRoot, 'cli', 'index.js'),
    tscPath: path.join(skillRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
    tsconfigPath: path.join(skillRoot, 'tsconfig.json'),
  };
}
