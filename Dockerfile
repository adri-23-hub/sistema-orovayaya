FROM node:24-alpine AS build

WORKDIR /app/server

COPY server/package.json server/package-lock.json* ./
RUN npm ci

COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build

FROM node:24-alpine

WORKDIR /app/server

ENV NODE_ENV=production

COPY --from=build /app/server/package.json /app/server/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/server/dist ./dist
COPY client /app/client

EXPOSE 3000

CMD ["node", "dist/app.js"]