/**
 * Coverage-only config: single Solidity 0.8.27 compiler so Hardhat's coverage
 * library compiles correctly. Use with: yarn coverage (which excludes fork-only
 * contracts before running).
 */
import { configVariable, defineConfig } from "hardhat/config";
import hardhatViem from "@nomicfoundation/hardhat-viem";
import hardhatViemAssertions from "@nomicfoundation/hardhat-viem-assertions";
import hardhatNodeTestRunner from "@nomicfoundation/hardhat-node-test-runner";
import hardhatNetworkHelpers from "@nomicfoundation/hardhat-network-helpers";

export default defineConfig({
  plugins: [
    hardhatViem,
    hardhatViemAssertions,
    hardhatNodeTestRunner,
    hardhatNetworkHelpers,
  ],
  solidity: {
    version: "0.8.27",
    settings: { optimizer: { enabled: true }, evmVersion: "cancun" as const },
  },
  networks: {
    hardhat: {
      type: "edr-simulated",
      chainType: "l1",
    },
    localhost: {
      type: "http",
      chainType: "l1",
      url: "http://localhost:8545",
      chainId: 56,
      accounts: "remote",
    },
    mainnet: {
      type: "http",
      chainType: "l1",
      url: configVariable("MAINNET_RPC_URL"),
      chainId: 1,
      accounts: [configVariable("TCG_KEY")],
    },
    holesky: {
      type: "http",
      chainType: "l1",
      url: configVariable("HOLESKY_RPC_URL"),
      chainId: 17000,
      accounts: [configVariable("TCG_KEY")],
    },
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC_URL"),
      chainId: 11155111,
      gasPrice: "auto",
      accounts: [configVariable("TCG_KEY")],
    },
    gnosis: {
      type: "http",
      chainType: "l1",
      url: configVariable("GNOSIS_RPC_URL"),
      chainId: 100,
      gasPrice: "auto",
      accounts: [configVariable("TCG_KEY")],
    },
    sokol: {
      type: "http",
      chainType: "l1",
      url: configVariable("SOKOL_RPC_URL"),
      chainId: 77,
      gasPrice: "auto",
      accounts: [configVariable("TCG_KEY")],
    },
    bsc: {
      type: "http",
      chainType: "l1",
      url: configVariable("BSC_RPC_URL"),
      chainId: 56,
      gasPrice: "auto",
      accounts: [configVariable("TCG_KEY")],
    },
    bsctest: {
      type: "http",
      chainType: "l1",
      url: configVariable("BSCTEST_RPC_URL"),
      chainId: 97,
      gasPrice: "auto",
      accounts: [configVariable("TCG_KEY")],
    },
    arbitrum: {
      type: "http",
      chainType: "l1",
      url: configVariable("ARBITRUM_RPC_URL"),
      chainId: 42161,
      gasPrice: "auto",
      accounts: [configVariable("TCG_KEY")],
    },
    arbitrumsepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("ARBITRUM_SEPOLIA_RPC_URL"),
      chainId: 421614,
      gasPrice: "auto",
      accounts: [configVariable("TCG_KEY")],
    },
  },
});
