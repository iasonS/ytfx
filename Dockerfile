FROM node:22-alpine

# Install Python and yt-dlp for YouTube extraction
RUN apk add --no-cache python3 py3-pip && \
    pip3 install --no-cache-dir yt-dlp --break-system-packages

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy application code and static assets
# Every server module reachable from index.js has to be named here, however deep — not just
# the ones index.js imports directly. The list is explicit, so a module that is not added
# builds a perfectly healthy image that cannot start. tests/dockerfile.test.js walks the
# import graph and fails when this line falls behind.
COPY index.js db.js emoticons.js metrics.js mhstats-rooms.js mhstats-quiz.js mhstats-quiz-bank.js ./
COPY public ./public

# Create data directory for persistent storage
RUN mkdir -p /data

# Expose port
EXPOSE 3000

# Set production environment
ENV NODE_ENV=production
ENV VIDEOS_DIR=/data/videos

# Start application
CMD ["node", "index.js"]
