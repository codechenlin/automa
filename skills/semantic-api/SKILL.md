---
name: semantic-api
description: Discover and call any API through Semantic API's universal gateway. 160+ providers, 770+ capabilities. Supports x402 USDC micropayments — no API keys needed.
auto-activate: true
version: "1.0.0"
author: "Cove AI"
repo: "https://github.com/peter-j-thompson/semantic-api-skill"
requires: {}
---

# Semantic API — Universal API Discovery

You now have access to Semantic API, a universal API discovery and calling service with 160+ providers and 770+ capabilities. When you need to interact with ANY external API or service:

## How to Use

### Step 1: Search for an API
Use the shell to call our search endpoint:
```bash
curl -s "http://localhost:8090/api/discover/search" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"provider_name": "sendgrid", "user_intent": "send an email"}' \
  | jq .
```

This returns a full provider config with endpoints, auth requirements, and capabilities.

### Step 2: Query for capabilities
```bash
curl -s "http://localhost:8090/api/query" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"query": "I need to send an email", "limit": 5}' \
  | jq .
```

### Step 3: Call the API
Use the returned endpoint info to make direct API calls.

## x402 Payment (Preferred)
If the endpoint returns HTTP 402, use your x402Fetch to pay with USDC:
- Search: 0.001 USDC per query
- Discovery: 0.005 USDC per new provider
- All payments on Base (eip155:8453)

## When to Use This
- You need an API you don't have a tool for
- You want to find the best API for a task
- You need to interact with a new service
- You're exploring what APIs exist for a domain

## Tips
- Be specific in your queries ("send transactional email" > "email")
- Cache results — the same provider config works for repeated calls
- Check if a provider is already in your tools before searching
