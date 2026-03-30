import Phaser from 'phaser';
import socket from '../network/SocketClient.js';
import { JoystickControl } from '../ui/JoystickControl.js';
import sound from '../audio/SoundManager.js';
import { CHARACTERS, DEFAULT_CHARACTER } from '../characters.js';
import { createRenderer } from '../renderers/index.js';
import { StatsManager } from '../stats/StatsManager.js';

const LERP = 0.7;
const DASH_COOLDOWN_MAX = 1.2;

export class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });
    this.playerGraphics = new Map();
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
    this.modeRenderer = null;
    this.gameType = 'keepaway';
  }

  init(data) {
    this.roomCode = data.roomCode;
    this.myName = data.myName;
    this._gameStartData = data.gameData || null;
  }

  create() {
    // --- Clean up stale state from previous game ---
    // (constructor only runs once; on scene restart only init+create run)
    this._cleanupPreviousGame();

    this.myId = socket.id;
    const W = this.mapWidth, H = this.mapHeight;

    sound.init();

    // Determine game type from start data
    this.gameType = this._gameStartData?.gameType || 'keepaway';

    // --- Background ---
    this._drawBackground(W, H);

    // --- Obstacles placeholder (drawn by renderer or game:start) ---
    this._obstacleGraphics = this.add.graphics().setDepth(15);

    // --- UI Panels ---
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

    // --- Dash cooldown UI ---
    this._cooldownGraphic = this.add.graphics().setDepth(50);

    // --- Keyboard ---
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D,SPACE');

    // --- Joystick ---
    this.joystick = new JoystickControl();
    this.joystick.create(() => { this.dashPending = true; });

    // --- Create game-specific renderer ---
    this.modeRenderer = createRenderer(this.gameType, this);
    this.modeRenderer.create();

    // --- Emoji bar ---
    this._createEmojiBar();

    // --- Fullscreen + landscape lock on mobile ---
    this._requestLandscape();

    // --- Socket listeners ---
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

    // Bind shutdown so it fires when the scene stops/restarts
    this.events.once('shutdown', this.shutdown, this);

    // Apply game:start data passed from LobbyScene
    if (this._gameStartData) {
      this._onGameStart(this._gameStartData);
    }
  }

  _cleanupPreviousGame() {
    // Destroy old player graphics (with safety for already-destroyed objects)
    if (this.playerGraphics && this.playerGraphics.size > 0) {
      for (const g of this.playerGraphics.values()) {
        try { if (g.container && g.container.scene) g.container.destroy(); } catch (e) {}
        try { if (g.nameText && g.nameText.scene) g.nameText.destroy(); } catch (e) {}
        try { if (g.scoreBar && g.scoreBar.scene) g.scoreBar.destroy(); } catch (e) {}
      }
      this.playerGraphics.clear();
    }
    this.playerGraphics = new Map();

    // Destroy old dash trails
    if (this._dashTrails) {
      this._dashTrails.forEach(t => { try { if (t && t.scene) t.destroy(); } catch (e) {} });
    }
    this._dashTrails = [];

    // Remove old renderer
    if (this.modeRenderer) {
      try { this.modeRenderer.destroy(); } catch (e) {}
      this.modeRenderer = null;
    }

    // Remove old joystick
    if (this.joystick) {
      try { this.joystick.destroy(); } catch (e) {}
      this.joystick = null;
    }

    // Remove leftover lobby button from previous game end
    if (this._lobbyBtn) {
      this._lobbyBtn.remove();
      this._lobbyBtn = null;
    }

    // Remove emoji bar
    if (this._emojiBar) { this._emojiBar.remove(); this._emojiBar = null; }

    // Remove old socket listeners
    if (this._onGameStartBound) socket.off('game:start', this._onGameStartBound);
    if (this._onGameStateBound) socket.off('game:state', this._onGameStateBound);
    if (this._onGameEventBound) socket.off('game:event', this._onGameEventBound);
    if (this._onGameEndBound) socket.off('game:end', this._onGameEndBound);

    // Reset state
    this.gameState = null;
    this.dashPending = false;
    this._obstacles = [];
  }

  // --- Background ---

  _drawBackground(W, H) {
    const bg = this.add.graphics();

    // --- Base grass gradient (vertical, dark to light green) ---
    const steps = 12;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const r = Math.round(0x22 + (0x34 - 0x22) * t);
      const g = Math.round(0x6e + (0x82 - 0x6e) * t);
      const b = Math.round(0x22 + (0x2e - 0x22) * t);
      bg.fillStyle((r << 16) | (g << 8) | b, 1);
      bg.fillRect(0, (H / steps) * i, W, H / steps + 1);
    }

    // --- Subtle checkerboard overlay ---
    const tileSize = 40;
    for (let r = 0; r < Math.ceil(H / tileSize); r++) {
      for (let c = 0; c < Math.ceil(W / tileSize); c++) {
        if ((r + c) % 2 === 0) {
          bg.fillStyle(0x000000, 0.04);
          bg.fillRect(c * tileSize, r * tileSize, tileSize, tileSize);
        }
      }
    }

    // --- Bright grass patches (natural lawn look) ---
    for (let i = 0; i < 10; i++) {
      const px = Phaser.Math.Between(40, W - 40);
      const py = Phaser.Math.Between(40, H - 40);
      const pr = Phaser.Math.Between(30, 60);
      bg.fillStyle(0x3a8a3a, 0.15);
      bg.fillCircle(px, py, pr);
    }

    // --- Grass blade lines (texture) ---
    bg.lineStyle(1, 0x2a7a2a, 0.2);
    for (let i = 0; i < 120; i++) {
      const gx = Phaser.Math.Between(5, W - 5);
      const gy = Phaser.Math.Between(5, H - 5);
      const len = Phaser.Math.Between(3, 8);
      const ang = Phaser.Math.Between(-30, 30) * (Math.PI / 180);
      bg.lineBetween(gx, gy, gx + Math.sin(ang) * len, gy - len);
    }

    // --- Dirt path (curved brown trail across map) ---
    const path = this.add.graphics();
    path.fillStyle(0x8b7355, 0.18);
    for (let x = 0; x < W; x += 6) {
      const yOff = Math.sin(x / 120) * 40 + Math.sin(x / 60) * 15;
      path.fillCircle(x, H / 2 + yOff, 14);
    }
    // Dirt specks along path
    for (let i = 0; i < 30; i++) {
      const dx = Phaser.Math.Between(0, W);
      const yOff = Math.sin(dx / 120) * 40 + Math.sin(dx / 60) * 15;
      const dy = H / 2 + yOff + Phaser.Math.Between(-18, 18);
      path.fillStyle(0x7a6548, 0.15);
      path.fillCircle(dx, dy, Phaser.Math.Between(1, 3));
    }

    // --- Small decorations (stones, leaves, mushrooms) ---
    const deco = this.add.graphics();
    // Stones
    for (let i = 0; i < 15; i++) {
      const sx = Phaser.Math.Between(15, W - 15);
      const sy = Phaser.Math.Between(15, H - 15);
      deco.fillStyle(0x888888, 0.25);
      deco.fillEllipse(sx, sy, Phaser.Math.Between(3, 6), Phaser.Math.Between(2, 4));
    }
    // Fallen leaves
    for (let i = 0; i < 12; i++) {
      const lx = Phaser.Math.Between(20, W - 20);
      const ly = Phaser.Math.Between(20, H - 20);
      const lc = Phaser.Math.RND.pick([0x88aa44, 0x99bb55, 0xaacc33]);
      deco.fillStyle(lc, 0.2);
      deco.fillEllipse(lx, ly, Phaser.Math.Between(4, 8), Phaser.Math.Between(2, 5));
    }
    // Flowers
    for (let i = 0; i < 16; i++) {
      const fx = Phaser.Math.Between(20, W - 20);
      const fy = Phaser.Math.Between(20, H - 20);
      const fc = Phaser.Math.RND.pick([0xffaaaa, 0xffddaa, 0xaaddff, 0xffaaff, 0xffffaa]);
      // Stem
      deco.lineStyle(1, 0x44883a, 0.3);
      deco.lineBetween(fx, fy + 3, fx, fy - 2);
      // Petals
      deco.fillStyle(fc, 0.35);
      deco.fillCircle(fx - 2, fy - 2, 2);
      deco.fillCircle(fx + 2, fy - 2, 2);
      deco.fillCircle(fx, fy - 4, 2);
      // Center
      deco.fillStyle(0xffee44, 0.4);
      deco.fillCircle(fx, fy - 2, 1.5);
    }

    // --- Center circle marking ---
    bg.lineStyle(1.5, 0xffffff, 0.06);
    bg.strokeCircle(W / 2, H / 2, 80);
    bg.strokeCircle(W / 2, H / 2, 40);
    bg.fillStyle(0xffffff, 0.03);
    bg.fillCircle(W / 2, H / 2, 6);

    // --- Border (wooden fence feel) ---
    const border = this.add.graphics();
    // Dark outer shadow
    border.lineStyle(6, 0x000000, 0.15);
    border.strokeRoundedRect(1, 1, W - 2, H - 2, 8);
    // Brown wooden border
    border.lineStyle(4, 0x8b6914, 0.5);
    border.strokeRoundedRect(2, 2, W - 4, H - 4, 8);
    // Light inner highlight
    border.lineStyle(1.5, 0xc4a035, 0.25);
    border.strokeRoundedRect(5, 5, W - 10, H - 10, 6);
    // Corner flowers
    const corners = [[12, 12], [W - 12, 12], [12, H - 12], [W - 12, H - 12]];
    corners.forEach(([cx, cy]) => {
      border.fillStyle(0xff8888, 0.3);
      border.fillCircle(cx, cy, 5);
      border.fillStyle(0xffdd44, 0.4);
      border.fillCircle(cx, cy, 2.5);
    });

    // --- Paw prints (subtle) ---
    for (let i = 0; i < 6; i++) {
      const px = Phaser.Math.Between(50, W - 50);
      const py = Phaser.Math.Between(50, H - 50);
      this.add.text(px, py, '\u{1F43E}', { fontSize: '16px' }).setAlpha(0.05).setAngle(Phaser.Math.Between(-40, 40));
    }
  }

  // --- Input & Update ---

  update() {
    if (!this.gameState) return;

    let dx = 0, dy = 0, dash = false;

    // Keyboard
    if (this.cursors.left.isDown || this.wasd.A.isDown) dx -= 1;
    if (this.cursors.right.isDown || this.wasd.D.isDown) dx += 1;
    if (this.cursors.up.isDown || this.wasd.W.isDown) dy -= 1;
    if (this.cursors.down.isDown || this.wasd.S.isDown) dy += 1;
    if (this.wasd.SPACE.isDown || this.cursors.shift?.isDown) dash = true;

    // Joystick
    if (this.joystick) {
      if (Math.abs(this.joystick.dx) > 0.1 || Math.abs(this.joystick.dy) > 0.1) {
        dx = this.joystick.dx;
        dy = this.joystick.dy;
      }
    }
    if (this.dashPending) { dash = true; this.dashPending = false; }

    socket.sendInput(dx, dy, dash);

    // Cleanup old trails
    this._dashTrails = this._dashTrails.filter(t => { if (t.alpha <= 0) { t.destroy(); return false; } return true; });

    this._updateCooldownUI();
  }

  // --- Game start ---

  _onGameStart(data) {
    if (data.obstacles) {
      this._obstacles = data.obstacles;
      this._drawObstacles();
    } else {
      this._obstacleGraphics.clear();
    }
    // Let renderer handle mode-specific start data
    if (this.modeRenderer?.onGameStart) {
      this.modeRenderer.onGameStart(data);
    }
    this._showCountdown();
  }

  _showCountdown() {
    const cx = this.cameras.main.width / 2;
    const cy = this.cameras.main.height / 2;

    const steps = [
      { text: '3', color: '#ffffff', delay: 0 },
      { text: '2', color: '#ffffff', delay: 1000 },
      { text: '1', color: '#ffffff', delay: 2000 },
      { text: '시작!', color: '#ffd700', delay: 3000 },
    ];

    steps.forEach(({ text, color, delay }) => {
      this.time.delayedCall(delay, () => {
        if (delay < 3000) {
          sound.countdown();
        } else {
          sound.gameStart();
        }
        const txt = this.add.text(cx, cy, text, {
          fontSize: '72px', fontFamily: 'Jua, sans-serif', color,
          stroke: '#000000', strokeThickness: 6,
        }).setOrigin(0.5).setDepth(100).setScale(2).setAlpha(1);

        this.tweens.add({
          targets: txt, scaleX: 1, scaleY: 1, duration: 400, ease: 'Back.easeOut',
        });
        this.tweens.add({
          targets: txt, alpha: 0, delay: 600, duration: 300, ease: 'Power2',
          onComplete: () => txt.destroy(),
        });
      });
    });
  }

  // --- Obstacles ---

  _drawObstacles() {
    const g = this._obstacleGraphics;
    g.clear();

    for (const obs of this._obstacles) {
      const cx = obs.x + obs.w / 2;
      const cy = obs.y + obs.h / 2;
      const type = obs.type || 'tree';

      // Unified shadow
      g.fillStyle(0x000000, 0.3);
      g.fillEllipse(cx + 3, obs.y + obs.h + 8, obs.w * 1.3 + 10, 16);

      if (type === 'tree') {
        // Ground shade ring
        g.fillStyle(0x1a5a1a, 0.25);
        g.fillCircle(cx, cy + obs.h / 2 + 2, obs.w / 2 + 14);

        // Trunk with wood grain
        g.fillStyle(0x8a5420, 1);
        g.fillRoundedRect(cx - 10, cy, 20, obs.h / 2 + 12, 4);
        g.lineStyle(1, 0x6a3a10, 0.6);
        g.lineBetween(cx - 4, cy + 4, cx - 3, cy + obs.h / 2 + 8);
        g.lineBetween(cx + 5, cy + 2, cx + 4, cy + obs.h / 2 + 6);
        g.lineStyle(2, 0x5a3010, 0.8);
        g.strokeRoundedRect(cx - 10, cy, 20, obs.h / 2 + 12, 4);

        // Foliage layers (dark → light, bottom → top)
        g.fillStyle(0x2d8a2d, 1);
        g.fillCircle(cx, cy - 4, obs.w / 2 + 10);
        g.fillStyle(0x3da83d, 1);
        g.fillCircle(cx - 10, cy - 6, obs.w / 2 + 2);
        g.fillCircle(cx + 10, cy - 6, obs.w / 2 + 2);
        g.fillStyle(0x50c050, 1);
        g.fillCircle(cx, cy - 12, obs.w / 2 + 4);
        g.fillStyle(0x66dd66, 0.9);
        g.fillCircle(cx - 6, cy - 16, obs.w / 3 + 3);
        g.fillCircle(cx + 8, cy - 14, obs.w / 3 + 2);
        // Light dapple highlights
        g.fillStyle(0x88ee88, 0.6);
        g.fillCircle(cx - 8, cy - 18, 7);
        g.fillCircle(cx + 10, cy - 16, 6);
        g.fillStyle(0xbbffbb, 0.4);
        g.fillCircle(cx - 4, cy - 22, 5);
        // Rim highlight
        g.lineStyle(2, 0xffffff, 0.3);
        g.strokeCircle(cx, cy - 12, obs.w / 2 + 4);

      } else if (type === 'rock') {
        // Main rock body
        g.fillStyle(0x99aabb, 1);
        g.fillEllipse(cx, cy, obs.w + 8, obs.h + 8);
        // Highlight (top-left lit)
        g.fillStyle(0xccdddd, 0.9);
        g.fillEllipse(cx - 4, cy - 4, obs.w * 0.7, obs.h * 0.6);
        g.fillStyle(0xe8eef0, 0.6);
        g.fillEllipse(cx - 6, cy - 8, obs.w * 0.35, obs.h * 0.25);
        // Secondary small rock
        g.fillStyle(0x8899aa, 1);
        g.fillEllipse(cx + obs.w / 2 + 2, cy + obs.h / 3, 12, 10);
        g.fillStyle(0xaabbcc, 0.7);
        g.fillEllipse(cx + obs.w / 2, cy + obs.h / 3 - 2, 8, 6);
        // Crack lines
        g.lineStyle(1.5, 0x667788, 0.6);
        g.lineBetween(cx - 6, cy - 2, cx + 8, cy + 10);
        g.lineBetween(cx + 2, cy - 6, cx - 4, cy + 4);
        // Moss patch
        g.fillStyle(0x558844, 0.5);
        g.fillEllipse(cx + obs.w / 4, cy - obs.h / 4, 10, 7);
        // Outline
        g.lineStyle(2, 0xddeeff, 0.35);
        g.strokeEllipse(cx, cy, obs.w + 8, obs.h + 8);

      } else if (type === 'fence') {
        // Posts (tall, darker brown)
        g.fillStyle(0x7a5518, 1);
        const postW = 10;
        g.fillRoundedRect(obs.x + 4, obs.y - 16, postW, obs.h + 32, 2);
        g.fillRoundedRect(obs.x + obs.w - 14, obs.y - 16, postW, obs.h + 32, 2);
        // Post caps (pointed top)
        g.fillStyle(0x6a4510, 1);
        const p1x = obs.x + 4 + postW / 2;
        const p2x = obs.x + obs.w - 14 + postW / 2;
        g.fillTriangle(p1x - 6, obs.y - 16, p1x + 6, obs.y - 16, p1x, obs.y - 24);
        g.fillTriangle(p2x - 6, obs.y - 16, p2x + 6, obs.y - 16, p2x, obs.y - 24);
        // Planks (main body with individual boards)
        g.fillStyle(0xcc9933, 1);
        g.fillRoundedRect(obs.x, obs.y, obs.w, obs.h, 3);
        // Board separators
        g.lineStyle(1, 0x9a7722, 0.5);
        const boards = 3;
        for (let i = 1; i < boards; i++) {
          const bx = obs.x + (obs.w / boards) * i;
          g.lineBetween(bx, obs.y + 1, bx, obs.y + obs.h - 1);
        }
        // Wood highlight
        g.fillStyle(0xddaa44, 0.6);
        g.fillRoundedRect(obs.x + 2, obs.y + 2, obs.w - 4, obs.h / 2 - 2, 2);
        // Nails
        g.fillStyle(0x666666, 0.9);
        g.fillCircle(obs.x + 10, cy - 3, 2.5);
        g.fillCircle(obs.x + 10, cy + 3, 2.5);
        g.fillCircle(obs.x + obs.w - 10, cy - 3, 2.5);
        g.fillCircle(obs.x + obs.w - 10, cy + 3, 2.5);
        // Rim
        g.lineStyle(1.5, 0xffffff, 0.2);
        g.strokeRoundedRect(obs.x, obs.y, obs.w, obs.h, 3);

      } else if (type === 'pond') {
        // Bank/mud ring
        g.fillStyle(0xbbaa66, 0.6);
        g.fillEllipse(cx, cy, obs.w + 16, obs.h + 16);
        // Water body
        g.fillStyle(0x2288cc, 1);
        g.fillEllipse(cx, cy, obs.w + 6, obs.h + 6);
        g.fillStyle(0x44aadd, 0.9);
        g.fillEllipse(cx, cy, obs.w - 2, obs.h - 2);
        // Light reflection
        g.fillStyle(0x88ccee, 0.7);
        g.fillEllipse(cx - 8, cy - 8, obs.w * 0.4, obs.h * 0.25);
        g.fillStyle(0xffffff, 0.5);
        g.fillCircle(cx - 12, cy - 10, 4);
        // Ripple
        g.lineStyle(1.5, 0xaaddff, 0.5);
        g.strokeEllipse(cx + 6, cy + 4, 18, 10);
        // Lily pad + flower
        g.fillStyle(0x44bb44, 1);
        g.fillCircle(cx + 18, cy + 12, 8);
        g.fillStyle(0x338833, 0.6);
        g.fillCircle(cx + 18, cy + 12, 4);
        g.fillStyle(0xff88aa, 0.9);
        g.fillCircle(cx + 18, cy + 10, 3);
        // Outline
        g.lineStyle(2, 0xffffff, 0.25);
        g.strokeEllipse(cx, cy, obs.w + 6, obs.h + 6);

      } else if (type === 'bush') {
        // Dark base layer
        g.fillStyle(0x338833, 1);
        g.fillEllipse(cx, cy + 2, obs.w + 10, obs.h + 8);
        // Leaf clusters (5 overlapping)
        g.fillStyle(0x44aa44, 1);
        g.fillEllipse(cx - 8, cy - 2, obs.w * 0.6, obs.h * 0.7);
        g.fillEllipse(cx + 8, cy, obs.w * 0.6, obs.h * 0.7);
        g.fillStyle(0x55cc55, 1);
        g.fillEllipse(cx, cy - 4, obs.w * 0.7, obs.h * 0.6);
        g.fillEllipse(cx - 10, cy + 4, obs.w * 0.5, obs.h * 0.5);
        g.fillEllipse(cx + 10, cy + 4, obs.w * 0.5, obs.h * 0.5);
        // Light patches
        g.fillStyle(0x77dd77, 0.6);
        g.fillCircle(cx - 6, cy - 8, 7);
        g.fillCircle(cx + 8, cy - 6, 6);
        // Berries (red)
        g.fillStyle(0xee2222, 1);
        g.fillCircle(cx + 12, cy + 4, 4);
        g.fillCircle(cx - 10, cy + 6, 4);
        g.fillCircle(cx + 2, cy + 10, 3.5);
        // Berry highlights
        g.fillStyle(0xff6666, 0.7);
        g.fillCircle(cx + 11, cy + 3, 2);
        g.fillCircle(cx - 11, cy + 5, 2);
        // Small flowers (pink/yellow buds)
        g.fillStyle(0xffaacc, 0.7);
        g.fillCircle(cx - 14, cy - 4, 3);
        g.fillCircle(cx + 14, cy - 2, 2.5);
        g.fillStyle(0xffee44, 0.6);
        g.fillCircle(cx - 14, cy - 4, 1.5);
        g.fillCircle(cx + 14, cy - 2, 1.2);
        // Rim
        g.lineStyle(2, 0xffffff, 0.25);
        g.strokeEllipse(cx, cy, obs.w + 10, obs.h + 8);
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
    const cx = g.container.x, cy = g.container.y;
    const radius = me.radius + 8;
    this._cooldownGraphic.lineStyle(3, 0xff6644, 0.6);
    this._cooldownGraphic.beginPath();
    this._cooldownGraphic.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2, false);
    this._cooldownGraphic.strokePath();

    const dashBtn = document.getElementById('dash-btn');
    if (dashBtn) dashBtn.style.opacity = cd > 0 ? '0.4' : '1';
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

    // Let renderer handle game-specific state (bone, bomb, ring, etc.)
    if (this.modeRenderer) {
      this.modeRenderer.onGameState(state);
    }

    // Scoreboard — delegate formatting to renderer
    const sorted = state.players.slice().sort((a, b) => b.score - a.score);
    const panelH = Math.max(30, sorted.length * 18 + 12);
    this._scorePanel.clear();
    this._scorePanel.fillStyle(0x000000, 0.55);
    this._scorePanel.fillRoundedRect(6, 6, 170, panelH, 8);

    let lines;
    if (this.modeRenderer?.formatScoreboard) {
      lines = this.modeRenderer.formatScoreboard(sorted, this.myId);
    } else {
      lines = sorted.map(p => `${p.name}  ${Math.floor(p.score)}`);
    }
    this.scoreboard.setText(lines.join('\n'));
  }

  // --- Player graphics ---

  _createPlayerGraphic(p) {
    const isMe = p.id === this.myId;
    const colInt = Phaser.Display.Color.HexStringToColor(p.color).color;
    const char = CHARACTERS[p.characterId] || CHARACTERS[DEFAULT_CHARACTER];
    const R = p.radius;

    const shadow = this.add.ellipse(0, R - 2, R * 1.6, 10, 0x000000, 0.25);
    const parts = [shadow];

    // Ears
    if (char.earType === 'pointy') {
      const earG = this.add.graphics();
      earG.fillStyle(char.ear, 1);
      earG.fillTriangle(-R + 2, -R + 8, -R + 12, -R - 8, -R + 18, -R + 10);
      earG.fillTriangle(R - 2, -R + 8, R - 12, -R - 8, R - 18, -R + 10);
      parts.push(earG);
    } else if (char.earType === 'floppy') {
      parts.push(this.add.ellipse(-R + 3, 4, 14, 20, char.ear));
      parts.push(this.add.ellipse(R - 3, 4, 14, 20, char.ear));
    } else if (char.earType === 'tall') {
      // Rabbit: long narrow ears pointing up
      parts.push(this.add.ellipse(-R + 6, -R - 10, 8, 22, char.ear));
      parts.push(this.add.ellipse(R - 6, -R - 10, 8, 22, char.ear));
      // Inner ear pink
      parts.push(this.add.ellipse(-R + 6, -R - 10, 4, 16, 0xffb6c1, 0.6));
      parts.push(this.add.ellipse(R - 6, -R - 10, 4, 16, 0xffb6c1, 0.6));
    } else if (char.earType === 'tiny') {
      // Hamster: very small round ears
      parts.push(this.add.circle(-R + 4, -R + 4, 5, char.ear));
      parts.push(this.add.circle(R - 4, -R + 4, 5, char.ear));
    } else if (char.earType === 'none') {
      // Penguin: no ears
    } else {
      parts.push(this.add.circle(-R + 4, -R + 6, 8, char.ear));
      parts.push(this.add.circle(R - 4, -R + 6, 8, char.ear));
    }

    const ring = this.add.circle(0, 0, R + 3, colInt);
    parts.push(ring);

    const body = this.add.circle(0, 0, R, char.body);
    parts.push(body);

    // Character features
    if (char.features.includes('curlyFur')) {
      parts.push(this.add.circle(-8, -8, 6, char.bodyHighlight, 0.5));
      parts.push(this.add.circle(8, -6, 5, char.bodyHighlight, 0.5));
      parts.push(this.add.circle(-4, 8, 5, char.bodyHighlight, 0.4));
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
    if (char.features.includes('belly')) {
      // Large white belly oval (penguin, hamster)
      parts.push(this.add.ellipse(0, 6, R * 1.2, R * 1.1, 0xfff8f0, 0.8));
    }
    if (char.features.includes('blackEyeMask')) {
      // Raccoon: dark band across eyes
      const maskG = this.add.graphics();
      maskG.fillStyle(0x333333, 0.7);
      maskG.fillRoundedRect(-14, -10, 28, 10, 3);
      parts.push(maskG);
    }
    if (char.features.includes('stripes')) {
      // Raccoon: diagonal body stripes
      const stripeG = this.add.graphics();
      stripeG.lineStyle(2, 0x555555, 0.4);
      stripeG.lineBetween(-R + 4, -4, -R + 14, 10);
      stripeG.lineBetween(0, -6, 0, 10);
      stripeG.lineBetween(R - 4, -4, R - 14, 10);
      parts.push(stripeG);
    }
    if (char.features.includes('tailBushy')) {
      // Fox: fluffy tail puff behind body
      parts.push(this.add.circle(-R - 4, 6, 8, char.bodyHighlight, 0.7));
      parts.push(this.add.circle(-R - 2, 2, 5, 0xffffff, 0.6));
    }

    // Eyes
    parts.push(this.add.circle(-7, -5, 4, char.eyeColor));
    parts.push(this.add.circle(7, -5, 4, char.eyeColor));
    parts.push(this.add.circle(-6, -6, 1.5, 0xffffff, 0.8));
    parts.push(this.add.circle(8, -6, 1.5, 0xffffff, 0.8));

    // Whiskers (cat, hamster)
    if (char.features.includes('whiskers')) {
      const wG = this.add.graphics();
      wG.lineStyle(1, 0x888888, 0.6);
      wG.lineBetween(-14, 1, -6, 0);
      wG.lineBetween(-14, 4, -6, 3);
      wG.lineBetween(14, 1, 6, 0);
      wG.lineBetween(14, 4, 6, 3);
      parts.push(wG);
    }

    // Nose & mouth
    if (char.features.includes('beak')) {
      // Penguin: orange triangle beak instead of round nose
      const beakG = this.add.graphics();
      beakG.fillStyle(char.noseColor, 1);
      beakG.fillTriangle(-5, 1, 5, 1, 0, 8);
      parts.push(beakG);
    } else {
      parts.push(this.add.circle(0, 3, 3, char.noseColor));
    }
    const mouth = this.add.graphics();
    mouth.lineStyle(1.5, 0x555555, 0.6);
    mouth.beginPath();
    mouth.arc(0, 5, 4, Phaser.Math.DegToRad(20), Phaser.Math.DegToRad(160), false);
    mouth.strokePath();
    parts.push(mouth);

    // Bone in mouth (hidden by default)
    const mouthBone = this.add.container(0, R - 6);
    mouthBone.add([
      this.add.circle(-5, 0, 4, 0xfff8dc),
      this.add.circle(5, 0, 4, 0xfff8dc),
      this.add.rectangle(0, 0, 10, 5, 0xfff8dc).setOrigin(0.5),
    ]);
    mouthBone.setVisible(false);
    parts.push(mouthBone);

    const container = this.add.container(p.x, p.y, parts).setDepth(10);

    if (isMe) {
      const arrow = this.add.text(0, -R - 22, '\u25bc', {
        fontSize: '16px', fontFamily: 'Jua', color: '#ffd700',
      }).setOrigin(0.5);
      this.tweens.add({ targets: arrow, y: -R - 16, yoyo: true, repeat: -1, duration: 500, ease: 'Sine.easeInOut' });
      container.add(arrow);
    }

    const nameTag = this.add.container(p.x, p.y + R + 16).setDepth(10);
    nameTag.add(this.add.text(0, 0, p.name, {
      fontSize: '14px', color: '#ffffff', fontFamily: 'Jua, sans-serif',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5));

    const scoreBar = this.add.graphics().setDepth(10);

    this.playerGraphics.set(p.id, {
      container, nameText: nameTag, scoreBar,
      prevX: p.x, prevY: p.y, colInt, body,
      bodyColor: char.body, mouthBone,
    });
  }

  _updatePlayerGraphic(p) {
    const g = this.playerGraphics.get(p.id);
    if (!g) return;

    const tx = Phaser.Math.Linear(g.container.x, p.x, LERP);
    const ty = Phaser.Math.Linear(g.container.y, p.y, LERP);

    g.container.setPosition(tx, ty);
    g.nameText.setPosition(tx, ty + p.radius + 16);

    // Let renderer draw score bars (or use default)
    if (this.modeRenderer?.drawPlayerScoreBar) {
      this.modeRenderer.drawPlayerScoreBar(g, p, tx, ty);
    } else {
      const barW = 50, barH = 5;
      const pct = Math.min(p.score / 30, 1);
      g.scoreBar.clear();
      g.scoreBar.fillStyle(0x333333, 0.5);
      g.scoreBar.fillRoundedRect(tx - barW / 2, ty + p.radius + 30, barW, barH, 2);
      if (pct > 0) {
        g.scoreBar.fillStyle(0xffd700, 0.9);
        g.scoreBar.fillRoundedRect(tx - barW / 2, ty + p.radius + 30, barW * pct, barH, 2);
      }
    }

    // Visual feedback
    if (p.isEliminated) {
      g.container.setAlpha(0.3);
      g.container.setScale(0.8);
    } else if (p.isKnockedBack) {
      g.body.setFillStyle(0xff6666);
      g.container.setScale(0.9);
      g.container.setAlpha(1);
    } else if (p.isDashing) {
      g.body.setFillStyle(0xffee44);
      g.container.setScale(1.12);
      g.container.setAlpha(1);
      this._spawnDashTrail(tx, ty, g.colInt);
    } else if (p.hasBone) {
      // Bone holder: golden glow + pulsing scale
      g.body.setFillStyle(0xffe070);
      const pulse = 1.05 + Math.sin(Date.now() / 150) * 0.07;
      g.container.setScale(pulse);
      g.container.setAlpha(1);
      // Outer glow aura
      const glowAlpha = 0.15 + Math.sin(Date.now() / 300) * 0.1;
      this._cooldownGraphic.fillStyle(0xffd700, glowAlpha);
      this._cooldownGraphic.fillCircle(tx, ty, p.radius + 22);
      // Pulsing ring
      this._cooldownGraphic.lineStyle(4, 0xffd700, 0.6 + Math.sin(Date.now() / 200) * 0.3);
      this._cooldownGraphic.strokeCircle(tx, ty, p.radius + 14);
      // Bone icon above head
      this._cooldownGraphic.fillStyle(0xfff8dc, 0.9);
      this._cooldownGraphic.fillCircle(tx - 6, ty - p.radius - 20, 4);
      this._cooldownGraphic.fillCircle(tx + 6, ty - p.radius - 20, 4);
      this._cooldownGraphic.fillRect(tx - 6, ty - p.radius - 23, 12, 6);
    } else if (p.hasBomb) {
      // Bomb holder: red pulsing
      g.body.setFillStyle(0xff4444);
      const pulse = 1.0 + Math.sin(Date.now() / 100) * 0.08;
      g.container.setScale(pulse);
      g.container.setAlpha(1);
      this._cooldownGraphic.lineStyle(3, 0xff0000, 0.4 + Math.sin(Date.now() / 150) * 0.3);
      this._cooldownGraphic.strokeCircle(tx, ty, p.radius + 12);
    } else if (p.isIt) {
      // Tag "it" player: red outline
      g.body.setFillStyle(g.bodyColor);
      g.container.setScale(1);
      g.container.setAlpha(1);
      this._cooldownGraphic.lineStyle(3, 0xff4444, 0.6);
      this._cooldownGraphic.strokeCircle(tx, ty, p.radius + 10);
    } else {
      g.container.setScale(1);
      g.container.setAlpha(1);
      g.body.setFillStyle(g.bodyColor);
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
    // Handle emoji events
    if (ev.type === 'emoji') {
      this._showBubble(ev.playerId, ev.emoji, 28, 2000);
      return;
    }
    // Delegate to renderer
    if (this.modeRenderer) {
      this.modeRenderer.onGameEvent(ev);
    }
  }

  showFloatingText(x, y, msg, color = '#ffffff') {
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

  // --- Emoji bar ---

  _createEmojiBar() {
    const EMOJIS = ['😂', '👍', '🔥', '💀', '😭', '🎉'];
    const bar = document.createElement('div');
    bar.id = 'emoji-bar';
    bar.className = 'emoji-bar collapsed';

    const toggle = document.createElement('button');
    toggle.className = 'emoji-toggle';
    toggle.textContent = '😀';
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      bar.classList.toggle('collapsed');
    });
    bar.appendChild(toggle);

    const row = document.createElement('div');
    row.className = 'emoji-row';
    EMOJIS.forEach(em => {
      const btn = document.createElement('button');
      btn.className = 'emoji-btn';
      btn.textContent = em;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        socket.sendEmoji(em);
        bar.classList.add('collapsed');
      });
      row.appendChild(btn);
    });
    bar.appendChild(row);
    document.body.appendChild(bar);
    this._emojiBar = bar;
  }

  // --- Fullscreen + landscape orientation lock ---

  async _requestLandscape() {
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (!isMobile) return;
    try {
      const el = document.documentElement;
      const rfs = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
      if (rfs) {
        await rfs.call(el);
        // Once in fullscreen, lock orientation
        if (screen.orientation && screen.orientation.lock) {
          await screen.orientation.lock('landscape').catch(() => {});
        }
      }
    } catch (e) { /* user denied or unsupported */ }
  }

  _exitLandscape() {
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        const efs = document.exitFullscreen || document.webkitExitFullscreen;
        if (efs) efs.call(document);
      }
      if (screen.orientation && screen.orientation.unlock) {
        screen.orientation.unlock();
      }
    } catch (e) {}
  }

  // --- Speech bubble (for emoji) ---

  _showBubble(playerId, content, fontSize, duration) {
    const g = this.playerGraphics.get(playerId);
    if (!g) return;
    const x = g.container.x;
    const y = g.container.y - 40;

    // Background
    const isEmoji = fontSize >= 20;
    const padding = isEmoji ? 4 : 8;
    const bg = this.add.graphics().setDepth(60);
    const text = this.add.text(x, y, content, {
      fontSize: `${fontSize}px`,
      color: '#ffffff',
      fontFamily: 'Jua, sans-serif',
      stroke: '#000000',
      strokeThickness: isEmoji ? 0 : 2,
      wordWrap: { width: 120 },
      align: 'center',
    }).setOrigin(0.5).setDepth(61);

    const bw = text.width + padding * 2;
    const bh = text.height + padding * 2;
    if (!isEmoji) {
      bg.fillStyle(0x000000, 0.6);
      bg.fillRoundedRect(x - bw / 2, y - bh / 2, bw, bh, 8);
    }

    // Animate up and fade
    this.tweens.add({
      targets: [text, bg],
      y: `-=${30}`,
      alpha: 0,
      duration,
      ease: 'Power1',
      onUpdate: () => {
        if (!isEmoji) {
          bg.clear();
          bg.fillStyle(0x000000, 0.6 * text.alpha);
          bg.fillRoundedRect(text.x - bw / 2, text.y - bh / 2, bw, bh, 8);
        }
      },
      onComplete: () => {
        text.destroy();
        bg.destroy();
      },
    });
  }

  // --- Game end ---

  _onGameEnd(data) {
    sound.win();

    // Record stats
    StatsManager.recordGame(this.gameType, data.winnerId === this.myId);

    if (this.joystick) { this.joystick.destroy(); this.joystick = null; }
    if (this._emojiBar) { this._emojiBar.remove(); this._emojiBar = null; }

    // Cleanup renderer
    if (this.modeRenderer) {
      this.modeRenderer.destroy();
      this.modeRenderer = null;
    }

    const W = this.mapWidth, H = this.mapHeight;

    const overlay = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0).setDepth(100);
    this.tweens.add({ targets: overlay, alpha: 0.8, duration: 500 });

    const trophy = this.add.text(W / 2, H / 2 - 110, '\u{1F3C6}', { fontSize: '60px' })
      .setOrigin(0.5).setDepth(101).setScale(0);
    this.tweens.add({ targets: trophy, scaleX: 1, scaleY: 1, duration: 600, ease: 'Back.easeOut', delay: 300 });

    const winnerMsg = data.winnerName ? `${data.winnerName} 승리!` : '무승부!';
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

    // Lobby button
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
    if (this._onGameStartBound) socket.off('game:start', this._onGameStartBound);
    if (this._onGameStateBound) socket.off('game:state', this._onGameStateBound);
    if (this._onGameEventBound) socket.off('game:event', this._onGameEventBound);
    if (this._onGameEndBound) socket.off('game:end', this._onGameEndBound);

    this._exitLandscape();
    if (this._lobbyBtn) { this._lobbyBtn.remove(); this._lobbyBtn = null; }
    if (this._emojiBar) { this._emojiBar.remove(); this._emojiBar = null; }
    if (this.modeRenderer) { try { this.modeRenderer.destroy(); } catch (e) {} this.modeRenderer = null; }
    if (this.joystick) { try { this.joystick.destroy(); } catch (e) {} this.joystick = null; }
    for (const g of this.playerGraphics.values()) {
      try { g.container?.destroy(); } catch (e) {}
      try { g.nameText?.destroy(); } catch (e) {}
      try { g.scoreBar?.destroy(); } catch (e) {}
    }
    this.playerGraphics.clear();
    this._dashTrails.forEach(t => { try { t?.destroy(); } catch (e) {} });
    this._dashTrails = [];
  }
}
