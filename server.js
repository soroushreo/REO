const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/', (req, res) => {
  res.send('سرور بازی REO فعال است!');
});

const server = http.createServer(app);

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

function generateDeck() {
  const SUITS = [{id:'H',n:'دل',sym:'♥'},{id:'D',n:'خشت',sym:'♦'},{id:'S',n:'پیک',sym:'♠'},{id:'C',n:'گشنیز',sym:'♣'}];
  const RANKS = [['A','آس',13],['K','شاه',12],['Q','بی‌بی',11],['J','سرباز',10],['10','۱۰',9],['9','۹',8],['8','۸',7],['7','۷',6],['6','۶',5],['5','۵',4],['4','۴',3],['3','۳',2],['2','۲',1]];
  let a = [];
  for (const s of SUITS) {
    for (const r of RANKS) {
      a.push({ suit: s.id, suitName: s.n, sym: s.sym, rank: r[0], rankName: r[1], v: r[2] });
    }
  }
  return shuffleArray(a);
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

function startGameSession(roomId) {
  const room = rooms[roomId];
  if (!room || room.isStarted) return;

  // پر کردن جاهای خالی با ربات در صورت نیاز
  let botCounter = 1;
  while (room.players.length < 4) {
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
  const initialDeck = generateDeck();

  io.to(roomId).emit('gameStarted', {
    room,
    playersOrder,
    initialDealer,
    initialDeck
  });

  io.emit('updateRoomList', getPublicRooms());
}

io.on('connection', (socket) => {
  console.log('بازیکن متصل شد:', socket.id);

  socket.emit('updateRoomList', getPublicRooms());

  socket.on('getRooms', () => {
    socket.emit('updateRoomList', getPublicRooms());
  });

  socket.on('createRoom', ({ roomName, password, playerName }) => {
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

    // شروع بلافاصله بازی با تکمیل ۴ نفر
    if (room.players.length === 4) {
      startGameSession(roomId);
    } else {
      io.emit('updateRoomList', getPublicRooms());
    }
  });

  socket.on('startGame', ({ roomId, fillBots }) => {
    const room = rooms[roomId];
    if (!room || room.hostId !== socket.id) return;
    startGameSession(roomId);
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
        if (room.isStarted) {
          // اگر بازی در جریان بود، بازیکن خروجی به ربات تبدیل می‌شود تا سایرین کرش نکنند
          room.players[playerIndex].isBot = true;
          room.players[playerIndex].name += ' (ربات)';
          io.to(roomId).emit('playerLeft', { room, playerIndex });
        } else {
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
        }
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
