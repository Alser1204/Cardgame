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

    // 攻撃側バフ
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

    // 防御側バフ
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

  // --- multiTurn / skip / draw / swap --- （既存の処理維持）
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

  io.to(roomId).emit("updateHP", room.hp, room.names);

  // --- 勝利判定 ---
  if (room.hp[opponentId] <= 0) {
    io.to(roomId).emit("message", `${myName} の勝利！`);
    io.to(roomId).emit("gameOver", myName);
    delete rooms[roomId];
    return;
  }

  // --- ターン交代 ---
  let nextIndex = (room.turnIndex + 1) % room.players.length;
  let nextPlayer = room.players[nextIndex];

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
