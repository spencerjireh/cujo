# Local development helpers for the Cujo / TrueForge stack.
# These target LOCAL runs only; the deploy uses docker-compose.yml directly
# and never uses this file or docker-compose.local.yml.

COMPOSE := docker compose -f docker-compose.yml -f docker-compose.local.yml
# The harness contract tests get their own project and overlay so they never
# touch a running local stack.
COMPOSE_INT := docker compose -p cujo-int -f docker-compose.yml -f docker-compose.test.yml

.PHONY: help up-local up-local-d down logs ps clean test-int test-int-up test-int-down

help: ## Show this help
	@grep -E '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

up-local: ## Build and run the full stack locally, ports published to the host
	$(COMPOSE) up --build

up-local-d: ## Same as up-local, detached
	$(COMPOSE) up --build -d

down: ## Stop the local stack (keeps the pgdata volume)
	$(COMPOSE) down

logs: ## Follow logs from the local stack
	$(COMPOSE) logs -f

ps: ## Show local stack status
	$(COMPOSE) ps

clean: ## Stop the local stack and delete its volumes (drops the database)
	$(COMPOSE) down -v

test-int-up: ## Start the TrueForge server and github-mcp for the contract tests
	$(COMPOSE_INT) up -d --build --wait server github-mcp

test-int: test-int-up ## Run the harness contract tests against that stack
	cd apps/cujo && TRUEFORGE_BASE_URL=http://127.0.0.1:8790 pnpm test:int

test-int-down: ## Stop the contract-test stack and drop its volumes
	$(COMPOSE_INT) down -v
