package version

// Version and BuildDate are set at build time via ldflags:
//
//	go build -ldflags "-X wansaturator/internal/version.Version=2026.04.01-1
//	                    -X wansaturator/internal/version.BuildDate=2026-04-01T20:00:00Z"
var (
	Version   = "dev"
	BuildDate = "unknown"
)
