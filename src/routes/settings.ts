import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { loadAiConfig, saveAiConfig, askAi } from '../services/ai-client';
import { validate } from '../middleware/validate';

const router = Router();

const aiSettingsSchema = z.object({
  baseUrl: z.string().optional().default(''),
  apiKey: z.string().optional().default(''),
  authToken: z.string().optional().default(''),
  qualityModel: z.string().optional().default(''),
  fastModel: z.string().optional().default(''),
});

function maskSecret(value: string | undefined): string {
  if (!value) return '';
  if (value.length <= 8) return '*'.repeat(value.length);
  return value.slice(0, 4) + '*'.repeat(Math.min(value.length - 8, 20)) + value.slice(-4);
}

// GET /api/settings/ai - return current config (masked)
router.get('/ai', (_req: Request, res: Response) => {
  const config = loadAiConfig();
  if (!config) {
    return res.json({ isConfigured: false });
  }

  res.json({
    isConfigured: true,
    baseUrl: config.baseUrl,
    apiKey: maskSecret(config.apiKey),
    authToken: maskSecret(config.authToken),
    qualityModel: config.qualityModel,
    fastModel: config.fastModel,
  });
});

// GET /api/settings/ai/verify - test actual connection
router.get('/ai/verify', async (_req: Request, res: Response) => {
  const config = loadAiConfig();
  if (!config) {
    return res.json({ ok: false, error: 'Not configured' });
  }
  try {
    const reply = await askAi('Say "ok"', { maxTokens: 16, timeoutMs: 10000 });
    res.json({ ok: !!reply });
  } catch (err: any) {
    res.json({ ok: false, error: err.message });
  }
});

// PUT /api/settings/ai - save config and verify connection
router.put('/ai', validate(aiSettingsSchema), async (req: Request, res: Response) => {
  const { baseUrl, apiKey, authToken, qualityModel, fastModel } = req.body;

  // Merge with existing config: empty fields preserve current values
  const existing = loadAiConfig();
  const merged = {
    baseUrl: baseUrl || existing?.baseUrl || '',
    apiKey: apiKey || existing?.apiKey || '',
    authToken: authToken || existing?.authToken || '',
    qualityModel: qualityModel || existing?.qualityModel || '',
    fastModel: fastModel || existing?.fastModel || '',
  };

  if (!merged.apiKey && !merged.authToken) {
    return res.status(400).json({ error: 'Either apiKey or authToken is required' });
  }

  saveAiConfig(merged);

  // Verify connection
  try {
    const reply = await askAi('Say "ok"', { maxTokens: 16 });
    if (!reply) {
      return res.status(500).json({ error: 'AI returned empty response', saved: true });
    }
    res.json({ success: true, verified: true });
  } catch (err: any) {
    res.json({ success: true, verified: false, error: err.message });
  }
});

export default router;
