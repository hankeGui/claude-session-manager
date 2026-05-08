import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import projectsRouter from '../src/routes/projects';
import sessionsRouter from '../src/routes/sessions';
import searchRouter from '../src/routes/search';
import * as scanner from '../src/services/scanner';

const app = express();
app.use(express.json());
app.use('/api/projects', projectsRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/search', searchRouter);
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
});
