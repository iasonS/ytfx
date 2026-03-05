FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy application code
COPY index.js db.js emoticons.js metrics.js ./
COPY public/ ./public/

# Create data directory for persistent storage
RUN mkdir -p /data

# Expose port
EXPOSE 3000

# Set production environment
ENV NODE_ENV=production

# Start application
CMD ["node", "index.js"]
