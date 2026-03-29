const BaseGameMode = require('./BaseGameMode');
const { PLAYER_RADIUS } = require('../Player');

const BALL_RADIUS = 10;
const BALL_SPEED_BASE = 150;
const BALL_SPEED_INCREMENT = 8;
const SPAWN_INTERVAL_BASE = 4; // seconds
const SPAWN_INTERVAL_MIN = 2;
const MAX_BALLS = 8;
const HIT_RADIUS = PLAYER_RADIUS + BALL_RADIUS;
const MAP_W = 960;
const MAP_H = 540;

const MAP_VARIANTS = [
  { id: 'park', obstacles: [
    { x: 100, y: 60, w: 55, h: 55, type: 'tree' },
    { x: 805, y: 60, w: 55, h: 55, type: 'tree' },
    { x: 100, y: 425, w: 55, h: 55, type: 'tree' },
    { x: 805, y: 425, w: 55, h: 55, type: 'tree' },
    { x: 280, y: 140, w: 45, h: 35, type: 'rock' },
    { x: 640, y: 365, w: 45, h: 35, type: 'rock' },
  ]},
  { id: 'bunkers', obstacles: [
    { x: 150, y: 130, w: 45, h: 35, type: 'rock' },
    { x: 765, y: 130, w: 45, h: 35, type: 'rock' },
    { x: 150, y: 375, w: 45, h: 35, type: 'rock' },
    { x: 765, y: 375, w: 45, h: 35, type: 'rock' },
    { x: 440, y: 200, w: 45, h: 35, type: 'rock' },
    { x: 480, y: 310, w: 45, h: 35, type: 'rock' },
    { x: 300, y: 260, w: 45, h: 35, type: 'rock' },
    { x: 620, y: 260, w: 45, h: 35, type: 'rock' },
  ]},
  { id: 'open', obstacles: [] },
];

class DodgeballMode extends BaseGameMode {
  constructor(room) {
    super(room);
    this.mapVariant = MAP_VARIANTS[Math.floor(Math.random() * MAP_VARIANTS.length)];
  }

  init(players, playerOrder) {
    this.balls = [];
    this.eliminatedPlayers = new Set();
    this.ballIdCounter = 0;
    this.gameTime = 0;
    this.spawnTimer = 2; // first ball after 2 seconds

    for (const p of players.values()) {
      p.score = 0;
      p.isEliminated = false;
    }
  }

  tick(dt, players, playerOrder) {
    const events = [];
    this.gameTime += dt;

    // --- Spawn balls ---
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.balls.length < MAX_BALLS) {
      const ball = this._spawnBall(players);
      if (ball) {
        this.balls.push(ball);
        events.push({ type: 'ball_spawn', ball: { id: ball.id, x: Math.round(ball.x), y: Math.round(ball.y) } });
      }
      this.spawnTimer = Math.max(SPAWN_INTERVAL_MIN, SPAWN_INTERVAL_BASE - this.gameTime * 0.04);
    }

    // --- Dash hit: knockback between players ---
    for (const attacker of players.values()) {
      if (!attacker.isDashing || this.eliminatedPlayers.has(attacker.id)) continue;
      for (const victim of players.values()) {
        if (victim.id === attacker.id || this.eliminatedPlayers.has(victim.id)) continue;
        if (victim.isDashing) continue; // both dashing = no hit
        if (this._dist(attacker, victim) < PLAYER_RADIUS * 2 + 2) {
          victim.applyKnockback(attacker.x, attacker.y);
          events.push({ type: 'dodgeball_push', attackerId: attacker.id, victimId: victim.id });
        }
      }
    }

    // --- Move balls ---
    for (const ball of this.balls) {
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;

      // Boundary bounce
      if (ball.x - BALL_RADIUS < 0) { ball.x = BALL_RADIUS; ball.vx = Math.abs(ball.vx); }
      if (ball.x + BALL_RADIUS > MAP_W) { ball.x = MAP_W - BALL_RADIUS; ball.vx = -Math.abs(ball.vx); }
      if (ball.y - BALL_RADIUS < 0) { ball.y = BALL_RADIUS; ball.vy = Math.abs(ball.vy); }
      if (ball.y + BALL_RADIUS > MAP_H) { ball.y = MAP_H - BALL_RADIUS; ball.vy = -Math.abs(ball.vy); }

      // Obstacle bounce
      for (const obs of (this.getObstacles() || [])) {
        this._bounceBallOffObstacle(ball, obs);
      }
    }

    // --- Hit detection ---
    const ballsToRemove = new Set();
    for (const ball of this.balls) {
      for (const id of playerOrder) {
        if (this.eliminatedPlayers.has(id)) continue;
        const p = players.get(id);
        if (!p || p.isDashing) continue; // dashing = invincible

        const dx = p.x - ball.x;
        const dy = p.y - ball.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < HIT_RADIUS) {
          this.eliminatedPlayers.add(id);
          p.isEliminated = true;
          ballsToRemove.add(ball.id);
          events.push({ type: 'dodgeball_hit', playerId: id, ballId: ball.id, x: Math.round(p.x), y: Math.round(p.y) });
          break;
        }
      }
    }
    this.balls = this.balls.filter(b => !ballsToRemove.has(b.id));

    // --- Win check ---
    const alive = playerOrder.filter(id => !this.eliminatedPlayers.has(id));
    if (alive.length <= 1 && playerOrder.length >= 2) {
      const eliminated = playerOrder.filter(id => this.eliminatedPlayers.has(id));
      eliminated.forEach((id, idx) => {
        const p = players.get(id);
        if (p) p.score = idx;
      });
      if (alive.length === 1) {
        const winner = players.get(alive[0]);
        if (winner) winner.score = playerOrder.length;
        return { events, winner: alive[0] };
      }
      return { events, winner: null };
    }

    return { events, winner: null };
  }

  getState() {
    return {
      balls: this.balls.map(b => ({ id: b.id, x: Math.round(b.x), y: Math.round(b.y) })),
      eliminatedPlayers: [...this.eliminatedPlayers],
    };
  }

  getStartPayload() {
    return { obstacles: this.getObstacles(), mapVariant: this.mapVariant.id };
  }

  getObstacles() {
    return this.mapVariant.obstacles.length > 0 ? this.mapVariant.obstacles : null;
  }

  onPlayerRemoved(socketId) {
    this.eliminatedPlayers.add(socketId);
  }

  getScoreList(players, playerOrder) {
    return playerOrder.map(id => {
      const p = players.get(id);
      return { id, name: p.name, score: Math.floor(p.score) };
    }).sort((a, b) => b.score - a.score);
  }

  // --- Internal helpers ---

  _spawnBall(players) {
    const speed = BALL_SPEED_BASE + this.ballIdCounter * BALL_SPEED_INCREMENT;
    for (let attempt = 0; attempt < 20; attempt++) {
      const x = 60 + Math.random() * (MAP_W - 120);
      const y = 60 + Math.random() * (MAP_H - 120);

      // Check distance from all alive players
      let tooClose = false;
      for (const p of players.values()) {
        if (p.isEliminated) continue;
        if (this._dist({ x, y }, p) < 100) { tooClose = true; break; }
      }
      if (tooClose) continue;

      // Check not inside obstacle
      let inObstacle = false;
      for (const obs of (this.getObstacles() || [])) {
        if (x > obs.x - BALL_RADIUS && x < obs.x + obs.w + BALL_RADIUS &&
            y > obs.y - BALL_RADIUS && y < obs.y + obs.h + BALL_RADIUS) {
          inObstacle = true; break;
        }
      }
      if (inObstacle) continue;

      const angle = Math.random() * Math.PI * 2;
      return {
        id: ++this.ballIdCounter,
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        speed,
      };
    }
    // Fallback: spawn at center
    const angle = Math.random() * Math.PI * 2;
    return {
      id: ++this.ballIdCounter,
      x: MAP_W / 2, y: MAP_H / 2,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      speed,
    };
  }

  _bounceBallOffObstacle(ball, obs) {
    const closestX = Math.max(obs.x, Math.min(ball.x, obs.x + obs.w));
    const closestY = Math.max(obs.y, Math.min(ball.y, obs.y + obs.h));

    const dx = ball.x - closestX;
    const dy = ball.y - closestY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < BALL_RADIUS) {
      if (dist === 0) {
        // Inside obstacle — push out shortest direction and reflect
        const overlapL = ball.x - obs.x;
        const overlapR = (obs.x + obs.w) - ball.x;
        const overlapT = ball.y - obs.y;
        const overlapB = (obs.y + obs.h) - ball.y;
        const min = Math.min(overlapL, overlapR, overlapT, overlapB);
        if (min === overlapL) { ball.x = obs.x - BALL_RADIUS; ball.vx = -Math.abs(ball.vx); }
        else if (min === overlapR) { ball.x = obs.x + obs.w + BALL_RADIUS; ball.vx = Math.abs(ball.vx); }
        else if (min === overlapT) { ball.y = obs.y - BALL_RADIUS; ball.vy = -Math.abs(ball.vy); }
        else { ball.y = obs.y + obs.h + BALL_RADIUS; ball.vy = Math.abs(ball.vy); }
      } else {
        // Push out and reflect velocity along normal
        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = BALL_RADIUS - dist;
        ball.x += nx * overlap;
        ball.y += ny * overlap;

        // Reflect velocity
        const dot = ball.vx * nx + ball.vy * ny;
        if (dot < 0) {
          ball.vx -= 2 * dot * nx;
          ball.vy -= 2 * dot * ny;
        }
      }
    }
  }

  _dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
}

module.exports = DodgeballMode;
