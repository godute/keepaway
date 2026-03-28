import { BaseRenderer } from './BaseRenderer.js';
import sound from '../audio/SoundManager.js';

/**
 * TagRenderer - Renders the Tag (술래잡기) game mode.
 * One player is "it" (술래) and must tag others. The player who
 * spends the least total time as "it" wins.
 */
export class TagRenderer extends BaseRenderer {
  constructor(scene) {
    super(scene);
    this._timerText = null;
    this._itBadge = null;
    this._currentItId = null;
  }

  create() {
    const scene = this.scene;
    const W = scene.mapWidth;

    // --- Timer text (top center) ---
    this._timerText = scene.add.text(W / 2, 14, '', {
      fontSize: '18px', color: '#ffffff', fontFamily: 'Jua, sans-serif',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(30);

    // --- "술래!" badge (follows the tagged player) ---
    this._itBadge = scene.add.text(0, 0, '\uc220\ub798!', {
      fontSize: '14px', color: '#ff4444', fontFamily: 'Jua, sans-serif',
      stroke: '#000000', strokeThickness: 3,
      backgroundColor: '#00000088',
      padding: { x: 6, y: 2 },
    }).setOrigin(0.5).setDepth(35).setVisible(false);
  }

  onGameState(state) {
    const scene = this.scene;

    // Update timer display
    const remaining = state.timeRemaining != null ? state.timeRemaining : 0;
    const mins = Math.floor(remaining / 60);
    const secs = Math.floor(remaining % 60);
    const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;
    this._timerText.setText(`\u23f1 ${timeStr}`);

    // Flash timer red when under 10 seconds
    if (remaining <= 10 && remaining > 0) {
      this._timerText.setColor('#ff4444');
      this._timerText.setAlpha(0.6 + Math.sin(Date.now() / 200) * 0.4);
    } else {
      this._timerText.setColor('#ffffff');
      this._timerText.setAlpha(1);
    }

    // Move "술래" badge above the it-player's character
    const itId = state.itPlayerId;
    this._currentItId = itId;

    if (itId) {
      const pg = scene.playerGraphics.get(itId);
      if (pg) {
        this._itBadge.setPosition(pg.container.x, pg.container.y - 32);
        this._itBadge.setVisible(true);
      } else {
        this._itBadge.setVisible(false);
      }
    } else {
      this._itBadge.setVisible(false);
    }
  }

  onGameEvent(ev) {
    const scene = this.scene;

    if (ev.type === 'tag_transfer') {
      // Flash effect on screen
      const W = scene.mapWidth;
      const H = scene.mapHeight;
      const flash = scene.add.rectangle(W / 2, H / 2, W, H, 0xff4444, 0.3).setDepth(40);
      scene.tweens.add({
        targets: flash,
        alpha: 0,
        duration: 300,
        onComplete: () => flash.destroy(),
      });

      // Play a quick alert sound
      sound.boneTaken();

      // Floating text at the new it-player
      if (ev.newItId) {
        const pg = scene.playerGraphics.get(ev.newItId);
        if (pg) {
          this._showFloatingText(pg.container.x, pg.container.y - 50, '\uc220\ub798!', '#ff4444');
        }
      }
    }
  }

  formatScoreboard(players, myId) {
    // Sort by it-time ascending (lower is better)
    const sorted = players.slice().sort((a, b) => (a.itTime || 0) - (b.itTime || 0));
    return sorted.map((p, i) => {
      const me = p.id === myId ? ' \u25c0' : '';
      const isIt = p.id === this._currentItId ? ' \uc220\ub798' : '';
      const medal = i === 0 ? '\u{1F947}' : i === 1 ? '\u{1F948}' : i === 2 ? '\u{1F949}' : '   ';
      const itTime = (p.itTime || 0).toFixed(1);
      return `${medal} ${p.name}${isIt}${me}  ${itTime}s`;
    });
  }

  destroy() {
    if (this._timerText) { this._timerText.destroy(); this._timerText = null; }
    if (this._itBadge) { this._itBadge.destroy(); this._itBadge = null; }
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
