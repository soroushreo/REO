const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // اجازه اتصال از تمام دامنه‌ها (از جمله تلگرام)
    methods: ["GET", "POST"]
  }
});

// حافظه موقت اتاق‌های بازی
const rooms = {};

io.on('connection', (socket) => {
  console.log('بازیکن متصل شد:', socket.id);

  // ارسال لیست اتاق‌ها به محض اتصال
  socket.emit('updateRoomList', getPublicRooms());

  // ۱. ساخت اتاق جدید
  socket.on('createRoom', ({ roomName, password, playerName }) => {
    const roomId = 'room_' + Math.random().toString(36).substring(2, 9);
    
    rooms[roomId] = {
      id: roomId,
      name: roomName,
      password: password || null,
      hostId: socket.id,
      players: [{ id: socket.id, name: playerName, isHost: true }],
      gameState: null,
      isStarted: false
    };

    socket.join(roomId);
    socket.emit('roomCreated', { roomId, room: rooms[roomId] });
    io.emit('updateRoomList', getPublicRooms());
    console.log(`اتاق ${roomName} ساخته شد.`);
  });

  // ۲. ورود به اتاق
  socket.on('joinRoom', ({ roomId, password, playerName }) => {
    const room = rooms[roomId];
    if (!room) {
      return socket.emit('errorMsg', 'اتاق یافت نشد.');
    }
    if (room.password && room.password !== password) {
      return socket.emit('errorMsg', 'رمز عبور اشتباه است.');
    }
    if (room.players.length >= 4) {
      return socket.emit('errorMsg', 'ظرفیت اتاق تکمیل است.');
    }

    room.players.push({ id: socket.id, name: playerName, isHost: false });
    socket.join(roomId);

    io.to(roomId).emit('playerJoined', { room });
    io.emit('updateRoomList', getPublicRooms());
  });

  // ۳. شروع بازی توسط میزبان
  socket.on('startGame', ({ roomId, addBots }) => {
    const room = rooms[roomId];
    if (!room || room.hostId !== socket.id) return;

    // اگر بازیکنان کمتر از ۴ نفر باشند و تایید داده شده باشد، ربات پر می‌کنیم
    while (addBots && room.players.length < 4) {
      room.players.push({
        id: 'bot_' + Math.random().toString(36).substring(2, 5),
        name: `ربات ${room.players.length + 1}`,
        isBot: true
      });
    }

    room.isStarted = true;
    io.to(roomId).emit('gameStarted', { room });
    io.emit('updateRoomList', getPublicRooms());
  });

  // ۴. ارسال پیام چت
  socket.on('sendChatMessage', ({ roomId, message, senderName }) => {
    io.to(roomId).emit('newChatMessage', { senderName, message });
  });

  // ۵. اکشن‌های بازی (بازی کردن کارت، انتخاب حکم)
  socket.on('gameAction', ({ roomId, actionData }) => {
    // این بخش حالت‌های بازی را به همه بازیکنان اتاق همگام‌سازی می‌کند
    socket.to(roomId).emit('syncGameAction', actionData);
  });

  // قطع اتصال بازیکن
  socket.on('disconnect', () => {
    console.log('بازیکن قطع شد:', socket.id);
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      
      if (playerIndex !== -1) {
        room.players.splice(playerIndex, 1);
        if (room.players.length === 0) {
          delete rooms[roomId];
        } else if (room.hostId === socket.id) {
          // انتقال میزبانی به نفر بعدی
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

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`سرور بازی فعال شد روی پورت: ${PORT}`);
});
