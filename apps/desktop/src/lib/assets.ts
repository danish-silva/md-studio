import { fsProvider } from '../fs';
import { basename, parentDir } from './text';

/** Images live beside the document that references them, so the link stays relative. */
export const ASSETS_DIR = 'assets';

const EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg',
};

/**
 * Writes images next to the document and returns the relative links to put in it.
 *
 * The provider makes each name unique, so two screenshots pasted in a row do not
 * overwrite one another.
 */
export async function storeImages(
  files: readonly File[],
  documentPath: string,
): Promise<string[]> {
  const parent = parentDir(documentPath);
  if (parent === null) {
    throw new Error(`Cannot work out a folder for ${documentPath}`);
  }

  const links: string[] = [];
  for (const file of files) {
    const stat = await fsProvider.writeAsset({
      dir: `${parent}/${ASSETS_DIR}`,
      name: assetName(file),
      data: await file.arrayBuffer(),
    });
    links.push(`${ASSETS_DIR}/${basename(stat.path)}`);
  }
  return links;
}

function assetName(file: File): string {
  const given = file.name.trim();
  // Clipboard images arrive unnamed, or as a generic "image.png" that would collide
  // constantly; give those a timestamp instead.
  if (given.length > 0 && given.toLowerCase() !== 'image.png') return given;

  const extension = EXTENSIONS[file.type] ?? '.png';
  return `pasted-${timestamp()}${extension}`;
}

function timestamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
}
