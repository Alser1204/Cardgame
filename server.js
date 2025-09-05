const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = {}; 
// rooms = {
//   roomId: {
//     players: [socket.id, ...],
//     turnIndex: 0,
//     hands: { socket.id: ["カードA", ...] },
//     hp: { socket.id: 10 },
//     names: { socket.id: "名前" }
//   }
// }

io.on("connection", (socket) => {
  console.log("a user connected:", socket.id);

  // 名前設定
  socket.on("setName", (name) => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      if (room.players.includes(socket.id)) {
        room.names[socket.id] = name;
        io.to(roomId).emit("message", `${name} が名前を設定しました`);
        io.to(roomId).emit("updateHP", room.hp, room.names);
      }
    }
  });

  // ルーム参加
  socket.on("joinRoom", (roomId) => {
    if (!rooms[roomId]) {
      rooms[roomId] = { players: [], turnIndex: 0, hands: {}, hp: {}, names: {} };
    }
    const room = rooms[roomId];
    if (room.players.length >= 2) {
      socket.emit("roomFull");
      return;
    }

    room.players.push(socket.id);
    room.hands[socket.id] = ["カード1", "カード2"];
    room.hp[socket.id] = 10;

    socket.join(roomId);

    // 名前が未設定なら仮名を割り当て
    if (!room.names[socket.id]) room.names[socket.id] = `プレイヤー${room.players.length}`;

    const playerName = room.names[socket.id];
    io.to(roomId).emit("message", `${playerName} が参加しました (${room.players.length}/2)`);

    // 2人揃ったらゲーム開始
    if (room.players.length === 2) {
      io.to(roomId).emit("message", "ゲーム開始！");
      const firstPlayer = room.players[room.turnIndex];
      io.to(firstPlayer).emit("yourTurn", room.hands[firstPlayer], room.hp, room.names);
      const nextPlayer = room.players[(room.turnIndex + 1) % 2];
      io.to(nextPlayer).emit("updateHP", room.hp, room.names);
    }
  });

  // カードプレイ
  socket.on("playCard", ({ roomId, card }) => {
    const room = rooms[roomId];
    if (!room) return;

    if (room.players[room.turnIndex] !== socket.id) {
      socket.emit("notYourTurn");
      return;
    }

    const hand = room.hands[socket.id];
    if (!hand.includes(card)) {
      socket.emit("invalidCard");
      return;
    }

    room.hands[socket.id] = hand.filter(c => c !== card);

    const opponentId = room.players.find(id => id !== socket.id);

    // カード効果: 1ダメージ
    room.hp[opponentId] -= 1;

    const myName = room.names[socket.id];
    const opponentName = room.names[opponentId];

    io.to(roomId).emit("updateHP", room.hp, room.names);
    io.to(roomId).emit("message", `${myName} が ${card} をプレイ！`);

    // 勝利判定
    if (room.hp[opponentId] <= 0) {
      io.to(roomId).emit("message", `${myName} の勝利！`);
      io.to(roomId).emit("gameOver", myName);
      delete rooms[roomId];
      return;
    }

    // ターン交代
    room.turnIndex = (room.turnIndex + 1) % room.players.length;
    const nextPlayer = room.players[room.turnIndex];
    io.to(nextPlayer).emit("yourTurn", room.hands[nextPlayer], room.hp, room.names);
  });

  socket.on("disconnect", () => {
    console.log("user disconnected:", socket.id);
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const index = room.players.indexOf(socket.id);
      if (index !== -1) {
        room.players.splice(index, 1);
        delete room.hands[socket.id];
        delete room.hp[socket.id];
        delete room.names[socket.id];
        io.to(roomId).emit("message", "プレイヤーが退出しました");
        if (room.players.length === 0) delete rooms[roomId];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`listening on *:${PORT}`);
});
