# Docker Upgrade Webhook

The Docker Upgrade Webhook is a Docker service that listens for HTTP POST requests from linked webhooks. When a request is received, it updates all Docker services running on the same Docker node to use the latest available image.

## Getting Started

These instructions will guide you on how to deploy this application.

### Installation

You can run Docker Upgrade Webhook by using the following `docker-compose.yml` file:

```yaml
version: '3.8'

services:
  docker-upgrade-webhook:
    image: ghcr.io/markwylde/docker-upgrade-webhook:latest
    ports:
      - 1907:1907
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
```

Then run the command:

```bash
docker-compose up -d
```

The Docker Upgrade Webhook service is now running and listening for webhooks on port 1907.

## Usage

Point your webhook to `http://<your-docker-node-ip>:1907/webhook`. Every time this webhook is called, the Docker Upgrade Webhook service will trigger an update of all running Docker services on the same Docker node to use the latest available images.
