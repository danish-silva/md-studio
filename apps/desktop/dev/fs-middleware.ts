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
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import type { ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';

const MOUNT_PATH = '/__fs';

export interface DevFsOptions {
  /** Absolute paths the middleware may read and write. */
  roots?: string[];
}

export function devFsPlugin(options: DevFsOptions = {}): Plugin {
  let roots: string[] = [];

  return {
    name: 'md-studio:dev-fs',
    apply: 'serve',

    configResolved(config) {
      roots = resolveRoots(options.roots, config.root);
      config.logger.info(`  dev fs roots: ${roots.join(', ')}`);
    },

    configureServer(server) {
      server.middlewares.use(MOUNT_PATH, createHandler(() => roots));
    },
  };
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

function createHandler(getRoots: () => string[]): Connect.NextHandleFunction {
  return (req, res, _next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = url.pathname.replace(/\/+$/, '') || '/';

    dispatch(route, url, req, getRoots())
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
  roots: string[],
): Promise<Record<string, unknown>> {
  switch (route) {
    case '/roots':
      return { roots };

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
