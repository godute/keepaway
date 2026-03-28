const { Player, BONE_PICKUP_RADIUS, DASH_HIT_RADIUS } = require('./Player');

const MAP_WIDTH = 800;
const MAP_HEIGHT = 600;
const TICK_RATE = 60;
const SCORE_PER_SECOND = 1;
const WIN_SCORE = 30;
const BONE_RESPAWN_DELAY = 2.0;

// Map obstacles (AABB: x, y, w, h, type)
const OBSTACLES = [
  // Corner trees
  { x: 100, y: 80, w: 55, h: 55, type: 'tree' },
  { x: 645, y: 80, w: 55, h: 55, type: 'tree' },
  { x: 100, y: 465, w: 55, h: 55, type: 'tree' },
  { x: 645, y: 465, w: 55, h: 55, type: 'tree' },
  // Center pond
  { x: 360, y: 255, w: 80, h: 80, type: 'pond' },
  // Side rocks
  { x: 250, y: 170, w: 45, h: 35, type: 'rock' },
  { x: 510, y: 395, w: 45, h: 35, type: 'rock' },
  // Fences
  { x: 200, y: 360, w: 90, h: 20, type: 'fence' },
  { x: 510, y: 220, w: 90, h: 20, type: 'fence' },
  // Small bushes
  { x: 350, y: 100, w: 40, h: 40, type: 'bush' },
  { x: 410, y: 460, w: 40, h: 40, type: 'bush' },
];

class GameRoom {
  constructor(code, io) {
    this.code = code;
    this.io = io;
    this.players = new Map();
    this.playerOrder = [];
    this.obstacles = OBSTACLES;

    this.bone = this._randomBonePosition();
    this.boneOwner = null;
    this.boneVisible = true;
    this.boneRespawnTimer = 0;
    this.boneDropCooldown = 0;

    this.phase = 'lobby';
    this.winner = null;

    this._interval = null;
    this._lastTime = Date.now();
  }

  addPlayer(socket, name, characterId) {
    if (this.players.size >= 8) return false;

    const index = this.playerOrder.length;
    const player = new Player(socket.id, name, index, characterId);
    this.players.set(socket.id, player);
    this.playerOrder.push(socket.id);

    socket.join(this.code);
    this.io.to(this.code).emit('room:update', this._roomState());
    return true;
  }

  setPlayerCharacter(socketId, characterId) {
    const player = this.players.get(socketId);
    if (!player || this.phase !== 'lobby') return;
    player.setCharacter(characterId);
    this.io.to(this.code).emit('room:update', this._roomState());
  }

  removePlayer(socketId) {
    const player = this.players.get(socketId);
    if (!player) return;

    if (this.boneOwner === socketId) this._dropBone(player);

    this.players.delete(socketId);
    this.playerOrder = this.playerOrder.filter(id => id !== socketId);

    this.io.to(this.code).emit('room:update', this._roomState());

    if (this.phase === 'playing' && this.players.size < 2) {
      this._endGame(null);
    }
  }

  startGame() {
    if (this.phase !== 'lobby') return;
    if (this.players.size < 2) return;

    this.phase = 'playing';
    this.winner = null;

    this.playerOrder.forEach((id, idx) => {
      const p = this.players.get(id);
      p.score = 0;
      p.hasBone = false;
      p.x = 400 + Math.cos((idx / this.players.size) * Math.PI * 2) * 150;
      p.y = 300 + Math.sin((idx / this.players.size) * Math.PI * 2) * 150;
    });

    // Spawn bone at safe center position (avoid pond at 360-440, 255-335)
    this.bone = { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 - 80 };
    this.boneOwner = null;
    this.boneVisible = true;
    this.boneDropCooldown = 1.5; // Grace period: nobody can pick up for 1.5s

    this.io.to(this.code).emit('game:start', {
      mapWidth: MAP_WIDTH,
      mapHeight: MAP_HEIGHT,
      obstacles: this.obstacles,
    });

    this._lastTime = Date.now();
    this._interval = setInterval(() => this._tick(), 1000 / TICK_RATE);
  }

  handleInput(socketId, input) {
    const player = this.players.get(socketId);
    if (!player || this.phase !== 'playing') return;
    player.setInput(input.dx || 0, input.dy || 0, !!input.dash);
  }

  _tick() {
    const now = Date.now();
    const dt = Math.min((now - this._lastTime) / 1000, 0.1);
    this._lastTime = now;

    // Update all players (with obstacles)
    for (const player of this.players.values()) {
      player.update(dt, MAP_WIDTH, MAP_HEIGHT, this.obstacles);
    }

    // Bone respawn
    if (!this.boneVisible) {
      this.boneRespawnTimer -= dt;
      if (this.boneRespawnTimer <= 0) {
        this.boneVisible = true;
        this.bone = this._randomBonePosition();
        this.io.to(this.code).emit('game:event', { type: 'bone_spawned', bone: this.bone });
      }
    }

    // Bone drop cooldown
    if (this.boneDropCooldown > 0) this.boneDropCooldown -= dt;

    // Bone pickup
    if (this.boneVisible && !this.boneOwner && this.boneDropCooldown <= 0) {
      for (const player of this.players.values()) {
        if (this._dist(player, this.bone) < BONE_PICKUP_RADIUS) {
          this.boneOwner = player.id;
          player.hasBone = true;
          this.boneVisible = false;
          this.io.to(this.code).emit('game:event', {
            type: 'bone_taken',
            playerId: player.id,
          });
          break;
        }
      }
    }

    // Dash hit detection + knockback
    for (const attacker of this.players.values()) {
      if (!attacker.isDashing || !this.boneOwner || attacker.id === this.boneOwner) continue;

      const victim = this.players.get(this.boneOwner);
      if (!victim) continue;

      if (this._dist(attacker, victim) < DASH_HIT_RADIUS) {
        // Apply knockback to victim
        victim.applyKnockback(attacker.x, attacker.y);
        // Drop bone offset toward attacker so attacker can grab it
        this._dropBoneToward(victim, attacker);
        this.io.to(this.code).emit('game:event', {
          type: 'bone_dropped',
          attackerId: attacker.id,
          victimId: victim.id,
          bone: this.bone,
        });
      }
    }

    // Score
    if (this.boneOwner) {
      const holder = this.players.get(this.boneOwner);
      if (holder) {
        holder.score += SCORE_PER_SECOND * dt;
        if (holder.score >= WIN_SCORE) {
          this._endGame(holder.id);
          return;
        }
      }
    }

    this.io.to(this.code).emit('game:state', this._gameState());
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
    // Place bone 35px toward attacker from victim
    const dx = attacker.x - victim.x;
    const dy = attacker.y - victim.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const boneX = Math.max(30, Math.min(MAP_WIDTH - 30, victim.x + (dx / len) * 35));
    const boneY = Math.max(30, Math.min(MAP_HEIGHT - 30, victim.y + (dy / len) * 35));
    this.bone = { x: boneX, y: boneY };
    this.boneVisible = true;
    this.boneDropCooldown = 0.5;
  }

  _endGame(winnerId) {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }

    const winnerPlayer = winnerId ? this.players.get(winnerId) : null;
    this.io.to(this.code).emit('game:end', {
      winnerId,
      winnerName: winnerPlayer ? winnerPlayer.name : null,
      scores: this._scoreList(),
    });

    // Return to lobby so players can restart
    this.phase = 'lobby';
    this.winner = winnerId;
    this.io.to(this.code).emit('room:update', this._roomState());
  }

  _randomBonePosition() {
    const margin = 60;
    let x, y, valid;
    // Ensure bone doesn't spawn inside an obstacle
    for (let attempt = 0; attempt < 20; attempt++) {
      x = margin + Math.random() * (MAP_WIDTH - margin * 2);
      y = margin + Math.random() * (MAP_HEIGHT - margin * 2);
      valid = true;
      for (const obs of this.obstacles) {
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

  _dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  _gameState() {
    return {
      players: this.playerOrder.map(id => this.players.get(id).serialize()),
      bone: (this.boneVisible && !this.boneOwner) ? this.bone : null,
      boneOwner: this.boneOwner,
      phase: this.phase,
    };
  }

  _roomState() {
    return {
      code: this.code,
      phase: this.phase,
      players: this.playerOrder.map(id => ({
        id,
        name: this.players.get(id).name,
        color: this.players.get(id).color,
        characterId: this.players.get(id).characterId,
      })),
    };
  }

  _scoreList() {
    return this.playerOrder.map(id => {
      const p = this.players.get(id);
      return { id, name: p.name, score: Math.floor(p.score) };
    }).sort((a, b) => b.score - a.score);
  }

  destroy() {
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
  }

  isEmpty() { return this.players.size === 0; }
}

module.exports = GameRoom;
