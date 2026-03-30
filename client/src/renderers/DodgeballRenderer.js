import { BaseRenderer } from './BaseRenderer.js';
import sound from '../audio/SoundManager.js';

/**
 * DodgeballRenderer - Renders the Dodgeball (피구) game mode.
 * Balls bounce around the field; players must dodge them.
 * Getting hit eliminates a player. Last one standing wins.
 * Dashing grants brief invincibility.
 */
export class DodgeballRenderer extends BaseRenderer {
  constructor(scene) {
    super(scene);
    this._ballGraphics = new Map(); // ballId -> { container, glow }
    this._warningText = null;
    this._ballCountText = null;
  }

  create() {
    const scene = this.scene;
    const W = scene.mapWidth;
    const H = scene.mapHeight;

    // --- Warning text (shown when ball is near) ---
    this._warningText = scene.add.text(W / 2, H / 2 - 40, '', {
      fontSize: '20px', color: '#ff4444', fontFamily: 'Jua, sans-serif',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(30).setAlpha(0);

    // --- Ball count indicator ---
    this._ballCountText = scene.add.text(W / 2, 26, '', {
      fontSize: '12px', color: '#ff8844', fontFamily: 'Jua, sans-serif',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(30);
  }

  onGameState(state) {
    const scene = this.scene;
    const balls = state.balls || [];

    // --- Sync ball graphics ---
    const activeBallIds = new Set();
    for (const ball of balls) {
      activeBallIds.add(ball.id);

      if (this._ballGraphics.has(ball.id)) {
        // Lerp existing ball position
        const bg = this._ballGraphics.get(ball.id);
        bg.container.x += (ball.x - bg.container.x) * 0.5;
        bg.container.y += (ball.y - bg.container.y) * 0.5;
        bg.glow.x = bg.container.x;
        bg.glow.y = bg.container.y;
      } else {
        // Create new ball graphic
        const container = scene.add.container(ball.x, ball.y).setDepth(25);

        // Ball body — red circle
        const body = scene.add.circle(0, 0, 10, 0xdd2222);
        const highlight = scene.add.circle(-3, -3, 4, 0xff6666, 0.5);
        // White stripe for dodgeball look
        const stripe = scene.add.graphics();
        stripe.lineStyle(2, 0xffffff, 0.4);
        stripe.beginPath();
        stripe.arc(0, 0, 8, -0.5, 0.5);
        stripe.strokePath();
        container.add([body, highlight, stripe]);

        // Glow
        const glow = scene.add.circle(ball.x, ball.y, 18, 0xff4400, 0.12).setDepth(24);
        scene.tweens.add({
          targets: glow,
          scaleX: 1.4, scaleY: 1.4, alpha: 0.04,
          yoyo: true, repeat: -1, duration: 500, ease: 'Sine.easeInOut',
        });

        this._ballGraphics.set(ball.id, { container, glow });
      }
    }

    // Remove disappeared balls
    for (const [id, bg] of this._ballGraphics) {
      if (!activeBallIds.has(id)) {
        bg.container.destroy();
        bg.glow.destroy();
        this._ballGraphics.delete(id);
      }
    }

    // --- Ball count ---
    this._ballCountText.setText(`\uacf5 ${balls.length}\uac1c`);

    // --- Proximity warning for local player ---
    const myId = scene.myId;
    const me = state.players.find(p => p.id === myId);
    if (me && !me.eliminated) {
      let minDist = Infinity;
      for (const ball of balls) {
        const dx = me.x - ball.x;
        const dy = me.y - ball.y;
        minDist = Math.min(minDist, Math.sqrt(dx * dx + dy * dy));
      }
      if (minDist < 60) {
        this._warningText.setText('\u26a0 \uc704\ud5d8!');
        this._warningText.setAlpha(0.6 + Math.sin(Date.now() / 120) * 0.4);
      } else {
        this._warningText.setAlpha(0);
      }
    } else {
      this._warningText.setAlpha(0);
    }

    // --- Gray out eliminated players ---
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

    if (ev.type === 'dodgeball_hit') {
      sound.elimination();
      scene.cameras.main.shake(300, 0.012);

      const px = ev.x || 0;
      const py = ev.y || 0;

      // Red burst particles
      for (let i = 0; i < 10; i++) {
        const ang = (i / 10) * Math.PI * 2;
        const particle = scene.add.circle(px, py, 5, 0xff4444, 0.8).setDepth(40);
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

    } else if (ev.type === 'ball_spawn') {
      sound.spawn();

      if (ev.ball) {
        // Expanding ring effect at spawn
        const ring = scene.add.circle(ev.ball.x, ev.ball.y, 10, 0xffaa00, 0.5).setDepth(23);
        scene.tweens.add({
          targets: ring,
          scaleX: 4, scaleY: 4, alpha: 0,
          duration: 500, ease: 'Power2',
          onComplete: () => ring.destroy(),
        });
      }

    } else if (ev.type === 'dodgeball_push') {
      scene.cameras.main.shake(100, 0.005);
    }
  }

  formatScoreboard(players, myId) {
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
    for (const [, bg] of this._ballGraphics) {
      bg.container.destroy();
      bg.glow.destroy();
    }
    this._ballGraphics.clear();
    if (this._warningText) { this._warningText.destroy(); this._warningText = null; }
    if (this._ballCountText) { this._ballCountText.destroy(); this._ballCountText = null; }
  }

  // --- Internal helpers ---

}
