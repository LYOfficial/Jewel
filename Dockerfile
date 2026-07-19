FROM node:20-alpine

RUN apk add --no-cache git docker-cli docker-cli-compose

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .

# Inject current git commit SHA at build time
ARG JEWEL_COMMIT=unknown
ENV JEWEL_COMMIT=${JEWEL_COMMIT}

RUN mkdir -p /data/projects

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=330

EXPOSE 330

VOLUME ["/data"]

# Bump the open-file limit inside the container. `docker compose` /
# `docker build` opens many files in parallel and the default 1024
# triggers "too many open files" during rebuilds. The PID cap is
# removed by `install.sh` / `docker-compose.yml` since Docker doesn't
# expose it as a Dockerfile directive.
RUN echo "* soft nofile 65536" >> /etc/security/limits.conf \
 && echo "* hard nofile 65536" >> /etc/security/limits.conf

CMD ["node", "src/index.js"]
