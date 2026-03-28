import Phaser from 'phaser';
import socket from '../network/SocketClient.js';
import { CHARACTERS, CHARACTER_IDS, DEFAULT_CHARACTER } from '../characters.js';

const PAW_PRINT = '\u{1F43E}';
const COLORS = {
  bg1: 0x0f0c29,
  bg2: 0x302b63,
  panel: 0x1a1640,
  panelBorder: 0x3d2f7f,
  btnCreate: 0xe74c3c,
  btnCreateHover: 0xff6b6b,
  btnJoin: 0x3498db,
  btnJoinHover: 0x5dade2,
  btnStart: 0xf39c12,
  btnStartHover: 0xf5b041,
  btnConfirm: 0x2ecc71,
  charSelected: 0xffd700,
  charBg: 0x2a2460,
  charBgHover: 0x3a3480,
};

export class LobbyScene extends Phaser.Scene {
  constructor() {
    super({ key: 'LobbyScene' });
    this.roomState = null;
    this.myName = '';
    this.roomCode = null;
    this.isHost = false;
    this.selectedCharacter = DEFAULT_CHARACTER;
    this._htmlElements = [];
    this._resizeHandler = null;
    this._charCards = [];
  }

  init(data) {
    // Receive room data when returning from game
    this._returnData = data || {};
  }

  create() {
    socket.connect();
    const W = this.scale.width;   // 800
    const H = this.scale.height;  // 600
    const CX = W / 2;
    this.selectedCharacter = DEFAULT_CHARACTER;

    // --- Background ---
    const bg = this.add.graphics();
    bg.fillGradientStyle(COLORS.bg1, COLORS.bg1, COLORS.bg2, COLORS.bg2, 1);
    bg.fillRect(0, 0, W, H);

    this._createAmbientPaws(W, H);

    // ========== PRE-ROOM VIEW ==========
    this._preRoomContainer = this.add.container(0, 0);
    this._buildPreRoomView(CX, W, H);

    // ========== IN-ROOM VIEW ==========
    this._inRoomContainer = this.add.container(0, 0);
    this._inRoomContainer.setVisible(false);
    this._buildInRoomView(CX, W, H);

    // --- Status (always visible) ---
    this._statusText = this.add.text(CX, H - 12, '', {
      fontSize: '13px', color: '#ff8888', fontFamily: 'Jua, sans-serif',
    }).setOrigin(0.5);

    // --- Reposition inputs on resize ---
    this._resizeHandler = () => this._repositionInputs();
    window.addEventListener('resize', this._resizeHandler);
    this._repositionInputs();
    requestAnimationFrame(() => this._repositionInputs());
    this.time.delayedCall(50, () => this._repositionInputs());
    this.time.delayedCall(200, () => this._repositionInputs());
    this.scale.on('resize', this._resizeHandler);

    // --- Socket ---
    socket.on('room:update', (state) => this._onRoomUpdate(state));
    socket.on('game:start', () => {
      this._cleanup();
      this.scene.start('GameScene', { roomCode: this.roomCode, myName: this.myName });
    });

    // --- Return to existing room ---
    if (this._returnData.roomCode) {
      this.roomCode = this._returnData.roomCode;
      this.myName = this._returnData.myName || '';
      this._switchToRoomView();
      // Request current room state from server
      socket.rejoinRoom(this.roomCode).then(res => {
        if (res.ok) {
          this._onRoomUpdate(res.roomState);
        }
      });
    }
  }

  // ==========================================
  // PRE-ROOM VIEW (name + create/join)
  // ==========================================

  _buildPreRoomView(CX, W, H) {
    const panelW = 340, panelH = 360;
    const PX = (W - panelW) / 2, PY = (H - panelH) / 2 - 20;

    const panel = this.add.graphics();
    panel.fillStyle(COLORS.panel, 0.85);
    panel.fillRoundedRect(PX, PY, panelW, panelH, 20);
    panel.lineStyle(2, COLORS.panelBorder, 0.6);
    panel.strokeRoundedRect(PX, PY, panelW, panelH, 20);
    this._preRoomContainer.add(panel);

    // Title
    const poodle = this.add.text(CX, PY + 32, '\u{1F429}', { fontSize: '22px' }).setOrigin(0.5);
    const title = this.add.text(CX, PY + 60, 'KEEPAWAY', {
      fontSize: '40px', fontFamily: 'Black Han Sans, Jua, sans-serif', color: '#ffd700',
    }).setOrigin(0.5);
    const glow = this.add.circle(CX, PY + 60, 80, 0xffd700, 0.08);
    this.tweens.add({ targets: glow, alpha: 0.15, yoyo: true, repeat: -1, duration: 2000, ease: 'Sine.easeInOut' });
    this.tweens.add({ targets: title, y: PY + 55, yoyo: true, repeat: -1, duration: 1500, ease: 'Sine.easeInOut' });
    this._preRoomContainer.add([poodle, title, glow]);

    // Subtitle
    const sub = this.add.text(CX, PY + 98, '\ud669\uae08 \ubf08\ub2e4\uadc0\ub97c \uc9c0\ucf1c\ub77c!', {
      fontSize: '14px', fontFamily: 'Jua, sans-serif', color: '#bbbbdd',
    }).setOrigin(0.5);
    this._preRoomContainer.add(sub);

    // Name input (HTML)
    this._nameInput = this._createInput('\ub2c9\ub124\uc784 \uc785\ub825', CX, PY + 150, 10);

    // Create / Join buttons
    const btnY = PY + 215;
    const createBtn = this._createBtn(CX - 90, btnY, '\ubc29 \ub9cc\ub4e4\uae30', COLORS.btnCreate, COLORS.btnCreateHover, () => this._createRoom());
    const joinBtn = this._createBtn(CX + 90, btnY, '\ubc29 \ucc38\uc5ec', COLORS.btnJoin, COLORS.btnJoinHover, () => this._showJoinInput());
    this._preRoomContainer.add([createBtn, joinBtn]);

    // Code input (hidden by default)
    this._codeInput = this._createInput('\ubc29 \ucf54\ub4dc (4\uc790\ub9ac)', CX, PY + 275, 4);
    Object.assign(this._codeInput.style, {
      letterSpacing: '8px', textTransform: 'uppercase', width: '200px', display: 'none',
    });

    // Confirm join button
    this._confirmJoinBtn = this._createBtn(CX, PY + 325, '\uc785\uc7a5', COLORS.btnConfirm, 0x58d68d, () => this._joinRoom());
    this._confirmJoinBtn.setVisible(false);
    this._preRoomContainer.add(this._confirmJoinBtn);
  }

  // ==========================================
  // IN-ROOM VIEW (character select + lobby)
  // ==========================================

  _buildInRoomView(CX, W, H) {
    const panelW = 360, panelH = 520;
    const PX = (W - panelW) / 2, PY = (H - panelH) / 2 - 10;

    const panel = this.add.graphics();
    panel.fillStyle(COLORS.panel, 0.85);
    panel.fillRoundedRect(PX, PY, panelW, panelH, 20);
    panel.lineStyle(2, COLORS.panelBorder, 0.6);
    panel.strokeRoundedRect(PX, PY, panelW, panelH, 20);
    this._inRoomContainer.add(panel);

    // Back button (top-left of panel)
    const backBtn = this.add.text(PX + 16, PY + 16, '\u2190 \ub4a4\ub85c', {
      fontSize: '13px', fontFamily: 'Jua, sans-serif', color: '#8888aa',
    }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true })
      .on('pointerover', () => backBtn.setColor('#ffffff'))
      .on('pointerout', () => backBtn.setColor('#8888aa'))
      .on('pointerdown', () => this._leaveRoom());
    this._inRoomContainer.add(backBtn);

    // Room code badge at top
    this._roomBadge = this.add.text(CX, PY + 24, '', {
      fontSize: '16px', color: '#aaffaa', fontFamily: 'Jua, sans-serif', align: 'center',
    }).setOrigin(0.5);
    this._inRoomContainer.add(this._roomBadge);

    // Character selection label
    const charLabel = this.add.text(CX, PY + 56, '\u{1F436} \uce90\ub9ad\ud130 \uc120\ud0dd', {
      fontSize: '16px', fontFamily: 'Jua, sans-serif', color: '#ffd700',
    }).setOrigin(0.5);
    this._inRoomContainer.add(charLabel);

    // Character grid (2 rows x 3 cols) — bigger cells for mobile
    this._charCards = [];
    const cellW = 108, cellH = 84;
    const gridW = cellW * 3;
    const gridStartX = CX - gridW / 2;
    const gridStartY = PY + 78;

    CHARACTER_IDS.forEach((charId, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const cx = gridStartX + col * cellW + cellW / 2;
      const cy = gridStartY + row * cellH + cellH / 2;

      const card = this._createCharCard(cx, cy, cellW - 8, cellH - 8, charId);
      this._charCards.push(card);
      this._inRoomContainer.add(card.container);
    });

    // Divider line
    const divY = gridStartY + cellH * 2 + 16;
    const divider = this.add.graphics();
    divider.lineStyle(1, COLORS.panelBorder, 0.5);
    divider.lineBetween(PX + 30, divY, PX + panelW - 30, divY);
    this._inRoomContainer.add(divider);

    // Player list label
    this._lobbyLabel = this.add.text(CX, divY + 18, '\u{1F465} \ub300\uae30\uc2e4', {
      fontSize: '14px', color: '#bbbbdd', fontFamily: 'Jua, sans-serif',
    }).setOrigin(0.5);
    this._inRoomContainer.add(this._lobbyLabel);

    // Player list
    this._playerListText = this.add.text(CX, divY + 42, '', {
      fontSize: '15px', color: '#ffffff', fontFamily: 'Jua, sans-serif', align: 'center', lineSpacing: 8,
    }).setOrigin(0.5, 0);
    this._inRoomContainer.add(this._playerListText);

    // Wait / Start button area
    this._waitText = this.add.text(CX, PY + panelH - 50, '\ud638\uc2a4\ud2b8\uac00 \uac8c\uc784\uc744 \uc2dc\uc791\ud560 \ub54c\uae4c\uc9c0 \uae30\ub2e4\ub824\uc8fc\uc138\uc694...', {
      fontSize: '12px', color: '#8888aa', fontFamily: 'Jua, sans-serif',
    }).setOrigin(0.5);
    this._inRoomContainer.add(this._waitText);

    this._startBtn = this._createBtn(CX, PY + panelH - 50, '\u25b6  \uac8c\uc784 \uc2dc\uc791', COLORS.btnStart, COLORS.btnStartHover, () => this._startGame(), 20);
    this._startBtn.setVisible(false);
    this._inRoomContainer.add(this._startBtn);
  }

  // --- Character card ---

  _createCharCard(cx, cy, w, h, charId) {
    const char = CHARACTERS[charId];
    const isSelected = charId === this.selectedCharacter;

    const container = this.add.container(cx, cy);

    // Background
    const bg = this.add.graphics();
    this._drawCardBg(bg, w, h, isSelected);

    // Mini character preview
    const preview = this._drawMiniCharacter(0, -8, charId);

    // Name
    const nameText = this.add.text(0, h / 2 - 14, char.name, {
      fontSize: '12px', fontFamily: 'Jua, sans-serif', color: isSelected ? '#ffd700' : '#ccccdd',
    }).setOrigin(0.5);

    // Check mark
    const check = this.add.text(w / 2 - 12, -h / 2 + 10, '\u2713', {
      fontSize: '16px', fontFamily: 'sans-serif', color: '#ffd700', fontStyle: 'bold',
    }).setOrigin(0.5).setVisible(isSelected);

    container.add([bg, ...preview, nameText, check]);
    container.setSize(w, h);
    container.setInteractive({ useHandCursor: true })
      .on('pointerover', () => {
        if (charId !== this.selectedCharacter) {
          bg.clear();
          bg.fillStyle(COLORS.charBgHover, 0.7);
          bg.fillRoundedRect(-w / 2, -h / 2, w, h, 12);
          bg.lineStyle(2, COLORS.panelBorder, 0.6);
          bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 12);
        }
        container.setScale(1.06);
      })
      .on('pointerout', () => {
        this._updateCardVisual(charId, bg, nameText, check, w, h);
        container.setScale(1);
      })
      .on('pointerdown', () => {
        this.selectedCharacter = charId;
        socket.selectCharacter(charId);
        this._refreshAllCharCards();
      });

    return { container, bg, nameText, check, w, h, charId };
  }

  _drawCardBg(bg, w, h, isSelected) {
    bg.clear();
    bg.fillStyle(isSelected ? COLORS.charSelected : COLORS.charBg, isSelected ? 0.25 : 0.6);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 12);
    bg.lineStyle(isSelected ? 3 : 1.5, isSelected ? COLORS.charSelected : COLORS.panelBorder, isSelected ? 0.9 : 0.3);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 12);
  }

  _updateCardVisual(charId, bg, nameText, check, w, h) {
    const isSelected = charId === this.selectedCharacter;
    this._drawCardBg(bg, w, h, isSelected);
    nameText.setColor(isSelected ? '#ffd700' : '#ccccdd');
    check.setVisible(isSelected);
  }

  _refreshAllCharCards() {
    for (const card of this._charCards) {
      this._updateCardVisual(card.charId, card.bg, card.nameText, card.check, card.w, card.h);
    }
  }

  _drawMiniCharacter(cx, cy, charId) {
    const char = CHARACTERS[charId];
    const r = 18;
    const parts = [];

    // Shadow
    parts.push(this.add.ellipse(cx, cy + r - 2, r * 1.4, 7, 0x000000, 0.2));

    // Ears (behind body)
    if (char.earType === 'pointy') {
      const earG = this.add.graphics();
      earG.fillStyle(char.ear, 1);
      earG.fillTriangle(cx - r + 2, cy - r + 7, cx - r + 12, cy - r - 7, cx - r + 16, cy - r + 9);
      earG.fillTriangle(cx + r - 2, cy - r + 7, cx + r - 12, cy - r - 7, cx + r - 16, cy - r + 9);
      parts.push(earG);
    } else if (char.earType === 'floppy') {
      parts.push(this.add.ellipse(cx - r + 2, cy + 3, 12, 16, char.ear));
      parts.push(this.add.ellipse(cx + r - 2, cy + 3, 12, 16, char.ear));
    } else {
      parts.push(this.add.circle(cx - r + 4, cy - r + 5, 7, char.ear));
      parts.push(this.add.circle(cx + r - 4, cy - r + 5, 7, char.ear));
    }

    // Body
    parts.push(this.add.circle(cx, cy, r, char.body));

    // Features
    if (char.features.includes('curlyFur')) {
      parts.push(this.add.circle(cx - 6, cy - 6, 5, char.bodyHighlight, 0.5));
      parts.push(this.add.circle(cx + 6, cy - 5, 4, char.bodyHighlight, 0.5));
      parts.push(this.add.circle(cx - 3, cy + 6, 4, char.bodyHighlight, 0.4));
    }
    if (char.features.includes('fluffyFur')) {
      for (let a = 0; a < 6; a++) {
        const ang = (a / 6) * Math.PI * 2;
        parts.push(this.add.circle(cx + Math.cos(ang) * (r - 3), cy + Math.sin(ang) * (r - 3), 6, char.bodyHighlight, 0.4));
      }
    }
    if (char.features.includes('whiteCheeks')) {
      parts.push(this.add.circle(cx - 9, cy + 2, 6, 0xfff8dc, 0.7));
      parts.push(this.add.circle(cx + 9, cy + 2, 6, 0xfff8dc, 0.7));
    }
    if (char.features.includes('whiteBelly')) {
      parts.push(this.add.ellipse(cx, cy + 7, 16, 12, 0xfff8dc, 0.5));
    }
    if (char.features.includes('faceMask')) {
      const mask = this.add.graphics();
      mask.fillStyle(0xffffff, 0.6);
      mask.fillTriangle(cx - 7, cy - 5, cx + 7, cy - 5, cx, cy + 9);
      parts.push(mask);
    }
    if (char.features.includes('spots')) {
      parts.push(this.add.circle(cx - 8, cy - 7, 3.5, 0x222222, 0.8));
      parts.push(this.add.circle(cx + 6, cy - 3, 4, 0x222222, 0.8));
      parts.push(this.add.circle(cx - 3, cy + 7, 3.5, 0x222222, 0.7));
      parts.push(this.add.circle(cx + 9, cy + 6, 3, 0x222222, 0.7));
    }
    if (char.features.includes('longNose')) {
      parts.push(this.add.ellipse(cx, cy + 3, 12, 16, char.bodyHighlight, 0.5));
    }

    // Eyes
    parts.push(this.add.circle(cx - 6, cy - 4, 3.5, char.eyeColor));
    parts.push(this.add.circle(cx + 6, cy - 4, 3.5, char.eyeColor));
    parts.push(this.add.circle(cx - 5, cy - 5, 1.3, 0xffffff, 0.8));
    parts.push(this.add.circle(cx + 7, cy - 5, 1.3, 0xffffff, 0.8));

    // Nose
    parts.push(this.add.circle(cx, cy + 3, 2.5, char.noseColor));

    return parts;
  }

  // --- HTML input helpers ---

  _createInput(placeholder, gameX, gameY, maxLength) {
    const el = document.createElement('input');
    el.type = 'text';
    el.placeholder = placeholder;
    el.maxLength = maxLength;
    el.className = 'keepaway-input';
    Object.assign(el.style, {
      position: 'fixed', zIndex: '200',
    });
    el.dataset.gx = gameX;
    el.dataset.gy = gameY;
    document.body.appendChild(el);
    this._htmlElements.push(el);
    return el;
  }

  _repositionInputs() {
    const canvas = this.game.canvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / this.scale.width;
    const scaleY = rect.height / this.scale.height;

    for (const el of this._htmlElements) {
      const gx = parseFloat(el.dataset.gx);
      const gy = parseFloat(el.dataset.gy);
      el.style.left = `${rect.left + gx * scaleX}px`;
      el.style.top = `${rect.top + gy * scaleY}px`;
      el.style.transform = 'translate(-50%, -50%)';
      const baseFontSize = 17;
      el.style.fontSize = `${Math.round(baseFontSize * Math.min(scaleX, scaleY))}px`;
    }
  }

  // --- Phaser button ---

  _createBtn(x, y, label, color, hoverColor, onClick, fontSize = 16) {
    const w = label.length * (fontSize * 0.7) + 44;
    const h = fontSize + 28;
    const container = this.add.container(x, y);
    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.3);
    shadow.fillRoundedRect(-w / 2 + 2, -h / 2 + 3, w, h, h / 2);
    const bg = this.add.graphics();
    bg.fillStyle(color, 1);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    const text = this.add.text(0, 0, label, {
      fontSize: `${fontSize}px`, fontFamily: 'Jua, sans-serif', color: '#ffffff',
    }).setOrigin(0.5);
    container.add([shadow, bg, text]);
    container.setSize(w, h);
    container.setInteractive({ useHandCursor: true })
      .on('pointerover', () => { bg.clear(); bg.fillStyle(hoverColor, 1); bg.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2); container.setScale(1.05); })
      .on('pointerout', () => { bg.clear(); bg.fillStyle(color, 1); bg.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2); container.setScale(1); })
      .on('pointerdown', onClick);
    return container;
  }

  // --- Actions ---

  _showJoinInput() {
    this._codeInput.style.display = 'block';
    this._confirmJoinBtn.setVisible(true);
    this._repositionInputs();
    this._codeInput.focus();
  }

  _switchToRoomView() {
    // Hide pre-room
    this._preRoomContainer.setVisible(false);
    this._nameInput.style.display = 'none';
    this._codeInput.style.display = 'none';

    // Show in-room
    this._inRoomContainer.setVisible(true);
  }

  _leaveRoom() {
    // Disconnect and reconnect to leave the room
    socket.socket?.disconnect();
    this.roomCode = null;
    this.roomState = null;
    this.isHost = false;

    // Show pre-room
    this._inRoomContainer.setVisible(false);
    this._preRoomContainer.setVisible(true);
    this._nameInput.style.display = 'block';
    this._confirmJoinBtn.setVisible(false);
    this._codeInput.style.display = 'none';
    this._statusText.setText('');
    this._repositionInputs();

    // Reconnect
    socket.connect();
  }

  async _createRoom() {
    const name = this._nameInput.value.trim() || '\uc775\uba85';
    this.myName = name;
    const res = await socket.createRoom(name, this.selectedCharacter);
    if (res.ok) {
      this.roomCode = res.code;
      this.isHost = true;
      this._switchToRoomView();
      this._onRoomUpdate(res.roomState);
    } else {
      this._statusText.setText(res.error || '\ubc29 \uc0dd\uc131 \uc2e4\ud328');
    }
  }

  async _joinRoom() {
    const name = this._nameInput.value.trim() || '\uc775\uba85';
    const code = this._codeInput.value.toUpperCase();
    this.myName = name;
    const res = await socket.joinRoom(code, name, this.selectedCharacter);
    if (res.ok) {
      this.roomCode = res.code;
      this.isHost = false;
      this._switchToRoomView();
      this._onRoomUpdate(res.roomState);
    } else {
      this._statusText.setText(res.error || '\ucc38\uc5ec \uc2e4\ud328');
    }
  }

  async _startGame() {
    const res = await socket.startGame(this.roomCode);
    if (res && !res.ok) {
      this._statusText.setText(res.error || '\uc2dc\uc791 \uc2e4\ud328');
    }
  }

  _onRoomUpdate(state) {
    this.roomState = state;
    const isHost = socket.id && state.players[0]?.id === socket.id;
    this.isHost = isHost;

    this._roomBadge.setText(`\ud83d\udd11  \ubc29 \ucf54\ub4dc: ${state.code}   (${state.players.length}/8)`);

    const list = state.players.map((p, i) => {
      const crown = i === 0 ? '\ud83d\udc51 ' : '      ';
      const charEmoji = CHARACTERS[p.characterId]?.emoji || '\u{1F43E}';
      return `${crown}${charEmoji} ${p.name}`;
    }).join('\n');
    this._playerListText.setText(list);

    this._startBtn.setVisible(isHost && state.players.length >= 2);
    this._waitText.setVisible(!isHost);
  }

  _createAmbientPaws(width, height) {
    for (let i = 0; i < 8; i++) {
      const paw = this.add.text(
        Phaser.Math.Between(20, width - 20),
        Phaser.Math.Between(20, height - 20),
        PAW_PRINT, { fontSize: `${Phaser.Math.Between(14, 28)}px` }
      ).setAlpha(Phaser.Math.FloatBetween(0.04, 0.12)).setAngle(Phaser.Math.Between(-30, 30));
      this.tweens.add({
        targets: paw, y: paw.y - Phaser.Math.Between(30, 80), alpha: 0,
        duration: Phaser.Math.Between(4000, 8000), repeat: -1, yoyo: true,
        ease: 'Sine.easeInOut', delay: Phaser.Math.Between(0, 3000),
      });
    }
  }

  _cleanup() {
    for (const el of this._htmlElements) el.remove();
    this._htmlElements = [];
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }
  }

  shutdown() {
    this._cleanup();
  }
}
