import { BaseRenderer } from './BaseRenderer.js';
import sound from '../audio/SoundManager.js';

/**
 * TerritoryRenderer - Renders the Territory (영역 차지) game mode.
 * Players move over tiles to claim them in their color.
 * The player with the most tiles when time runs out wins.
 */

// Default tile size in pixels
const TILE_SIZE = 20;

export class TerritoryRenderer extends BaseRenderer {
  constructor(scene) {
    super(scene);
    this._gridTexture = null;
    this._gridData = null; // 2D array of owner IDs (null = unclaimed)
    this._gridCols = 0;
    this._gridRows = 0;
    this._timerText = null;
    this._counterText = null;
    this._playerColors = new Map(); // playerId -> color int
  }

  create() {
    const scene = this.scene;
    const W = scene.mapWidth;
    const H = scene.mapHeight;

    this._gridCols = Math.floor(W / TILE_SIZE);
    this._gridRows = Math.floor(H / TILE_SIZE);

    // Initialize empty grid
    this._gridData = [];
    for (let r = 0; r < this._gridRows; r++) {
      this._gridData[r] = new Array(this._gridCols).fill(null);
    }

    // Create a Graphics object for drawing the tile grid
    this._gridTexture = scene.add.graphics().setDepth(2);

    // --- Timer text (top center) ---
    this._timerText = scene.add.text(W / 2, 14, '', {
      fontSize: '18px', color: '#ffffff', fontFamily: 'Jua, sans-serif',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(30);

    // --- Territory counter text (below timer) ---
    this._counterText = scene.add.text(W / 2, 34, '', {
      fontSize: '11px', color: '#cccccc', fontFamily: 'Jua, sans-serif',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(30);
  }

  onGameState(state) {
    const scene = this.scene;

    // Cache player collar colors for tile rendering
    for (const p of state.players) {
      if (!this._playerColors.has(p.id) && p.color) {
        this._playerColors.set(p.id, Phaser.Display.Color.HexStringToColor(p.color).color);
      }
    }

    // Use server-provided grid dimensions if available
    if (state.gridW && state.gridH) {
      this._gridCols = state.gridW;
      this._gridRows = state.gridH;
    }
    if (state.tileSize) {
      this._tileSize = state.tileSize;
    }

    // Apply full grid if provided (RLE compressed: [[owner, count], ...])
    if (state.fullGrid) {
      let idx = 0;
      for (const [owner, count] of state.fullGrid) {
        for (let i = 0; i < count && idx < this._gridCols * this._gridRows; i++, idx++) {
          const r = Math.floor(idx / this._gridCols);
          const c = idx % this._gridCols;
          if (this._gridData[r]) this._gridData[r][c] = owner;
        }
      }
    }

    // Apply incremental changed tiles (server sends {x, y, owner} where x=col, y=row)
    if (state.changedTiles && state.changedTiles.length > 0) {
      for (const tile of state.changedTiles) {
        const col = tile.x;
        const row = tile.y;
        if (row >= 0 && row < this._gridRows && col >= 0 && col < this._gridCols) {
          if (this._gridData[row]) this._gridData[row][col] = tile.owner;
        }
      }
    }

    // Redraw grid
    this._redrawGrid();

    // Update timer
    const remaining = state.timeRemaining != null ? state.timeRemaining : 0;
    const mins = Math.floor(remaining / 60);
    const secs = Math.floor(remaining % 60);
    this._timerText.setText(`\u23f1 ${mins}:${secs.toString().padStart(2, '0')}`);

    if (remaining <= 10 && remaining > 0) {
      this._timerText.setColor('#ff4444');
      this._timerText.setAlpha(0.6 + Math.sin(Date.now() / 200) * 0.4);
    } else {
      this._timerText.setColor('#ffffff');
      this._timerText.setAlpha(1);
    }

    // Update tile counts
    const tileCounts = this._computeTileCounts(state.players);
    const totalTiles = this._gridCols * this._gridRows;
    const parts = [];
    for (const p of state.players) {
      const count = tileCounts.get(p.id) || 0;
      const pct = ((count / totalTiles) * 100).toFixed(0);
      parts.push(`${p.name}: ${count}(${pct}%)`);
    }
    this._counterText.setText(parts.join('  '));
  }

  onGameEvent(ev) {
    if (ev.type === 'territory_claimed') {
      // Small pickup sound for territory claims
      sound.pickup();
    }
  }

  formatScoreboard(players, myId) {
    const tileCounts = this._computeTileCounts(players);
    const totalTiles = this._gridCols * this._gridRows;

    // Sort by tile count descending
    const sorted = players.slice().sort((a, b) => {
      return (tileCounts.get(b.id) || 0) - (tileCounts.get(a.id) || 0);
    });

    return sorted.map((p, i) => {
      const me = p.id === myId ? ' \u25c0' : '';
      const count = tileCounts.get(p.id) || 0;
      const pct = totalTiles > 0 ? ((count / totalTiles) * 100).toFixed(0) : '0';
      const medal = i === 0 ? '\u{1F947}' : i === 1 ? '\u{1F948}' : i === 2 ? '\u{1F949}' : '   ';
      return `${medal} ${p.name}${me}  ${count} (${pct}%)`;
    });
  }

  destroy() {
    if (this._gridTexture) { this._gridTexture.destroy(); this._gridTexture = null; }
    if (this._timerText) { this._timerText.destroy(); this._timerText = null; }
    if (this._counterText) { this._counterText.destroy(); this._counterText = null; }
    this._gridData = null;
    this._playerColors.clear();
  }

  // --- Internal helpers ---

  _redrawGrid() {
    const g = this._gridTexture;
    g.clear();

    for (let r = 0; r < this._gridRows; r++) {
      for (let c = 0; c < this._gridCols; c++) {
        const owner = this._gridData[r][c];
        if (owner) {
          const color = this._playerColors.get(owner) || 0x888888;
          g.fillStyle(color, 0.35);
          g.fillRect(c * TILE_SIZE, r * TILE_SIZE, TILE_SIZE, TILE_SIZE);

          // Subtle border for claimed tiles
          g.lineStyle(1, color, 0.15);
          g.strokeRect(c * TILE_SIZE, r * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }
      }
    }
  }

  _computeTileCounts(players) {
    const counts = new Map();
    for (const p of players) {
      counts.set(p.id, 0);
    }
    if (!this._gridData) return counts;

    for (let r = 0; r < this._gridRows; r++) {
      for (let c = 0; c < this._gridCols; c++) {
        const owner = this._gridData[r][c];
        if (owner && counts.has(owner)) {
          counts.set(owner, counts.get(owner) + 1);
        }
      }
    }
    return counts;
  }
}
