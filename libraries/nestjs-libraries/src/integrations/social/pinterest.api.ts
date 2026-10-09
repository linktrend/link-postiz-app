/** Supported Pinterest API environments. */
export type PinterestApiEnvironment = 'production' | 'sandbox';

const PINTEREST_API_ORIGINS: Record<PinterestApiEnvironment, string> = {
  production: 'https://api.pinterest.com',
  sandbox: 'https://api-sandbox.pinterest.com',
};

/**
 * Builds a Pinterest API URL for the configured API environment.
 *
 * @param path A Pinterest API path beginning with `/v5/`.
 * @param environment The API environment, defaulting to
 * `PINTEREST_API_ENVIRONMENT` or production.
 * @returns A URL using one of Pinterest's fixed API origins.
 * @throws If the environment or API path is unsupported.
 */
export function getPinterestApiUrl(
  path: string,
  environment: string | undefined = process.env.PINTEREST_API_ENVIRONMENT
): string {
  const selectedEnvironment = environment ?? 'production';

  if (
    selectedEnvironment !== 'production' &&
    selectedEnvironment !== 'sandbox'
  ) {
    throw new Error(
      'PINTEREST_API_ENVIRONMENT must be either "production" or "sandbox"'
    );
  }

  if (!path.startsWith('/v5/') || path.startsWith('//')) {
    throw new Error('Pinterest API paths must begin with "/v5/"');
  }

  return `${PINTEREST_API_ORIGINS[selectedEnvironment]}${path}`;
}
