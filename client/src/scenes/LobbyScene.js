import Phaser from 'phaser';
import socket from '../network/SocketClient.js';
import { CHARACTERS, CHARACTER_IDS, DEFAULT_CHARACTER } from '../characters.js';
import { GAME_MODES, GAME_MODE_IDS, DEFAULT_GAME_MODE } from '../gamemodes/GameModeConfig.js';

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
    this.selectedGame = DEFAULT_GAME_MODE;
  }

  init(data) {
    this._returnData = data || {};
  }

  create() {
    // Clean up previous event listeners from prior lobby session
    if (this._btnHandlers) {
      for (const { el, handler } of this._btnHandlers) {
        el.removeEventListener('click', handler);
      }
      this._btnHandlers = [];
    }
    if (this._roomUpdateHandler) socket.off('room:update', this._roomUpdateHandler);
    if (this._gameStartHandler) socket.off('game:start', this._gameStartHandler);

    socket.connect();
    this.selectedCharacter = DEFAULT_CHARACTER;
    this.selectedGame = DEFAULT_GAME_MODE;

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
    this._gameGrid = document.getElementById('game-grid');

    // Show lobby overlay, hide Phaser canvas
    this._overlay.classList.remove('hidden');
    const canvas = this.game.canvas;
    if (canvas) canvas.style.display = 'none';

    // Build grids
    this._buildCharGrid();
    this._buildGameGrid();

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

    // Bind shutdown for cleanup
    this.events.once('shutdown', this.shutdown, this);

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

  // --- Game selection grid ---

  _buildGameGrid() {
    this._gameGrid.innerHTML = '';
    GAME_MODE_IDS.forEach(gameId => {
      const mode = GAME_MODES[gameId];
      const card = document.createElement('div');
      card.className = 'game-card' + (gameId === this.selectedGame ? ' selected' : '');
      card.dataset.gameId = gameId;
      card.innerHTML = `
        <div class="game-emoji">${mode.emoji}</div>
        <div class="game-name">${mode.nameKo}</div>
      `;
      card.addEventListener('click', () => {
        if (!this.isHost) return; // Only host can change
        this.selectedGame = gameId;
        socket.selectGame(this.roomCode, gameId);
        this._refreshGameGrid();
      });
      this._gameGrid.appendChild(card);
    });
  }

  _refreshGameGrid() {
    const cards = this._gameGrid.querySelectorAll('.game-card');
    cards.forEach(card => {
      const isSelected = card.dataset.gameId === this.selectedGame;
      card.classList.toggle('selected', isSelected);
      // Non-host can't click
      if (!this.isHost) {
        card.style.cursor = 'default';
      } else {
        card.style.cursor = 'pointer';
      }
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

    // Update selected game from server state
    if (state.selectedGameType) {
      this.selectedGame = state.selectedGameType;
      this._refreshGameGrid();
    }

    this._roomBadge.textContent = `🔑 ${state.code}  (${state.players.length}/8)`;

    // Show selected game name
    const gameMode = GAME_MODES[this.selectedGame];
    const gameName = gameMode ? `${gameMode.emoji} ${gameMode.nameKo}` : '';

    const listHtml = state.players.map((p, i) => {
      const crown = i === 0 ? '👑 ' : '';
      const charEmoji = CHARACTERS[p.characterId]?.emoji || '🐾';
      return `${crown}${charEmoji} ${p.name}`;
    }).join('<br>');
    this._playerList.innerHTML = listHtml;

    // Update start button text with game name
    if (gameMode) {
      this._startBtn.textContent = `▶  ${gameMode.nameKo} 시작`;
    }

    if (isHost && state.players.length >= 2) {
      this._startBtn.style.display = 'block';
      this._waitText.style.display = 'none';
    } else {
      this._startBtn.style.display = 'none';
      this._waitText.style.display = 'block';
      if (!isHost) {
        this._waitText.textContent = gameName
          ? `${gameName} — 호스트가 시작할 때까지 기다려주세요...`
          : '호스트가 게임을 시작할 때까지 기다려주세요...';
      }
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
    if (this._btnHandlers) {
      for (const { el, handler } of this._btnHandlers) {
        el.removeEventListener('click', handler);
      }
      this._btnHandlers = [];
    }
    if (this._roomUpdateHandler) socket.off('room:update', this._roomUpdateHandler);
    if (this._gameStartHandler) socket.off('game:start', this._gameStartHandler);
  }
}
