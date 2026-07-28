const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

// مسیر تست سلامت سرور
app.get('/', (req, res) => {
  res.send('سرور بازی REO فعال است!');
});

const server = http.createServer(app);

// تنظیمات کامل CORS برای Socket.io
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["*"],
    credentials: true
  }
});

const rooms = {};

function shuffleArray(array) {
  let arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getPublicRooms() {
  return Object.values(rooms)
    .filter(r => !r.isStarted && r.players.length < 4)
    .map(r => ({
      id: r.id,
      name: r.name,
      hasPassword: !!r.password,
      playerCount: r.players.length
    }));
}

io.on('connection', (socket) => {
  console.log('بازیکن متصل شد:', socket.id);

  socket.emit('updateRoomList', getPublicRooms());

  socket.on('getRooms', () => {
    socket.emit('updateRoomList', getPublicRooms());
  });

  socket.on('createRoom', ({ roomName, password, playerName }) => {
    console.log('درخواست ساخت روم دریافت شد:', roomName);
    const roomId = 'room_' + Math.random().toString(36).substring(2, 9);
    
    rooms[roomId] = {
      id: roomId,
      name: roomName || 'اتاق بازی',
      password: password || null,
      hostId: socket.id,
      players: [{ id: socket.id, name: playerName || 'میزبان', isHost: true, isBot: false }],
      isStarted: false
    };

    socket.join(roomId);
    socket.emit('roomCreated', { roomId, room: rooms[roomId] });
    io.emit('updateRoomList', getPublicRooms());
  });

  socket.on('joinRoom', ({ roomId, password, playerName }) => {
    const room = rooms[roomId];
    if (!room) return socket.emit('errorMsg', 'اتاق یافت نشد.');
    if (room.password && room.password !== password) return socket.emit('errorMsg', 'رمز عبور اشتباه است.');
    if (room.players.length >= 4) return socket.emit('errorMsg', 'ظرفیت اتاق تکمیل است.');

    room.players.push({ id: socket.id, name: playerName || 'بازیکن مهمان', isHost: false, isBot: false });
    socket.join(roomId);

    io.to(roomId).emit('playerJoined', { room });
    io.emit('updateRoomList', getPublicRooms());
  });

  socket.on('startGame', ({ roomId, fillBots }) => {
    const room = rooms[roomId];
    if (!room || room.hostId !== socket.id) return;

    let botCounter = 1;
    while (fillBots && room.players.length < 4) {
      room.players.push({
        id: 'bot_' + Math.random().toString(36).substring(2, 6),
        name: `ربات ${botCounter++}`,
        isHost: false,
        isBot: true
      });
    }

    room.isStarted = true;
    const playersOrder = shuffleArray(room.players);
    const initialDealer = Math.floor(Math.random() * 4);

    io.to(roomId).emit('gameStarted', {
      room,
      playersOrder,
      initialDealer
    });

    io.emit('updateRoomList', getPublicRooms());
  });

  socket.on('sendChatMessage', ({ roomId, message, senderName }) => {
    io.to(roomId).emit('newChatMessage', { senderName, message });
  });

  socket.on('gameAction', ({ roomId, actionData }) => {
    socket.to(roomId).emit('syncGameAction', actionData);
  });

  socket.on('disconnect', () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      
      if (playerIndex !== -1) {
        room.players.splice(playerIndex, 1);
        if (room.players.length === 0) {
          delete rooms[roomId];
        } else if (room.hostId === socket.id) {
          const newHost = room.players.find(p => !p.isBot);
          if (newHost) {
            room.hostId = newHost.id;
            newHost.isHost = true;
          }
        }
        io.to(roomId).emit('playerLeft', { room });
        io.emit('updateRoomList', getPublicRooms());
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`سرور فعال شد روی پورت: ${PORT}`);
});
