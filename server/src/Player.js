// Player constants
const PLAYER_RADIUS = 24;
const PLAYER_SPEED = 220;       // px per second
const DASH_SPEED = 600;         // px per second during dash
const DASH_DURATION = 0.18;     // seconds
const DASH_COOLDOWN = 1.2;      // seconds
const BONE_PICKUP_RADIUS = 40;  // distance to auto-pick up bone
const DASH_HIT_RADIUS = 50;     // distance for dash-hit detection

// Collar colors to distinguish players
const COLLAR_COLORS = [
  '#e74c3c', // red
  '#3498db', // blue
  '#2ecc71', // green
  '#f39c12', // orange
  '#9b59b6', // purple
  '#1abc9c', // teal
  '#e91e63', // pink
  '#ff5722', // deep orange
];

class Player {
  constructor(id, name, index) {
    this.id = id;
    this.name = name || `Player ${index + 1}`;
    this.index = index;
    this.color = COLLAR_COLORS[index % COLLAR_COLORS.length];

    // Position (center of map initially, offset per player)
    this.x = 400 + Math.cos((index / 8) * Math.PI * 2) * 150;
    this.y = 300 + Math.sin((index / 8) * Math.PI * 2) * 150;
    this.radius = PLAYER_RADIUS;

    // Movement
    this.vx = 0;
    this.vy = 0;
    this.dx = 0; // input direction
    this.dy = 0;

    // Dash state
    this.isDashing = false;
    this.dashTimer = 0;
    this.dashCooldown = 0;
    this.dashVx = 0;
    this.dashVy = 0;
    this.wantsDash = false;

    // Game state
    this.hasBone = false;
    this.score = 0;
    this.isAlive = true;
  }

  setInput(dx, dy, dash) {
    // Normalize direction
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0) {
      this.dx = dx / len;
      this.dy = dy / len;
    } else {
      this.dx = 0;
      this.dy = 0;
    }
    this.wantsDash = dash;
  }

  update(dt, mapWidth, mapHeight) {
    // Dash cooldown countdown
    if (this.dashCooldown > 0) {
      this.dashCooldown -= dt;
    }

    // Trigger dash
    if (this.wantsDash && !this.isDashing && this.dashCooldown <= 0) {
      this.isDashing = true;
      this.dashTimer = DASH_DURATION;
      this.dashCooldown = DASH_COOLDOWN;
      // Dash in input direction, or forward if no input
      const len = Math.sqrt(this.dx * this.dx + this.dy * this.dy);
      if (len > 0) {
        this.dashVx = this.dx * DASH_SPEED;
        this.dashVy = this.dy * DASH_SPEED;
      } else {
        // No direction — dash does nothing (or keep last facing)
        this.isDashing = false;
        this.dashCooldown = 0;
      }
    }

    // Apply movement
    if (this.isDashing) {
      this.dashTimer -= dt;
      this.vx = this.dashVx;
      this.vy = this.dashVy;
      if (this.dashTimer <= 0) {
        this.isDashing = false;
      }
    } else {
      this.vx = this.dx * PLAYER_SPEED;
      this.vy = this.dy * PLAYER_SPEED;
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Clamp to map bounds
    this.x = Math.max(this.radius, Math.min(mapWidth - this.radius, this.x));
    this.y = Math.max(this.radius, Math.min(mapHeight - this.radius, this.y));
  }

  serialize() {
    return {
      id: this.id,
      name: this.name,
      color: this.color,
      x: Math.round(this.x),
      y: Math.round(this.y),
      radius: this.radius,
      hasBone: this.hasBone,
      score: this.score,
      isDashing: this.isDashing,
      dashCooldown: Math.max(0, this.dashCooldown),
    };
  }
}

module.exports = { Player, BONE_PICKUP_RADIUS, DASH_HIT_RADIUS, PLAYER_RADIUS };
