import { describe, it, expect } from 'vitest';
import { URLValidator, URLValidationError } from '../src/url-validator';
import { ProviderRegistry } from '../src/registry';
import { YouTubeProvider } from '../src/adapters/youtube';
import { InstagramProvider } from '../src/adapters/instagram';
import { TikTokProvider } from '../src/adapters/tiktok';
import { ProviderMode } from '../src/types/provider';

describe('URLValidator', () => {
  describe('validate', () => {
    it('should return true for valid YouTube URLs', () => {
      expect(URLValidator.validate('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
      expect(URLValidator.validate('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
      expect(URLValidator.validate('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe(true);
    });

    it('should return true for valid Instagram URLs', () => {
      expect(URLValidator.validate('https://www.instagram.com/p/ABC123DEF45/')).toBe(true);
      expect(URLValidator.validate('https://www.instagram.com/reel/ABC123DEF45/')).toBe(true);
    });

    it('should return true for valid TikTok URLs', () => {
      expect(URLValidator.validate('https://www.tiktok.com/@user/video/1234567890')).toBe(true);
      expect(URLValidator.validate('https://vm.tiktok.com/abc123xyz')).toBe(true);
    });

    it('should return false for invalid URLs', () => {
      expect(URLValidator.validate('not a url')).toBe(false);
      expect(URLValidator.validate('https://example.com')).toBe(false);
      expect(URLValidator.validate('https://www.facebook.com')).toBe(false);
    });
  });

  describe('normalize', () => {
    it('should normalize YouTube URLs', () => {
      const result = URLValidator.normalize('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(result.canonicalUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(result.provider).toBe('youtube');
    });

    it('should normalize YouTube short URLs', () => {
      const result = URLValidator.normalize('https://youtu.be/dQw4w9WgXcQ');
      expect(result.canonicalUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(result.provider).toBe('youtube');
    });

    it('should normalize YouTube Shorts', () => {
      const result = URLValidator.normalize('https://www.youtube.com/shorts/dQw4w9WgXcQ');
      expect(result.canonicalUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(result.provider).toBe('youtube');
    });

    it('should normalize Instagram URLs', () => {
      const result = URLValidator.normalize('https://www.instagram.com/p/ABC123DEF45/');
      expect(result.canonicalUrl).toBe('https://www.instagram.com/p/ABC123DEF45/');
      expect(result.provider).toBe('instagram');
    });

    it('should normalize TikTok URLs', () => {
      const result = URLValidator.normalize('https://www.tiktok.com/@user/video/1234567890');
      expect(result.canonicalUrl).toContain('1234567890');
      expect(result.provider).toBe('tiktok');
    });

    it('should throw URLValidationError for invalid URLs', () => {
      expect(() => {
        URLValidator.normalize('not a url');
      }).toThrow(URLValidationError);
    });

    it('should throw URLValidationError for unsupported platforms', () => {
      expect(() => {
        URLValidator.normalize('https://www.example.com/video');
      }).toThrow(URLValidationError);
    });
  });

  describe('removeTrackingParams', () => {
    it('should remove UTM parameters', () => {
      const url =
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ&utm_source=twitter&utm_medium=social&utm_campaign=campaign1';
      const cleaned = URLValidator.removeTrackingParams(url);
      expect(cleaned).not.toContain('utm_source');
      expect(cleaned).not.toContain('utm_medium');
      expect(cleaned).not.toContain('utm_campaign');
    });

    it('should remove other tracking parameters', () => {
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&fbclid=abc123&gclid=xyz789';
      const cleaned = URLValidator.removeTrackingParams(url);
      expect(cleaned).not.toContain('fbclid');
      expect(cleaned).not.toContain('gclid');
    });

    it('should preserve non-tracking parameters', () => {
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120&list=PLxxxxx';
      const cleaned = URLValidator.removeTrackingParams(url);
      expect(cleaned).toContain('v=dQw4w9WgXcQ');
      expect(cleaned).toContain('t=120');
      expect(cleaned).toContain('list=PLxxxxx');
    });

    it('should handle URLs without tracking params', () => {
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      const cleaned = URLValidator.removeTrackingParams(url);
      expect(cleaned).toBe(url);
    });
  });
});

describe('ProviderRegistry', () => {
  describe('detectProvider', () => {
    it('should detect YouTube provider', () => {
      const provider = ProviderRegistry.detectProvider(
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      );
      expect(provider).toBeInstanceOf(YouTubeProvider);
    });

    it('should detect Instagram provider', () => {
      const provider = ProviderRegistry.detectProvider('https://www.instagram.com/p/ABC123DEF45/');
      expect(provider).toBeInstanceOf(InstagramProvider);
    });

    it('should detect TikTok provider', () => {
      const provider = ProviderRegistry.detectProvider(
        'https://www.tiktok.com/@user/video/1234567890',
      );
      expect(provider).toBeInstanceOf(TikTokProvider);
    });

    it('should return null for unsupported URLs', () => {
      const provider = ProviderRegistry.detectProvider('https://www.example.com');
      expect(provider).toBeNull();
    });
  });

  describe('getAllProviders', () => {
    it('should return all registered providers', () => {
      const providers = ProviderRegistry.getAllProviders();
      expect(providers.length).toBeGreaterThan(0);
      expect(providers.some((p) => p instanceof YouTubeProvider)).toBe(true);
      expect(providers.some((p) => p instanceof InstagramProvider)).toBe(true);
      expect(providers.some((p) => p instanceof TikTokProvider)).toBe(true);
    });
  });
});

describe('YouTubeProvider', () => {
  const provider = new YouTubeProvider();

  describe('canHandle', () => {
    it('should handle youtube.com URLs', () => {
      expect(provider.canHandle('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
    });

    it('should handle youtu.be URLs', () => {
      expect(provider.canHandle('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
    });

    it('should handle YouTube Shorts', () => {
      expect(provider.canHandle('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe(true);
    });

    it('should not handle non-YouTube URLs', () => {
      expect(provider.canHandle('https://www.instagram.com/p/ABC123')).toBe(false);
    });
  });

  describe('extractVideoId', () => {
    it('should extract video ID from youtube.com URLs', () => {
      const id = provider.extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(id).toBe('dQw4w9WgXcQ');
    });

    it('should extract video ID from youtu.be URLs', () => {
      const id = provider.extractVideoId('https://youtu.be/dQw4w9WgXcQ');
      expect(id).toBe('dQw4w9WgXcQ');
    });

    it('should extract video ID from YouTube Shorts', () => {
      const id = provider.extractVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ');
      expect(id).toBe('dQw4w9WgXcQ');
    });

    it('should return null for invalid video IDs', () => {
      const id = provider.extractVideoId('https://www.youtube.com/watch?v=invalid');
      expect(id).toBeNull();
    });

    it('should ignore tracking parameters', () => {
      const id = provider.extractVideoId(
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120&list=PLxxxxx',
      );
      expect(id).toBe('dQw4w9WgXcQ');
    });
  });

  describe('normalizeUrl', () => {
    it('should normalize YouTube URLs', () => {
      const url = provider.normalizeUrl(
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120&utm_source=test',
      );
      expect(url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    });

    it('should normalize youtu.be URLs', () => {
      const url = provider.normalizeUrl('https://youtu.be/dQw4w9WgXcQ');
      expect(url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    });

    it('should return null for invalid URLs', () => {
      const url = provider.normalizeUrl('https://www.example.com');
      expect(url).toBeNull();
    });
  });

  describe('capabilities and modes', () => {
    it('should expose YouTube provider capabilities', () => {
      expect(provider.capabilities()).toEqual({
        supportsMetadata: true,
        supportsTranscript: true,
        supportsNativeTranscript: true,
        supportsFallbackTranscript: true,
      });
    });

    it('should return deterministic mock metadata and transcript', async () => {
      const metadata = await provider.fetchMetadata('dQw4w9WgXcQ', {
        mode: ProviderMode.MOCK,
      });

      expect(metadata.sourceAttribution).toBe('MOCK');
      expect(metadata.metadata.platformVideoId).toBe('dQw4w9WgXcQ');

      const transcript = await provider.fetchTranscript('dQw4w9WgXcQ', {
        mode: ProviderMode.MOCK,
      });

      expect(transcript).not.toBeNull();
      expect(transcript?.status).toBe('AVAILABLE');
      expect(transcript?.sourceAttribution).toBe('MOCK');
      expect(transcript?.hasNativeTranscript).toBe(true);
    });
  });
});

describe('InstagramProvider', () => {
  const provider = new InstagramProvider();

  describe('canHandle', () => {
    it('should handle instagram.com URLs', () => {
      expect(provider.canHandle('https://www.instagram.com/p/ABC123DEF45/')).toBe(true);
    });

    it('should not handle non-Instagram URLs', () => {
      expect(provider.canHandle('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(false);
    });
  });

  describe('extractVideoId', () => {
    it('should extract ID from instagram.com/p/ URLs', () => {
      const id = provider.extractVideoId('https://www.instagram.com/p/ABC123/');
      expect(id).toBe('ABC123');
    });

    it('should extract ID from instagram.com/reel/ URLs', () => {
      const id = provider.extractVideoId('https://www.instagram.com/reel/ABC123/');
      expect(id).toBe('ABC123');
    });

    it('should handle URL trailing slashes', () => {
      const id = provider.extractVideoId('https://www.instagram.com/p/ABC123');
      expect(id).toBe('ABC123');
    });
  });

  describe('normalizeUrl', () => {
    it('should normalize Instagram URLs', () => {
      const url = provider.normalizeUrl('https://www.instagram.com/p/ABC123DEF45/');
      expect(url).toBe('https://www.instagram.com/p/ABC123DEF45/');
    });
  });
});

describe('TikTokProvider', () => {
  const provider = new TikTokProvider();

  describe('canHandle', () => {
    it('should handle tiktok.com URLs', () => {
      expect(provider.canHandle('https://www.tiktok.com/@user/video/1234567890')).toBe(true);
    });

    it('should handle vm.tiktok.com short links', () => {
      expect(provider.canHandle('https://vm.tiktok.com/abc123xyz')).toBe(true);
    });

    it('should not handle non-TikTok URLs', () => {
      expect(provider.canHandle('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(false);
    });
  });

  describe('extractVideoId', () => {
    it('should extract video ID from tiktok.com URLs', () => {
      const id = provider.extractVideoId('https://www.tiktok.com/@user/video/1234567890');
      expect(id).toBe('1234567890');
    });

    it('should extract short code from vm.tiktok.com', () => {
      const id = provider.extractVideoId('https://vm.tiktok.com/abc123xyz');
      expect(id).toBe('abc123xyz');
    });
  });
});
