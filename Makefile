.PHONY: dev dev-next dev-hocus build start lint check

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
