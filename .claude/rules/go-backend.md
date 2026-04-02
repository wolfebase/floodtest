---
paths:
  - "internal/**/*.go"
  - "cmd/**/*.go"
---
# Go Backend Rules
- Use `db.OpenDB(":memory:")` for test isolation, never `db.Open()` in tests
- Run `go test -race ./...` before committing Go changes
- Callback wiring: function fields on `api.App` struct, not interfaces
- Config: env vars override DB values via `config.New()`
- Never return raw `err.Error()` to API clients — log details, return generic message
- When adding URL-accepting features, add SSRF filtering (block private/metadata IPs)
