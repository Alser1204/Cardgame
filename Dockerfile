# Node.js 公式イメージを使用
FROM node:20

# 作業ディレクトリを作成
WORKDIR /usr/src/app

# package.json と package-lock.json をコピー
COPY package*.json ./

# 依存関係をインストール
RUN npm install

# アプリのソースをコピー
COPY . .

# Northflank が外部に公開するポート
EXPOSE 3000

# サーバーを起動
CMD ["node", "server.js"]
