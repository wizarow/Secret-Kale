'use strict';
// Rule checks and simulated games for Secret Kale. Run: node test/engine.test.js
const assert = require('assert');
const E = require('../public/engine.js');
const { Game, DIST } = E;

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(name + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); }
}
const later = [];
function atest(name, fn) { later.push([name, fn]); }

// A table of n humans, nobody on a timer, so only the test moves the game.
function table(n, opts) {
  const g = new Game('TEST', Object.assign({ fast: true }, opts || {}));
  g.botsOn = false;
  for (let i = 0; i < n; i++) assert.ok(g.addHuman('P' + (i + 1), 't' + i).ok);
  assert.ok(g.act(g.hostId, { type: 'start' }).ok);
  assert.strictEqual(g.phase, 'reveal');
  g.players.forEach(p => assert.ok(g.act(p.id, { type: 'ready' }).ok));   // the Reveal: everyone has looked
  return g;
}
// Fix the roles by seat so rule tests are deterministic: ['maj','maj','maj','min','king'] ...
function setup(n, roles) {
  const g = table(n);
  clearTimeout(g.ttimer); g.ttimer = null;
  g.minParty = 'R'; g.majParty = 'D';
  g.players.forEach((p, i) => { p.role = roles ? roles[i] : (i === n - 1 ? 'king' : i >= n - 1 - DIST[n][1] ? 'min' : 'maj'); });
  g.presIdx = 0;
  g.deck = []; g.discard = [];
  for (let i = 0; i < 6; i++) g.deck.push('D');
  for (let i = 0; i < 11; i++) g.deck.push('R');
  g.enacted = { D: 0, R: 0 };
  g.lastPres = null; g.lastSpk = null; g.tracker = 0;
  g.startElection();
  return g;
}
const P = (g, i) => g.players[i];
const act = (g, i, a) => g.act(P(g, i).id, a);
function holdDone(g) {   // run the auto-advance after a result or an enacted bill
  clearTimeout(g.ttimer); g.ttimer = null;
  if (g.phase === 'voteresult') g.afterVote();
  else if (g.phase === 'enacted') g.afterEnact();
}
function vote(g, yesList) {
  g.alivePlayers().forEach(p => { assert.ok(g.act(p.id, { type: 'vote', yes: yesList.indexOf(p.id) >= 0 }).ok); });
}
function elect(g, spkIdx) {
  assert.ok(act(g, g.presIdx, { type: 'nominate', pid: P(g, spkIdx).id }).ok, 'nominate');
  vote(g, g.alivePlayers().map(p => p.id));
  assert.strictEqual(g.phase, 'voteresult');
  holdDone(g);
}
function cardsHeld(g) { return g.deck.length + g.discard.length + g.cards.length + g.enacted.D + g.enacted.R; }

// ---------- setup and secrecy ----------
test('role counts for 5 to 10 players', () => {
  for (let n = 5; n <= 10; n++) {
    const g = table(n);
    const c = { maj: 0, min: 0, king: 0 };
    g.players.forEach(p => c[p.role]++);
    assert.strictEqual(c.maj, DIST[n][0], n + ' maj');
    assert.strictEqual(c.min, DIST[n][1], n + ' min');
    assert.strictEqual(c.king, 1, n + ' king');
    assert.strictEqual(g.deck.length, 17);
    assert.notStrictEqual(g.majParty, g.minParty);
    assert.strictEqual(g.deck.filter(x => x === g.minParty).length, 11);
    assert.strictEqual(g.deck.filter(x => x === g.majParty).length, 6);
  }
});
test('the hidden party is not always the same', () => {
  const seen = {};
  for (let i = 0; i < 60; i++) seen[table(5).minParty] = 1;
  assert.deepStrictEqual(Object.keys(seen).sort(), ['D', 'R']);
});
test('who sees whom', () => {
  [5, 6, 7, 8, 9, 10].forEach(n => {
    const g = table(n);
    g.players.forEach(me => {
      const s = g.snapshot(me.id);
      s.players.forEach(o => {
        if (o.id === me.id) return;
        const other = g.byId(o.id);
        if (me.role === 'maj') assert.strictEqual(o.role, null, 'maj sees nothing');
        else if (me.role === 'min') assert.strictEqual(o.role, other.role === 'maj' ? null : other.role, 'min sees the team and the Kingpin');
        else if (n <= 6) assert.strictEqual(o.role, other.role === 'min' ? 'min' : null, 'Kingpin sees the team at 5-6');
        else assert.strictEqual(o.role, null, 'Kingpin is blind at 7+');
      });
    });
  });
});
test('roles of everyone show only at game over', () => {
  const g = setup(5);
  g.endGame('maj', 'x');
  const s = g.snapshot(P(g, 0).id);
  s.players.forEach(o => assert.strictEqual(o.role, g.byId(o.id).role));
  assert.ok(s.result && s.result.winner === 'maj');
});
test('votes stay hidden until the last one lands', () => {
  const g = setup(5);
  act(g, 0, { type: 'nominate', pid: P(g, 1).id });
  act(g, 0, { type: 'vote', yes: true });
  act(g, 2, { type: 'vote', yes: false });
  const s = g.snapshot(P(g, 3).id);
  s.players.forEach(o => assert.strictEqual(o.vote, null));
  assert.strictEqual(s.players[0].voted, true);
  assert.strictEqual(s.players[3].voted, false);
  assert.strictEqual(g.snapshot(P(g, 0).id).myVote, true);
  assert.strictEqual(g.snapshot(P(g, 3).id).myVote, null);
  assert.strictEqual(act(g, 0, { type: 'vote', yes: false }).err, 'Your vote is already in');
});
test('bills in hand are private', () => {
  const g = setup(5);
  elect(g, 1);
  assert.strictEqual(g.phase, 'legis_pres');
  assert.strictEqual(g.snapshot(P(g, 0).id).hand.length, 3);
  [1, 2, 3, 4].forEach(i => assert.deepStrictEqual(g.snapshot(P(g, i).id).hand, []));
  act(g, 0, { type: 'pdiscard', i: 0 });
  assert.strictEqual(g.snapshot(P(g, 1).id).hand.length, 2);
  assert.strictEqual(g.snapshot(P(g, 2).id).hand.length, 0);
});

// ---------- the Reveal ----------
function revealTable(n) {
  const g = new Game('REV', { fast: true });
  g.botsOn = false;
  for (let i = 0; i < n; i++) g.addHuman('P' + (i + 1), 't' + i);
  g.act(g.hostId, { type: 'start' });
  return g;
}
test('the first vote waits for every human to look at their role', () => {
  const g = revealTable(5);
  assert.strictEqual(g.phase, 'reveal');
  assert.strictEqual(g.round, 0);
  assert.strictEqual(act(g, 0, { type: 'nominate', pid: P(g, 1).id }).err, 'Not your turn');
  [0, 1, 2, 3].forEach(i => { assert.ok(act(g, i, { type: 'ready' }).ok); assert.strictEqual(g.phase, 'reveal'); });
  const s = g.snapshot(P(g, 0).id);
  assert.deepStrictEqual(s.players.map(p => p.ready), [true, true, true, true, false]);
  assert.ok(act(g, 4, { type: 'ready' }).ok);
  assert.strictEqual(g.phase, 'nominate');
  assert.strictEqual(g.round, 1);
  assert.strictEqual(act(g, 0, { type: 'ready' }).err, 'Not now');
  assert.strictEqual(g.snapshot(P(g, 0).id).players[0].ready, null);
});
test('bots never hold up the Reveal, and removing a player cannot stall it', () => {
  const g = new Game('REV', { fast: true });
  g.addHuman('Host', 'h'); g.addHuman('Ann', 'a');
  g.act(1, { type: 'size', size: 6 });
  g.act(1, { type: 'start' });
  assert.strictEqual(g.phase, 'reveal');
  assert.deepStrictEqual(g.pendingActors().filter(p => p.bot).length, 0);
  assert.strictEqual(g.pendingActors().length, 2);
  g.act(1, { type: 'ready' });
  assert.strictEqual(g.phase, 'reveal');
  g.act(1, { type: 'kick', pid: 2 });            // the last human still looking is replaced by a bot
  assert.notStrictEqual(g.phase, 'reveal');
  g.destroy();
});
// ---------- elections ----------
test('Speaker eligibility and term limits', () => {
  const g = setup(7);
  assert.strictEqual(act(g, 0, { type: 'nominate', pid: P(g, 0).id }).err, 'That player cannot be Speaker right now');
  assert.strictEqual(act(g, 3, { type: 'nominate', pid: P(g, 1).id }).err, 'Not your turn');
  elect(g, 1);                       // P1 President, P2 Speaker
  act(g, 0, { type: 'pdiscard', i: 0 }); act(g, 1, { type: 'senact', i: 0 }); holdDone(g);
  // after a bill (no power for the first two bills at 7 players: first bill none)
  if (g.phase === 'power') act(g, g.presIdx, { type: 'ack' });
  assert.strictEqual(g.lastPres, P(g, 0).id);
  assert.strictEqual(g.lastSpk, P(g, 1).id);
  assert.strictEqual(g.presIdx, 1);
  const el = g.eligibleList().map(p => p.id);
  assert.ok(el.indexOf(P(g, 0).id) < 0, 'last President blocked at 7 players');
  assert.ok(el.indexOf(P(g, 1).id) < 0, 'self and last Speaker blocked');
});
test('at 5 players left only the last Speaker is blocked', () => {
  const g = setup(5);
  elect(g, 1);
  act(g, 0, { type: 'pdiscard', i: 0 }); act(g, 1, { type: 'senact', i: 0 }); holdDone(g);
  if (g.phase === 'power') act(g, g.presIdx, { type: 'ack' });
  const el = g.eligibleList().map(p => p.id);
  assert.ok(el.indexOf(P(g, 0).id) >= 0, 'last President allowed at 5 players');
  assert.ok(el.indexOf(P(g, 1).id) < 0);
});
test('a tie fails the vote and moves the tracker', () => {
  const g = setup(6);
  act(g, 0, { type: 'nominate', pid: P(g, 1).id });
  vote(g, [P(g, 0).id, P(g, 1).id, P(g, 2).id]);   // 3 yea, 3 nay
  assert.strictEqual(g.voteResult.passed, false);
  assert.strictEqual(g.tracker, 1);
  holdDone(g);
  assert.strictEqual(g.phase, 'nominate');
  assert.strictEqual(g.presIdx, 1);
});
test('three failed votes enact the top bill with no power and clear term limits', () => {
  const g = setup(7);
  g.lastPres = P(g, 5).id; g.lastSpk = P(g, 6).id;
  g.deck = ['R', 'D', 'D', 'D', 'D', 'D', 'D', 'R', 'R', 'R', 'R', 'R', 'R', 'R', 'R', 'R', 'R'];
  for (let k = 0; k < 3; k++) {
    act(g, g.presIdx, { type: 'nominate', pid: g.eligibleList()[0].id });
    vote(g, []);
    holdDone(g);
  }
  assert.strictEqual(g.phase, 'enacted');
  assert.strictEqual(g.enacted.R, 1);
  assert.strictEqual(g.tracker, 0);
  assert.strictEqual(g.lastPres, null); assert.strictEqual(g.lastSpk, null);
  holdDone(g);
  assert.strictEqual(g.phase, 'nominate', 'no power from chaos');
  assert.strictEqual(g.log[g.log.length - 2].chaos, true);
});
test('dead players cannot vote, be nominated or chat', () => {
  const g = setup(7);
  g.byId(P(g, 3).id).alive = false;
  assert.strictEqual(act(g, 0, { type: 'nominate', pid: P(g, 3).id }).err, 'That player cannot be Speaker right now');
  act(g, 0, { type: 'nominate', pid: P(g, 1).id });
  assert.strictEqual(act(g, 3, { type: 'vote', yes: true }).err, 'Not now');
  assert.strictEqual(act(g, 3, { type: 'chat', text: 'hi' }).err, 'The dead stay quiet');
  vote(g, g.alivePlayers().map(p => p.id));   // the six living players are enough to finish the vote
  assert.strictEqual(g.phase, 'voteresult');
  assert.strictEqual(g.voteResult.yes.length + g.voteResult.no.length, 6);
});

test('after three hidden-team bills an elected Speaker who is not the Kingpin is cleared in public', () => {
  const g = setup(5);
  g.enacted.R = 3;
  act(g, 0, { type: 'nominate', pid: P(g, 1).id });
  vote(g, g.alivePlayers().map(p => p.id));
  assert.strictEqual(g.voteResult.cleared, true);
  assert.strictEqual(g.snapshot(P(g, 3).id).players[1].cleared, true);
  assert.ok(g.chat.some(c => /is not the Kingpin/.test(c.text)));
  const g2 = setup(5);
  g2.enacted.R = 2;
  act(g2, 0, { type: 'nominate', pid: P(g2, 1).id });
  vote(g2, g2.alivePlayers().map(p => p.id));
  assert.strictEqual(g2.voteResult.cleared, false, 'before the third bill nobody is cleared');
});

// ---------- legislative session ----------
test('President and Speaker handle the bills, discards go to the pile', () => {
  const g = setup(5);
  g.deck = ['R', 'R', 'D'].concat(g.deck.slice(3));
  elect(g, 1);
  assert.deepStrictEqual(g.cards, ['R', 'R', 'D']);
  assert.strictEqual(act(g, 1, { type: 'pdiscard', i: 0 }).err, 'Not now');
  assert.strictEqual(act(g, 0, { type: 'pdiscard', i: 5 }).err, 'Pick a bill to discard');
  assert.ok(act(g, 0, { type: 'pdiscard', i: 2 }).ok);   // discards the D
  assert.deepStrictEqual(g.discard, ['D']);
  assert.strictEqual(act(g, 0, { type: 'senact', i: 0 }).err, 'Not now');
  assert.ok(act(g, 1, { type: 'senact', i: 1 }).ok);
  assert.strictEqual(g.enacted.R, 1);
  assert.strictEqual(g.discard.length, 2);
  assert.strictEqual(cardsHeld(g), 17);
});
test('the draw pile reshuffles with the discards when it runs low', () => {
  const g = setup(5);
  g.deck = ['R', 'D'];
  g.discard = ['R', 'R', 'R', 'D', 'D', 'R', 'R', 'R', 'R', 'R', 'R', 'R', 'R', 'R', 'R'];
  g.enacted = { D: 0, R: 0 };
  g.ensureDeck(3);
  assert.strictEqual(g.deck.length, 17);
  assert.strictEqual(g.discard.length, 0);
});
test('veto: locked until five hidden-team bills, then President must agree', () => {
  const g = setup(7);
  g.enacted.R = 4;
  g.deck = ['R', 'R', 'R'].concat(g.deck);
  elect(g, 1);
  act(g, 0, { type: 'pdiscard', i: 0 });
  assert.strictEqual(act(g, 1, { type: 'veto' }).err, 'No veto available');
  act(g, 1, { type: 'senact', i: 0 }); holdDone(g);
  if (g.phase === 'power') { g.power = 'exec'; act(g, g.presIdx, { type: 'target', pid: g.powerTargets()[0].id }); }
  assert.strictEqual(g.enacted.R, 5);
  // next government: veto is open
  g.enacted.D = 0;
  g.deck = ['R', 'R', 'R'].concat(g.deck);
  g.lastPres = null; g.lastSpk = null;
  const pi = g.presIdx;
  act(g, pi, { type: 'nominate', pid: g.eligibleList()[0].id });
  const spkId = g.spkId;
  vote(g, g.alivePlayers().map(p => p.id)); holdDone(g);
  act(g, pi, { type: 'pdiscard', i: 0 });
  assert.ok(g.canVeto());
  assert.ok(g.act(spkId, { type: 'veto' }).ok);
  assert.strictEqual(g.phase, 'veto');
  assert.ok(act(g, pi, { type: 'vetoans', yes: false }).ok);
  assert.strictEqual(g.phase, 'legis_spk');
  assert.strictEqual(g.act(spkId, { type: 'veto' }).err, 'No veto available', 'only one veto request per session');
  // a second session: accepted
  g.act(spkId, { type: 'senact', i: 0 }); holdDone(g);
});
test('an agreed veto discards both bills and moves the tracker', () => {
  const g = setup(5);
  g.enacted.R = 5;
  g.deck = ['R', 'R', 'R'].concat(g.deck);
  const total = cardsHeld(g);
  elect(g, 1);
  act(g, 0, { type: 'pdiscard', i: 0 });
  act(g, 1, { type: 'veto' });
  const before = g.discard.length;
  assert.ok(act(g, 0, { type: 'vetoans', yes: true }).ok);
  assert.strictEqual(g.tracker, 1);
  assert.strictEqual(g.discard.length, before + 2);
  assert.strictEqual(g.phase, 'nominate');
  assert.strictEqual(g.presIdx, 1);
  assert.strictEqual(cardsHeld(g), total);
});
test('a veto at tracker 2 triggers chaos', () => {
  const g = setup(5);
  g.enacted.R = 5; g.tracker = 2;
  g.deck = ['R', 'R', 'R', 'D'].concat(g.deck);
  elect(g, 1);
  act(g, 0, { type: 'pdiscard', i: 0 }); act(g, 1, { type: 'veto' }); act(g, 0, { type: 'vetoans', yes: true });
  assert.ok(g.phase === 'enacted' || g.phase === 'gameover');
  assert.strictEqual(g.tracker, 0);
});

// ---------- executive powers ----------
test('power table by table size', () => {
  const w = n => [1, 2, 3, 4, 5, 6].map(k => E.powerFor(n, k));
  assert.deepStrictEqual(w(5), [null, null, 'peek', 'exec', 'exec', null]);
  assert.deepStrictEqual(w(6), [null, null, 'peek', 'exec', 'exec', null]);
  assert.deepStrictEqual(w(7), [null, 'inv', 'special', 'exec', 'exec', null]);
  assert.deepStrictEqual(w(8), [null, 'inv', 'special', 'exec', 'exec', null]);
  assert.deepStrictEqual(w(9), ['inv', 'inv', 'special', 'exec', 'exec', null]);
  assert.deepStrictEqual(w(10), ['inv', 'inv', 'special', 'exec', 'exec', null]);
});
function giveBill(g, spkIdx, bill) {   // run one elected government that enacts `bill`
  g.deck = [bill, bill, bill].concat(g.deck);
  g.lastPres = null; g.lastSpk = null;
  const pi = g.presIdx;
  act(g, pi, { type: 'nominate', pid: P(g, spkIdx).id });
  vote(g, g.alivePlayers().map(p => p.id)); holdDone(g);
  act(g, pi, { type: 'pdiscard', i: 0 });
  g.act(P(g, spkIdx).id, { type: 'senact', i: 0 });
  holdDone(g);
}
test('investigate: only the President learns the party; a player is probed once', () => {
  const g = setup(9);       // first bill investigates
  giveBill(g, 1, 'R');
  assert.strictEqual(g.phase, 'power');
  assert.strictEqual(g.power, 'inv');
  const target = P(g, 8);   // the Kingpin
  assert.ok(act(g, 0, { type: 'target', pid: target.id }).ok);
  assert.strictEqual(g.snapshot(P(g, 0).id).secret.party, 'R', 'the Kingpin shows the hidden party');
  assert.strictEqual(g.snapshot(P(g, 3).id).secret, null);
  assert.deepStrictEqual(g.snapshot(P(g, 0).id).myInv, [{ pid: target.id, party: 'R' }]);
  assert.deepStrictEqual(g.snapshot(P(g, 3).id).myInv, []);
  assert.ok(act(g, 0, { type: 'ack' }).ok);
  assert.strictEqual(g.phase, 'nominate');
  giveBill(g, 3, 'R');      // second bill: investigate again
  assert.strictEqual(g.power, 'inv');
  assert.ok(g.powerTargets().every(p => p.id !== target.id), 'already probed');
  assert.strictEqual(act(g, g.presIdx, { type: 'target', pid: target.id }).err, 'Pick another player');
});
test('a Democrat shows as Democrat when the Republicans are the majority', () => {
  const g = setup(9, ['maj', 'maj', 'maj', 'maj', 'maj', 'min', 'min', 'min', 'king']);
  g.minParty = 'D'; g.majParty = 'R';
  g.deck = ['D'].concat(g.deck.filter(x => x !== 'D' || false)); // enough bills; first one is hidden-party
  g.deck = ['D', 'D', 'D'].concat(['R', 'R', 'R', 'R', 'R', 'R', 'D', 'D', 'D', 'D', 'D', 'D', 'D', 'D']);
  const pi = g.presIdx;
  act(g, pi, { type: 'nominate', pid: P(g, 1).id });
  vote(g, g.alivePlayers().map(p => p.id)); holdDone(g);
  act(g, pi, { type: 'pdiscard', i: 0 }); act(g, 1, { type: 'senact', i: 0 }); holdDone(g);
  assert.strictEqual(g.power, 'inv');
  act(g, 0, { type: 'target', pid: P(g, 2).id });
  assert.strictEqual(g.snapshot(P(g, 0).id).secret.party, 'R');   // a majority member shows as the majority party
});
test('policy peek shows three bills and leaves the deck alone', () => {
  const g = setup(5);
  g.enacted.R = 2;
  giveBill(g, 1, 'R');
  assert.strictEqual(g.power, 'peek');
  const top = g.deck.slice(0, 3);
  assert.deepStrictEqual(g.snapshot(P(g, 0).id).secret.cards, top);
  assert.strictEqual(g.snapshot(P(g, 2).id).secret, null);
  const len = g.deck.length;
  act(g, 0, { type: 'ack' });
  assert.strictEqual(g.deck.length, len);
  assert.deepStrictEqual(g.deck.slice(0, 3), top);
  assert.strictEqual(g.phase, 'nominate');
});
test('special election picks the next President, then the order resumes after the one who called it', () => {
  const g = setup(8);
  g.enacted.R = 2;
  giveBill(g, 1, 'R');      // third bill: special election
  assert.strictEqual(g.power, 'special');
  assert.ok(act(g, 0, { type: 'target', pid: P(g, 5).id }).ok);
  assert.strictEqual(g.phase, 'nominate');
  assert.strictEqual(g.presIdx, 5);
  g.lastPres = null; g.lastSpk = null;
  act(g, 5, { type: 'nominate', pid: g.eligibleList()[0].id });
  vote(g, []); holdDone(g);                       // fails
  assert.strictEqual(g.presIdx, 1, 'order resumes with the seat after the original President');
});
test('execution removes a player; killing the Kingpin ends the game', () => {
  const g = setup(7);
  g.enacted.R = 3;
  giveBill(g, 1, 'R');      // fourth bill: execution
  assert.strictEqual(g.power, 'exec');
  assert.strictEqual(act(g, 0, { type: 'target', pid: P(g, 0).id }).err, 'Pick another player');
  assert.ok(act(g, 0, { type: 'target', pid: P(g, 4).id }).ok);
  assert.strictEqual(P(g, 4).alive, false);
  assert.strictEqual(g.phase, 'nominate');
  assert.strictEqual(g.snapshot(P(g, 0).id).players[4].role, null, 'the role of the dead stays hidden');
  const g2 = setup(7);
  g2.enacted.R = 3;
  giveBill(g2, 1, 'R');
  act(g2, 0, { type: 'target', pid: P(g2, 6).id });
  assert.strictEqual(g2.phase, 'gameover');
  assert.strictEqual(g2.result.winner, 'maj');
});
test('the order skips dead seats', () => {
  const g = setup(7);
  P(g, 1).alive = false;
  act(g, 0, { type: 'nominate', pid: P(g, 2).id });
  vote(g, []); holdDone(g);
  assert.strictEqual(g.presIdx, 2);
});

// ---------- winning ----------
test('five majority bills win', () => {
  const g = setup(5);
  g.enacted.D = 4;
  giveBill(g, 1, 'D');
  assert.strictEqual(g.phase, 'gameover');
  assert.strictEqual(g.result.winner, 'maj');
  assert.strictEqual(g.result.party, 'D');
});
test('six hidden-team bills win', () => {
  const g = setup(5);
  g.enacted.R = 5;
  giveBill(g, 1, 'R');
  assert.strictEqual(g.phase, 'gameover');
  assert.strictEqual(g.result.winner, 'min');
  assert.strictEqual(g.result.party, 'R');
});
test('the Kingpin elected Speaker after three hidden-team bills wins, before that they play on', () => {
  const g = setup(5);        // P4 (index 4) is the Kingpin
  g.enacted.R = 2;
  elect(g, 4);
  assert.strictEqual(g.phase, 'legis_pres', 'two bills: the Kingpin is just a Speaker');
  const g2 = setup(5);
  g2.enacted.R = 3;
  act(g2, 0, { type: 'nominate', pid: P(g2, 4).id });
  vote(g2, g2.alivePlayers().map(p => p.id));
  holdDone(g2);
  assert.strictEqual(g2.phase, 'gameover');
  assert.strictEqual(g2.result.winner, 'min');
});
test('the Kingpin voted down does not win', () => {
  const g = setup(5);
  g.enacted.R = 3;
  act(g, 0, { type: 'nominate', pid: P(g, 4).id });
  vote(g, []);
  holdDone(g);
  assert.strictEqual(g.phase, 'nominate');
});
test('wins are tallied per player and play again resets the table', () => {
  const g = setup(5);
  g.endGame('maj', 'test');
  const t = g.players.map(p => p.tally.wins);
  assert.strictEqual(t.reduce((a, b) => a + b, 0), 3);
  assert.ok(g.act(g.hostId, { type: 'again' }).ok);
  assert.strictEqual(g.phase, 'lobby');
  assert.strictEqual(g.players.length, 5);
  assert.ok(g.players.every(p => p.role === null && p.alive));
  assert.strictEqual(g.players.reduce((a, p) => a + p.tally.games, 0), 5);
});

// ---------- lobby ----------
test('lobby rules: names, seats, bots, host', () => {
  const g = new Game('L', { fast: true });
  assert.strictEqual(g.addHuman('  ', 'a').err, 'Enter your name');
  g.addHuman('Ann', 'a'); g.addHuman('Ann', 'b');
  assert.deepStrictEqual(g.players.map(p => p.name), ['Ann', 'Ann 2']);
  assert.strictEqual(g.act(2, { type: 'size', size: 9 }).err, 'Only the host can do that');
  g.act(1, { type: 'size', size: 3 }); assert.strictEqual(g.size, 5);
  g.act(1, { type: 'size', size: 12 }); assert.strictEqual(g.size, 10);
  g.act(1, { type: 'bots', on: false });
  assert.strictEqual(g.act(1, { type: 'start' }).err, 'Need 5 players. Turn bots on to fill seats.');
  g.act(1, { type: 'bots', on: true }); g.act(1, { type: 'size', size: 6 });
  assert.ok(g.act(1, { type: 'start' }).ok);
  assert.strictEqual(g.players.length, 6);
  assert.strictEqual(g.players.filter(p => p.bot).length, 4);
  assert.strictEqual(g.addHuman('Late', 'z').err, 'That game has already started');
  g.destroy();
});
test('table is capped at ten humans', () => {
  const g = new Game('L', { fast: true });
  for (let i = 0; i < 10; i++) assert.ok(g.addHuman('P' + i, 't' + i).ok);
  assert.strictEqual(g.addHuman('Extra', 'x').err, 'Table is full');
});
test('a removed player is replaced by a bot with the same role', () => {
  const g = setup(5);
  const k = P(g, 2).id === g.hostId ? 3 : 2;
  const role = P(g, k).role;
  assert.ok(g.act(g.hostId, { type: 'kick', pid: P(g, k).id }).ok);
  assert.strictEqual(P(g, k).bot, true);
  assert.strictEqual(P(g, k).role, role);
});

// ---------- timers and bots (async) ----------
atest('bots alone play a whole game to the end at every table size and level', async () => {
  const jobs = [];
  for (let n = 5; n <= 10; n++) {
    ['easy', 'medium', 'hard'].forEach(level => {
      for (let k = 0; k < 4; k++) jobs.push(runGame(n, level));
    });
  }
  const res = await Promise.all(jobs);
  const wins = { maj: 0, min: 0 };
  res.forEach(r => { assert.ok(r.over, 'game ended: ' + r.why); wins[r.winner]++; });
  assert.ok(wins.maj > 0 && wins.min > 0, 'both sides win sometimes: ' + JSON.stringify(wins));
});
function runGame(n, level) {
  return new Promise(resolve => {
    const g = new Game('SIM', { fast: true });
    g.autoMs = 1;
    g.addHuman('Host', 'h');
    g.act(g.hostId, { type: 'size', size: n });
    g.act(g.hostId, { type: 'level', level });
    let steps = 0, done = false;
    const finish = (over, why) => { if (done) return; done = true; clearTimeout(guard); g.destroy(); resolve({ over, why, winner: g.result && g.result.winner }); };
    const guard = setTimeout(() => finish(false, 'timed out in phase ' + g.phase + ' round ' + g.round), 20000);
    g.onChange = () => {
      steps++;
      try {
        assert.strictEqual(cardsHeld(g), 17, 'bill conservation in ' + g.phase);
        const alive = g.alivePlayers().length;
        assert.ok(alive >= n - 3, 'at most three executions');
        g.players.forEach(p => {
          const s = g.snapshot(p.id);
          assert.ok(s.players.length === n);
          if (g.phase === 'vote') s.players.forEach(o => assert.strictEqual(o.vote, null));
        });
      } catch (e) { finish(false, 'invariant: ' + e.message); return; }
      if (g.phase === 'gameover') finish(true);
      if (steps > 4000) finish(false, 'too many steps');
    };
    g.act(g.hostId, { type: 'start' });
    g.setConnected(g.hostId, false);   // the human is away: played for at Medium
  });
}
atest('a human who never looks is readied after the wait', async () => {
  const g = revealTable(5);
  g.autoMs = 30;
  [0, 1, 2, 3].forEach(i => act(g, i, { type: 'ready' }));
  g.setConnected(P(g, 4).id, false);
  assert.strictEqual(g.phase, 'reveal');
  await new Promise(r => setTimeout(r, 700));
  assert.notStrictEqual(g.phase, 'reveal');
  g.destroy();
});
atest('a human who is away is played for after the wait, and gets control back', async () => {
  const g = table(5);
  g.autoMs = 30;
  const first = g.presPlayer();
  assert.strictEqual(g.phase, 'nominate');
  g.setConnected(first.id, false);
  await new Promise(r => setTimeout(r, 700));
  assert.strictEqual(g.phase, 'vote', 'the away President was played for');
  g.setConnected(first.id, true);
  assert.strictEqual(first.bot, false);
  assert.ok(first.role, 'keeps their role');
  g.destroy();
});
atest('the turn timer plays for a human who runs out of time', async () => {
  const g = table(5);
  g.timerSec = 30; g.timerScale = 0.001;     // 30 ms
  g.emit();
  await new Promise(r => setTimeout(r, 800));
  assert.ok(g.phase !== 'nominate', 'timed out and played');
  assert.ok(g.chat.some(c => /Time’s up/.test(c.text)));
  g.destroy();
});
atest('a vote that is only waiting on one away human still finishes', async () => {
  const g = table(5);
  g.autoMs = 30;
  const pi = g.presIdx, away = (pi + 3) % 5;
  assert.ok(act(g, pi, { type: 'nominate', pid: P(g, (pi + 1) % 5).id }).ok);
  P(g, away).connected = false;
  g.emit();
  [0, 1, 2, 3, 4].filter(i => i !== away).forEach(i => act(g, i, { type: 'vote', yes: true }));
  assert.strictEqual(g.phase, 'vote');
  await new Promise(r => setTimeout(r, 700));
  assert.ok(g.phase !== 'vote');
  g.destroy();
});

(async () => {
  for (const [name, fn] of later) {
    try { await fn(); passed++; } catch (e) { failures.push(name + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); }
  }
  console.log(passed + ' passed, ' + failures.length + ' failed');
  failures.forEach(f => console.log('FAIL ' + f));
  process.exit(failures.length ? 1 : 0);
})();
