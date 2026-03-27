const { Player, BONE_PICKUP_RADIUS, DASH_HIT_RADIUS } = require('./Player');

const MAP_WIDTH = 800;
const MAP_HEIGHT = 600;
const TICK_RATE = 60;           // Hz
const SCORE_PER_SECOND = 1;     // points per second holding bone
const WIN_SCORE = 30;           // points to win
const BONE_RESPAWN_DELAY = 2.0; // seconds after drop before bone reappears at new spot

class GameRoom {
  constructor(code, io) {
    this.code = code;
    this.io = io;
    this.players = new Map(); // socketId -> Player
    this.playerOrder = [];    // insertion order for index assignment

    this.bone = this._randomBonePosition();
    this.boneOwner = null;    // socketId or null
    this.boneVisible = true;
    this.boneRespawnTimer = 0;

    this.phase = 'lobby';     // 'lobby' | 'playing' | 'ended'
    this.winner = null;

    this._interval = null;
    this._lastTime = Date.now();
  }

  addPlayer(socket, name) {
    if (this.players.size >= 8) return false;

    const index = this.playerOrder.length;
    const player = new Player(socket.id, name, index);
    this.players.set(socket.id, player);
    this.playerOrder.push(socket.id);

    socket.join(this.code);

    // Notify room of new player
    this.io.to(this.code).emit('room:update', this._roomState());
    return true;
  }

  removePlayer(socketId) {
    const player = this.players.get(socketId);
    if (!player) return;

    // Drop bone if they had it
    if (this.boneOwner === socketId) {
      this._dropBone(player);
    }

    this.players.delete(socketId);
    this.playerOrder = this.playerOrder.filter(id => id !== socketId);

    this.io.to(this.code).emit('room:update', this._roomState());

    // Stop game if too few players
    if (this.phase === 'playing' && this.players.size < 2) {
      this._endGame(null);
    }
  }

  startGame() {
    if (this.phase !== 'lobby') return;
    if (this.players.size < 2) return;

    this.phase = 'playing';
    this.winner = null;

    // Reset all scores and positions
    this.playerOrder.forEach((id, idx) => {
      const p = this.players.get(id);
      p.score = 0;
      p.hasBone = false;
      p.x = 400 + Math.cos((idx / this.players.size) * Math.PI * 2) * 150;
      p.y = 300 + Math.sin((idx / this.players.size) * Math.PI * 2) * 150;
    });

    this.bone = this._randomBonePosition();
    this.boneOwner = null;
    this.boneVisible = true;

    this.io.to(this.code).emit('game:start', { mapWidth: MAP_WIDTH, mapHeight: MAP_HEIGHT });

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
    const dt = Math.min((now - this._lastTime) / 1000, 0.1); // cap delta
    this._lastTime = now;

    // Update all players
    for (const player of this.players.values()) {
      player.update(dt, MAP_WIDTH, MAP_HEIGHT);
    }

    // Bone respawn countdown
    if (!this.boneVisible) {
      this.boneRespawnTimer -= dt;
      if (this.boneRespawnTimer <= 0) {
        this.boneVisible = true;
        this.bone = this._randomBonePosition();
        this.io.to(this.code).emit('game:event', { type: 'bone_spawned', bone: this.bone });
      }
    }

    // Bone pickup (only if bone is loose and visible)
    if (this.boneVisible && !this.boneOwner) {
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

    // Dash hit detection
    for (const attacker of this.players.values()) {
      if (!attacker.isDashing || !this.boneOwner || attacker.id === this.boneOwner) continue;

      const victim = this.players.get(this.boneOwner);
      if (!victim) continue;

      if (this._dist(attacker, victim) < DASH_HIT_RADIUS) {
        this._dropBone(victim);
        this.io.to(this.code).emit('game:event', {
          type: 'bone_dropped',
          attackerId: attacker.id,
          victimId: victim.id,
          bone: this.bone,
        });
      }
    }

    // Score accumulation for bone holder
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

    // Broadcast game state
    this.io.to(this.code).emit('game:state', this._gameState());
  }

  _dropBone(player) {
    player.hasBone = false;
    this.boneOwner = null;
    // Drop bone near player's position
    this.bone = { x: player.x, y: player.y };
    this.boneVisible = true;
  }

  _endGame(winnerId) {
    this.phase = 'ended';
    this.winner = winnerId;

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
  }

  _randomBonePosition() {
    const margin = 60;
    return {
      x: margin + Math.random() * (MAP_WIDTH - margin * 2),
      y: margin + Math.random() * (MAP_HEIGHT - margin * 2),
    };
  }

  _dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  _gameState() {
    return {
      players: this.playerOrder.map(id => this.players.get(id).serialize()),
      bone: this.boneVisible ? this.bone : null,
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
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  isEmpty() {
    return this.players.size === 0;
  }
}

module.exports = GameRoom;
