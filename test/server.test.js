'use strict';
// Plays a whole game over HTTP and server-sent events with five human clients. Run: node test/server.test.js
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const assert = require('assert');

const PORT = 3400 + Math.floor(Math.random() * 400);
const base = { hostname: '127.0.0.1', port: PORT };

function post(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(Object.assign({ path: url, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, base), res => {
      let s = ''; res.on('data', d => s += d); res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.end(data);
  });
}
function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(Object.assign({ path: url }, base), res => {
      let s = ''; res.on('data', d => s += d); res.on('end', () => { try { resolve({ st: res.statusCode, j: JSON.parse(s) }); } catch (e) { resolve({ st: res.statusCode, j: null }); } });
    }).on('error', reject);
  });
}

class Client {
  constructor(name) { this.name = name; this.snap = null; this.req = null; this.acting = false; this.errs = []; }
  async join(code) {
    const r = code ? await post('/api/join', { code, name: this.name }) : await post('/api/create', { name: this.name });
    assert.ok(r.token, 'joined: ' + JSON.stringify(r));
    Object.assign(this, { code: r.code, token: r.token, pid: r.pid });
  }
  stream() {
    return new Promise(resolve => {
      this.req = http.get(Object.assign({ path: '/api/stream?code=' + this.code + '&token=' + this.token }, base), res => {
        let buf = '';
        res.on('data', d => {
          buf += d;
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
            if (chunk.startsWith('data: ')) { this.snap = JSON.parse(chunk.slice(6)); resolve(); }
          }
        });
      });
      this.req.on('error', () => {});
    });
  }
  async act(a) { const r = await post('/api/act', { code: this.code, token: this.token, a }); if (r.err) this.errs.push(r.err); return r; }
  // what a person would do next, given only what the server shows them
  async play() {
    const s = this.snap;
    if (!s || this.acting) return;
    this.acting = true;
    try {
      const me = s.me, pick = a => a[Math.floor(Math.random() * a.length)];
      if (s.phase === 'reveal' && !s.players.find(p => p.id === me).ready) await this.act({ type: 'ready' });
      else if (s.phase === 'nominate' && s.pres === me) await this.act({ type: 'nominate', pid: pick(s.eligible) });
      else if (s.phase === 'vote' && s.myVote === null && s.players.find(p => p.id === me).alive) await this.act({ type: 'vote', yes: Math.random() < 0.6 });
      else if (s.phase === 'legis_pres' && s.pres === me) await this.act({ type: 'pdiscard', i: Math.floor(Math.random() * s.hand.length) });
      else if (s.phase === 'legis_spk' && s.spk === me) {
        if (s.canVeto && Math.random() < 0.5) await this.act({ type: 'veto' });
        else await this.act({ type: 'senact', i: Math.floor(Math.random() * s.hand.length) });
      }
      else if (s.phase === 'veto' && s.pres === me) await this.act({ type: 'vetoans', yes: Math.random() < 0.5 });
      else if (s.phase === 'power' && s.pres === me) {
        if (s.powerStage === 'pick') await this.act({ type: 'target', pid: pick(s.targets) });
        else await this.act({ type: 'ack' });
      }
    } finally { this.acting = false; }
  }
}

(async () => {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT), SK_FAST: '1' }), stdio: ['ignore', 'pipe', 'inherit'] });
  const fail = e => { console.log('FAIL ' + (e && e.stack || e)); child.kill(); process.exit(1); };
  process.on('unhandledRejection', fail);
  await new Promise(r => child.stdout.on('data', d => { if (/listening/.test(String(d))) r(); }));
  try {
    assert.deepStrictEqual((await getJson('/health')).j.ok, true);
    for (const f of ['/', '/engine.js', '/fonts/big-shoulders-display.woff2', '/fonts/hanken-grotesk.woff2']) {
      const r = await new Promise(res => http.get(Object.assign({ path: f }, base), x => { let n = 0; x.on('data', d => n += d.length); x.on('end', () => res({ st: x.statusCode, type: x.headers['content-type'], n })); }));
      assert.strictEqual(r.st, 200, f + ' is served');
      assert.ok(r.n > 1000, f + ' has content');
      if (f.endsWith('.woff2')) assert.strictEqual(r.type, 'font/woff2');
    }
    assert.strictEqual((await getJson('/server.js')).st, 404, 'server source is not served');
    const host = new Client('Host'); await host.join();
    const others = ['Ann', 'Bo', 'Cy', 'Di'].map(n => new Client(n));
    for (const c of others) await c.join(host.code);
    const all = [host].concat(others);
    assert.strictEqual((await post('/api/join', { code: 'ZZZZ', name: 'X' })).err, 'Room not found');
    assert.strictEqual((await getJson('/api/state?code=' + host.code + '&token=bad')).st, 404);
    for (const c of all) await c.stream();
    assert.strictEqual(host.snap.players.length, 5);
    assert.ok((await others[0].act({ type: 'start' })).err, 'only the host starts');
    await host.act({ type: 'bots', on: false });
    assert.ok((await host.act({ type: 'start' })).ok);
    await new Promise(r => setTimeout(r, 100));

    // each client's view: roles stay secret
    const roles = {};
    for (const c of all) {
      const s = c.snap;
      assert.ok(['maj', 'min', 'king'].indexOf(s.myRole) >= 0, 'has a role');
      roles[c.pid] = s.myRole;
      s.players.forEach(p => { if (p.id !== c.pid && s.myRole === 'maj') assert.strictEqual(p.role, null, 'maj sees nothing'); });
    }
    assert.strictEqual(Object.values(roles).filter(r => r === 'king').length, 1);

    // rejoin and polling fallback
    const rj = await post('/api/rejoin', { code: host.code, token: host.token });
    assert.strictEqual(rj.pid, host.pid);
    const st = await getJson('/api/state?code=' + host.code + '&token=' + host.token);
    assert.strictEqual(st.j.s.phase, host.snap.phase);

    // one client drops mid-game: the table plays on without them
    const dropped = others[3];
    dropped.req.destroy();

    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      await Promise.all(all.filter(c => c !== dropped).map(c => c.play()));
      if (host.snap.phase === 'gameover') break;
      await new Promise(r => setTimeout(r, 25));
    }
    assert.strictEqual(host.snap.phase, 'gameover', 'game finished, last phase ' + host.snap.phase + ' round ' + host.snap.round);
    const res = host.snap.result;
    assert.ok(res && (res.winner === 'maj' || res.winner === 'min'));
    // at the end everyone's role shows
    host.snap.players.forEach(p => assert.ok(p.role, 'role revealed'));
    assert.ok(host.snap.log.some(e => e.cards), 'cards revealed in the record');
    assert.ok(host.errs.every(e => e !== 'Unknown action'));
    assert.ok((await host.act({ type: 'again' })).ok);
    await new Promise(r => setTimeout(r, 80));
    assert.strictEqual(host.snap.phase, 'lobby');
    assert.ok((await host.act({ type: 'leave' })).ok);
    console.log('server game ok: ' + res.winner + ' won (' + res.why + ')');
    child.kill();
    process.exit(0);
  } catch (e) { fail(e); }
})();
