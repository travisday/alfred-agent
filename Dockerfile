FROM node:22-slim

# Install system dependencies + SSH server setup
RUN apt-get update && apt-get install -y \
    curl git openssh-server mosh vim \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir /var/run/sshd \
    && sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config \
    && sed -i 's/#Port 22/Port 2222/' /etc/ssh/sshd_config

# Install Tailscale
RUN curl -fsSL https://tailscale.com/install.sh | sh

# Install Pi coding agent globally
RUN npm install -g @mariozechner/pi-coding-agent@latest

# Create workspace directory (will be mounted as a volume)
RUN mkdir -p /alfred
WORKDIR /alfred

# Stage Pi agent config for runtime copy (volume mount at /alfred hides build-time files)
COPY .pi/ /opt/alfred-pi-config/

# Install CalDAV extension dependencies
RUN cd /opt/alfred-pi-config/extensions/caldav && npm install

# Install web-search extension dependencies
RUN cd /opt/alfred-pi-config/extensions/web-search && npm install

# Install discord-notify extension dependencies
RUN cd /opt/alfred-pi-config/extensions/discord-notify && npm install

# Proactive check-in prompts + scheduler (read-only path; not hidden by /alfred volume)
COPY proactive/ /opt/proactive/
RUN chmod +x /opt/proactive/scheduler.sh /opt/proactive/run-checkin.sh /opt/proactive/test-discord-dm.sh

# Discord bridge
COPY discord-bridge/ /opt/discord-bridge/
RUN cd /opt/discord-bridge && npm install && npm run build

COPY config.env.template /opt/config.env.template
COPY start.sh /start.sh
RUN chmod +x /start.sh

CMD ["/start.sh"]
