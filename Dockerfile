FROM node:22-slim

# Build tools needed for better-sqlite3 native compilation
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install server dependencies
COPY server/package*.json ./server/
RUN cd server && npm install

# Install client dependencies (devDeps included for Vite build)
COPY client/package*.json ./client/
RUN cd client && npm install

# Copy all source files
COPY . .

# Build React frontend
RUN cd client && npm run build

EXPOSE 3001

ENV NODE_ENV=production

CMD ["node", "server/index.js"]
