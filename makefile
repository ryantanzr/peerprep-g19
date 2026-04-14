.PHONY: start pull stop

start:
	docker compose build --no-cache
	docker compose up

pull:
	docker compose pull

stop:
	docker compose down
