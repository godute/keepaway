import Phaser from 'phaser';
import socket from '../network/SocketClient.js';
import { CHARACTERS, CHARACTER_IDS, DEFAULT_CHARACTER } from '../characters.js';

/**
 * LobbyScene — manages the HTML lobby overlay (responsive, mobile-friendly).
 * All UI is in index.html #lobby-overlay; this scene drives visibility & socket events.
 */
export class LobbyScene extends Phaser.Scene {
  constructor() {
    super({ key: 'LobbyScene' });
    this.roomState = null;
    this.myName = '';
    this.roomCode = null;
    this.isHost = false;
    this.selectedCharacter = DEFAULT_CHARACTER;
  }

  init(data) {
    this._returnData = data || {};
  }

  create() {
    socket.connect();
    this.selectedCharacter = DEFAULT_CHARACTER;

    // Grab DOM elements
    this._overlay = document.getElementById('lobby-overlay');
    this._preView = document.getElementById('lobby-pre');
    this._roomView = document.getElementById('lobby-room');
    this._nameInput = document.getElementById('name-input');
    this._codeInput = document.getElementById('code-input');
    this._joinSection = document.getElementById('join-section');
    this._statusText = document.getElementById('lobby-status');
    this._statusTextRoom = document.getElementById('lobby-status-room');
    this._roomBadge = document.getElementById('room-badge');
    this._playerList = document.getElementById('player-list');
    this._startBtn = document.getElementById('btn-start');
    this._waitText = document.getElementById('wait-text');
    this._charGrid = document.getElementById('char-grid');

    // Show lobby overlay, hide Phaser canvas
    this._overlay.classList.remove('hidden');
    const canvas = this.game.canvas;
    if (canvas) canvas.style.display = 'none';

    // Build character grid
    this._buildCharGrid();

    // Bind buttons
    this._bindBtn('btn-create', () => this._createRoom());
    this._bindBtn('btn-join-show', () => this._showJoinInput());
    this._bindBtn('btn-confirm-join', () => this._joinRoom());
    this._bindBtn('btn-back', () => this._leaveRoom());
    this._bindBtn('btn-start', () => this._startGame());

    // Enter key on inputs
    this._nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._createRoom();
    });
    this._codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._joinRoom();
    });

    // Socket events
    this._roomUpdateHandler = (state) => this._onRoomUpdate(state);
    this._gameStartHandler = (gameData) => {
      this._hideOverlay();
      this.scene.start('GameScene', { roomCode: this.roomCode, myName: this.myName, gameData });
    };
    socket.on('room:update', this._roomUpdateHandler);
    socket.on('game:start', this._gameStartHandler);

    // Show correct view
    this._showPreRoom();

    // Return to existing room
    if (this._returnData.roomCode) {
      this.roomCode = this._returnData.roomCode;
      this.myName = this._returnData.myName || '';
      this._showRoomView();
      socket.rejoinRoom(this.roomCode).then(res => {
        if (res.ok) {
          this._onRoomUpdate(res.roomState);
        }
      });
    }
  }

  // --- Character grid ---

  _buildCharGrid() {
    this._charGrid.innerHTML = '';
    CHARACTER_IDS.forEach(charId => {
      const char = CHARACTERS[charId];
      const card = document.createElement('div');
      card.className = 'char-card' + (charId === this.selectedCharacter ? ' selected' : '');
      card.dataset.charId = charId;
      card.innerHTML = `
        <span class="char-check">✓</span>
        <div class="char-emoji">${char.emoji}</div>
        <div class="char-name">${char.name}</div>
      `;
      card.addEventListener('click', () => {
        this.selectedCharacter = charId;
        socket.selectCharacter(charId);
        this._refreshCharGrid();
      });
      this._charGrid.appendChild(card);
    });
  }

  _refreshCharGrid() {
    const cards = this._charGrid.querySelectorAll('.char-card');
    cards.forEach(card => {
      card.classList.toggle('selected', card.dataset.charId === this.selectedCharacter);
    });
  }

  // --- View switching ---

  _showPreRoom() {
    this._preView.style.display = 'block';
    this._roomView.style.display = 'none';
    this._joinSection.style.display = 'none';
    this._setStatus('');
  }

  _showRoomView() {
    this._preView.style.display = 'none';
    this._roomView.style.display = 'block';
  }

  _hideOverlay() {
    this._overlay.classList.add('hidden');
    const canvas = this.game.canvas;
    if (canvas) canvas.style.display = '';
  }

  // --- Button binding helper ---

  _bindBtn(id, handler) {
    const el = document.getElementById(id);
    if (!el) return;
    // Store handler ref for cleanup
    if (!this._btnHandlers) this._btnHandlers = [];
    this._btnHandlers.push({ el, handler });
    el.addEventListener('click', handler);
  }

  // --- Actions ---

  _showJoinInput() {
    this._joinSection.style.display = 'block';
    setTimeout(() => this._codeInput.focus(), 50);
  }

  async _createRoom() {
    const name = this._nameInput.value.trim() || '익명';
    this.myName = name;
    const res = await socket.createRoom(name, this.selectedCharacter);
    if (res.ok) {
      this.roomCode = res.code;
      this.isHost = true;
      this._showRoomView();
      this._onRoomUpdate(res.roomState);
    } else {
      this._setStatus(res.error || '방 생성 실패');
    }
  }

  async _joinRoom() {
    const name = this._nameInput.value.trim() || '익명';
    const code = this._codeInput.value.toUpperCase();
    if (!code) return;
    this.myName = name;
    const res = await socket.joinRoom(code, name, this.selectedCharacter);
    if (res.ok) {
      this.roomCode = res.code;
      this.isHost = false;
      this._showRoomView();
      this._onRoomUpdate(res.roomState);
    } else {
      this._setStatus(res.error || '참여 실패');
    }
  }

  _leaveRoom() {
    socket.socket?.disconnect();
    this.roomCode = null;
    this.roomState = null;
    this.isHost = false;
    this._showPreRoom();
    socket.connect();
  }

  async _startGame() {
    const res = await socket.startGame(this.roomCode);
    if (res && !res.ok) {
      this._setStatusRoom(res.error || '시작 실패');
    }
  }

  // --- Room update ---

  _onRoomUpdate(state) {
    this.roomState = state;
    const isHost = socket.id && state.players[0]?.id === socket.id;
    this.isHost = isHost;

    this._roomBadge.textContent = `🔑 ${state.code}  (${state.players.length}/8)`;

    const listHtml = state.players.map((p, i) => {
      const crown = i === 0 ? '👑 ' : '';
      const charEmoji = CHARACTERS[p.characterId]?.emoji || '🐾';
      return `${crown}${charEmoji} ${p.name}`;
    }).join('<br>');
    this._playerList.innerHTML = listHtml;

    if (isHost && state.players.length >= 2) {
      this._startBtn.style.display = 'block';
      this._waitText.style.display = 'none';
    } else {
      this._startBtn.style.display = 'none';
      this._waitText.style.display = 'block';
    }
  }

  // --- Status ---

  _setStatus(msg) {
    if (this._statusText) this._statusText.textContent = msg;
  }

  _setStatusRoom(msg) {
    if (this._statusTextRoom) this._statusTextRoom.textContent = msg;
  }

  // --- Cleanup ---

  shutdown() {
    // Remove button handlers
    if (this._btnHandlers) {
      for (const { el, handler } of this._btnHandlers) {
        el.removeEventListener('click', handler);
      }
      this._btnHandlers = [];
    }
    // Remove socket handlers
    if (this._roomUpdateHandler) socket.off('room:update', this._roomUpdateHandler);
    if (this._gameStartHandler) socket.off('game:start', this._gameStartHandler);
  }
}
