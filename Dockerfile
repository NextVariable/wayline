FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Only browser map credentials belong in the client build. Never pass model keys here.
ARG VITE_AMAP_KEY
ARG VITE_AMAP_SECURITY_CODE
ARG VITE_TIANDITU_TOKEN
ENV VITE_AMAP_KEY=$VITE_AMAP_KEY VITE_AMAP_SECURITY_CODE=$VITE_AMAP_SECURITY_CODE VITE_TIANDITU_TOKEN=$VITE_TIANDITU_TOKEN
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
RUN npm ci --prefix server/provider-runtime --omit=dev --ignore-scripts --no-audit --no-fund
RUN mkdir -p /app/.wayline-private && chown node:node /app/.wayline-private
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"
CMD ["node", "server/index.mjs"]
