const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const RoomManager = require('./RoomManager');

const PORT = process.env.PORT || 3001;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Serve client build (production)
const clientDist = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDist));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// SPA fallback: serve index.html for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

const roomManager = new RoomManager(io);

io.on('connection', (socket) => {
  console.log(`[+] connected: ${socket.id}`);

  // Create a new room
  socket.on('room:create', ({ name, characterId }, cb) => {
    const room = roomManager.createRoom();
    const ok = room.addPlayer(socket, name, characterId);
    if (ok) {
      cb({ ok: true, code: room.code, roomState: room._roomState() });
    } else {
      cb({ ok: false, error: 'Could not create room' });
    }
  });

  // Join an existing room
  socket.on('room:join', ({ code, name, characterId }, cb) => {
    const room = roomManager.getRoom(code.toUpperCase());
    if (!room) return cb({ ok: false, error: 'Room not found' });
    if (room.players.size >= 8) return cb({ ok: false, error: 'Room is full' });
    if (room.phase !== 'lobby') return cb({ ok: false, error: 'Game already started' });

    const ok = room.addPlayer(socket, name, characterId);
    cb({ ok, code: room.code, roomState: room._roomState() });
  });

  // Change character in lobby
  socket.on('player:character', ({ characterId }) => {
    for (const room of roomManager.rooms.values()) {
      if (room.players.has(socket.id)) {
        room.setPlayerCharacter(socket.id, characterId);
        break;
      }
    }
  });

  // Select game mode (host only)
  socket.on('room:selectGame', ({ code, gameType }, cb) => {
    const room = roomManager.getRoom(code);
    if (!room) return cb && cb({ ok: false, error: 'Room not found' });
    if (room.playerOrder[0] !== socket.id) return cb && cb({ ok: false, error: 'Only host' });
    room.setGameType(gameType);
    cb && cb({ ok: true });
  });

  // Toggle ready state
  socket.on('player:ready', () => {
    for (const room of roomManager.rooms.values()) {
      if (room.players.has(socket.id)) {
        room.toggleReady(socket.id);
        break;
      }
    }
  });

  // Rejoin room (request current state after returning from game)
  socket.on('room:rejoin', ({ code }, cb) => {
    const room = roomManager.getRoom(code);
    if (!room || !room.players.has(socket.id)) {
      return cb && cb({ ok: false, error: 'Room not found' });
    }
    cb && cb({ ok: true, roomState: room._roomState() });
  });

  // Host starts the game
  socket.on('room:start', ({ code }, cb) => {
    const room = roomManager.getRoom(code);
    if (!room) return cb && cb({ ok: false, error: 'Room not found' });

    // First player is host
    if (room.playerOrder[0] !== socket.id) {
      return cb && cb({ ok: false, error: 'Only the host can start' });
    }

    const result = room.startGame();
    if (result === 'not_ready') {
      return cb && cb({ ok: false, error: '모든 플레이어가 준비되지 않았습니다' });
    }
    cb && cb({ ok: true });
  });

  // Emoji reaction
  const ALLOWED_EMOJIS = ['😂', '👍', '🔥', '💀', '😭', '🎉'];
  socket.on('player:emoji', ({ emoji }) => {
    if (!ALLOWED_EMOJIS.includes(emoji)) return;
    for (const room of roomManager.rooms.values()) {
      if (room.players.has(socket.id)) {
        const player = room.players.get(socket.id);
        const now = Date.now();
        if (now - player.lastEmojiTime < 1000) return; // rate limit
        player.lastEmojiTime = now;
        io.to(room.code).emit('game:event', { type: 'emoji', playerId: socket.id, emoji });
        break;
      }
    }
  });

  // Chat message
  socket.on('chat:message', ({ text }) => {
    if (!text || typeof text !== 'string') return;
    const cleaned = text.trim().replace(/<[^>]*>/g, '').slice(0, 50);
    if (!cleaned) return;
    for (const room of roomManager.rooms.values()) {
      if (room.players.has(socket.id)) {
        const player = room.players.get(socket.id);
        const now = Date.now();
        if (now - player.lastChatTime < 1000) return; // rate limit
        player.lastChatTime = now;
        io.to(room.code).emit('chat:message', { playerId: socket.id, playerName: player.name, text: cleaned });
        break;
      }
    }
  });

  // Player input during game
  socket.on('player:input', (input) => {
    roomManager.removePlayerFromAllRooms; // no-op reference (find room manually)
    for (const room of roomManager.rooms.values()) {
      if (room.players.has(socket.id)) {
        room.handleInput(socket.id, input);
        break;
      }
    }
  });

  socket.on('disconnect', () => {
    console.log(`[-] disconnected: ${socket.id}`);
    roomManager.removePlayerFromAllRooms(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Keepaway server running on port ${PORT}`);
});
