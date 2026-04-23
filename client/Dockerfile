#
# Build stage
#
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts tailwind.config.js postcss.config.js index.html ./
COPY src ./src
RUN npm run build

#
# Runtime — nginx serves the static bundle and proxies /api
#
FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q -O - http://127.0.0.1/ > /dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
