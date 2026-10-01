import { createReadStream } from 'fs';
import { realpath, stat } from 'fs/promises';
import { Readable } from 'stream';
import {
  isValidTikTokMediaPath,
  verifyTikTokMediaSignature,
} from '@gitroom/nestjs-libraries/upload/tiktok.signed-media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONTENT_TYPES: Record<string, string> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  mp4: 'video/mp4',
  png: 'image/png',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  webp: 'image/webp',
};

async function serve(
  request: Request,
  context: { params: Promise<{ path?: string[] }> }
) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' },
    });
  }

  const { path: segments = [] } = await context.params;
  const relativePath = segments.join('/');
  const requestUrl = new URL(request.url);
  if (
    !isValidTikTokMediaPath(relativePath) ||
    !verifyTikTokMediaSignature(
      relativePath,
      requestUrl.searchParams.get('expires'),
      requestUrl.searchParams.get('signature'),
      process.env.TIKTOK_MEDIA_SIGNING_SECRET
    )
  ) {
    return new Response('Not found', {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const uploadDirectory = process.env.UPLOAD_DIRECTORY;
  if (!uploadDirectory) {
    return new Response('Not found', {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  try {
    const root = await realpath(uploadDirectory);
    const filePath = await realpath(`${root}/${relativePath}`);
    const rootPrefix = root.endsWith('/') ? root : `${root}/`;
    if (!filePath.startsWith(rootPrefix)) {
      return new Response('Not found', {
        status: 404,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) {
      return new Response('Not found', {
        status: 404,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    const extension = relativePath.split('.').pop()?.toLowerCase() || '';
    const headers = {
      'Accept-Ranges': 'none',
      'Cache-Control': 'no-store, max-age=0',
      'Content-Length': String(fileStats.size),
      'Content-Type': CONTENT_TYPES[extension],
      'X-Content-Type-Options': 'nosniff',
    };

    if (request.method === 'HEAD') {
      return new Response(null, { status: 200, headers });
    }

    const webStream = Readable.toWeb(
      createReadStream(filePath)
    ) as ReadableStream;
    return new Response(webStream, { status: 200, headers });
  } catch {
    return new Response('Not found', {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

export const GET = serve;
export const HEAD = serve;
