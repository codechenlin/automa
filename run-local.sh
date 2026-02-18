#!/bin/bash
set -e

# Inject Anthropic OAuth token
export ANTHROPIC_API_KEY=$(python3 -c "import json; d=json.load(open('/Users/stackie/.openclaw/agents/main/agent/auth-profiles.json')); print(d['profiles']['anthropic:default']['token'])")
echo "Token loaded: ${ANTHROPIC_API_KEY:0:20}..."

cd ~/projects/conway-real
node dist/index.js --run
