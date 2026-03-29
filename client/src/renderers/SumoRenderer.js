import { BaseRenderer } from './BaseRenderer.js';
import sound from '../audio/SoundManager.js';

/**
 * SumoRenderer - Renders the Sumo (씨름) game mode.
 * Players try to push each other out of a shrinking ring.
 * Last player standing wins.
 */
export class SumoRenderer extends BaseRenderer {
  constructor(scene) {
    super(scene);
    this._ringGraphic = null;
    this._ringGlow = null;
    this._ringRadius = 0;
    this._warningText = null;
  }

  create() {
    const scene = this.scene;
    const W = scene.mapWidth;
    const H = scene.mapHeight;

    // --- Ring glow (underneath the ring line) ---
    this._ringGlow = scene.add.graphics().setDepth(5);

    // --- Ring circle (thick white line) ---
    this._ringGraphic = scene.add.graphics().setDepth(6);

    // --- Edge warning text ---
    this._warningText = scene.add.text(W / 2, H / 2 - 40, '', {
      fontSize: '20px', color: '#ff4444', fontFamily: 'Jua, sans-serif',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(30).setAlpha(0);
  }

  onGameState(state) {
    const scene = this.scene;
    const W = scene.mapWidth;
    const H = scene.mapHeight;
    const cx = W / 2;
    const cy = H / 2;

    const radius = state.ringRadius || 200;
    this._ringRadius = radius;

    // Redraw ring
    this._ringGraphic.clear();
    this._ringGraphic.lineStyle(4, 0xffffff, 0.8);
    this._ringGraphic.strokeCircle(cx, cy, radius);

    // Inner dashed marking
    this._ringGraphic.lineStyle(1, 0xffffff, 0.2);
    this._ringGraphic.strokeCircle(cx, cy, radius * 0.7);

    // Redraw glow
    this._ringGlow.clear();
    this._ringGlow.lineStyle(12, 0xff6600, 0.12);
    this._ringGlow.strokeCircle(cx, cy, radius);
    this._ringGlow.lineStyle(24, 0xff4400, 0.06);
    this._ringGlow.strokeCircle(cx, cy, radius);

    // Danger zone shading outside the ring
    this._ringGlow.fillStyle(0xff0000, 0.04);
    this._ringGlow.fillRect(0, 0, W, H);
    this._ringGlow.fillStyle(0x000000, 0.04);
    this._ringGlow.fillCircle(cx, cy, radius);

    // Check if local player is close to the edge - warning flash
    const myId = scene.myId;
    const me = state.players.find(p => p.id === myId);
    if (me && !me.eliminated) {
      const dx = me.x - cx;
      const dy = me.y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const edgeDist = radius - dist;

      if (edgeDist < 40) {
        this._warningText.setText('\u26a0 \uc704\ud5d8! \ub9c1 \uac00\uc7a5\uc790\ub9ac!');
        this._warningText.setAlpha(0.6 + Math.sin(Date.now() / 150) * 0.4);
      } else {
        this._warningText.setAlpha(0);
      }
    } else {
      this._warningText.setAlpha(0);
    }

    // Gray out eliminated players
    for (const p of state.players) {
      const pg = scene.playerGraphics.get(p.id);
      if (pg && p.eliminated) {
        pg.container.setAlpha(0.3);
      } else if (pg) {
        pg.container.setAlpha(1);
      }
    }
  }

  onGameEvent(ev) {
    const scene = this.scene;

    if (ev.type === 'sumo_eliminated') {
      // Dramatic elimination effect
      sound.elimination();
      scene.cameras.main.shake(300, 0.012);

      const pg = scene.playerGraphics.get(ev.playerId);
      if (pg) {
        // Burst particles at eliminated player position
        const px = pg.container.x;
        const py = pg.container.y;
        for (let i = 0; i < 10; i++) {
          const ang = (i / 10) * Math.PI * 2;
          const particle = scene.add.circle(px, py, 5, 0xff4444, 0.8);
          scene.tweens.add({
            targets: particle,
            x: px + Math.cos(ang) * 60,
            y: py + Math.sin(ang) * 60,
            alpha: 0, scaleX: 0.2, scaleY: 0.2,
            duration: 600, ease: 'Power2',
            onComplete: () => particle.destroy(),
          });
        }
        this._showFloatingText(px, py - 40, '\u274c \ud0c8\ub77d!', '#ff4444');
      }

    } else if (ev.type === 'sumo_hit') {
      // Small screen shake on hit
      scene.cameras.main.shake(100, 0.005);
      sound.collision();
    }
  }

  formatScoreboard(players, myId) {
    // Alive players first, then eliminated
    const sorted = players.slice().sort((a, b) => {
      if (a.eliminated && !b.eliminated) return 1;
      if (!a.eliminated && b.eliminated) return -1;
      return 0;
    });
    return sorted.map((p) => {
      const me = p.id === myId ? ' \u25c0' : '';
      const status = p.eliminated ? ' \u274c' : ' \u2705';
      return `${status} ${p.name}${me}`;
    });
  }

  destroy() {
    if (this._ringGraphic) { this._ringGraphic.destroy(); this._ringGraphic = null; }
    if (this._ringGlow) { this._ringGlow.destroy(); this._ringGlow = null; }
    if (this._warningText) { this._warningText.destroy(); this._warningText = null; }
  }

  // --- Internal helpers ---

  _showFloatingText(x, y, msg, color = '#ffffff') {
    const t = this.scene.add.text(x, y, msg, {
      fontSize: '22px', color, fontFamily: 'Jua, sans-serif',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5);
    this.scene.tweens.add({
      targets: t, y: y - 60, alpha: 0, scaleX: 1.3, scaleY: 1.3,
      duration: 1200, ease: 'Power2',
      onComplete: () => t.destroy(),
    });
  }
}
