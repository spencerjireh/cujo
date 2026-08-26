# Local development helpers for the Cujo / TrueForge stack.
# These target LOCAL runs only; the deploy uses docker-compose.yml directly
# and never uses this file or docker-compose.local.yml.

COMPOSE := docker compose -f docker-compose.yml -f docker-compose.local.yml

.PHONY: help up-local up-local-d down logs ps clean

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
