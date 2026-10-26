/**
 * Development-only filesystem bridge.
 *
 * The shipping app talks to Rust over Tauri IPC (P9). Until then — and afterwards for
 * Playwright runs and for debugging in Chrome DevTools rather than the webview — the UI
 * talks to this Vite middleware, which exposes the same operations over HTTP.
 *
 * Access is confined to an explicit set of roots. Override them with MD_STUDIO_DEV_ROOTS
 * (a path-delimiter separated list); the default is the repository root.
 */
import { watch, type FSWatcher } from 'chokidar';
import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import trash from 'trash';
import type { Connect, Plugin } from 'vite';

const MOUNT_PATH = '/__fs';

/** Never walked or watched: enormous, and never what someone is writing in. */
const IGNORED = /(^|[\\/])(node_modules|\.git|\.vite|\.cache|dist|target)([\\/]|$)/;

export interface DevFsOptions {
  /** Absolute paths the middleware may read and write. */
  roots?: string[];
}

export function devFsPlugin(options: DevFsOptions = {}): Plugin {
  const registry = new RootRegistry();
  const events = new WatchHub(registry);

  return {
    name: 'md-studio:dev-fs',
    apply: 'serve',

    configResolved(config) {
      for (const root of resolveRoots(options.roots, config.root)) {
        registry.add(root);
      }
      config.logger.info(`  dev fs roots: ${registry.list().join(', ')}`);
    },

    configureServer(server) {
      server.middlewares.use(MOUNT_PATH, createHandler(registry, events));
      server.httpServer?.on('close', () => void events.close());
    },
  };
}

/**
 * The directories this middleware will touch.
 *
 * Adding one at runtime is the development stand-in for Tauri's scoped fs grant (P9):
 * a folder becomes reachable only once the user has named it.
 */
class RootRegistry {
  #roots: string[] = [];
  #listeners = new Set<(root: string, added: boolean) => void>();

  list(): string[] {
    return [...this.#roots];
  }

  add(root: string): string {
    const resolved = path.resolve(root);
    if (!this.#roots.includes(resolved)) {
      this.#roots.push(resolved);
      for (const listener of this.#listeners) listener(resolved, true);
    }
    return resolved;
  }

  remove(root: string): void {
    const resolved = path.resolve(root);
    if (!this.#roots.includes(resolved)) return;
    this.#roots = this.#roots.filter((entry) => entry !== resolved);
    for (const listener of this.#listeners) listener(resolved, false);
  }

  subscribe(listener: (root: string, added: boolean) => void): void {
    this.#listeners.add(listener);
  }
}

/**
 * One chokidar watcher per root, fanned out to browser clients over SSE.
 *
 * EventSource reconnects on its own, so a dev-server restart heals without the UI having
 * to care.
 */
class WatchHub {
  #watchers = new Map<string, FSWatcher>();
  #clients = new Set<ServerResponse>();

  constructor(registry: RootRegistry) {
    registry.subscribe((root, added) => {
      if (added) this.#watch(root);
      else void this.#unwatch(root);
    });
  }

  #watch(root: string): void {
    if (this.#watchers.has(root)) return;

    const watcher = watch(root, {
      ignoreInitial: true,
      ignored: (target: string) => IGNORED.test(target),
      // Editors and sync clients write in bursts; wait for the file to settle.
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 30 },
    });

    watcher.on('all', (event, target) => {
      this.#broadcast({ event, path: target });
    });
    watcher.on('error', (error: unknown) => {
      this.#broadcast({ event: 'error', path: root, message: String(error) });
    });

    this.#watchers.set(root, watcher);
  }

  async #unwatch(root: string): Promise<void> {
    const watcher = this.#watchers.get(root);
    if (!watcher) return;
    this.#watchers.delete(root);
    await watcher.close();
  }

  stream(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write('retry: 1000\n\n');

    this.#clients.add(res);
    req.on('close', () => {
      this.#clients.delete(res);
    });
  }

  #broadcast(payload: Record<string, unknown>): void {
    const line = `data: ${JSON.stringify(payload)}\n\n`;
    for (const client of this.#clients) {
      client.write(line);
    }
  }

  async close(): Promise<void> {
    for (const watcher of this.#watchers.values()) {
      await watcher.close();
    }
    this.#watchers.clear();
    for (const client of this.#clients) {
      client.end();
    }
    this.#clients.clear();
  }
}

function resolveRoots(explicit: string[] | undefined, viteRoot: string): string[] {
  const configured = explicit ?? splitPathList(process.env['MD_STUDIO_DEV_ROOTS']);
  if (configured.length > 0) {
    return configured.map((entry) => path.resolve(entry));
  }
  // apps/desktop -> repository root
  return [path.resolve(viteRoot, '..', '..')];
}

function splitPathList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function createHandler(registry: RootRegistry, events: WatchHub): Connect.NextHandleFunction {
  return (req, res, _next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = url.pathname.replace(/\/+$/, '') || '/';

    if (route === '/watch') {
      events.stream(req, res);
      return;
    }

    dispatch(route, url, req, registry)
      .then((body) => send(res, 200, body))
      .catch((error: unknown) => {
        if (error instanceof HttpError) {
          send(res, error.status, { error: error.message, ...error.body });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        send(res, 500, { error: message });
      });
  };
}

async function dispatch(
  route: string,
  url: URL,
  req: Connect.IncomingMessage,
  registry: RootRegistry,
): Promise<Record<string, unknown>> {
  const roots = registry.list();

  switch (route) {
    case '/roots': {
      if (req.method !== 'POST') return { roots };

      const target = requireString(await readJsonBody(req), 'path');
      const resolved = path.resolve(target);
      const stats = await fs.stat(resolved).catch(() => null);
      if (!stats?.isDirectory()) {
        throw new HttpError(400, `Not a folder: ${resolved}`);
      }
      registry.add(resolved);
      return { roots: registry.list() };
    }

    case '/roots/remove': {
      registry.remove(requireString(await readJsonBody(req), 'path'));
      return { roots: registry.list() };
    }

    case '/create': {
      const body = await readJsonBody(req);
      const target = requireAllowedPath(asString(body['path']), roots);
      if (await exists(target)) {
        throw new HttpError(409, `Already exists: ${target}`);
      }

      if (body['kind'] === 'directory') {
        await fs.mkdir(target, { recursive: true });
      } else {
        await fs.mkdir(path.dirname(target), { recursive: true });
        // wx fails rather than truncating, in case something appeared in between.
        await fs.writeFile(target, asString(body['text']) ?? '', { encoding: 'utf8', flag: 'wx' });
      }
      return { stat: await statOf(target) };
    }

    case '/rename': {
      const body = await readJsonBody(req);
      const from = requireAllowedPath(asString(body['from']), roots);
      const to = requireAllowedPath(asString(body['to']), roots);

      if (from === to) return { stat: await statOf(from) };
      if (await exists(to)) {
        throw new HttpError(409, `Already exists: ${to}`);
      }

      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.rename(from, to);
      return { stat: await statOf(to) };
    }

    case '/search/files': {
      const limit = numberParam(url, 'limit', 2000);
      const files: string[] = [];
      for (const root of roots) {
        await walkMarkdown(root, files, limit);
      }
      return { files };
    }

    case '/search/content': {
      const query = url.searchParams.get('query') ?? '';
      if (query.length === 0) return { matches: [], truncated: false };

      const pattern = compilePattern(
        query,
        url.searchParams.get('regex') === '1',
        url.searchParams.get('caseSensitive') === '1',
      );
      const limit = numberParam(url, 'limit', 500);

      const files: string[] = [];
      for (const root of roots) {
        await walkMarkdown(root, files, 5000);
      }

      const matches: ContentMatch[] = [];
      for (const file of files) {
        if (matches.length >= limit) break;
        await matchesIn(file, pattern, matches, limit);
      }
      return { matches, truncated: matches.length >= limit };
    }

    case '/config': {
      const name = configName(url.searchParams.get('name'));
      const file = path.join(configDir(), name);

      if (req.method === 'POST') {
        await fs.mkdir(path.dirname(file), { recursive: true });
        const text = (await readBinaryBody(req)).toString('utf8');
        const temp = `${file}.${String(process.pid)}.tmp`;
        // Same atomic write as documents: a crash must not leave half a workspace.
        await fs.writeFile(temp, text, 'utf8');
        await fs.rename(temp, file);
        return { ok: true };
      }

      const text = await fs.readFile(file, 'utf8').catch(() => null);
      // A BOM would make JSON parsing fail and look like a corrupt workspace.
      return { text: text === null ? null : text.replace(/^﻿/, '') };
    }

    case '/config/list': {
      const prefix = url.searchParams.get('prefix') ?? '';
      const names = await fs
        .readdir(configDir())
        .catch(() => [] as string[])
        .then((entries) => entries.filter((entry) => entry.startsWith(prefix)));
      return { names };
    }

    case '/config/delete': {
      const name = configName(requireString(await readJsonBody(req), 'name'));
      await fs.rm(path.join(configDir(), name), { force: true });
      return { ok: true };
    }

    case '/trash': {
      const target = requireAllowedPath(asString(await readJsonBody(req).then((b) => b['path'])), roots);
      // Deliberately never fs.rm: deleting from the explorer must be recoverable.
      await trash(target);
      return { path: target };
    }

    case '/list': {
      const dirPath = requireAllowedPath(url.searchParams.get('path'), roots);
      return { path: dirPath, entries: await listDir(dirPath) };
    }

    case '/stat': {
      const filePath = requireAllowedPath(url.searchParams.get('path'), roots);
      return { stat: await statOf(filePath) };
    }

    case '/read': {
      const filePath = requireAllowedPath(url.searchParams.get('path'), roots);
      const [text, stat] = await Promise.all([
        fs.readFile(filePath, 'utf8'),
        statOf(filePath),
      ]);
      return { path: filePath, text, stat };
    }

    case '/write': {
      if (req.method !== 'POST') {
        throw new HttpError(405, 'Use POST to write a file');
      }
      return { stat: await writeFile(await readJsonBody(req), roots) };
    }

    case '/write-asset': {
      if (req.method !== 'POST') {
        throw new HttpError(405, 'Use POST to write an asset');
      }
      return { stat: await writeAsset(url, req, roots) };
    }

    default:
      throw new HttpError(404, `Unknown filesystem route: ${route}`);
  }
}

interface DirEntryPayload {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  size: number;
  mtimeMs: number;
}

async function listDir(dirPath: string): Promise<DirEntryPayload[]> {
  const dirents = await fs.readdir(dirPath, { withFileTypes: true });

  const entries = await Promise.all(
    dirents.map(async (dirent): Promise<DirEntryPayload | null> => {
      const entryPath = path.join(dirPath, dirent.name);
      const kind = dirent.isDirectory() ? 'directory' : 'file';
      if (!dirent.isDirectory() && !dirent.isFile()) return null;

      // A file can vanish between readdir and stat; skip it rather than fail the listing.
      try {
        const stats = await fs.stat(entryPath);
        return {
          name: dirent.name,
          path: entryPath,
          kind,
          size: stats.size,
          mtimeMs: stats.mtimeMs,
        };
      } catch {
        return null;
      }
    }),
  );

  return entries
    .filter((entry): entry is DirEntryPayload => entry !== null)
    .sort(compareEntries);
}

function compareEntries(a: DirEntryPayload, b: DirEntryPayload): number {
  if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

async function statOf(targetPath: string): Promise<{ path: string; size: number; mtimeMs: number }> {
  const stats = await fs.stat(targetPath);
  return { path: targetPath, size: stats.size, mtimeMs: stats.mtimeMs };
}

async function writeFile(
  body: Record<string, unknown>,
  roots: string[],
): Promise<{ path: string; size: number; mtimeMs: number }> {
  const filePath = requireAllowedPath(typeof body['path'] === 'string' ? body['path'] : null, roots);
  const text = body['text'];
  if (typeof text !== 'string') {
    throw new HttpError(400, 'Field "text" must be a string');
  }

  const expected = body['expectedMtimeMs'];
  if (typeof expected === 'number') {
    const current = await statOf(filePath).catch(() => null);
    // mtimeMs carries sub-millisecond float noise across a JSON round trip.
    if (current && Math.abs(current.mtimeMs - expected) > 1) {
      throw new HttpError(409, 'File changed on disk since it was opened', {
        code: 'stale',
        stat: current,
      });
    }
  }

  // Write to a sibling temp file and rename, so a crash mid-write cannot truncate the
  // document. On Windows, fs.rename replaces an existing destination.
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.tmp`,
  );
  try {
    await fs.writeFile(tempPath, text, 'utf8');
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }

  return statOf(filePath);
}

/**
 * Binary writes, for images pasted or dropped into a document. The directory is created
 * if missing and the name is made unique, so two screenshots pasted in a row do not
 * silently overwrite one another.
 */
async function writeAsset(
  url: URL,
  req: Connect.IncomingMessage,
  roots: string[],
): Promise<{ path: string; size: number; mtimeMs: number }> {
  const dir = requireAllowedPath(url.searchParams.get('dir'), roots);
  const name = safeAssetName(url.searchParams.get('name'));

  const data = await readBinaryBody(req);
  if (data.length === 0) {
    throw new HttpError(400, 'Asset body was empty');
  }

  await fs.mkdir(dir, { recursive: true });
  const target = await firstFreeName(dir, name);
  await fs.writeFile(target, data);
  return statOf(target);
}

function safeAssetName(raw: string | null): string {
  const base = (raw ?? '').split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/^[-.]+/, '')
    .slice(0, 120);
  return cleaned.length > 0 ? cleaned : 'image.png';
}

async function firstFreeName(dir: string, name: string): Promise<string> {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';

  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const candidate = path.join(dir, attempt === 0 ? name : `${stem}-${attempt}${extension}`);
    try {
      await fs.access(candidate);
    } catch {
      return candidate;
    }
  }
  throw new HttpError(409, `No free file name for ${name}`);
}

async function readBinaryBody(req: Connect.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

interface ContentMatch {
  path: string;
  line: number;
  column: number;
  length: number;
  /** The whole line, for showing the match in context. */
  preview: string;
}

function numberParam(url: URL, name: string, fallback: number): number {
  const value = Number(url.searchParams.get(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function compilePattern(query: string, regex: boolean, caseSensitive: boolean): RegExp {
  const source = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    return new RegExp(source, caseSensitive ? 'g' : 'gi');
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : 'Invalid pattern');
  }
}

/**
 * Walking happens here rather than in the browser: the UI only ever needs the answer,
 * and shipping a whole folder tree across to filter it would be wasteful.
 */
async function walkMarkdown(dir: string, into: string[], limit: number): Promise<void> {
  if (into.length >= limit) return;

  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (into.length >= limit) return;

    const target = path.join(dir, entry.name);
    if (IGNORED.test(target)) continue;

    if (entry.isDirectory()) {
      await walkMarkdown(target, into, limit);
    } else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) {
      into.push(target);
    }
  }
}

async function matchesIn(
  file: string,
  pattern: RegExp,
  into: ContentMatch[],
  limit: number,
): Promise<void> {
  const text = await fs.readFile(file, 'utf8').catch(() => null);
  if (text === null) return;

  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    pattern.lastIndex = 0;

    let found: RegExpExecArray | null;
    while ((found = pattern.exec(line)) !== null) {
      if (found[0].length === 0) {
        pattern.lastIndex += 1;
        continue;
      }
      into.push({
        path: file,
        line: index + 1,
        column: found.index + 1,
        length: found[0].length,
        preview: line.length > 400 ? `${line.slice(0, 400)}…` : line,
      });
      if (into.length >= limit) return;
    }
  }
}

/**
 * Where workspaces and drafts live in development.
 *
 * Deliberately outside the repository and clearly marked as dev, so it never collides
 * with the real app-data directory Tauri will use in P9.
 */
function configDir(): string {
  return process.env['MD_STUDIO_DEV_CONFIG'] ?? path.join(os.homedir(), '.md-studio-dev');
}

/** Config names are file names, never paths: no separators, no traversal. */
function configName(candidate: string | null): string {
  if (candidate === null || !/^[A-Za-z0-9._-]+$/.test(candidate) || candidate.includes('..')) {
    throw new HttpError(400, `Not a valid config name: ${String(candidate)}`);
  }
  return candidate;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function requireString(body: Record<string, unknown>, key: string): string {
  const value = asString(body[key]);
  if (value === null || value.length === 0) {
    throw new HttpError(400, `Missing "${key}"`);
  }
  return value;
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function requireAllowedPath(candidate: string | null, roots: string[]): string {
  if (!candidate) {
    throw new HttpError(400, 'Missing "path"');
  }
  if (!path.isAbsolute(candidate)) {
    throw new HttpError(400, `Path must be absolute: ${candidate}`);
  }

  const resolved = path.resolve(candidate);
  const allowed = roots.some((root) => {
    const relative = path.relative(root, resolved);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  });

  if (!allowed) {
    throw new HttpError(403, `Path is outside the permitted dev roots: ${resolved}`);
  }
  return resolved;
}

async function readJsonBody(req: Connect.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};

  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Body must be a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : 'Invalid JSON body');
  }
}

function send(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(payload);
}
