import { io } from 'socket.io-client';

// In production, client is served from the same server — connect to current origin
// In dev, fall back to localhost:3001
const SERVER_URL = import.meta.env.VITE_SERVER_URL
  || (import.meta.env.PROD ? window.location.origin : 'http://localhost:3001');

class SocketClient {
  constructor() {
    this.socket = null;
    this.listeners = new Map();
  }

  connect() {
    if (this.socket?.connected) return;
    this.socket = io(SERVER_URL, { transports: ['websocket'] });

    this.socket.on('connect', () => {
      console.log('[Socket] connected:', this.socket.id);
      this._emit('connect');
    });
    this.socket.on('disconnect', () => {
      console.log('[Socket] disconnected');
      this._emit('disconnect');
    });

    // Forward all game events
    const events = [
      'room:update', 'game:start', 'game:state', 'game:event', 'game:end', 'chat:message',
    ];
    events.forEach(ev => {
      this.socket.on(ev, (data) => this._emit(ev, data));
    });
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(fn);
  }

  off(event, fn) {
    if (!this.listeners.has(event)) return;
    this.listeners.set(event, this.listeners.get(event).filter(f => f !== fn));
  }

  _emit(event, data) {
    (this.listeners.get(event) || []).forEach(fn => fn(data));
  }

  createRoom(name, characterId) {
    return new Promise(resolve => this.socket.emit('room:create', { name, characterId }, resolve));
  }

  joinRoom(code, name, characterId) {
    return new Promise(resolve => this.socket.emit('room:join', { code, name, characterId }, resolve));
  }

  selectCharacter(characterId) {
    this.socket?.emit('player:character', { characterId });
  }

  selectGame(code, gameType) {
    return new Promise(resolve => this.socket.emit('room:selectGame', { code, gameType }, resolve));
  }

  toggleReady() {
    this.socket?.emit('player:ready');
  }

  rejoinRoom(code) {
    return new Promise(resolve => this.socket.emit('room:rejoin', { code }, resolve));
  }

  startGame(code) {
    return new Promise(resolve => this.socket.emit('room:start', { code }, resolve));
  }

  sendEmoji(emoji) {
    this.socket?.emit('player:emoji', { emoji });
  }

  sendChat(text) {
    this.socket?.emit('chat:message', { text });
  }

  sendInput(dx, dy, dash) {
    this.socket?.volatile.emit('player:input', { dx, dy, dash });
  }

  get id() { return this.socket?.id; }
}

// Singleton
export default new SocketClient();
