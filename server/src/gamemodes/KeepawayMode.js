const BaseGameMode = require('./BaseGameMode');
const { BONE_PICKUP_RADIUS, DASH_HIT_RADIUS } = require('../Player');

const SCORE_PER_SECOND = 1;
const WIN_SCORE = 30;
const BONE_RESPAWN_DELAY = 2.0;

// Map variants
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
    { x: 420, y: 80, w: 40, h: 40, type: 'bush' },
    { x: 500, y: 420, w: 40, h: 40, type: 'bush' },
    { x: 180, y: 230, w: 40, h: 40, type: 'bush' },
    { x: 740, y: 280, w: 45, h: 35, type: 'rock' },
  ]},
  { id: 'arena', obstacles: [
    { x: 200, y: 120, w: 90, h: 20, type: 'fence' },
    { x: 670, y: 120, w: 90, h: 20, type: 'fence' },
    { x: 200, y: 400, w: 90, h: 20, type: 'fence' },
    { x: 670, y: 400, w: 90, h: 20, type: 'fence' },
    { x: 430, y: 230, w: 100, h: 80, type: 'pond' },
    { x: 100, y: 240, w: 45, h: 35, type: 'rock' },
    { x: 815, y: 265, w: 45, h: 35, type: 'rock' },
    { x: 350, y: 60, w: 40, h: 40, type: 'bush' },
    { x: 570, y: 440, w: 40, h: 40, type: 'bush' },
    { x: 350, y: 260, w: 40, h: 40, type: 'bush' },
    { x: 580, y: 240, w: 40, h: 40, type: 'bush' },
    { x: 440, y: 120, w: 45, h: 35, type: 'rock' },
    { x: 460, y: 380, w: 45, h: 35, type: 'rock' },
  ]},
  { id: 'forest', obstacles: [
    { x: 60, y: 40, w: 55, h: 55, type: 'tree' },
    { x: 845, y: 40, w: 55, h: 55, type: 'tree' },
    { x: 60, y: 445, w: 55, h: 55, type: 'tree' },
    { x: 845, y: 445, w: 55, h: 55, type: 'tree' },
    { x: 200, y: 40, w: 55, h: 55, type: 'tree' },
    { x: 705, y: 40, w: 55, h: 55, type: 'tree' },
    { x: 200, y: 445, w: 55, h: 55, type: 'tree' },
    { x: 705, y: 445, w: 55, h: 55, type: 'tree' },
    { x: 400, y: 220, w: 40, h: 40, type: 'bush' },
    { x: 520, y: 280, w: 40, h: 40, type: 'bush' },
    { x: 460, y: 140, w: 40, h: 40, type: 'bush' },
    { x: 460, y: 360, w: 40, h: 40, type: 'bush' },
  ]},
];

class KeepawayMode extends BaseGameMode {
  constructor(room) {
    super(room);
    this.mapVariant = MAP_VARIANTS[Math.floor(Math.random() * MAP_VARIANTS.length)];
  }

  init(players, playerOrder) {
    this.bone = this._randomBonePosition();
    this.boneOwner = null;
    this.boneVisible = true;
    this.boneRespawnTimer = 0;
    this.boneDropCooldown = 1.5;

    for (const p of players.values()) {
      p.score = 0;
      p.hasBone = false;
    }
  }

  tick(dt, players, playerOrder) {
    const events = [];

    // Bone respawn
    if (!this.boneVisible) {
      this.boneRespawnTimer -= dt;
      if (this.boneRespawnTimer <= 0) {
        this.boneVisible = true;
        this.bone = this._randomBonePosition();
        events.push({ type: 'bone_spawned', bone: this.bone });
      }
    }

    // Bone drop cooldown
    if (this.boneDropCooldown > 0) this.boneDropCooldown -= dt;

    // Bone pickup
    if (this.boneVisible && !this.boneOwner && this.boneDropCooldown <= 0) {
      for (const player of players.values()) {
        if (this._distSq(player, this.bone) < BONE_PICKUP_RADIUS * BONE_PICKUP_RADIUS) {
          this.boneOwner = player.id;
          player.hasBone = true;
          this.boneVisible = false;
          events.push({ type: 'bone_taken', playerId: player.id });
          break;
        }
      }
    }

    // Dash hit detection
    for (const attacker of players.values()) {
      if (!attacker.isDashing || !this.boneOwner || attacker.id === this.boneOwner) continue;
      const victim = players.get(this.boneOwner);
      if (!victim) continue;

      if (this._distSq(attacker, victim) < DASH_HIT_RADIUS * DASH_HIT_RADIUS) {
        victim.applyKnockback(attacker.x, attacker.y);
        this._dropBoneToward(victim, attacker);
        events.push({
          type: 'bone_dropped',
          attackerId: attacker.id,
          victimId: victim.id,
          bone: this.bone,
        });
      }
    }

    // Score
    if (this.boneOwner) {
      const holder = players.get(this.boneOwner);
      if (holder) {
        holder.score += SCORE_PER_SECOND * dt;
        if (holder.score >= WIN_SCORE) {
          return { events, winner: holder.id };
        }
      }
    }

    return { events, winner: null };
  }

  getState() {
    return {
      bone: (this.boneVisible && !this.boneOwner) ? this.bone : null,
      boneOwner: this.boneOwner,
    };
  }

  getStartPayload() {
    return { obstacles: this.getObstacles(), mapVariant: this.mapVariant.id };
  }

  getObstacles() {
    return this.mapVariant.obstacles;
  }

  onPlayerRemoved(socketId) {
    if (this.boneOwner === socketId) {
      const player = this.room.players.get(socketId);
      if (player) this._dropBone(player);
    }
  }

  _dropBone(player) {
    player.hasBone = false;
    this.boneOwner = null;
    this.bone = { x: player.x, y: player.y };
    this.boneVisible = true;
    this.boneDropCooldown = 0.5;
  }

  _dropBoneToward(victim, attacker) {
    victim.hasBone = false;
    this.boneOwner = null;
    const dx = attacker.x - victim.x;
    const dy = attacker.y - victim.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const boneX = Math.max(30, Math.min(960 - 30, victim.x + (dx / len) * 35));
    const boneY = Math.max(30, Math.min(540 - 30, victim.y + (dy / len) * 35));
    this.bone = { x: boneX, y: boneY };
    this.boneVisible = true;
    this.boneDropCooldown = 0.5;
  }

  _randomBonePosition() {
    const obstacles = this.getObstacles();
    const margin = 60;
    let x, y, valid;
    for (let attempt = 0; attempt < 20; attempt++) {
      x = margin + Math.random() * (960 - margin * 2);
      y = margin + Math.random() * (540 - margin * 2);
      valid = true;
      for (const obs of obstacles) {
        if (x >= obs.x - 20 && x <= obs.x + obs.w + 20 &&
            y >= obs.y - 20 && y <= obs.y + obs.h + 20) {
          valid = false;
          break;
        }
      }
      if (valid) break;
    }
    return { x, y };
  }

  _distSq(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }
}

module.exports = KeepawayMode;
