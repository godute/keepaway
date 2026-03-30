const BaseGameMode = require('./BaseGameMode');
const { PLAYER_RADIUS } = require('../Player');

const GAME_DURATION = 60;
const SNOWBALL_SPEED = 300;
const SNOWBALL_RADIUS = 10;
const SNOWBALL_LIFETIME = 3;
const FREEZE_DURATION = 3;
const HIT_RADIUS = PLAYER_RADIUS + SNOWBALL_RADIUS + 6; // generous hit box
const { MAP_WIDTH: MAP_W, MAP_HEIGHT: MAP_H } = require('../config');

const MAP_VARIANTS = [
  { id: 'snowfield', obstacles: [
    { x: 200, y: 120, w: 45, h: 35, type: 'rock' },
    { x: 700, y: 400, w: 45, h: 35, type: 'rock' },
    { x: 440, y: 250, w: 40, h: 40, type: 'tree' },
    { x: 150, y: 380, w: 40, h: 40, type: 'bush' },
    { x: 760, y: 140, w: 40, h: 40, type: 'bush' },
    { x: 350, y: 420, w: 45, h: 35, type: 'rock' },
    { x: 560, y: 100, w: 40, h: 40, type: 'tree' },
  ]},
  { id: 'fortress', obstacles: [
    { x: 200, y: 100, w: 20, h: 140, type: 'fence' },
    { x: 200, y: 300, w: 20, h: 140, type: 'fence' },
    { x: 740, y: 100, w: 20, h: 140, type: 'fence' },
    { x: 740, y: 300, w: 20, h: 140, type: 'fence' },
    { x: 350, y: 200, w: 100, h: 20, type: 'fence' },
    { x: 510, y: 320, w: 100, h: 20, type: 'fence' },
    { x: 460, y: 160, w: 40, h: 40, type: 'rock' },
    { x: 460, y: 360, w: 40, h: 40, type: 'rock' },
    { x: 100, y: 260, w: 40, h: 40, type: 'bush' },
    { x: 820, y: 260, w: 40, h: 40, type: 'bush' },
  ]},
  { id: 'frozen_lake', obstacles: [
    { x: 150, y: 150, w: 45, h: 35, type: 'rock' },
    { x: 760, y: 370, w: 45, h: 35, type: 'rock' },
    { x: 460, y: 260, w: 45, h: 35, type: 'rock' },
  ]},
];

class SnowballMode extends BaseGameMode {
  constructor(room) {
    super(room);
    this.mapVariant = MAP_VARIANTS[Math.floor(Math.random() * MAP_VARIANTS.length)];
  }

  init(players, playerOrder) {
    this.timeRemaining = GAME_DURATION;
    this.snowballs = [];
    this.snowballIdCounter = 0;
    this.freezeTimers = new Map();    // playerId -> { timer, x, y }
    this.frozenPositions = new Map(); // playerId -> { x, y }
    this.hitCounts = new Map();
    this.prevDashing = new Map();

    for (const id of playerOrder) {
      this.hitCounts.set(id, 0);
      this.prevDashing.set(id, false);
      const p = players.get(id);
      if (p) p.score = 0;
    }
  }

  tick(dt, players, playerOrder) {
    const events = [];
    this.timeRemaining -= dt;

    // --- Freeze handling: snap frozen players back ---
    for (const [id, data] of this.freezeTimers) {
      data.timer -= dt;
      if (data.timer <= 0) {
        this.freezeTimers.delete(id);
      } else {
        const p = players.get(id);
        if (p) {
          p.x = data.x;
          p.y = data.y;
          p.vx = 0;
          p.vy = 0;
          p.isDashing = false;
          p.dashTimer = 0;
          p.wantsDash = false;
        }
      }
    }

    // --- Detect dash start → spawn snowball ---
    for (const id of playerOrder) {
      const p = players.get(id);
      if (!p) continue;

      const wasDashing = this.prevDashing.get(id) || false;
      this.prevDashing.set(id, p.isDashing);

      // Don't allow frozen players to dash
      if (this.freezeTimers.has(id)) continue;

      if (p.isDashing && !wasDashing) {
        // Get throw direction from dash, then CANCEL the dash (throw only, no movement)
        const len = Math.sqrt(p.dashVx * p.dashVx + p.dashVy * p.dashVy);
        if (len > 0) {
          const dirX = p.dashVx / len;
          const dirY = p.dashVy / len;
          const spawnDist = PLAYER_RADIUS + SNOWBALL_RADIUS + 2;

          const snowball = {
            id: this.snowballIdCounter++,
            x: p.x + dirX * spawnDist,
            y: p.y + dirY * spawnDist,
            vx: dirX * SNOWBALL_SPEED,
            vy: dirY * SNOWBALL_SPEED,
            ownerId: id,
            lifetime: SNOWBALL_LIFETIME,
          };
          this.snowballs.push(snowball);
          events.push({ type: 'snowball_throw', playerId: id, x: snowball.x, y: snowball.y });
        }

        // Cancel dash — player stays in place, only throws
        p.isDashing = false;
        p.dashTimer = 0;
        p.vx = 0;
        p.vy = 0;
        // Reduce cooldown for faster throwing (0.6s instead of 1.2s)
        p.dashCooldown = 0.6;
      }
    }

    // --- Update snowball positions ---
    const obstacles = this.getObstacles() || [];
    const toRemove = new Set();

    for (const sb of this.snowballs) {
      sb.x += sb.vx * dt;
      sb.y += sb.vy * dt;
      sb.lifetime -= dt;

      if (sb.lifetime <= 0) {
        toRemove.add(sb.id);
        continue;
      }

      // Boundary bounce
      if (sb.x < SNOWBALL_RADIUS) { sb.x = SNOWBALL_RADIUS; sb.vx = Math.abs(sb.vx); }
      if (sb.x > MAP_W - SNOWBALL_RADIUS) { sb.x = MAP_W - SNOWBALL_RADIUS; sb.vx = -Math.abs(sb.vx); }
      if (sb.y < SNOWBALL_RADIUS) { sb.y = SNOWBALL_RADIUS; sb.vy = Math.abs(sb.vy); }
      if (sb.y > MAP_H - SNOWBALL_RADIUS) { sb.y = MAP_H - SNOWBALL_RADIUS; sb.vy = -Math.abs(sb.vy); }

      // Obstacle bounce
      for (const obs of obstacles) {
        this._bounceOffObstacle(sb, obs);
      }

      // Player collision
      for (const id of playerOrder) {
        if (id === sb.ownerId) continue;
        if (this.freezeTimers.has(id)) continue; // can't freeze already frozen

        const p = players.get(id);
        if (!p || p.isDashing) continue; // dashing = invincible

        const distSq = this._distSq(sb, p);
        if (distSq < HIT_RADIUS * HIT_RADIUS) {
          // Freeze the target
          this.freezeTimers.set(id, { timer: FREEZE_DURATION, x: p.x, y: p.y });
          const count = (this.hitCounts.get(sb.ownerId) || 0) + 1;
          this.hitCounts.set(sb.ownerId, count);

          const attacker = players.get(sb.ownerId);
          if (attacker) attacker.score = count;

          events.push({
            type: 'snowball_hit',
            attackerId: sb.ownerId,
            victimId: id,
            x: p.x,
            y: p.y,
          });
          toRemove.add(sb.id);
          break;
        }
      }
    }

    // Remove dead snowballs
    this.snowballs = this.snowballs.filter(sb => !toRemove.has(sb.id));

    // --- Win condition: time's up ---
    if (this.timeRemaining <= 0) {
      let winnerId = null;
      let maxHits = 0;
      for (const [id, count] of this.hitCounts) {
        if (count > maxHits) {
          maxHits = count;
          winnerId = id;
        }
      }
      return { events, winner: winnerId };
    }

    return { events, winner: null };
  }

  getState() {
    return {
      snowballs: this.snowballs.map(sb => ({
        id: sb.id,
        x: Math.round(sb.x),
        y: Math.round(sb.y),
        ownerId: sb.ownerId,
      })),
      frozenPlayers: [...this.freezeTimers.keys()],
      hitCounts: Object.fromEntries(this.hitCounts),
      timeRemaining: Math.max(0, Math.round(this.timeRemaining)),
    };
  }

  getStartPayload() {
    return {
      obstacles: this.getObstacles(),
      mapVariant: this.mapVariant.id,
      gameDuration: GAME_DURATION,
    };
  }

  getObstacles() {
    return this.mapVariant.obstacles;
  }

  onPlayerRemoved(socketId) {
    this.freezeTimers.delete(socketId);
    this.hitCounts.delete(socketId);
    this.prevDashing.delete(socketId);
  }

  getScoreList(players, playerOrder) {
    return playerOrder.map(id => {
      const p = players.get(id);
      return { id, name: p?.name || '?', score: this.hitCounts.get(id) || 0 };
    }).sort((a, b) => b.score - a.score);
  }

  _bounceOffObstacle(sb, obs) {
    const closestX = Math.max(obs.x, Math.min(sb.x, obs.x + obs.w));
    const closestY = Math.max(obs.y, Math.min(sb.y, obs.y + obs.h));

    const dx = sb.x - closestX;
    const dy = sb.y - closestY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < SNOWBALL_RADIUS) {
      if (dist === 0) {
        const overlapL = sb.x - obs.x;
        const overlapR = (obs.x + obs.w) - sb.x;
        const overlapT = sb.y - obs.y;
        const overlapB = (obs.y + obs.h) - sb.y;
        const min = Math.min(overlapL, overlapR, overlapT, overlapB);
        if (min === overlapL) { sb.x = obs.x - SNOWBALL_RADIUS; sb.vx = -Math.abs(sb.vx); }
        else if (min === overlapR) { sb.x = obs.x + obs.w + SNOWBALL_RADIUS; sb.vx = Math.abs(sb.vx); }
        else if (min === overlapT) { sb.y = obs.y - SNOWBALL_RADIUS; sb.vy = -Math.abs(sb.vy); }
        else { sb.y = obs.y + obs.h + SNOWBALL_RADIUS; sb.vy = Math.abs(sb.vy); }
      } else {
        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = SNOWBALL_RADIUS - dist;
        sb.x += nx * overlap;
        sb.y += ny * overlap;

        const dot = sb.vx * nx + sb.vy * ny;
        if (dot < 0) {
          sb.vx -= 2 * dot * nx;
          sb.vy -= 2 * dot * ny;
        }
      }
    }
  }

}

module.exports = SnowballMode;
