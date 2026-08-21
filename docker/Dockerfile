# blast-radius — layer 3: physics.
#
# OpenCode runs as a non-root user in a container where the project directory
# is the only writable mount. No sudo exists in the image. Even if layers 1
# and 2 both fail, the host is not reachable.

FROM node:22-slim

RUN npm install -g opencode-ai && npm cache clean --force

# git is the one tool almost every coding task needs.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# The `node` user (uid 1000) ships with the image. No sudo is installed;
# there is no path back to root from here.
USER node
WORKDIR /work

ENV BLAST_RADIUS_CONTAINER=1

ENTRYPOINT ["opencode"]
