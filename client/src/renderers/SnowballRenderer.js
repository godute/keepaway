import { BaseRenderer } from './BaseRenderer.js';
import sound from '../audio/SoundManager.js';

/**
 * SnowballRenderer - Renders the Snowball Fight (눈싸움) game mode.
 * Players throw snowballs by dashing. Hit = 3s freeze. Most hits wins.
 */
export class SnowballRenderer extends BaseRenderer {
  constructor(scene) {
    super(scene);
    this._snowballGraphics = new Map(); // snowballId -> { container, glow }
    this._frozenOverlays = new Map();   // playerId -> { emoji, ring }
    this._timerText = null;
    this._hitText = null;
  }

  create() {
    const scene = this.scene;
    const W = scene.mapWidth;

    // Timer text
    this._timerText = scene.add.text(W / 2, 14, '', {
      fontSize: '18px', color: '#ffffff', fontFamily: 'Jua, sans-serif',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(30);

    // Hit count display
    this._hitText = scene.add.text(W / 2, 34, '', {
      fontSize: '12px', color: '#aaddff', fontFamily: 'Jua, sans-serif',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(30);
  }

  onGameState(state) {
    const scene = this.scene;
    const myId = scene.myId;

    // --- Snowball rendering ---
    const activeIds = new Set();
    const snowballs = state.snowballs || [];

    for (const sb of snowballs) {
      activeIds.add(sb.id);
      let bg = this._snowballGraphics.get(sb.id);

      if (!bg) {
        // Create snowball visual
        const glow = scene.add.circle(0, 0, 18, 0xaaddff, 0.2).setDepth(24);
        const body = scene.add.circle(0, 0, 10, 0xffffff, 0.95).setDepth(25);
        const highlight = scene.add.circle(-3, -3, 3, 0xffffff, 0.6).setDepth(25);
        const container = scene.add.container(sb.x, sb.y, [glow, body, highlight]).setDepth(25);

        bg = { container, glow };
        this._snowballGraphics.set(sb.id, bg);
      }

      // Lerp position
      bg.container.x += (sb.x - bg.container.x) * 0.5;
      bg.container.y += (sb.y - bg.container.y) * 0.5;
    }

    // Remove stale snowballs
    for (const [id, bg] of this._snowballGraphics) {
      if (!activeIds.has(id)) {
        bg.container.destroy();
        bg.glow.destroy();
        this._snowballGraphics.delete(id);
      }
    }

    // --- Frozen player overlays ---
    const frozenSet = new Set(state.frozenPlayers || []);

    for (const p of state.players) {
      const pg = scene.playerGraphics.get(p.id);
      if (!pg) continue;

      if (frozenSet.has(p.id)) {
        pg.container.setTint(0x88bbff);

        if (!this._frozenOverlays.has(p.id)) {
          const emoji = scene.add.text(0, -p.radius - 22, '❄️', {
            fontSize: '18px',
          }).setOrigin(0.5).setDepth(55);

          const ring = scene.add.circle(0, 0, p.radius + 8, 0x88ccff, 0).setDepth(9);
          ring.setStrokeStyle(2, 0x88ccff, 0.6);

          scene.tweens.add({
            targets: ring, scaleX: 1.3, scaleY: 1.3, alpha: 0,
            yoyo: true, repeat: -1, duration: 800, ease: 'Sine.easeInOut',
          });

          pg.container.add(emoji);
          pg.container.add(ring);

          this._frozenOverlays.set(p.id, { emoji, ring });
        }
      } else {
        pg.container.clearTint();

        if (this._frozenOverlays.has(p.id)) {
          const overlay = this._frozenOverlays.get(p.id);
          scene.tweens.killTweensOf(overlay.ring);
          overlay.emoji.destroy();
          overlay.ring.destroy();
          this._frozenOverlays.delete(p.id);
        }
      }
    }

    // --- Timer ---
    const remaining = state.timeRemaining != null ? state.timeRemaining : 0;
    const mins = Math.floor(remaining / 60);
    const secs = Math.floor(remaining % 60);
    this._timerText.setText(`⏱ ${mins}:${secs.toString().padStart(2, '0')}`);

    if (remaining <= 10 && remaining > 0) {
      this._timerText.setColor('#ff4444');
      this._timerText.setAlpha(0.6 + Math.sin(Date.now() / 200) * 0.4);
    } else {
      this._timerText.setColor('#ffffff');
      this._timerText.setAlpha(1);
    }

    // --- Hit count ---
    const hitCounts = state.hitCounts || {};
    const myHits = hitCounts[myId] || 0;
    this._hitText.setText(`❄️ 내 적중: ${myHits}`);
  }

  onGameEvent(ev) {
    const scene = this.scene;

    if (ev.type === 'snowball_hit') {
      sound.elimination();
      scene.cameras.main.shake(250, 0.01);

      // Ice burst particles
      for (let i = 0; i < 10; i++) {
        const ang = (i / 10) * Math.PI * 2;
        const colors = [0xaaddff, 0xffffff, 0x88ccff];
        const color = colors[i % 3];
        const particle = scene.add.circle(ev.x, ev.y, 4, color, 0.8).setDepth(60);
        scene.tweens.add({
          targets: particle,
          x: ev.x + Math.cos(ang) * 55,
          y: ev.y + Math.sin(ang) * 55,
          alpha: 0, scaleX: 0.2, scaleY: 0.2,
          duration: 600, ease: 'Power2',
          onComplete: () => particle.destroy(),
        });
      }
      this._showFloatingText(ev.x, ev.y - 40, '❄️ 빙결!', '#88ccff');

    } else if (ev.type === 'snowball_throw') {
      sound.spawn();
    }
  }

  drawPlayerScoreBar(g, p, tx, ty) {
    g.scoreBar.clear();
    // No default score bar — scoreboard shows hit count
  }

  formatScoreboard(players, myId) {
    const sorted = players.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
    return sorted.map((p, i) => {
      const me = p.id === myId ? ' ◀' : '';
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '   ';
      return `${medal} ${p.name}${me}  ❄️${Math.floor(p.score || 0)}적중`;
    });
  }

  destroy() {
    for (const [, bg] of this._snowballGraphics) {
      bg.container.destroy();
      bg.glow.destroy();
    }
    this._snowballGraphics.clear();

    for (const [, overlay] of this._frozenOverlays) {
      overlay.emoji.destroy();
      overlay.ring.destroy();
    }
    this._frozenOverlays.clear();

    if (this._timerText) { this._timerText.destroy(); this._timerText = null; }
    if (this._hitText) { this._hitText.destroy(); this._hitText = null; }
  }

  _showFloatingText(x, y, msg, color = '#ffffff') {
    const t = this.scene.add.text(x, y, msg, {
      fontSize: '22px', color, fontFamily: 'Jua, sans-serif',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(100);
    this.scene.tweens.add({
      targets: t, y: y - 60, alpha: 0, scaleX: 1.3, scaleY: 1.3,
      duration: 1200, ease: 'Power2',
      onComplete: () => t.destroy(),
    });
  }
}
