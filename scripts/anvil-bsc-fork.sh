#!/usr/bin/env bash
# Run Anvil forking BSC testnet. Use = for options so Docker passes one arg per flag.
docker run --rm -it \
  -p 8545:8545 \
  --entrypoint anvil \
  ghcr.io/foundry-rs/foundry:latest \
  --fork-url "https://bsc-testnet.infura.io/v3/f07f9691b12c446eb2f01bac6aad9f1b" \
  --host 0.0.0.0 \
  --port=8545
