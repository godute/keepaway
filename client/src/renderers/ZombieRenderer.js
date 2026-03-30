import { BaseRenderer } from './BaseRenderer.js';
import sound from '../audio/SoundManager.js';

/**
 * ZombieRenderer - Renders the Zombie Infection (좀비 감염) game mode.
 * Zombies touch to infect. Survivors can dash (immune) or push others (stun).
 * Zombies roar to slow nearby survivors.
 */
export class ZombieRenderer extends BaseRenderer {
  constructor(scene) {
    super(scene);
    this._zombieOverlays = new Map();  // playerId -> { emoji }
    this._stunOverlays = new Map();    // playerId -> { emoji, ring }
    this._timerBg = null;
    this._timerText = null;
    this._countText = null;
    this._roleText = null;
  }

  create() {
    const scene = this.scene;
    const W = scene.mapWidth;

    // Timer background + text
    this._timerBg = scene.add.graphics().setDepth(80);
    this._timerBg.fillStyle(0x000000, 0.5);
    this._timerBg.fillRoundedRect(W / 2 - 90, 4, 180, 44, 10);

    this._timerText = scene.add.text(W / 2, 16, '', {
      fontSize: '22px', color: '#ffffff', fontFamily: 'Jua, sans-serif',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(80);

    this._countText = scene.add.text(W / 2, 38, '', {
      fontSize: '13px', color: '#aaffaa', fontFamily: 'Jua, sans-serif',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(80);

    // Role text (bottom area)
    this._roleText = scene.add.text(W / 2, scene.mapHeight - 20, '', {
      fontSize: '16px', color: '#ffffff', fontFamily: 'Jua, sans-serif',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(80);
  }

  onGameState(state) {
    const scene = this.scene;
    const myId = scene.myId;
    const zombieSet = new Set(state.zombies || []);
    const stunnedSet = new Set(state.stunnedPlayers || []);
    const slowedSet = new Set(state.slowedPlayers || []);

    // --- Zombie/Survivor visuals ---
    for (const p of state.players) {
      const pg = scene.playerGraphics.get(p.id);
      if (!pg) continue;

      if (zombieSet.has(p.id)) {
        // Zombie: green tint + emoji
        pg.container.setTint(0x77cc44);
        if (!this._zombieOverlays.has(p.id)) {
          const emoji = scene.add.text(0, -p.radius - 20, '🧟', {
            fontSize: '16px',
          }).setOrigin(0.5).setDepth(55);
          pg.container.add(emoji);
          this._zombieOverlays.set(p.id, { emoji });
        }
      } else {
        // Survivor: normal or slowed
        if (slowedSet.has(p.id)) {
          pg.container.setTint(0xdddd88);
        } else {
          pg.container.clearTint();
        }
        // Remove zombie overlay if was zombie before (shouldn't happen but safety)
        if (this._zombieOverlays.has(p.id)) {
          const ov = this._zombieOverlays.get(p.id);
          ov.emoji.destroy();
          this._zombieOverlays.delete(p.id);
        }
      }

      // Stun overlay
      if (stunnedSet.has(p.id)) {
        pg.container.setTint(0xffdd44);
        if (!this._stunOverlays.has(p.id)) {
          const emoji = scene.add.text(0, -p.radius - 20, '💫', {
            fontSize: '16px',
          }).setOrigin(0.5).setDepth(55);
          const ring = scene.add.circle(0, 0, p.radius + 6, 0xffdd44, 0).setDepth(9);
          ring.setStrokeStyle(2, 0xffdd44, 0.5);
          scene.tweens.add({
            targets: ring, scaleX: 1.3, scaleY: 1.3, alpha: 0,
            yoyo: true, repeat: -1, duration: 600,
          });
          pg.container.add(emoji);
          pg.container.add(ring);
          this._stunOverlays.set(p.id, { emoji, ring });
        }
      } else if (this._stunOverlays.has(p.id)) {
        const ov = this._stunOverlays.get(p.id);
        scene.tweens.killTweensOf(ov.ring);
        ov.emoji.destroy();
        ov.ring.destroy();
        this._stunOverlays.delete(p.id);
        // Restore tint based on zombie/survivor state
        if (!zombieSet.has(p.id)) pg.container.clearTint();
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

    // --- Count ---
    const survivorCount = state.players.length - (state.zombies?.length || 0);
    const zombieCount = state.zombies?.length || 0;
    this._countText.setText(`🏃 ${survivorCount}명  /  🧟 ${zombieCount}명`);

    // --- Role ---
    const isZombie = zombieSet.has(myId);
    this._roleText.setText(isZombie ? '🧟 좀비 — 만져서 감염시켜라!' : '🏃 생존자 — 대시로 도망! 밀쳐서 배신!');
    this._roleText.setColor(isZombie ? '#77cc44' : '#ffffff');
  }

  onGameEvent(ev) {
    const scene = this.scene;

    if (ev.type === 'zombie_infection') {
      sound.elimination();
      scene.cameras.main.shake(300, 0.012);

      // Green burst particles
      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * Math.PI * 2;
        const colors = [0x77cc44, 0x55aa33, 0x99ee66];
        const particle = scene.add.circle(ev.x, ev.y, 5, colors[i % 3], 0.8).setDepth(60);
        scene.tweens.add({
          targets: particle,
          x: ev.x + Math.cos(ang) * 60,
          y: ev.y + Math.sin(ang) * 60,
          alpha: 0, scaleX: 0.2, scaleY: 0.2,
          duration: 600, ease: 'Power2',
          onComplete: () => particle.destroy(),
        });
      }
      this._showFloatingText(ev.x, ev.y - 40, '🧟 감염!', '#77cc44');

      // Green flash if I got infected
      if (ev.newZombieId === scene.myId) {
        const flash = scene.add.rectangle(scene.mapWidth / 2, scene.mapHeight / 2,
          scene.mapWidth, scene.mapHeight, 0x55aa33, 0.3).setDepth(90);
        scene.tweens.add({
          targets: flash, alpha: 0, duration: 500,
          onComplete: () => flash.destroy(),
        });
      }

    } else if (ev.type === 'zombie_push') {
      sound.collision();
      scene.cameras.main.shake(150, 0.006);
      this._showFloatingText(ev.x, ev.y - 40, '💨 밀침!', '#ffdd44');

    } else if (ev.type === 'zombie_roar') {
      sound.countdown();
      // Green shockwave ring expanding outward
      const ring = scene.add.circle(ev.x, ev.y, 10, 0x77cc44, 0).setDepth(40);
      ring.setStrokeStyle(4, 0x77cc44, 0.6);
      scene.tweens.add({
        targets: ring,
        scaleX: 12, scaleY: 12, // 10px * 12 = 120px radius
        alpha: 0,
        duration: 500, ease: 'Power2',
        onComplete: () => ring.destroy(),
      });
      this._showFloatingText(ev.x, ev.y - 50, '🗣️ 포효!', '#77cc44');
    }
  }

  drawPlayerScoreBar(g, p, tx, ty) {
    g.scoreBar.clear();
  }

  formatScoreboard(players, myId) {
    // Survivors first, then zombies
    const sorted = players.slice().sort((a, b) => {
      const aZ = a.name?.startsWith('🧟') ? 1 : 0;
      const bZ = b.name?.startsWith('🧟') ? 1 : 0;
      if (aZ !== bZ) return aZ - bZ;
      return (b.score || 0) - (a.score || 0);
    });

    return sorted.map(p => {
      const me = p.id === myId ? ' ◀' : '';
      const time = Math.floor(p.score || 0);
      return `${p.name}${me}  ${time}초`;
    });
  }

  destroy() {
    for (const [, ov] of this._zombieOverlays) { ov.emoji.destroy(); }
    this._zombieOverlays.clear();
    for (const [, ov] of this._stunOverlays) {
      ov.emoji.destroy();
      ov.ring.destroy();
    }
    this._stunOverlays.clear();
    if (this._timerBg) { this._timerBg.destroy(); this._timerBg = null; }
    if (this._timerText) { this._timerText.destroy(); this._timerText = null; }
    if (this._countText) { this._countText.destroy(); this._countText = null; }
    if (this._roleText) { this._roleText.destroy(); this._roleText = null; }
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
