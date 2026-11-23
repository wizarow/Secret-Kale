(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Secret Kale: a hidden-role game for 5 to 10 players. Two parties, Democrats (D) and Republicans (R).
  // Each game one party is the hidden team (the one that needs 6 bills); the other is the majority (5 bills).
  // Roles: 'maj' (majority party member), 'min' (hidden team member), 'king' (the Kingpin, on the hidden team).
  var BOT_NAMES = ['Senator', 'Mayor', 'Aide', 'Intern', 'Whip', 'Clerk', 'Chair', 'Page', 'Pundit', 'Staffer'];
  var PARTY = { D: 'Democrat', R: 'Republican' };
  var PARTIES = { D: 'Democrats', R: 'Republicans' };
  var MIN_PLAYERS = 5, MAX_PLAYERS = 10;
  var MAJ_SLOTS = 5, MIN_SLOTS = 6, MAJ_BILLS = 6, MIN_BILLS = 11;
  // [majority members, hidden-team members besides the Kingpin]
  var DIST = { 5: [3, 1], 6: [4, 1], 7: [4, 2], 8: [5, 2], 9: [5, 3], 10: [6, 3] };
  // Executive power unlocked by the 1st to 5th hidden-team bill (the 6th wins the game)
  var POWER_TABLE = {
    small: [null, null, 'peek', 'exec', 'exec'],
    mid: [null, 'inv', 'special', 'exec', 'exec'],
    big: ['inv', 'inv', 'special', 'exec', 'exec']
  };
  var POWER_LABEL = { inv: 'Investigate', peek: 'Peek', special: 'Special election', exec: 'Execution' };
  var VETO_AT = 5;          // hidden-team bills needed before the Speaker may ask for a veto
  var KINGPIN_AT = 3;       // hidden-team bills after which the Kingpin elected Speaker ends the game

  function rnd(n) { return Math.floor(Math.random() * n); }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = rnd(i + 1); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function cleanName(name) {
    return Array.from(String(name || '').replace(/\s+/g, ' ').trim()).slice(0, 16).join('');
  }
  function otherParty(p) { return p === 'D' ? 'R' : 'D'; }
  function powerFor(n, count) {
    var t = n <= 6 ? POWER_TABLE.small : n <= 8 ? POWER_TABLE.mid : POWER_TABLE.big;
    return t[count - 1] || null;
  }
  function pickBy(list, score, high) {
    var best = [], bs = null;
    list.forEach(function (x) {
      var s = score(x);
      if (bs === null || (high ? s > bs : s < bs)) { bs = s; best = [x]; } else if (s === bs) best.push(x);
    });
    return best.length ? best[rnd(best.length)] : null;
  }
  function any(list) { return list[rnd(list.length)]; }

  // ---- Bots ----
  // Every choice is legal. Easy plays at random a lot, Hard almost never does. Bots never talk.
  var NOISE = { easy: 0.4, medium: 0.1, hard: 0.02 };
  function noisy(level) { return Math.random() < (NOISE[level] == null ? NOISE.medium : NOISE[level]); }

  var Bot = {
    sus: function (p, q) {
      var k = p.known && p.known[q.id];
      if (k === 'maj') return -5;
      if (k === 'min') return 10;
      return (p.sus && p.sus[q.id]) || 0;
    },
    nominate: function (g, p, level) {
      var el = g.eligibleList();
      if (!el.length) return null;
      if (noisy(level)) return any(el).id;
      if (p.role === 'min') {
        var king = el.filter(function (x) { return x.role === 'king'; })[0];
        if (king && g.enacted[g.minParty] >= KINGPIN_AT) return king.id;
        var mates = el.filter(function (x) { return x.role !== 'maj'; });
        if (mates.length && Math.random() < 0.5) return any(mates).id;
        var maj = el.filter(function (x) { return x.role === 'maj'; });
        return any(maj.length ? maj : el).id;
      }
      return pickBy(el, function (x) { return Bot.sus(p, x); }, false).id;
    },
    vote: function (g, p, level) {
      var pres = g.presPlayer(), spk = g.byId(g.spkId);
      if (p.id === pres.id || p.id === spk.id) return true;
      if (noisy(level)) return Math.random() < 0.5;
      if (p.role === 'min') {
        if (spk.role === 'king' && g.enacted[g.minParty] >= KINGPIN_AT) return true;
        var team = (pres.role !== 'maj' ? 1 : 0) + (spk.role !== 'maj' ? 1 : 0);
        return Math.random() < (team ? 0.85 : 0.55);
      }
      if (p.role === 'king' && (g.sees(p, pres) || g.sees(p, spk))) return Math.random() < 0.8;
      if (Bot.sus(p, pres) >= 10 || Bot.sus(p, spk) >= 10) return false;
      if (g.tracker >= 2) return true;
      var s = Bot.sus(p, pres) + Bot.sus(p, spk);
      return s < (g.enacted[g.minParty] >= KINGPIN_AT ? 0.9 : 1.6);
    },
    pdiscard: function (g, p, level) {
      var h = g.cards, minC = g.minParty, iMin = [], iMaj = [];
      h.forEach(function (c, i) { (c === minC ? iMin : iMaj).push(i); });
      if (noisy(level)) return rnd(h.length);
      if (p.role === 'min') {
        if (iMaj.length && Math.random() < 0.9) return any(iMaj);
        return any(iMin.length ? iMin : iMaj);
      }
      return any(iMin.length ? iMin : iMaj);
    },
    // { veto: true } or { enact: index }
    spk: function (g, p, level) {
      var h = g.cards, minC = g.minParty, iMin = -1, iMaj = -1;
      h.forEach(function (c, i) { if (c === minC) iMin = i; else iMaj = i; });
      if (noisy(level)) return { enact: rnd(h.length) };
      var winning = g.enacted[minC] === MIN_SLOTS - 1;
      var wantMin = (p.role === 'min' && Math.random() < 0.9) || (p.role !== 'maj' && winning);
      if (wantMin) {
        if (iMin >= 0) return { enact: iMin };
        if (g.canVeto()) return { veto: true };
        return { enact: 0 };
      }
      if (iMaj >= 0) return { enact: iMaj };
      if (g.canVeto()) return { veto: true };
      return { enact: 0 };
    },
    vetoAns: function (g, p, level) {
      var minC = g.minParty;
      var bothMin = g.cards.every(function (c) { return c === minC; });
      var bothMaj = g.cards.every(function (c) { return c !== minC; });
      if (noisy(level)) return Math.random() < 0.5;
      return p.role === 'min' ? bothMaj : bothMin;
    },
    // the target of an investigation, special election or execution
    power: function (g, p, level) {
      var others = g.powerTargets();
      if (!others.length) return null;
      if (noisy(level)) return any(others).id;
      var kind = g.power;
      if (p.role === 'min') {
        var maj = others.filter(function (x) { return x.role === 'maj'; });
        var mates = others.filter(function (x) { return x.role !== 'maj'; });
        if (kind === 'special') return any(mates.length ? mates : others).id;
        return any(maj.length ? maj : others).id;
      }
      if (kind === 'special') return pickBy(others, function (x) { return Bot.sus(p, x); }, false).id;
      return pickBy(others, function (x) { return Bot.sus(p, x); }, true).id;
    }
  };

  function newTally() { return { games: 0, wins: 0 }; }

  function Game(code, opts) {
    opts = opts || {};
    this.code = code;
    this.fast = !!opts.fast;
    this.players = [];
    this.size = 7;
    this.botsOn = true;
    this.phase = 'lobby';   // lobby | nominate | vote | voteresult | legis_pres | legis_spk | veto | enacted | power | gameover
    this.hostId = null;
    this.nextId = 1;
    this.n = 0;
    this.round = 0;
    this.step = 0;
    this.presIdx = 0;
    this.spkId = null;
    this.lastPres = null;
    this.lastSpk = null;
    this.tracker = 0;
    this.specialFrom = null;
    this.majParty = 'D';
    this.minParty = 'R';
    this.deck = [];
    this.discard = [];
    this.enacted = { D: 0, R: 0 };
    this.votes = {};
    this.voteResult = null;
    this.cards = [];
    this.vetoAsked = false;
    this.power = null;
    this.powerStage = null;
    this.secret = null;
    this.invDone = {};
    this.cur = null;
    this.log = [];
    this.result = null;
    this.enactedLast = null;
    this.pendingWin = null;
    this.timerSec = 0;          // 0 = off, else 30/45/60/120
    this.botLevel = 'medium';
    this.timerScale = 1;
    this.timer = null;
    this.timerAt = null;
    this.ttimer = null;
    this.dl = {};
    this.dlStep = -1;
    this.seq = 0;
    this.chat = [];
    this.chatSeq = 0;
    this.closed = false;
    this.touched = Date.now();
    this.onChange = function () {};
    this.onKick = function () {};
  }

  Game.prototype.humans = function () { return this.players.filter(function (p) { return !p.bot; }); };
  Game.prototype.byId = function (id) { return this.players.filter(function (p) { return p.id === id; })[0]; };
  Game.prototype.byToken = function (t) { return t ? this.players.filter(function (p) { return p.token === t; })[0] : undefined; };
  Game.prototype.idxOf = function (id) { for (var i = 0; i < this.players.length; i++) if (this.players[i].id === id) return i; return -1; };
  Game.prototype.alivePlayers = function () { return this.players.filter(function (p) { return p.alive !== false; }); };
  Game.prototype.presPlayer = function () { return this.players[this.presIdx]; };
  Game.prototype.nm = function (id) { var p = this.byId(id); return p ? p.name : '?'; };

  Game.prototype.uniqueName = function (name, exceptId) {
    var base = cleanName(name), n = base, k = 2, self = this;
    var taken = function (x) {
      return self.players.some(function (p) { return p.id !== exceptId && p.name.toLowerCase() === x.toLowerCase(); });
    };
    while (taken(n)) { n = base.slice(0, 14) + ' ' + k; k++; }
    return n;
  };

  Game.prototype.newPlayer = function (name, bot, token) {
    return {
      id: this.nextId++, name: name, bot: bot, token: token || null, connected: true, alive: true,
      role: null, sus: {}, known: {}, tally: newTally(), ready: false, cleared: false
    };
  };

  Game.prototype.addHuman = function (name, token) {
    if (this.phase !== 'lobby') return { err: 'That game has already started' };
    if (this.humans().length >= MAX_PLAYERS) return { err: 'Table is full' };
    if (!cleanName(name)) return { err: 'Enter your name' };
    var p = this.newPlayer(this.uniqueName(name), false, token);
    this.players.push(p);
    if (!this.hostId) this.hostId = p.id;
    if (this.humans().length > this.size) this.size = this.humans().length;
    this.emit();
    return { ok: true, pid: p.id };
  };

  Game.prototype.setConnected = function (pid, v) {
    var p = this.byId(pid);
    if (!p || p.bot || p.connected === v) return;
    p.connected = v;
    this.emit();
  };

  Game.prototype.emit = function () {
    this.touched = Date.now();
    this.seq++;
    this.schedule();
    this.onChange();
  };

  Game.prototype.setPhase = function (ph) { this.phase = ph; this.step++; };

  Game.prototype.reassignHost = function () {
    var h = this.humans().filter(function (p) { return p.connected; })[0] || this.humans()[0];
    this.hostId = h ? h.id : null;
    if (!h) this.closed = true;
  };

  Game.prototype.pushChat = function (pid, name, text, sys) {
    this.chat.push({ id: ++this.chatSeq, pid: pid, name: name, text: text, sys: !!sys });
    if (this.chat.length > 80) this.chat.splice(0, this.chat.length - 80);
  };
  Game.prototype.say = function (text) { this.pushChat(null, '', text, true); };

  // ---------- actions ----------
  Game.prototype.act = function (pid, a) {
    var p = this.byId(pid);
    if (!p || !a) return { err: 'Not in this room' };
    var isHost = pid === this.hostId;
    switch (a.type) {
      case 'rename': {
        if (!cleanName(a.name)) return { err: 'Enter a name' };
        p.name = this.uniqueName(a.name, pid);
        this.emit();
        return { ok: true };
      }
      case 'size': {
        if (!isHost || this.phase !== 'lobby') return { err: 'Only the host can do that' };
        var want = parseInt(a.size, 10);
        if (isNaN(want)) return { err: 'Bad size' };
        this.size = Math.max(MIN_PLAYERS, this.humans().length, Math.min(MAX_PLAYERS, want));
        this.emit();
        return { ok: true };
      }
      case 'bots': {
        if (!isHost || this.phase !== 'lobby') return { err: 'Only the host can do that' };
        this.botsOn = !!a.on;
        this.emit();
        return { ok: true };
      }
      case 'timer': {
        if (!isHost) return { err: 'Only the host can do that' };
        var ts = parseInt(a.sec, 10);
        if ([0, 30, 45, 60, 120].indexOf(ts) < 0) return { err: 'Bad timer' };
        this.timerSec = ts;
        this.emit();
        return { ok: true };
      }
      case 'level': {
        if (!isHost) return { err: 'Only the host can do that' };
        if (['easy', 'medium', 'hard'].indexOf(a.level) < 0) return { err: 'Bad level' };
        this.botLevel = a.level;
        this.emit();
        return { ok: true };
      }
      case 'chat': {
        var text = String(a.text || '').replace(/\s+/g, ' ').trim().slice(0, 160);
        if (!text) return { err: 'Type a message first' };
        if (this.phase !== 'lobby' && this.phase !== 'gameover' && p.alive === false) return { err: 'The dead stay quiet' };
        var now = Date.now();
        if (p.lastChat && now - p.lastChat < 350) return { err: 'Slow down' };
        p.lastChat = now;
        this.pushChat(p.id, p.name, text, false);
        this.emit();
        return { ok: true };
      }
      case 'kick': {
        if (!isHost) return { err: 'Only the host can do that' };
        var t = this.byId(a.pid);
        if (!t || t.bot || t.id === pid) return { err: 'Cannot remove that player' };
        this.removeHuman(t, true);
        return { ok: true };
      }
      case 'leave': {
        this.removeHuman(p, false);
        return { ok: true };
      }
      case 'start': {
        if (!isHost || this.phase !== 'lobby') return { err: 'Only the host can start' };
        var total = this.botsOn ? Math.max(this.size, this.humans().length) : this.humans().length;
        if (total < MIN_PLAYERS) return { err: this.botsOn ? 'Need at least 5 players' : 'Need 5 players. Turn bots on to fill seats.' };
        this.begin();
        return { ok: true };
      }
      case 'ready': return this.doReady(p);
      case 'nominate': return this.doNominate(p, a.pid);
      case 'vote': return this.doVote(p, a.yes);
      case 'pdiscard': return this.doPDiscard(p, a.i);
      case 'senact': return this.doSEnact(p, a.i);
      case 'veto': return this.doVetoReq(p);
      case 'vetoans': return this.doVetoAns(p, a.yes);
      case 'target': return this.doTarget(p, a.pid);
      case 'ack': return this.doAck(p);
      case 'again': {
        if (!isHost || this.phase !== 'gameover') return { err: 'Only the host can do that' };
        this.toLobby();
        return { ok: true };
      }
    }
    return { err: 'Unknown action' };
  };

  Game.prototype.toLobby = function () {
    clearTimeout(this.ttimer); this.ttimer = null;
    this.players = this.players.filter(function (x) { return !x.bot; });
    this.players.forEach(function (x) { x.role = null; x.alive = true; x.sus = {}; x.known = {}; x.ready = false; x.cleared = false; });
    this.n = 0; this.round = 0; this.log = []; this.cur = null; this.result = null; this.enactedLast = null; this.pendingWin = null;
    this.votes = {}; this.voteResult = null; this.cards = []; this.spkId = null; this.power = null; this.powerStage = null; this.secret = null;
    this.invDone = {}; this.tracker = 0; this.specialFrom = null; this.lastPres = null; this.lastSpk = null;
    this.enacted = { D: 0, R: 0 }; this.deck = []; this.discard = [];
    this.setPhase('lobby');
    this.emit();
  };

  Game.prototype.removeHuman = function (t, kicked) {
    var token = t.token;
    if (this.phase === 'lobby') {
      this.players = this.players.filter(function (x) { return x.id !== t.id; });
    } else {
      t.bot = true; t.token = null; t.connected = true;
    }
    if (this.hostId === t.id) this.reassignHost();
    this.onKick(t.id, token, kicked);
    if (!this.humans().length) this.closed = true;
    if (this.phase === 'reveal') { t.ready = true; this.checkReveal(); return; }
    this.emit();
  };

  // ---------- setup ----------
  Game.prototype.begin = function () {
    var humans = this.humans();
    var n = this.botsOn ? Math.max(this.size, humans.length) : humans.length;
    var used = {};
    humans.forEach(function (p) { used[p.name.toLowerCase()] = 1; });
    var pool = shuffle(BOT_NAMES.slice()).filter(function (x) { return !used[x.toLowerCase()]; });
    var bots = [];
    for (var i = 0; i < n - humans.length; i++) {
      bots.push(this.newPlayer(pool[i] || ('Bot ' + (i + 1)), true, null));
    }
    this.players = shuffle(humans.concat(bots));
    this.n = n;
    this.round = 0;
    this.log = [];
    this.result = null;
    this.invDone = {};
    var d = DIST[n];
    var roles = [];
    for (var a = 0; a < d[0]; a++) roles.push('maj');
    for (var b = 0; b < d[1]; b++) roles.push('min');
    roles.push('king');
    shuffle(roles);
    this.players.forEach(function (p, k) { p.role = roles[k]; p.alive = true; p.sus = {}; p.known = {}; });
    this.minParty = Math.random() < 0.5 ? 'D' : 'R';
    this.majParty = otherParty(this.minParty);
    var deck = [], k;
    for (k = 0; k < MAJ_BILLS; k++) deck.push(this.majParty);
    for (k = 0; k < MIN_BILLS; k++) deck.push(this.minParty);
    this.deck = shuffle(deck);
    this.discard = [];
    this.enacted = { D: 0, R: 0 };
    this.tracker = 0;
    this.lastPres = null; this.lastSpk = null; this.specialFrom = null;
    this.presIdx = rnd(n);
    this.players.forEach(function (p) { p.ready = p.bot; p.cleared = false; });
    this.say('Game on. The ' + PARTIES[this.minParty] + ' hide a team this game: they need 6 bills. The ' + PARTIES[this.majParty] + ' need 5.');
    this.say('The Reveal: look at your role in private. The hidden team sees each other.');
    this.setPhase('reveal');
    this.emit();
  };

  // The Reveal (the board game's night phase): the first vote waits until every human has looked at their role.
  Game.prototype.doReady = function (p) {
    if (this.phase !== 'reveal') return { err: 'Not now' };
    if (!p.ready) { p.ready = true; this.checkReveal(); }
    return { ok: true };
  };

  Game.prototype.checkReveal = function () {
    if (this.players.every(function (x) { return x.ready; })) {
      this.say('Everyone has looked. The first vote begins.');
      this.startElection();
    } else this.emit();
  };

  Game.prototype.sees = function (me, p) {
    if (!me || this.phase === 'lobby' || me.id === p.id) return null;
    if (me.role === 'min') return p.role === 'maj' ? null : p.role;
    if (me.role === 'king' && this.n <= 6) return p.role === 'min' ? 'min' : null;
    return null;
  };

  // ---------- election ----------
  Game.prototype.eligibleList = function () {
    var self = this, alive = this.alivePlayers(), presId = this.presPlayer().id;
    return alive.filter(function (p) {
      if (p.id === presId || p.id === self.lastSpk) return false;
      if (alive.length > 5 && p.id === self.lastPres) return false;
      return true;
    });
  };

  Game.prototype.startElection = function () {
    this.round++;
    this.spkId = null; this.votes = {}; this.voteResult = null; this.cards = []; this.vetoAsked = false;
    this.power = null; this.powerStage = null; this.secret = null; this.pendingWin = null;
    var pres = this.presPlayer();
    this.cur = { n: this.round, pres: pres.id, spk: null, yes: [], no: [], passed: null, enacted: null, chaos: false, veto: false, power: null, cards: null };
    this.log.push(this.cur);
    if (this.log.length > 60) this.log.shift();
    this.setPhase('nominate');
    this.emit();
  };

  Game.prototype.doNominate = function (p, tid) {
    if (this.phase !== 'nominate' || this.presPlayer().id !== p.id) return { err: 'Not your turn' };
    var ok = this.eligibleList().some(function (x) { return x.id === tid; });
    if (!ok) return { err: 'That player cannot be Speaker right now' };
    this.spkId = tid;
    this.cur.spk = tid;
    this.votes = {};
    this.say(p.name + ' nominated ' + this.nm(tid) + ' as Speaker. Vote now.');
    this.setPhase('vote');
    this.emit();
    return { ok: true };
  };

  Game.prototype.doVote = function (p, yes) {
    if (this.phase !== 'vote' || p.alive === false) return { err: 'Not now' };
    if (this.votes[p.id] !== undefined) return { err: 'Your vote is already in' };
    if (typeof yes !== 'boolean') return { err: 'Vote Yea or Nay' };
    this.votes[p.id] = yes;
    var self = this;
    if (this.alivePlayers().every(function (x) { return self.votes[x.id] !== undefined; })) this.resolveVote();
    else this.emit();
    return { ok: true };
  };

  Game.prototype.resolveVote = function () {
    var self = this, yes = [], no = [];
    this.players.forEach(function (p) {
      if (p.alive === false) return;
      (self.votes[p.id] ? yes : no).push(p.id);
    });
    var passed = yes.length * 2 > yes.length + no.length;
    this.voteResult = { yes: yes, no: no, passed: passed };
    this.cur.yes = yes; this.cur.no = no; this.cur.passed = passed;
    var spk = this.byId(this.spkId);
    this.pendingWin = null;
    if (passed && spk.role === 'king' && this.enacted[this.minParty] >= KINGPIN_AT) {
      this.pendingWin = { winner: 'min', why: 'The Kingpin was elected Speaker' };
    }
    if (!passed) this.tracker++;
    var cleared = passed && spk.role !== 'king' && this.enacted[this.minParty] >= KINGPIN_AT;
    if (cleared) spk.cleared = true;
    this.voteResult.cleared = !!cleared;
    this.say('Yea ' + yes.length + ', Nay ' + no.length + ': ' + (passed ? 'the government is elected.' : 'voted down. Election tracker ' + this.tracker + ' of 3.') + (cleared ? ' ' + spk.name + ' is not the Kingpin.' : ''));
    this.setPhase('voteresult');
    this.emit();
    this.hold(4500, this.afterVote);
  };

  Game.prototype.hold = function (ms, fn) {
    clearTimeout(this.ttimer);
    var self = this;
    this.ttimer = setTimeout(function () { self.ttimer = null; fn.call(self); }, this.fast ? 1 : ms);
  };

  Game.prototype.afterVote = function () {
    if (this.phase !== 'voteresult') return;
    if (this.voteResult.passed) {
      if (this.pendingWin) { this.endGame(this.pendingWin.winner, this.pendingWin.why); return; }
      this.lastPres = this.presPlayer().id;
      this.lastSpk = this.spkId;
      this.startLegislative();
    } else if (this.tracker >= 3) {
      this.chaos();
    } else {
      this.advanceAndElect();
    }
  };

  // ---------- legislative session ----------
  Game.prototype.ensureDeck = function (k) {
    if (this.deck.length >= k) return;
    this.deck = shuffle(this.deck.concat(this.discard));
    this.discard = [];
  };

  Game.prototype.startLegislative = function () {
    this.ensureDeck(3);
    this.cards = this.deck.splice(0, 3);
    this.cur.cards = { drawn: this.cards.slice(), discardP: null, passed: null, discardS: null, enacted: null, vetoed: false };
    this.vetoAsked = false;
    this.say(this.presPlayer().name + ' is reading three bills.');
    this.setPhase('legis_pres');
    this.emit();
  };

  Game.prototype.doPDiscard = function (p, i) {
    if (this.phase !== 'legis_pres' || this.presPlayer().id !== p.id) return { err: 'Not now' };
    if (typeof i !== 'number' || i % 1 !== 0 || i < 0 || i >= this.cards.length) return { err: 'Pick a bill to discard' };
    var d = this.cards.splice(i, 1)[0];
    this.discard.push(d);
    this.cur.cards.discardP = d;
    this.cur.cards.passed = this.cards.slice();
    this.say(p.name + ' passed two bills to ' + this.nm(this.spkId) + '.');
    this.setPhase('legis_spk');
    this.emit();
    return { ok: true };
  };

  Game.prototype.canVeto = function () {
    return this.enacted[this.minParty] >= VETO_AT && !this.vetoAsked;
  };

  Game.prototype.doSEnact = function (p, i) {
    if (this.phase !== 'legis_spk' || p.id !== this.spkId) return { err: 'Not now' };
    if (typeof i !== 'number' || i % 1 !== 0 || i < 0 || i >= this.cards.length) return { err: 'Pick a bill to enact' };
    var card = this.cards[i], rest = this.cards[1 - i];
    this.discard.push(rest);
    this.cur.cards.discardS = rest;
    this.cur.cards.enacted = card;
    this.enactCard(card, false);
    return { ok: true };
  };

  Game.prototype.doVetoReq = function (p) {
    if (this.phase !== 'legis_spk' || p.id !== this.spkId) return { err: 'Not now' };
    if (!this.canVeto()) return { err: 'No veto available' };
    this.vetoAsked = true;
    this.say(p.name + ' asks to veto the agenda.');
    this.setPhase('veto');
    this.emit();
    return { ok: true };
  };

  Game.prototype.doVetoAns = function (p, yes) {
    if (this.phase !== 'veto' || this.presPlayer().id !== p.id) return { err: 'Not now' };
    if (typeof yes !== 'boolean') return { err: 'Answer Yea or Nay' };
    if (!yes) {
      this.say(p.name + ' refused the veto. The Speaker must enact a bill.');
      this.setPhase('legis_spk');
      this.emit();
      return { ok: true };
    }
    this.cards.forEach(function (c) { this.discard.push(c); }, this);
    this.cur.cards.vetoed = true;
    this.cur.veto = true;
    this.cards = [];
    this.tracker++;
    this.say(p.name + ' agreed to the veto. Both bills are discarded. Election tracker ' + this.tracker + ' of 3.');
    if (this.tracker >= 3) this.chaos();
    else this.advanceAndElect();
    return { ok: true };
  };

  Game.prototype.chaos = function () {
    this.ensureDeck(3);
    var card = this.deck.shift();
    this.lastPres = null; this.lastSpk = null;
    this.say('Chaos. Three failed votes: the top bill is enacted.');
    this.enactCard(card, true);
  };

  Game.prototype.enactCard = function (card, chaos) {
    this.enacted[card]++;
    this.tracker = 0;
    this.cards = [];
    var presId = this.presPlayer().id, spkId = this.spkId;
    this.enactedLast = { party: card, chaos: !!chaos, pres: presId, spk: chaos ? null : spkId };
    this.cur.enacted = card;
    this.cur.chaos = !!chaos;
    if (!chaos) {
      var minC = this.minParty;
      this.players.forEach(function (q) {
        [presId, spkId].forEach(function (id) {
          if (q.id !== id) q.sus[id] = (q.sus[id] || 0) + (card === minC ? 1 : -0.6);
        });
      });
      this.say(this.nm(presId) + ' and ' + this.nm(spkId) + ' enacted a ' + PARTY[card] + ' bill.');
    } else {
      this.say('A ' + PARTY[card] + ' bill is enacted by chaos.');
    }
    this.setPhase('enacted');
    this.emit();
    this.hold(3200, this.afterEnact);
  };

  Game.prototype.afterEnact = function () {
    if (this.phase !== 'enacted') return;
    var card = this.enactedLast.party;
    if (this.enacted[this.majParty] >= MAJ_SLOTS) { this.endGame('maj', 'Five ' + PARTY[this.majParty] + ' bills are enacted'); return; }
    if (this.enacted[this.minParty] >= MIN_SLOTS) { this.endGame('min', 'Six ' + PARTY[this.minParty] + ' bills are enacted'); return; }
    this.ensureDeck(3);
    if (!this.enactedLast.chaos && card === this.minParty) {
      var pw = powerFor(this.n, this.enacted[card]);
      if (pw) { this.beginPower(pw); return; }
    }
    this.advanceAndElect();
  };

  // ---------- executive powers ----------
  Game.prototype.powerTargets = function () {
    var self = this, presId = this.presPlayer().id;
    return this.players.filter(function (p) {
      if (p.alive === false || p.id === presId) return false;
      if (self.power === 'inv' && self.invDone[p.id]) return false;
      return true;
    });
  };

  Game.prototype.beginPower = function (pw) {
    this.power = pw;
    this.secret = null;
    if (pw === 'peek') {
      this.ensureDeck(3);
      this.secret = { kind: 'peek', cards: this.deck.slice(0, 3) };
      this.powerStage = 'view';
    } else {
      this.powerStage = 'pick';
      if (!this.powerTargets().length) { this.say('Nobody is left to ' + POWER_LABEL[pw].toLowerCase() + '. The power is skipped.'); this.advanceAndElect(); return; }
    }
    var pres = this.presPlayer();
    this.cur.power = { kind: pw, target: null };
    this.say(pres.name + ' gets a power: ' + (pw === 'peek' ? 'peek at the next three bills' : pw === 'inv' ? 'investigate a player' : pw === 'special' ? 'call a special election' : 'execute a player') + '.');
    this.setPhase('power');
    this.emit();
  };

  Game.prototype.doTarget = function (p, tid) {
    if (this.phase !== 'power' || this.powerStage !== 'pick' || this.presPlayer().id !== p.id) return { err: 'Not now' };
    var t = this.powerTargets().filter(function (x) { return x.id === tid; })[0];
    if (!t) return { err: 'Pick another player' };
    this.cur.power.target = t.id;
    if (this.power === 'inv') {
      this.invDone[t.id] = true;
      p.known[t.id] = t.role === 'maj' ? 'maj' : 'min';
      this.secret = { kind: 'inv', pid: t.id, party: t.role === 'maj' ? this.majParty : this.minParty };
      this.say(p.name + ' investigated ' + t.name + '.');
      this.powerStage = 'view';
      this.step++;
      this.emit();
      return { ok: true };
    }
    if (this.power === 'special') {
      this.say(p.name + ' called a special election: ' + t.name + ' is the next President.');
      if (this.specialFrom == null) this.specialFrom = this.presIdx;   // the order resumes after the first President, even after a chain of special elections
      this.presIdx = this.idxOf(t.id);
      this.startElection();
      return { ok: true };
    }
    // execution
    t.alive = false;
    if (t.role === 'king') {
      this.say(p.name + ' executed ' + t.name + '.');
      this.endGame('maj', 'The Kingpin was executed');
      return { ok: true };
    }
    this.say(p.name + ' executed ' + t.name + '. They are out of the game.');
    this.advanceAndElect();
    return { ok: true };
  };

  Game.prototype.doAck = function (p) {
    if (this.phase !== 'power' || this.powerStage !== 'view' || this.presPlayer().id !== p.id) return { err: 'Not now' };
    this.advanceAndElect();
    return { ok: true };
  };

  // ---------- turn order ----------
  Game.prototype.nextAliveFrom = function (idx) {
    for (var i = 1; i <= this.n; i++) {
      var j = (idx + i) % this.n;
      if (this.players[j].alive !== false) return j;
    }
    return idx;
  };

  Game.prototype.advanceAndElect = function () {
    if (this.specialFrom != null) { this.presIdx = this.nextAliveFrom(this.specialFrom); this.specialFrom = null; }
    else this.presIdx = this.nextAliveFrom(this.presIdx);
    this.startElection();
  };

  Game.prototype.endGame = function (winner, why) {
    clearTimeout(this.ttimer); this.ttimer = null;
    this.result = { winner: winner, party: winner === 'maj' ? this.majParty : this.minParty, why: why };
    this.players.forEach(function (p) {
      p.tally.games++;
      if ((p.role === 'maj' ? 'maj' : 'min') === winner) p.tally.wins++;
    });
    this.say(why + '. The ' + PARTIES[this.result.party] + ' win.');
    this.setPhase('gameover');
    this.emit();
  };

  // ---------- automatic play (bots, timeouts, dropped players) ----------
  Game.prototype.pendingActors = function () {
    var self = this;
    switch (this.phase) {
      case 'nominate': case 'legis_pres': case 'veto': case 'power': return [this.presPlayer()];
      case 'vote': return this.players.filter(function (p) { return p.alive !== false && self.votes[p.id] === undefined; });
      case 'legis_spk': { var s = this.byId(this.spkId); return s ? [s] : []; }
      case 'reveal': return this.players.filter(function (p) { return !p.ready; });
    }
    return [];
  };

  Game.prototype.botDelay = function () { return 900 + rnd(1500); };

  // One deadline per pending actor: bots soon, a dropped human after 25 s, a human on the turn timer after that many seconds.
  Game.prototype.schedule = function () {
    var self = this, now = Date.now();
    var pend = (this.phase === 'lobby' || this.phase === 'gameover') ? [] : this.pendingActors();
    if (this.dlStep !== this.step) { this.dl = {}; this.dlStep = this.step; }
    var ids = {};
    pend.forEach(function (p) {
      ids[p.id] = 1;
      var mode = p.bot ? 'b' : !p.connected ? 'd' : self.timerSec ? 't' : null;
      if (!mode) { delete self.dl[p.id]; return; }
      var cur = self.dl[p.id];
      if (!cur || cur.mode !== mode) {
        var delay = self.fast ? 1 : mode === 'b' ? self.botDelay() : mode === 'd' ? (self.autoMs || 25000) : self.timerSec * 1000 * self.timerScale;
        if (self.fast && mode === 'd' && self.autoMs) delay = self.autoMs;
        self.dl[p.id] = { mode: mode, at: now + delay };
      }
    });
    Object.keys(this.dl).forEach(function (k) { if (!ids[k]) delete self.dl[k]; });
    var next = null;
    Object.keys(this.dl).forEach(function (k) { if (next === null || self.dl[k].at < next) next = self.dl[k].at; });
    if (next === null) { clearTimeout(this.timer); this.timer = null; this.timerAt = null; return; }
    if (this.timer && this.timerAt === next) return;
    clearTimeout(this.timer);
    this.timerAt = next;
    this.timer = setTimeout(function () { self.fire(); }, Math.max(0, next - now));
  };

  Game.prototype.fire = function () {
    this.timer = null; this.timerAt = null;
    var self = this, now = Date.now(), due = [];
    Object.keys(this.dl).forEach(function (k) { if (self.dl[k].at <= now + 2) due.push({ pid: +k, timed: self.dl[k].mode === 't' }); });
    due.forEach(function (d) { delete self.dl[d.pid]; self.botAct(d.pid, d.timed); });
    this.schedule();
  };

  Game.prototype.botAct = function (pid, timedOut) {
    var p = this.byId(pid);
    if (!p || this.phase === 'lobby' || this.phase === 'gameover') return;
    var level = p.bot ? this.botLevel : 'medium';   // a human who ran out of time (or is away) is played for at Medium
    var acting = this.pendingActors().some(function (x) { return x.id === pid; });
    if (!acting) return;
    if (timedOut && !p.bot) this.say('Time’s up for ' + p.name + ': played automatically.');
    switch (this.phase) {
      case 'reveal': this.doReady(p); return;
      case 'nominate': { var t = Bot.nominate(this, p, level); if (t != null) this.doNominate(p, t); return; }
      case 'vote': this.doVote(p, Bot.vote(this, p, level)); return;
      case 'legis_pres': this.doPDiscard(p, Bot.pdiscard(this, p, level)); return;
      case 'legis_spk': {
        var m = Bot.spk(this, p, level);
        if (m.veto) this.doVetoReq(p); else this.doSEnact(p, m.enact);
        return;
      }
      case 'veto': this.doVetoAns(p, Bot.vetoAns(this, p, level)); return;
      case 'power': {
        if (this.powerStage === 'view') { this.doAck(p); return; }
        var tg = Bot.power(this, p, level);
        if (tg != null) this.doTarget(p, tg);
        return;
      }
    }
  };

  Game.prototype.destroy = function () {
    clearTimeout(this.timer); clearTimeout(this.ttimer);
    this.timer = null; this.ttimer = null;
  };

  // ---------- what each player is allowed to see ----------
  Game.prototype.snapshot = function (pid) {
    var self = this, me = this.byId(pid);
    var inGame = this.phase !== 'lobby';
    var over = this.phase === 'gameover';
    var humans = this.humans();
    var n = inGame ? this.n : (this.botsOn ? Math.max(this.size, humans.length) : humans.length);
    var pres = inGame && this.n ? this.presPlayer() : null;
    var revealVotes = this.phase === 'voteresult' || over;
    var hand = [];
    if (me && pres) {
      if (this.phase === 'legis_pres' && me.id === pres.id) hand = this.cards.slice();
      if ((this.phase === 'legis_spk' || this.phase === 'veto') && (me.id === this.spkId || me.id === pres.id)) hand = this.cards.slice();
    }
    var actors = (inGame && !over) ? this.pendingActors().map(function (x) { return x.id; }) : [];
    var myDl = me && this.dl[me.id] && this.dl[me.id].mode === 't' ? Math.max(0, this.dl[me.id].at - Date.now()) : null;
    var s = {
      code: this.code, phase: this.phase, me: pid, host: this.hostId,
      size: this.size, n: n, round: this.round, botsOn: this.botsOn,
      botCount: inGame ? this.players.filter(function (p) { return p.bot; }).length : (this.botsOn ? Math.max(0, n - humans.length) : 0),
      players: this.players.map(function (p) {
        var vis = self.sees(me, p);
        return {
          id: p.id, name: p.name, bot: p.bot, connected: p.connected, alive: p.alive !== false, tally: p.tally,
          voted: self.phase === 'vote' ? self.votes[p.id] !== undefined : null,
          ready: self.phase === 'reveal' ? !!p.ready : null,
          cleared: !!p.cleared,
          vote: revealVotes && self.votes[p.id] !== undefined ? self.votes[p.id] : null,
          role: over ? p.role : (vis || null),
          limited: inGame && p.alive !== false && (p.id === self.lastSpk || (p.id === self.lastPres && self.alivePlayers().length > 5)),
          probed: !!self.invDone[p.id]
        };
      }),
      majParty: inGame ? this.majParty : null, minParty: inGame ? this.minParty : null,
      enacted: this.enacted, slots: inGame ? (function () { var o = {}; o[self.majParty] = MAJ_SLOTS; o[self.minParty] = MIN_SLOTS; return o; })() : null,
      powers: inGame ? [1, 2, 3, 4, 5].map(function (k) { return powerFor(self.n, k); }) : [],
      tracker: this.tracker, deckN: this.deck.length, discardN: this.discard.length,
      pres: pres ? pres.id : null, spk: this.spkId, lastPres: this.lastPres, lastSpk: this.lastSpk,
      eligible: this.phase === 'nominate' ? this.eligibleList().map(function (x) { return x.id; }) : [],
      actors: actors,
      myRole: me && inGame ? me.role : null,
      myParty: me && inGame ? (me.role === 'maj' ? this.majParty : this.minParty) : null,
      myVote: me && this.phase === 'vote' && this.votes[me.id] !== undefined ? this.votes[me.id] : null,
      vote: revealVotes && this.voteResult ? this.voteResult : null,
      hand: hand, handN: this.cards.length,
      vetoUnlocked: this.enacted[this.minParty] >= VETO_AT, canVeto: this.phase === 'legis_spk' && this.canVeto(),
      power: this.phase === 'power' ? this.power : null, powerStage: this.phase === 'power' ? this.powerStage : null,
      targets: this.phase === 'power' && this.powerStage === 'pick' && pres && me && me.id === pres.id ? this.powerTargets().map(function (x) { return x.id; }) : [],
      secret: this.phase === 'power' && pres && me && me.id === pres.id ? this.secret : null,
      myInv: me && inGame ? Object.keys(me.known).map(function (k) { return { pid: +k, party: me.known[k] === 'maj' ? self.majParty : self.minParty }; }) : [],
      enactedLast: this.phase === 'enacted' ? this.enactedLast : null,
      log: this.log.slice(-40).map(function (e) {
        var o = { n: e.n, pres: e.pres, spk: e.spk, yes: e.yes, no: e.no, passed: e.passed, enacted: e.enacted, chaos: e.chaos, veto: e.veto, power: e.power };
        if (over) o.cards = e.cards;
        return o;
      }),
      result: over ? this.result : null,
      timerSec: this.timerSec, botLevel: this.botLevel, seq: this.seq, turnLeft: myDl,
      chat: this.chat.slice(-50)
    };
    return s;
  };

  return {
    Game: Game, Bot: Bot, PARTY: PARTY, PARTIES: PARTIES, DIST: DIST, POWER_LABEL: POWER_LABEL,
    MIN_PLAYERS: MIN_PLAYERS, MAX_PLAYERS: MAX_PLAYERS, MAJ_SLOTS: MAJ_SLOTS, MIN_SLOTS: MIN_SLOTS,
    MAJ_BILLS: MAJ_BILLS, MIN_BILLS: MIN_BILLS, VETO_AT: VETO_AT, KINGPIN_AT: KINGPIN_AT,
    powerFor: powerFor, cleanName: cleanName, shuffle: shuffle, otherParty: otherParty
  };
});
