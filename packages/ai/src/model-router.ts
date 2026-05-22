export interface ModelRouterLogger {
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
  debug(msg: string, meta?: unknown): void;
}

const noOpLogger: ModelRouterLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

export class ModelRouter {
  private readonly priorityList = [
    'gemini-3.1-flash-lite',
    'gemini-2-flash-lite',
    'gemini-2-flash',
  ];

  private cooldowns = new Map<string, number>();
  private readonly COOLDOWN_MS = 60 * 1000;
  private logger: ModelRouterLogger;

  constructor(logger?: ModelRouterLogger) {
    this.logger = logger ?? noOpLogger;
  }

  setLogger(logger: ModelRouterLogger): void {
    this.logger = logger;
  }

  getActiveModel(): string | null {
    const now = Date.now();
    for (const model of this.priorityList) {
      const cooldownUntil = this.cooldowns.get(model);
      if (!cooldownUntil || now > cooldownUntil) {
        if (cooldownUntil) {
          this.cooldowns.delete(model);
          this.logger.info(`[ModelRouter] ${model} recovered from cooldown`);
        }
        return model;
      }
    }

    this.logger.warn(
      '[ModelRouter] All available models are currently in cooldown. Triggering fallback.',
    );
    return null;
  }

  reportFailure(model: string, status?: number): void {
    if (status === 429 || (status !== undefined && status >= 500)) {
      this.logger.warn(
        `[ModelRouter] Model ${model} failed with status ${status}. Placing on cooldown for ${this.COOLDOWN_MS / 1000}s.`,
      );
      this.cooldowns.set(model, Date.now() + this.COOLDOWN_MS);
    }
  }

  getDiagnostics(): { activeModel: string; cooldowns: Record<string, number> } {
    const now = Date.now();
    const cooldownState = Object.fromEntries(
      Array.from(this.cooldowns.entries()).map(([model, time]) => [
        model,
        Math.max(0, Math.round((time - now) / 1000)),
      ]),
    );

    return {
      activeModel: this.getActiveModel() || 'mock-fallback',
      cooldowns: cooldownState,
    };
  }
}

export const globalModelRouter = new ModelRouter();
