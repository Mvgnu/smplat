# Loyalty server bridge

Utilities in this folder call the FastAPI loyalty endpoints on behalf of the
Next.js application. Keep functions focused on data transport and reuse them
from API routes or server components instead of fetching from the client.
