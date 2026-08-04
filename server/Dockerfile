FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm ci

COPY src/ ./src/
COPY client/ ./client/

RUN npm run build

FROM node:22-alpine

WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json* ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/client ./client

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "dist/app.js"]