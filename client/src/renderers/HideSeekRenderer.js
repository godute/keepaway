import { BaseRenderer } from './BaseRenderer.js';
import sound from '../audio/SoundManager.js';

/**
 * HideSeekRenderer - Renders the Hide & Seek (숨바꼭질) game mode.
 * Seeker has limited vision (fog of war). Hiders must stay hidden.
 */
export class HideSeekRenderer extends BaseRenderer {
  constructor(scene) {
    super(scene);
    this._fogGraphic = null;
    this._hidePhaseText = null;
    this._roleText = null;
    this._seekRadius = 150;
    this._seekerId = null;
    this._timerText = null;
  }

  onGameStart(data) {
    this._seekerId = data.seekerId;
    this._seekRadius = data.seekRadius || 150;
  }

  create() {
    const scene = this.scene;
    const W = scene.mapWidth;
    const H = scene.mapHeight;

    // Fog of war overlay (drawn on top of everything for seeker)
    this._fogGraphic = scene.add.graphics().setDepth(50);

    // Hide phase countdown text
    this._hidePhaseText = scene.add.text(W / 2, H / 2 - 60, '', {
      fontSize: '48px', color: '#ffd700', fontFamily: 'Jua, sans-serif',
      stroke: '#000000', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(100).setAlpha(0);

    // Role announcement
    this._roleText = scene.add.text(W / 2, 30, '', {
      fontSize: '20px', color: '#ffffff', fontFamily: 'Jua, sans-serif',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(100);

    // Timer text
    this._timerText = scene.add.text(W / 2, H - 20, '', {
      fontSize: '18px', color: '#ffffff', fontFamily: 'Jua, sans-serif',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(100);
  }

  onGameState(state) {
    const scene = this.scene;
    const myId = scene.myId;
    const isSeeker = myId === state.seekerId;
    this._seekerId = state.seekerId;

    // Role text
    this._roleText.setText(isSeeker ? '👁 술래 — 숨은 이들을 찾아라!' : '🙈 숨는 이 — 들키지 마라!');
    this._roleText.setColor(isSeeker ? '#ff6644' : '#44ff88');

    // Hide phase
    if (state.hidePhaseTimer > 0) {
      if (isSeeker) {
        this._hidePhaseText.setText(`눈 감는 중... ${state.hidePhaseTimer}`);
        this._hidePhaseText.setAlpha(1);
      } else {
        this._hidePhaseText.setText(`숨어라! ${state.hidePhaseTimer}`);
        this._hidePhaseText.setAlpha(1);
      }
    } else {
      this._hidePhaseText.setAlpha(0);
    }

    // Timer
    const t = state.timeRemaining;
    if (t !== undefined && state.hidePhaseTimer <= 0) {
      this._timerText.setText(`⏱ ${t}초`);
      if (t <= 10) {
        this._timerText.setColor('#ff4444');
        this._timerText.setAlpha(0.7 + Math.sin(Date.now() / 200) * 0.3);
      } else {
        this._timerText.setColor('#ffffff');
        this._timerText.setAlpha(0.8);
      }
    } else {
      this._timerText.setAlpha(0);
    }

    // Fog of war: if local player is seeker, hide distant hiders and draw darkness
    this._fogGraphic.clear();

    if (isSeeker) {
      const me = state.players.find(p => p.id === myId);
      if (me) {
        const seekR = state.seekRadius || this._seekRadius;

        // Draw fog overlay (dark around seeker vision)
        this._fogGraphic.fillStyle(0x000000, 0.7);
        this._fogGraphic.fillRect(0, 0, scene.mapWidth, scene.mapHeight);

        // Cut out visible circle using clear blend (draw brighter circle)
        // Use a radial gradient effect with concentric circles
        const steps = 12;
        for (let i = steps; i >= 0; i--) {
          const r = seekR * (0.8 + 0.2 * (i / steps));
          const alpha = 0.7 * (i / steps);
          this._fogGraphic.fillStyle(0x000000, alpha);
          this._fogGraphic.fillCircle(me.x, me.y, r);
        }
        // Clear center completely
        this._fogGraphic.fillStyle(0x000000, 0);
        // Use a "light" by overlaying with the scene background approach
        // Actually, erase the fog in the visible area by redrawing
        this._drawVisionHole(me.x, me.y, seekR);

        // Hide hiders that are outside seek radius
        for (const p of state.players) {
          if (p.id === myId) continue;
          if (state.foundPlayers?.includes(p.id)) continue;
          const pg = scene.playerGraphics.get(p.id);
          if (!pg) continue;

          const dx = p.x - me.x;
          const dy = p.y - me.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist > seekR) {
            pg.container.setVisible(false);
            pg.nameText.setVisible(false);
          } else {
            pg.container.setVisible(true);
            pg.nameText.setVisible(true);
          }
        }
      }
    } else {
      // Hiders see everything - make sure all players visible
      for (const p of state.players) {
        const pg = scene.playerGraphics.get(p.id);
        if (pg) {
          pg.container.setVisible(true);
          pg.nameText.setVisible(true);
        }
      }
    }

    // Gray out found/eliminated players
    for (const p of state.players) {
      const pg = scene.playerGraphics.get(p.id);
      if (!pg) continue;
      if (state.foundPlayers?.includes(p.id)) {
        pg.container.setAlpha(0.3);
      } else if (pg.container.visible) {
        pg.container.setAlpha(1);
      }
    }
  }

  _drawVisionHole(cx, cy, radius) {
    // Redraw the fog with a hole: clear the graphics and redraw with exclusion
    this._fogGraphic.clear();

    const W = this.scene.mapWidth;
    const H = this.scene.mapHeight;

    // Draw dark fog everywhere except vision circle
    // Use a series of rects around the circle for approximate cutout
    // Top
    this._fogGraphic.fillStyle(0x000000, 0.7);
    if (cy - radius > 0) {
      this._fogGraphic.fillRect(0, 0, W, Math.max(0, cy - radius));
    }
    // Bottom
    if (cy + radius < H) {
      this._fogGraphic.fillRect(0, cy + radius, W, H - cy - radius);
    }
    // Left strip (between top and bottom fog)
    const fogTop = Math.max(0, cy - radius);
    const fogBot = Math.min(H, cy + radius);
    const fogH = fogBot - fogTop;

    // Draw row by row approximation
    const step = 4;
    for (let y = fogTop; y < fogBot; y += step) {
      const dy = y - cy;
      const halfW = Math.sqrt(Math.max(0, radius * radius - dy * dy));
      const left = cx - halfW;
      const right = cx + halfW;

      if (left > 0) {
        this._fogGraphic.fillRect(0, y, left, step);
      }
      if (right < W) {
        this._fogGraphic.fillRect(right, y, W - right, step);
      }
    }

    // Soft edge: semi-transparent ring around vision
    for (let i = 0; i < 5; i++) {
      const r = radius - i * 4;
      const a = 0.15 - i * 0.03;
      if (r > 0 && a > 0) {
        this._fogGraphic.lineStyle(6, 0x000000, a);
        this._fogGraphic.strokeCircle(cx, cy, r);
      }
    }
  }

  onGameEvent(ev) {
    const scene = this.scene;

    if (ev.type === 'hideseek_found') {
      sound.elimination();
      scene.cameras.main.shake(300, 0.012);

      const pg = scene.playerGraphics.get(ev.hiderId);
      if (pg) {
        const px = pg.container.x;
        const py = pg.container.y;
        // Make visible briefly for the reveal effect
        pg.container.setVisible(true);
        pg.nameText.setVisible(true);

        // Red burst particles
        for (let i = 0; i < 10; i++) {
          const ang = (i / 10) * Math.PI * 2;
          const particle = scene.add.circle(px, py, 5, 0xff4444, 0.8).setDepth(60);
          scene.tweens.add({
            targets: particle,
            x: px + Math.cos(ang) * 60,
            y: py + Math.sin(ang) * 60,
            alpha: 0, scaleX: 0.2, scaleY: 0.2,
            duration: 600, ease: 'Power2',
            onComplete: () => particle.destroy(),
          });
        }
        this._showFloatingText(px, py - 40, '👁 발견!', '#ff4444');
      }
    }
  }

  drawPlayerScoreBar(g, p, tx, ty) {
    // Hide score bars entirely — they reveal hider positions to seeker
    g.scoreBar.clear();
  }

  formatScoreboard(players, myId) {
    const seekerId = this._seekerId;
    const sorted = players.slice().sort((a, b) => {
      // Seeker first, then by score
      if (a.id === seekerId) return -1;
      if (b.id === seekerId) return 1;
      if (a.isEliminated && !b.isEliminated) return 1;
      if (!a.isEliminated && b.isEliminated) return -1;
      return b.score - a.score;
    });

    return sorted.map(p => {
      const me = p.id === myId ? ' ◀' : '';
      if (p.id === seekerId) {
        return `👁 ${p.name} (술래)${me}`;
      }
      const status = p.isEliminated ? '❌' : '🙈';
      return `${status} ${p.name} ${Math.floor(p.score)}초${me}`;
    });
  }

  destroy() {
    if (this._fogGraphic) { this._fogGraphic.destroy(); this._fogGraphic = null; }
    if (this._hidePhaseText) { this._hidePhaseText.destroy(); this._hidePhaseText = null; }
    if (this._roleText) { this._roleText.destroy(); this._roleText = null; }
    if (this._timerText) { this._timerText.destroy(); this._timerText = null; }
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
