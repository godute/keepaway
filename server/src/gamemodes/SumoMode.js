const BaseGameMode = require('./BaseGameMode');
const { DASH_HIT_RADIUS } = require('../Player');

const INITIAL_RING_RADIUS = 220;
const SHRINK_DELAY = 10; // seconds before ring starts shrinking
const SHRINK_RATE = 3; // px/sec
const MIN_RING_RADIUS = 80;

const MAP_VARIANTS = [
  { id: 'open', obstacles: null },
  { id: 'pillars', obstacles: [
    { x: 430, y: 200, w: 35, h: 35, type: 'rock' },
    { x: 500, y: 300, w: 35, h: 35, type: 'rock' },
    { x: 380, y: 310, w: 35, h: 35, type: 'rock' },
  ]},
];

class SumoMode extends BaseGameMode {
  constructor(room) {
    super(room);
    this.mapVariant = MAP_VARIANTS[Math.floor(Math.random() * MAP_VARIANTS.length)];
  }

  init(players, playerOrder) {
    this.ringCenter = { x: 480, y: 270 };
    this.ringRadius = INITIAL_RING_RADIUS;
    this.shrinkTimer = SHRINK_DELAY;
    this.eliminatedPlayers = new Set();

    for (const p of players.values()) {
      p.score = 0;
      p.isEliminated = false;
    }
  }

  tick(dt, players, playerOrder) {
    const events = [];

    // Shrink ring after delay
    this.shrinkTimer -= dt;
    if (this.shrinkTimer <= 0 && this.ringRadius > MIN_RING_RADIUS) {
      this.ringRadius = Math.max(MIN_RING_RADIUS, this.ringRadius - SHRINK_RATE * dt);
    }

    // Dash hit: any dashing player can knock back any non-dashing player
    for (const attacker of players.values()) {
      if (!attacker.isDashing || this.eliminatedPlayers.has(attacker.id)) continue;

      for (const victim of players.values()) {
        if (victim.id === attacker.id || this.eliminatedPlayers.has(victim.id)) continue;
        if (this._dist(attacker, victim) < DASH_HIT_RADIUS) {
          victim.applyKnockback(attacker.x, attacker.y);
          events.push({ type: 'sumo_hit', attackerId: attacker.id, victimId: victim.id });
        }
      }
    }

    // Check elimination: outside ring
    const alive = [];
    for (const id of playerOrder) {
      if (this.eliminatedPlayers.has(id)) continue;
      const p = players.get(id);
      if (!p) continue;

      const dist = this._dist(p, this.ringCenter);
      if (dist > this.ringRadius + p.radius) {
        this.eliminatedPlayers.add(id);
        p.isEliminated = true;
        events.push({ type: 'sumo_eliminated', playerId: id });
      } else {
        alive.push(id);
      }
    }

    // Win condition: last one standing
    if (alive.length <= 1 && playerOrder.length >= 2) {
      // Score: eliminated order (last eliminated = higher score)
      const eliminatedOrder = playerOrder.filter(id => this.eliminatedPlayers.has(id));
      eliminatedOrder.forEach((id, idx) => {
        const p = players.get(id);
        if (p) p.score = idx; // earlier elimination = lower score
      });
      if (alive.length === 1) {
        const winner = players.get(alive[0]);
        if (winner) winner.score = playerOrder.length; // highest score
        return { events, winner: alive[0] };
      }
      return { events, winner: null }; // draw
    }

    return { events, winner: null };
  }

  getState() {
    return {
      ringRadius: Math.round(this.ringRadius),
      ringCenter: this.ringCenter,
      eliminatedPlayers: [...this.eliminatedPlayers],
      shrinkActive: this.shrinkTimer <= 0,
    };
  }

  getStartPayload() {
    return {
      obstacles: this.getObstacles(),
      mapVariant: this.mapVariant.id,
      ringRadius: INITIAL_RING_RADIUS,
      ringCenter: this.ringCenter,
    };
  }

  getObstacles() {
    return this.mapVariant.obstacles;
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

  _dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
}

module.exports = SumoMode;
