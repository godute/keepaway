const GameRoom = require('./GameRoom');

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map(); // code -> GameRoom
  }

  createRoom() {
    let code;
    do {
      code = generateCode();
    } while (this.rooms.has(code));

    const room = new GameRoom(code, this.io);
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code) {
    return this.rooms.get(code) || null;
  }

  removePlayerFromAllRooms(socketId) {
    for (const [code, room] of this.rooms.entries()) {
      if (room.players.has(socketId)) {
        room.removePlayer(socketId);
        if (room.isEmpty()) {
          // Grace period: keep empty room alive for 30s so reconnecting players can rejoin
          if (room._destroyTimeout) clearTimeout(room._destroyTimeout);
          room._destroyTimeout = setTimeout(() => {
            if (room.isEmpty()) {
              room.destroy();
              this.rooms.delete(code);
              console.log(`[Room] ${code} destroyed after grace period`);
            }
          }, 30000);
        }
        break;
      }
    }
  }
}

module.exports = RoomManager;
