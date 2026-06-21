const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Указываем папку public для статических файлов (HTML, CSS, JS)
app.use(express.static('public'));

const rooms = {}; // Тут будут храниться активные комнаты

// Генерация случайного кода комнаты (4 буквы)
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

io.on('connection', (socket) => {
    console.log(`Пользователь подключился: ${socket.id}`);

    // Обработка создания комнаты
    socket.on('createRoom', ({ name }) => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = [name];
        
        socket.join(roomCode);
        socket.username = name;
        socket.roomCode = roomCode;

        socket.emit('roomData', { room: roomCode, players: rooms[roomCode] });
        console.log(`Комната ${roomCode} создана игроком ${name}`);
    });

    // Обработка входа в комнату
    socket.on('joinRoom', ({ name, room }) => {
        if (!rooms[room]) {
            return socket.emit('error', 'Комната не найдена!');
        }
        
        rooms[room].push(name);
        socket.join(room);
        socket.username = name;
        socket.roomCode = room;

        io.to(room).emit('roomData', { room: room, players: rooms[room] });
        console.log(`${name} зашел в комнату ${room}`);
    });

    // Отключение пользователя
    socket.on('disconnect', () => {
        const { roomCode, username } = socket;
        if (roomCode && rooms[roomCode]) {
            rooms[roomCode] = rooms[roomCode].filter(user => user !== username);
            if (rooms[roomCode].length === 0) {
                delete rooms[roomCode];
            } else {
                io.to(roomCode).emit('roomData', { room: roomCode, players: rooms[roomCode] });
            }
        }
        console.log(`Пользователь отключился: ${socket.id}`);
    });
});

// Render сам подставит нужный порт в process.env.PORT, либо локально включится 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
