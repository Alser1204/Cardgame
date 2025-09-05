const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

let cardList = [];
try {
  const data = fs.readFileSync(path.join(__dirname, "cards.json"), "utf8");
  cardList = JSON.parse(data);
  console.log("カードデータ読み込み成功:", cardList);
} catch (err) {
  console.error("カードデータ読み込みエラー:", err);
}

const rooms = {};
const handSize = 3;

io.on("connection", (socket) => {
  console.log("a user connected:", socket.id);

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

  socket.on("joinRoom", (roomId) => {
    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: [],
        turnIndex: 0,
        hands: {},
        hp: {},
        names: {},
        shield: {},
        deck: [...cardList].sort(() => Math.random() - 0.5),
        effects: {} // 持続効果
      };
    }

    const room = rooms[roomId];
    if (room.players.length >= 2) { socket.emit("roomFull"); return; }

    room.players.push(socket.id);
    room.hands[socket.id] = room.deck.splice(0, handSize);
    room.hp[socket.id] = 10;
    room.shield[socket.id] = 0;

    socket.join(roomId);
    if (!room.names[socket.id]) room.names[socket.id] = `プレイヤー${room.players.length}`;

    io.to(roomId).emit("message", `${room.names[socket.id]} が参加しました (${room.players.length}/2)`);

    if (room.players.length === 2) {
      io.to(roomId).emit("message", "ゲーム開始！");
      const firstPlayer = room.players[room.turnIndex];
      io.to(firstPlayer).emit("yourTurn", room.hands[firstPlayer], room.hp, room.names);
      const nextPlayer = room.players[(room.turnIndex + 1) % 2];
      io.to(nextPlayer).emit("updateHP", room.hp, room.names);
    }
  });

  socket.on("playCard", ({ roomId, cardName }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (room.players[room.turnIndex] !== socket.id) { socket.emit("notYourTurn"); return; }

    const hand = room.hands[socket.id];
    const card = hand.find(c => c.name === cardName);
    if (!card) { socket.emit("invalidCard"); return; }

    room.hands[socket.id] = hand.filter(c => c.name !== cardName);
    const opponentId = room.players.find(id => id !== socket.id);
    const myName = room.names[socket.id];
    const opponentName = room.names[opponentId];

    // --- 特殊効果処理 ---
    if (card.damage) {
      let dmg = card.damage;
      if (!card.ignoreShield) dmg = Math.max(0, dmg - (room.shield[opponentId] || 0));
      room.hp[opponentId] -= dmg;
      if (!card.ignoreShield) room.shield[opponentId] = 0;
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

    // multiTurn 効果登録
    if (card.effect === "multiTurn") {
      room.effects[opponentId] = room.effects[opponentId] || [];
      room.effects[opponentId].push({ card, remaining: card.turns });
    }

    // skipNextTurn
    if (card.effect === "skipNextTurn") {
      room.effects[opponentId] = room.effects[opponentId] || [];
      room.effects[opponentId].push({ card, skip: true });
      io.to(roomId).emit("message", `${opponentName} の次のターンがスキップされます！`);
    }

    // drawCard
    if (card.effect === "drawCard") {
      if (room.deck.length > 0) {
        const drawn = room.deck.splice(0,1)[0];
        room.hands[socket.id].push(drawn);
        io.to(socket.id).emit("message", `山札からカードを1枚引きました: ${drawn.name}`);
      }
    }

    // swapHand
    if (card.effect === "swapHand") {
      if (room.hands[opponentId].length > 0 && room.hands[socket.id].length > 0) {
        const myCardIndex = Math.floor(Math.random()*room.hands[socket.id].length);
        const oppCardIndex = Math.floor(Math.random()*room.hands[opponentId].length);
        const temp = room.hands[socket.id][myCardIndex];
        room.hands[socket.id][myCardIndex] = room.hands[opponentId][oppCardIndex];
        room.hands[opponentId][oppCardIndex] = temp;
        io.to(roomId).emit("message", `${myName} と ${opponentName} の手札が1枚入れ替わった！`);
      }
    }

    // 山札から手札補充
    if (room.deck.length > 0 && room.hands[socket.id].length < handSize) {
      const drawn = room.deck.splice(0, 1)[0];
      room.hands[socket.id].push(drawn);
      io.to(socket.id).emit("message", `山札からカードを1枚引きました: ${drawn.name}`);
    }

    io.to(roomId).emit("updateHP", room.hp, room.names);

    // 勝利判定
    if (room.hp[opponentId] <= 0) {
      io.to(roomId).emit("message", `${myName} の勝利！`);
      io.to(roomId).emit("gameOver", myName);
      delete rooms[roomId];
      return;
    }

    // --- ターン交代 ---
    let nextIndex = (room.turnIndex + 1) % room.players.length;
    let nextPlayer = room.players[nextIndex];

    // スキップ効果がある場合
    if (room.effects[nextPlayer]) {
      const skipEffect = room.effects[nextPlayer].find(e => e.skip);
      if (skipEffect) {
        io.to(roomId).emit("message", `${room.names[nextPlayer]} のターンはスキップされました！`);
        room.effects[nextPlayer] = room.effects[nextPlayer].filter(e => !e.skip);
        nextIndex = (nextIndex + 1) % room.players.length;
        nextPlayer = room.players[nextIndex];
      }
    }

    room.turnIndex = nextIndex;
    io.to(nextPlayer).emit("yourTurn", room.hands[nextPlayer], room.hp, room.names);
  });

  socket.on("disconnect", () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const index = room.players.indexOf(socket.id);
      if (index !== -1) {
        room.players.splice(index, 1);
        delete room.hands[socket.id];
        delete room.hp[socket.id];
        delete room.names[socket.id];
        delete room.shield[socket.id];
        delete room.effects[socket.id];
        io.to(roomId).emit("message", "プレイヤーが退出しました");
        if (room.players.length === 0) delete rooms[roomId];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`listening on *:${PORT}`));
