# One image for both:
#   - Cloud Run service  gomf-app      (default CMD: the Next.js app)
#   - Cloud Run job      gomf-builder  (command override: npx tsx scripts/build-serving.ts)
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 8080
CMD ["npx", "next", "start", "-p", "8080"]
