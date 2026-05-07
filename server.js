const express = require('express');
const path = require('path');
const projectsRouter = require('./src/routes/projects');
const sessionsRouter = require('./src/routes/sessions');
const searchRouter = require('./src/routes/search');
const scanner = require('./src/services/scanner');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/projects', projectsRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/search', searchRouter);

app.get('/api/stats', (req, res) => {
  const data = scanner.getData();
  const allSessions = [];
  for (const project of data.projects) {
    allSessions.push(...project.sessions);
  }
  const emptySessions = allSessions.filter(s => s.isEmpty);
  res.json({
    totalProjects: data.projects.length,
    totalSessions: allSessions.length,
    emptySessions: emptySessions.length,
    oldestSession: allSessions.length ? allSessions.reduce((a, b) => a.created < b.created ? a : b).created : null,
    newestSession: allSessions.length ? allSessions.reduce((a, b) => a.modified > b.modified ? a : b).modified : null,
  });
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
