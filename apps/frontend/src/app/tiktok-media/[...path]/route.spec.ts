import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { signLocalTikTokMediaUrl } from '@gitroom/nestjs-libraries/upload/tiktok.signed-media';
import { GET, HEAD } from './route';

const secret = 'unit-test-only-signing-secret-with-enough-bytes';

describe('signed TikTok media route', () => {
  let uploadDirectory: string;
  const originalDirectory = process.env.UPLOAD_DIRECTORY;
  const originalSecret = process.env.TIKTOK_MEDIA_SIGNING_SECRET;

  beforeEach(() => {
    uploadDirectory = mkdtempSync(join(tmpdir(), 'tiktok-media-'));
    mkdirSync(join(uploadDirectory, '2026', '10', '01'), { recursive: true });
    writeFileSync(
      join(uploadDirectory, '2026', '10', '01', 'photo.jpg'),
      Buffer.from('photo bytes')
    );
    process.env.UPLOAD_DIRECTORY = uploadDirectory;
    process.env.TIKTOK_MEDIA_SIGNING_SECRET = secret;
  });

  afterEach(() => {
    rmSync(uploadDirectory, { recursive: true, force: true });
    if (originalDirectory === undefined) delete process.env.UPLOAD_DIRECTORY;
    else process.env.UPLOAD_DIRECTORY = originalDirectory;
    if (originalSecret === undefined) {
      delete process.env.TIKTOK_MEDIA_SIGNING_SECRET;
    } else {
      process.env.TIKTOK_MEDIA_SIGNING_SECRET = originalSecret;
    }
  });

  function signedRequest(nowSeconds = Math.floor(Date.now() / 1000)) {
    const signedUrl = signLocalTikTokMediaUrl(
      'https://postiz.linktrend.one/uploads/2026/10/01/photo.jpg',
      {
        frontendUrl: 'https://postiz.linktrend.one',
        secret,
        nowSeconds,
      }
    )!;
    const url = new URL(signedUrl);
    return {
      request: new Request(url),
      context: {
        params: Promise.resolve({ path: ['2026', '10', '01', 'photo.jpg'] }),
      },
      url,
    };
  }

  it('serves signed media on GET and HEAD without caching or redirecting', async () => {
    const { request, context } = signedRequest();
    const expires = Number(new URL(request.url).searchParams.get('expires'));
    expect(expires - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(7200);
    expect(expires - Math.floor(Date.now() / 1000)).toBeGreaterThan(7190);

    const getResponse = await GET(request, context);
    expect(getResponse.status).toBe(200);
    expect(getResponse.headers.get('cache-control')).toContain('no-store');
    expect(getResponse.headers.get('content-type')).toBe('image/jpeg');
    expect(getResponse.redirected).toBe(false);
    expect(getResponse.headers.has('location')).toBe(false);
    await expect(getResponse.text()).resolves.toBe('photo bytes');

    const headRequest = new Request(request.url, { method: 'HEAD' });
    const headResponse = await HEAD(headRequest, context);
    expect(headResponse.status).toBe(200);
    expect(headResponse.headers.get('content-length')).toBe('11');
    expect(await headResponse.text()).toBe('');
  });

  it('rejects expired, modified, and traversal requests', async () => {
    const expired = signedRequest(1000);
    expect((await GET(expired.request, expired.context)).status).toBe(404);

    const signed = signedRequest();
    const tamperedUrl = new URL(signed.url);
    tamperedUrl.searchParams.set('signature', '0'.repeat(64));
    expect(
      (
        await GET(new Request(tamperedUrl), {
          params: Promise.resolve({ path: ['2026', '10', '01', 'photo.jpg'] }),
        })
      ).status
    ).toBe(404);

    expect(
      (
        await GET(signed.request, {
          params: Promise.resolve({ path: ['..', '..', 'etc', 'passwd.jpg'] }),
        })
      ).status
    ).toBe(404);
  });

  it('signs only local upload URLs and caps expiry at two hours', () => {
    expect(
      signLocalTikTokMediaUrl('https://cdn.example.com/media/photo.jpg', {
        frontendUrl: 'https://postiz.linktrend.one',
        secret,
      })
    ).toBeUndefined();
    expect(() =>
      signLocalTikTokMediaUrl(
        'https://postiz.linktrend.one/uploads/2026/10/01/photo.jpg',
        {
          frontendUrl: 'https://postiz.linktrend.one',
          secret,
          ttlSeconds: 7201,
        }
      )
    ).toThrow(/between 1 second and 2 hours/);
  });
});
