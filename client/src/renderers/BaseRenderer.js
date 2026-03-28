/**
 * BaseRenderer - Interface class for game-specific renderers.
 * Each game mode (keepaway, tag, sumo, etc.) extends this to provide
 * its own visuals, event handling, and scoreboard formatting.
 */
export class BaseRenderer {
  constructor(scene) {
    /** @type {Phaser.Scene} The GameScene instance */
    this.scene = scene;
  }

  /**
   * Setup game-specific visuals. Called once when the scene creates.
   */
  create() {}

  /**
   * Update game-specific visuals each tick.
   * @param {object} state - The authoritative game state from the server
   */
  onGameState(state) {}

  /**
   * Handle a game-specific event broadcast from the server.
   * @param {object} ev - The event object with at least a `type` field
   */
  onGameEvent(ev) {}

  /**
   * Return an array of scoreboard line strings for display.
   * @param {Array} players - Array of player state objects, already sorted
   * @param {string} myId - The local player's socket id
   * @returns {string[]}
   */
  formatScoreboard(players, myId) {
    return [];
  }

  /**
   * Cleanup all game-specific graphics and references.
   */
  destroy() {}
}
