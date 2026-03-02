FROM node:22-alpine

# Install Python and yt-dlp for YouTube extraction
RUN apk add --no-cache python3 py3-pip && \
    pip3 install --no-cache-dir yt-dlp --break-system-packages

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy application code
COPY index.js db.js ./

# Create data directory for persistent storage
RUN mkdir -p /data

# Expose port
EXPOSE 3000

# Set production environment
ENV NODE_ENV=production

# Start application
CMD ["node", "index.js"]
