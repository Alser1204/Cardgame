const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// 部屋ごとのデータ管理
const rooms = {}; 
// rooms = {
//   roomId: {
//     players: [socket.id, ...],
//     turnIndex: 0,
//     hands: { socketId: ["カードA", ...] },
//     hp: { socketId: 10 }
//   }
// }

io.on("connection", (socket) => {
  console.log("a user connected:", socket.id);

  socket.on("joinRoom", (roomId) => {
    if (!rooms[roomId]) {
      rooms[roomId] = { players: [], turnIndex: 0, hands: {}, hp: {} };
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
    io.to(roomId).emit("message", `プレイヤーが参加しました (${room.players.length}/2)`);

    // 2人揃ったらゲーム開始
    if (room.players.length === 2) {
      io.to(roomId).emit("message", "ゲーム開始！");
      const firstPlayer = room.players[room.turnIndex];
      io.to(firstPlayer).emit("yourTurn", room.hands[firstPlayer], room.hp);
      io.to(room.players[(room.turnIndex + 1) % 2]).emit("updateHP", room.hp);
    }
  });

  // カードプレイ
  socket.on("playCard", ({ roomId, card }) => {
    const room = rooms[roomId];
    if (!room) return;

    // 自分のターンか確認
    if (room.players[room.turnIndex] !== socket.id) {
      socket.emit("notYourTurn");
      return;
    }

    // 手札にあるか確認
    const hand = room.hands[socket.id];
    if (!hand.includes(card)) {
      socket.emit("invalidCard");
      return;
    }

    // 手札からカード削除
    room.hands[socket.id] = hand.filter(c => c !== card);

    // 相手ID
    const opponentId = room.players.find(id => id !== socket.id);

    // カード効果: 1ダメージ
    room.hp[opponentId] -= 1;

    // HP更新通知
    io.to(roomId).emit("updateHP", room.hp);
    io.to(roomId).emit("message", `${socket.id} が ${card} をプレイ！`);

    // 勝利判定
    if (room.hp[opponentId] <= 0) {
      io.to(roomId).emit("message", `${socket.id} の勝利！`);
      io.to(roomId).emit("gameOver", socket.id);
      delete rooms[roomId];
      return;
    }

    // ターン交代
    room.turnIndex = (room.turnIndex + 1) % room.players.length;
    const nextPlayer = room.players[room.turnIndex];
    io.to(nextPlayer).emit("yourTurn", room.hands[nextPlayer], room.hp);
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
