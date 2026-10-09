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
