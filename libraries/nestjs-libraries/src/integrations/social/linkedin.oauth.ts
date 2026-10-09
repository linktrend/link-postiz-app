/** LinkedIn OpenID and write permissions available to personal connections. */
export const LINKEDIN_PERSONAL_SCOPES = [
  'openid',
  'profile',
  'w_member_social',
] as const;

/**
 * Builds the authorization URL for a LinkedIn personal account connection.
 *
 * @param input - OAuth client, callback origin, and state values.
 * @returns LinkedIn's authorization URL with supported personal scopes.
 */
export function buildLinkedinPersonalAuthorizationUrl(input: {
  clientId: string;
  frontendUrl: string;
  state: string;
}): string {
  const authorizationUrl = new URL(
    'https://www.linkedin.com/oauth/v2/authorization'
  );
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('client_id', input.clientId);
  authorizationUrl.searchParams.set(
    'redirect_uri',
    `${input.frontendUrl}/integrations/social/linkedin`
  );
  authorizationUrl.searchParams.set('state', input.state);
  authorizationUrl.searchParams.set(
    'scope',
    LINKEDIN_PERSONAL_SCOPES.join(' ')
  );
  return authorizationUrl.toString();
}

/**
 * Resolves optional LinkedIn refresh-token support without scheduling a
 * refresh that the application cannot perform.
 *
 * @param input - New token response and any refresh token already held.
 * @returns The refresh token to store and a supported access-token lifetime.
 */
export function resolveLinkedinTokenLifecycle(input: {
  refreshToken?: string;
  responseRefreshToken?: string;
  expiresIn?: number;
}): { refreshToken?: string; expiresIn?: number } {
  const refreshToken = input.responseRefreshToken || input.refreshToken;
  return {
    refreshToken,
    expiresIn: refreshToken ? input.expiresIn : undefined,
  };
}

/**
 * Maps the LinkedIn OpenID Connect userinfo response to Postiz identity fields.
 *
 * @param userInfo - Identity claims returned by LinkedIn's userinfo endpoint.
 * @returns Postiz account fields using the stable OIDC subject as its profile.
 */
export function mapLinkedinPersonalUserInfo(userInfo: {
  sub: string;
  name: string;
  picture?: string;
}): { id: string; name: string; picture: string; username: string } {
  return {
    id: userInfo.sub,
    name: userInfo.name,
    picture: userInfo.picture || '',
    username: userInfo.sub,
  };
}
