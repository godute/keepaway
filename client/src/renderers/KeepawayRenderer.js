import { BaseRenderer } from './BaseRenderer.js';
import sound from '../audio/SoundManager.js';

/**
 * KeepawayRenderer - Renders bone pickup game mode.
 * Players chase a bone on the field; holding it accumulates score.
 * First to 30 points wins.
 */
export class KeepawayRenderer extends BaseRenderer {
  constructor(scene) {
    super(scene);
    this.boneGraphic = null;
    this.boneGlow = null;
    this._nearWinText = null;
    this._winBadgeBg = null;
    this._winBadgeText = null;
  }

  create() {
    const scene = this.scene;
    const W = scene.mapWidth;

    // --- Bone glow ---
    this.boneGlow = scene.add.circle(0, 0, 30, 0xffd700, 0.15).setDepth(20);
    scene.tweens.add({
      targets: this.boneGlow,
      scaleX: 1.4, scaleY: 1.4, alpha: 0.05,
      yoyo: true, repeat: -1, duration: 800, ease: 'Sine.easeInOut',
    });

    // --- Bone graphic container ---
    this.boneGraphic = scene.add.container(0, 0).setDepth(20);
    const boneL = scene.add.circle(-8, 0, 7, 0xfff8dc);
    const boneR = scene.add.circle(8, 0, 7, 0xfff8dc);
    const boneM = scene.add.rectangle(0, 0, 16, 8, 0xfff8dc).setOrigin(0.5);
    const boneHL = scene.add.circle(-4, -3, 3, 0xffffff, 0.4);
    const sparkle = scene.add.star(12, -10, 4, 3, 7, 0xffd700);
    scene.tweens.add({
      targets: sparkle,
      alpha: 0, scaleX: 0.3, scaleY: 0.3,
      yoyo: true, repeat: -1, duration: 600, delay: 200,
    });
    this.boneGraphic.add([boneL, boneR, boneM, boneHL, sparkle]);
    this.boneGraphic.setVisible(false);
    this.boneGlow.setVisible(false);

    // --- Win condition badge ---
    this._winBadgeBg = scene.add.graphics();
    this._winBadgeBg.fillStyle(0x000000, 0.45);
    this._winBadgeBg.fillRoundedRect(W / 2 - 75, 6, 150, 24, 8);
    this._winBadgeText = scene.add.text(W / 2, 18, '\u{1F9B4} 30\uc810 \ub2ec\uc131 \uc2dc \uc2b9\ub9ac!', {
      fontSize: '11px', color: '#ffd700', fontFamily: 'Jua, sans-serif',
    }).setOrigin(0.5);

    // --- Near-win warning text (hidden by default) ---
    this._nearWinText = scene.add.text(W / 2, 40, '', {
      fontSize: '16px', color: '#ff4444', fontFamily: 'Jua, sans-serif',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setAlpha(0);
  }

  onGameState(state) {
    const scene = this.scene;

    // Update bone position / visibility
    if (state.bone) {
      this.boneGraphic.setPosition(state.bone.x, state.bone.y).setVisible(true);
      this.boneGlow.setPosition(state.bone.x, state.bone.y).setVisible(true);
      this.boneGraphic.rotation += 0.02;
    } else {
      this.boneGraphic.setVisible(false);
      this.boneGlow.setVisible(false);
    }

    // Near-win warning
    const sorted = state.players.slice().sort((a, b) => b.score - a.score);
    if (sorted.length > 0 && sorted[0].score >= 20) {
      const leader = sorted[0];
      this._nearWinText.setText(`\u{1F525} ${leader.name} \uac70\uc758 \uc2b9\ub9ac! (${Math.floor(leader.score)}/30)`);
      this._nearWinText.setAlpha(0.6 + Math.sin(Date.now() / 200) * 0.4);
    } else {
      this._nearWinText.setAlpha(0);
    }
  }

  onGameEvent(ev) {
    const scene = this.scene;

    if (ev.type === 'bone_taken') {
      sound.boneTaken();
      const p = scene.gameState?.players.find(pl => pl.id === ev.playerId);
      if (p) {
        this._showFloatingText(p.x, p.y - 50, '\u{1F9B4} \ud68d\ub4dd!', '#ffd700');
        const ring = scene.add.circle(p.x, p.y, 10, 0xffd700, 0.5);
        scene.tweens.add({
          targets: ring,
          scaleX: 3, scaleY: 3, alpha: 0,
          duration: 600,
          onComplete: () => ring.destroy(),
        });
      }

    } else if (ev.type === 'bone_dropped') {
      sound.boneDropped();
      scene.cameras.main.shake(200, 0.008);

      if (ev.bone) {
        for (let i = 0; i < 8; i++) {
          const ang = (i / 8) * Math.PI * 2;
          const particle = scene.add.circle(ev.bone.x, ev.bone.y, 4, 0xff6644, 0.8);
          scene.tweens.add({
            targets: particle,
            x: ev.bone.x + Math.cos(ang) * 50,
            y: ev.bone.y + Math.sin(ang) * 50,
            alpha: 0, scaleX: 0.2, scaleY: 0.2,
            duration: 500, ease: 'Power2',
            onComplete: () => particle.destroy(),
          });
        }
      }
      this._showFloatingText(scene.mapWidth / 2, 70, '\ud83d\udca5 \ubf08\ub2e4\uadc0 \ube7c\uc557\uae40!', '#ff4444');

    } else if (ev.type === 'bone_spawned') {
      sound.pickup();
    }
  }

  formatScoreboard(players, myId) {
    const sorted = players.slice().sort((a, b) => b.score - a.score);
    return sorted.map((p, i) => {
      const bone = p.hasBone ? ' \u{1F9B4}' : '';
      const me = p.id === myId ? ' \u25c0' : '';
      const medal = i === 0 ? '\u{1F947}' : i === 1 ? '\u{1F948}' : i === 2 ? '\u{1F949}' : '   ';
      return `${medal} ${p.name}${bone}${me}  ${Math.floor(p.score)}/30`;
    });
  }

  destroy() {
    if (this.boneGraphic) { this.boneGraphic.destroy(); this.boneGraphic = null; }
    if (this.boneGlow) { this.boneGlow.destroy(); this.boneGlow = null; }
    if (this._nearWinText) { this._nearWinText.destroy(); this._nearWinText = null; }
    if (this._winBadgeBg) { this._winBadgeBg.destroy(); this._winBadgeBg = null; }
    if (this._winBadgeText) { this._winBadgeText.destroy(); this._winBadgeText = null; }
  }

  // --- Internal helpers ---

}
