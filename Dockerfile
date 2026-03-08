FROM node:22-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl git openssh-server mosh vim \
    && rm -rf /var/lib/apt/lists/*

# Install Tailscale
RUN curl -fsSL https://tailscale.com/install.sh | sh

# Install pi coding agent globally
RUN npm install -g @mariozechner/pi-coding-agent

# Setup SSH server
RUN mkdir /var/run/sshd
RUN sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config

# Create workspace directory (will be mounted as a volume)
RUN mkdir -p /alfred
WORKDIR /alfred

# Copy and set up start script
COPY start.sh /start.sh
RUN chmod +x /start.sh

CMD ["/start.sh"]
