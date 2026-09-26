// Care: A Simulation — real-time relay server
// Pairs two devices into a named "room" (one room per minigame) and relays
// messages between them. Enforces at most one caretaker and one patient per room.

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
app.get("/", (_req, res) => res.send("Care relay server is running."));

const io = new Server(server, { cors: { origin: "*" } });

// { roomCode: { caretaker: socketId|null, patient: socketId|null } }
const rooms = {};

io.on("connection", (socket) => {
  console.log("connected:", socket.id);

  socket.on("join", ({ room, role }) => {
    if (!rooms[room]) rooms[room] = { caretaker: null, patient: null };

    // Is this role already held by a different, still-connected device?
    const existing = rooms[room][role];
    const stillHere = existing && io.sockets.sockets.has(existing);
    if (stillHere && existing !== socket.id) {
      socket.emit("roleTaken", { room, role });
      console.log(`${role} slot in ${room} is already taken`);
      return; // do not let a second person take the same role in the same room
    }

    socket.join(room);
    socket.data.room = room;
    socket.data.role = role;
    rooms[room][role] = socket.id;
    console.log(`${role} joined room ${room}`);

    const partnerRole = role === "caretaker" ? "patient" : "caretaker";
    socket.emit("joined", { room, role, partnerPresent: Boolean(rooms[room][partnerRole]) });

    if (rooms[room].caretaker && rooms[room].patient) {
      io.to(room).emit("ready", { room });
      console.log(`room ${room} is READY`);
    }
  });

  // relay an action only to the partner in the same room
  socket.on("action", (payload) => {
    const room = socket.data.room;
    if (!room) return;
    socket.to(room).emit("action", { from: socket.data.role, ...payload });
  });

  socket.on("disconnect", () => {
    const { room, role } = socket.data;
    if (room && rooms[room] && rooms[room][role] === socket.id) {
      rooms[room][role] = null;
      socket.to(room).emit("partnerLeft", { role });
      if (!rooms[room].caretaker && !rooms[room].patient) delete rooms[room];
    }
    console.log("disconnected:", socket.id);
  });
});

const PORT = 3001;
server.listen(PORT, "0.0.0.0", () =>
  console.log(`Care relay server listening on port ${PORT}`)
);