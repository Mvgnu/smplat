# Auth Service

Provides brute-force lockout tracking backed by Redis counters to prevent automated credential stuffing.

## Capabilities

- Tracks login failure attempts per identifier using configurable rolling windows.
- Exposes helpers to register failures, reset on success, and query lockout TTLs.
- Designed for reuse by FastAPI endpoints and background tasks performing authentication checks.
