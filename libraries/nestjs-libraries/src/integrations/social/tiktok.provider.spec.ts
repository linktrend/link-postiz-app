import { TiktokProvider } from './tiktok.provider';

const creatorInfoResponse = {
  error: { code: 'ok', message: '' },
  data: {
    creator_nickname: 'Creator',
    creator_avatar_url: 'https://example.com/avatar.png',
    privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
    comment_disabled: false,
    duet_disabled: true,
    stitch_disabled: false,
    max_video_post_duration_sec: 600,
  },
};

function response(body: unknown) {
  return { json: async () => body };
}

function makePost(settings: Record<string, unknown> = {}) {
  return {
    id: 'post-1',
    message: 'A TikTok post',
    media: [{ path: 'https://cdn.example.com/photo.jpg' }],
    settings: {
      tiktokConsent: true,
      content_posting_method: 'DIRECT_POST',
      privacy_level: 'PUBLIC_TO_EVERYONE',
      ...settings,
    },
  } as any;
}

describe('TiktokProvider compliance behavior', () => {
  let provider: TiktokProvider;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    provider = new TiktokProvider();
    fetchMock = jest.fn();
    (provider as any).fetch = fetchMock;
  });

  it('normalizes creator settings from TikTok snake_case fields', async () => {
    fetchMock.mockResolvedValue(response(creatorInfoResponse));

    await expect(provider.creatorInfo('access-token')).resolves.toEqual({
      creatorNickname: 'Creator',
      creatorAvatarUrl: 'https://example.com/avatar.png',
      privacyLevelOptions: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
      commentDisabled: false,
      duetDisabled: true,
      stitchDisabled: false,
      maxVideoPostDurationSec: 600,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://open.tiktokapis.com/v2/post/publish/creator_info/query/',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('rejects malformed creator settings instead of treating them as usable', async () => {
    fetchMock.mockResolvedValue(
      response({
        ...creatorInfoResponse,
        data: { ...creatorInfoResponse.data, privacy_level_options: [] },
      })
    );

    await expect(provider.creatorInfo('access-token')).rejects.toMatchObject({
      type: 'bad_body',
    });
  });

  it('requires explicit TikTok consent before making any TikTok request', async () => {
    await expect(
      provider.postPending(
        'id',
        'access-token',
        [makePost({ tiktokConsent: false })],
        {} as any
      )
    ).rejects.toMatchObject({ type: 'bad_body' });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects Direct Posts with disclosure enabled but no disclosure type selected', async () => {
    await expect(
      provider.postPending(
        'id',
        'access-token',
        [makePost({ disclose: true })],
        {} as any
      )
    ).rejects.toMatchObject({
      type: 'bad_body',
      message:
        'Choose whether this content promotes Your brand, Branded content, or both before posting to TikTok.',
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects Branded Content with private visibility before TikTok initialization', async () => {
    await expect(
      provider.postPending(
        'id',
        'access-token',
        [
          makePost({
            disclose: true,
            brand_content_toggle: true,
            privacy_level: 'SELF_ONLY',
          }),
        ],
        {} as any
      )
    ).rejects.toMatchObject({
      type: 'bad_body',
      message: expect.stringContaining(
        'cannot be posted with TikTok visibility'
      ),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clears stale commercial-content flags when disclosure is off', () => {
    const post = makePost({
      disclose: false,
      brand_content_toggle: true,
      brand_organic_toggle: true,
    });
    const body = (provider as any).buildTikokPostInfoBody(post);

    expect(body.post_info).toMatchObject({
      brand_content_toggle: false,
      brand_organic_toggle: false,
    });
  });

  it('uses signed PULL_FROM_URL for local photos and Direct Post videos only', () => {
    const previousFrontendUrl = process.env.FRONTEND_URL;
    const previousSecret = process.env.TIKTOK_MEDIA_SIGNING_SECRET;
    process.env.FRONTEND_URL = 'https://postiz.linktrend.one';
    process.env.TIKTOK_MEDIA_SIGNING_SECRET =
      'unit-test-only-signing-secret-with-enough-bytes';

    try {
      const photo = makePost();
      photo.media[0].path =
        'https://postiz.linktrend.one/uploads/2026/10/01/photo.jpg';
      const photoBody = (provider as any).buildTikokSourceInfoBody(
        photo,
        undefined,
        [
          'https://postiz.linktrend.one/tiktok-media/2026/10/01/photo.jpg?expires=1&signature=signed',
        ]
      );
      expect(photoBody.source_info).toMatchObject({
        source: 'PULL_FROM_URL',
        photo_images: [expect.stringContaining('/tiktok-media/')],
      });

      const directVideo = makePost({ content_posting_method: 'DIRECT_POST' });
      directVideo.media[0].path =
        'https://postiz.linktrend.one/uploads/2026/10/01/video.mp4';
      const directVideoBody = (provider as any).buildTikokSourceInfoBody(
        directVideo,
        undefined,
        undefined,
        'https://postiz.linktrend.one/tiktok-media/2026/10/01/video.mp4?expires=1&signature=signed'
      );
      expect(directVideoBody.source_info).toEqual({
        source: 'PULL_FROM_URL',
        video_url: expect.stringContaining('/tiktok-media/'),
      });

      const inboxVideo = makePost({ content_posting_method: 'UPLOAD' });
      inboxVideo.media[0].path =
        'https://postiz.linktrend.one/uploads/2026/10/01/video.mp4';
      const inboxVideoBody = (provider as any).buildTikokSourceInfoBody(
        inboxVideo,
        100
      );
      expect(inboxVideoBody.source_info.source).toBe('FILE_UPLOAD');
    } finally {
      if (previousFrontendUrl === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = previousFrontendUrl;
      if (previousSecret === undefined) {
        delete process.env.TIKTOK_MEDIA_SIGNING_SECRET;
      } else {
        process.env.TIKTOK_MEDIA_SIGNING_SECRET = previousSecret;
      }
    }
  });

  it('signs locally stored media into actual TikTok init requests', async () => {
    const previousFrontendUrl = process.env.FRONTEND_URL;
    const previousSecret = process.env.TIKTOK_MEDIA_SIGNING_SECRET;
    process.env.FRONTEND_URL = 'https://postiz.linktrend.one';
    process.env.TIKTOK_MEDIA_SIGNING_SECRET =
      'unit-test-only-signing-secret-with-enough-bytes';

    try {
      const photo = makePost();
      photo.media[0].path =
        'https://postiz.linktrend.one/uploads/2026/10/01/photo.jpg';
      fetchMock
        .mockResolvedValueOnce(response(creatorInfoResponse))
        .mockResolvedValueOnce(response({ data: { publish_id: 'photo-1' } }));
      await provider.postPending('id', 'access-token', [photo], {} as any);
      const photoInit = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(photoInit.source_info.source).toBe('PULL_FROM_URL');
      expect(photoInit.source_info.photo_images[0]).toContain(
        'https://postiz.linktrend.one/tiktok-media/2026/10/01/photo.jpg?'
      );

      fetchMock.mockReset();
      const video = makePost({ content_posting_method: 'DIRECT_POST' });
      video.media[0] = {
        path: 'https://postiz.linktrend.one/uploads/2026/10/01/video.mp4',
        duration: 12,
      };
      fetchMock
        .mockResolvedValueOnce(response(creatorInfoResponse))
        .mockResolvedValueOnce(response({ data: { publish_id: 'video-1' } }));
      await provider.postPending('id', 'access-token', [video], {} as any);
      const videoInit = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(videoInit.source_info).toMatchObject({
        source: 'PULL_FROM_URL',
        video_url: expect.stringContaining(
          'https://postiz.linktrend.one/tiktok-media/2026/10/01/video.mp4?'
        ),
      });
    } finally {
      if (previousFrontendUrl === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = previousFrontendUrl;
      if (previousSecret === undefined) {
        delete process.env.TIKTOK_MEDIA_SIGNING_SECRET;
      } else {
        process.env.TIKTOK_MEDIA_SIGNING_SECRET = previousSecret;
      }
    }
  });

  it('fails closed instead of using FILE_UPLOAD for unsupported Direct Post video URLs', async () => {
    const previousFrontendUrl = process.env.FRONTEND_URL;
    const previousVerifiedPrefixes =
      process.env.TIKTOK_VERIFIED_MEDIA_URL_PREFIXES;
    process.env.FRONTEND_URL = 'https://postiz.linktrend.one';
    delete process.env.TIKTOK_VERIFIED_MEDIA_URL_PREFIXES;
    fetchMock.mockResolvedValueOnce(response(creatorInfoResponse));

    try {
      const video = makePost({ content_posting_method: 'DIRECT_POST' });
      video.media[0] = {
        path: 'https://cdn.example.com/video.mp4',
        duration: 12,
      };
      await expect(
        provider.postPending('id', 'access-token', [video], {} as any)
      ).rejects.toMatchObject({
        type: 'bad_body',
        message: expect.stringContaining('securely read this media'),
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      if (previousFrontendUrl === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = previousFrontendUrl;
      if (previousVerifiedPrefixes === undefined) {
        delete process.env.TIKTOK_VERIFIED_MEDIA_URL_PREFIXES;
      } else {
        process.env.TIKTOK_VERIFIED_MEDIA_URL_PREFIXES =
          previousVerifiedPrefixes;
      }
    }
  });

  it('uses an explicitly verified HTTPS R2 prefix for Direct Post pulls', async () => {
    const previousFrontendUrl = process.env.FRONTEND_URL;
    const previousVerifiedPrefixes =
      process.env.TIKTOK_VERIFIED_MEDIA_URL_PREFIXES;
    process.env.FRONTEND_URL = 'https://postiz.linktrend.one';
    process.env.TIKTOK_VERIFIED_MEDIA_URL_PREFIXES =
      'https://assets.example-r2.com/tiktok/';

    try {
      const video = makePost({ content_posting_method: 'DIRECT_POST' });
      video.media[0] = {
        path: 'https://assets.example-r2.com/tiktok/video.mp4?sig=opaque',
        duration: 12,
      };
      fetchMock
        .mockResolvedValueOnce(response(creatorInfoResponse))
        .mockResolvedValueOnce(
          response({ data: { publish_id: 'r2-video-1' } })
        );

      await provider.postPending('id', 'access-token', [video], {} as any);

      const initBody = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(initBody.source_info).toEqual({
        source: 'PULL_FROM_URL',
        video_url: video.media[0].path,
      });
    } finally {
      if (previousFrontendUrl === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = previousFrontendUrl;
      if (previousVerifiedPrefixes === undefined) {
        delete process.env.TIKTOK_VERIFIED_MEDIA_URL_PREFIXES;
      } else {
        process.env.TIKTOK_VERIFIED_MEDIA_URL_PREFIXES =
          previousVerifiedPrefixes;
      }
    }
  });

  it.each([
    ['a sibling path', 'https://assets.example-r2.com/tiktok-evil/video.mp4'],
    ['an HTTP URL', 'http://assets.example-r2.com/tiktok/video.mp4'],
  ])(
    'rejects R2 Direct Post URLs that do not match the HTTPS prefix: %s',
    async (_label, url) => {
      const previousFrontendUrl = process.env.FRONTEND_URL;
      const previousVerifiedPrefixes =
        process.env.TIKTOK_VERIFIED_MEDIA_URL_PREFIXES;
      process.env.FRONTEND_URL = 'https://postiz.linktrend.one';
      process.env.TIKTOK_VERIFIED_MEDIA_URL_PREFIXES =
        'https://assets.example-r2.com/tiktok/';
      fetchMock.mockResolvedValueOnce(response(creatorInfoResponse));

      try {
        const video = makePost({ content_posting_method: 'DIRECT_POST' });
        video.media[0] = { path: url, duration: 12 };
        await expect(
          provider.postPending('id', 'access-token', [video], {} as any)
        ).rejects.toMatchObject({ type: 'bad_body' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
      } finally {
        if (previousFrontendUrl === undefined) delete process.env.FRONTEND_URL;
        else process.env.FRONTEND_URL = previousFrontendUrl;
        if (previousVerifiedPrefixes === undefined) {
          delete process.env.TIKTOK_VERIFIED_MEDIA_URL_PREFIXES;
        } else {
          process.env.TIKTOK_VERIFIED_MEDIA_URL_PREFIXES =
            previousVerifiedPrefixes;
        }
      }
    }
  );

  it('explains TikTok daily API post caps and the in-app retry path', () => {
    expect(provider.handleErrors('spam_risk_too_many_posts')).toMatchObject({
      type: 'bad-body',
      value: expect.stringContaining('publish through the TikTok app'),
    });
  });

  it.each([
    ['missing', undefined],
    ['invalid for this account', 'MUTUAL_FOLLOW_FRIENDS'],
  ])(
    'rejects a %s Direct Post privacy setting before initialization',
    async (_label, privacyLevel) => {
      fetchMock.mockResolvedValueOnce(response(creatorInfoResponse));

      await expect(
        provider.postPending(
          'id',
          'access-token',
          [makePost({ privacy_level: privacyLevel })],
          {} as any
        )
      ).rejects.toMatchObject({ type: 'bad_body' });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://open.tiktokapis.com/v2/post/publish/creator_info/query/',
        expect.any(Object)
      );
    }
  );

  it('marks inbox delivery separately from a published TikTok post', async () => {
    const integration = { profile: 'creator' } as any;
    fetchMock
      .mockResolvedValueOnce(
        response({ data: { status: 'SEND_TO_USER_INBOX' } })
      )
      .mockResolvedValueOnce(
        response({
          data: {
            status: 'PUBLISH_COMPLETE',
            publicaly_available_post_id: [123456],
          },
        })
      );

    await expect(
      provider.checkPostStatus(
        'access-token',
        { publishId: 'pending-1' },
        integration
      )
    ).resolves.toMatchObject({
      status: 'completed',
      postId: 'missing',
      deliveryStatus: 'inbox',
    });
    await expect(
      provider.checkPostStatus(
        'access-token',
        { publishId: 'pending-2' },
        integration
      )
    ).resolves.toMatchObject({
      status: 'completed',
      postId: '123456',
      deliveryStatus: 'published',
      releaseURL: 'https://www.tiktok.com/@creator/video/123456',
    });
  });
});
