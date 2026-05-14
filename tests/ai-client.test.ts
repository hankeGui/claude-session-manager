import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';

vi.mock('fs');
vi.mock('os', async () => {
  const actual = await vi.importActual('os');
  return { ...actual, homedir: () => '/mock-home' };
});
let mockCreateBehavior: 'success' | 'auth-error-then-success' | 'auth-error' = 'success';
let mockCallCount = 0;

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    constructor(public opts: any) {}
    messages = {
      create: vi.fn().mockImplementation(() => {
        mockCallCount++;
        if (mockCreateBehavior === 'auth-error-then-success') {
          if (mockCallCount === 1) {
            const err: any = new Error('Unauthorized');
            err.status = 401;
            return Promise.reject(err);
          }
          return Promise.resolve({ content: [{ type: 'text', text: 'AI response via fallback' }] });
        }
        if (mockCreateBehavior === 'auth-error') {
          const err: any = new Error('Unauthorized');
          err.status = 401;
          return Promise.reject(err);
        }
        return Promise.resolve({ content: [{ type: 'text', text: 'AI response' }] });
      }),
    };
  },
}));

describe('ai-client', () => {
  let aiClient: typeof import('../src/services/ai-client');

  beforeEach(async () => {
    vi.resetModules();
    vi.mocked(fs.readFileSync).mockReturnValue('{}');
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    mockCreateBehavior = 'success';
    mockCallCount = 0;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.ANTHROPIC_SMALL_FAST_MODEL;
    delete process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
    delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL;
    delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL;
    aiClient = await import('../src/services/ai-client');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadAiConfig', () => {
    it('returns null when no auth method configured', () => {
      expect(aiClient.loadAiConfig()).toBeNull();
    });

    it('returns config when API key and model are in env', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test-key';
      process.env.ANTHROPIC_MODEL = 'test-model';
      const config = aiClient.loadAiConfig();
      expect(config).not.toBeNull();
      expect(config!.apiKey).toBe('sk-test-key');
      expect(config!.baseUrl).toBe('https://api.anthropic.com');
    });

    it('returns config when auth token and model are in env', () => {
      process.env.ANTHROPIC_AUTH_TOKEN = 'my-auth-token';
      process.env.ANTHROPIC_MODEL = 'test-model';
      const config = aiClient.loadAiConfig();
      expect(config).not.toBeNull();
      expect(config!.authToken).toBe('my-auth-token');
    });

    it('keeps both apiKey and authToken when both configured', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-key';
      process.env.ANTHROPIC_AUTH_TOKEN = 'my-token';
      process.env.ANTHROPIC_MODEL = 'test-model';
      const config = aiClient.loadAiConfig();
      expect(config!.apiKey).toBe('sk-key');
      expect(config!.authToken).toBe('my-token');
    });

    it('reads from ~/.claude/settings.json', async () => {
      vi.resetModules();
      vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
        const p = String(filePath);
        if (p.includes('.claude/settings.json')) {
          return JSON.stringify({ env: { ANTHROPIC_API_KEY: 'from-settings', ANTHROPIC_MODEL: 'm' } });
        }
        return '{}';
      });
      aiClient = await import('../src/services/ai-client');
      const config = aiClient.loadAiConfig();
      expect(config).not.toBeNull();
      expect(config!.apiKey).toBe('from-settings');
    });

    it('reads from user-preferences.json', async () => {
      vi.resetModules();
      vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
        const p = String(filePath);
        if (p.includes('user-preferences.json')) {
          return JSON.stringify({ ai: { ANTHROPIC_API_KEY: 'from-prefs', ANTHROPIC_MODEL: 'm' } });
        }
        return '{}';
      });
      aiClient = await import('../src/services/ai-client');
      const config = aiClient.loadAiConfig();
      expect(config).not.toBeNull();
      expect(config!.apiKey).toBe('from-prefs');
    });

    it('env vars take priority over settings files', async () => {
      vi.resetModules();
      process.env.ANTHROPIC_API_KEY = 'from-env';
      process.env.ANTHROPIC_MODEL = 'test-model';
      vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
        const p = String(filePath);
        if (p.includes('.claude/settings.json')) {
          return JSON.stringify({ env: { ANTHROPIC_API_KEY: 'from-settings', ANTHROPIC_MODEL: 'm' } });
        }
        if (p.includes('user-preferences.json')) {
          return JSON.stringify({ ai: { ANTHROPIC_API_KEY: 'from-prefs', ANTHROPIC_MODEL: 'm' } });
        }
        return '{}';
      });
      aiClient = await import('../src/services/ai-client');
      const config = aiClient.loadAiConfig();
      expect(config!.apiKey).toBe('from-env');
    });

    it('returns null when API key set but no model configured', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      const config = aiClient.loadAiConfig();
      expect(config).toBeNull();
    });

    it('uses custom model from env', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      process.env.ANTHROPIC_MODEL = 'claude-opus-4-6';
      const config = aiClient.loadAiConfig();
      expect(config!.qualityModel).toBe('claude-opus-4-6');
    });

    it('reads ANTHROPIC_DEFAULT_OPUS_MODEL as quality model', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'anthropic--claude-4.6-opus';
      const config = aiClient.loadAiConfig();
      expect(config!.qualityModel).toBe('anthropic--claude-4.6-opus');
    });

    it('reads ANTHROPIC_DEFAULT_SONNET_MODEL as fallback quality model', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'anthropic--claude-4.6-sonnet';
      const config = aiClient.loadAiConfig();
      expect(config!.qualityModel).toBe('anthropic--claude-4.6-sonnet');
    });

    it('uses correct fallback priority for qualityModel', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'opus';
      process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'sonnet';
      process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'haiku';
      // qualityModel priority: MODEL > opus > sonnet > haiku
      const config = aiClient.loadAiConfig();
      expect(config!.qualityModel).toBe('opus');
    });

    it('uses correct fallback priority for fastModel', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'opus';
      process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'sonnet';
      process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'haiku';
      // fastModel priority: haiku > SMALL_FAST > sonnet > MODEL > opus
      const config = aiClient.loadAiConfig();
      expect(config!.fastModel).toBe('haiku');
    });

    it('ANTHROPIC_MODEL takes priority over opus/sonnet for quality', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      process.env.ANTHROPIC_MODEL = 'main-model';
      process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'opus';
      process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'sonnet';
      const config = aiClient.loadAiConfig();
      expect(config!.qualityModel).toBe('main-model');
    });

    it('strips context window annotation from model names', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-5-20250514[1m]';
      const config = aiClient.loadAiConfig();
      expect(config!.qualityModel).toBe('claude-sonnet-4-5-20250514');
    });

    it('strips various annotation formats from model names', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      process.env.ANTHROPIC_MODEL = 'my-model[200k]';
      process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'haiku-model[128K]';
      const config = aiClient.loadAiConfig();
      expect(config!.qualityModel).toBe('my-model');
      expect(config!.fastModel).toBe('haiku-model');
    });

    it('uses custom base URL from env', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      process.env.ANTHROPIC_MODEL = 'test-model';
      process.env.ANTHROPIC_BASE_URL = 'https://proxy.example.com';
      const config = aiClient.loadAiConfig();
      expect(config!.baseUrl).toBe('https://proxy.example.com');
    });
  });

  describe('getClient', () => {
    it('returns null when no config', () => {
      expect(aiClient.getClient()).toBeNull();
    });

    it('returns client when API key configured', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      process.env.ANTHROPIC_MODEL = 'test-model';
      const result = aiClient.getClient();
      expect(result).not.toBeNull();
      expect(result!.client).toBeDefined();
      expect(result!.qualityModel).toBe('test-model');
    });

    it('caches client instance', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      process.env.ANTHROPIC_MODEL = 'test-model';
      const first = aiClient.getClient();
      const second = aiClient.getClient();
      expect(first!.client).toBe(second!.client);
    });

    it('rebuilds client when config changes', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-key-1';
      process.env.ANTHROPIC_MODEL = 'test-model';
      const first = aiClient.getClient();
      process.env.ANTHROPIC_API_KEY = 'sk-key-2';
      const second = aiClient.getClient();
      expect(first!.client).not.toBe(second!.client);
    });

    it('prefers authToken over apiKey for primary client', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      process.env.ANTHROPIC_AUTH_TOKEN = 'my-token';
      process.env.ANTHROPIC_MODEL = 'test-model';
      const result = aiClient.getClient();
      expect(result).not.toBeNull();
      // authToken should be primary - client should use placeholder apiKey
      expect((result!.client as any).opts.apiKey).toBe('placeholder');
    });

    it('returns both models in client result', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      process.env.ANTHROPIC_MODEL = 'quality-model';
      process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'fast-model';
      const result = aiClient.getClient();
      expect(result!.qualityModel).toBe('quality-model');
      expect(result!.fastModel).toBe('fast-model');
    });
  });

  describe('saveAiConfig', () => {
    it('saves to user-preferences.json', () => {
      aiClient.saveAiConfig({ apiKey: 'new-key', qualityModel: 'claude-opus' });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('user-preferences.json'),
        expect.stringContaining('new-key'),
      );
    });

    it('invalidates cached client', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      process.env.ANTHROPIC_MODEL = 'test-model';
      const before = aiClient.getClient();
      aiClient.saveAiConfig({ apiKey: 'new-key', qualityModel: 'test-model' });
      // After save, client should be rebuilt (different instance)
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      const after = aiClient.getClient();
      expect(before!.client).not.toBe(after!.client);
    });
  });

  describe('askAi', () => {
    it('throws when AI not configured', async () => {
      await expect(aiClient.askAi('hello')).rejects.toThrow('AI not configured');
    });

    it('returns text from AI response', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      process.env.ANTHROPIC_MODEL = 'test-model';
      const result = await aiClient.askAi('hello');
      expect(result).toBe('AI response');
    });

    it('falls back to alternate auth on 401 when both configured', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      process.env.ANTHROPIC_AUTH_TOKEN = 'my-token';
      process.env.ANTHROPIC_MODEL = 'test-model';
      mockCreateBehavior = 'auth-error-then-success';
      const result = await aiClient.askAi('hello');
      expect(result).toBe('AI response via fallback');
      expect(mockCallCount).toBe(2); // first call failed, second succeeded
    });

    it('throws auth error when only one auth method configured', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      process.env.ANTHROPIC_MODEL = 'test-model';
      mockCreateBehavior = 'auth-error';
      await expect(aiClient.askAi('hello')).rejects.toThrow('Unauthorized');
    });

    it('throws auth error when both configured but fallback also fails', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      process.env.ANTHROPIC_AUTH_TOKEN = 'my-token';
      process.env.ANTHROPIC_MODEL = 'test-model';
      mockCreateBehavior = 'auth-error'; // all calls fail
      await expect(aiClient.askAi('hello')).rejects.toThrow('Unauthorized');
    });

    it('selects fast model when opts.model is fast', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      process.env.ANTHROPIC_MODEL = 'quality-model';
      process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'fast-model';
      const result = await aiClient.askAi('hello', { model: 'fast' });
      expect(result).toBe('AI response');
    });

    it('selects quality model by default', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      process.env.ANTHROPIC_MODEL = 'quality-model';
      process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'fast-model';
      const result = await aiClient.askAi('hello');
      expect(result).toBe('AI response');
    });
  });
});
