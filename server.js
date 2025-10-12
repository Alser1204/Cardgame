// ==============================
// 必要なモジュールの読み込み
// ==============================
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

// ==============================
// サーバーとSocket.ioの準備
// ==============================
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 静的ファイル（publicフォルダ内）を配信
app.use(express.static("public"));

// ==============================
// カードデータの読み込み
// ==============================
let cardList = [];
let AnothercardList = [];
try {
  // cards.json を読み込んでパース
  const data = fs.readFileSync(path.join(__dirname, "public", "cards.json"), "utf8");
  cardList = JSON.parse(data);
  console.log("カードデータ読み込み成功:", cardList);
} catch (err) {
  console.error("カードデータ読み込みエラー:", err);
}

try {
  // cards.json を読み込んでパース
  const AnotherData = fs.readFileSync(path.join(__dirname, "public", "dgacha.json"), "utf8");
  AnothercardList = JSON.parse(AnotherData);
  console.log("カードデータ読み込み成功:", AnothercardList);
} catch (err) {
  console.error("カードデータ読み込みエラー:", err);
}

// ==============================
// ゲーム用変数
// ==============================
const rooms = {};      // ルームごとの情報を格納
const handSize = 5;    // 初期手札枚数
const max_HP = 20;     // 最大HP
const max_costs = 5;   //初期コスト
const avoid_prob = 0.05   //初期回避確率

// ==============================
// ターン開始時に発動する効果処理
// ==============================
function applyStartOfTurnEffects(room, playerId) {
  if (!room.effects[playerId]) return;
  console.log("debug");
  let skipTurn = false;
  let dmgThisTurn = 0;
  let healThisTurn = 0;
  let shieldThisTurn = 0;

  // プレイヤーにかかっている効果を処理
  room.effects[playerId].forEach(e => {
    if (e.remaining > 0) {
      // ターンスキップ効果
      if (e.skip) {
        skipTurn = true;
      }
      // 継続ダメージや回復
      dmgThisTurn += e.card.damagePerTurn;
      healThisTurn += e.card.healPerTurn;
      shieldThisTurn += e.card.shieldPerTurn;
      // バフ効果（atkUp, shieldUpなど）は残存ターン管理のみ
      if (["atkUp", "atkMultiplier", "shieldUp", "shieldMultiplier", "avoidUp"].includes(e.card.effect)) {
        // ここでは数値の更新はせず、残りターンだけ減らす
      }
      // 効果ターンを1減らす
      e.remaining -= 1;
    }
  });

  // ダメージと回復の反映
  if (dmgThisTurn > 0) {
    room.hp[playerId] -= dmgThisTurn;
  }
  if (healThisTurn > 0) {
    room.hp[playerId] += healThisTurn;
    if (room.hp[playerId] > max_HP) room.hp[playerId] = max_HP; // HP上限max_HP
  }
  if (shieldThisTurn > 0) {
    room.shield[playerId] += shieldThisTurn;
  }

  // 残りターンが0の効果は削除
  room.effects[playerId] = room.effects[playerId].filter(e => e.remaining > 0);

  return { skipTurn, dmgThisTurn, healThisTurn, shieldThisTurn };
}

// ==============================
// プレイヤー接続時の処理
// ==============================
io.on("connection", (socket) => {
  console.log("a user connected:", socket.id);

  // プレイヤー名設定
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

  socket.on("debug", (msg) => {
    console.log(msg);
  });

  // ルームに参加
  socket.on("joinRoom", (roomId) => {
    if (!rooms[roomId]) {
      // 新しいルームを作成
      const isDgacha = roomId.includes("dgacha");
      rooms[roomId] = {
        players: [],
        turnIndex: 0,
        hands: {},
        hp: {},
        names: {},
        shield: {},
        avoid: {},
        deck: [...(isDgacha ? AnothercardList : cardList)].sort(() => Math.random() - 0.5),
        effects: {},
        costs: {}
      };
    }

    const room = rooms[roomId];
    if (room.players.length >= 2) {
      socket.emit("roomFull");
      return;
    }

    // プレイヤー情報を追加
    room.players.push(socket.id);
    room.hands[socket.id] = room.deck.splice(0, handSize);
    room.hp[socket.id] = max_HP;
    room.shield[socket.id] = 0;
    room.costs[socket.id] = max_costs;
    room.avoid[socket.id] = avoid_prob;

    socket.join(roomId);
    if (!room.names[socket.id]) room.names[socket.id] = `プレイヤー${room.players.length}`;

    io.to(roomId).emit("message", `${room.names[socket.id]} が参加しました (${room.players.length}/2)`);

    // プレイヤー2人揃ったらゲーム開始
    if (room.players.length === 2) {
      io.to(roomId).emit("message", "ゲーム開始！");

      // HPを全員に一度送る
      io.to(roomId).emit("updateHP", room.hp, room.names, room.effects);

      const firstPlayer = room.players[room.turnIndex];
      io.to(firstPlayer).emit("yourTurn", room.hands[firstPlayer], room.hp, room.names);
      const nextPlayer = room.players[(room.turnIndex + 1) % 2];
      io.to(nextPlayer).emit("updateHand", room.hands[nextPlayer]);
    }
  });

  // ==============================
  // カードをプレイしたときの処理
  // ==============================
  socket.on("playCard", ({ roomId, cardName }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (room.players[room.turnIndex] !== socket.id) {
      socket.emit("notYourTurn");
      return;
    }
    if (room.costs[socket.id] <= 0) {
      socket.emit("noCosts");
      return;
    }


    // 手札からカードを探す
    const hand = room.hands[socket.id];
    const card = hand.find(c => c.name === cardName);
    if (!card) { socket.emit("invalidCard"); return; }

    //コスト消費
    const cost = Number(card.costs || 0);
    room.costs[socket.id] -= cost;
    socket.emit("updateCost", room.costs[socket.id]);

    // 使用カードを手札から除去
    room.hands[socket.id] = hand.filter(c => c.name !== cardName);
    const opponentId = room.players.find(id => id !== socket.id);
    const myName = room.names[socket.id];
    const opponentName = room.names[opponentId];

    // --- ダメージ処理 ---
    if (card.damage) {
      let dmg = card.damage;

      // 自分の攻撃バフ適用
      if (room.effects[socket.id]) {
        room.effects[socket.id].forEach(e => {
          if (e.remaining > 0) {
            if (e.card.effect === "atkMultiplier") dmg = Math.floor(dmg * e.multiplier); //乗算→加算
            if (e.card.effect === "atkUp") dmg += e.damageBoost;
          }
        });
      }

      // 相手のシールドバフ適用
      let opponentShield = room.shield[opponentId] || 0;
      if (room.effects[opponentId]) {
        room.effects[opponentId].forEach(e => {
          if (e.remaining > 0) {
            if (e.card.effect === "shieldMultiplier") opponentShield = Math.floor(opponentShield * e.multiplier); //乗算→加算
            if (e.card.effect === "shieldUp") opponentShield += e.shieldBoost;
          }
        });
      }
      let canAvoid=0;

      // シールドを無視しない場合
      if (!card.ignoreShield) dmg = Math.max(0, dmg - opponentShield);
      randInt = Math.random();
        console.log(randInt + "&" + room.avoid[opponentId]);
        if(randInt>=room.avoid[opponentId]) canAvoid=1;
      if (canAvoid) {
        room.hp[opponentId] -= dmg;
        io.to(roomId).emit("message", `${myName} が ${card.display_name} をプレイ！ ${opponentName} に ${dmg} ダメージ`);
      } else {
        io.to(roomId).emit("message", `${myName} が ${card.display_name} をプレイ！ しかし ${opponentName} は回避した！`);
      }
      if (!card.ignoreShield) room.shield[opponentId] = 0;
    }

    // --- 自分にバフ系効果 ---
    if (["atkUp", "atkMultiplier", "shieldUp", "shieldMultiplier", "avoidUp"].includes(card.effect)) {
      room.effects[socket.id] = room.effects[socket.id] || [];
      room.effects[socket.id].push({
        card,
        remaining: card.turns,
        damageBoost: card.damageBoost || 0,
        multiplier: card.multiplier || 1,
        shieldBoost: card.shieldBoost || 0,
      });
      room.avoid[socket.id]=card.avoid + avoid_prob || avoid_prob
      io.to(roomId).emit("message", `${myName} に ${card.turns} ターンの ${card.display_name} 効果が発動！`); //display_nameからは変えた方がいいかも
    }

    // --- 継続効果 ---
    if (card.effect === "multiTurn") {
      // 自分に付与（リジェネや防御）
      if (card.healPerTurn || card.shieldPerTurn) {
        room.effects[socket.id] = room.effects[socket.id] || [];
        room.effects[socket.id].push({
          card,
          remaining: card.turns,
          healPerTurn: card.healPerTurn || 0,
          shieldPerTurn: card.shieldPerTurn || 0
        });
        io.to(roomId).emit("message", `${myName} に ${card.display_name} が発動！`);
      }
      // 相手に付与（毒・ストーム）
      if (card.damagePerTurn) {
        room.effects[opponentId] = room.effects[opponentId] || [];
        room.effects[opponentId].push({
          card,
          remaining: card.turns,
          damagePerTurn: card.damagePerTurn
        });
        io.to(roomId).emit("message", `${opponentName} に ${card.display_name} が発動！`);
      }
    }

    // --- ターンスキップ効果 ---
    if (card.effect === "skipNextTurn") {
      room.effects[opponentId] = room.effects[opponentId] || [];
      room.effects[opponentId].push({ card, remaining: 1, skip: true });
      io.to(roomId).emit("message", `${opponentName} の次のターンがスキップされます！`);
    }

    // --- 回復処理 ---
    if (card.heal) {
      room.hp[socket.id] += card.heal;
      if (room.hp[socket.id] > max_HP) room.hp[socket.id] = max_HP;
      io.to(roomId).emit("message", `${myName} が ${card.display_name} をプレイ！ 自分のHPを ${card.heal} 回復`);
    }

    // --- 即時防御カード ---
    if (card.shield) {
      room.shield[socket.id] = card.shield;
      io.to(roomId).emit("message", `${myName} が ${card.display_name} をプレイ！ 次のターンの被ダメを ${card.shield} 軽減`);
    }

    // --- ドロー効果 ---
    if (card.effect === "drawCard" && room.deck.length > 0) {
      const drawn = room.deck.splice(0, 1)[0];
      room.hands[socket.id].push(drawn);
      io.to(socket.id).emit("updateHand", room.hands[socket.id]);
      io.to(socket.id).emit("playerMessage", `山札からカードを1枚引きました: ${drawn.display_name}`);
    }

    // --- 手札交換効果 ---
    if (card.effect === "swapHand" && room.hands[opponentId].length > 0 && room.hands[socket.id].length > 0) {
      const myCardIndex = Math.floor(Math.random() * room.hands[socket.id].length);
      const oppCardIndex = Math.floor(Math.random() * room.hands[opponentId].length);
      const temp = room.hands[socket.id][myCardIndex];
      room.hands[socket.id][myCardIndex] = room.hands[opponentId][oppCardIndex];
      room.hands[opponentId][oppCardIndex] = temp;
      io.to(roomId).emit("message", `${myName} と ${opponentName} の手札が1枚入れ替わった！`);
    }

    // --- 手札補充（常に5枚まで） ---
    if (room.deck.length > 0 && room.hands[socket.id].length < handSize) {
      const drawn = room.deck.splice(0, 1)[0];
      room.hands[socket.id].push(drawn);
      io.to(socket.id).emit("playerMessage", `山札からカードを1枚引きました: ${drawn.display_name}`);
    }

    // HPや効果の更新を全員に送信
    io.to(roomId).emit("updateHP", room.hp, room.names, room.effects);

    // --- 勝利判定 ---
    if (room.hp[opponentId] <= 0) {
      io.to(roomId).emit("message", `${myName} の勝利！`);
      io.to(roomId).emit("gameOver", myName);
      delete rooms[roomId];
      return;
    }

    let nextIndex = (room.turnIndex + 1) % room.players.length;
    let nextPlayer = room.players[nextIndex];

    // 効果で死んだ場合の勝利判定
    if (room.hp[nextPlayer] <= 0) {
      const winner = room.players.find(id => id !== nextPlayer);
      io.to(roomId).emit("message", `${room.names[winner]} の勝利！`);
      io.to(roomId).emit("gameOver", room.names[winner]);
      delete rooms[roomId];
      return;
    }


  });

  socket.on("endTurn", (roomId) => {
    const room = rooms[roomId];
    if (!room) return;
    if (room.players[room.turnIndex] !== socket.id) {
      socket.emit("notYourTurn");
      return;
    }

    // 次のプレイヤーを仮決定
    let currentPlayer = room.players[room.turnIndex];
    let nextIndex = (room.turnIndex + 1) % room.players.length;
    let nextPlayer = room.players[nextIndex];

    // --- 次ターン開始効果を適用 ---
    const effectResult = applyStartOfTurnEffects(room, nextPlayer);

    // ダメージ・回復などの通知
    if (effectResult) {
      const nextName = room.names[nextPlayer];

      if (effectResult.dmgThisTurn > 0) {
        io.to(roomId).emit("message", `${nextName} は効果で ${effectResult.dmgThisTurn} ダメージを受けた！`);
      }
      if (effectResult.healThisTurn > 0) {
        io.to(roomId).emit("message", `${nextName} は効果で ${effectResult.healThisTurn} 回復した！`);
      }
      if (effectResult.shieldThisTurn > 0) {
        io.to(roomId).emit("message", `${nextName} は効果で ${effectResult.shieldThisTurn} のシールドを得た！`);
      }

      // --- スキップ効果がある場合 ---
      if (effectResult.skipTurn) {
        io.to(roomId).emit("message", `${nextName} のターンはスキップされました！`);
        nextIndex = (nextIndex + 1) % room.players.length;
        nextPlayer = room.players[nextIndex];
      }
    }

    // --- HP更新を送信 ---
    io.to(roomId).emit("updateHP", room.hp, room.names, room.effects);

    // --- 勝利判定（効果ダメージで死んだ場合も含む） ---
    const loser = room.players.find(id => room.hp[id] <= 0);
    if (loser) {
      const winner = room.players.find(id => id !== loser);
      io.to(roomId).emit("message", `${room.names[winner]} の勝利！`);
      io.to(roomId).emit("gameOver", room.names[winner]);
      delete rooms[roomId];
      return;
    }

    // --- ターンを正式に交代 ---
    room.turnIndex = nextIndex;
    const newTurnPlayer = room.players[room.turnIndex];
    if (room.costs[currentPlayer] < 5) room.costs[currentPlayer] += 1;
    socket.emit("updateCost", room.costs[currentPlayer]);
    io.to(currentPlayer).emit("playerMessage", `コストが1回復しました！`);

    io.to(roomId).emit("message", `${room.names[newTurnPlayer]} のターン！`);
    io.to(newTurnPlayer).emit("yourTurn", room.hands[newTurnPlayer], room.hp, room.names);
  });


  // ==============================
  // 切断時の処理
  // ==============================
  socket.on("disconnect", () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const index = room.players.indexOf(socket.id);
      if (index !== -1) {
        // プレイヤー削除
        room.players.splice(index, 1);
        delete room.hands[socket.id];
        delete room.hp[socket.id];
        delete room.names[socket.id];
        delete room.shield[socket.id];
        delete room.effects[socket.id];
        delete room.costs[socket.id];
        io.to(roomId).emit("message", "プレイヤーが退出しました");
        if (room.players.length === 0) delete rooms[roomId]; // ルームに誰もいなければ削除
      }
    }
  });
});

// ==============================
// サーバー起動
// ==============================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`listening on *:${PORT}`));
