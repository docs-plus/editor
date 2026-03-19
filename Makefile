.PHONY: dev dev-next dev-hocus build start lint check test test-watch test-fuzz test-e2e test-perf test-perf-collab test-load test-stress test-soak test-soak-quick test-soak-collab test-soak-collab-quick test-yjs-soak test-reports-dir

dev: ## Start Next.js and Hocuspocus dev servers in parallel
	@$(MAKE) -j2 dev-next dev-hocus

dev-next: ## Start Next.js dev server
	bun next dev

dev-hocus: ## Start Hocuspocus WebSocket + SQLite server (custom bootstrap)
	HOCUS_PORT=1234 DB_PATH=db.sqlite bun run hocus

build: ## Build for production
	bun next build

start: ## Start production server
	bun next start

lint: ## Run ESLint
	bun eslint .

check: ## Run Biome check
	bun biome check .

test-reports-dir:
	@mkdir -p test-reports

test: test-reports-dir ## Run Vitest unit tests
	VITEST_REPORT_FILE=test-reports/unit-report.json bun run test

test-watch: ## Run Vitest in watch mode
	bun run test:watch

test-fuzz: test-reports-dir ## Run fuzz test suite
	VITEST_REPORT_FILE=test-reports/fuzz-report.json bun run test:fuzz

test-e2e: test-reports-dir ## Run Playwright E2E tests
	PLAYWRIGHT_REPORT_FILE=test-reports/e2e-report.json bun run test:e2e

test-perf: test-reports-dir ## Run typing latency tests (PERF_HEADINGS=10,50,200; PERF_SHAPE=flat|deep|mixed)
	PERF_HEADINGS="$(PERF_HEADINGS)" PERF_SHAPE="$(PERF_SHAPE)" bun run test:perf

test-perf-collab: test-reports-dir ## Run multi-user typing latency (PERF_COLLAB_USERS=2; PERF_COLLAB_HEADINGS=50; PERF_COLLAB_SHAPE=flat|deep|mixed)
	PERF_COLLAB_USERS="$(PERF_COLLAB_USERS)" PERF_COLLAB_HEADINGS="$(PERF_COLLAB_HEADINGS)" PERF_COLLAB_SHAPE="$(PERF_COLLAB_SHAPE)" bun run test:perf-collab

test-load: test-reports-dir ## Run Yjs concurrency load test (LOAD_CLIENTS, LOAD_DURATION, LOAD_RATE, LOAD_SCENARIO)
	LOAD_CLIENTS="$(LOAD_CLIENTS)" LOAD_DURATION="$(LOAD_DURATION)" LOAD_RATE="$(LOAD_RATE)" LOAD_SCENARIO="$(LOAD_SCENARIO)" bun tests/load/yjs-load-harness.ts

test-stress: test-reports-dir ## Run headless stress probe
	VITEST_REPORT_FILE=test-reports/stress-report.json bun run test:stress

test-soak: test-reports-dir ## Run full soak test suite (SOAK_DURATION, SOAK_HEADINGS, SOAK_MEMORY_GROWTH_LIMIT)
	PLAYWRIGHT_REPORT_FILE=test-reports/soak-playwright-report.json SOAK_DURATION="$(SOAK_DURATION)" SOAK_HEADINGS="$(SOAK_HEADINGS)" SOAK_MEMORY_GROWTH_LIMIT="$(SOAK_MEMORY_GROWTH_LIMIT)" bun run test:soak

test-soak-quick: test-reports-dir ## Run 5-minute quick soak
	PLAYWRIGHT_REPORT_FILE=test-reports/soak-quick-playwright-report.json SOAK_DURATION="$(SOAK_DURATION)" SOAK_HEADINGS="$(SOAK_HEADINGS)" bun run test:soak:quick

test-soak-collab: test-reports-dir ## Run multi-user soak (SOAK_USERS, SOAK_DURATION, SOAK_HEADINGS)
	PLAYWRIGHT_REPORT_FILE=test-reports/soak-collab-playwright-report.json SOAK_USERS="$(SOAK_USERS)" SOAK_DURATION="$(SOAK_DURATION)" SOAK_HEADINGS="$(SOAK_HEADINGS)" bun run test:soak:collab

test-soak-collab-quick: test-reports-dir ## Run quick multi-user soak (30s, 3 users, 10 headings)
	PLAYWRIGHT_REPORT_FILE=test-reports/soak-collab-quick-playwright-report.json SOAK_USERS="$(SOAK_USERS)" SOAK_DURATION="$(SOAK_DURATION)" SOAK_HEADINGS="$(SOAK_HEADINGS)" bun run test:soak:collab:quick

test-yjs-soak: test-reports-dir ## Run Yjs soak scenarios (TDD)
	PLAYWRIGHT_REPORT_FILE=test-reports/yjs-soak-report.json bun run test:yjs-soak
