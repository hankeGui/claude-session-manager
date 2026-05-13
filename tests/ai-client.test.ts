import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';

vi.mock('fs');
vi.mock('os', async () => {
  const actual = await vi.importActual('os');
  return { ...actual, homedir: () => '/mock-home' };
});
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    constructor(public opts: any) {}
    messages = {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'AI response' }],
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
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.ANTHROPIC_SMALL_FAST_MODEL;
    aiClient = await import('../src/services/ai-client');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadAiConfig', () => {
    it('returns null when no auth method configured', () => {
      expect(aiClient.loadAiConfig()).toBeNull();
    });

    it('returns config when API key is in env', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test-key';
      const config = aiClient.loadAiConfig();
      expect(config).not.toBeNull();
      expect(config!.apiKey).toBe('sk-test-key');
      expect(config!.baseUrl).toBe('https://api.anthropic.com');
    });

    it('returns config when auth token is in env', () => {
      process.env.ANTHROPIC_AUTH_TOKEN = 'my-auth-token';
      const config = aiClient.loadAiConfig();
      expect(config).not.toBeNull();
      expect(config!.authToken).toBe('my-auth-token');
    });

    it('reads from ~/.claude/settings.json', async () => {
      vi.resetModules();
      vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
        const p = String(filePath);
        if (p.includes('.claude/settings.json')) {
          return JSON.stringify({ env: { ANTHROPIC_API_KEY: 'from-settings' } });
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
          return JSON.stringify({ ai: { ANTHROPIC_API_KEY: 'from-prefs' } });
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
      vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
        const p = String(filePath);
        if (p.includes('.claude/settings.json')) {
          return JSON.stringify({ env: { ANTHROPIC_API_KEY: 'from-settings' } });
        }
        if (p.includes('user-preferences.json')) {
          return JSON.stringify({ ai: { ANTHROPIC_API_KEY: 'from-prefs' } });
        }
        return '{}';
      });
      aiClient = await import('../src/services/ai-client');
      const config = aiClient.loadAiConfig();
      expect(config!.apiKey).toBe('from-env');
    });

    it('uses default model when not specified', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      const config = aiClient.loadAiConfig();
      expect(config!.model).toBe('claude-sonnet-4-5-20250514');
    });

    it('uses custom model from env', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      process.env.ANTHROPIC_MODEL = 'claude-opus-4-6';
      const config = aiClient.loadAiConfig();
      expect(config!.model).toBe('claude-opus-4-6');
    });

    it('uses custom base URL from env', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
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
      const result = aiClient.getClient();
      expect(result).not.toBeNull();
      expect(result!.client).toBeDefined();
      expect(result!.model).toBeDefined();
    });

    it('caches client instance', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      const first = aiClient.getClient();
      const second = aiClient.getClient();
      expect(first!.client).toBe(second!.client);
    });

    it('rebuilds client when config changes', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-key-1';
      const first = aiClient.getClient();
      process.env.ANTHROPIC_API_KEY = 'sk-key-2';
      const second = aiClient.getClient();
      expect(first!.client).not.toBe(second!.client);
    });
  });

  describe('saveAiConfig', () => {
    it('saves to user-preferences.json', () => {
      aiClient.saveAiConfig({ apiKey: 'new-key', model: 'claude-opus' });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('user-preferences.json'),
        expect.stringContaining('new-key'),
      );
    });

    it('invalidates cached client', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      const before = aiClient.getClient();
      aiClient.saveAiConfig({ apiKey: 'new-key' });
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
      const result = await aiClient.askAi('hello');
      expect(result).toBe('AI response');
    });
  });
});
