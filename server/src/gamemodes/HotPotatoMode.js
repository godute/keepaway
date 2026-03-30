const BaseGameMode = require('./BaseGameMode');
const { DASH_HIT_RADIUS } = require('../Player');

const MIN_BOMB_TIME = 12;
const MAX_BOMB_TIME = 22;

const MAP_VARIANTS = [
  { id: 'park', obstacles: [
    { x: 100, y: 60, w: 55, h: 55, type: 'tree' },
    { x: 805, y: 60, w: 55, h: 55, type: 'tree' },
    { x: 100, y: 425, w: 55, h: 55, type: 'tree' },
    { x: 805, y: 425, w: 55, h: 55, type: 'tree' },
    { x: 280, y: 140, w: 45, h: 35, type: 'rock' },
    { x: 640, y: 365, w: 45, h: 35, type: 'rock' },
  ]},
  { id: 'pillars', obstacles: [
    { x: 200, y: 140, w: 45, h: 35, type: 'rock' },
    { x: 460, y: 140, w: 45, h: 35, type: 'rock' },
    { x: 720, y: 140, w: 45, h: 35, type: 'rock' },
    { x: 200, y: 365, w: 45, h: 35, type: 'rock' },
    { x: 460, y: 365, w: 45, h: 35, type: 'rock' },
    { x: 720, y: 365, w: 45, h: 35, type: 'rock' },
  ]},
  { id: 'corners', obstacles: [
    { x: 60, y: 40, w: 55, h: 55, type: 'tree' },
    { x: 140, y: 40, w: 40, h: 40, type: 'bush' },
    { x: 60, y: 120, w: 40, h: 40, type: 'bush' },
    { x: 845, y: 40, w: 55, h: 55, type: 'tree' },
    { x: 765, y: 40, w: 40, h: 40, type: 'bush' },
    { x: 845, y: 120, w: 40, h: 40, type: 'bush' },
    { x: 60, y: 445, w: 55, h: 55, type: 'tree' },
    { x: 140, y: 460, w: 40, h: 40, type: 'bush' },
    { x: 845, y: 445, w: 55, h: 55, type: 'tree' },
    { x: 765, y: 460, w: 40, h: 40, type: 'bush' },
  ]},
];

class HotPotatoMode extends BaseGameMode {
  constructor(room) {
    super(room);
    this.mapVariant = MAP_VARIANTS[Math.floor(Math.random() * MAP_VARIANTS.length)];
  }

  init(players, playerOrder) {
    this.eliminatedPlayers = new Set();
    this.roundNumber = 0;
    this.bombHolderId = null;
    this.bombTimer = 0;
    this.transferCooldown = 0;

    for (const p of players.values()) {
      p.score = 0;
      p.hasBomb = false;
      p.isEliminated = false;
    }

    this._startNewRound(players, playerOrder);
  }

  _startNewRound(players, playerOrder) {
    this.roundNumber++;
    this.bombTimer = MIN_BOMB_TIME + Math.random() * (MAX_BOMB_TIME - MIN_BOMB_TIME);
    this.transferCooldown = 1.0; // Grace period at round start

    // Pick random alive player for bomb
    const alive = playerOrder.filter(id => !this.eliminatedPlayers.has(id));
    if (alive.length === 0) return;

    // Clear previous bomb holder
    if (this.bombHolderId) {
      const prev = players.get(this.bombHolderId);
      if (prev) prev.hasBomb = false;
    }

    const idx = Math.floor(Math.random() * alive.length);
    this.bombHolderId = alive[idx];
    const holder = players.get(this.bombHolderId);
    if (holder) holder.hasBomb = true;
  }

  tick(dt, players, playerOrder) {
    const events = [];

    this.bombTimer -= dt;
    if (this.transferCooldown > 0) this.transferCooldown -= dt;

    // Bomb transfer via dash hit
    if (this.bombHolderId && this.transferCooldown <= 0) {
      const holder = players.get(this.bombHolderId);
      if (holder && holder.isDashing) {
        for (const other of players.values()) {
          if (other.id === this.bombHolderId || this.eliminatedPlayers.has(other.id)) continue;
          if (this._distSq(holder, other) < DASH_HIT_RADIUS * DASH_HIT_RADIUS) {
            // Transfer bomb
            holder.hasBomb = false;
            other.hasBomb = true;
            other.applyKnockback(holder.x, holder.y);
            const oldHolder = this.bombHolderId;
            this.bombHolderId = other.id;
            this.transferCooldown = 0.5; // Brief cooldown after transfer
            events.push({ type: 'bomb_transfer', fromId: oldHolder, toId: other.id });
            break;
          }
        }
      }
    }

    // Bomb explodes
    if (this.bombTimer <= 0 && this.bombHolderId) {
      const victim = players.get(this.bombHolderId);
      if (victim) {
        victim.isEliminated = true;
        victim.hasBomb = false;
        this.eliminatedPlayers.add(this.bombHolderId);
        events.push({ type: 'bomb_explode', playerId: this.bombHolderId });
      }

      // Check alive count
      const alive = playerOrder.filter(id => !this.eliminatedPlayers.has(id));
      if (alive.length <= 1) {
        // Game over - assign scores (survival order)
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

      // Start new round
      this._startNewRound(players, playerOrder);
      events.push({
        type: 'round_start',
        bombHolderId: this.bombHolderId,
        roundNumber: this.roundNumber,
      });
    }

    return { events, winner: null };
  }

  getState() {
    return {
      bombHolderId: this.bombHolderId,
      bombTimerPct: Math.max(0, this.bombTimer / MAX_BOMB_TIME), // rough percentage
      eliminatedPlayers: [...this.eliminatedPlayers],
      roundNumber: this.roundNumber,
    };
  }

  getStartPayload() {
    return { obstacles: this.getObstacles(), mapVariant: this.mapVariant.id };
  }

  getObstacles() {
    return this.mapVariant.obstacles;
  }

  onPlayerRemoved(socketId) {
    this.eliminatedPlayers.add(socketId);
    if (this.bombHolderId === socketId) {
      // Transfer bomb to random alive player
      const alive = [...this.room.players.keys()].filter(
        id => id !== socketId && !this.eliminatedPlayers.has(id)
      );
      if (alive.length > 0) {
        this.bombHolderId = alive[Math.floor(Math.random() * alive.length)];
        const holder = this.room.players.get(this.bombHolderId);
        if (holder) holder.hasBomb = true;
      }
    }
  }

  _distSq(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }
}

module.exports = HotPotatoMode;
