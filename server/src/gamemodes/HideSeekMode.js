const BaseGameMode = require('./BaseGameMode');
const { DASH_HIT_RADIUS } = require('../Player');

const GAME_DURATION = 60;
const HIDE_PHASE_DURATION = 5; // seconds for hiders to hide
const SEEK_RADIUS = 150; // seeker vision radius (sent to client)
const { MAP_WIDTH: MAP_W, MAP_HEIGHT: MAP_H } = require('../config');

const MAP_VARIANTS = [
  { id: 'forest', obstacles: [
    { x: 80, y: 80, w: 50, h: 40, type: 'bush' },
    { x: 250, y: 150, w: 45, h: 35, type: 'rock' },
    { x: 700, y: 80, w: 50, h: 40, type: 'bush' },
    { x: 130, y: 350, w: 50, h: 40, type: 'bush' },
    { x: 440, y: 120, w: 40, h: 40, type: 'tree' },
    { x: 480, y: 380, w: 40, h: 40, type: 'tree' },
    { x: 300, y: 300, w: 50, h: 40, type: 'bush' },
    { x: 620, y: 250, w: 50, h: 40, type: 'bush' },
    { x: 780, y: 350, w: 45, h: 35, type: 'rock' },
    { x: 820, y: 150, w: 50, h: 40, type: 'bush' },
  ]},
  { id: 'maze', obstacles: [
    { x: 200, y: 100, w: 20, h: 160, type: 'fence' },
    { x: 400, y: 0, w: 20, h: 200, type: 'fence' },
    { x: 540, y: 340, w: 20, h: 200, type: 'fence' },
    { x: 740, y: 100, w: 20, h: 160, type: 'fence' },
    { x: 300, y: 280, w: 140, h: 20, type: 'fence' },
    { x: 520, y: 240, w: 140, h: 20, type: 'fence' },
    { x: 100, y: 420, w: 50, h: 40, type: 'bush' },
    { x: 650, y: 80, w: 50, h: 40, type: 'bush' },
    { x: 350, y: 440, w: 50, h: 40, type: 'bush' },
  ]},
  { id: 'ruins', obstacles: [
    { x: 150, y: 120, w: 60, h: 50, type: 'rock' },
    { x: 380, y: 200, w: 60, h: 50, type: 'rock' },
    { x: 600, y: 100, w: 60, h: 50, type: 'rock' },
    { x: 750, y: 300, w: 60, h: 50, type: 'rock' },
    { x: 200, y: 380, w: 60, h: 50, type: 'rock' },
    { x: 500, y: 400, w: 60, h: 50, type: 'rock' },
    { x: 100, y: 250, w: 50, h: 40, type: 'bush' },
    { x: 850, y: 180, w: 50, h: 40, type: 'bush' },
    { x: 440, y: 300, w: 50, h: 40, type: 'bush' },
  ]},
];

class HideSeekMode extends BaseGameMode {
  constructor(room) {
    super(room);
    this.mapVariant = MAP_VARIANTS[Math.floor(Math.random() * MAP_VARIANTS.length)];
  }

  init(players, playerOrder) {
    this.timeRemaining = GAME_DURATION;
    this.hidePhaseTimer = HIDE_PHASE_DURATION;
    this.foundPlayers = new Set();

    // Pick random seeker
    this.seekerId = playerOrder[Math.floor(Math.random() * playerOrder.length)];

    // Position seeker at center, hiders at edges
    for (const id of playerOrder) {
      const p = players.get(id);
      if (!p) continue;
      p.score = 0;
      p.isEliminated = false;

      if (id === this.seekerId) {
        p.x = MAP_W / 2;
        p.y = MAP_H / 2;
      } else {
        // Spread hiders along the edges
        const idx = playerOrder.filter(pid => pid !== this.seekerId).indexOf(id);
        const total = playerOrder.length - 1;
        const angle = (idx / total) * Math.PI * 2;
        p.x = MAP_W / 2 + Math.cos(angle) * 220;
        p.y = MAP_H / 2 + Math.sin(angle) * 170;
      }
    }
  }

  tick(dt, players, playerOrder) {
    const events = [];

    // Hide phase: seeker can't move
    if (this.hidePhaseTimer > 0) {
      this.hidePhaseTimer -= dt;
      const seeker = players.get(this.seekerId);
      if (seeker) {
        seeker.vx = 0;
        seeker.vy = 0;
        seeker.dx = 0;
        seeker.dy = 0;
        seeker.isDashing = false;
        seeker.wantsDash = false;
      }
      return { events, winner: null };
    }

    this.timeRemaining -= dt;

    // Seeker dash-hit detection
    const seeker = players.get(this.seekerId);
    if (seeker && seeker.isDashing) {
      for (const id of playerOrder) {
        if (id === this.seekerId || this.foundPlayers.has(id)) continue;
        const hider = players.get(id);
        if (!hider) continue;

        if (this._distSq(seeker, hider) < DASH_HIT_RADIUS * DASH_HIT_RADIUS) {
          this.foundPlayers.add(id);
          hider.isEliminated = true;
          events.push({ type: 'hideseek_found', seekerId: this.seekerId, hiderId: id });
        }
      }
    }

    // Count remaining hiders
    const aliveHiders = playerOrder.filter(id =>
      id !== this.seekerId && !this.foundPlayers.has(id) && players.has(id)
    );

    // Update scores: seeker gets points per found, hiders get survival time
    if (seeker) seeker.score = this.foundPlayers.size * 10;
    for (const id of playerOrder) {
      if (id === this.seekerId) continue;
      const p = players.get(id);
      if (!p) continue;
      if (!this.foundPlayers.has(id)) {
        p.score += dt; // survival time as score
      }
    }

    // Win: all hiders found → seeker wins
    if (aliveHiders.length === 0 && playerOrder.length >= 2) {
      return { events, winner: this.seekerId };
    }

    // Win: time up → last surviving hider with most time wins
    if (this.timeRemaining <= 0) {
      let bestHider = null;
      let bestScore = -1;
      for (const id of playerOrder) {
        if (id === this.seekerId) continue;
        const p = players.get(id);
        if (p && p.score > bestScore) {
          bestScore = p.score;
          bestHider = id;
        }
      }
      return { events, winner: bestHider };
    }

    return { events, winner: null };
  }

  getState() {
    return {
      seekerId: this.seekerId,
      foundPlayers: [...this.foundPlayers],
      timeRemaining: Math.max(0, Math.round(this.timeRemaining)),
      hidePhaseTimer: Math.max(0, Math.ceil(this.hidePhaseTimer)),
      seekRadius: SEEK_RADIUS,
    };
  }

  getStartPayload() {
    return {
      obstacles: this.getObstacles(),
      mapVariant: this.mapVariant.id,
      seekerId: this.seekerId,
      seekRadius: SEEK_RADIUS,
      gameDuration: GAME_DURATION,
      hidePhase: HIDE_PHASE_DURATION,
    };
  }

  getObstacles() {
    return this.mapVariant.obstacles;
  }

  onPlayerRemoved(socketId) {
    this.foundPlayers.add(socketId);
  }

  getScoreList(players, playerOrder) {
    return playerOrder.map(id => {
      const p = players.get(id);
      const isSeeker = id === this.seekerId;
      return {
        id,
        name: (isSeeker ? '👁 ' : '') + (p?.name || '?'),
        score: Math.floor(p?.score || 0),
      };
    }).sort((a, b) => b.score - a.score);
  }

}

module.exports = HideSeekMode;
