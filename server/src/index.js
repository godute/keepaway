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
  socket.on('room:create', ({ name }, cb) => {
    const room = roomManager.createRoom();
    const ok = room.addPlayer(socket, name);
    if (ok) {
      cb({ ok: true, code: room.code, roomState: room._roomState() });
    } else {
      cb({ ok: false, error: 'Could not create room' });
    }
  });

  // Join an existing room
  socket.on('room:join', ({ code, name }, cb) => {
    const room = roomManager.getRoom(code.toUpperCase());
    if (!room) return cb({ ok: false, error: 'Room not found' });
    if (room.players.size >= 8) return cb({ ok: false, error: 'Room is full' });
    if (room.phase !== 'lobby') return cb({ ok: false, error: 'Game already started' });

    const ok = room.addPlayer(socket, name);
    cb({ ok, code: room.code, roomState: room._roomState() });
  });

  // Host starts the game
  socket.on('room:start', ({ code }, cb) => {
    const room = roomManager.getRoom(code);
    if (!room) return cb && cb({ ok: false, error: 'Room not found' });

    // First player is host
    if (room.playerOrder[0] !== socket.id) {
      return cb && cb({ ok: false, error: 'Only the host can start' });
    }

    room.startGame();
    cb && cb({ ok: true });
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
