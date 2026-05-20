import { ProviderRegistry } from './registry.js';

export class URLValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'URLValidationError';
  }
}

/**
 * URL validation and normalization service.
 * Handles:
 * - Supported URL validation
 * - Canonical URL normalization
 * - Tracking param removal
 * - Short-link support
 * - Provider detection
 */
export class URLValidator {
  /**
   * Validate if URL is a supported video platform URL.
   */
  static validate(url: string): boolean {
    try {
      const provider = ProviderRegistry.detectProvider(url);
      return provider !== null;
    } catch {
      return false;
    }
  }

  /**
   * Normalize URL to canonical form with provider detection.
   * Throws URLValidationError if URL is not supported.
   */
  static normalize(url: string): { canonicalUrl: string; provider: string } {
    // Basic URL validation
    try {
      // Validate that URL can be parsed
      new URL(url);
    } catch {
      throw new URLValidationError('Invalid URL format');
    }

    // Detect provider
    const provider = ProviderRegistry.detectProvider(url);
    if (!provider) {
      throw new URLValidationError(
        'URL is from an unsupported platform. Supported: YouTube, Instagram, TikTok',
      );
    }

    // Normalize URL
    const normalized = provider.normalizeUrl(url);
    if (!normalized) {
      throw new URLValidationError('Could not extract video ID from URL');
    }

    // Get provider name (extract from provider instance)
    const providerName = this.getProviderName(provider);

    return {
      canonicalUrl: normalized,
      provider: providerName,
    };
  }

  /**
   * Extract provider name from provider instance.
   */
  private static getProviderName(provider: unknown): string {
    // Infer from provider method if available
    if (provider && typeof (provider as { getProvider?: unknown }).getProvider === 'function') {
      return (provider as { getProvider: () => string }).getProvider();
    }

    // Fallback: extract from constructor name
    return String((provider as { constructor?: { name?: string } }).constructor?.name)
      .replace('Provider', '')
      .toLowerCase();
  }

  /**
   * Remove tracking parameters from URL.
   */
  static removeTrackingParams(url: string): string {
    try {
      const urlObj = new URL(url);

      // Common tracking parameters to remove
      const trackingParams = [
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'utm_content',
        'utm_term',
        'fbclid',
        'gclid',
        'msclkid',
      ];

      for (const param of trackingParams) {
        urlObj.searchParams.delete(param);
      }

      return urlObj.toString();
    } catch {
      return url;
    }
  }
}
