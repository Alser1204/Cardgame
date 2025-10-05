# Cardgame
Arcaea's Card Game

---

## JSONファイルの書き方

カードの情報はJSONで管理します。主な項目は以下の通りです。

| フィールド名        | 説明 |
|-------------------|------|
| `name`            | 内部で処理する名称（imagesディレクトリ内の画像とリンク） |
| `display_name`    | HTMLで実際に表示する名称 |
| `damage`          | 相手に与えるダメージ量 |
| `heal`            | 自身の回復量 |
| `ignoreShield`    | 防御を無視するかどうか |
| `effect`          | カード固有の効果。下記参照 |
| `turns`           | `multiTurn`効果を持続させるターン数 |
| `healPerTurn`     | 毎ターンの回復量 (`multiTurn`時) |
| `shieldPerTurn`   | 毎ターンのシールド付与量 (`multiTurn`時) |
| `damagePerTurn`   | 毎ターンの相手へのスリップダメージ (`multiTurn`時) |
| `damageBoost`     | `atkUp`時のダメージ上乗せ量 |
| `shieldBoost`     | `shieldUp`時のシールド上乗せ量 |
| `multiplier`      | ダメージやシールド倍率 (`atkMultiplier` / `shieldMultiplier`) |

### effectの種類

| 効果名              | 説明 |
|-------------------|------|
| `skipNextTurn`     | 次の相手のターンをスキップ |
| `drawCard`         | カードを1枚引く |
| `swapHand`         | 手札を1枚相手と入れ替える |
| `multiTurn`        | 毎ターン発生する効果を持続させる |
| `atkUp`            | ダメージ量を上乗せする |
| `atkMultiplier`    | ダメージ量を倍率で上昇させる |
| `shieldUp`         | シールド量を上乗せする |
| `shieldMultiplier` | シールド量を倍率で上昇させる |

---

## JSON例

```json
{
  "name": "power_strike",
  "display_name": "パワーストライク",
  "damage": 5,
  "effect": "atkUp",
  "damageBoost": 2
}
```



## メモ:

・相手のターン中にカードを選択するとカードが見れなくなる

・regene等のターン開始時に発動するエフェクトが正常に動作していない←原因不明(ターン数は減っている？)　解決

・効果が多すぎると表示がおかしくなる？

・なぜか心で回復しないときがあった

・HP上限が実際の表示上限と異なる

・HPが少なくなった際に残HPが見られなくなる

・持続効果系の効果表示と実際の効果発動のタイミングが異なる

・パワーストライクなど、攻撃倍率、加算をかけるタイミングを直すべき

・自傷技あってもいいかも

・今の処理だと複数のeffectを異なるターン数でかけることができない←必要であれば直そう

・turnsとは別に関係するカードを使うごとでremainingを減らす変数も作った方がよさそう

・ログに表示するときもターン数とかも表示する　
