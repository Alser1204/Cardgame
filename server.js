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
const handSize = 5;

function applyStartOfTurnEffects(room, playerId) {
  if (!room.effects[playerId]) return;

  let skipTurn = false;
  let dmgThisTurn = 0;
  let healThisTurn = 0;

  // すべての効果を処理
  room.effects[playerId].forEach(e => {
    if (e.remaining > 0) {
      // スキップ効果
      if (e.card.effect === "skipNextTurn") {
        skipTurn = true;
      }
      // 継続ダメージ/回復
      if (e.card.effect === "multiTurn") {
        if (e.card.damage) dmgThisTurn += e.card.damage;
        if (e.card.heal) healThisTurn += e.card.heal;
      }
      // バフ (atkUp, atkMultiplier, shieldUp, shieldMultiplier)
      if (["atkUp", "atkMultiplier", "shieldUp", "shieldMultiplier"].includes(e.card.effect)) {
        // 攻撃や防御の計算は playCard 側で適用される
        // ここでは「残りターンを減らす」だけ
      }

      // 1ターン経過
      e.remaining -= 1;
    }
  });

  // HPに反映
  if (dmgThisTurn > 0) {
    room.hp[playerId] -= dmgThisTurn;
  }
  if (healThisTurn > 0) {
    room.hp[playerId] += healThisTurn;
    if (room.hp[playerId] > 10) room.hp[playerId] = 10;
  }

  // 残りターンが0の効果を削除
  room.effects[playerId] = room.effects[playerId].filter(e => e.remaining > 0);

  return { skipTurn, dmgThisTurn, healThisTurn };
}


io.on("connection", (socket) => {
  console.log("a user connected:", socket.id);

  socket.on("setName", (name) => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      if (room.players.includes(socket.id)) {
        room.names[socket.id] = name;
        io.to(roomId).emit("message", `${name} が名前を設定しました`);
        io.to(roomId).emit("updateHP", room.hp, room.names, room.effects);
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
      io.to(nextPlayer).emit("updateHand", room.hands[nextPlayer]);
    }
  });

  // --- playCard ---
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

    // --- 攻撃力・防御力バフの登録 ---
    if (["atkUp", "atkMultiplier", "shieldUp", "shieldMultiplier"].includes(card.effect)) {
      room.effects[socket.id] = room.effects[socket.id] || [];
      room.effects[socket.id].push({
        card,
        remaining: card.turns,
        damageBoost: card.damageBoost || 0,
        multiplier: card.multiplier || 1,
        shieldBoost: card.shieldBoost || 0
      });
      io.to(roomId).emit("message", `${myName} に ${card.turns} ターンの ${card.display_name} 効果が発動！`);
    }

    // --- ダメージ処理 ---
    if (card.damage) {
      let dmg = card.damage;

      if (room.effects[socket.id]) {
        room.effects[socket.id].forEach(e => {
          if (e.remaining > 0) {
            if (e.card.effect === "atkUp") dmg += e.damageBoost;
            if (e.card.effect === "atkMultiplier") dmg = Math.floor(dmg * e.multiplier);
            e.remaining -= 1;
          }
        });
        room.effects[socket.id] = room.effects[socket.id].filter(e => e.remaining > 0);
      }

      let opponentShield = room.shield[opponentId] || 0;
      if (room.effects[opponentId]) {
        room.effects[opponentId].forEach(e => {
          if (e.remaining > 0) {
            if (e.card.effect === "shieldUp") opponentShield += e.shieldBoost;
            if (e.card.effect === "shieldMultiplier") opponentShield = Math.floor(opponentShield * e.multiplier);
          }
        });
      }

      if (!card.ignoreShield) dmg = Math.max(0, dmg - opponentShield);
      room.hp[opponentId] -= dmg;
      if (!card.ignoreShield) room.shield[opponentId] = 0;

      io.to(roomId).emit("message", `${myName} が ${card.name} をプレイ！ ${opponentName} に ${dmg} ダメージ`);
    }

    // --- 回復処理 ---
    if (card.heal) {
      room.hp[socket.id] += card.heal;
      if (room.hp[socket.id] > 10) room.hp[socket.id] = 10;
      io.to(roomId).emit("message", `${myName} が ${card.name} をプレイ！ 自分のHPを ${card.heal} 回復`);
    }

    // --- 防御カード処理（即時） ---
    if (card.shield) {
      room.shield[socket.id] = card.shield;
      io.to(roomId).emit("message", `${myName} が ${card.name} をプレイ！ 次のターンの被ダメを ${card.shield} 軽減`);
    }

    // --- multiTurn / skip / draw / swap ---
    if (card.effect === "multiTurn") {
      room.effects[opponentId] = room.effects[opponentId] || [];
      room.effects[opponentId].push({ card, remaining: card.turns });
    }

    if (card.effect === "skipNextTurn") {
      room.effects[opponentId] = room.effects[opponentId] || [];
      room.effects[opponentId].push({ card, skip: true });
      io.to(roomId).emit("message", `${opponentName} の次のターンがスキップされます！`);
    }

    if (card.effect === "drawCard" && room.deck.length > 0) {
      const drawn = room.deck.splice(0,1)[0];
      room.hands[socket.id].push(drawn);
      io.to(socket.id).emit("updateHand", room.hands[socket.id]);
      io.to(socket.id).emit("message", `山札からカードを1枚引きました: ${drawn.name}`);
    }

    if (card.effect === "swapHand" && room.hands[opponentId].length > 0 && room.hands[socket.id].length > 0) {
      const myCardIndex = Math.floor(Math.random()*room.hands[socket.id].length);
      const oppCardIndex = Math.floor(Math.random()*room.hands[opponentId].length);
      const temp = room.hands[socket.id][myCardIndex];
      room.hands[socket.id][myCardIndex] = room.hands[opponentId][oppCardIndex];
      room.hands[opponentId][oppCardIndex] = temp;
      io.to(roomId).emit("message", `${myName} と ${opponentName} の手札が1枚入れ替わった！`);
    }

    // --- 手札補充 ---
    if (room.deck.length > 0 && room.hands[socket.id].length < handSize) {
      const drawn = room.deck.splice(0, 1)[0];
      room.hands[socket.id].push(drawn);
      io.to(socket.id).emit("message", `山札からカードを1枚引きました: ${drawn.name}`);
    }

    io.to(roomId).emit("updateHP", room.hp, room.names, room.effects);

    // --- ターン交代 ---
let nextIndex = (room.turnIndex + 1) % room.players.length;
let nextPlayer = room.players[nextIndex];

// 次プレイヤーのターン開始効果を処理
const effectResult = applyStartOfTurnEffects(room, nextPlayer);

if (effectResult) {
  if (effectResult.dmgThisTurn > 0) {
    io.to(roomId).emit("message", `${room.names[nextPlayer]} は効果で ${effectResult.dmgThisTurn} ダメージを受けた！`);
  }
  if (effectResult.healThisTurn > 0) {
    io.to(roomId).emit("message", `${room.names[nextPlayer]} は効果で ${effectResult.healThisTurn} 回復した！`);
  }
  if (effectResult.skipTurn) {
    io.to(roomId).emit("message", `${room.names[nextPlayer]} のターンはスキップされました！`);
    nextIndex = (nextIndex + 1) % room.players.length;
    nextPlayer = room.players[nextIndex];
  }
}

// 勝敗チェック
if (room.hp[nextPlayer] <= 0) {
  const winner = room.players.find(id => id !== nextPlayer);
  io.to(roomId).emit("message", `${room.names[winner]} の勝利！`);
  io.to(roomId).emit("gameOver", room.names[winner]);
  delete rooms[roomId];
  return;
}

room.turnIndex = nextIndex;
io.to(nextPlayer).emit("yourTurn", room.hands[nextPlayer], room.hp, room.names);

    room.turnIndex = nextIndex;
    io.to(nextPlayer).emit("yourTurn", room.hands[nextPlayer], room.hp, room.names);
  }); // <-- playCard を閉じる

  // --- disconnect ---
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

}); // <-- connection を閉じる

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`listening on *:${PORT}`));
