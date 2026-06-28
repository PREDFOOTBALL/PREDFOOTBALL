const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

const API_KEY  = process.env.API_KEY || '';
const PORT     = process.env.PORT || 3000;
const API_HOST = 'v3.football.api-sports.io';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function apiFetch(p) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: API_HOST, path: p, method: 'GET',
      headers: { 'x-apisports-key': API_KEY, 'x-rapidapi-host': API_HOST }
    };
    const req = https.request(opts, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(9000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

const APP_HTML = fs.readFileSync(path.join(__dirname, 'app.html'), 'utf8');

const server = http.createServer(async (req, res) => {
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const query    = parsed.query;

  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }
  cors(res);

  try {
    if (pathname === '/' || pathname === '/index.html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.writeHead(200);
      res.end(APP_HTML);

    } else if (pathname === '/api/status') {
      const d = await apiFetch('/status');
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, account: d.response && d.response.account, requests: d.response && d.response.requests }));

    } else if (pathname === '/api/live') {
      const d = await apiFetch('/fixtures?league=1&season=2026&live=all');
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200); res.end(JSON.stringify(d));

    } else if (pathname === '/api/today') {
      // Bolivia = UTC-4. Buscamos en vivo + fecha Bolivia + fecha UTC para no perder partidos
      const now     = new Date();
      const bol     = new Date(now.getTime() - 4 * 3600000);
      const today   = bol.toISOString().split('T')[0];
      const utcDate = now.toISOString().split('T')[0];
      const [liveData, todayBol, todayUtc] = await Promise.allSettled([
        apiFetch('/fixtures?league=1&season=2026&live=all'),
        apiFetch('/fixtures?league=1&season=2026&date=' + today),
        apiFetch('/fixtures?league=1&season=2026&date=' + utcDate),
      ]);
      const seen = new Set();
      const all  = [];
      for (const r of [liveData, todayBol, todayUtc]) {
        if (r.status === 'fulfilled') {
          for (const f of (r.value.response || [])) {
            if (!seen.has(f.fixture.id)) { seen.add(f.fixture.id); all.push(f); }
          }
        }
      }
      all.sort((a,b) => new Date(a.fixture.date) - new Date(b.fixture.date));
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(JSON.stringify({ response: all, results: all.length }));

    } else if (pathname === '/api/lineups') {
      const d = await apiFetch('/fixtures/lineups?fixture=' + (query.fixture || ''));
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200); res.end(JSON.stringify(d));

    } else if (pathname === '/api/events') {
      const d = await apiFetch('/fixtures/events?fixture=' + (query.fixture || ''));
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200); res.end(JSON.stringify(d));

    } else if (pathname === '/api/stats') {
      const d = await apiFetch('/fixtures/statistics?fixture=' + (query.fixture || ''));
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200); res.end(JSON.stringify(d));

    } else if (pathname === '/api/league') {
      // Partidos de hoy de cualquier liga
      const now  = new Date();
      const bol  = new Date(now.getTime() - 4 * 3600000);
      const date = bol.toISOString().split('T')[0];
      const league  = query.league  || '39';
      const season  = query.season  || '2025';
      const d = await apiFetch('/fixtures?league='+league+'&season='+season+'&date='+date);
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200); res.end(JSON.stringify(d));

    } else if (pathname === '/api/debug') {
      // Debug: muestra que devuelve la API para el Mundial hoy
      const now     = new Date();
      const bol     = new Date(now.getTime() - 4 * 3600000);
      const today   = bol.toISOString().split('T')[0];
      const utcDate = now.toISOString().split('T')[0];
      const tomorrow = new Date(now.getTime() + 86400000).toISOString().split('T')[0];
      try {
        const [d1,d2,d3,d4] = await Promise.allSettled([
          apiFetch('/fixtures?league=1&season=2026&live=all'),
          apiFetch('/fixtures?league=1&season=2026&date='+today),
          apiFetch('/fixtures?league=1&season=2026&date='+utcDate),
          apiFetch('/fixtures?league=1&season=2026&date='+tomorrow),
        ]);
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({
          serverTime: now.toISOString(),
          boliviaTime: bol.toISOString(),
          dates: {bolDate:today, utcDate, tomorrow},
          live:     {count:(d1.value?.results||0), status:d1.status},
          bolDate:  {count:(d2.value?.results||0), status:d2.status},
          utcDate:  {count:(d3.value?.results||0), status:d3.status},
          nextDay:  {count:(d4.value?.results||0), status:d4.status, fixtures:(d4.value?.response||[]).slice(0,3).map(f=>({
            date:f.fixture?.date, home:f.teams?.home?.name, away:f.teams?.away?.name, status:f.fixture?.status?.short
          }))},
        }, null, 2));
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({error:e.message}));
      }

    } else {
      res.writeHead(404); res.end('Not found');
    }
  } catch (err) {
    console.error('[ERROR]', err.message);
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, '0.0.0.0', function() {
  console.log('');
  console.log('  MUNDIAL 2026 IA - Servidor activo');
  console.log('  Puerto: ' + PORT);
  console.log('  API Key: ' + (API_KEY ? 'OK configurada' : 'FALTA'));
  console.log('');
});
