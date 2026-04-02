# Security Rules (always loaded)
- NO AUTHENTICATION exists on any endpoint — this is a known CRITICAL finding
- B2AppKey is exposed in GET /api/settings response — must be masked before internet exposure
- Docker socket is mounted — unauthenticated update API = host root access
- When modifying API handlers: every endpoint is publicly accessible
- When adding URL inputs: validate against SSRF (block RFC1918, link-local, metadata IPs)
- Never commit .env files, B2 credentials, or API keys
