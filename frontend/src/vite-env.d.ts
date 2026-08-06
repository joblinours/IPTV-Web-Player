/// <reference types="vite/client" />

// Injected at build time via vite.config.ts `define` (see build-args in
// frontend/Dockerfile and .github/workflows/docker-publish.yml).
declare const __APP_VERSION__: string;
declare const __GIT_COMMIT__: string;
