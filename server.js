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
//     hands: { socketId: ["カードA", "カードB", ...] }
//   }
// }

io.on("connection", (socket) => {
  console.log("a user connected:", socket.id);

  // ルーム参加
  socket.on("joinRoom", (roomId) => {
    if (!rooms[roomId]) {
      rooms[roomId] = { players: [], turnIndex: 0, hands: {} };
    }

    const room = rooms[roomId];
    if (room.players.length >= 2) {
      socket.emit("roomFull");
      return;
    }

    room.players.push(socket.id);

    // 簡単にカードを2枚ずつ配る
    room.hands[socket.id] = ["カード1", "カード2"];

    socket.join(roomId);
    io.to(roomId).emit("message", `プレイヤーが参加しました (${room.players.length}/2)`);

    // 2人揃ったらゲーム開始
    if (room.players.length === 2) {
      io.to(roomId).emit("message", "ゲーム開始！");
      const firstPlayer = room.players[room.turnIndex];
      io.to(firstPlayer).emit("yourTurn", room.hands[firstPlayer]);
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

    // カードを手札から除外
    room.hands[socket.id] = hand.filter(c => c !== card);

    // 相手に通知
    socket.to(roomId).emit("opponentPlayed", card);

    // ターン交代
    room.turnIndex = (room.turnIndex + 1) % room.players.length;
    const nextPlayer = room.players[room.turnIndex];
    io.to(nextPlayer).emit("yourTurn", room.hands[nextPlayer]);
  });

  socket.on("disconnect", () => {
    console.log("user disconnected:", socket.id);
    // 参加していたルームから削除
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const index = room.players.indexOf(socket.id);
      if (index !== -1) {
        room.players.splice(index, 1);
        delete room.hands[socket.id];
        io.to(roomId).emit("message", "プレイヤーが退出しました");
        // ルームに誰もいなければ削除
        if (room.players.length === 0) delete rooms[roomId];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`listening on *:${PORT}`);
});
