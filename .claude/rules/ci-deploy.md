---
paths:
  - ".github/**"
  - "Dockerfile"
  - "docker-compose.yml"
  - "install.sh"
---
# CI & Deployment Rules
- Image: ghcr.io/twolfekc/floodtest:latest (multi-arch amd64+arm64)
- Versions: YYYY.MM.DD-<sha> via ldflags — never show Docker digests to users
- CI test job gates Docker build — all tests must pass before image push
- Self-update via Docker socket + helper container
- GH Actions pinned to major versions (reviewer flagged: should pin to SHAs)
