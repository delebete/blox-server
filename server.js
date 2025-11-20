const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");

// Allow CORS so your game client can connect from anywhere
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Game State
const rooms = {}; 

function generateCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // 1. Create Room
  socket.on('create_room', (data, callback) => {
      const code = generateCode();
      rooms[code] = {
          players: {},
          world: {},
          host: socket.id
      };
      
      socket.join(code);
      rooms[code].players[socket.id] = {
          id: socket.id,
          name: data.name,
          x: 0, y: 0, z: 0, rot: 0
      };
      
      console.log(`Room ${code} created by ${data.name}`);
      callback({ code: code });
  });

  // 2. Join Room
  socket.on('join_room', (data, callback) => {
      const code = data.code;
      const room = rooms[code];
      
      if (room) {
          socket.join(code);
          room.players[socket.id] = {
              id: socket.id,
              name: data.name,
              x: 0, y: 0, z: 0, rot: 0
          };
          
          // Send initial state to joiner
          socket.emit('welcome', {
              players: Object.values(room.players),
              world: Object.values(room.world)
          });
          
          console.log(`${data.name} joined room ${code}`);
          callback({ success: true });
      } else {
          callback({ success: false, message: "Room not found" });
      }
  });

  // 3. Player Movement
  socket.on('player_update', (data) => {
      const roomsArr = Array.from(socket.rooms);
      const code = roomsArr.find(r => r !== socket.id); 
      
      if (code && rooms[code]) {
          rooms[code].players[socket.id] = data;
          socket.to(code).emit('player_update', data);
      }
  });

  // 4. World Creation
  socket.on('world_create', (data) => {
      const roomsArr = Array.from(socket.rooms);
      const code = roomsArr.find(r => r !== socket.id);
      
      if (code && rooms[code]) {
          const id = Math.random().toString(36).substr(2, 9);
          const finalData = { ...data, id: id };
          rooms[code].world[id] = finalData;
          io.in(code).emit('world_create', finalData);
      }
  });

  // 5. World Update
  socket.on('world_update', (payload) => {
      const roomsArr = Array.from(socket.rooms);
      const code = roomsArr.find(r => r !== socket.id);
      
      if (code && rooms[code] && rooms[code].world[payload.id]) {
          rooms[code].world[payload.id] = { ...rooms[code].world[payload.id], ...payload.data };
          socket.to(code).emit('world_update', payload);
      }
  });

  // 6. World Delete
  socket.on('world_delete', (id) => {
      const roomsArr = Array.from(socket.rooms);
      const code = roomsArr.find(r => r !== socket.id);
      
      if (code && rooms[code]) {
          delete rooms[code].world[id];
          io.in(code).emit('world_delete', id);
      }
  });

  // 7. Disconnect
  socket.on('disconnect', () => {
      for (const code in rooms) {
          if (rooms[code].players[socket.id]) {
              delete rooms[code].players[socket.id];
              io.in(code).emit('player_leave', socket.id);
              if (Object.keys(rooms[code].players).length === 0) {
                  delete rooms[code];
              }
              break;
          }
      }
  });
});

// RENDER UPDATE: Use process.env.PORT
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`listening on *:${PORT}`);
});
