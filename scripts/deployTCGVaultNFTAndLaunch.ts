/**
 * Deploy NFT + Staking + Initial Launch ecosystem (whitepaper §6, §7).
 *
 * Prerequisites: TCGV, USDC, and TCGNexusToken addresses.
 *
 * Order:
 * 1. TCGVaultStakingVault(TCGV)
 * 2. TCGVaultBasicNFT(stakingVault)
 * 3. setMinStakeForBasicNFT, setBasicNFTContract on vault
 * 4. TCGVaultFounderNFT(usdc, nexusToken, treasury)
 * 5. TCGVaultInitialLaunch(tcgv, usdc, founderNFT, nexusToken, treasury)
 * 6. nexus.setPresaleMinter(founderNFT), nexus.setPresaleMinter(initialLaunch)
 * 7. Transfer 600M TCGV to InitialLaunch for vesting claims
 *
 * Usage:
 *   TCGV_ADDRESS=... USDC_ADDRESS=... NEXUS_ADDRESS=... yarn hardhat run scripts/deployTCGVaultNFTAndLaunch.ts --network <network>
 */

import * as hre from "hardhat";
import { parseEther } from "viem";

async function main() {
  const [deployer] = await hre.viem.getWalletClients();
  const tcgvAddress = (process.env.TCGV_ADDRESS || process.env.TOKEN_ADDRESS) as `0x${string}`;
  const usdcAddress = (process.env.USDC_ADDRESS || process.env.STABLECOIN_ADDRESS) as `0x${string}`;
  const nexusAddress = process.env.NEXUS_ADDRESS as `0x${string}`;
  const treasury = (process.env.TREASURY_ADDRESS || deployer.account.address) as `0x${string}`;

  if (!tcgvAddress || !usdcAddress || !nexusAddress) {
    throw new Error("Set TCGV_ADDRESS, USDC_ADDRESS, and NEXUS_ADDRESS");
  }

  console.log("Deployer:", deployer.account.address);
  console.log("TCGV:", tcgvAddress);
  console.log("USDC:", usdcAddress);
  console.log("NEXUS:", nexusAddress);
  console.log("Treasury:", treasury);

  const vault = await hre.viem.deployContract("TCGVaultStakingVault", [tcgvAddress], { account: deployer.account });
  console.log("TCGVaultStakingVault:", vault.address);

  const basicNFT = await hre.viem.deployContract("TCGVaultBasicNFT", [vault.address], { account: deployer.account });
  console.log("TCGVaultBasicNFT:", basicNFT.address);

  const minShares = parseEther("5000");
  await vault.write.setMinStakeForBasicNFT([minShares], { account: deployer.account });
  await vault.write.setBasicNFTContract([basicNFT.address], { account: deployer.account });
  console.log("Min stake for Basic NFT set (5000 TCGV)");

  const founderNFT = await hre.viem.deployContract("TCGVaultFounderNFT", [usdcAddress, nexusAddress, treasury], { account: deployer.account });
  console.log("TCGVaultFounderNFT:", founderNFT.address);

  const initialLaunch = await hre.viem.deployContract("TCGVaultInitialLaunch", [
    tcgvAddress,
    usdcAddress,
    founderNFT.address,
    nexusAddress,
    treasury,
  ], { account: deployer.account });
  console.log("TCGVaultInitialLaunch:", initialLaunch.address);

  const nexus = await hre.viem.getContractAt("TCGNexusToken", nexusAddress);
  await nexus.write.setPresaleMinter([founderNFT.address, true], { account: deployer.account });
  await nexus.write.setPresaleMinter([initialLaunch.address, true], { account: deployer.account });
  console.log("NEXUS: set PresaleMinter for Founder NFT and Initial Launch");

  console.log("\n--- Summary ---");
  console.log("StakingVault:", vault.address);
  console.log("BasicNFT:", basicNFT.address);
  console.log("FounderNFT:", founderNFT.address);
  console.log("InitialLaunch:", initialLaunch.address);
  console.log("\nNext: Transfer up to 600_000_000 TCGV to InitialLaunch for presale claims.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
