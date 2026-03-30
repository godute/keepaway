/**
 * BaseGameMode — interface for all game modes.
 * Subclasses implement game-specific logic; GameRoom delegates to them.
 */
class BaseGameMode {
  constructor(room) {
    this.room = room; // Reference to GameRoom for access to io, code, players
    this.mapVariant = null;
  }

  /** Called when game starts. Set up initial game state. */
  init(players, playerOrder) {}

  /**
   * Called every tick (60Hz). Return { events: [], winner: null|id }.
   * events = array of objects to emit via game:event
   * winner = socket id of winner, or null if game continues
   */
  tick(dt, players, playerOrder) {
    return { events: [], winner: null };
  }

  /** Return game-specific state to merge into game:state broadcast. */
  getState() {
    return {};
  }

  /** Return extra data to include in game:start emission. */
  getStartPayload() {
    return {};
  }

  /** Called when a player leaves mid-game. Clean up game-specific refs. */
  onPlayerRemoved(socketId) {}

  /** Return obstacles array for this game mode, or null for no obstacles. */
  getObstacles() {
    return null;
  }

  /** Squared distance between two objects with x/y properties. */
  _distSq(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  /** Return score list for game:end. Override for custom scoring. */
  getScoreList(players, playerOrder) {
    return playerOrder.map(id => {
      const p = players.get(id);
      return { id, name: p.name, score: Math.floor(p.score) };
    }).sort((a, b) => b.score - a.score);
  }
}

module.exports = BaseGameMode;
