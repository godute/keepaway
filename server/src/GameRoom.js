const { Player } = require('./Player');
const { createGameMode, isValidGameType, getRandomGameType } = require('./gamemodes');

const MAP_WIDTH = 960;
const MAP_HEIGHT = 540;
const TICK_RATE = 60;

class GameRoom {
  constructor(code, io) {
    this.code = code;
    this.io = io;
    this.players = new Map();
    this.playerOrder = [];

    this.phase = 'lobby';
    this.winner = null;
    this.selectedGameType = 'keepaway';
    this.gameMode = null;

    this._interval = null;
    this._lastTime = Date.now();
  }

  // --- Player management ---

  addPlayer(socket, name, characterId) {
    if (this.players.size >= 8) return false;

    // Cancel destroy grace period if someone joins
    if (this._destroyTimeout) {
      clearTimeout(this._destroyTimeout);
      this._destroyTimeout = null;
    }

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

  setGameType(gameType) {
    if (this.phase !== 'lobby') return;
    if (!isValidGameType(gameType)) return;
    this.selectedGameType = gameType;
    this.io.to(this.code).emit('room:update', this._roomState());
  }

  toggleReady(socketId) {
    const player = this.players.get(socketId);
    if (!player || this.phase !== 'lobby') return;
    player.isReady = !player.isReady;
    this.io.to(this.code).emit('room:update', this._roomState());
  }

  removePlayer(socketId) {
    const player = this.players.get(socketId);
    if (!player) return;

    // Let game mode clean up
    if (this.gameMode) {
      this.gameMode.onPlayerRemoved(socketId);
    }

    this.players.delete(socketId);
    this.playerOrder = this.playerOrder.filter(id => id !== socketId);

    this.io.to(this.code).emit('room:update', this._roomState());

    if ((this.phase === 'playing' || this.phase === 'countdown') && this.players.size < 2) {
      this._endGame(null);
    }
  }

  // --- Game lifecycle ---

  startGame() {
    if (this.phase !== 'lobby') return;
    if (this.players.size < 2) return;

    // Check all non-host players are ready
    const nonHostIds = this.playerOrder.slice(1);
    const allReady = nonHostIds.every(id => {
      const p = this.players.get(id);
      return p && p.isReady;
    });
    if (nonHostIds.length > 0 && !allReady) return 'not_ready';

    this.phase = 'countdown';
    this.winner = null;

    // Resolve random mode to actual game type
    const resolvedGameType = this.selectedGameType === 'random'
      ? getRandomGameType(this.players.size)
      : this.selectedGameType;

    // Create game mode
    this.gameMode = createGameMode(resolvedGameType, this);

    // Get obstacles from game mode
    const obstacles = this.gameMode.getObstacles();

    // Reset player positions in circle
    this.playerOrder.forEach((id, idx) => {
      const p = this.players.get(id);
      p.reset();
      p.x = MAP_WIDTH / 2 + Math.cos((idx / this.players.size) * Math.PI * 2) * 180;
      p.y = MAP_HEIGHT / 2 + Math.sin((idx / this.players.size) * Math.PI * 2) * 150;
    });

    // Initialize game mode
    this.gameMode.init(this.players, this.playerOrder);

    // Emit game:start with mode-specific payload
    const startPayload = {
      mapWidth: MAP_WIDTH,
      mapHeight: MAP_HEIGHT,
      gameType: resolvedGameType,
      ...this.gameMode.getStartPayload(),
    };
    this.io.to(this.code).emit('game:start', startPayload);

    // 3-second countdown before gameplay starts
    this.phase = 'countdown';
    this._countdownTimeout = setTimeout(() => {
      this.phase = 'playing';
      this._lastTime = Date.now();
      this._interval = setInterval(() => this._tick(), 1000 / TICK_RATE);
    }, 3000);
  }

  handleInput(socketId, input) {
    const player = this.players.get(socketId);
    if (!player || this.phase !== 'playing') return;
    player.setInput(input.dx || 0, input.dy || 0, !!input.dash);
  }

  // --- Tick ---

  _tick() {
    const now = Date.now();
    const dt = Math.min((now - this._lastTime) / 1000, 0.1);
    this._lastTime = now;

    // Get obstacles from game mode
    const obstacles = this.gameMode ? this.gameMode.getObstacles() : null;

    // Update all players
    for (const player of this.players.values()) {
      if (player.isEliminated) continue; // Skip eliminated players
      player.update(dt, MAP_WIDTH, MAP_HEIGHT, obstacles);
    }

    // Run game mode tick
    if (this.gameMode) {
      const result = this.gameMode.tick(dt, this.players, this.playerOrder);

      // Emit game events
      if (result.events) {
        for (const ev of result.events) {
          this.io.to(this.code).emit('game:event', ev);
        }
      }

      // Check winner
      if (result.winner) {
        this._endGame(result.winner);
        return;
      }
    }

    // Broadcast state
    this.io.to(this.code).emit('game:state', this._gameState());
  }

  // --- End game ---

  _endGame(winnerId) {
    if (this._countdownTimeout) {
      clearTimeout(this._countdownTimeout);
      this._countdownTimeout = null;
    }
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }

    const winnerPlayer = winnerId ? this.players.get(winnerId) : null;
    const scores = this.gameMode
      ? this.gameMode.getScoreList(this.players, this.playerOrder)
      : this._defaultScoreList();

    this.io.to(this.code).emit('game:end', {
      winnerId,
      winnerName: winnerPlayer ? winnerPlayer.name : null,
      scores,
    });

    this.phase = 'lobby';
    this.winner = winnerId;
    this.gameMode = null;

    // Reset ready state for next game
    for (const p of this.players.values()) {
      p.isReady = false;
    }

    this.io.to(this.code).emit('room:update', this._roomState());
  }

  // --- State ---

  _gameState() {
    const base = {
      players: this.playerOrder.map(id => this.players.get(id)?.serialize()).filter(Boolean),
      phase: this.phase,
      gameType: this.selectedGameType,
    };

    // Merge game-mode-specific state
    if (this.gameMode) {
      Object.assign(base, this.gameMode.getState());
    }

    return base;
  }

  _roomState() {
    return {
      code: this.code,
      phase: this.phase,
      selectedGameType: this.selectedGameType,
      players: this.playerOrder.map(id => {
        const p = this.players.get(id);
        return p ? { id, name: p.name, color: p.color, characterId: p.characterId, isReady: p.isReady } : null;
      }).filter(Boolean),
    };
  }

  _defaultScoreList() {
    return this.playerOrder.map(id => {
      const p = this.players.get(id);
      return { id, name: p?.name || '?', score: Math.floor(p?.score || 0) };
    }).sort((a, b) => b.score - a.score);
  }

  destroy() {
    if (this._countdownTimeout) { clearTimeout(this._countdownTimeout); this._countdownTimeout = null; }
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
  }

  isEmpty() { return this.players.size === 0; }
}

module.exports = GameRoom;
