import { PinterestProvider } from './pinterest.provider';

jest.mock('sharp', () => jest.fn());

describe('PinterestProvider API environment', () => {
  const originalEnvironment = {
    pinterestApi: process.env.PINTEREST_API_ENVIRONMENT,
    pinterestClientId: process.env.PINTEREST_CLIENT_ID,
    frontendUrl: process.env.FRONTEND_URL,
  };
  const provider = new PinterestProvider();

  beforeEach(() => {
    process.env.PINTEREST_API_ENVIRONMENT = 'sandbox';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalEnvironment.pinterestApi === undefined) {
      delete process.env.PINTEREST_API_ENVIRONMENT;
    } else {
      process.env.PINTEREST_API_ENVIRONMENT = originalEnvironment.pinterestApi;
    }
    if (originalEnvironment.pinterestClientId === undefined) {
      delete process.env.PINTEREST_CLIENT_ID;
    } else {
      process.env.PINTEREST_CLIENT_ID = originalEnvironment.pinterestClientId;
    }
    if (originalEnvironment.frontendUrl === undefined) {
      delete process.env.FRONTEND_URL;
    } else {
      process.env.FRONTEND_URL = originalEnvironment.frontendUrl;
    }
  });

  it('keeps the user authorization page on Pinterest while selecting Sandbox API URLs', async () => {
    process.env.PINTEREST_CLIENT_ID = 'test-pinterest-client-id';
    process.env.FRONTEND_URL = 'https://postiz.example.com';

    const { url } = await provider.generateAuthUrl();

    expect(new URL(url).origin).toBe('https://www.pinterest.com');
  });

  it('exchanges OAuth codes and reads the profile through the Sandbox API', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    fetchMock
      .mockResolvedValueOnce({
        json: async () => ({
          access_token: 'sandbox-access-token',
          refresh_token: 'sandbox-refresh-token',
          expires_in: 3600,
          scope:
            'boards:read boards:write pins:read pins:write user_accounts:read',
        }),
      } as Response)
      .mockResolvedValueOnce({
        json: async () => ({
          id: '123',
          username: 'demo-user',
          profile_image: 'https://example.com/profile.png',
        }),
      } as Response);

    const auth = await provider.authenticate({
      code: 'oauth-code',
      codeVerifier: '',
      refresh: '',
    });

    expect(auth.accessToken).toBe('sandbox-access-token');
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api-sandbox.pinterest.com/v5/oauth/token',
      'https://api-sandbox.pinterest.com/v5/user_account',
    ]);
  });

  it('refreshes Sandbox tokens and reads their profiles through the Sandbox API', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    fetchMock
      .mockResolvedValueOnce({
        json: async () => ({
          access_token: 'refreshed-sandbox-access-token',
          expires_in: 3600,
        }),
      } as Response)
      .mockResolvedValueOnce({
        json: async () => ({
          id: '123',
          username: 'demo-user',
          profile_image: 'https://example.com/profile.png',
        }),
      } as Response);

    const auth = await provider.refreshToken('sandbox-refresh-token');

    expect(auth.accessToken).toBe('refreshed-sandbox-access-token');
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api-sandbox.pinterest.com/v5/oauth/token',
      'https://api-sandbox.pinterest.com/v5/user_account',
    ]);
  });

  it('lists boards through the Sandbox API', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({ items: [{ id: 'board-1', name: 'Sandbox board' }] }),
    } as Response);

    await expect(provider.boards('sandbox-access-token')).resolves.toEqual([
      { id: 'board-1', name: 'Sandbox board' },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api-sandbox.pinterest.com/v5/boards?page_size=250',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('creates Pins through the Sandbox API', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      status: 201,
      json: async () => ({ id: 'sandbox-pin-1' }),
    } as Response);

    await expect(
      provider.finalizePost(
        'sandbox-access-token',
        {
          mediaId: '',
          message: 'Sandbox demo Pin',
          settings: { board: 'sandbox-board-1' },
          imagePaths: ['https://example.com/pin.jpg'],
          attempting: true,
          confirmed: true,
        },
        {} as any
      )
    ).resolves.toMatchObject({
      status: 'completed',
      postId: 'sandbox-pin-1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api-sandbox.pinterest.com/v5/pins',
      expect.objectContaining({ method: 'POST' })
    );
  });
});
