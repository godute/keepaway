import { BaseRenderer } from './BaseRenderer.js';
import sound from '../audio/SoundManager.js';

/**
 * HotPotatoRenderer - Renders the Hot Potato (폭탄 돌리기) game mode.
 * A bomb is passed between players. When the timer expires, the bomb
 * explodes and the holder is eliminated. Last player standing wins.
 */
export class HotPotatoRenderer extends BaseRenderer {
  constructor(scene) {
    super(scene);
    this._bombGraphic = null;
    this._bombGlow = null;
    this._timerBar = null;
    this._timerBarBg = null;
    this._roundText = null;
    this._bombPulseTween = null;
    this._currentBombHolderId = null;
  }

  create() {
    const scene = this.scene;
    const W = scene.mapWidth;

    // --- Bomb graphic container ---
    this._bombGraphic = scene.add.container(0, 0).setDepth(25).setVisible(false);

    // Bomb body (dark circle with orange/red tint)
    const bombBody = scene.add.circle(0, 0, 10, 0x333333);
    const bombHighlight = scene.add.circle(-3, -3, 4, 0x666666, 0.5);

    // Fuse (small line on top)
    const fuse = scene.add.graphics();
    fuse.lineStyle(2, 0xaa8833, 1);
    fuse.beginPath();
    fuse.moveTo(0, -10);
    fuse.lineTo(3, -16);
    fuse.lineTo(-1, -20);
    fuse.strokePath();

    // Fuse spark
    const spark = scene.add.circle(-1, -20, 3, 0xff6600, 1);
    scene.tweens.add({
      targets: spark,
      alpha: 0.3, scaleX: 0.5, scaleY: 0.5,
      yoyo: true, repeat: -1, duration: 150,
    });

    this._bombGraphic.add([bombBody, bombHighlight, fuse, spark]);

    // Bomb glow (pulsing)
    this._bombGlow = scene.add.circle(0, 0, 20, 0xff4400, 0.15).setDepth(24).setVisible(false);
    this._bombPulseTween = scene.tweens.add({
      targets: this._bombGlow,
      scaleX: 1.5, scaleY: 1.5, alpha: 0.05,
      yoyo: true, repeat: -1, duration: 600, ease: 'Sine.easeInOut',
    });

    // --- Timer bar (top center) ---
    const barW = 200;
    const barH = 10;
    const barX = W / 2 - barW / 2;
    const barY = 8;

    this._timerBarBg = scene.add.graphics().setDepth(30);
    this._timerBarBg.fillStyle(0x333333, 0.6);
    this._timerBarBg.fillRoundedRect(barX, barY, barW, barH, 4);

    this._timerBar = scene.add.graphics().setDepth(31);

    // --- Round indicator text ---
    this._roundText = scene.add.text(W / 2, 26, '', {
      fontSize: '12px', color: '#ffcc00', fontFamily: 'Jua, sans-serif',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(30);
  }

  onGameState(state) {
    const scene = this.scene;
    const W = scene.mapWidth;

    const bombHolderId = state.bombHolderId;
    this._currentBombHolderId = bombHolderId;

    // Move bomb above bomb holder
    if (bombHolderId) {
      const pg = scene.playerGraphics.get(bombHolderId);
      if (pg) {
        const bx = pg.container.x;
        const by = pg.container.y - 30;
        this._bombGraphic.setPosition(bx, by).setVisible(true);
        this._bombGlow.setPosition(bx, by).setVisible(true);
      }
    } else {
      this._bombGraphic.setVisible(false);
      this._bombGlow.setVisible(false);
    }

    // Pulse bomb faster as timer decreases
    const timeLeft = state.bombTimer != null ? state.bombTimer : 1;
    const maxTime = state.bombTimerMax || 10;
    const ratio = Math.max(0, timeLeft / maxTime);

    // Adjust glow pulse speed - faster as time runs out
    if (this._bombPulseTween) {
      const newDuration = Math.max(80, 600 * ratio);
      this._bombPulseTween.timeScale = 600 / newDuration;
    }

    // Update timer bar
    this._timerBar.clear();
    const barW = 200;
    const barH = 10;
    const barX = W / 2 - barW / 2;
    const barY = 8;

    // Color transitions from green to red
    const r = Math.floor(255 * (1 - ratio));
    const g = Math.floor(255 * ratio);
    const barColor = (r << 16) | (g << 8) | 0;
    this._timerBar.fillStyle(barColor, 0.9);
    this._timerBar.fillRoundedRect(barX, barY, barW * ratio, barH, 4);

    // Round indicator
    const round = state.round || 1;
    const totalRounds = state.totalRounds || '?';
    this._roundText.setText(`\ub77c\uc6b4\ub4dc ${round}/${totalRounds}`);

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
    const W = scene.mapWidth;
    const H = scene.mapHeight;

    if (ev.type === 'bomb_transfer') {
      // Whoosh sound
      sound.collision();

      // Visual whoosh trail between old and new holder
      if (ev.fromId && ev.toId) {
        const from = scene.playerGraphics.get(ev.fromId);
        const to = scene.playerGraphics.get(ev.toId);
        if (from && to) {
          const trail = scene.add.graphics().setDepth(22);
          trail.lineStyle(3, 0xff6600, 0.6);
          trail.lineBetween(from.container.x, from.container.y, to.container.x, to.container.y);
          scene.tweens.add({
            targets: trail, alpha: 0, duration: 400,
            onComplete: () => trail.destroy(),
          });
        }
      }

    } else if (ev.type === 'bomb_explode') {
      // Big explosion
      sound.elimination();
      scene.cameras.main.shake(500, 0.02);

      const pg = ev.playerId ? scene.playerGraphics.get(ev.playerId) : null;
      const ex = pg ? pg.container.x : W / 2;
      const ey = pg ? pg.container.y : H / 2;

      // Explosion flash
      const flash = scene.add.circle(ex, ey, 15, 0xff6600, 0.9).setDepth(40);
      scene.tweens.add({
        targets: flash,
        scaleX: 8, scaleY: 8, alpha: 0,
        duration: 600, ease: 'Power2',
        onComplete: () => flash.destroy(),
      });

      // Explosion particles
      for (let i = 0; i < 16; i++) {
        const ang = (i / 16) * Math.PI * 2;
        const dist = Phaser.Math.Between(40, 100);
        const colors = [0xff4400, 0xff6600, 0xffaa00, 0xff2200];
        const c = Phaser.Math.RND.pick(colors);
        const size = Phaser.Math.Between(3, 7);
        const particle = scene.add.circle(ex, ey, size, c, 0.9).setDepth(41);
        scene.tweens.add({
          targets: particle,
          x: ex + Math.cos(ang) * dist,
          y: ey + Math.sin(ang) * dist,
          alpha: 0, scaleX: 0.1, scaleY: 0.1,
          duration: Phaser.Math.Between(400, 800), ease: 'Power2',
          onComplete: () => particle.destroy(),
        });
      }

      this._showFloatingText(ex, ey - 40, '\ud83d\udca5 \ud3ed\ubc1c!', '#ff4400');

    } else if (ev.type === 'round_start') {
      // Announce new round
      const round = ev.round || '?';
      this._showFloatingText(W / 2, H / 2, `\ub77c\uc6b4\ub4dc ${round} \uc2dc\uc791!`, '#ffcc00');
      sound.boneTaken();
    }
  }

  formatScoreboard(players, myId) {
    // Alive first, then eliminated
    const sorted = players.slice().sort((a, b) => {
      if (a.eliminated && !b.eliminated) return 1;
      if (!a.eliminated && b.eliminated) return -1;
      return 0;
    });
    return sorted.map((p) => {
      const me = p.id === myId ? ' \u25c0' : '';
      const bomb = p.id === this._currentBombHolderId ? ' \ud83d\udca3' : '';
      const status = p.eliminated ? ' \u274c' : '';
      return `${status || '\u2705'} ${p.name}${bomb}${me}`;
    });
  }

  destroy() {
    if (this._bombGraphic) { this._bombGraphic.destroy(); this._bombGraphic = null; }
    if (this._bombGlow) { this._bombGlow.destroy(); this._bombGlow = null; }
    if (this._timerBar) { this._timerBar.destroy(); this._timerBar = null; }
    if (this._timerBarBg) { this._timerBarBg.destroy(); this._timerBarBg = null; }
    if (this._roundText) { this._roundText.destroy(); this._roundText = null; }
    this._bombPulseTween = null;
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
