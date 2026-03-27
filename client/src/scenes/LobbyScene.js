import Phaser from 'phaser';
import socket from '../network/SocketClient.js';

const PAW_PRINT = '\u{1F43E}'; // emoji fallback
const COLORS = {
  bg1: 0x0f0c29,
  bg2: 0x302b63,
  gold: 0xffd700,
  goldDark: 0xdaa520,
  panel: 0x1a1640,
  panelBorder: 0x3d2f7f,
  btnCreate: 0xe74c3c,
  btnCreateHover: 0xff6b6b,
  btnJoin: 0x3498db,
  btnJoinHover: 0x5dade2,
  btnStart: 0xf39c12,
  btnStartHover: 0xf5b041,
  btnConfirm: 0x2ecc71,
  white: '#ffffff',
  muted: '#8888bb',
};

export class LobbyScene extends Phaser.Scene {
  constructor() {
    super({ key: 'LobbyScene' });
    this.roomState = null;
    this.myName = '';
    this.roomCode = null;
    this.isHost = false;
    this._pawEmitters = [];
  }

  create() {
    socket.connect();
    const { width, height } = this.scale;

    // --- Gradient background ---
    const bg = this.add.graphics();
    bg.fillGradientStyle(COLORS.bg1, COLORS.bg1, COLORS.bg2, COLORS.bg2, 1);
    bg.fillRect(0, 0, width, height);

    // --- Floating paw prints (ambient particles) ---
    this._createAmbientPaws(width, height);

    // --- Main card panel ---
    const panelW = 360, panelH = 480;
    const px = (width - panelW) / 2, py = 50;

    const panel = this.add.graphics();
    panel.fillStyle(COLORS.panel, 0.85);
    panel.fillRoundedRect(px, py, panelW, panelH, 20);
    panel.lineStyle(2, COLORS.panelBorder, 0.6);
    panel.strokeRoundedRect(px, py, panelW, panelH, 20);

    // --- Title ---
    const title = this.add.text(width / 2, py + 50, 'KEEPAWAY', {
      fontSize: '42px', fontFamily: 'Black Han Sans, Jua, sans-serif',
      color: '#ffd700',
    }).setOrigin(0.5);

    // Glow behind title
    const glow = this.add.circle(width / 2, py + 50, 80, 0xffd700, 0.08);
    this.tweens.add({ targets: glow, alpha: 0.15, yoyo: true, repeat: -1, duration: 2000, ease: 'Sine.easeInOut' });

    // Title bounce
    this.tweens.add({ targets: title, y: py + 44, yoyo: true, repeat: -1, duration: 1500, ease: 'Sine.easeInOut' });

    this.add.text(width / 2, py + 85, 'hwanggeumppyedagwireul jikyeora!', {
      fontSize: '11px', fontFamily: 'Jua, sans-serif', color: COLORS.muted,
    }).setOrigin(0.5);
    this.add.text(width / 2, py + 85, '\ud669\uae08 \ubf08\ub2e4\uadc0\ub97c \uc9c0\ucf1c\ub77c!', {
      fontSize: '14px', fontFamily: 'Jua, sans-serif', color: '#bbbbdd',
    }).setOrigin(0.5);

    // --- Poodle icon ---
    this.add.text(width / 2, py + 28, '\u{1F429}', { fontSize: '22px' }).setOrigin(0.5);

    // --- Name input (HTML) ---
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = '\ub2c9\ub124\uc784 \uc785\ub825';
    nameInput.maxLength = 10;
    nameInput.className = 'keepaway-input';
    nameInput.style.top = `${this._canvasTopOffset() + py + 120}px`;
    document.body.appendChild(nameInput);
    this._nameInput = nameInput;

    // --- Buttons ---
    const btnY = py + 185;
    this._createBtn(width / 2 - 80, btnY, '\ubc29 \ub9cc\ub4e4\uae30', COLORS.btnCreate, COLORS.btnCreateHover, () => this._createRoom());
    this._createBtn(width / 2 + 80, btnY, '\ubc29 \ucc38\uc5ec', COLORS.btnJoin, COLORS.btnJoinHover, () => this._showJoinInput());

    // --- Code input (hidden) ---
    const codeInput = document.createElement('input');
    codeInput.type = 'text';
    codeInput.placeholder = '\ubc29 \ucf54\ub4dc (4\uc790\ub9ac)';
    codeInput.maxLength = 4;
    codeInput.className = 'keepaway-input';
    Object.assign(codeInput.style, {
      top: `${this._canvasTopOffset() + py + 230}px`,
      letterSpacing: '8px',
      textTransform: 'uppercase',
      width: '200px',
      display: 'none',
    });
    document.body.appendChild(codeInput);
    this._codeInput = codeInput;

    this._confirmJoinBtn = this._createBtn(width / 2, btnY + 70, '\uc785\uc7a5', COLORS.btnConfirm, 0x58d68d, () => this._joinRoom());
    this._confirmJoinBtn.setVisible(false);

    // --- Lobby info area ---
    const infoY = py + 290;
    this._lobbyPanel = this.add.graphics();
    this._lobbyText = this.add.text(width / 2, infoY, '', {
      fontSize: '16px', color: '#aaffaa', fontFamily: 'Jua, sans-serif', align: 'center',
    }).setOrigin(0.5);

    this._playerListText = this.add.text(width / 2, infoY + 35, '', {
      fontSize: '15px', color: '#ffffff', fontFamily: 'Jua, sans-serif',
      align: 'center', lineSpacing: 6,
    }).setOrigin(0.5, 0);

    // Start button (host only)
    this._startBtn = this._createBtn(width / 2, py + panelH - 50, '\u25b6  \uac8c\uc784 \uc2dc\uc791', COLORS.btnStart, COLORS.btnStartHover, () => this._startGame(), 22);
    this._startBtn.setVisible(false);

    // Status text
    this._statusText = this.add.text(width / 2, height - 25, '', {
      fontSize: '13px', color: '#ff8888', fontFamily: 'Jua, sans-serif',
    }).setOrigin(0.5);

    // --- Socket listeners ---
    socket.on('room:update', (state) => this._onRoomUpdate(state));
    socket.on('game:start', () => {
      this._cleanup();
      this.scene.start('GameScene', { roomCode: this.roomCode, myName: this.myName });
    });
  }

  _canvasTopOffset() {
    const canvas = document.querySelector('canvas');
    return canvas ? canvas.getBoundingClientRect().top : 0;
  }

  _createAmbientPaws(width, height) {
    for (let i = 0; i < 8; i++) {
      const paw = this.add.text(
        Phaser.Math.Between(20, width - 20),
        Phaser.Math.Between(20, height - 20),
        PAW_PRINT, { fontSize: `${Phaser.Math.Between(14, 28)}px` }
      ).setAlpha(Phaser.Math.FloatBetween(0.04, 0.12)).setAngle(Phaser.Math.Between(-30, 30));

      this.tweens.add({
        targets: paw,
        y: paw.y - Phaser.Math.Between(30, 80),
        alpha: 0,
        duration: Phaser.Math.Between(4000, 8000),
        repeat: -1,
        yoyo: true,
        ease: 'Sine.easeInOut',
        delay: Phaser.Math.Between(0, 3000),
      });
    }
  }

  _createBtn(x, y, label, color, hoverColor, onClick, fontSize = 16) {
    const w = label.length * (fontSize * 0.7) + 36;
    const h = fontSize + 24;

    const container = this.add.container(x, y);

    const bg = this.add.graphics();
    bg.fillStyle(color, 1);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    // Subtle shadow
    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.3);
    shadow.fillRoundedRect(-w / 2 + 2, -h / 2 + 3, w, h, h / 2);

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

  _showJoinInput() {
    this._codeInput.style.display = 'block';
    this._confirmJoinBtn.setVisible(true);
    this._codeInput.focus();
  }

  async _createRoom() {
    const name = this._nameInput.value.trim() || '\uc775\uba85';
    this.myName = name;
    const res = await socket.createRoom(name);
    if (res.ok) {
      this.roomCode = res.code;
      this.isHost = true;
      this._onRoomUpdate(res.roomState);
    } else {
      this._statusText.setText(res.error || '\ubc29 \uc0dd\uc131 \uc2e4\ud328');
    }
  }

  async _joinRoom() {
    const name = this._nameInput.value.trim() || '\uc775\uba85';
    const code = this._codeInput.value.toUpperCase();
    this.myName = name;
    const res = await socket.joinRoom(code, name);
    if (res.ok) {
      this.roomCode = res.code;
      this.isHost = false;
      this._codeInput.style.display = 'none';
      this._confirmJoinBtn.setVisible(false);
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

    this._lobbyText.setText(`\ud83d\udd11  \ubc29 \ucf54\ub4dc: ${state.code}   (${state.players.length}/8)`);

    const list = state.players.map((p, i) => {
      const crown = i === 0 ? '\ud83d\udc51 ' : '      ';
      return `${crown}${p.name}`;
    }).join('\n');
    this._playerListText.setText(list);

    this._startBtn.setVisible(isHost && state.players.length >= 2);

    if (!isHost && state.players.length > 0) {
      this._statusText.setText('\ud638\uc2a4\ud2b8\uac00 \uac8c\uc784\uc744 \uc2dc\uc791\ud560 \ub54c\uae4c\uc9c0 \uae30\ub2e4\ub824\uc8fc\uc138\uc694...');
    }
  }

  _cleanup() {
    this._nameInput?.remove();
    this._codeInput?.remove();
  }

  shutdown() {
    this._cleanup();
  }
}
