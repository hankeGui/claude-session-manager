import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import projectsRouter from '../src/routes/projects';
import sessionsRouter from '../src/routes/sessions';
import searchRouter from '../src/routes/search';
import * as scanner from '../src/services/scanner';
import * as aiScanner from '../src/services/ai-scanner';

const app = express();
app.use(express.json());
app.use('/api/projects', projectsRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/search', searchRouter);

// AI scan control endpoints (mirrors server.ts)
app.get('/api/ai-scan/status', (_req, res) => {
  res.json(aiScanner.getStatus());
});
app.post('/api/ai-scan/pause', (_req, res) => {
  aiScanner.pause();
  res.json({ success: true });
});
app.post('/api/ai-scan/resume', (_req, res) => {
  aiScanner.resume();
  res.json({ success: true });
});
app.post('/api/ai-scan/stop', (_req, res) => {
  aiScanner.stop();
  res.json({ success: true });
});
app.post('/api/ai-scan/start', (_req, res) => {
  aiScanner.start();
  res.json({ success: true });
});
app.post('/api/rescan', async (_req, res) => {
  await scanner.scan();
  const data = scanner.getData();
  const pending = aiScanner.getQueueSize();
  res.json({
    success: true,
    projects: data.projects.length,
    sessions: data.projects.reduce((sum, p) => sum + p.sessions.length, 0),
    pending,
  });
});

app.get('/api/stats', (_req, res) => {
  const data = scanner.getData();
  const allSessions = data.projects.flatMap(p => p.sessions);
  const emptySessions = allSessions.filter(s => s.isEmpty);
  res.json({
    totalProjects: data.projects.length,
    totalSessions: allSessions.length,
    emptySessions: emptySessions.length,
  });
});

describe('API endpoints', () => {
  beforeAll(async () => {
    await scanner.scan();
  });

  describe('GET /api/stats', () => {
    it('returns stats object', async () => {
      const res = await request(app).get('/api/stats');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('totalProjects');
      expect(res.body).toHaveProperty('totalSessions');
      expect(res.body).toHaveProperty('emptySessions');
      expect(typeof res.body.totalProjects).toBe('number');
    });
  });

  describe('GET /api/projects', () => {
    it('returns projects array', async () => {
      const res = await request(app).get('/api/projects');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('projects');
      expect(Array.isArray(res.body.projects)).toBe(true);
    });

    it('each project has required fields', async () => {
      const res = await request(app).get('/api/projects');
      if (res.body.projects.length > 0) {
        const p = res.body.projects[0];
        expect(p).toHaveProperty('dirName');
        expect(p).toHaveProperty('displayName');
        expect(p).toHaveProperty('sessionCount');
      }
    });
  });

  describe('GET /api/projects/:dirName/sessions', () => {
    it('returns 404 for unknown project', async () => {
      const res = await request(app).get('/api/projects/nonexistent-project/sessions');
      expect(res.status).toBe(404);
    });

    it('returns sessions for valid project', async () => {
      const data = scanner.getData();
      if (data.projects.length > 0) {
        const dirName = data.projects[0].dirName;
        const res = await request(app).get(`/api/projects/${encodeURIComponent(dirName)}/sessions`);
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('sessions');
        expect(Array.isArray(res.body.sessions)).toBe(true);
      }
    });

    it('supports sort parameter', async () => {
      const data = scanner.getData();
      if (data.projects.length > 0) {
        const dirName = data.projects[0].dirName;
        const res = await request(app).get(`/api/projects/${encodeURIComponent(dirName)}/sessions?sort=created&order=asc`);
        expect(res.status).toBe(200);
      }
    });
  });

  describe('GET /api/sessions/:sessionId/messages', () => {
    it('returns 404 for unknown session', async () => {
      const res = await request(app).get('/api/sessions/nonexistent-id/messages');
      expect(res.status).toBe(404);
    });

    it('returns messages for valid session', async () => {
      const data = scanner.getData();
      const firstSession = data.projects[0]?.sessions[0];
      if (firstSession) {
        const res = await request(app).get(`/api/sessions/${firstSession.sessionId}/messages?limit=5`);
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('messages');
        expect(Array.isArray(res.body.messages)).toBe(true);
        expect(res.body).toHaveProperty('session');
        expect(res.body).toHaveProperty('project');
      }
    });
  });

  describe('GET /api/search', () => {
    it('returns results for empty query (all sessions)', async () => {
      const res = await request(app).get('/api/search?q=');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('results');
      expect(res.body).toHaveProperty('total');
      expect(typeof res.body.total).toBe('number');
    });

    it('filters by empty=true', async () => {
      const res = await request(app).get('/api/search?q=&empty=true');
      expect(res.status).toBe(200);
      for (const s of res.body.results) {
        expect(s.isEmpty).toBe(true);
      }
    });

    it('filters by empty=false', async () => {
      const res = await request(app).get('/api/search?q=&empty=false');
      expect(res.status).toBe(200);
      for (const s of res.body.results) {
        expect(s.isEmpty).toBe(false);
      }
    });

    it('searches by query string', async () => {
      const res = await request(app).get('/api/search?q=test');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('results');
    });

    it('filters by favorite=true', async () => {
      const res = await request(app).get('/api/search?q=&favorite=true');
      expect(res.status).toBe(200);
      for (const s of res.body.results) {
        expect(s.isFavorite).toBe(true);
      }
    });

    it('supports regex mode', async () => {
      const res = await request(app).get('/api/search?q=test&mode=regex');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('results');
    });

    it('filters by project', async () => {
      const data = scanner.getData();
      if (data.projects.length > 0) {
        const dirName = data.projects[0].dirName;
        const res = await request(app).get(`/api/search?q=&project=${encodeURIComponent(dirName)}`);
        expect(res.status).toBe(200);
        for (const s of res.body.results) {
          expect(s.projectDisplayName).toBe(data.projects[0].displayName);
        }
      }
    });
  });

  describe('PUT /api/sessions/:sessionId/title', () => {
    it('returns 404 for unknown session', async () => {
      const res = await request(app)
        .put('/api/sessions/nonexistent-id/title')
        .send({ title: 'test' });
      expect(res.status).toBe(404);
    });

    it('sets title for valid session', async () => {
      const data = scanner.getData();
      const session = data.projects.flatMap(p => p.sessions).find(s => !s.isEmpty);
      if (session) {
        const res = await request(app)
          .put(`/api/sessions/${session.sessionId}/title`)
          .send({ title: 'Test Title' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.title).toBe('Test Title');

        // Clean up
        await request(app)
          .put(`/api/sessions/${session.sessionId}/title`)
          .send({ title: '' });
      }
    });
  });

  describe('POST /api/sessions/batch-delete', () => {
    it('returns 400 for missing sessionIds', async () => {
      const res = await request(app)
        .post('/api/sessions/batch-delete')
        .send({});
      expect(res.status).toBe(400);
    });

    it('returns 400 for empty array', async () => {
      const res = await request(app)
        .post('/api/sessions/batch-delete')
        .send({ sessionIds: [] });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/search/deep', () => {
    it('returns 400 for missing query', async () => {
      const res = await request(app)
        .post('/api/search/deep')
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe('Session fields include emptyReason', () => {
    it('empty sessions have emptyReason set', async () => {
      const res = await request(app).get('/api/search?q=&empty=true');
      if (res.body.results.length > 0) {
        const s = res.body.results[0];
        expect(s).toHaveProperty('emptyReason');
        expect(typeof s.emptyReason).toBe('string');
        expect(s.emptyReason.length).toBeGreaterThan(0);
      }
    });

    it('non-empty sessions have emptyReason null', async () => {
      const res = await request(app).get('/api/search?q=&empty=false');
      if (res.body.results.length > 0) {
        const s = res.body.results[0];
        expect(s.emptyReason).toBeNull();
      }
    });
  });

  describe('PUT /api/sessions/:sessionId/favorite', () => {
    it('returns 404 for unknown session', async () => {
      const res = await request(app)
        .put('/api/sessions/nonexistent-id/favorite')
        .send({ isFavorite: true });
      expect(res.status).toBe(404);
    });

    it('sets favorite for valid session', async () => {
      const data = scanner.getData();
      const session = data.projects.flatMap(p => p.sessions).find(s => !s.isEmpty);
      if (session) {
        const res = await request(app)
          .put(`/api/sessions/${session.sessionId}/favorite`)
          .send({ isFavorite: true });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.isFavorite).toBe(true);

        // Verify it shows up in favorites filter
        const searchRes = await request(app).get('/api/search?q=&favorite=true');
        const found = searchRes.body.results.some((s: any) => s.sessionId === session.sessionId);
        expect(found).toBe(true);

        // Clean up
        await request(app)
          .put(`/api/sessions/${session.sessionId}/favorite`)
          .send({ isFavorite: false });
      }
    });

    it('removes favorite', async () => {
      const data = scanner.getData();
      const session = data.projects.flatMap(p => p.sessions).find(s => !s.isEmpty);
      if (session) {
        // Set then unset
        await request(app)
          .put(`/api/sessions/${session.sessionId}/favorite`)
          .send({ isFavorite: true });
        const res = await request(app)
          .put(`/api/sessions/${session.sessionId}/favorite`)
          .send({ isFavorite: false });
        expect(res.status).toBe(200);
        expect(res.body.isFavorite).toBe(false);
      }
    });
  });

  describe('Session fields include isFavorite', () => {
    it('sessions have isFavorite field', async () => {
      const res = await request(app).get('/api/search?q=&empty=false');
      if (res.body.results.length > 0) {
        const s = res.body.results[0];
        expect(s).toHaveProperty('isFavorite');
        expect(typeof s.isFavorite).toBe('boolean');
      }
    });
  });

  describe('GET /api/sessions/:sessionId/messages — noise filtering', () => {
    it('returns totalUnfiltered field', async () => {
      const data = scanner.getData();
      const session = data.projects.flatMap(p => p.sessions).find(s => !s.isEmpty);
      if (session) {
        const res = await request(app).get(`/api/sessions/${session.sessionId}/messages?limit=5`);
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('totalUnfiltered');
        expect(typeof res.body.totalUnfiltered).toBe('number');
      }
    });

    it('noise=1 includes all messages', async () => {
      const data = scanner.getData();
      const session = data.projects.flatMap(p => p.sessions).find(s => !s.isEmpty);
      if (session) {
        const normal = await request(app).get(`/api/sessions/${session.sessionId}/messages?limit=100`);
        const withNoise = await request(app).get(`/api/sessions/${session.sessionId}/messages?limit=100&noise=1`);
        expect(withNoise.status).toBe(200);
        expect(withNoise.body.messages.length).toBeGreaterThanOrEqual(normal.body.messages.length);
      }
    });
  });

  describe('POST /api/sessions/:sessionId/resume', () => {
    it('returns 404 for unknown session', async () => {
      const res = await request(app)
        .post('/api/sessions/nonexistent-id/resume')
        .send({ terminal: 'auto' });
      expect(res.status).toBe(404);
    });

    it('returns 400 when tmux is requested but not installed', async () => {
      const data = scanner.getData();
      const session = data.projects.flatMap(p => p.sessions).find(s => !s.isEmpty);
      if (session) {
        // This test verifies the endpoint handles tmux mode — actual behavior depends on tmux availability
        const res = await request(app)
          .post(`/api/sessions/${session.sessionId}/resume`)
          .send({ terminal: 'tmux' });
        // Either 400 (tmux not installed) or 200 (tmux available)
        expect([200, 400]).toContain(res.status);
        if (res.status === 400) {
          expect(res.body.error).toBe('tmux is not installed');
        } else {
          expect(res.body.tmuxSession).toBeDefined();
        }
      }
    });
  });

  describe('POST /api/sessions/batch-rename', () => {
    it('returns 400 for missing sessionIds', async () => {
      const res = await request(app)
        .post('/api/sessions/batch-rename')
        .send({});
      expect(res.status).toBe(400);
    });

    it('returns 400 for empty array', async () => {
      const res = await request(app)
        .post('/api/sessions/batch-rename')
        .send({ sessionIds: [] });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/search — weighted scoring', () => {
    it('results include _searchScore and _matchedFields', async () => {
      const res = await request(app).get('/api/search?q=test');
      expect(res.status).toBe(200);
      if (res.body.results.length > 0) {
        const s = res.body.results[0];
        expect(s).toHaveProperty('_searchScore');
        expect(s).toHaveProperty('_matchedFields');
        expect(typeof s._searchScore).toBe('number');
        expect(Array.isArray(s._matchedFields)).toBe(true);
      }
    });

    it('results are sorted by score descending', async () => {
      const res = await request(app).get('/api/search?q=fix');
      expect(res.status).toBe(200);
      const scores = res.body.results.map((s: any) => s._searchScore);
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
      }
    });
  });

  describe('GET /api/sessions/preferences', () => {
    it('returns terminal preference and tmux availability', async () => {
      const res = await request(app).get('/api/sessions/preferences');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('tmuxAvailable');
      expect(typeof res.body.tmuxAvailable).toBe('boolean');
    });
  });

  describe('GET /api/ai-scan/status', () => {
    it('returns status with all expected fields', async () => {
      const res = await request(app).get('/api/ai-scan/status');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('running');
      expect(res.body).toHaveProperty('paused');
      expect(res.body).toHaveProperty('cancelled');
      expect(res.body).toHaveProperty('phase');
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('done');
      expect(res.body).toHaveProperty('cached');
      expect(typeof res.body.running).toBe('boolean');
      expect(typeof res.body.paused).toBe('boolean');
      expect(typeof res.body.cancelled).toBe('boolean');
      expect(['idle', 'summary', 'rename']).toContain(res.body.phase);
    });
  });

  describe('POST /api/ai-scan/pause', () => {
    it('returns success and sets paused state', async () => {
      const res = await request(app).post('/api/ai-scan/pause');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const statusRes = await request(app).get('/api/ai-scan/status');
      expect(statusRes.body.paused).toBe(true);

      // Clean up
      await request(app).post('/api/ai-scan/resume');
    });
  });

  describe('POST /api/ai-scan/resume', () => {
    it('returns success and clears paused state', async () => {
      // Pause first
      await request(app).post('/api/ai-scan/pause');

      const res = await request(app).post('/api/ai-scan/resume');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const statusRes = await request(app).get('/api/ai-scan/status');
      expect(statusRes.body.paused).toBe(false);
    });
  });

  describe('POST /api/ai-scan/stop', () => {
    it('returns success and sets cancelled state', async () => {
      const res = await request(app).post('/api/ai-scan/stop');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const statusRes = await request(app).get('/api/ai-scan/status');
      expect(statusRes.body.cancelled).toBe(true);
      expect(statusRes.body.paused).toBe(false); // stop clears paused
      expect(statusRes.body.running).toBe(false);
    });
  });

  describe('POST /api/ai-scan/start', () => {
    it('returns success', async () => {
      const res = await request(app).post('/api/ai-scan/start');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('POST /api/rescan', () => {
    it('returns success with projects, sessions, and pending counts', async () => {
      const res = await request(app).post('/api/rescan');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.projects).toBe('number');
      expect(typeof res.body.sessions).toBe('number');
      expect(res.body).toHaveProperty('pending');
      expect(typeof res.body.pending.summaries).toBe('number');
      expect(typeof res.body.pending.titles).toBe('number');
    });

    it('does NOT start AI scanner (returns pending only)', async () => {
      // Stop any running scan first
      await request(app).post('/api/ai-scan/stop');

      await request(app).post('/api/rescan');

      // After rescan, scanner should NOT be running (rescan only returns counts)
      const statusRes = await request(app).get('/api/ai-scan/status');
      expect(statusRes.body.running).toBe(false);
    });
  });
});
