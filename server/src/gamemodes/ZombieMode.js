const BaseGameMode = require('./BaseGameMode');
const { PLAYER_RADIUS, DASH_HIT_RADIUS } = require('../Player');

const GAME_DURATION = 60;
const INFECTION_RADIUS_SQ = (PLAYER_RADIUS * 2 + 4) * (PLAYER_RADIUS * 2 + 4); // ~40px, touch to infect
const INFECTION_COOLDOWN = 0.5;
const ZOMBIE_SPEED = 170;
const PUSH_RADIUS_SQ = DASH_HIT_RADIUS * DASH_HIT_RADIUS;
const STUN_DURATION = 1.5;
const ROAR_RADIUS_SQ = 120 * 120;
const ROAR_SLOW_DURATION = 2.0;
const ROAR_SLOW_FACTOR = 0.5;
const ROAR_COOLDOWN = 5.0;
const MAP_W = 960;
const MAP_H = 540;

const MAP_VARIANTS = [
  { id: 'park', obstacles: [
    { x: 100, y: 60, w: 55, h: 55, type: 'tree' },
    { x: 805, y: 60, w: 55, h: 55, type: 'tree' },
    { x: 100, y: 425, w: 55, h: 55, type: 'tree' },
    { x: 805, y: 425, w: 55, h: 55, type: 'tree' },
    { x: 440, y: 230, w: 80, h: 80, type: 'pond' },
    { x: 280, y: 140, w: 45, h: 35, type: 'rock' },
    { x: 640, y: 365, w: 45, h: 35, type: 'rock' },
    { x: 220, y: 330, w: 90, h: 20, type: 'fence' },
    { x: 650, y: 190, w: 90, h: 20, type: 'fence' },
  ]},
  { id: 'maze', obstacles: [
    { x: 180, y: 100, w: 120, h: 20, type: 'fence' },
    { x: 660, y: 100, w: 120, h: 20, type: 'fence' },
    { x: 380, y: 200, w: 200, h: 20, type: 'fence' },
    { x: 180, y: 320, w: 120, h: 20, type: 'fence' },
    { x: 660, y: 320, w: 120, h: 20, type: 'fence' },
    { x: 380, y: 420, w: 200, h: 20, type: 'fence' },
    { x: 460, y: 260, w: 45, h: 35, type: 'rock' },
  ]},
  { id: 'open', obstacles: [
    { x: 60, y: 60, w: 45, h: 35, type: 'rock' },
    { x: 855, y: 60, w: 45, h: 35, type: 'rock' },
    { x: 60, y: 445, w: 45, h: 35, type: 'rock' },
    { x: 855, y: 445, w: 45, h: 35, type: 'rock' },
    { x: 440, y: 240, w: 40, h: 40, type: 'bush' },
    { x: 300, y: 180, w: 40, h: 40, type: 'tree' },
    { x: 620, y: 340, w: 40, h: 40, type: 'tree' },
  ]},
];

class ZombieMode extends BaseGameMode {
  constructor(room) {
    super(room);
    this.mapVariant = MAP_VARIANTS[Math.floor(Math.random() * MAP_VARIANTS.length)];
  }

  init(players, playerOrder) {
    this.timeRemaining = GAME_DURATION;
    this.zombies = new Set();
    this.infectionCooldowns = new Map();
    this.stunTimers = new Map();      // playerId -> { timer, x, y }
    this.slowTimers = new Map();      // playerId -> timer
    this.roarCooldowns = new Map();   // playerId -> timer
    this.survivalTimes = {};
    this.lastInfectedId = null;

    // Random first zombie
    const firstZombie = playerOrder[Math.floor(Math.random() * playerOrder.length)];
    this.zombies.add(firstZombie);

    for (const id of playerOrder) {
      this.survivalTimes[id] = 0;
      this.roarCooldowns.set(id, 0);
      const p = players.get(id);
      if (p) p.score = 0;
    }
  }

  tick(dt, players, playerOrder) {
    const events = [];
    this.timeRemaining -= dt;

    // --- Zombie processing ---
    const speedRatio = ZOMBIE_SPEED / 220; // 170/220 ≈ 0.77
    for (const zId of this.zombies) {
      const p = players.get(zId);
      if (!p) continue;

      // Cancel dash, use as roar instead
      if (p.isDashing || p.wantsDash) {
        p.isDashing = false;
        p.dashTimer = 0;
        p.wantsDash = false;

        // Trigger roar if cooldown ready
        const cd = this.roarCooldowns.get(zId) || 0;
        if (cd <= 0) {
          this.roarCooldowns.set(zId, ROAR_COOLDOWN);
          for (const sId of playerOrder) {
            if (this.zombies.has(sId)) continue;
            const s = players.get(sId);
            if (!s) continue;
            if (this._distSq(p, s) < ROAR_RADIUS_SQ) {
              this.slowTimers.set(sId, ROAR_SLOW_DURATION);
            }
          }
          events.push({ type: 'zombie_roar', zombieId: zId, x: p.x, y: p.y });
        }
      }

      // Slow zombie: scale velocity down (player.update already set vx/vy at 220px/s)
      p.vx *= speedRatio;
      p.vy *= speedRatio;
    }

    // --- Decrease roar cooldowns ---
    for (const [id, cd] of this.roarCooldowns) {
      if (cd > 0) this.roarCooldowns.set(id, cd - dt);
    }

    // --- Slow processing ---
    for (const [id, timer] of this.slowTimers) {
      if (timer <= 0) {
        this.slowTimers.delete(id);
        continue;
      }
      this.slowTimers.set(id, timer - dt);
      const p = players.get(id);
      if (p && !p.isDashing && !this.zombies.has(id)) {
        const maxSpeed = 220 * ROAR_SLOW_FACTOR; // 110
        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (speed > maxSpeed) {
          const scale = maxSpeed / speed;
          p.vx *= scale;
          p.vy *= scale;
        }
      }
    }

    // --- Stun processing ---
    for (const [id, data] of this.stunTimers) {
      data.timer -= dt;
      if (data.timer <= 0) {
        this.stunTimers.delete(id);
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

    // --- Survival time ---
    for (const id of playerOrder) {
      if (!this.zombies.has(id) && players.has(id)) {
        this.survivalTimes[id] = (this.survivalTimes[id] || 0) + dt;
        const p = players.get(id);
        if (p) p.score = this.survivalTimes[id];
      }
    }

    // --- Infection check: zombie touches survivor ---
    for (const zId of this.zombies) {
      const zombie = players.get(zId);
      if (!zombie) continue;
      if ((this.infectionCooldowns.get(zId) || 0) > 0) continue;

      for (const sId of playerOrder) {
        if (this.zombies.has(sId)) continue;
        const survivor = players.get(sId);
        if (!survivor) continue;
        if (survivor.isDashing) continue; // dashing = immune
        if (this.stunTimers.has(sId)) continue; // already stunned, still vulnerable but skip position check

        if (this._distSq(zombie, survivor) < INFECTION_RADIUS_SQ) {
          // Infect!
          this.zombies.add(sId);
          this.infectionCooldowns.set(sId, INFECTION_COOLDOWN);
          this.lastInfectedId = sId;
          events.push({ type: 'zombie_infection', infectorId: zId, newZombieId: sId, x: survivor.x, y: survivor.y });
          break; // one infection per zombie per tick
        }
      }
    }

    // --- Decrease infection cooldowns ---
    for (const [id, cd] of this.infectionCooldowns) {
      if (cd > 0) this.infectionCooldowns.set(id, cd - dt);
    }

    // --- Survivor push: survivor dashes into another survivor ---
    for (const id of playerOrder) {
      if (this.zombies.has(id)) continue;
      const attacker = players.get(id);
      if (!attacker || !attacker.isDashing) continue;

      for (const otherId of playerOrder) {
        if (otherId === id || this.zombies.has(otherId)) continue;
        const victim = players.get(otherId);
        if (!victim) continue;

        if (this._distSq(attacker, victim) < PUSH_RADIUS_SQ) {
          victim.applyKnockback(attacker.x, attacker.y);
          this.stunTimers.set(otherId, { timer: STUN_DURATION, x: victim.x, y: victim.y });
          events.push({ type: 'zombie_push', attackerId: id, victimId: otherId, x: victim.x, y: victim.y });
          break;
        }
      }
    }

    // --- Win conditions ---
    const survivors = playerOrder.filter(id => !this.zombies.has(id) && players.has(id));

    if (survivors.length === 0 && playerOrder.length >= 3) {
      // All infected — last infected wins (longest survival)
      let winnerId = null;
      let maxTime = 0;
      for (const id of playerOrder) {
        const t = this.survivalTimes[id] || 0;
        if (t > maxTime) { maxTime = t; winnerId = id; }
      }
      return { events, winner: winnerId };
    }

    if (this.timeRemaining <= 0) {
      // Time's up — longest surviving survivor wins
      let winnerId = null;
      let maxTime = 0;
      for (const id of survivors) {
        const t = this.survivalTimes[id] || 0;
        if (t >= maxTime) { maxTime = t; winnerId = id; }
      }
      // If no survivors, pick highest survival time overall
      if (!winnerId) {
        for (const id of playerOrder) {
          const t = this.survivalTimes[id] || 0;
          if (t > maxTime) { maxTime = t; winnerId = id; }
        }
      }
      return { events, winner: winnerId };
    }

    return { events, winner: null };
  }

  getState() {
    return {
      zombies: [...this.zombies],
      stunnedPlayers: [...this.stunTimers.keys()],
      slowedPlayers: [...this.slowTimers.keys()],
      timeRemaining: Math.max(0, Math.round(this.timeRemaining)),
      survivorCount: 0, // computed in renderer from zombies set
      zombieCount: this.zombies.size,
    };
  }

  getStartPayload() {
    return {
      obstacles: this.getObstacles(),
      mapVariant: this.mapVariant.id,
      gameDuration: GAME_DURATION,
      firstZombie: [...this.zombies][0],
    };
  }

  getObstacles() {
    return this.mapVariant.obstacles;
  }

  onPlayerRemoved(socketId) {
    this.zombies.delete(socketId);
    this.stunTimers.delete(socketId);
    this.slowTimers.delete(socketId);
    this.infectionCooldowns.delete(socketId);
    delete this.survivalTimes[socketId];
  }

  getScoreList(players, playerOrder) {
    return playerOrder.map(id => {
      const p = players.get(id);
      const isZombie = this.zombies.has(id);
      return {
        id,
        name: (isZombie ? '🧟 ' : '🏃 ') + (p?.name || '?'),
        score: Math.floor(this.survivalTimes[id] || 0),
      };
    }).sort((a, b) => b.score - a.score);
  }

  _distSq(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }
}

module.exports = ZombieMode;
