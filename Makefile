.PHONY: dev dev-next dev-hocus build start lint check test test-watch test-fuzz test-e2e test-perf test-perf-collab test-load test-stress test-soak test-soak-quick test-soak-collab test-soak-collab-quick test-yjs-soak

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

test-perf: ## Run typing latency tests (PERF_HEADINGS=10,50,200; PERF_SHAPE=flat|deep|mixed)
	PERF_HEADINGS="$(PERF_HEADINGS)" PERF_SHAPE="$(PERF_SHAPE)" bun run test:perf

test-perf-collab: ## Run multi-user typing latency (PERF_COLLAB_USERS=2; PERF_COLLAB_HEADINGS=50; PERF_COLLAB_SHAPE=flat|deep|mixed)
	PERF_COLLAB_USERS="$(PERF_COLLAB_USERS)" PERF_COLLAB_HEADINGS="$(PERF_COLLAB_HEADINGS)" PERF_COLLAB_SHAPE="$(PERF_COLLAB_SHAPE)" bun run test:perf-collab

test-load: ## Run Yjs concurrency load test
	bun tests/load/yjs-load-harness.ts

test-stress: ## Run headless stress probe
	bun run test:stress

test-soak: ## Run full soak test suite (default 30 min)
	bun run test:soak

test-soak-quick: ## Run 5-minute quick soak
	bun run test:soak:quick

test-soak-collab: ## Run multi-user collaboration soak (default 30 min, 3 users)
	bun run test:soak:collab

test-soak-collab-quick: ## Run quick multi-user collaboration soak (30s, 3 users, 10 headings)
	bun run test:soak:collab:quick

test-yjs-soak: ## Run Yjs soak scenarios (TDD)
	bun run test:yjs-soak
