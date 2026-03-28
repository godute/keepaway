// Player constants
const PLAYER_RADIUS = 24;
const PLAYER_SPEED = 220;       // px per second
const DASH_SPEED = 600;         // px per second during dash
const DASH_DURATION = 0.18;     // seconds
const DASH_COOLDOWN = 1.2;      // seconds
const BONE_PICKUP_RADIUS = 40;  // distance to auto-pick up bone
const DASH_HIT_RADIUS = 50;     // distance for dash-hit detection
const KNOCKBACK_FORCE = 500;    // px per second
const KNOCKBACK_DURATION = 0.35; // seconds

// Collar colors to distinguish players
const { DEFAULT_CHARACTER, isValidCharacter } = require('./characters');

const COLLAR_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12',
  '#9b59b6', '#1abc9c', '#e91e63', '#ff5722',
];

class Player {
  constructor(id, name, index, characterId) {
    this.id = id;
    this.name = name || `Player ${index + 1}`;
    this.index = index;
    this.color = COLLAR_COLORS[index % COLLAR_COLORS.length];
    this.characterId = isValidCharacter(characterId) ? characterId : DEFAULT_CHARACTER;

    this.x = 480 + Math.cos((index / 8) * Math.PI * 2) * 180;
    this.y = 270 + Math.sin((index / 8) * Math.PI * 2) * 150;
    this.radius = PLAYER_RADIUS;

    this.vx = 0;
    this.vy = 0;
    this.dx = 0;
    this.dy = 0;

    // Dash
    this.isDashing = false;
    this.dashTimer = 0;
    this.dashCooldown = 0;
    this.dashVx = 0;
    this.dashVy = 0;
    this.wantsDash = false;

    // Knockback
    this.knockbackTimer = 0;
    this.knockbackVx = 0;
    this.knockbackVy = 0;

    // Game state
    this.hasBone = false;
    this.score = 0;
    this.isAlive = true;

    // Game-mode-specific flags
    this.isIt = false;        // Tag
    this.hasBomb = false;     // Hot Potato
    this.isEliminated = false; // Hot Potato, Sumo

    // Lobby
    this.isReady = false;

    // Rate limits
    this.lastEmojiTime = 0;
    this.lastChatTime = 0;
  }

  /** Reset game-specific state for new round */
  reset() {
    this.vx = 0; this.vy = 0;
    this.dx = 0; this.dy = 0;
    this.isDashing = false;
    this.dashTimer = 0;
    this.dashCooldown = 0;
    this.wantsDash = false;
    this.knockbackTimer = 0;
    this.hasBone = false;
    this.score = 0;
    this.isAlive = true;
    this.isIt = false;
    this.hasBomb = false;
    this.isEliminated = false;
  }

  setInput(dx, dy, dash) {
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0) {
      this.dx = dx / len;
      this.dy = dy / len;
    } else {
      this.dx = 0;
      this.dy = 0;
    }
    // Latch dash — only set true, never overwrite with false
    // Cleared in update() after processing
    if (dash) this.wantsDash = true;
  }

  applyKnockback(fromX, fromY) {
    const dx = this.x - fromX;
    const dy = this.y - fromY;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    this.knockbackVx = (dx / len) * KNOCKBACK_FORCE;
    this.knockbackVy = (dy / len) * KNOCKBACK_FORCE;
    this.knockbackTimer = KNOCKBACK_DURATION;
    this.isDashing = false; // cancel dash if being knocked back
  }

  update(dt, mapWidth, mapHeight, obstacles) {
    // Knockback takes priority
    if (this.knockbackTimer > 0) {
      this.knockbackTimer -= dt;
      this.vx = this.knockbackVx;
      this.vy = this.knockbackVy;
      // Decelerate knockback
      this.knockbackVx *= 0.92;
      this.knockbackVy *= 0.92;
    } else {
      // Dash cooldown
      if (this.dashCooldown > 0) this.dashCooldown -= dt;

      // Trigger dash
      if (this.wantsDash && !this.isDashing && this.dashCooldown <= 0) {
        const len = Math.sqrt(this.dx * this.dx + this.dy * this.dy);
        if (len > 0) {
          this.isDashing = true;
          this.dashTimer = DASH_DURATION;
          this.dashCooldown = DASH_COOLDOWN;
          this.dashVx = this.dx * DASH_SPEED;
          this.dashVy = this.dy * DASH_SPEED;
        }
      }
      this.wantsDash = false;

      // Apply movement
      if (this.isDashing) {
        this.dashTimer -= dt;
        this.vx = this.dashVx;
        this.vy = this.dashVy;
        if (this.dashTimer <= 0) this.isDashing = false;
      } else {
        this.vx = this.dx * PLAYER_SPEED;
        this.vy = this.dy * PLAYER_SPEED;
      }
    }

    // Move
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Obstacle collision (AABB push-out)
    if (obstacles) {
      for (const obs of obstacles) {
        this._resolveObstacleCollision(obs);
      }
    }

    // Clamp to map bounds
    this.x = Math.max(this.radius, Math.min(mapWidth - this.radius, this.x));
    this.y = Math.max(this.radius, Math.min(mapHeight - this.radius, this.y));
  }

  _resolveObstacleCollision(obs) {
    // Find closest point on AABB to circle center
    const closestX = Math.max(obs.x, Math.min(this.x, obs.x + obs.w));
    const closestY = Math.max(obs.y, Math.min(this.y, obs.y + obs.h));

    const dx = this.x - closestX;
    const dy = this.y - closestY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < this.radius) {
      // Push player out
      if (dist === 0) {
        // Player center is inside the obstacle — push in the shortest direction
        const overlapL = this.x - obs.x;
        const overlapR = (obs.x + obs.w) - this.x;
        const overlapT = this.y - obs.y;
        const overlapB = (obs.y + obs.h) - this.y;
        const minOverlap = Math.min(overlapL, overlapR, overlapT, overlapB);
        if (minOverlap === overlapL) this.x = obs.x - this.radius;
        else if (minOverlap === overlapR) this.x = obs.x + obs.w + this.radius;
        else if (minOverlap === overlapT) this.y = obs.y - this.radius;
        else this.y = obs.y + obs.h + this.radius;
      } else {
        const overlap = this.radius - dist;
        this.x += (dx / dist) * overlap;
        this.y += (dy / dist) * overlap;
      }
    }
  }

  setCharacter(characterId) {
    if (isValidCharacter(characterId)) {
      this.characterId = characterId;
    }
  }

  serialize() {
    return {
      id: this.id,
      name: this.name,
      color: this.color,
      characterId: this.characterId,
      x: Math.round(this.x),
      y: Math.round(this.y),
      radius: this.radius,
      hasBone: this.hasBone,
      score: this.score,
      isDashing: this.isDashing,
      dashCooldown: Math.max(0, this.dashCooldown),
      isKnockedBack: this.knockbackTimer > 0,
      isIt: this.isIt,
      hasBomb: this.hasBomb,
      isEliminated: this.isEliminated,
    };
  }
}

module.exports = { Player, BONE_PICKUP_RADIUS, DASH_HIT_RADIUS, PLAYER_RADIUS };
