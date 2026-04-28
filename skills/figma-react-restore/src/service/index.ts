import { serve } from '@hono/node-server';
import { ArtifactStore } from '../artifact/store.js';
import { DEFAULT_PORT } from '../paths.js';
import { createRuntimeApp } from './http.js';
import { createServiceLock, removeServiceLock, writeServiceLock } from './lockfile.js';
import { RuntimeState } from './state.js';

export type StartServiceOptions = {
  workspaceRoot?: string;
  artifactRoot?: string;
  port?: number;
  token?: string;
  silent?: boolean;
};

export function startRuntimeService(options: StartServiceOptions = {}): void {
  const port = options.port || DEFAULT_PORT;
  const lock = createServiceLock({ ...options, port });
  const store = new ArtifactStore({ workspaceRoot: lock.workspaceRoot, artifactRoot: lock.artifactRoot });
  store.ensure();
  writeServiceLock(lock);
  const state = new RuntimeState({ token: lock.token, store });
  const app = createRuntimeApp(state);
  const server = serve({ fetch: app.fetch, port });

  const cleanup = () => {
    removeServiceLock(lock.workspaceRoot);
    server.close();
  };
  process.once('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.once('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  if (!options.silent) {
    process.stdout.write(`${JSON.stringify({ ok: true, service: lock.service, url: lock.url, token: lock.token, lockFile: '.figma-react-restore/service.json' }, null, 2)}\n`);
  }
}
