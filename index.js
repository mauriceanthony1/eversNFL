const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const CLEAN_JS = "let currentTabId = 'leaderboard';\nlet selectedPlayer = null;\nlet players = [];\nlet currentWeek = null;\nlet currentGames = [];\nlet userPicks = {};\nlet leaderboardData = [];\nfunction switchTab(id, btn) {\ndocument.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));\ndocument.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));\ndocument.getElementById(id).classList.add('active');\nbtn.classList.add('active');\ncurrentTabId = id;\nif (id === 'picks') loadPicks();\nif (id === 'scores') renderScores();\nif (id === 'admin') renderAdmin();\n}\nfunction showToast(msg, isError = false) {\nconst t = document.getElementById('toast');\nt.textContent = msg;\nt.className = 'toast show' + (isError ? ' error' : '');\nsetTimeout(() => t.className = 'toast', 2500);\n}\nfunction initSSE() {\nconst es = new EventSource('/api/stream');\nes.addEventListener('leaderboard', e => {\nconst data = JSON.parse(e.data);\nleaderboardData = data.leaderboard;\ncurrentWeek = data.week;\ndocument.getElementById('week-num').textContent = currentWeek || '—';\ndocument.getElementById('scores-week-num').textContent = currentWeek || '—';\nif (currentTabId === 'leaderboard') renderLeaderboard();\nif (currentTabId === 'picks' && selectedPlayer) refreshPickHighlights();\n});\nes.onerror = () => { document.getElementById('live-label').textContent = 'Reconnecting...'; };\nes.onopen = () => { document.getElementById('live-label').textContent = 'Live'; };\n}\nfunction renderLeaderboard() {\nconst medals = ['🥇', '🥈', '🥉'];\nif (!leaderboardData.length) {\ndocument.getElementById('lb-content').innerHTML = '<div class=\"no-games\"><div class=\"emoji\">📋</div><h3>No picks yet</h3><p>Get everyone to submit their picks!</p></div>';\nreturn;\n}\ndocument.getElementById('lb-content').innerHTML = leaderboardData.map((p, i) => {\nconst weeks = p.weeks || {};\nconst weekKeys = Object.keys(weeks).sort((a, b) => parseInt(a) - parseInt(b));\nconst breakdown = weekKeys.map(w => `\n<div class=\"week-row\">\n<span>Week ${w}</span>\n<span>${weeks[w].correct || 0}/${weeks[w].total || 0} correct — ${weeks[w].points || 0} pts</span>\n</div>`).join('') || '<div class=\"week-row\"><span>No picks yet</span></div>';\nreturn `\n<div class=\"lb-card\">\n<div class=\"lb-row\" onclick=\"toggleBreakdown(${i})\">\n<div class=\"rank\">${medals[i] || i + 1}</div>\n<div class=\"lb-name\">${p.user}</div>\n<div style=\"display:flex;align-items:baseline\">\n<div class=\"lb-pts\">${p.points}</div>\n<div class=\"lb-correct\">${p.correct} correct</div>\n</div>\n</div>\n<div class=\"week-breakdown\" id=\"breakdown-${i}\">${breakdown}</div>\n</div>`;\n}).join('');\n}\nfunction toggleBreakdown(i) {\nconst el = document.getElementById(`breakdown-${i}`);\nel.classList.toggle('open');\n}\nasync function loadPlayers() {\nconst res = await fetch('/api/players');\nplayers = await res.json();\nrenderPlayerSelector();\nrenderAdmin();\n}\nfunction renderPlayerSelector() {\nconst sel = document.getElementById('player-selector');\nsel.innerHTML = players.map(p =>\n`<button class=\"player-btn ${p === selectedPlayer ? 'active' : ''}\" onclick=\"selectPlayer('${p}')\">${p}</button>`\n).join('');\n}\nfunction selectPlayer(name) {\nselectedPlayer = name;\nrenderPlayerSelector();\nloadPicksForPlayer();\n}\nasync function loadPicks() {\nif (!selectedPlayer && players.length) selectPlayer(players[0]);\nif (selectedPlayer) await loadPicksForPlayer();\nawait loadScores();\nrenderPicksTab();\n}\nasync function loadPicksForPlayer() {\nif (!selectedPlayer) return;\nconst res = await fetch(`/api/picks/${encodeURIComponent(selectedPlayer)}`);\nconst data = await res.json();\nuserPicks = data.picks || {};\nrenderPicksTab();\n}\nasync function loadScores() {\nconst res = await fetch('/api/scores');\nconst data = await res.json();\ncurrentGames = data.games || [];\ncurrentWeek = data.week;\ndocument.getElementById('week-num').textContent = currentWeek || '—';\ndocument.getElementById('scores-week-num').textContent = currentWeek || '—';\n}\nfunction renderPicksTab() {\nif (!selectedPlayer) {\ndocument.getElementById('picks-content').innerHTML = '<div class=\"no-games\"><div class=\"emoji\">👆</div><h3>Select a player above</h3></div>';\nreturn;\n}\nif (!currentGames.length) {\ndocument.getElementById('picks-content').innerHTML = '<div class=\"no-games\"><div class=\"emoji\">🏈</div><h3>No games this week</h3><p>Check back when the NFL season starts!</p></div>';\nreturn;\n}\nconst weekKey = currentWeek ? `week${currentWeek}` : null;\nconst weekPicks = weekKey ? (userPicks[weekKey] || {}) : {};\ndocument.getElementById('picks-content').innerHTML = currentGames.map(game => {\nconst picked = weekPicks[game.id];\nconst isLocked = game.status !== 'pre';\nconst isCompleted = game.completed;\nconst winner = game.winner;\nconst awayClass = buildPickClass(picked, game.awayTeam.name, isLocked, isCompleted, winner);\nconst homeClass = buildPickClass(picked, game.homeTeam.name, isLocked, isCompleted, winner);\nconst kickoff = new Date(game.date).toLocaleString('en-US', { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short' });\nreturn `\n<div class=\"game-card\">\n<div class=\"game-header\">\n<span>${kickoff}</span>\n${statusBadge(game)}\n</div>\n<div class=\"matchup\">\n<div class=\"team\">\n<div class=\"team-abbr\">${game.awayTeam.abbr}</div>\n<div class=\"team-name\">${game.awayTeam.name}</div>\n</div>\n<div class=\"vs-sep\">@</div>\n<div class=\"team\">\n<div class=\"team-abbr\">${game.homeTeam.abbr}</div>\n<div class=\"team-name\">${game.homeTeam.name}</div>\n</div>\n</div>\n<div class=\"pick-btns\">\n<button class=\"pick-btn ${awayClass}\" onclick=\"submitPick('${game.id}','${game.awayTeam.name}',${isLocked})\">\n${pickedLabel(picked, game.awayTeam.name)} ${game.awayTeam.abbr}\n</button>\n<button class=\"pick-btn ${homeClass}\" onclick=\"submitPick('${game.id}','${game.homeTeam.name}',${isLocked})\">\n${pickedLabel(picked, game.homeTeam.name)} ${game.homeTeam.abbr}\n</button>\n</div>\n</div>`;\n}).join('');\n}\nfunction buildPickClass(picked, teamName, isLocked, isCompleted, winner) {\nconst isPicked = picked && normTeam(picked) === normTeam(teamName);\nif (isCompleted && isPicked) {\nreturn winner && normTeam(winner) === normTeam(teamName) ? 'correct' : 'wrong';\n}\nif (isPicked) return teamName === picked || normTeam(picked) === normTeam(teamName) ? (teamName.includes(picked.split(' ').pop()) ? 'picked-home' : 'picked-away') : 'picked-home';\nif (isLocked) return 'locked';\nreturn '';\n}\nfunction pickedLabel(picked, teamName) {\nreturn picked && normTeam(picked) === normTeam(teamName) ? '✓ ' : '';\n}\nfunction normTeam(s) { return s ? s.toLowerCase().replace(/[^a-z]/g, '') : ''; }\nfunction statusBadge(game) {\nif (game.completed) return '<span class=\"game-status-badge final\">Final</span>';\nif (game.status === 'in') return `<span class=\"game-status-badge live\">Q${game.period} ${game.displayClock}</span>`;\nreturn '<span class=\"game-status-badge upcoming\">Upcoming</span>';\n}\nasync function submitPick(gameId, teamName, isLocked) {\nif (isLocked) { showToast('Game already started — picks are locked', true); return; }\nif (!selectedPlayer) { showToast('Select a player first', true); return; }\nif (!currentWeek) { showToast('No active week found', true); return; }\nconst res = await fetch(`/api/picks/${encodeURIComponent(selectedPlayer)}`, {\nmethod: 'POST',\nheaders: { 'Content-Type': 'application/json' },\nbody: JSON.stringify({ week: currentWeek, gameId, team: teamName })\n});\nconst data = await res.json();\nif (data.success) {\nconst weekKey = `week${currentWeek}`;\nif (!userPicks[weekKey]) userPicks[weekKey] = {};\nuserPicks[weekKey][gameId] = teamName;\nrenderPicksTab();\nshowToast(`Picked ${teamName.split(' ').pop()}!`);\n} else {\nshowToast(data.error || 'Error saving pick', true);\n}\n}\nfunction refreshPickHighlights() {\nif (currentTabId === 'picks' && selectedPlayer) renderPicksTab();\n}\nasync function renderScores() {\nawait loadScores();\nif (!currentGames.length) {\ndocument.getElementById('scores-content').innerHTML = '<div class=\"no-games\"><div class=\"emoji\">🏈</div><h3>No games this week</h3><p>Check back when the season kicks off!</p></div>';\nreturn;\n}\ndocument.getElementById('scores-content').innerHTML = currentGames.map(game => {\nconst homeWon = game.completed && game.winner === game.homeTeam.name;\nconst awayWon = game.completed && game.winner === game.awayTeam.name;\nconst statusLine = game.completed\n? `<div class=\"final-label\">Final</div>`\n: game.status === 'in'\n? `<div class=\"live-clock\">Q${game.period} · ${game.displayClock}</div>`\n: `<div class=\"live-clock\" style=\"color:#7d8590\">${new Date(game.date).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}</div>`;\nreturn `\n<div class=\"score-card\">\n${statusLine}\n<div class=\"score-matchup\">\n<div class=\"score-team\">\n<div class=\"score-abbr\">${game.awayTeam.abbr}</div>\n<div class=\"score-full\">${game.awayTeam.name}</div>\n<div class=\"score-num ${awayWon ? 'winner' : ''}\">${game.status === 'pre' ? '—' : game.awayTeam.score}</div>\n</div>\n<div class=\"score-sep\">@</div>\n<div class=\"score-team\">\n<div class=\"score-abbr\">${game.homeTeam.abbr}</div>\n<div class=\"score-full\">${game.homeTeam.name}</div>\n<div class=\"score-num ${homeWon ? 'winner' : ''}\">${game.status === 'pre' ? '—' : game.homeTeam.score}</div>\n</div>\n</div>\n</div>`;\n}).join('');\n}\nfunction renderAdmin() {\ndocument.getElementById('player-list').innerHTML = players.map(p => `\n<div class=\"player-item\">\n<span class=\"player-name\">${p}</span>\n<button class=\"btn-danger\" onclick=\"removePlayer('${p}')\">Remove</button>\n</div>`).join('') || '<p style=\"color:#7d8590;font-size:.85rem\">No players yet</p>';\n}\nasync function addPlayer() {\nconst input = document.getElementById('new-player-input');\nconst name = input.value.trim();\nif (!name) { showToast('Enter a name first', true); return; }\nconst res = await fetch('/api/players', {\nmethod: 'POST',\nheaders: { 'Content-Type': 'application/json' },\nbody: JSON.stringify({ name })\n});\nconst data = await res.json();\nif (data.success) {\nplayers = data.players;\ninput.value = '';\nrenderPlayerSelector();\nrenderAdmin();\nshowToast(`${name} added! 🏈`);\n} else {\nshowToast(data.error || 'Error adding player', true);\n}\n}\nasync function removePlayer(name) {\nif (!confirm(`Remove ${name} from the league?`)) return;\nconst res = await fetch(`/api/players/${encodeURIComponent(name)}`, { method: 'DELETE' });\nconst data = await res.json();\nif (data.success) {\nplayers = data.players;\nif (selectedPlayer === name) selectedPlayer = players[0] || null;\nrenderPlayerSelector();\nrenderAdmin();\nshowToast(`${name} removed`);\n} else {\nshowToast(data.error || 'Error removing player', true);\n}\n}\nasync function init() {\nawait loadPlayers();\nawait loadScores();\ninitSSE();\n}\ninit();";

const PORT = process.env.PORT || 5000;
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
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
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
      let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
      const si = html.indexOf('<script>');
      if (si >= 0) {
        html = html.slice(0, si + 8) + CLEAN_JS + '\n<\/script>\n<\/body>\n<\/html>';
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html, 'utf8');
    } catch (_) {
      res.writeHead(404); res.end('index.html not found');
    }
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => console.log(`EversNFL running on port ${PORT}`));
