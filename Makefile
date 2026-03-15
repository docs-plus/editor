.PHONY: dev dev-next dev-hocus build start lint check test test-watch test-fuzz test-e2e test-load test-stress test-soak test-soak-quick test-yjs-soak

dev: ## Start Next.js and Hocuspocus dev servers in parallel
	@$(MAKE) -j2 dev-next dev-hocus

dev-next: ## Start Next.js dev server
	bun next dev

dev-hocus: ## Start Hocuspocus WebSocket + SQLite server
	bunx @hocuspocus/cli --port 1234 --sqlite db.sqlite

build: ## Build for production
	bun next build

start: ## Start production server
	bun next start

lint: ## Run ESLint
	bun eslint .

check: ## Run Biome check
	bun biome check .

test: ## Run Vitest unit tests
	bun run test

test-watch: ## Run Vitest in watch mode
	bun run test:watch

test-fuzz: ## Run fuzz test suite
	bun run test:fuzz

test-e2e: ## Run Playwright E2E tests
	bun run test:e2e

test-load: ## Run Yjs concurrency load test
	bun tests/load/yjs-load-harness.ts

test-stress: ## Run headless stress probe
	bun run test:stress

test-soak: ## Run full soak test suite (default 30 min)
	bun run test:soak

test-soak-quick: ## Run 5-minute quick soak
	bun run test:soak:quick

test-yjs-soak: ## Run Yjs soak scenarios (TDD)
	bun run test:yjs-soak
