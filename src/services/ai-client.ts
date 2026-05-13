import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface AiConfig {
  baseUrl: string;
  apiKey?: string;
  authToken?: string;
  model: string;
  smallModel: string;
}

const PREFS_FILE = path.join(__dirname, '..', '..', 'user-preferences.json');
const CLAUDE_SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');

let cachedClient: Anthropic | null = null;
let cachedModel: string | null = null;
let cachedConfigJson: string | null = null;

function readJson(filePath: string): Record<string, any> | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Load AI config with priority: env vars > ~/.claude/settings.json > user-preferences.json
 */
export function loadAiConfig(): AiConfig | null {
  const env = process.env;
  const claudeSettings = readJson(CLAUDE_SETTINGS);
  const prefs = readJson(PREFS_FILE);

  // Merge sources in priority order (env overrides everything)
  const sources = [
    prefs?.ai || {},
    claudeSettings?.env || {},
    {
      ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL,
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
      ANTHROPIC_AUTH_TOKEN: env.ANTHROPIC_AUTH_TOKEN,
      ANTHROPIC_MODEL: env.ANTHROPIC_MODEL,
      ANTHROPIC_SMALL_FAST_MODEL: env.ANTHROPIC_SMALL_FAST_MODEL,
    },
  ];

  let baseUrl = '';
  let apiKey = '';
  let authToken = '';
  let model = '';
  let smallModel = '';

  for (const src of sources) {
    if (src.ANTHROPIC_BASE_URL) baseUrl = src.ANTHROPIC_BASE_URL;
    if (src.ANTHROPIC_API_KEY) apiKey = src.ANTHROPIC_API_KEY;
    if (src.ANTHROPIC_AUTH_TOKEN) authToken = src.ANTHROPIC_AUTH_TOKEN;
    if (src.ANTHROPIC_MODEL) model = src.ANTHROPIC_MODEL;
    if (src.ANTHROPIC_SMALL_FAST_MODEL) smallModel = src.ANTHROPIC_SMALL_FAST_MODEL;
  }

  // Must have at least one auth method
  if (!apiKey && !authToken) return null;

  return {
    baseUrl: baseUrl || 'https://api.anthropic.com',
    apiKey: apiKey || undefined,
    authToken: authToken || undefined,
    model: model || 'claude-sonnet-4-5-20250514',
    smallModel: smallModel || model || 'claude-sonnet-4-5-20250514',
  };
}

/**
 * Save AI config to user-preferences.json
 */
export function saveAiConfig(config: {
  baseUrl?: string;
  apiKey?: string;
  authToken?: string;
  model?: string;
  smallModel?: string;
}): void {
  const prefs = readJson(PREFS_FILE) || {};
  prefs.ai = {
    ANTHROPIC_BASE_URL: config.baseUrl || '',
    ANTHROPIC_API_KEY: config.apiKey || '',
    ANTHROPIC_AUTH_TOKEN: config.authToken || '',
    ANTHROPIC_MODEL: config.model || '',
    ANTHROPIC_SMALL_FAST_MODEL: config.smallModel || '',
  };
  fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2));
  // Invalidate cache
  cachedClient = null;
  cachedModel = null;
  cachedConfigJson = null;
}

/**
 * Get Anthropic client instance (cached, rebuilds on config change)
 */
export function getClient(): { client: Anthropic; model: string } | null {
  const config = loadAiConfig();
  if (!config) return null;

  const configJson = JSON.stringify(config);
  if (cachedClient && cachedModel && cachedConfigJson === configJson) {
    return { client: cachedClient, model: cachedModel };
  }

  const opts: any = {};
  if (config.baseUrl) opts.baseURL = config.baseUrl;

  if (config.apiKey) {
    opts.apiKey = config.apiKey;
  } else if (config.authToken) {
    // Auth token mode: use placeholder key + custom header
    opts.apiKey = 'placeholder';
    opts.defaultHeaders = { 'x-auth-token': config.authToken };
  }

  cachedClient = new Anthropic(opts);
  cachedModel = config.smallModel;
  cachedConfigJson = configJson;
  return { client: cachedClient, model: cachedModel };
}

/**
 * Simple helper: send a prompt, get text back. Uses smallModel.
 * Includes a 30s timeout to prevent hanging.
 */
export async function askAi(prompt: string, opts?: { maxTokens?: number; timeoutMs?: number }): Promise<string> {
  const c = getClient();
  if (!c) throw new Error('AI not configured');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts?.timeoutMs || 30000);

  try {
    const response = await c.client.messages.create(
      {
        model: c.model,
        max_tokens: opts?.maxTokens || 1024,
        messages: [{ role: 'user', content: prompt }],
      },
      { signal: controller.signal as any },
    );

    const textBlock = response.content.find((b) => b.type === 'text');
    return textBlock ? textBlock.text : '';
  } finally {
    clearTimeout(timeout);
  }
}
