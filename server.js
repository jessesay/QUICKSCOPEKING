const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

const MAP = {
  width: 1360,
  height: 760,
  obstacles: [
    { x: 395, y: 255, w: 120, h: 200, type: 'service-core' },
    { x: 845, y: 305, w: 120, h: 200, type: 'service-core' },
    { x: 205, y: 125, w: 92, h: 58, type: 'hvac' },
    { x: 640, y: 105, w: 108, h: 58, type: 'hvac' },
    { x: 1065, y: 585, w: 92, h: 58, type: 'hvac' },
    { x: 625, y: 600, w: 108, h: 58, type: 'hvac' },
    { x: 170, y: 555, w: 145, h: 34, type: 'scaffold' },
    { x: 1045, y: 175, w: 145, h: 34, type: 'scaffold' },
    { x: 575, y: 345, w: 148, h: 38, type: 'office-frame' },
    { x: 995, y: 430, w: 148, h: 38, type: 'office-frame' },
    { x: 80, y: 300, w: 165, h: 44, type: 'cargo' },
    { x: 1110, y: 300, w: 165, h: 44, type: 'cargo' },
    { x: 335, y: 615, w: 92, h: 62, type: 'generator' },
    { x: 925, y: 85, w: 92, h: 62, type: 'generator' },
    { x: 515, y: 535, w: 160, h: 34, type: 'solar' },
    { x: 715, y: 195, w: 160, h: 34, type: 'solar' },
    { x: 55, y: 625, w: 115, h: 30, type: 'pipes' },
    { x: 1190, y: 105, w: 115, h: 30, type: 'pipes' }
  ]
};

const SPAWN_PAIRS = [
  [{ x: 95, y: 380, angle: 0 }, { x: 1265, y: 380, angle: Math.PI }],
  [{ x: 225, y: 690, angle: -.42 }, { x: 1125, y: 55, angle: Math.PI - .42 }],
  [{ x: 110, y: 95, angle: .42 }, { x: 1250, y: 665, angle: Math.PI + .42 }],
  [{ x: 470, y: 700, angle: -.18 }, { x: 1080, y: 55, angle: Math.PI - .18 }]
];

const GAME = {
  playerRadius: 13,
  moveSpeed: 225,
  sprintSpeed: 315,
  adsMoveSpeed: 112,
  acceleration: 1500,
  deceleration: 1900,
  shotCooldownMs: 850,
  quickMinMs: 120,
  quickMaxMs: 850,
  headshotPoints: 2,
  maxScore: 3,
  tickRate: 60,
  snapshotRate: 30
};

const STARTING_CREDITS = 1000;
const VALID_WAGERS = new Set([0, 25, 50, 100, 250]);
const players = new Map();
let queue = [];
let championId = null;
let challengerId = null;
let match = null;
let nextGuestNumber = 1;
let latestEffects = [];

function cleanName(raw) {
  const base = String(raw || '').trim().replace(/[^a-zA-Z0-9_ .-]/g, '').slice(0, 18);
  return base || `Scope${nextGuestNumber++}`;
}

function cleanWager(raw, credits) {
  const wager = Math.floor(Number(raw) || 0);
  return VALID_WAGERS.has(wager) && wager <= credits ? wager : 0;
}

function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    state: p.state,
    wins: p.wins,
    losses: p.losses,
    streak: p.streak,
    credits: p.credits,
    wager: p.wager,
    role: p.id === championId ? 'Champion' : p.id === challengerId ? 'Challenger' : p.state
  };
}

function queueList() {
  return queue
    .map((id, index) => {
      const p = players.get(id);
      return p ? { id, name: p.name, wager: p.wager, index: index + 1 } : null;
    })
    .filter(Boolean);
}

function setPlayerState(id, state) {
  const p = players.get(id);
  if (p) p.state = state;
}

function removeFromQueue(id) {
  queue = queue.filter(qid => qid !== id);
}

function enqueue(id) {
  if (!players.has(id)) return;
  if (queue.includes(id)) return;
  if (id === championId || id === challengerId) return;
  queue.push(id);
  setPlayerState(id, 'queued');
}

function safeSpawn(slot, pairIndex = 0) {
  return SPAWN_PAIRS[pairIndex % SPAWN_PAIRS.length][slot === 0 ? 0 : 1];
}

function createCombatant(id, slot, pairIndex = 0) {
  const spawn = safeSpawn(slot, pairIndex);
  return {
    id,
    x: spawn.x,
    y: spawn.y,
    r: GAME.playerRadius,
    angle: spawn.angle,
    pitch: 0,
    vx: 0,
    vy: 0,
    lastShotAt: 0,
    ads: false,
    adsStartAt: 0,
    input: { up: false, down: false, left: false, right: false, sprint: false, angle: spawn.angle, pitch: 0, ads: false },
    alive: true
  };
}

function startMatch(champId, challId) {
  if (!players.has(champId) || !players.has(challId)) return;

  championId = champId;
  challengerId = challId;
  removeFromQueue(champId);
  removeFromQueue(challId);

  setPlayerState(championId, 'playing');
  setPlayerState(challengerId, 'playing');
  const champion = players.get(championId);
  const challenger = players.get(challengerId);
  const wager = champion.wager === challenger.wager ? champion.wager : 0;
  if (champion.credits < wager || challenger.credits < wager) {
    champion.wager = 0;
    challenger.wager = 0;
    challengerId = null;
    enqueue(challId);
    setPlayerState(champId, 'champion_waiting');
    broadcastLobby();
    return;
  }
  champion.credits -= wager;
  challenger.credits -= wager;

  const spawnPair = Math.floor(Math.random() * SPAWN_PAIRS.length);
  match = {
    active: true,
    startedAt: Date.now(),
    round: 1,
    wager,
    pot: wager * 2,
    pausedUntil: 0,
    players: {
      [championId]: createCombatant(championId, 0, spawnPair),
      [challengerId]: createCombatant(challengerId, 1, spawnPair)
    },
    score: {
      [championId]: 0,
      [challengerId]: 0
    },
    log: `${champion.name} is defending the court against ${challenger.name}${wager ? ` for ${wager} credits each` : ''}.`
  };

  io.emit('matchStarted', makeSnapshot());
}

function endMatch(winnerId, loserId, reason = 'won') {
  if (!players.has(winnerId)) return;

  const winner = players.get(winnerId);
  const wager = match?.wager || 0;
  const payout = match?.pot || 0;
  winner.credits += payout;
  winner.wins += 1;
  winner.streak += 1;
  winner.state = 'champion_waiting';

  if (loserId && players.has(loserId)) {
    const loser = players.get(loserId);
    loser.losses += 1;
    loser.streak = 0;
    loser.state = 'queued';
    if (loser.credits < loser.wager) loser.wager = 0;
    removeFromQueue(loserId);
    queue.push(loserId);
  }

  championId = winnerId;
  challengerId = null;
  match = null;

  io.emit('matchEnded', {
    winner: publicPlayer(winner),
    loser: loserId && players.has(loserId) ? publicPlayer(players.get(loserId)) : null,
    reason,
    wager,
    payout,
    queue: queueList()
  });

  setTimeout(matchmake, 1200);
}

function matchmake() {
  queue = queue.filter(id => players.has(id) && id !== championId && id !== challengerId);

  if (match) {
    broadcastLobby();
    return;
  }

  if (championId && !players.has(championId)) championId = null;

  if (!championId) {
    const next = queue.shift();
    if (next && players.has(next)) {
      championId = next;
      setPlayerState(championId, 'champion_waiting');
    }
  }

  if (championId) {
    const champion = players.get(championId);
    const challengerIndex = queue.findIndex(id => players.get(id)?.wager === champion?.wager);
    const nextChallenger = challengerIndex >= 0 ? queue.splice(challengerIndex, 1)[0] : null;
    if (nextChallenger && players.has(nextChallenger)) {
      startMatch(championId, nextChallenger);
      return;
    }
  }

  broadcastLobby();
}

function broadcastLobby() {
  io.emit('lobby', makeSnapshot());
}

function makeSnapshot() {
  const active = match
    ? Object.values(match.players).map(mp => {
        const base = players.get(mp.id);
        return {
          id: mp.id,
          name: base ? base.name : 'Disconnected',
          x: mp.x,
          y: mp.y,
          r: mp.r,
          angle: mp.angle,
          pitch: mp.pitch,
          ads: mp.ads,
          alive: mp.alive,
          score: match.score[mp.id] || 0,
          role: mp.id === championId ? 'Champion' : 'Challenger'
        };
      })
    : [];

  return {
    now: Date.now(),
    map: MAP,
    game: GAME,
    champion: championId && players.has(championId) ? publicPlayer(players.get(championId)) : null,
    challenger: challengerId && players.has(challengerId) ? publicPlayer(players.get(challengerId)) : null,
    queue: queueList(),
    players: [...players.values()].map(publicPlayer),
    match: match
      ? {
          active: true,
          round: match.round,
          maxScore: GAME.maxScore,
          wager: match.wager,
          pot: match.pot,
          pausedUntil: match.pausedUntil,
          log: match.log,
          active
        }
      : null,
    effects: latestEffects.splice(0, latestEffects.length)
  };
}

function pointInRect(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

function collidesObstacle(x, y, radius) {
  return MAP.obstacles.some(o => {
    const closestX = Math.max(o.x, Math.min(x, o.x + o.w));
    const closestY = Math.max(o.y, Math.min(y, o.y + o.h));
    const dx = x - closestX;
    const dy = y - closestY;
    return dx * dx + dy * dy < radius * radius;
  });
}

function moveCombatant(mp, dt) {
  const input = mp.input;
  const now = Date.now();
  const wasAds = mp.ads;
  mp.ads = Boolean(input.ads);
  if (mp.ads && !wasAds) mp.adsStartAt = now;
  if (!mp.ads) mp.adsStartAt = 0;
  mp.angle = Number.isFinite(input.angle) ? input.angle : mp.angle;
  mp.pitch = Number.isFinite(input.pitch) ? Math.max(-0.55, Math.min(0.45, input.pitch)) : mp.pitch;

  const forward = Number(input.up) - Number(input.down);
  const strafe = Number(input.right) - Number(input.left);
  let dx = Math.cos(mp.angle) * forward + Math.cos(mp.angle + Math.PI / 2) * strafe;
  let dy = Math.sin(mp.angle) * forward + Math.sin(mp.angle + Math.PI / 2) * strafe;

  if (dx !== 0 || dy !== 0) {
    const length = Math.hypot(dx, dy);
    dx /= length;
    dy /= length;
  }

  const sprinting = input.sprint && !mp.ads && forward > 0;
  const speed = mp.ads ? GAME.adsMoveSpeed : sprinting ? GAME.sprintSpeed : GAME.moveSpeed;
  const targetVx = dx * speed;
  const targetVy = dy * speed;
  const moving = dx !== 0 || dy !== 0;
  const rate = (moving ? GAME.acceleration : GAME.deceleration) * dt;
  mp.vx += Math.max(-rate, Math.min(rate, targetVx - mp.vx));
  mp.vy += Math.max(-rate, Math.min(rate, targetVy - mp.vy));

  let nx = mp.x + mp.vx * dt;
  let ny = mp.y + mp.vy * dt;

  const boundary = 28;
  nx = Math.max(mp.r + boundary, Math.min(MAP.width - mp.r - boundary, nx));
  ny = Math.max(mp.r + boundary, Math.min(MAP.height - mp.r - boundary, ny));

  if (!collidesObstacle(nx, mp.y, mp.r)) mp.x = nx;
  else mp.vx = 0;
  if (!collidesObstacle(mp.x, ny, mp.r)) mp.y = ny;
  else mp.vy = 0;
}

function distancePointToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const abLen2 = abx * abx + aby * aby;
  if (abLen2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLen2));
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  return Math.hypot(px - cx, py - cy);
}

function rayRectDistance(ax, ay, bx, by, rect) {
  // Sample-based occlusion is simple and reliable enough for this prototype.
  const steps = 120;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    if (pointInRect(x, y, rect)) return Math.hypot(x - ax, y - ay);
  }
  return Infinity;
}

function obstacleHeight(type) {
  return type === 'service-core' ? 118 : type === 'pipes' || type === 'solar' ? 32 : 42;
}

function aimHeightAtDistance(pitch, distance) {
  const canvasWidth = 960;
  const canvasHeight = 540;
  const horizon = canvasHeight * .46 - pitch * canvasHeight * .55;
  const scopedFocal = canvasWidth / (2 * Math.tan(.47 / 2));
  return 42 - (canvasHeight / 2 - horizon) * distance / scopedFocal;
}

function shotBlockedBeforeTarget(ax, ay, bx, by, targetDistance, pitch) {
  return MAP.obstacles.some(o => {
    const hitDistance = rayRectDistance(ax, ay, bx, by, o);
    if (hitDistance >= targetDistance - GAME.playerRadius) return false;
    return aimHeightAtDistance(pitch, hitDistance) <= obstacleHeight(o.type);
  });
}

function resetRound() {
  if (!match || !championId || !challengerId) return;
  match.round += 1;
  match.pausedUntil = Date.now() + 700;
  const spawnPair = Math.floor(Math.random() * SPAWN_PAIRS.length);
  match.players[championId] = createCombatant(championId, 0, spawnPair);
  match.players[challengerId] = createCombatant(challengerId, 1, spawnPair);
}

function handleFire(socket) {
  if (!match || !match.players[socket.id] || match.pausedUntil > Date.now()) return;

  const shooter = match.players[socket.id];
  const targetId = Object.keys(match.players).find(id => id !== socket.id);
  const target = match.players[targetId];
  if (!target || !players.has(socket.id) || !players.has(targetId)) return;

  const now = Date.now();
  if (now - shooter.lastShotAt < GAME.shotCooldownMs) return;
  shooter.lastShotAt = now;

  const adsHeld = shooter.adsStartAt ? now - shooter.adsStartAt : 0;
  const validQuickscope = shooter.ads && adsHeld >= GAME.quickMinMs && adsHeld <= GAME.quickMaxMs;
  const ax = shooter.x + Math.cos(shooter.angle) * 18;
  const ay = shooter.y + Math.sin(shooter.angle) * 18;
  const bx = ax + Math.cos(shooter.angle) * 2600;
  const by = ay + Math.sin(shooter.angle) * 2600;

  const targetDistance = Math.hypot(target.x - ax, target.y - ay);
  const bodyAimDistance = distancePointToSegment(target.x, target.y, ax, ay, bx, by);
  const blocked = shotBlockedBeforeTarget(ax, ay, bx, by, targetDistance, shooter.pitch);
  const horizontallyOnTarget = bodyAimDistance <= target.r + 4;
  const aimHeight = aimHeightAtDistance(shooter.pitch, targetDistance);
  const headshot = validQuickscope && !blocked && horizontallyOnTarget && aimHeight >= 64 && aimHeight <= 82;
  const hit = validQuickscope && !blocked && horizontallyOnTarget && aimHeight >= 5 && aimHeight <= 82;
  const points = headshot ? GAME.headshotPoints : hit ? 1 : 0;

  let reason = 'missed';
  if (!shooter.ads) reason = 'not scoped';
  else if (adsHeld < GAME.quickMinMs) reason = 'too early';
  else if (adsHeld > GAME.quickMaxMs) reason = 'hard scoped';
  else if (blocked) reason = 'blocked';
  else if (!hit) reason = 'wide';

  latestEffects.push({
    type: hit ? 'hit' : 'shot',
    shooterId: socket.id,
    targetId,
    ax,
    ay,
    bx,
    by,
    hit,
    headshot,
    points,
    reason,
    adsHeld
  });

  if (hit) {
    match.score[socket.id] += points;
    const shooterName = players.get(socket.id).name;
    const targetName = players.get(targetId).name;
    match.log = headshot
      ? `${shooterName} headshot ${targetName} for ${points} points with a ${adsHeld}ms quickscope.`
      : `${shooterName} hit ${targetName} with a ${adsHeld}ms quickscope.`;

    if (match.score[socket.id] >= GAME.maxScore) {
      endMatch(socket.id, targetId, 'first to 3');
    } else {
      io.emit('roundWon', {
        winnerId: socket.id,
        loserId: targetId,
        score: match.score,
        adsHeld,
        headshot,
        points
      });
      resetRound();
    }
  } else {
    const shooterName = players.get(socket.id).name;
    match.log = `${shooterName} fired: ${reason}.`;
  }
}

io.on('connection', socket => {
  const tempName = `Scope${nextGuestNumber++}`;
  players.set(socket.id, {
    id: socket.id,
    name: tempName,
    state: 'spectating',
    wins: 0,
    losses: 0,
    streak: 0,
    credits: STARTING_CREDITS,
    wager: 0
  });

  socket.emit('hello', { id: socket.id, name: tempName, snapshot: makeSnapshot() });
  broadcastLobby();

  socket.on('setName', rawName => {
    const p = players.get(socket.id);
    if (!p) return;
    p.name = cleanName(rawName);
    broadcastLobby();
  });

  socket.on('joinQueue', payload => {
    const p = players.get(socket.id);
    if (!p) return;
    const rawName = typeof payload === 'object' ? payload?.name : payload;
    const rawWager = typeof payload === 'object' ? payload?.wager : 0;
    if (rawName) p.name = cleanName(rawName);
    p.wager = cleanWager(rawWager, p.credits);
    enqueue(socket.id);
    matchmake();
  });

  socket.on('leaveQueue', () => {
    const p = players.get(socket.id);
    if (!p) return;
    if (queue.includes(socket.id)) {
      removeFromQueue(socket.id);
      p.state = 'spectating';
    }
    matchmake();
  });

  socket.on('input', input => {
    if (!match || !match.players[socket.id]) return;
    const mp = match.players[socket.id];
    mp.input = {
      up: Boolean(input.up),
      down: Boolean(input.down),
      left: Boolean(input.left),
      right: Boolean(input.right),
      sprint: Boolean(input.sprint),
      ads: Boolean(input.ads),
      angle: Number.isFinite(input.angle) ? input.angle : mp.angle,
      pitch: Number.isFinite(input.pitch) ? input.pitch : mp.pitch
    };
  });

  socket.on('fire', () => handleFire(socket));

  socket.on('disconnect', () => {
    const wasChampion = socket.id === championId;
    const wasChallenger = socket.id === challengerId;
    removeFromQueue(socket.id);
    players.delete(socket.id);

    if (match && (wasChampion || wasChallenger)) {
      const remainingId = Object.keys(match.players).find(id => id !== socket.id && players.has(id));
      if (remainingId) {
        endMatch(remainingId, socket.id, 'opponent disconnected');
      } else {
        match = null;
        championId = null;
        challengerId = null;
      }
    } else {
      if (wasChampion) championId = null;
      if (wasChallenger) challengerId = null;
    }

    matchmake();
  });
});

let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.05, (now - lastTick) / 1000);
  lastTick = now;

  if (match && match.pausedUntil <= now) {
    Object.values(match.players).forEach(mp => moveCombatant(mp, dt));
  }
}, 1000 / GAME.tickRate);

setInterval(() => {
  io.emit('snapshot', makeSnapshot());
}, 1000 / GAME.snapshotRate);

server.listen(PORT, () => {
  console.log(`Quickscope King running at http://localhost:${PORT}`);
});
