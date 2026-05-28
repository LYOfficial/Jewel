FROM node:20-alpine

RUN apk add --no-cache git docker-cli docker-cli-compose

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .

RUN mkdir -p /data/projects

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=330

EXPOSE 330

VOLUME ["/data"]

CMD ["node", "src/index.js"]
