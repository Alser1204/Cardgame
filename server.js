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
//     hands: { socket.id: [cardObj, ...] },
//     hp: { socket.id: 10 },
//     names: { socket.id: "名前" },
//     shield: { socket.id: 0 } // 被ダメ軽減
//   }
// }

// カード定義
const cardList = [
  { name: "ファイア", damage: 2 },
  { name: "ヒール", heal: 3 },
  { name: "スラッシュ", damage: 1 },
  { name: "ガード", shield: 2 }
];

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
      rooms[roomId] = { players: [], turnIndex: 0, hands: {}, hp: {}, names: {}, shield: {} };
    }
    const room = rooms[roomId];
    if (room.players.length >= 2) {
      socket.emit("roomFull");
      return;
    }

    room.players.push(socket.id);
    room.hands[socket.id] = [cardList[0], cardList[1], cardList[2]]; // 初期手札
    room.hp[socket.id] = 10;
    room.shield[socket.id] = 0;

    socket.join(roomId);

    if (!room.names[socket.id]) room.names[socket.id] = `プレイヤー${room.players.length}`;
    const playerName = room.names[socket.id];

    io.to(roomId).emit("message", `${playerName} が参加しました (${room.players.length}/2)`);

    if (room.players.length === 2) {
      io.to(roomId).emit("message", "ゲーム開始！");
      const firstPlayer = room.players[room.turnIndex];
      io.to(firstPlayer).emit("yourTurn", room.hands[firstPlayer], room.hp, room.names);
      const nextPlayer = room.players[(room.turnIndex + 1) % 2];
      io.to(nextPlayer).emit("updateHP", room.hp, room.names);
    }
  });

  // カードプレイ
  socket.on("playCard", ({ roomId, cardName }) => {
    const room = rooms[roomId];
    if (!room) return;

    if (room.players[room.turnIndex] !== socket.id) {
      socket.emit("notYourTurn");
      return;
    }

    const hand = room.hands[socket.id];
    const card = hand.find(c => c.name === cardName);
    if (!card) {
      socket.emit("invalidCard");
      return;
    }

    // 手札削除
    room.hands[socket.id] = hand.filter(c => c.name !== cardName);

    const opponentId = room.players.find(id => id !== socket.id);
    const myName = room.names[socket.id];
    const opponentName = room.names[opponentId];

    // 効果判定
    if (card.damage) {
      const dmg = Math.max(0, card.damage - (room.shield[opponentId] || 0));
      room.hp[opponentId] -= dmg;
      room.shield[opponentId] = 0;
      io.to(roomId).emit("message", `${myName} が ${card.name} をプレイ！ ${opponentName} に ${dmg} ダメージ`);
    }
    if (card.heal) {
      room.hp[socket.id] += card.heal;
      if (room.hp[socket.id] > 10) room.hp[socket.id] = 10;
      io.to(roomId).emit("message", `${myName} が ${card.name} をプレイ！ 自分のHPを ${card.heal} 回復`);
    }
    if (card.shield) {
      room.shield[socket.id] = card.shield;
      io.to(roomId).emit("message", `${myName} が ${card.name} をプレイ！ 次のターンの被ダメを ${card.shield} 軽減`);
    }

    io.to(roomId).emit("updateHP", room.hp, room.names);

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
        delete room.shield[socket.id];
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
