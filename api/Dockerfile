FROM node:20-alpine
WORKDIR /app

# Install Docker CLI so we can trigger real builds from inside the container
RUN apk add --no-cache docker-cli docker-compose curl

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy application code
COPY . .

# Expose API port
EXPOSE 5000

# Run the API server
CMD ["npx", "-y", "tsx", "server.ts"]
