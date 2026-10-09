import { getPinterestApiUrl } from './pinterest.api';

describe('getPinterestApiUrl', () => {
  const originalEnvironment = process.env.PINTEREST_API_ENVIRONMENT;

  afterEach(() => {
    if (originalEnvironment === undefined) {
      delete process.env.PINTEREST_API_ENVIRONMENT;
    } else {
      process.env.PINTEREST_API_ENVIRONMENT = originalEnvironment;
    }
  });

  it('defaults to the production API when no environment is configured', () => {
    delete process.env.PINTEREST_API_ENVIRONMENT;

    expect(getPinterestApiUrl('/v5/pins')).toBe(
      'https://api.pinterest.com/v5/pins'
    );
  });

  it('uses the fixed Sandbox origin when selected', () => {
    expect(getPinterestApiUrl('/v5/pins', 'sandbox')).toBe(
      'https://api-sandbox.pinterest.com/v5/pins'
    );
  });

  it('rejects unsupported environments and paths', () => {
    expect(() => getPinterestApiUrl('/v5/pins', 'https://example.com')).toThrow(
      'PINTEREST_API_ENVIRONMENT must be either "production" or "sandbox"'
    );
    expect(() => getPinterestApiUrl('/v5/pins', '')).toThrow(
      'PINTEREST_API_ENVIRONMENT must be either "production" or "sandbox"'
    );
    expect(() =>
      getPinterestApiUrl('//example.com/v5/pins', 'sandbox')
    ).toThrow('Pinterest API paths must begin with "/v5/"');
  });
});
