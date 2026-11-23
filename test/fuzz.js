'use strict';
// Throws random, mostly illegal actions at games in every phase. Nothing may throw, every snapshot must build,
// and the 17 bills must always be accounted for. Run: node test/fuzz.js
const { Game } = require('../public/engine.js');

const TYPES = ['rename', 'size', 'bots', 'timer', 'level', 'chat', 'kick', 'leave', 'start', 'ready', 'nominate', 'vote',
  'pdiscard', 'senact', 'veto', 'vetoans', 'target', 'ack', 'again', 'bogus', undefined, null, 7];
const WEIRD = [null, undefined, -1, 0, 1, 2, 3, 99, 1.5, 'x', '', {}, [], true, false, NaN, 'Infinity'];
const rnd = n => Math.floor(Math.random() * n);
const pick = a => a[rnd(a.length)];
const wait = ms => new Promise(r => setTimeout(r, ms));

async function one(seed) {
  const g = new Game('FUZZ', { fast: true });
  g.autoMs = 1;
  const humans = 1 + rnd(6);
  for (let i = 0; i < humans; i++) g.addHuman('P' + i, 't' + i);
  g.act(g.hostId, { type: 'size', size: 5 + rnd(6) });
  if (rnd(3) === 0) g.act(g.hostId, { type: 'bots', on: false });
  let problem = null;
  for (let step = 0; step < 300 && !problem; step++) {
    const ids = g.players.map(p => p.id);
    const who = rnd(8) === 0 ? pick(WEIRD) : pick(ids.concat([g.hostId, g.hostId]));
    const targets = ids.concat(WEIRD);
    const a = { type: pick(TYPES), pid: pick(targets), yes: pick([true, false, pick(WEIRD)]), i: pick([0, 1, 2, pick(WEIRD)]), on: pick([true, false]),
      size: pick([5, 7, 10, pick(WEIRD)]), sec: pick([0, 30, 45, pick(WEIRD)]), level: pick(['easy', 'hard', pick(WEIRD)]), text: pick(['hi', '', pick(WEIRD)]), name: pick(['Zed', '', pick(WEIRD)]) };
    try {
      g.act(who, rnd(15) === 0 ? pick(WEIRD) : a);
      if (step % 7 === 0) {
        g.players.forEach(p => g.snapshot(p.id));
        g.snapshot(pick(WEIRD));
      }
      if (g.phase !== 'lobby') {
        const held = g.deck.length + g.discard.length + g.cards.length + g.enacted.D + g.enacted.R;
        if (held !== 17) problem = 'bills not conserved: ' + held + ' in ' + g.phase;
      }
    } catch (e) { problem = 'threw ' + (e && e.stack || e).toString().split('\n').slice(0, 3).join(' | ') + ' on ' + JSON.stringify(a) + ' phase ' + g.phase; }
    if (step % 25 === 0) await wait(3);
  }
  g.destroy();
  return problem;
}

(async () => {
  const jobs = [];
  for (let i = 0; i < 120; i++) jobs.push(one(i));
  const res = await Promise.all(jobs);
  const bad = res.filter(Boolean);
  console.log(res.length - bad.length + ' fuzzed games ok, ' + bad.length + ' problems');
  bad.slice(0, 5).forEach(b => console.log('PROBLEM ' + b));
  process.exit(bad.length ? 1 : 0);
})();
