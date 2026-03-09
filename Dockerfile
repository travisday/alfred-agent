FROM node:22-slim

# Install system dependencies + SSH server setup
RUN apt-get update && apt-get install -y \
    curl git openssh-server mosh vim \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir /var/run/sshd \
    && sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config

# Install Tailscale
RUN curl -fsSL https://tailscale.com/install.sh | sh

# Install Pi coding agent globally
RUN npm install -g @mariozechner/pi-coding-agent

# Create workspace directory (will be mounted as a volume)
RUN mkdir -p /alfred
WORKDIR /alfred

# Stage Pi agent config for runtime copy (volume mount at /alfred hides build-time files)
COPY .pi/ /opt/alfred-pi-config/

# Install CalDAV extension dependencies
RUN cd /opt/alfred-pi-config/extensions/caldav && npm install

# Discord bridge
COPY discord-bridge/ /opt/discord-bridge/
RUN cd /opt/discord-bridge && npm install && npm run build

COPY start.sh /start.sh
RUN chmod +x /start.sh

CMD ["/start.sh"]
