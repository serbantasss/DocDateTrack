FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY models ./models
COPY tasks/seed-demo-data.js ./tasks/seed-demo-data.js

CMD ["node", "tasks/seed-demo-data.js"]
