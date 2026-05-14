import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface AiConfig {
  baseUrl: string;
  apiKey?: string;
  authToken?: string;
  qualityModel: string;
  fastModel: string;
}

const PREFS_FILE = path.join(__dirname, '..', '..', 'user-preferences.json');
const CLAUDE_SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');

let cachedClient: Anthropic | null = null;
let cachedConfig: AiConfig | null = null;
let cachedConfigJson: string | null = null;

function readJson(filePath: string): Record<string, any> | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    // Strip single-line comments (// ...) to support JSONC files like ~/.claude/settings.json
    const stripped = raw.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(stripped);
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

  // Merge sources in priority order (later source overrides earlier)
  // Priority: user-preferences (lowest) < ~/.claude/settings.json < env vars (highest)
  const sources = [
    prefs?.ai || {},
    claudeSettings?.env || {},
    {
      ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL,
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
      ANTHROPIC_AUTH_TOKEN: env.ANTHROPIC_AUTH_TOKEN,
      ANTHROPIC_MODEL: env.ANTHROPIC_MODEL,
      ANTHROPIC_SMALL_FAST_MODEL: env.ANTHROPIC_SMALL_FAST_MODEL,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
      ANTHROPIC_DEFAULT_OPUS_MODEL: env.ANTHROPIC_DEFAULT_OPUS_MODEL,
      ANTHROPIC_DEFAULT_SONNET_MODEL: env.ANTHROPIC_DEFAULT_SONNET_MODEL,
    },
  ];

  let baseUrl = '';
  let apiKey = '';
  let authToken = '';
  let model = '';
  let smallModel = '';
  let haikuModel = '';
  let opusModel = '';
  let sonnetModel = '';

  for (const src of sources) {
    if (src.ANTHROPIC_BASE_URL) baseUrl = src.ANTHROPIC_BASE_URL;
    if (src.ANTHROPIC_API_KEY) apiKey = src.ANTHROPIC_API_KEY;
    if (src.ANTHROPIC_AUTH_TOKEN) authToken = src.ANTHROPIC_AUTH_TOKEN;
    if (src.ANTHROPIC_MODEL) model = src.ANTHROPIC_MODEL;
    if (src.ANTHROPIC_SMALL_FAST_MODEL) smallModel = src.ANTHROPIC_SMALL_FAST_MODEL;
    if (src.ANTHROPIC_DEFAULT_HAIKU_MODEL) haikuModel = src.ANTHROPIC_DEFAULT_HAIKU_MODEL;
    if (src.ANTHROPIC_DEFAULT_OPUS_MODEL) opusModel = src.ANTHROPIC_DEFAULT_OPUS_MODEL;
    if (src.ANTHROPIC_DEFAULT_SONNET_MODEL) sonnetModel = src.ANTHROPIC_DEFAULT_SONNET_MODEL;
  }

  // Must have at least one auth method
  if (!apiKey && !authToken) return null;

  // Strip context window annotations like [1m], [200k] from model names
  const stripModelAnnotation = (m: string) => m.replace(/\[[\d]+[kmKM]?\]$/i, '').trim();
  if (model) model = stripModelAnnotation(model);
  if (smallModel) smallModel = stripModelAnnotation(smallModel);
  if (haikuModel) haikuModel = stripModelAnnotation(haikuModel);
  if (opusModel) opusModel = stripModelAnnotation(opusModel);
  if (sonnetModel) sonnetModel = stripModelAnnotation(sonnetModel);

  // qualityModel: best model for single operations (rename, summary, deep search)
  //   Priority: ANTHROPIC_MODEL > opus > sonnet > haiku
  // fastModel: cheaper model for batch operations (batch scan, batch rename)
  //   Priority: haiku > SMALL_FAST(deprecated) > sonnet > MODEL > opus
  const qualityModel = model || opusModel || sonnetModel || smallModel || haikuModel;
  const fastModel = haikuModel || smallModel || sonnetModel || model || opusModel;

  if (!qualityModel) return null; // no model configured at all

  return {
    baseUrl: baseUrl || 'https://api.anthropic.com',
    apiKey: apiKey || undefined,
    authToken: authToken || undefined,
    qualityModel,
    fastModel,
  };
}

/**
 * Save AI config to user-preferences.json
 */
export function saveAiConfig(config: {
  baseUrl?: string;
  apiKey?: string;
  authToken?: string;
  qualityModel?: string;
  fastModel?: string;
}): void {
  const prefs = readJson(PREFS_FILE) || {};
  prefs.ai = {
    ANTHROPIC_BASE_URL: config.baseUrl || '',
    ANTHROPIC_API_KEY: config.apiKey || '',
    ANTHROPIC_AUTH_TOKEN: config.authToken || '',
    ANTHROPIC_MODEL: config.qualityModel || '',
    ANTHROPIC_SMALL_FAST_MODEL: config.fastModel || '',
  };
  fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2));
  // Invalidate cache
  cachedClient = null;
  cachedConfig = null;
  cachedConfigJson = null;
}

/**
 * Build Anthropic client with specific auth method
 */
function buildClient(config: AiConfig, authMethod: 'apiKey' | 'authToken'): Anthropic {
  const opts: any = {};
  if (config.baseUrl) opts.baseURL = config.baseUrl;

  if (authMethod === 'authToken' && config.authToken) {
    opts.apiKey = 'placeholder';
    opts.defaultHeaders = { 'x-auth-token': config.authToken };
  } else if (config.apiKey) {
    opts.apiKey = config.apiKey;
  }
  return new Anthropic(opts);
}

/**
 * Get Anthropic client instance (cached, rebuilds on config change)
 * Prefers authToken over apiKey when both are available.
 */
export function getClient(): { client: Anthropic; qualityModel: string; fastModel: string } | null {
  const config = loadAiConfig();
  if (!config) return null;

  const configJson = JSON.stringify(config);
  if (cachedClient && cachedConfig && cachedConfigJson === configJson) {
    return { client: cachedClient, qualityModel: cachedConfig.qualityModel, fastModel: cachedConfig.fastModel };
  }

  const primaryAuth = config.authToken ? 'authToken' : 'apiKey';
  cachedClient = buildClient(config, primaryAuth);
  cachedConfig = config;
  cachedConfigJson = configJson;
  return { client: cachedClient, qualityModel: config.qualityModel, fastModel: config.fastModel };
}

/**
 * Check if error is an authentication failure (401/403)
 */
function isAuthError(err: any): boolean {
  const status = err.status || err.statusCode;
  if (status === 401 || status === 403) return true;
  const msg = String(err.message || '').toLowerCase();
  return msg.includes('authentication') || msg.includes('unauthorized') || msg.includes('forbidden');
}

/**
 * Send a prompt, get text back.
 * - model: 'quality' (default) for single operations, 'fast' for batch processing
 * - Includes a 30s timeout to prevent hanging.
 * - If both apiKey and authToken are configured, retries with the alternate auth on 401/403.
 */
export async function askAi(prompt: string, opts?: { maxTokens?: number; timeoutMs?: number; model?: 'quality' | 'fast' }): Promise<string> {
  const config = loadAiConfig();
  if (!config) throw new Error('AI not configured');

  const c = getClient();
  if (!c) throw new Error('AI not configured');

  const selectedModel = opts?.model === 'fast' ? c.fastModel : c.qualityModel;
  const timeoutMs = opts?.timeoutMs || 30000;

  const callWithClient = async (client: Anthropic): Promise<string> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await client.messages.create(
        {
          model: selectedModel,
          max_tokens: opts?.maxTokens || 1024,
          messages: [{ role: 'user', content: prompt }],
        },
        { signal: controller.signal as any },
      );
      const textBlock = response.content.find((b) => b.type === 'text');
      return textBlock ? textBlock.text : '';
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    return await callWithClient(c.client);
  } catch (err: any) {
    // If auth error and alternate auth method is available, retry with it
    const hasBoth = !!(config.apiKey && config.authToken);
    if (hasBoth && isAuthError(err)) {
      const primaryAuth = config.authToken ? 'authToken' : 'apiKey';
      const fallbackAuth = primaryAuth === 'authToken' ? 'apiKey' : 'authToken';
      const fallbackClient = buildClient(config, fallbackAuth);
      // Update cache to use the working auth for future calls
      cachedClient = fallbackClient;
      return await callWithClient(fallbackClient);
    }
    throw err;
  }
}
