/**
 * Deploy NFT + Staking + Initial Launch ecosystem (whitepaper §6, §7, §8).
 *
 * Initial allocation (whitepaper §5): 60% Presale → transfer 600M TCGV to InitialLaunch for vesting claims.
 *
 * Prerequisites: TCGV, USDC, and TCGNexusToken addresses.
 *
 * Order:
 * 1. TCGVaultStakingVault(TCGV)
 * 2. TCGVaultBasicNFT(stakingVault)
 * 3. setMinStakeForBasicNFT, setBasicNFTContract on vault
 * 4. TCGVaultFounderNFT(usdc, nexusToken, caspUsdcRecipient) — env: CASP_USDC_ADDRESS (fallback: TREASURY_ADDRESS or deployer)
 * 5. TCGVaultInitialLaunch(tcgv, usdc, founderNFT, nexusToken, treasury) — env: TREASURY_ADDRESS (fallback: CASP_USDC_ADDRESS or deployer)
 * 6. nexus.setPresaleMinter(founderNFT), nexus.setPresaleMinter(initialLaunch)
 * 7. Transfer 600M TCGV (60% of supply) to InitialLaunch for presale vesting claims
 *
 * Usage:
 *   TCGV_ADDRESS=... USDC_ADDRESS=... NEXUS_ADDRESS=... yarn hardhat run scripts/deployTCGVaultNFTAndLaunch.ts --network <network>
 */

import hre from "hardhat";
import { parseEther } from "viem";

async function main() {
  const { viem } = await hre.network.connect();
  const [deployer] = await viem.getWalletClients();
  const tcgvAddress = (process.env.TCGV_ADDRESS || process.env.TOKEN_ADDRESS) as `0x${string}`;
  const usdcAddress = (process.env.USDC_ADDRESS || process.env.STABLECOIN_ADDRESS) as `0x${string}`;
  const nexusAddress = process.env.NEXUS_ADDRESS as `0x${string}`;
  const caspUsdcRecipient = (process.env.CASP_USDC_ADDRESS || deployer.account.address) as `0x${string}`;
  const treasury = (process.env.TREASURY_ADDRESS || caspUsdcRecipient) as `0x${string}`;

  if (!tcgvAddress || !usdcAddress || !nexusAddress) {
    throw new Error("Set TCGV_ADDRESS, USDC_ADDRESS, and NEXUS_ADDRESS");
  }

  console.log("Deployer:", deployer.account.address);
  console.log("TCGV:", tcgvAddress);
  console.log("USDC:", usdcAddress);
  console.log("NEXUS:", nexusAddress);
  console.log("InitialLaunch treasury (USDC / CASP):", treasury);
  console.log("FounderNFT CASP USDC recipient:", caspUsdcRecipient);

  const vault = await viem.deployContract("TCGVaultStakingVault", [tcgvAddress], { client: { wallet: deployer } });
  console.log("TCGVaultStakingVault:", vault.address);

  const basicNFT = await viem.deployContract("TCGVaultBasicNFT", [vault.address], { client: { wallet: deployer } });
  console.log("TCGVaultBasicNFT:", basicNFT.address);

  const minShares = parseEther("5000");
  await vault.write.setMinStakeForBasicNFT([minShares], { account: deployer.account });
  await vault.write.setBasicNFTContract([basicNFT.address], { account: deployer.account });
  console.log("Min stake for Basic NFT set (5000 TCGV)");

  const founderNFT = await viem.deployContract(
    "TCGVaultFounderNFT",
    [usdcAddress, nexusAddress, caspUsdcRecipient],
    { client: { wallet: deployer } },
  );
  console.log("TCGVaultFounderNFT:", founderNFT.address);

  const initialLaunch = await viem.deployContract("TCGVaultInitialLaunch", [
    tcgvAddress,
    usdcAddress,
    founderNFT.address,
    nexusAddress,
    treasury,
  ], { client: { wallet: deployer } });
  console.log("TCGVaultInitialLaunch:", initialLaunch.address);

  const nexus = await viem.getContractAt("TCGNexusToken", nexusAddress);
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
