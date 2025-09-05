const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// public フォルダを公開 (index.html がここに入る)
app.use(express.static("public"));

io.on("connection", (socket) => {
  console.log("a user connected");

  socket.on("joinRoom", (roomId) => {
    socket.join(roomId);
    io.to(roomId).emit("message", "プレイヤーが参加しました");
  });

  socket.on("playCard", ({ roomId, card }) => {
    socket.to(roomId).emit("opponentPlayed", card);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`listening on *:${PORT}`);
});
