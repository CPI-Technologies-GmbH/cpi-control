.PHONY: build build-linux test clean

BINARY_NAME=opsboard-agent
VERSION=1.0.0

build:
	go build -ldflags "-X main.Version=$(VERSION)" -o bin/$(BINARY_NAME) ./cmd/agent

build-linux:
	GOOS=linux GOARCH=amd64 go build -ldflags "-X main.Version=$(VERSION)" -o bin/$(BINARY_NAME)-linux-amd64 ./cmd/agent

test:
	go test ./... -v

clean:
	rm -rf bin/
