import { YouTubeProvider } from './adapters/youtube/index.js';
import { InstagramProvider } from './adapters/instagram/index.js';
import { TikTokProvider } from './adapters/tiktok/index.js';
import { IVideoProvider, VideoProvider } from './types/provider.js';

/**
 * Registry for video provider adapters.
 * Handles provider detection and instantiation.
 */
export class ProviderRegistry {
  private static readonly providers: IVideoProvider[] = [
    new YouTubeProvider(),
    new InstagramProvider(),
    new TikTokProvider(),
  ];

  /**
   * Detect provider from URL.
   */
  static detectProvider(url: string): IVideoProvider | null {
    for (const provider of this.providers) {
      if (provider.canHandle(url)) {
        return provider;
      }
    }
    return null;
  }

  /**
   * Get provider by type.
   */
  static getProvider(type: VideoProvider): IVideoProvider | null {
    for (const provider of this.providers) {
      if ('getProvider' in provider && provider.getProvider() === type) {
        return provider;
      }
    }
    return null;
  }

  /**
   * Get all registered providers.
   */
  static getAllProviders(): IVideoProvider[] {
    return [...this.providers];
  }
}
