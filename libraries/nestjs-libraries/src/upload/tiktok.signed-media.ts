import { createHmac, timingSafeEqual } from 'crypto';

export const TIKTOK_MEDIA_MAX_TTL_SECONDS = 2 * 60 * 60;
const MEDIA_ROUTE = '/tiktok-media/';
const ALLOWED_MEDIA_EXTENSIONS = new Set([
  'avif',
  'bmp',
  'gif',
  'jpeg',
  'jpg',
  'mp4',
  'png',
  'tif',
  'tiff',
  'webp',
]);

/** Accept a remote media URL only when it is covered by a configured, verified HTTPS prefix. */
export function isTikTokVerifiedMediaUrl(
  mediaUrl: string,
  configuredPrefixes = process.env.TIKTOK_VERIFIED_MEDIA_URL_PREFIXES
): boolean {
  if (!configuredPrefixes || configuredPrefixes.length > 8192) return false;

  let media: URL;
  try {
    media = new URL(mediaUrl);
  } catch {
    return false;
  }
  if (
    media.protocol !== 'https:' ||
    media.username ||
    media.password ||
    media.hash
  ) {
    return false;
  }

  return configuredPrefixes
    .split(',')
    .slice(0, 64)
    .some((configuredPrefix) => {
      const value = configuredPrefix.trim();
      if (!value || value.length > 2048) return false;

      let prefix: URL;
      try {
        prefix = new URL(value);
      } catch {
        return false;
      }
      if (
        prefix.protocol !== 'https:' ||
        prefix.username ||
        prefix.password ||
        prefix.search ||
        prefix.hash ||
        (prefix.pathname !== '/' && !prefix.pathname.endsWith('/'))
      ) {
        return false;
      }

      return (
        media.origin === prefix.origin &&
        media.pathname.startsWith(prefix.pathname)
      );
    });
}

/** Validate the relative upload key before it is signed or joined to disk. */
export function isValidTikTokMediaPath(path: string): boolean {
  if (
    !path ||
    path.length > 1024 ||
    path.startsWith('/') ||
    path.includes('\\')
  ) {
    return false;
  }

  const segments = path.split('/');
  if (
    segments.length > 8 ||
    segments.some(
      (segment) =>
        !segment ||
        segment.length > 255 ||
        segment === '.' ||
        segment === '..' ||
        !/^[A-Za-z0-9._-]+$/.test(segment)
    )
  ) {
    return false;
  }

  const extension = segments[segments.length - 1]
    .split('.')
    .pop()
    ?.toLowerCase();
  return !!extension && ALLOWED_MEDIA_EXTENSIONS.has(extension);
}

function mediaSignature(path: string, expires: number, secret: string): Buffer {
  return createHmac('sha256', secret).update(`${path}\n${expires}`).digest();
}

function requireSecret(secret: string | undefined): string {
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error(
      'TIKTOK_MEDIA_SIGNING_SECRET must contain at least 32 bytes'
    );
  }
  return secret;
}

/**
 * Return a signed URL only for media served from this app's own /uploads path.
 * Other storage providers keep using their existing public URL.
 */
export function signLocalTikTokMediaUrl(
  mediaUrl: string,
  options: {
    frontendUrl: string;
    secret?: string;
    nowSeconds?: number;
    ttlSeconds?: number;
  }
): string | undefined {
  let media: URL;
  let frontend: URL;
  try {
    media = new URL(mediaUrl);
  } catch {
    return undefined;
  }
  try {
    frontend = new URL(options.frontendUrl);
  } catch {
    if (media.pathname.startsWith('/uploads/')) {
      throw new Error('FRONTEND_URL is required to sign local TikTok media');
    }
    return undefined;
  }

  if (media.origin !== frontend.origin) {
    return undefined;
  }
  if (media.protocol !== 'https:' || frontend.protocol !== 'https:') {
    throw new Error('TikTok local media URLs must use HTTPS');
  }
  if (!media.pathname.startsWith('/uploads/')) {
    return undefined;
  }

  if (media.search || media.hash || media.username || media.password) {
    throw new Error(
      'Local TikTok media URL must not contain credentials or query data'
    );
  }

  let relativePath: string;
  try {
    relativePath = decodeURIComponent(media.pathname.slice('/uploads/'.length));
  } catch {
    throw new Error('Local TikTok media URL contains invalid path encoding');
  }
  if (!isValidTikTokMediaPath(relativePath)) {
    throw new Error('Local TikTok media URL has an invalid upload path');
  }

  const ttl = options.ttlSeconds ?? TIKTOK_MEDIA_MAX_TTL_SECONDS;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > TIKTOK_MEDIA_MAX_TTL_SECONDS) {
    throw new Error(
      'TikTok media URL expiry must be between 1 second and 2 hours'
    );
  }

  const secret = requireSecret(
    options.secret ?? process.env.TIKTOK_MEDIA_SIGNING_SECRET
  );
  const expires = (options.nowSeconds ?? Math.floor(Date.now() / 1000)) + ttl;
  const signature = mediaSignature(relativePath, expires, secret).toString(
    'hex'
  );
  const encodedPath = relativePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${frontend.origin}${MEDIA_ROUTE}${encodedPath}?expires=${expires}&signature=${signature}`;
}

/** Verify a signed request using constant-time comparison after strict bounds checks. */
export function verifyTikTokMediaSignature(
  path: string,
  expiresValue: string | null,
  signatureValue: string | null,
  secret: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000)
): boolean {
  if (!isValidTikTokMediaPath(path) || !expiresValue || !signatureValue) {
    return false;
  }
  if (
    !/^[0-9]{1,12}$/.test(expiresValue) ||
    !/^[a-f0-9]{64}$/i.test(signatureValue)
  ) {
    return false;
  }

  const expires = Number(expiresValue);
  if (
    !Number.isSafeInteger(expires) ||
    expires <= nowSeconds ||
    expires - nowSeconds > TIKTOK_MEDIA_MAX_TTL_SECONDS
  ) {
    return false;
  }

  let signingSecret: string;
  try {
    signingSecret = requireSecret(secret);
  } catch {
    return false;
  }

  const actual = Buffer.from(signatureValue, 'hex');
  const expected = mediaSignature(path, expires, signingSecret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
