import { Router, Request, Response } from 'express';
import { loadAiConfig, saveAiConfig, askAi } from '../services/ai-client';

const router = Router();

// GET /api/settings/ai - return current config (masked)
router.get('/ai', (_req: Request, res: Response) => {
  const config = loadAiConfig();
  if (!config) {
    return res.json({ isConfigured: false });
  }

  res.json({
    isConfigured: true,
    baseUrl: config.baseUrl,
    hasApiKey: !!config.apiKey,
    hasAuthToken: !!config.authToken,
    model: config.model,
    smallModel: config.smallModel,
  });
});

// PUT /api/settings/ai - save config and verify connection
router.put('/ai', async (req: Request, res: Response) => {
  const { baseUrl, apiKey, authToken, model, smallModel } = req.body;

  if (!apiKey && !authToken) {
    return res.status(400).json({ error: 'Either apiKey or authToken is required' });
  }

  saveAiConfig({ baseUrl, apiKey, authToken, model, smallModel });

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
