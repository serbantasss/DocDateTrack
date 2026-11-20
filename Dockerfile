# syntax=docker/dockerfile:1

# Production image of DocDateTrack. Configuration comes from environment variables (see
# .env.example and docs/deployment.md); uploaded files are stored in the /data/uploads volume.
# The base image is pinned by digest for reproducible builds; Dependabot keeps it up to date.

FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5

LABEL org.opencontainers.image.title="DocDateTrack" \
      org.opencontainers.image.description="Self-hosted web app that tracks the expiry dates of important documents and reminds you before they lapse." \
      org.opencontainers.image.url="https://github.com/serbantasss/DocDateTrack" \
      org.opencontainers.image.source="https://github.com/serbantasss/DocDateTrack" \
      org.opencontainers.image.documentation="https://github.com/serbantasss/DocDateTrack/blob/main/docs/deployment.md" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    PORT=8080 \
    UPLOAD_DIR=/data/uploads \
    NPM_CONFIG_UPDATE_NOTIFIER=false

RUN mkdir -p /data/uploads && chown node:node /data/uploads

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json LICENSE app.js ./
COPY bin ./bin
COPY config ./config
COPY controllers ./controllers
COPY lib ./lib
COPY middleware ./middleware
COPY models ./models
COPY public ./public
COPY routes ./routes
COPY services ./services
COPY tasks ./tasks
COPY views ./views

# The application files stay owned by root (read-only for the app); only the uploads are writable.
USER node
VOLUME ["/data/uploads"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --start-interval=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/healthz').then((res) => process.exit(res.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "bin/www"]
