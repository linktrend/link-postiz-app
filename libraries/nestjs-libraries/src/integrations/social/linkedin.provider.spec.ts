import {
  buildLinkedinPersonalAuthorizationUrl,
  mapLinkedinPersonalUserInfo,
  resolveLinkedinTokenLifecycle,
} from './linkedin.oauth';

jest.mock('@gitroom/nestjs-libraries/integrations/social.abstract', () => ({
  SocialAbstract: class {
    checkScopes() {}
  },
}));
jest.mock('@gitroom/helpers/decorators/post.plug', () => ({
  PostPlug: () => () => undefined,
}));
jest.mock('@gitroom/nestjs-libraries/chat/rules.description.decorator', () => ({
  Rules: () => () => undefined,
}));
jest.mock(
  '@gitroom/nestjs-libraries/dtos/posts/providers-settings/linkedin.dto',
  () => ({
    LinkedinDto: class {},
  })
);
jest.mock('@gitroom/nestjs-libraries/services/make.is', () => ({
  makeId: jest.fn(),
}));
jest.mock('@gitroom/nestjs-libraries/services/make.secure.id', () => ({
  makeSecureId: jest.fn(),
}));
jest.mock('@gitroom/helpers/utils/has.extension', () => ({
  hasExtension: jest.fn(),
}));
jest.mock('@gitroom/helpers/utils/timer', () => ({ timer: jest.fn() }));
jest.mock('sharp', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('mime-types', () => ({ lookup: jest.fn() }));
jest.mock('image-to-pdf', () => ({ __esModule: true, default: jest.fn() }));

import { LinkedinProvider } from './linkedin.provider';

describe('LinkedinProvider personal OAuth', () => {
  it('requests only supported personal scopes and allows interactive sign-in', () => {
    const authorizationUrl = new URL(
      buildLinkedinPersonalAuthorizationUrl({
        clientId: 'test-linkedin-client-id',
        frontendUrl: 'https://postiz.example.com',
        state: 'test-state',
      })
    );

    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      'https://www.linkedin.com/oauth/v2/authorization'
    );
    expect(authorizationUrl.searchParams.get('client_id')).toBe(
      'test-linkedin-client-id'
    );
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(
      'https://postiz.example.com/integrations/social/linkedin'
    );
    expect(authorizationUrl.searchParams.get('state')).toBe('test-state');
    expect(authorizationUrl.searchParams.get('scope')?.split(' ')).toEqual([
      'openid',
      'profile',
      'w_member_social',
    ]);
    expect(authorizationUrl.searchParams.has('prompt')).toBe(false);
  });

  it('uses OIDC claims for member identity without requiring the legacy profile API', () => {
    expect(
      mapLinkedinPersonalUserInfo({
        sub: 'member-subject',
        name: 'Carlos Salas',
        picture: 'https://example.com/profile.jpg',
      })
    ).toEqual({
      id: 'member-subject',
      name: 'Carlos Salas',
      picture: 'https://example.com/profile.jpg',
      username: 'member-subject',
    });
  });

  it('does not schedule refresh when LinkedIn did not issue a refresh token', () => {
    expect(
      resolveLinkedinTokenLifecycle({ expiresIn: 60 * 60 * 24 * 60 })
    ).toEqual({ refreshToken: undefined, expiresIn: undefined });
  });

  it('retains an existing refresh token when a refresh response omits rotation', () => {
    expect(
      resolveLinkedinTokenLifecycle({
        refreshToken: 'existing-refresh-token',
        expiresIn: 60 * 60 * 24 * 60,
      })
    ).toEqual({
      refreshToken: 'existing-refresh-token',
      expiresIn: 60 * 60 * 24 * 60,
    });
  });

  it('connects with OIDC userinfo and does not require the restricted /v2/me API', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          access_token: 'access-token',
          expires_in: 60 * 60 * 24 * 60,
          scope: 'openid profile w_member_social',
        }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          sub: 'member-subject',
          name: 'Carlos Salas',
          picture: 'https://example.com/profile.jpg',
        }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await new LinkedinProvider().authenticate({
      code: 'code',
      codeVerifier: 'verifier',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.linkedin.com/v2/userinfo'
    );
    expect(result).toMatchObject({
      id: 'member-subject',
      username: 'member-subject',
      name: 'Carlos Salas',
      refreshToken: undefined,
      expiresIn: undefined,
    });
  });
});
