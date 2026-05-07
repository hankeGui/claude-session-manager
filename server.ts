import express from 'express';
import path from 'path';
import fs from 'fs';
import projectsRouter from './src/routes/projects';
import sessionsRouter from './src/routes/sessions';
import searchRouter from './src/routes/search';
import * as scanner from './src/services/scanner';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const clientDist = path.join(__dirname, 'client', 'dist');
const publicDir = path.join(__dirname, 'public');
const staticDir = fs.existsSync(clientDist) ? clientDist : publicDir;
app.use(express.static(staticDir));

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
    oldestSession: allSessions.length ? allSessions.reduce((a, b) => a.created < b.created ? a : b).created : null,
    newestSession: allSessions.length ? allSessions.reduce((a, b) => a.modified > b.modified ? a : b).modified : null,
  });
});

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

async function start() {
  console.log('Scanning sessions...');
  await scanner.scan();
  const data = scanner.getData();
  console.log(`Found ${data.projects.length} projects with ${data.projects.reduce((sum, p) => sum + p.sessions.length, 0)} sessions`);

  app.listen(PORT, () => {
    console.log(`Claude Session Manager running at http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
