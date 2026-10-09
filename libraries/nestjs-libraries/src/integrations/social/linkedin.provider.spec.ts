import { buildLinkedinPersonalAuthorizationUrl } from './linkedin.oauth';

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
});
