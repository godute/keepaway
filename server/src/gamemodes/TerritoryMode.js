const BaseGameMode = require('./BaseGameMode');
const { DASH_HIT_RADIUS } = require('../Player');

const GAME_DURATION = 60;
const TILE_SIZE = 20;
const MAP_W = 960;
const MAP_H = 540;
const GRID_W = Math.floor(MAP_W / TILE_SIZE); // 48
const GRID_H = Math.floor(MAP_H / TILE_SIZE); // 27
const DASH_CLAIM_RADIUS = 3; // tiles around dash path to claim

const MAP_VARIANTS = [
  { id: 'open', obstacles: [
    { x: 440, y: 240, w: 40, h: 40, type: 'tree' },
    { x: 200, y: 150, w: 45, h: 35, type: 'rock' },
    { x: 700, y: 350, w: 45, h: 35, type: 'rock' },
    { x: 150, y: 400, w: 40, h: 40, type: 'bush' },
    { x: 750, y: 120, w: 40, h: 40, type: 'bush' },
  ]},
  { id: 'divided', obstacles: [
    { x: 470, y: 40, w: 20, h: 160, type: 'fence' },
    { x: 470, y: 340, w: 20, h: 160, type: 'fence' },
    { x: 140, y: 260, w: 260, h: 20, type: 'fence' },
    { x: 560, y: 260, w: 260, h: 20, type: 'fence' },
    { x: 240, y: 130, w: 40, h: 40, type: 'tree' },
    { x: 680, y: 130, w: 40, h: 40, type: 'tree' },
    { x: 240, y: 380, w: 40, h: 40, type: 'tree' },
    { x: 680, y: 380, w: 40, h: 40, type: 'tree' },
    { x: 460, y: 240, w: 45, h: 35, type: 'rock' },
  ]},
  { id: 'scattered', obstacles: [
    { x: 200, y: 120, w: 45, h: 35, type: 'rock' },
    { x: 700, y: 120, w: 45, h: 35, type: 'rock' },
    { x: 200, y: 385, w: 45, h: 35, type: 'rock' },
    { x: 700, y: 385, w: 45, h: 35, type: 'rock' },
    { x: 440, y: 180, w: 40, h: 40, type: 'bush' },
    { x: 480, y: 320, w: 40, h: 40, type: 'bush' },
    { x: 340, y: 260, w: 40, h: 40, type: 'bush' },
    { x: 580, y: 260, w: 40, h: 40, type: 'bush' },
    { x: 100, y: 260, w: 40, h: 40, type: 'tree' },
    { x: 820, y: 260, w: 40, h: 40, type: 'tree' },
    { x: 460, y: 60, w: 45, h: 35, type: 'rock' },
    { x: 460, y: 440, w: 45, h: 35, type: 'rock' },
  ]},
];

class TerritoryMode extends BaseGameMode {
  constructor(room) {
    super(room);
    this.mapVariant = MAP_VARIANTS[Math.floor(Math.random() * MAP_VARIANTS.length)];
  }

  init(players, playerOrder) {
    this.timeRemaining = GAME_DURATION;
    // Grid: flat array, null = unclaimed, string = socketId of owner
    this.grid = new Array(GRID_W * GRID_H).fill(null);
    this.tileCounts = {};
    this.changedTiles = []; // Delta for this tick
    this.fullSyncTimer = 0;

    for (const id of playerOrder) {
      this.tileCounts[id] = 0;
      const p = players.get(id);
      if (p) p.score = 0;
    }
  }

  tick(dt, players, playerOrder) {
    const events = [];
    this.timeRemaining -= dt;
    this.changedTiles = [];

    // Paint tiles under each player
    for (const p of players.values()) {
      const tx = Math.floor(p.x / TILE_SIZE);
      const ty = Math.floor(p.y / TILE_SIZE);

      if (p.isDashing) {
        // Dash paints a wider area
        for (let dx = -DASH_CLAIM_RADIUS; dx <= DASH_CLAIM_RADIUS; dx++) {
          for (let dy = -DASH_CLAIM_RADIUS; dy <= DASH_CLAIM_RADIUS; dy++) {
            if (dx * dx + dy * dy > DASH_CLAIM_RADIUS * DASH_CLAIM_RADIUS) continue;
            this._claimTile(tx + dx, ty + dy, p.id);
          }
        }
      } else {
        // Normal movement paints 1 tile
        this._claimTile(tx, ty, p.id);
        // Also paint adjacent tile for wider trail
        this._claimTile(tx + (p.dx > 0 ? 1 : p.dx < 0 ? -1 : 0), ty, p.id);
        this._claimTile(tx, ty + (p.dy > 0 ? 1 : p.dy < 0 ? -1 : 0), p.id);
      }
    }

    // Dash knockback (any player can hit any other)
    for (const attacker of players.values()) {
      if (!attacker.isDashing) continue;
      for (const victim of players.values()) {
        if (victim.id === attacker.id) continue;
        if (this._distSq(attacker, victim) < DASH_HIT_RADIUS * DASH_HIT_RADIUS) {
          victim.applyKnockback(attacker.x, attacker.y);
        }
      }
    }

    // Update scores (tileCounts updated incrementally in _claimTile)
    for (const id of playerOrder) {
      const p = players.get(id);
      if (p) p.score = this.tileCounts[id] || 0;
    }

    // Time's up
    if (this.timeRemaining <= 0) {
      let winnerId = null;
      let maxTiles = 0;
      for (const id of playerOrder) {
        const count = this.tileCounts[id] || 0;
        if (count > maxTiles) {
          maxTiles = count;
          winnerId = id;
        }
      }
      return { events, winner: winnerId };
    }

    return { events, winner: null };
  }

  _claimTile(tx, ty, ownerId) {
    if (tx < 0 || tx >= GRID_W || ty < 0 || ty >= GRID_H) return;
    const idx = ty * GRID_W + tx;
    const prev = this.grid[idx];
    if (prev !== ownerId) {
      // Incremental count update
      if (prev && this.tileCounts[prev] !== undefined) this.tileCounts[prev]--;
      if (this.tileCounts[ownerId] !== undefined) this.tileCounts[ownerId]++;
      this.grid[idx] = ownerId;
      this.changedTiles.push({ x: tx, y: ty, owner: ownerId });
    }
  }

  getState() {
    // Send delta tiles (changed this tick)
    // Every 2 seconds, send a compressed full grid snapshot
    this.fullSyncTimer = (this.fullSyncTimer || 0) + (1 / 60);
    const state = {
      changedTiles: this.changedTiles,
      tileCounts: { ...this.tileCounts },
      timeRemaining: Math.max(0, Math.round(this.timeRemaining)),
      tileSize: TILE_SIZE,
      gridW: GRID_W,
      gridH: GRID_H,
    };

    if (this.fullSyncTimer >= 2) {
      this.fullSyncTimer = 0;
      // Compress grid: run-length encode
      state.fullGrid = this._compressGrid();
    }

    return state;
  }

  _compressGrid() {
    // Simple compression: array of [owner, count] runs
    const runs = [];
    let current = this.grid[0];
    let count = 1;
    for (let i = 1; i < this.grid.length; i++) {
      if (this.grid[i] === current) {
        count++;
      } else {
        runs.push([current, count]);
        current = this.grid[i];
        count = 1;
      }
    }
    runs.push([current, count]);
    return runs;
  }

  getStartPayload() {
    return {
      obstacles: this.getObstacles(),
      mapVariant: this.mapVariant.id,
      gameDuration: GAME_DURATION,
      tileSize: TILE_SIZE,
      gridW: GRID_W,
      gridH: GRID_H,
    };
  }

  getObstacles() {
    return this.mapVariant.obstacles;
  }

  onPlayerRemoved(socketId) {
    delete this.tileCounts[socketId];
    // Don't clear their tiles — they persist as unclaimed territory
  }

  _distSq(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }
}

module.exports = TerritoryMode;
