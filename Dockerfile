FROM node:19-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 1907

CMD [ "node", "lib/index.js" ]
