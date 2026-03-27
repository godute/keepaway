import Phaser from 'phaser';
import socket from '../network/SocketClient.js';
import { JoystickControl } from '../ui/JoystickControl.js';
import sound from '../audio/SoundManager.js';

const LERP = 0.3;
const DASH_COOLDOWN_MAX = 1.2; // must match server

export class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });
    this.playerGraphics = new Map();
    this.boneGraphic = null;
    this.boneGlow = null;
    this.gameState = null;
    this.joystick = null;
    this.dashPending = false;
    this.mapWidth = 800;
    this.mapHeight = 600;
    this.myId = null;
    this.roomCode = null;
    this._dashTrails = [];
    this._obstacles = [];
    this._muted = false;
  }

  init(data) {
    this.roomCode = data.roomCode;
    this.myName = data.myName;
  }

  create() {
    this.myId = socket.id;
    const W = this.mapWidth, H = this.mapHeight;

    // Init audio on first interaction
    sound.init();
    this.input.on('pointerdown', () => sound.unlock(), this);

    // --- Background ---
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x1a2a1a, 0x1a2a1a, 0x0d1a0d, 0x0d1a0d, 1);
    bg.fillRect(0, 0, W, H);

    const grassG = this.add.graphics();
    grassG.lineStyle(1, 0x2d4a2d, 0.15);
    for (let x = 0; x <= W; x += 40) { grassG.moveTo(x, 0); grassG.lineTo(x, H); }
    for (let y = 0; y <= H; y += 40) { grassG.moveTo(0, y); grassG.lineTo(W, y); }
    grassG.strokePath();

    const centerG = this.add.graphics();
    centerG.lineStyle(2, 0x3a6a3a, 0.2);
    centerG.strokeCircle(W / 2, H / 2, 120);
    centerG.lineStyle(1, 0x3a6a3a, 0.1);
    centerG.strokeCircle(W / 2, H / 2, 60);
    centerG.fillStyle(0x3a6a3a, 0.15);
    centerG.fillCircle(W / 2, H / 2, 5);

    const border = this.add.graphics();
    border.lineStyle(3, 0xffd700, 0.6);
    border.strokeRoundedRect(3, 3, W - 6, H - 6, 8);
    border.lineStyle(8, 0xffd700, 0.08);
    border.strokeRoundedRect(0, 0, W, H, 10);

    for (let i = 0; i < 6; i++) {
      const px = Phaser.Math.Between(50, W - 50);
      const py = Phaser.Math.Between(50, H - 50);
      this.add.text(px, py, '\u{1F43E}', { fontSize: '18px' }).setAlpha(0.06).setAngle(Phaser.Math.Between(-40, 40));
    }

    // --- Obstacles (drawn after receiving game:start) ---
    this._obstacleGraphics = this.add.graphics();

    // --- Bone ---
    this.boneGlow = this.add.circle(0, 0, 30, 0xffd700, 0.15);
    this.tweens.add({ targets: this.boneGlow, scaleX: 1.4, scaleY: 1.4, alpha: 0.05, yoyo: true, repeat: -1, duration: 800, ease: 'Sine.easeInOut' });

    this.boneGraphic = this.add.container(0, 0);
    const boneL = this.add.circle(-8, 0, 7, 0xfff8dc);
    const boneR = this.add.circle(8, 0, 7, 0xfff8dc);
    const boneM = this.add.rectangle(0, 0, 16, 8, 0xfff8dc).setOrigin(0.5);
    const boneHL = this.add.circle(-4, -3, 3, 0xffffff, 0.4);
    const sparkle = this.add.star(12, -10, 4, 3, 7, 0xffd700);
    this.tweens.add({ targets: sparkle, alpha: 0, scaleX: 0.3, scaleY: 0.3, yoyo: true, repeat: -1, duration: 600, delay: 200 });
    this.boneGraphic.add([boneL, boneR, boneM, boneHL, sparkle]);
    this.boneGraphic.setVisible(false);
    this.boneGlow.setVisible(false);

    // --- Scoreboard ---
    this._scorePanel = this.add.graphics();
    this._scorePanel.fillStyle(0x000000, 0.55);
    this._scorePanel.fillRoundedRect(6, 6, 170, 30, 8);
    this.scoreboard = this.add.text(14, 12, '', {
      fontSize: '12px', color: '#ffffff', fontFamily: 'Jua, Consolas, monospace', lineSpacing: 3,
    });

    const badgeBg = this.add.graphics();
    badgeBg.fillStyle(0x000000, 0.4);
    badgeBg.fillRoundedRect(W - 100, 6, 94, 26, 8);
    this.add.text(W - 53, 19, this.roomCode, {
      fontSize: '13px', color: '#ffd700', fontFamily: 'Jua, Consolas',
    }).setOrigin(0.5);

    // --- Mute button ---
    this._muteBtn = this.add.text(W - 30, H - 25, '\u{1F50A}', { fontSize: '20px' })
      .setOrigin(0.5).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        this._muted = !this._muted;
        sound.setMuted(this._muted);
        this._muteBtn.setText(this._muted ? '\u{1F507}' : '\u{1F50A}');
      });

    // --- Dash cooldown UI (for my player) ---
    this._cooldownGraphic = this.add.graphics().setDepth(50);

    // --- Keyboard ---
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D,SPACE');

    // --- Joystick ---
    this.joystick = new JoystickControl();
    this.joystick.create(() => { this.dashPending = true; });

    // --- Socket listeners ---
    this._onGameStartBound = (data) => this._onGameStart(data);
    this._onGameStateBound = (state) => this._onGameState(state);
    this._onGameEventBound = (ev) => this._onGameEvent(ev);
    this._onGameEndBound = (data) => this._onGameEnd(data);
    socket.on('game:start', this._onGameStartBound);
    socket.on('game:state', this._onGameStateBound);
    socket.on('game:event', this._onGameEventBound);
    socket.on('game:end', this._onGameEndBound);
  }

  update() {
    if (!this.gameState) return;

    let dx = 0, dy = 0, dash = false;

    if (this.cursors.left.isDown || this.wasd.A.isDown) dx -= 1;
    if (this.cursors.right.isDown || this.wasd.D.isDown) dx += 1;
    if (this.cursors.up.isDown || this.wasd.W.isDown) dy -= 1;
    if (this.cursors.down.isDown || this.wasd.S.isDown) dy += 1;
    if (Phaser.Input.Keyboard.JustDown(this.cursors.space) || Phaser.Input.Keyboard.JustDown(this.wasd.SPACE)) {
      dash = true;
    }

    if (Math.abs(this.joystick.dx) > 0.1 || Math.abs(this.joystick.dy) > 0.1) {
      dx = this.joystick.dx;
      dy = this.joystick.dy;
    }

    if (this.dashPending) { dash = true; this.dashPending = false; }

    if (dash) sound.dash();

    socket.sendInput(dx, dy, dash);

    // Cleanup trails
    this._dashTrails = this._dashTrails.filter(t => {
      if (t.alpha <= 0) { t.destroy(); return false; }
      return true;
    });

    // Update dash cooldown UI
    this._updateCooldownUI();
  }

  // --- Game start: draw obstacles ---

  _onGameStart(data) {
    if (data.obstacles) {
      this._obstacles = data.obstacles;
      this._drawObstacles();
    }
  }

  _drawObstacles() {
    const g = this._obstacleGraphics;
    g.clear();

    for (const obs of this._obstacles) {
      // Shadow
      g.fillStyle(0x000000, 0.2);
      g.fillRoundedRect(obs.x + 3, obs.y + 3, obs.w, obs.h, 8);

      // Body (dark wood/bush)
      g.fillStyle(0x5d4037, 0.9);
      g.fillRoundedRect(obs.x, obs.y, obs.w, obs.h, 8);

      // Top highlight
      g.fillStyle(0x795548, 0.6);
      g.fillRoundedRect(obs.x + 4, obs.y + 4, obs.w - 8, obs.h / 3, 6);

      // Bush/leaf patches on top
      g.fillStyle(0x2e7d32, 0.7);
      g.fillCircle(obs.x + obs.w * 0.3, obs.y - 4, 12);
      g.fillCircle(obs.x + obs.w * 0.7, obs.y - 2, 10);
      g.fillStyle(0x388e3c, 0.5);
      g.fillCircle(obs.x + obs.w * 0.5, obs.y - 6, 11);
    }
  }

  // --- Cooldown UI ---

  _updateCooldownUI() {
    this._cooldownGraphic.clear();

    const me = this.gameState?.players.find(p => p.id === this.myId);
    if (!me) return;

    const cd = me.dashCooldown || 0;
    if (cd <= 0) return;

    const pct = cd / DASH_COOLDOWN_MAX;
    const g = this.playerGraphics.get(this.myId);
    if (!g) return;

    // Draw arc around player
    const cx = g.container.x;
    const cy = g.container.y;
    const radius = me.radius + 8;

    this._cooldownGraphic.lineStyle(3, 0xff4444, 0.6);
    this._cooldownGraphic.beginPath();
    this._cooldownGraphic.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct, false);
    this._cooldownGraphic.strokePath();

    // Update dash button opacity
    const dashBtn = document.getElementById('dash-btn');
    if (dashBtn) {
      dashBtn.style.opacity = cd > 0 ? '0.4' : '1';
    }
  }

  // --- Game state ---

  _onGameState(state) {
    this.gameState = state;

    const seen = new Set();
    for (const p of state.players) {
      seen.add(p.id);
      if (!this.playerGraphics.has(p.id)) this._createPlayerGraphic(p);
      this._updatePlayerGraphic(p);
    }

    for (const [id, g] of this.playerGraphics.entries()) {
      if (!seen.has(id)) {
        g.container.destroy();
        g.nameText.destroy();
        g.scoreBar?.destroy();
        this.playerGraphics.delete(id);
      }
    }

    // Bone
    if (state.bone) {
      this.boneGraphic.setPosition(state.bone.x, state.bone.y).setVisible(true);
      this.boneGlow.setPosition(state.bone.x, state.bone.y).setVisible(true);
      this.boneGraphic.rotation += 0.02;
    } else {
      this.boneGraphic.setVisible(false);
      this.boneGlow.setVisible(false);
    }

    // Scoreboard
    const sorted = state.players.slice().sort((a, b) => b.score - a.score);
    const panelH = Math.max(30, sorted.length * 18 + 12);
    this._scorePanel.clear();
    this._scorePanel.fillStyle(0x000000, 0.55);
    this._scorePanel.fillRoundedRect(6, 6, 170, panelH, 8);

    const lines = sorted.map((p, i) => {
      const bone = p.hasBone ? ' \u{1F9B4}' : '';
      const me = p.id === this.myId ? ' \u25c0' : '';
      const medal = i === 0 ? '\u{1F947}' : i === 1 ? '\u{1F948}' : i === 2 ? '\u{1F949}' : '   ';
      return `${medal} ${p.name}${bone}${me}  ${Math.floor(p.score)}`;
    });
    this.scoreboard.setText(lines.join('\n'));
  }

  _createPlayerGraphic(p) {
    const isMe = p.id === this.myId;
    const colInt = Phaser.Display.Color.HexStringToColor(p.color).color;

    const shadow = this.add.ellipse(0, p.radius - 2, p.radius * 1.6, 10, 0x000000, 0.25);
    const ring = this.add.circle(0, 0, p.radius + 3, colInt);
    const body = this.add.circle(0, 0, p.radius, 0xf5deb3);
    const fur1 = this.add.circle(-8, -8, 6, 0xfaebd7, 0.5);
    const fur2 = this.add.circle(8, -6, 5, 0xfaebd7, 0.5);
    const fur3 = this.add.circle(-4, 8, 5, 0xfaebd7, 0.4);
    const fur4 = this.add.circle(6, 6, 4, 0xfaebd7, 0.4);
    const eyeL = this.add.circle(-7, -5, 4, 0x222222);
    const eyeR = this.add.circle(7, -5, 4, 0x222222);
    const eyeHL = this.add.circle(-6, -6, 1.5, 0xffffff, 0.8);
    const eyeHR = this.add.circle(8, -6, 1.5, 0xffffff, 0.8);
    const nose = this.add.circle(0, 3, 3, 0x444444);
    const mouth = this.add.graphics();
    mouth.lineStyle(1.5, 0x555555, 0.6);
    mouth.beginPath();
    mouth.arc(0, 5, 4, Phaser.Math.DegToRad(20), Phaser.Math.DegToRad(160), false);
    mouth.strokePath();
    const earL = this.add.circle(-p.radius + 4, -p.radius + 6, 8, 0xe8d5b7);
    const earR = this.add.circle(p.radius - 4, -p.radius + 6, 8, 0xe8d5b7);

    const parts = [shadow, earL, earR, ring, body, fur1, fur2, fur3, fur4, eyeL, eyeR, eyeHL, eyeHR, nose, mouth];
    const container = this.add.container(p.x, p.y, parts);

    if (isMe) {
      const arrow = this.add.text(0, -p.radius - 22, '\u25bc', {
        fontSize: '16px', fontFamily: 'Jua', color: '#ffd700',
      }).setOrigin(0.5);
      this.tweens.add({ targets: arrow, y: -p.radius - 16, yoyo: true, repeat: -1, duration: 500, ease: 'Sine.easeInOut' });
      container.add(arrow);
    }

    const nameTag = this.add.container(p.x, p.y + p.radius + 14);
    nameTag.add(this.add.text(0, 0, p.name, {
      fontSize: '11px', color: '#ffffff', fontFamily: 'Jua, sans-serif',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5));

    const scoreBar = this.add.graphics();

    this.playerGraphics.set(p.id, { container, nameText: nameTag, scoreBar, prevX: p.x, prevY: p.y, colInt });
  }

  _updatePlayerGraphic(p) {
    const g = this.playerGraphics.get(p.id);
    if (!g) return;

    const tx = Phaser.Math.Linear(g.container.x, p.x, LERP);
    const ty = Phaser.Math.Linear(g.container.y, p.y, LERP);

    g.container.setPosition(tx, ty);
    g.nameText.setPosition(tx, ty + p.radius + 14);

    // Score bar
    const barW = 40, barH = 4;
    const pct = Math.min(p.score / 30, 1);
    g.scoreBar.clear();
    g.scoreBar.fillStyle(0x333333, 0.5);
    g.scoreBar.fillRoundedRect(tx - barW / 2, ty + p.radius + 24, barW, barH, 2);
    if (pct > 0) {
      g.scoreBar.fillStyle(0xffd700, 0.9);
      g.scoreBar.fillRoundedRect(tx - barW / 2, ty + p.radius + 24, barW * pct, barH, 2);
    }

    const body = g.container.list[4];
    if (p.isKnockedBack) {
      body.setFillStyle(0xff6666);
      g.container.setScale(0.9);
    } else if (p.isDashing) {
      body.setFillStyle(0xffee44);
      g.container.setScale(1.12);
      this._spawnDashTrail(tx, ty, g.colInt);
    } else {
      g.container.setScale(1);
      body.setFillStyle(p.hasBone ? 0xffe070 : 0xf5deb3);
    }
  }

  _spawnDashTrail(x, y, color) {
    const trail = this.add.circle(x, y, 14, color, 0.3);
    this.tweens.add({ targets: trail, alpha: 0, scaleX: 2, scaleY: 2, duration: 400, ease: 'Power2' });
    this._dashTrails.push(trail);
  }

  // --- Events ---

  _onGameEvent(ev) {
    if (ev.type === 'bone_dropped') {
      sound.boneDropped();
      this.cameras.main.shake(200, 0.008);

      if (ev.bone) {
        for (let i = 0; i < 8; i++) {
          const ang = (i / 8) * Math.PI * 2;
          const particle = this.add.circle(ev.bone.x, ev.bone.y, 4, 0xff6644, 0.8);
          this.tweens.add({
            targets: particle,
            x: ev.bone.x + Math.cos(ang) * 50, y: ev.bone.y + Math.sin(ang) * 50,
            alpha: 0, scaleX: 0.2, scaleY: 0.2,
            duration: 500, ease: 'Power2',
            onComplete: () => particle.destroy(),
          });
        }
      }
      this._showFloatingText(this.mapWidth / 2, 70, '\ud83d\udca5 \ubf08\ub2e4\uadc0 \ube7c\uc557\uae40!', '#ff4444');

    } else if (ev.type === 'bone_taken') {
      sound.boneTaken();
      const p = this.gameState?.players.find(pl => pl.id === ev.playerId);
      if (p) {
        this._showFloatingText(p.x, p.y - 50, '\u{1F9B4} \ud68d\ub4dd!', '#ffd700');
        const ring = this.add.circle(p.x, p.y, 10, 0xffd700, 0.5);
        this.tweens.add({ targets: ring, scaleX: 3, scaleY: 3, alpha: 0, duration: 600, onComplete: () => ring.destroy() });
      }

    } else if (ev.type === 'bone_spawned') {
      sound.pickup();
    }
  }

  _showFloatingText(x, y, msg, color = '#ffffff') {
    const t = this.add.text(x, y, msg, {
      fontSize: '22px', color, fontFamily: 'Jua, sans-serif',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5);
    this.tweens.add({
      targets: t, y: y - 60, alpha: 0, scaleX: 1.3, scaleY: 1.3,
      duration: 1200, ease: 'Power2',
      onComplete: () => t.destroy(),
    });
  }

  // --- Game end ---

  _onGameEnd(data) {
    sound.win();
    this.joystick?.destroy();

    const W = this.mapWidth, H = this.mapHeight;

    const overlay = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0).setDepth(100);
    this.tweens.add({ targets: overlay, alpha: 0.8, duration: 500 });

    const trophy = this.add.text(W / 2, H / 2 - 110, '\u{1F3C6}', { fontSize: '60px' })
      .setOrigin(0.5).setDepth(101).setScale(0);
    this.tweens.add({ targets: trophy, scaleX: 1, scaleY: 1, duration: 600, ease: 'Back.easeOut', delay: 300 });

    const winnerMsg = data.winnerName ? `${data.winnerName} \uc2b9\ub9ac!` : '\ubb34\uc2b9\ubd80!';
    const winText = this.add.text(W / 2, H / 2 - 40, winnerMsg, {
      fontSize: '28px', color: '#ffd700', fontFamily: 'Black Han Sans, Jua, sans-serif',
      stroke: '#000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(101).setAlpha(0);
    this.tweens.add({ targets: winText, alpha: 1, duration: 400, delay: 600 });

    const scoreLines = data.scores.map((s, i) => {
      const medal = i === 0 ? '\u{1F947}' : i === 1 ? '\u{1F948}' : i === 2 ? '\u{1F949}' : `${i + 1}.`;
      return `${medal}  ${s.name}    ${s.score}pt`;
    }).join('\n');
    const scoreText = this.add.text(W / 2, H / 2 + 20, scoreLines, {
      fontSize: '16px', color: '#ddddff', fontFamily: 'Jua, Consolas',
      align: 'center', lineSpacing: 6, stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5, 0).setDepth(101).setAlpha(0);
    this.tweens.add({ targets: scoreText, alpha: 1, duration: 400, delay: 800 });

    const btnContainer = this.add.container(W / 2, H / 2 + 160).setDepth(101).setAlpha(0);
    const btnBg = this.add.graphics();
    btnBg.fillStyle(0x3498db, 1);
    btnBg.fillRoundedRect(-90, -20, 180, 40, 20);
    btnContainer.add([btnBg, this.add.text(0, 0, '\ub85c\ube44\ub85c \ub3cc\uc544\uac00\uae30', {
      fontSize: '16px', color: '#fff', fontFamily: 'Jua',
    }).setOrigin(0.5)]);
    btnContainer.setSize(180, 40);
    btnContainer.setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        socket.off('game:state', this._onGameStateBound);
        socket.off('game:event', this._onGameEventBound);
        socket.off('game:end', this._onGameEndBound);
        socket.off('game:start', this._onGameStartBound);
        this.scene.start('LobbyScene');
      });
    this.tweens.add({ targets: btnContainer, alpha: 1, duration: 400, delay: 1000 });

    this._spawnConfetti(W, H);
  }

  _spawnConfetti(W, H) {
    const colors = [0xffd700, 0xff6b6b, 0x5dade2, 0x2ecc71, 0xf39c12, 0x9b59b6];
    for (let i = 0; i < 40; i++) {
      const x = Phaser.Math.Between(50, W - 50);
      const size = Phaser.Math.Between(4, 8);
      const c = Phaser.Math.RND.pick(colors);
      const piece = this.add.rectangle(x, -20, size, size * 2, c).setDepth(102).setAngle(Phaser.Math.Between(0, 360));
      this.tweens.add({
        targets: piece, y: H + 30, angle: Phaser.Math.Between(180, 720),
        duration: Phaser.Math.Between(2000, 4000), delay: Phaser.Math.Between(0, 1500),
        ease: 'Quad.easeIn', onComplete: () => piece.destroy(),
      });
    }
  }

  shutdown() {
    this.joystick?.destroy();
    for (const g of this.playerGraphics.values()) {
      g.container.destroy();
      g.nameText.destroy();
      g.scoreBar?.destroy();
    }
    this.playerGraphics.clear();
    this._dashTrails.forEach(t => t.destroy());
    this._dashTrails = [];
  }
}
