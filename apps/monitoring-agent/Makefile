.PHONY: build build-cli build-linux build-all test clean

BINARY_NAME=opsboard-agent
CLI_BINARY_NAME=cpi-agent-cli
VERSION=0.1.0
LDFLAGS=-ldflags "-X main.Version=$(VERSION)"

build:
	go build $(LDFLAGS) -o bin/$(BINARY_NAME) ./cmd/agent

build-cli:
	go build -o bin/$(CLI_BINARY_NAME) ./cmd/cli

build-linux:
	GOOS=linux GOARCH=amd64 go build $(LDFLAGS) -o bin/$(BINARY_NAME)-linux-amd64 ./cmd/agent

build-all:
	GOOS=linux GOARCH=amd64 go build $(LDFLAGS) -o bin/$(BINARY_NAME)-linux-amd64 ./cmd/agent
	GOOS=linux GOARCH=arm64 go build $(LDFLAGS) -o bin/$(BINARY_NAME)-linux-arm64 ./cmd/agent
	GOOS=darwin GOARCH=amd64 go build $(LDFLAGS) -o bin/$(BINARY_NAME)-darwin-amd64 ./cmd/agent
	GOOS=darwin GOARCH=arm64 go build $(LDFLAGS) -o bin/$(BINARY_NAME)-darwin-arm64 ./cmd/agent
	GOOS=linux GOARCH=amd64 go build -o bin/$(CLI_BINARY_NAME)-linux-amd64 ./cmd/cli
	GOOS=linux GOARCH=arm64 go build -o bin/$(CLI_BINARY_NAME)-linux-arm64 ./cmd/cli
	GOOS=darwin GOARCH=amd64 go build -o bin/$(CLI_BINARY_NAME)-darwin-amd64 ./cmd/cli
	GOOS=darwin GOARCH=arm64 go build -o bin/$(CLI_BINARY_NAME)-darwin-arm64 ./cmd/cli

test:
	go test ./... -v

clean:
	rm -rf bin/
