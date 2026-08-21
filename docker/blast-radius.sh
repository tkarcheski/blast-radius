#!/usr/bin/env bash
# blast-radius — run OpenCode inside the container, from your project root:
#
#   ./docker/blast-radius.sh            # interactive session
#   ./docker/blast-radius.sh --auto     # unattended; this is what layer 3 is for
#
# What the flags buy you:
#   -v "$PWD":/work            the project dir is the ONLY host mount
#   --user node                non-root inside the container
#   --cap-drop ALL             no Linux capabilities at all
#   --security-opt no-new-privileges   setuid binaries can't escalate
#   --pids-limit / --memory    a fork bomb dies in the container, not on your laptop
#   (no docker socket)         mounting /var/run/docker.sock would be root on the host
#
# Full lockdown (no network — agent can't exfiltrate anything):
#   BLAST_RADIUS_NET=none ./docker/blast-radius.sh
#
# Credentials: OpenCode needs a model provider. Pass an API key as an env var
# scoped to this one container. That key is the one secret the agent holds —
# use a revocable, spend-capped key for unattended runs.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE="blast-radius:latest"
NET="${BLAST_RADIUS_NET:-bridge}"

docker build -t "$IMAGE" "$SCRIPT_DIR"

exec docker run --rm -it \
  -v "$PWD":/work \
  -w /work \
  --user node \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --pids-limit 512 \
  --memory 4g \
  --network "$NET" \
  ${ANTHROPIC_API_KEY:+-e ANTHROPIC_API_KEY} \
  ${OPENAI_API_KEY:+-e OPENAI_API_KEY} \
  ${OPENROUTER_API_KEY:+-e OPENROUTER_API_KEY} \
  "$IMAGE" "$@"
