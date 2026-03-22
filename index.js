const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 5000;
const DATA_DIR = path.join(__dirname, 'data');
const PICKS_FILE = path.join(DATA_DIR, 'picks.json');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');
const RESULTS_FILE = path.join(DATA_DIR, 'results.json'); // persists completed game results by week

const DEFAULT_PLAYERS = ['PME', 'Phil', 'Reece'];

// ── SSE clients ──────────────────────────────────────────────────────────────
const sseClients = [];

// ── Data helpers ─────────────────────────────────────────────────────────────
function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadPlayers() {
  ensureDataDir();
  if (!fs.existsSync(PLAYERS_FILE)) {
    fs.writeFileSync(PLAYERS_FILE, JSON.stringify(DEFAULT_PLAYERS, null, 2));
  }
  return JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8'));
}

function savePlayers(players) {
  ensureDataDir();
  fs.writeFileSync(PLAYERS_FILE, JSON.stringify(players, null, 2));
}

function loadPicks() {
  ensureDataDir();
  if (!fs.existsSync(PICKS_FILE)) {
    const players = loadPlayers();
    const empty = {};
    players.forEach(p => { empty[p] = {}; });
    fs.writeFileSync(PICKS_FILE, JSON.stringify(empty, null, 2));
  }
  return JSON.parse(fs.readFileSync(PICKS_FILE, 'utf8'));
}

function savePicks(picks) {
  ensureDataDir();
  fs.writeFileSync(PICKS_FILE, JSON.stringify(picks, null, 2));
}

function loadResults() {
  ensureDataDir();
  if (!fs.existsSync(RESULTS_FILE)) {
    fs.writeFileSync(RESULTS_FILE, JSON.stringify({}, null, 2));
  }
  return JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
}

function saveResults(results) {
  ensureDataDir();
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
}

// ── ESPN NFL API ──────────────────────────────────────────────────────────────
let cachedGames = [];
let currentWeek = null;
let currentSeason = null;

function fetchNFLScores() {
  return new Promise((resolve) => {
    const espnUrl = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
    https.get(espnUrl, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const week = json.week ? json.week.number : null;
          const season = json.season ? json.season.year : null;

          const games = (json.events || []).map(event => {
            const comp = event.competitions[0];
            const home = comp.competitors.find(c => c.homeAway === 'home');
            const away = comp.competitors.find(c => c.homeAway === 'away');
            const statusState = comp.status.type.state; // pre | in | post
            const completed = comp.status.type.completed;

            let winner = null;
            if (completed) {
              const homeScore = parseInt(home.score || 0);
              const awayScore = parseInt(away.score || 0);
              if (homeScore > awayScore) winner = home.team.displayName;
              else if (awayScore > homeScore) winner = away.team.displayName;
            }

            return {
              id: event.id,
              name: event.name,
              shortName: event.shortName,
              date: event.date,
              status: statusState,
              completed,
              homeTeam: {
                id: home.team.id,
                name: home.team.displayName,
                abbr: home.team.abbreviation,
                score: home.score || '0',
              },
              awayTeam: {
                id: away.team.id,
                name: away.team.displayName,
                abbr: away.team.abbreviation,
                score: away.score || '0',
              },
              winner,
              displayClock: comp.status.displayClock,
              period: comp.status.period,
            };
          });

          cachedGames = games;
          currentWeek = week;
          currentSeason = season;

          // Persist completed results so past weeks are scoreable forever
          if (week && games.length > 0) {
            const results = loadResults();
            const weekKey = `week${week}`;
            if (!results[weekKey]) results[weekKey] = {};
            games.filter(g => g.completed && g.winner).forEach(g => {
              results[weekKey][g.id] = { winner: g.winner, home: g.homeTeam.name, away: g.awayTeam.name };
            });
            saveResults(results);
          }

          console.log(`[ESPN] Week ${week} (${season}): ${games.length} games, ${games.filter(g => g.completed).length} completed`);
          resolve({ games, week, season });
        } catch (e) {
          console.error('[ESPN] Parse error:', e.message);
          resolve({ games: cachedGames, week: currentWeek, season: currentSeason });
        }
      });
    }).on('error', e => {
      console.error('[ESPN] Fetch error:', e.message);
      resolve({ games: cachedGames, week: currentWeek, season: currentSeason });
    });
  });
}

// ── Team name matching ───────────────────────────────────────────────────────
// Handles "Chiefs" == "Kansas City Chiefs", "KC" == "Kansas City Chiefs", etc.
function teamsMatch(pick, espnFullName, abbr) {
  if (!pick || !espnFullName) return false;
  const norm = s => s.toLowerCase().replace(/[''']/g, '').replace(/[^a-z0-9 ]/g, '').trim();
  const p = norm(pick);
  const e = norm(espnFullName);
  const a = abbr ? abbr.toLowerCase() : '';

  if (p === e) return true;
  if (p === a) return true;

  // "chiefs" matches last word(s) of "kansas city chiefs"
  const words = e.split(' ');
  for (let i = 0; i < words.length; i++) {
    if (p === words.slice(i).join(' ')) return true;
  }
  return false;
}

// ── Leaderboard ───────────────────────────────────────────────────────────────
function calculateLeaderboard() {
  const picks = loadPicks();
  const players = loadPlayers();
  const results = loadResults(); // historical: { week1: { gameId: { winner, home, away } } }

  // Merge current week's completed games into results view (without saving again)
  const liveResults = Object.assign({}, results);
  if (currentWeek && cachedGames.length > 0) {
    const weekKey = `week${currentWeek}`;
    if (!liveResults[weekKey]) liveResults[weekKey] = {};
    cachedGames.filter(g => g.completed && g.winner).forEach(g => {
      liveResults[weekKey][g.id] = { winner: g.winner, home: g.homeTeam.name, away: g.awayTeam.name };
    });
  }

  const leaderboard = players.map(player => {
    const playerPicks = picks[player] || {};
    let totalPoints = 0;
    let totalCorrect = 0;
    const weekBreakdown = {};

    Object.keys(liveResults).forEach(weekKey => {
      const weekNum = weekKey.replace('week', '');
      const weekResults = liveResults[weekKey];
      const weekPicks = playerPicks[weekKey] || {};
      let pts = 0;
      let correct = 0;

      Object.keys(weekResults).forEach(gameId => {
        const result = weekResults[gameId];
        const picked = weekPicks[gameId];
        if (picked && result.winner) {
          const isCorrect = teamsMatch(picked, result.winner, null);
          if (isCorrect) { pts++; correct++; }
        }
      });

      weekBreakdown[weekNum] = { points: pts, correct, picked: Object.keys(weekPicks).filter(k => !k.startsWith('_')).length, total: Object.keys(weekResults).length };
      totalPoints += pts;
      totalCorrect += correct;
    });

    return { user: player, points: totalPoints, correct: totalCorrect, weeks: weekBreakdown };
  });

  leaderboard.sort((a, b) => b.points - a.points || b.correct - a.correct);
  return leaderboard;
}

// ── SSE broadcast ─────────────────────────────────────────────────────────────
function broadcastLeaderboard() {
  const leaderboard = calculateLeaderboard();
  const payload = JSON.stringify({ leaderboard, week: currentWeek, lastUpdated: Date.now() });
  sseClients.forEach(client => {
    try { client.write(`event: leaderboard\ndata: ${payload}\n\n`); } catch (_) {}
  });
}

// ── Score refresh loop ────────────────────────────────────────────────────────
async function refreshScores() {
  await fetchNFLScores();
  broadcastLeaderboard();
}
setInterval(refreshScores, 30000);
refreshScores();

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const method = req.method;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const json = (data, code = 200) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  const readBody = (cb) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => { try { cb(JSON.parse(body)); } catch (e) { json({ error: 'Invalid JSON' }, 400); } });
  };

  // SSE
  if (pathname === '/api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    const payload = JSON.stringify({ leaderboard: calculateLeaderboard(), week: currentWeek, lastUpdated: Date.now() });
    res.write(`event: leaderboard\ndata: ${payload}\n\n`);
    sseClients.push(res);
    req.on('close', () => { const i = sseClients.indexOf(res); if (i !== -1) sseClients.splice(i, 1); });
    return;
  }

  // GET /api/players
  if (pathname === '/api/players' && method === 'GET') {
    return json(loadPlayers());
  }

  // POST /api/players  — add a player
  if (pathname === '/api/players' && method === 'POST') {
    return readBody(({ name }) => {
      if (!name || typeof name !== 'string' || !name.trim()) return json({ error: 'Name required' }, 400);
      const trimmed = name.trim();
      const players = loadPlayers();
      if (players.map(p => p.toLowerCase()).includes(trimmed.toLowerCase())) return json({ error: 'Player already exists' }, 400);
      players.push(trimmed);
      savePlayers(players);
      const picks = loadPicks();
      if (!picks[trimmed]) { picks[trimmed] = {}; savePicks(picks); }
      broadcastLeaderboard();
      json({ success: true, players });
    });
  }

  // DELETE /api/players/:name
  if (pathname.startsWith('/api/players/') && method === 'DELETE') {
    const name = decodeURIComponent(pathname.slice('/api/players/'.length));
    const players = loadPlayers();
    const idx = players.indexOf(name);
    if (idx === -1) return json({ error: 'Player not found' }, 404);
    players.splice(idx, 1);
    savePlayers(players);
    broadcastLeaderboard();
    return json({ success: true, players });
  }

  // GET /api/scores
  if (pathname === '/api/scores' && method === 'GET') {
    return json({ week: currentWeek, season: currentSeason, games: cachedGames });
  }

  // GET /api/leaderboard
  if (pathname === '/api/leaderboard' && method === 'GET') {
    return json({ leaderboard: calculateLeaderboard(), week: currentWeek, season: currentSeason, lastUpdated: Date.now() });
  }

  // GET /api/picks/:user
  if (pathname.startsWith('/api/picks/') && method === 'GET') {
    const user = decodeURIComponent(pathname.slice('/api/picks/'.length));
    const picks = loadPicks();
    return json({ user, picks: picks[user] || {} });
  }

  // POST /api/picks/:user  — save a single pick { week, gameId, team }
  if (pathname.startsWith('/api/picks/') && method === 'POST') {
    const user = decodeURIComponent(pathname.slice('/api/picks/'.length));
    return readBody(({ week, gameId, team }) => {
      if (!week || !gameId || !team) return json({ error: 'week, gameId, and team required' }, 400);
      const picks = loadPicks();
      if (!picks[user]) picks[user] = {};
      const weekKey = `week${week}`;
      if (!picks[user][weekKey]) picks[user][weekKey] = {};
      picks[user][weekKey][gameId] = team;
      savePicks(picks);
      broadcastLeaderboard();
      json({ success: true, user, week, gameId, team });
    });
  }

  // GET /api/results  — historical completed game results
  if (pathname === '/api/results' && method === 'GET') {
    return json(loadResults());
  }

  // Static: serve index.html
  if (pathname === '/' || pathname === '/index.html') {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch (_) {
      res.writeHead(404); res.end('index.html not found');
    }
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => console.log(`EversNFL running on port ${PORT}`));
