import fs from 'node:fs';
import path from 'node:path';
import { readJsonIfExists } from '../json.js';
import { toPosixPath } from '../paths.js';

export type SourceFileKind =
  | 'next-app-route'
  | 'next-pages-route'
  | 'vite-entry'
  | 'vite-route'
  | 'remix-route'
  | 'css-module'
  | 'global-style'
  | 'tailwind-config'
  | 'design-token'
  | 'component'
  | 'config';

export type SourceFileCandidate = {
  path: string;
  kind: SourceFileKind;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
};

export type SourceOwnershipInfo = {
  routePath: string;
  appDirectories: string[];
  routeFiles: SourceFileCandidate[];
  entryFiles: SourceFileCandidate[];
  styleFiles: SourceFileCandidate[];
  configFiles: SourceFileCandidate[];
  designTokenFiles: SourceFileCandidate[];
  componentFiles: SourceFileCandidate[];
  likelyFiles: SourceFileCandidate[];
};

export type ReactProjectInfo = {
  root: string;
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown';
  scripts: Record<string, string>;
  likelyFramework: 'next' | 'vite' | 'remix' | 'cra' | 'unknown';
  sourceOwnership: SourceOwnershipInfo;
  warnings: string[];
};

export function inspectReactProject(projectRoot: string, options: { route?: string } = {}): ReactProjectInfo {
  const root = path.resolve(projectRoot);
  const pkg = readJsonIfExists<{ scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(path.join(root, 'package.json'));
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const scripts = pkg?.scripts || {};
  const warnings: string[] = [];
  if (!pkg) warnings.push('package.json not found');
  if (!deps.react) warnings.push('react dependency not found');
  const likelyFramework = detectFramework(deps, scripts);
  return {
    root,
    packageManager: detectPackageManager(root),
    scripts,
    likelyFramework,
    sourceOwnership: discoverSourceOwnership(root, {
      ...(options.route ? { route: options.route } : {}),
      framework: likelyFramework,
    }),
    warnings,
  };
}

export function assertReactProjectRoot(projectRoot: string): ReactProjectInfo {
  const info = inspectReactProject(projectRoot);
  if (info.warnings.length > 0) {
    throw new Error(`Invalid React project root: ${info.root} (${info.warnings.join('; ')}). Run from the React project root or pass --project <dir>.`);
  }
  return info;
}

export async function waitForRoute(route: string, options: { timeoutMs?: number; intervalMs?: number } = {}): Promise<void> {
  const timeoutMs = options.timeoutMs || 45000;
  const intervalMs = options.intervalMs || 750;
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(route, { method: 'GET' });
      if (response.ok || response.status < 500) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Route not reachable after ${timeoutMs}ms: ${route}${lastError ? ` (${lastError})` : ''}`);
}

export function defaultDevCommand(info: ReactProjectInfo): string | null {
  if (info.scripts.dev) return `${info.packageManager === 'unknown' ? 'npm' : info.packageManager} run dev`;
  if (info.scripts.start) return `${info.packageManager === 'unknown' ? 'npm' : info.packageManager} run start`;
  return null;
}

export function discoverSourceOwnership(projectRoot: string, options: { route?: string; framework?: ReactProjectInfo['likelyFramework'] } = {}): SourceOwnershipInfo {
  const root = path.resolve(projectRoot);
  const routePath = normalizeRoutePath(options.route);
  const framework = options.framework || 'unknown';
  const appDirectories = existingRelativeDirs(root, ['app', 'src/app', 'pages', 'src/pages', 'app/routes', 'src/routes', 'routes', 'src']);
  const routeFiles = uniqueCandidates([
    ...discoverNextRouteFiles(root, routePath, framework),
    ...discoverRemixRouteFiles(root, routePath, framework),
    ...discoverViteRouteFiles(root, routePath, framework),
  ]);
  const entryFiles = uniqueCandidates(discoverEntryFiles(root, framework));
  const styleFiles = uniqueCandidates(discoverStyleFiles(root));
  const configFiles = uniqueCandidates(discoverConfigFiles(root));
  const designTokenFiles = uniqueCandidates(discoverDesignTokenFiles(root, styleFiles, configFiles));
  const componentFiles = uniqueCandidates(discoverComponentFiles(root, routePath));
  const likelyFiles = uniqueCandidates([
    ...routeFiles,
    ...entryFiles.filter((candidate) => candidate.confidence !== 'low'),
    ...componentFiles,
    ...designTokenFiles,
    ...styleFiles.filter((candidate) => candidate.confidence !== 'low').slice(0, 8),
    ...configFiles.filter((candidate) => candidate.kind === 'tailwind-config'),
  ]).slice(0, 24);
  return {
    routePath,
    appDirectories,
    routeFiles,
    entryFiles,
    styleFiles,
    configFiles,
    designTokenFiles,
    componentFiles,
    likelyFiles,
  };
}

function detectPackageManager(root: string): ReactProjectInfo['packageManager'] {
  if (fs.existsSync(path.join(root, 'bun.lock')) || fs.existsSync(path.join(root, 'bun.lockb'))) return 'bun';
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(root, 'package-lock.json'))) return 'npm';
  return 'unknown';
}

function detectFramework(deps: Record<string, string>, scripts: Record<string, string>): ReactProjectInfo['likelyFramework'] {
  if (deps.next) return 'next';
  if (deps['@remix-run/react'] || deps['@remix-run/node']) return 'remix';
  if (deps.vite || /vite/.test(scripts.dev || '')) return 'vite';
  if (deps['react-scripts']) return 'cra';
  return 'unknown';
}

function normalizeRoutePath(route?: string): string {
  if (!route) return '/';
  try {
    const parsed = new URL(route);
    return parsed.pathname || '/';
  } catch {
    const withoutQuery = route.split('?')[0] || '/';
    return withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
  }
}

function routeSegments(routePath: string): string[] {
  return routePath.split('/').map((segment) => segment.trim()).filter(Boolean);
}

function discoverNextRouteFiles(root: string, routePath: string, framework: ReactProjectInfo['likelyFramework']): SourceFileCandidate[] {
  if (framework !== 'next' && !existsAny(root, ['app', 'src/app', 'pages', 'src/pages'])) return [];
  const segments = routeSegments(routePath);
  const candidates: SourceFileCandidate[] = [];
  for (const appDir of ['app', 'src/app']) {
    const routeDir = path.join(appDir, ...segments);
    for (const file of routeFileNames('page')) {
      addCandidateIfExists(root, candidates, path.join(routeDir, file), 'next-app-route', `Next app route page for ${routePath}`, 'high');
    }
    for (const file of routeFileNames('layout')) {
      addCandidateIfExists(root, candidates, path.join(routeDir, file), 'next-app-route', `Next app route layout for ${routePath}`, segments.length === 0 ? 'high' : 'medium');
      addCandidateIfExists(root, candidates, path.join(appDir, file), 'next-app-route', 'Shared Next app root layout', 'medium');
    }
    addDynamicRouteCandidates(root, candidates, appDir, segments, 'page', 'next-app-route', `Dynamic Next app route candidate for ${routePath}`);
  }
  for (const pagesDir of ['pages', 'src/pages']) {
    const pageBase = segments.length === 0 ? path.join(pagesDir, 'index') : path.join(pagesDir, ...segments);
    for (const ext of scriptExtensions()) {
      addCandidateIfExists(root, candidates, `${pageBase}.${ext}`, 'next-pages-route', `Next pages route for ${routePath}`, 'high');
      addCandidateIfExists(root, candidates, path.join(pageBase, `index.${ext}`), 'next-pages-route', `Next pages nested route for ${routePath}`, 'high');
    }
    addDynamicRouteCandidates(root, candidates, pagesDir, segments, undefined, 'next-pages-route', `Dynamic Next pages route candidate for ${routePath}`);
  }
  return candidates;
}

function discoverRemixRouteFiles(root: string, routePath: string, framework: ReactProjectInfo['likelyFramework']): SourceFileCandidate[] {
  if (framework !== 'remix' && !existsAny(root, ['app/routes'])) return [];
  const segments = routeSegments(routePath);
  const routeName = segments.length === 0 ? '_index' : segments.join('.');
  const nestedRoute = segments.length === 0 ? '_index' : path.join(...segments, '_index');
  const candidates: SourceFileCandidate[] = [];
  for (const routesDir of ['app/routes', 'src/routes']) {
    for (const ext of scriptExtensions()) {
      addCandidateIfExists(root, candidates, path.join(routesDir, `${routeName}.${ext}`), 'remix-route', `Remix route module for ${routePath}`, 'high');
      addCandidateIfExists(root, candidates, path.join(routesDir, `${nestedRoute}.${ext}`), 'remix-route', `Remix nested route module for ${routePath}`, 'high');
      if (segments.length > 0) {
        addCandidateIfExists(root, candidates, path.join(routesDir, `${segments[segments.length - 1]}.${ext}`), 'remix-route', `Remix leaf route candidate for ${routePath}`, 'medium');
      }
    }
  }
  for (const ext of scriptExtensions()) {
    addCandidateIfExists(root, candidates, path.join('app', `root.${ext}`), 'remix-route', 'Remix root shell', 'medium');
    addCandidateIfExists(root, candidates, path.join('app', `entry.client.${ext}`), 'remix-route', 'Remix client entry', 'low');
  }
  return candidates;
}

function discoverViteRouteFiles(root: string, routePath: string, framework: ReactProjectInfo['likelyFramework']): SourceFileCandidate[] {
  if (framework !== 'vite' && !existsAny(root, ['vite.config.ts', 'vite.config.js', 'src/main.tsx', 'src/App.tsx'])) return [];
  const candidates: SourceFileCandidate[] = [];
  const segments = routeSegments(routePath);
  const leaf = segments[segments.length - 1] || 'home';
  for (const baseDir of ['src/pages', 'src/routes', 'src/views']) {
    for (const ext of scriptExtensions()) {
      addCandidateIfExists(root, candidates, path.join(baseDir, `${capitalize(leaf)}.${ext}`), 'vite-route', `Vite route/view candidate for ${routePath}`, 'medium');
      addCandidateIfExists(root, candidates, path.join(baseDir, leaf, `index.${ext}`), 'vite-route', `Vite nested route/view candidate for ${routePath}`, 'medium');
      addCandidateIfExists(root, candidates, path.join(baseDir, `index.${ext}`), 'vite-route', 'Vite default page/view', segments.length === 0 ? 'medium' : 'low');
    }
  }
  for (const ext of scriptExtensions()) {
    addCandidateIfExists(root, candidates, path.join('src', `App.${ext}`), 'vite-route', 'Vite app component likely owns route composition', 'high');
  }
  return candidates;
}

function discoverEntryFiles(root: string, framework: ReactProjectInfo['likelyFramework']): SourceFileCandidate[] {
  const candidates: SourceFileCandidate[] = [];
  for (const ext of scriptExtensions()) {
    addCandidateIfExists(root, candidates, path.join('src', `main.${ext}`), 'vite-entry', 'Vite/React client entry', framework === 'vite' ? 'high' : 'medium');
    addCandidateIfExists(root, candidates, path.join('src', `index.${ext}`), 'vite-entry', 'React client entry', framework === 'cra' ? 'high' : 'medium');
    addCandidateIfExists(root, candidates, path.join('src', `App.${ext}`), 'vite-entry', 'Top-level React app component', framework === 'vite' || framework === 'cra' ? 'high' : 'medium');
  }
  addCandidateIfExists(root, candidates, 'index.html', 'vite-entry', 'Vite HTML entry', framework === 'vite' ? 'medium' : 'low');
  return candidates;
}

function discoverStyleFiles(root: string): SourceFileCandidate[] {
  const files = listProjectFiles(root, {
    maxFiles: 6000,
    maxDepth: 6,
    include: (relative) => /\.(css|scss|sass|less)$/.test(relative),
  });
  return files.map((file) => {
    const kind: SourceFileKind = /\.module\.(css|scss|sass|less)$/.test(file) ? 'css-module' : 'global-style';
    const confidence: SourceFileCandidate['confidence'] = /globals?|index|app|variables|theme|tokens/i.test(path.basename(file)) ? 'medium' : 'low';
    return {
      path: file,
      kind,
      reason: kind === 'css-module' ? 'CSS module candidate near React implementation' : 'Global/style entry candidate',
      confidence,
    };
  });
}

function discoverConfigFiles(root: string): SourceFileCandidate[] {
  const candidates: SourceFileCandidate[] = [];
  for (const name of [
    'tailwind.config.ts',
    'tailwind.config.js',
    'tailwind.config.cjs',
    'tailwind.config.mjs',
    'postcss.config.js',
    'postcss.config.cjs',
    'postcss.config.mjs',
    'vite.config.ts',
    'vite.config.js',
    'next.config.ts',
    'next.config.js',
    'remix.config.js',
  ]) {
    addCandidateIfExists(root, candidates, name, name.startsWith('tailwind') ? 'tailwind-config' : 'config', name.startsWith('tailwind') ? 'Tailwind theme/content configuration' : 'Framework/build configuration', name.startsWith('tailwind') ? 'high' : 'low');
  }
  return candidates;
}

function discoverDesignTokenFiles(root: string, styleFiles: SourceFileCandidate[], configFiles: SourceFileCandidate[]): SourceFileCandidate[] {
  const candidates: SourceFileCandidate[] = [];
  const tokenPattern = /(^|[/._-])(tokens?|design-tokens?|theme|themes|variables|colors|typography)([/._-]|$)/i;
  for (const file of listProjectFiles(root, {
    maxFiles: 6000,
    maxDepth: 7,
    include: (relative) => tokenPattern.test(relative) && /\.(ts|tsx|js|jsx|json|css|scss|sass|less)$/.test(relative),
  })) {
    candidates.push({ path: file, kind: 'design-token', reason: 'Design token/theme file candidate', confidence: 'high' });
  }
  for (const file of styleFiles) {
    if (/globals?|variables|theme|tokens/i.test(path.basename(file.path))) {
      candidates.push({ ...file, kind: 'design-token', reason: 'Style file likely contains CSS variables or design tokens', confidence: file.confidence === 'low' ? 'medium' : file.confidence });
    }
  }
  for (const file of configFiles) {
    if (file.kind === 'tailwind-config') {
      candidates.push({ ...file, kind: 'design-token', reason: 'Tailwind theme config may own color/spacing/type tokens', confidence: 'high' });
    }
  }
  return candidates;
}

function discoverComponentFiles(root: string, routePath: string): SourceFileCandidate[] {
  const segments = routeSegments(routePath);
  const names = new Set(['hero', 'header', 'footer', 'layout', 'card', 'button', ...segments]);
  const files = listProjectFiles(root, {
    maxFiles: 6000,
    maxDepth: 7,
    include: (relative) => {
      if (!/\.(tsx|jsx|ts|js)$/.test(relative)) return false;
      if (!/(^|\/)(components|ui|shared|features|sections)(\/|$)/i.test(relative)) return false;
      const base = path.basename(relative, path.extname(relative)).toLowerCase();
      return Array.from(names).some((name) => name && base.includes(name.toLowerCase()));
    },
  });
  return files.slice(0, 20).map((file) => ({
    path: file,
    kind: 'component',
    reason: 'Reusable component candidate matching route/section naming',
    confidence: 'medium',
  }));
}

function addDynamicRouteCandidates(
  root: string,
  candidates: SourceFileCandidate[],
  baseDir: string,
  segments: string[],
  routeFileStem: string | undefined,
  kind: SourceFileKind,
  reason: string
): void {
  if (segments.length === 0 || !fs.existsSync(path.join(root, baseDir))) return;
  const leaf = segments[segments.length - 1] || '';
  for (const file of listProjectFiles(path.join(root, baseDir), {
    maxFiles: 2000,
    maxDepth: 5,
    include: (relative) => {
      if (!/\.(tsx|jsx|ts|js)$/.test(relative)) return false;
      const normalized = toPosixPath(relative);
      const basename = path.basename(relative, path.extname(relative));
      if (routeFileStem && basename !== routeFileStem) return false;
      return normalized.includes(`[${leaf}]`) || normalized.includes('[slug]') || normalized.includes('[id]') || normalized.toLowerCase().includes(leaf.toLowerCase());
    },
  }).slice(0, 10)) {
    candidates.push({ path: toPosixPath(path.join(baseDir, file)), kind, reason, confidence: 'low' });
  }
}

function routeFileNames(stem: string): string[] {
  return scriptExtensions().map((ext) => `${stem}.${ext}`);
}

function scriptExtensions(): string[] {
  return ['tsx', 'jsx', 'ts', 'js'];
}

function addCandidateIfExists(
  root: string,
  candidates: SourceFileCandidate[],
  relativePath: string,
  kind: SourceFileKind,
  reason: string,
  confidence: SourceFileCandidate['confidence']
): void {
  if (!fs.existsSync(path.join(root, relativePath))) return;
  candidates.push({ path: toPosixPath(relativePath), kind, reason, confidence });
}

function existingRelativeDirs(root: string, dirs: string[]): string[] {
  return dirs.filter((dir) => {
    const fullPath = path.join(root, dir);
    return fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
  }).map(toPosixPath);
}

function existsAny(root: string, relativePaths: string[]): boolean {
  return relativePaths.some((relativePath) => fs.existsSync(path.join(root, relativePath)));
}

function listProjectFiles(root: string, options: {
  maxFiles: number;
  maxDepth: number;
  include: (relativePath: string) => boolean;
}): string[] {
  const result: string[] = [];
  const rootResolved = path.resolve(root);
  const ignoredDirs = new Set(['.git', '.next', '.remix', 'build', 'dist', 'coverage', 'node_modules', '.figma-react-restore']);
  function walk(dir: string, depth: number): void {
    if (result.length >= options.maxFiles || depth > options.maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (result.length >= options.maxFiles) break;
      if (entry.name.startsWith('.') && entry.name !== '.storybook') continue;
      const fullPath = path.join(dir, entry.name);
      const relative = toPosixPath(path.relative(rootResolved, fullPath));
      if (entry.isDirectory()) {
        if (ignoredDirs.has(entry.name)) continue;
        walk(fullPath, depth + 1);
      } else if (entry.isFile() && options.include(relative)) {
        result.push(relative);
      }
    }
  }
  if (fs.existsSync(rootResolved)) walk(rootResolved, 0);
  return result.sort();
}

function uniqueCandidates(candidates: SourceFileCandidate[]): SourceFileCandidate[] {
  const byPathKind = new Map<string, SourceFileCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.kind}:${candidate.path}`;
    const existing = byPathKind.get(key);
    if (!existing || confidenceRank(candidate.confidence) < confidenceRank(existing.confidence)) byPathKind.set(key, candidate);
  }
  return Array.from(byPathKind.values()).sort((a, b) => {
    const confidenceDelta = confidenceRank(a.confidence) - confidenceRank(b.confidence);
    if (confidenceDelta !== 0) return confidenceDelta;
    const kindDelta = kindRank(a.kind) - kindRank(b.kind);
    if (kindDelta !== 0) return kindDelta;
    return a.path.localeCompare(b.path);
  });
}

function confidenceRank(confidence: SourceFileCandidate['confidence']): number {
  if (confidence === 'high') return 0;
  if (confidence === 'medium') return 1;
  return 2;
}

function kindRank(kind: SourceFileKind): number {
  const ranks: Record<SourceFileKind, number> = {
    'next-app-route': 0,
    'next-pages-route': 0,
    'remix-route': 0,
    'vite-route': 0,
    'vite-entry': 1,
    component: 2,
    'design-token': 3,
    'tailwind-config': 4,
    'css-module': 5,
    'global-style': 6,
    config: 7,
  };
  return ranks[kind];
}

function capitalize(value: string): string {
  return value ? `${value[0]!.toUpperCase()}${value.slice(1)}` : value;
}
