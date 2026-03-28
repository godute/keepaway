import Phaser from 'phaser';
import socket from '../network/SocketClient.js';
import { JoystickControl } from '../ui/JoystickControl.js';
import sound from '../audio/SoundManager.js';
import { CHARACTERS, DEFAULT_CHARACTER } from '../characters.js';

const LERP = 0.45;
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
    this.mapWidth = 960;
    this.mapHeight = 540;
    this.myId = null;
    this.roomCode = null;
    this._dashTrails = [];
    this._obstacles = [];
    this._muted = false;
  }

  init(data) {
    this.roomCode = data.roomCode;
    this.myName = data.myName;
    this._gameStartData = data.gameData || null;
  }

  create() {
    this.myId = socket.id;
    const W = this.mapWidth, H = this.mapHeight;

    // Init audio on first interaction
    sound.init();
    this.input.on('pointerdown', () => sound.unlock(), this);

    // --- Background ---
    const bg = this.add.graphics();
    // Checkered grass pattern
    const darkGrass = 0x1a3a1a;
    const lightGrass = 0x1e421e;
    const tileSize = 40;
    for (let x = 0; x < W; x += tileSize) {
      for (let y = 0; y < H; y += tileSize) {
        const isLight = ((x / tileSize) + (y / tileSize)) % 2 === 0;
        bg.fillStyle(isLight ? lightGrass : darkGrass, 1);
        bg.fillRect(x, y, tileSize, tileSize);
      }
    }

    // Grass tufts scattered around
    const decoG = this.add.graphics();
    for (let i = 0; i < 30; i++) {
      const gx = Phaser.Math.Between(10, W - 10);
      const gy = Phaser.Math.Between(10, H - 10);
      const shade = Phaser.Math.Between(0, 1) ? 0x2d5a2d : 0x3a6a2a;
      decoG.fillStyle(shade, Phaser.Math.FloatBetween(0.08, 0.2));
      // Small grass tuft (3 blades)
      decoG.fillTriangle(gx - 3, gy, gx, gy - 8, gx + 3, gy);
      decoG.fillTriangle(gx + 2, gy, gx + 6, gy - 6, gx + 8, gy);
      decoG.fillTriangle(gx - 6, gy, gx - 4, gy - 5, gx - 1, gy);
    }

    // Small flowers
    for (let i = 0; i < 12; i++) {
      const fx = Phaser.Math.Between(30, W - 30);
      const fy = Phaser.Math.Between(30, H - 30);
      const flowerColors = [0xffaaaa, 0xffffaa, 0xaaddff, 0xffccff, 0xaaffaa];
      const fc = Phaser.Math.RND.pick(flowerColors);
      decoG.fillStyle(fc, Phaser.Math.FloatBetween(0.1, 0.2));
      decoG.fillCircle(fx, fy, 3);
      decoG.fillStyle(0xffee44, 0.15);
      decoG.fillCircle(fx, fy, 1.5);
    }

    // Small pebbles
    for (let i = 0; i < 8; i++) {
      const sx = Phaser.Math.Between(20, W - 20);
      const sy = Phaser.Math.Between(20, H - 20);
      decoG.fillStyle(0x556655, Phaser.Math.FloatBetween(0.08, 0.15));
      decoG.fillEllipse(sx, sy, Phaser.Math.Between(4, 8), Phaser.Math.Between(3, 5));
    }

    // Center circle marking
    const centerG = this.add.graphics();
    centerG.lineStyle(2, 0x4a8a4a, 0.15);
    centerG.strokeCircle(W / 2, H / 2, 100);
    centerG.fillStyle(0x4a8a4a, 0.06);
    centerG.fillCircle(W / 2, H / 2, 100);
    // Inner ring
    centerG.lineStyle(1, 0xffd700, 0.08);
    centerG.strokeCircle(W / 2, H / 2, 50);
    // Center bone icon
    centerG.fillStyle(0xffd700, 0.1);
    centerG.fillCircle(W / 2, H / 2, 6);

    // Border with corner decorations
    const border = this.add.graphics();
    border.lineStyle(3, 0x8b6914, 0.7);
    border.strokeRoundedRect(2, 2, W - 4, H - 4, 6);
    // Corner accent circles
    const cornerR = 14;
    border.fillStyle(0x8b6914, 0.15);
    border.fillCircle(cornerR, cornerR, cornerR);
    border.fillCircle(W - cornerR, cornerR, cornerR);
    border.fillCircle(cornerR, H - cornerR, cornerR);
    border.fillCircle(W - cornerR, H - cornerR, cornerR);

    // Paw prints
    for (let i = 0; i < 6; i++) {
      const px = Phaser.Math.Between(50, W - 50);
      const py = Phaser.Math.Between(50, H - 50);
      this.add.text(px, py, '\u{1F43E}', { fontSize: '18px' }).setAlpha(0.06).setAngle(Phaser.Math.Between(-40, 40));
    }

    // --- Obstacles (drawn after receiving game:start) ---
    this._obstacleGraphics = this.add.graphics().setDepth(15);

    // --- Bone ---
    this.boneGlow = this.add.circle(0, 0, 30, 0xffd700, 0.15).setDepth(20);
    this.tweens.add({ targets: this.boneGlow, scaleX: 1.4, scaleY: 1.4, alpha: 0.05, yoyo: true, repeat: -1, duration: 800, ease: 'Sine.easeInOut' });

    this.boneGraphic = this.add.container(0, 0).setDepth(20);
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

    // Win condition badge
    const winBadgeBg = this.add.graphics();
    winBadgeBg.fillStyle(0x000000, 0.45);
    winBadgeBg.fillRoundedRect(W / 2 - 75, 6, 150, 24, 8);
    this.add.text(W / 2, 18, '\u{1F9B4} 30\uc810 \ub2ec\uc131 \uc2dc \uc2b9\ub9ac!', {
      fontSize: '11px', color: '#ffd700', fontFamily: 'Jua, sans-serif',
    }).setOrigin(0.5);

    // Near-win warning text (hidden by default)
    this._nearWinText = this.add.text(W / 2, 40, '', {
      fontSize: '16px', color: '#ff4444', fontFamily: 'Jua, sans-serif',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setAlpha(0);

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
    // Defensive: remove any stale listeners from previous scene instance
    if (this._onGameStartBound) socket.off('game:start', this._onGameStartBound);
    if (this._onGameStateBound) socket.off('game:state', this._onGameStateBound);
    if (this._onGameEventBound) socket.off('game:event', this._onGameEventBound);
    if (this._onGameEndBound) socket.off('game:end', this._onGameEndBound);

    this._onGameStartBound = (data) => this._onGameStart(data);
    this._onGameStateBound = (state) => this._onGameState(state);
    this._onGameEventBound = (ev) => this._onGameEvent(ev);
    this._onGameEndBound = (data) => this._onGameEnd(data);
    socket.on('game:start', this._onGameStartBound);
    socket.on('game:state', this._onGameStateBound);
    socket.on('game:event', this._onGameEventBound);
    socket.on('game:end', this._onGameEndBound);

    // Apply game:start data passed from LobbyScene (since the event already fired)
    if (this._gameStartData) {
      this._onGameStart(this._gameStartData);
    }
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
      const cx = obs.x + obs.w / 2;
      const cy = obs.y + obs.h / 2;
      const type = obs.type || 'tree';

      // Heavy shadow for all obstacles
      g.fillStyle(0x000000, 0.5);
      g.fillEllipse(cx + 4, obs.y + obs.h + 8, obs.w + 12, 18);

      if (type === 'tree') {
        // === TREE - Very bright, unmissable ===
        // Outer glow ring (bright yellow-green)
        g.lineStyle(4, 0xaaff44, 0.5);
        g.strokeCircle(cx, cy - 6, obs.w / 2 + 12);
        // Trunk (thick, dark brown)
        g.fillStyle(0xa0642a, 1);
        g.fillRoundedRect(cx - 12, cy + 2, 24, obs.h / 2 + 10, 5);
        g.lineStyle(2, 0x5a3a1a, 0.8);
        g.strokeRoundedRect(cx - 12, cy + 2, 24, obs.h / 2 + 10, 5);
        // Main canopy (VERY bright green)
        g.fillStyle(0x55ee44, 1);
        g.fillCircle(cx, cy - 8, obs.w / 2 + 6);
        g.fillStyle(0x77ff66, 1);
        g.fillCircle(cx - 12, cy - 4, obs.w / 3 + 2);
        g.fillCircle(cx + 12, cy - 4, obs.w / 3 + 2);
        g.fillStyle(0x88ff77, 0.9);
        g.fillCircle(cx, cy - 18, obs.w / 3 + 2);
        // Bright white highlights
        g.fillStyle(0xccffbb, 0.7);
        g.fillCircle(cx - 8, cy - 16, 10);
        g.fillCircle(cx + 10, cy - 12, 8);
        // Bold outline
        g.lineStyle(3, 0xffffff, 0.5);
        g.strokeCircle(cx, cy - 8, obs.w / 2 + 6);

      } else if (type === 'rock') {
        // === ROCK - Bright gray with strong outline ===
        // Outer glow
        g.lineStyle(4, 0xeeeeff, 0.4);
        g.strokeEllipse(cx, cy, obs.w + 14, obs.h + 14);
        // Main body (bright light gray)
        g.fillStyle(0xbbcccc, 1);
        g.fillEllipse(cx, cy, obs.w + 6, obs.h + 6);
        // Highlight
        g.fillStyle(0xddeedd, 0.9);
        g.fillEllipse(cx - 5, cy - 5, obs.w * 0.7, obs.h * 0.6);
        // Top shine
        g.fillStyle(0xffffff, 0.5);
        g.fillEllipse(cx - 3, cy - 8, obs.w * 0.4, obs.h * 0.3);
        // Crack details
        g.lineStyle(2, 0x778888, 0.7);
        g.lineBetween(cx - 8, cy - 3, cx + 6, cy + 8);
        g.lineBetween(cx + 2, cy - 5, cx - 4, cy + 4);
        // Side rock
        g.fillStyle(0xaabbbb, 1);
        g.fillEllipse(cx + obs.w / 2 + 4, cy + obs.h / 3, 14, 12);
        // Bold outline
        g.lineStyle(3, 0xffffff, 0.45);
        g.strokeEllipse(cx, cy, obs.w + 6, obs.h + 6);

      } else if (type === 'fence') {
        // === FENCE - Bright wood with clear posts ===
        // Outer glow
        g.lineStyle(4, 0xffcc55, 0.5);
        g.strokeRoundedRect(obs.x - 4, obs.y - 12, obs.w + 8, obs.h + 24, 4);
        // Posts (tall, prominent)
        g.fillStyle(0x996622, 1);
        g.fillRoundedRect(obs.x + 6, obs.y - 14, 12, obs.h + 28, 3);
        g.fillRoundedRect(obs.x + obs.w - 18, obs.y - 14, 12, obs.h + 28, 3);
        g.lineStyle(2, 0x664411, 0.8);
        g.strokeRoundedRect(obs.x + 6, obs.y - 14, 12, obs.h + 28, 3);
        g.strokeRoundedRect(obs.x + obs.w - 18, obs.y - 14, 12, obs.h + 28, 3);
        // Main plank (bright warm brown)
        g.fillStyle(0xddaa44, 1);
        g.fillRoundedRect(obs.x, obs.y, obs.w, obs.h, 3);
        // Plank detail stripes
        g.fillStyle(0xeebb55, 0.8);
        g.fillRoundedRect(obs.x + 2, obs.y + 2, obs.w - 4, obs.h / 2 - 1, 2);
        // Wood grain lines
        g.lineStyle(1, 0xbb8833, 0.5);
        g.lineBetween(obs.x + 20, obs.y + 3, obs.x + obs.w - 20, obs.y + 3);
        g.lineBetween(obs.x + 20, obs.y + obs.h - 3, obs.x + obs.w - 20, obs.y + obs.h - 3);
        // Nail details
        g.fillStyle(0x888888, 0.9);
        g.fillCircle(obs.x + 12, cy, 3);
        g.fillCircle(obs.x + obs.w - 12, cy, 3);
        // Bold outline
        g.lineStyle(2, 0xffffff, 0.35);
        g.strokeRoundedRect(obs.x, obs.y, obs.w, obs.h, 3);

      } else if (type === 'pond') {
        // === POND - Bright blue, very obvious ===
        // Outer glow (wide, bright)
        g.lineStyle(5, 0x66ccff, 0.5);
        g.strokeEllipse(cx, cy, obs.w + 20, obs.h + 20);
        // Shore ring (sandy)
        g.fillStyle(0xccaa66, 0.7);
        g.fillEllipse(cx, cy, obs.w + 14, obs.h + 14);
        // Water (bright vivid blue)
        g.fillStyle(0x3399ee, 1);
        g.fillEllipse(cx, cy, obs.w + 6, obs.h + 6);
        g.fillStyle(0x55bbff, 0.9);
        g.fillEllipse(cx, cy, obs.w - 4, obs.h - 4);
        // Bright shine
        g.fillStyle(0xaaeeff, 0.7);
        g.fillEllipse(cx - 10, cy - 10, obs.w * 0.45, obs.h * 0.3);
        // White sparkle
        g.fillStyle(0xffffff, 0.6);
        g.fillCircle(cx - 14, cy - 12, 5);
        g.fillCircle(cx - 8, cy - 8, 3);
        // Ripples
        g.lineStyle(2, 0xcceeFF, 0.6);
        g.strokeEllipse(cx + 8, cy + 6, 22, 14);
        g.strokeEllipse(cx - 6, cy + 2, 16, 10);
        // Lily pad
        g.fillStyle(0x55dd55, 1);
        g.fillCircle(cx + 22, cy + 14, 10);
        g.lineStyle(1.5, 0x339933, 0.7);
        g.strokeCircle(cx + 22, cy + 14, 10);
        // Flower on lily
        g.fillStyle(0xff88bb, 0.9);
        g.fillCircle(cx + 22, cy + 13, 4);
        // Bold outline
        g.lineStyle(3, 0xffffff, 0.35);
        g.strokeEllipse(cx, cy, obs.w + 6, obs.h + 6);

      } else if (type === 'bush') {
        // === BUSH - Bright green with red berries ===
        // Outer glow
        g.lineStyle(4, 0x88ff66, 0.45);
        g.strokeEllipse(cx, cy, obs.w + 16, obs.h + 16);
        // Main body (VERY bright green)
        g.fillStyle(0x55cc44, 1);
        g.fillEllipse(cx, cy, obs.w + 8, obs.h + 8);
        g.fillStyle(0x66dd55, 1);
        g.fillEllipse(cx - 8, cy - 3, obs.w * 0.7, obs.h * 0.8);
        g.fillEllipse(cx + 8, cy + 3, obs.w * 0.7, obs.h * 0.8);
        // Bright highlights
        g.fillStyle(0x99ff88, 0.7);
        g.fillCircle(cx - 6, cy - 10, 9);
        g.fillCircle(cx + 10, cy - 7, 8);
        g.fillCircle(cx, cy - 4, 6);
        // BIG red berries (very visible)
        g.fillStyle(0xff2222, 1);
        g.fillCircle(cx + 14, cy + 5, 5);
        g.fillCircle(cx - 12, cy + 8, 5);
        g.fillCircle(cx + 3, cy + 12, 4.5);
        g.fillCircle(cx - 5, cy - 3, 4);
        // Berry shine
        g.fillStyle(0xff8888, 0.7);
        g.fillCircle(cx + 13, cy + 3, 2);
        g.fillCircle(cx - 13, cy + 6, 2);
        // Bold outline
        g.lineStyle(3, 0xffffff, 0.4);
        g.strokeEllipse(cx, cy, obs.w + 8, obs.h + 8);
      }
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
      return `${medal} ${p.name}${bone}${me}  ${Math.floor(p.score)}/30`;
    });
    this.scoreboard.setText(lines.join('\n'));

    // Near-win warning
    if (sorted.length > 0 && sorted[0].score >= 20) {
      const leader = sorted[0];
      this._nearWinText.setText(`\u{1F525} ${leader.name} \uac70\uc758 \uc2b9\ub9ac! (${Math.floor(leader.score)}/30)`);
      this._nearWinText.setAlpha(0.6 + Math.sin(Date.now() / 200) * 0.4);
    } else {
      this._nearWinText.setAlpha(0);
    }
  }

  _createPlayerGraphic(p) {
    const isMe = p.id === this.myId;
    const colInt = Phaser.Display.Color.HexStringToColor(p.color).color;
    const char = CHARACTERS[p.characterId] || CHARACTERS[DEFAULT_CHARACTER];
    const R = p.radius;

    const shadow = this.add.ellipse(0, R - 2, R * 1.6, 10, 0x000000, 0.25);
    const parts = [shadow];

    // Ears (drawn behind body)
    if (char.earType === 'pointy') {
      const earG = this.add.graphics();
      earG.fillStyle(char.ear, 1);
      earG.fillTriangle(-R + 2, -R + 8, -R + 12, -R - 8, -R + 18, -R + 10);
      earG.fillTriangle(R - 2, -R + 8, R - 12, -R - 8, R - 18, -R + 10);
      parts.push(earG);
    } else if (char.earType === 'floppy') {
      parts.push(this.add.ellipse(-R + 3, 4, 14, 20, char.ear));
      parts.push(this.add.ellipse(R - 3, 4, 14, 20, char.ear));
    } else {
      parts.push(this.add.circle(-R + 4, -R + 6, 8, char.ear));
      parts.push(this.add.circle(R - 4, -R + 6, 8, char.ear));
    }

    // Collar ring
    const ring = this.add.circle(0, 0, R + 3, colInt);
    parts.push(ring);

    // Body
    const body = this.add.circle(0, 0, R, char.body);
    parts.push(body);

    // Character-specific features
    if (char.features.includes('curlyFur')) {
      parts.push(this.add.circle(-8, -8, 6, char.bodyHighlight, 0.5));
      parts.push(this.add.circle(8, -6, 5, char.bodyHighlight, 0.5));
      parts.push(this.add.circle(-4, 8, 5, char.bodyHighlight, 0.4));
      parts.push(this.add.circle(6, 6, 4, char.bodyHighlight, 0.4));
    }
    if (char.features.includes('fluffyFur')) {
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        parts.push(this.add.circle(Math.cos(ang) * (R - 4), Math.sin(ang) * (R - 4), 7, char.bodyHighlight, 0.4));
      }
    }
    if (char.features.includes('whiteCheeks')) {
      parts.push(this.add.circle(-10, 3, 6, 0xfff8dc, 0.7));
      parts.push(this.add.circle(10, 3, 6, 0xfff8dc, 0.7));
    }
    if (char.features.includes('whiteBelly')) {
      parts.push(this.add.ellipse(0, 8, 18, 14, 0xfff8dc, 0.5));
    }
    if (char.features.includes('faceMask')) {
      const mask = this.add.graphics();
      mask.fillStyle(0xffffff, 0.6);
      mask.fillTriangle(-8, -6, 8, -6, 0, 10);
      parts.push(mask);
    }
    if (char.features.includes('spots')) {
      parts.push(this.add.circle(-9, -8, 4, 0x222222, 0.8));
      parts.push(this.add.circle(7, -4, 5, 0x222222, 0.8));
      parts.push(this.add.circle(-4, 9, 4, 0x222222, 0.7));
      parts.push(this.add.circle(10, 7, 3, 0x222222, 0.7));
    }
    if (char.features.includes('longNose')) {
      parts.push(this.add.ellipse(0, 3, 14, 18, char.bodyHighlight, 0.5));
    }

    // Eyes
    const eyeSize = 4;
    parts.push(this.add.circle(-7, -5, eyeSize, char.eyeColor));
    parts.push(this.add.circle(7, -5, eyeSize, char.eyeColor));
    parts.push(this.add.circle(-6, -6, 1.5, 0xffffff, 0.8));
    parts.push(this.add.circle(8, -6, 1.5, 0xffffff, 0.8));

    // Nose
    parts.push(this.add.circle(0, 3, 3, char.noseColor));

    // Mouth
    const mouth = this.add.graphics();
    mouth.lineStyle(1.5, 0x555555, 0.6);
    mouth.beginPath();
    mouth.arc(0, 5, 4, Phaser.Math.DegToRad(20), Phaser.Math.DegToRad(160), false);
    mouth.strokePath();
    parts.push(mouth);

    // Bone in mouth (hidden by default)
    const mouthBone = this.add.container(0, R - 6);
    const boneL = this.add.circle(-5, 0, 4, 0xfff8dc);
    const boneR = this.add.circle(5, 0, 4, 0xfff8dc);
    const boneM = this.add.rectangle(0, 0, 10, 5, 0xfff8dc).setOrigin(0.5);
    mouthBone.add([boneL, boneR, boneM]);
    mouthBone.setVisible(false);
    parts.push(mouthBone);

    const container = this.add.container(p.x, p.y, parts);

    if (isMe) {
      const arrow = this.add.text(0, -R - 22, '\u25bc', {
        fontSize: '16px', fontFamily: 'Jua', color: '#ffd700',
      }).setOrigin(0.5);
      this.tweens.add({ targets: arrow, y: -R - 16, yoyo: true, repeat: -1, duration: 500, ease: 'Sine.easeInOut' });
      container.add(arrow);
    }

    const nameTag = this.add.container(p.x, p.y + R + 14);
    nameTag.add(this.add.text(0, 0, p.name, {
      fontSize: '11px', color: '#ffffff', fontFamily: 'Jua, sans-serif',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5));

    const scoreBar = this.add.graphics();

    this.playerGraphics.set(p.id, { container, nameText: nameTag, scoreBar, prevX: p.x, prevY: p.y, colInt, body, bodyColor: char.body, mouthBone });
  }

  _updatePlayerGraphic(p) {
    const g = this.playerGraphics.get(p.id);
    if (!g) return;

    const tx = Phaser.Math.Linear(g.container.x, p.x, LERP);
    const ty = Phaser.Math.Linear(g.container.y, p.y, LERP);

    g.container.setPosition(tx, ty);
    g.nameText.setPosition(tx, ty + p.radius + 14);

    // Score bar
    const barW = 50, barH = 5;
    const pct = Math.min(p.score / 30, 1);
    g.scoreBar.clear();
    g.scoreBar.fillStyle(0x333333, 0.5);
    g.scoreBar.fillRoundedRect(tx - barW / 2, ty + p.radius + 24, barW, barH, 2);
    if (pct > 0) {
      g.scoreBar.fillStyle(0xffd700, 0.9);
      g.scoreBar.fillRoundedRect(tx - barW / 2, ty + p.radius + 24, barW * pct, barH, 2);
    }

    if (p.isKnockedBack) {
      g.body.setFillStyle(0xff6666);
      g.container.setScale(0.9);
    } else if (p.isDashing) {
      g.body.setFillStyle(0xffee44);
      g.container.setScale(1.12);
      this._spawnDashTrail(tx, ty, g.colInt);
    } else {
      g.container.setScale(1);
      g.body.setFillStyle(p.hasBone ? 0xffe070 : g.bodyColor);
    }

    // Bone in mouth
    if (g.mouthBone) g.mouthBone.setVisible(p.hasBone);
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

    // HTML overlay button for reliable mobile tapping
    const lobbyBtn = document.createElement('button');
    lobbyBtn.textContent = '로비로 돌아가기';
    Object.assign(lobbyBtn.style, {
      position: 'fixed', left: '50%', bottom: '12%',
      transform: 'translateX(-50%)',
      padding: '14px 36px', fontSize: '17px',
      fontFamily: 'Jua, sans-serif', color: '#fff',
      background: 'linear-gradient(135deg, #3498db, #2980b9)',
      border: 'none', borderRadius: '30px',
      boxShadow: '0 4px 20px rgba(52,152,219,0.5)',
      cursor: 'pointer', zIndex: '600',
      opacity: '0', transition: 'opacity 0.4s',
      WebkitTapHighlightColor: 'transparent',
      touchAction: 'manipulation',
    });
    document.body.appendChild(lobbyBtn);
    setTimeout(() => { lobbyBtn.style.opacity = '1'; }, 1000);
    const goToLobby = () => {
      lobbyBtn.remove();
      socket.off('game:state', this._onGameStateBound);
      socket.off('game:event', this._onGameEventBound);
      socket.off('game:end', this._onGameEndBound);
      socket.off('game:start', this._onGameStartBound);
      this.scene.start('LobbyScene', { roomCode: this.roomCode, myName: this.myName });
    };
    lobbyBtn.addEventListener('click', goToLobby);
    lobbyBtn.addEventListener('touchend', (e) => { e.preventDefault(); goToLobby(); });
    this._lobbyBtn = lobbyBtn;

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
    // Remove socket listeners to prevent duplicates on restart
    if (this._onGameStartBound) socket.off('game:start', this._onGameStartBound);
    if (this._onGameStateBound) socket.off('game:state', this._onGameStateBound);
    if (this._onGameEventBound) socket.off('game:event', this._onGameEventBound);
    if (this._onGameEndBound) socket.off('game:end', this._onGameEndBound);

    if (this._lobbyBtn) { this._lobbyBtn.remove(); this._lobbyBtn = null; }
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
