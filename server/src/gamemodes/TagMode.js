const BaseGameMode = require('./BaseGameMode');
const { DASH_HIT_RADIUS } = require('../Player');

const GAME_DURATION = 60; // seconds
const TAG_RADIUS = 45; // touch distance to transfer "it"

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
  ]},
];

class TagMode extends BaseGameMode {
  constructor(room) {
    super(room);
    this.mapVariant = MAP_VARIANTS[Math.floor(Math.random() * MAP_VARIANTS.length)];
  }

  init(players, playerOrder) {
    this.timeRemaining = GAME_DURATION;
    this.itTimes = {}; // socketId -> cumulative seconds as "it"
    this.tagCooldown = 0; // prevent instant tag-back

    // Initialize it-times
    for (const id of playerOrder) {
      this.itTimes[id] = 0;
      players.get(id).score = 0;
      players.get(id).isIt = false;
    }

    // Random starting "it"
    const randomIdx = Math.floor(Math.random() * playerOrder.length);
    this.itPlayerId = playerOrder[randomIdx];
    players.get(this.itPlayerId).isIt = true;
  }

  tick(dt, players, playerOrder) {
    const events = [];

    this.timeRemaining -= dt;
    if (this.tagCooldown > 0) this.tagCooldown -= dt;

    // Accumulate it-time
    if (this.itPlayerId && players.has(this.itPlayerId)) {
      this.itTimes[this.itPlayerId] = (this.itTimes[this.itPlayerId] || 0) + dt;
    }

    // Tag detection: "it" player touches anyone
    if (this.itPlayerId && this.tagCooldown <= 0) {
      const itPlayer = players.get(this.itPlayerId);
      if (itPlayer) {
        for (const other of players.values()) {
          if (other.id === this.itPlayerId) continue;
          if (this._dist(itPlayer, other) < TAG_RADIUS) {
            // Transfer "it"
            itPlayer.isIt = false;
            other.isIt = true;
            const oldIt = this.itPlayerId;
            this.itPlayerId = other.id;
            this.tagCooldown = 1.0; // 1 second before new "it" can tag back
            events.push({ type: 'tag_transfer', fromId: oldIt, toId: other.id });
            break;
          }
        }
      }
    }

    // Update scores (inverse of it-time for display: higher = better)
    for (const id of playerOrder) {
      const p = players.get(id);
      if (p) p.score = GAME_DURATION - (this.itTimes[id] || 0);
    }

    // Time's up
    if (this.timeRemaining <= 0) {
      // Winner = least time as "it"
      let winnerId = null;
      let minTime = Infinity;
      for (const id of playerOrder) {
        const t = this.itTimes[id] || 0;
        if (t < minTime) {
          minTime = t;
          winnerId = id;
        }
      }
      return { events, winner: winnerId };
    }

    return { events, winner: null };
  }

  getState() {
    return {
      itPlayerId: this.itPlayerId,
      itTimes: { ...this.itTimes },
      timeRemaining: Math.max(0, Math.round(this.timeRemaining)),
    };
  }

  getStartPayload() {
    return { obstacles: this.getObstacles(), mapVariant: this.mapVariant.id, gameDuration: GAME_DURATION };
  }

  getObstacles() {
    return this.mapVariant.obstacles;
  }

  onPlayerRemoved(socketId) {
    if (this.itPlayerId === socketId) {
      // Transfer "it" to a random remaining player
      const remaining = [...this.room.players.keys()].filter(id => id !== socketId);
      if (remaining.length > 0) {
        this.itPlayerId = remaining[Math.floor(Math.random() * remaining.length)];
        const newIt = this.room.players.get(this.itPlayerId);
        if (newIt) newIt.isIt = true;
      }
    }
    delete this.itTimes[socketId];
  }

  getScoreList(players, playerOrder) {
    // Lower it-time is better
    return playerOrder.map(id => {
      const p = players.get(id);
      const itTime = this.itTimes[id] || 0;
      return { id, name: p.name, score: Math.round(GAME_DURATION - itTime) };
    }).sort((a, b) => b.score - a.score);
  }

  _dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
}

module.exports = TagMode;
