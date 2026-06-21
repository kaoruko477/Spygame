const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

// Расширенный список локаций (более 50 мест)
const DEFAULT_LOCATIONS = [
  'Аэропорт', 'Пляж', 'Подводная лодка', 'Банк', 'Казино',
  'Цирк', 'Посольство', 'Больница', 'Военная база', 'Музей',
  'Ночной клуб', 'Полицейский участок', 'Ресторан', 'Школа',
  'Космическая станция', 'Корабль', 'Поезд', 'Супермаркет',
  'Университет', 'Кинотеатр', 'Замок', 'Тюрьма', 'Яхта', 
  'Отель', 'Театр', 'Овощебаза', 'Офис Илона Маска', 'Остров Черепа',
  'Бункер', 'Деревня ниндзя', 'Заброшенная психбольница', 'Пиратский корабль',
  'Стриптиз-клуб', 'Очередь за айфоном', 'Психушка', 'Похоронное бюро',
  'Лаборатория', 'Метро', 'Канализация', 'Кошачий приют', 'Свадьба',
  'Похороны', 'Цыганский табор', 'Баня', 'Фабрика игрушек', 'Марс',
  'Торговый центр', 'Горнолыжный курорт', 'Парикмахерская', 'Автосервис',
  'Рынок', 'Стадион', 'Библиотека', 'Завод по производству мемов'
];

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  socket.on('createRoom', ({ playerName }) => {
    const code = generateRoomCode();
    rooms[code] = {
      code,
      host: socket.id,
      players: [{ id: socket.id, name: playerName, ready: false }],
      settings: { maxPlayers: 8, spyCount: 1, duration: 8 },
      locations: [...DEFAULT_LOCATIONS],
      state: 'lobby',
      timer: null,
      votes: {}
    };
    socket.join(code);
    socket.roomCode = code;
    socket.playerName = playerName;
    socket.emit('roomCreated', { code, room: sanitizeRoom(rooms[code]) });
    console.log(`Room ${code} created by ${playerName}`);
  });

  socket.on('joinRoom', ({ code, playerName }) => {
    const room = rooms[code];
    if (!room) return socket.emit('error', 'Комната не найдена');
    
    // ФИКС БАГА ПЕРЕЗАХОДА: Ищем, нет ли уже игрока с таким именем
    const existingPlayer = room.players.find(p => p.name === playerName);

    if (existingPlayer) {
      // Если игра в лобби, просто обновляем ID сокета для этого игрока
      if (room.state === 'lobby') {
        existingPlayer.id = socket.id;
        if (room.host === existingPlayer.id) {
          room.host = socket.id; // Если это был хост, обновляем хоста
        }
      } else {
        // Если игра уже идет, разрешаем вернуться на свое место!
        existingPlayer.id = socket.id;
      }
      
      socket.join(code);
      socket.roomCode = code;
      socket.playerName = playerName;
      
      socket.emit('roomJoined', { code, room: sanitizeRoom(room) });
      io.to(code).emit('playerJoined', { room: sanitizeRoom(room) });
      return;
    }

    if (room.state !== 'lobby') return socket.emit('error', 'Игра уже началась');
    if (room.players.length >= room.settings.maxPlayers)
      return socket.emit('error', 'Комната заполнена');

    room.players.push({ id: socket.id, name: playerName, ready: false });
    socket.join(code);
    socket.roomCode = code;
    socket.playerName = playerName;
    socket.emit('roomJoined', { code, room: sanitizeRoom(room) });
    socket.to(code).emit('playerJoined', { room: sanitizeRoom(room) });
  });

  socket.on('updateSettings', ({ settings }) => {
    const room = rooms[socket.roomCode];
    if (!room || room.host !== socket.id) return;
    room.settings = { ...room.settings, ...settings };
    io.to(socket.roomCode).emit('settingsUpdated', { settings: room.settings });
  });

  socket.on('updateLocations', ({ locations }) => {
    const room = rooms[socket.roomCode];
    if (!room || room.host !== socket.id) return;
    room.locations = locations;
    io.to(socket.roomCode).emit('locationsUpdated', { locations });
  });

  socket.on('startGame', () => {
    const room = rooms[socket.roomCode];
    if (!room || room.host !== socket.id) return;
    if (room.players.length < 3) return socket.emit('error', 'Нужно минимум 3 игрока');

    const location = room.locations[Math.floor(Math.random() * room.locations.length)];
    const shuffled = shuffle(room.players);
    const spyCount = Math.min(room.settings.spyCount, Math.floor(room.players.length / 2));
    const spyIds = shuffled.slice(0, spyCount).map(p => p.id);

    room.state = 'playing';
    room.location = location;
    room.spyIds = spyIds;
    room.startTime = Date.now();
    room.votes = {};

    // Рассылка ролей
    room.players.forEach(player => {
      const isSpy = spyIds.includes(player.id);
      io.to(player.id).emit('gameStarted', {
        role: isSpy ? 'spy' : 'civilian',
        location: isSpy ? null : location,
        spyCount,
        players: room.players.map(p => p.name),
        duration: room.settings.duration,
        locations: null // УБРАНО: Шпион больше не видит список локаций игры
      });
    });

    // Таймер
    let timeLeft = room.settings.duration * 60;
    clearInterval(room.timer);
    room.timer = setInterval(() => {
      timeLeft--;
      io.to(socket.roomCode).emit('timerTick', { timeLeft });
      if (timeLeft <= 0) {
        clearInterval(room.timer);
        room.state = 'ended';
        io.to(socket.roomCode).emit('timeUp', {
          location: room.location,
          spies: room.players.filter(p => room.spyIds.includes(p.id)).map(p => p.name)
        });
      }
    }, 1000);
  });

  socket.on('callVote', ({ targetName }) => {
    const room = rooms[socket.roomCode];
    if (!room || room.state !== 'playing') return;
    io.to(socket.roomCode).emit('voteStarted', {
      callerName: socket.playerName,
      targetName,
      players: room.players.map(p => p.name)
    });
    room.votes = {};
  });

  socket.on('castVote', ({ targetName, vote }) => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    room.votes[socket.id] = { targetName, vote };
    const totalVotes = Object.keys(room.votes).length;
    
    if (totalVotes >= room.players.length) {
      const guilty = Object.values(room.votes).filter(v => v.vote === 'guilty').length;
      const innocent = Object.values(room.votes).filter(v => v.vote === 'innocent').length;
      io.to(socket.roomCode).emit('voteResult', { targetName, guilty, innocent, total: totalVotes });
    } else {
      io.to(socket.roomCode).emit('voteProgress', { voted: totalVotes, total: room.players.length });
    }
  });

  socket.on('endGame', () => {
    const room = rooms[socket.roomCode];
    if (!room || room.host !== socket.id) return;
    endGame(room, socket.roomCode);
  });

  socket.on('restartGame', () => {
    const room = rooms[socket.roomCode];
    if (!room || room.host !== socket.id) return;
    clearInterval(room.timer);
    room.state = 'lobby';
    room.location = null;
    room.spyIds = [];
    room.votes = {};
    io.to(socket.roomCode).emit('gameRestarted', { room: sanitizeRoom(room) });
  });

  socket.on('disconnect', () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room) return;

    // Даем небольшую задержку перед полным удалением игрока на случай мгновенного реконнекта
    setTimeout(() => {
      const updatedRoom = rooms[code];
      if (!updatedRoom) return;

      // Проверяем, действительно ли сокет отвалился и не переподключился под новым id
      const pIndex = updatedRoom.players.findIndex(p => p.name === socket.playerName && p.id === socket.id);
      if (pIndex !== -1) {
        updatedRoom.players.splice(pIndex, 1);

        if (updatedRoom.players.length === 0) {
          clearInterval(updatedRoom.timer);
          delete rooms[code];
          return;
        }

        if (updatedRoom.host === socket.id) {
          updatedRoom.host = updatedRoom.players[0].id;
          io.to(updatedRoom.players[0].id).emit('youAreHost');
        }

        io.to(code).emit('playerLeft', { playerName: socket.playerName, room: sanitizeRoom(updatedRoom) });
      }
    }, 1500); // 1.5 секунды буфер на переподключение
  });
});

function endGame(room, code) {
  clearInterval(room.timer);
  room.state = 'ended';
  io.to(code).emit('timeUp', {
    location: room.location,
    spies: room.players.filter(p => room.spyIds.includes(p.id)).map(p => p.name)
  });
}

function sanitizeRoom(room) {
  return {
    code: room.code,
    players: room.players,
    settings: room.settings,
    locations: room.locations,
    state: room.state,
    host: room.host
  };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🕵️ Spy Game server running on http://localhost:${PORT}`));
