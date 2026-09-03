ARG NODE_IMAGE=node:20-alpine
FROM ${NODE_IMAGE}

RUN apk add --no-cache git docker-cli docker-cli-compose rclone python3 py3-pip \
    && pip3 install --no-cache-dir --break-system-packages anyshare-unofficial bypy

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .

# Inject current git commit SHA at build time
ARG JEWEL_COMMIT=unknown
ENV JEWEL_COMMIT=${JEWEL_COMMIT}
LABEL io.jewel.managed=true

RUN mkdir -p /data/projects

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=330

EXPOSE 330

VOLUME ["/data"]

CMD ["node", "src/index.js"]
