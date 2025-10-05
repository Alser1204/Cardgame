# Cardgame
Arcaea's Card Game

jsonファイルの書き方

name:内部で処理する名称

display_name:HTMLで実際に表示する名称

damage:相手に与えるダメージ量

heal:自身の回復量

ignoreShield:防御無視

effect:

    skipNextTurn-次の相手のターンをスキップ
    
    drawCard-カードを引く
    
    swapHand-手札を一枚相手と入れ替える
    
    multiTurn-毎ターン起こる効果を持続させる
    
    atkUp:ダメージ量を上乗せする
    
    atkMultiplier:ダメージ量を倍率で上昇させる
    
    shieldUp:シールド量を上乗せする
    
    shieldMultiplier:シールド量を倍率で上昇させる
    
turns:multiturnを持続させるターン数

healPerTurn:毎ターンの回復量

shieldPerTurn:毎ターンのシールド付与量

damagePerTurn:毎ターンの相手へのスリップダメージ

damageBoost:atkUpの際のダメージ上乗せ量

shieldBoost:shieldUpの際のシールド上乗せ量

multiplier:effectの倍率



メモ:

相手のターン中にカードを選択するとカードが見れなくなる

regene等のターン開始時に発動するエフェクトが正常に動作していない←原因不明(ターン数は減っている？)　解決

効果が多すぎると表示がおかしくなる？

なぜか心で回復しないときがあった

HP上限が実際の表示上限と異なる

HPが少なくなった際に残HPが見られなくなる

持続効果系の効果表示と実際の効果発動のタイミングが異なる

パワーストライクなど、攻撃倍率、加算をかけるタイミングを直すべき

自傷技あってもいいかも
今の処理だと複数のeffectを異なるターン数でかけることができない←必要であれば直そう
turnsとは別に関係するカードを使うごとでremainingを減らす変数も作った方がよさそう
