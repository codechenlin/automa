# Automaton Local Mode Dockerfile
#
# Runs the automaton in local mode for Genesis and Adolescence phases.
# All outbound traffic routes through the egress proxy.

FROM node:22-slim

# Create non-root user
RUN groupadd -r automaton && useradd -r -g automaton -m automaton

# Install dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci --production

# Copy source
COPY . .

# Build TypeScript
RUN npm run build 2>/dev/null || true

# Create state directory
RUN mkdir -p /home/automaton/.automaton && \
    chown -R automaton:automaton /home/automaton/.automaton

# Switch to non-root user
USER automaton

# Set local mode
ENV AUTOMATON_MODE=local
ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
