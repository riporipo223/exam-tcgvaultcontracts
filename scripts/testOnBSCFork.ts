import { ethers } from "hardhat";

/**
 * Test script for TCG Vault Token on BSC fork
 * 
 * This script:
 * 1. Deploys all contracts (TCGVaultToken, TCGNexusToken, TCGVaultBuyRouter, TCGVaultLiquidityWrapper)
 * 2. Creates/get pair on PancakeSwap
 * 3. Adds liquidity via wrapper
 * 4. Tests buy through PancakeSwap router
 * 5. Tests buy through TCGVaultBuyRouter (BNB fee path)
 * 6. Tests direct pair swap (non-router path)
 * 7. Tests sell through PancakeSwap router
 * 
 * Usage:
 *   npx hardhat run scripts/testOnBSCFork.ts --network hardhat
 * 
 * For BSC fork, configure hardhat.network.ts:
 *   networks.hardhat = {
 *     forking: {
 *       url: "https://bsc-dataseed.binance.org/",
 *       blockNumber: <block_number>
 *     },
 *     hardfork: 'cancun'
 *   };
 */

const PANCAKE_ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
const PANCAKE_FACTORY = "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73"; // PancakeSwap V2 Factory
const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"; // WBNB on BSC

// PancakeSwap Router ABI (minimal)
const PANCAKE_ROUTER_ABI = [
  "function factory() external pure returns (address)",
  "function WETH() external pure returns (address)",
  "function addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity)",
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external payable",
  "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external",
  "function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)"
];

// PancakeSwap Factory ABI (minimal)
const PANCAKE_FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)",
  "function createPair(address tokenA, address tokenB) external returns (address pair)"
];

// PancakeSwap Pair ABI (minimal)
const PANCAKE_PAIR_ABI = [
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external",
  "function sync() external"
];

async function main() {
  const [deployer, trader] = await ethers.getSigners();
  
  console.log("=".repeat(80));
  console.log("TCG Vault Token - BSC Fork Test Script");
  console.log("=".repeat(80));
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Deployer balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} BNB`);
  console.log(`Trader: ${trader.address}`);
  console.log(`Trader balance: ${ethers.formatEther(await ethers.provider.getBalance(trader.address))} BNB`);
  console.log();

  // Get PancakeSwap router and factory
  const pancakeRouter = await ethers.getContractAt(PANCAKE_ROUTER_ABI, PANCAKE_ROUTER);
  const pancakeFactory = await ethers.getContractAt(PANCAKE_FACTORY_ABI, PANCAKE_FACTORY);
  const wbnbAddress = await pancakeRouter.WETH();
  console.log(`PancakeSwap Router: ${PANCAKE_ROUTER}`);
  console.log(`PancakeSwap Factory: ${PANCAKE_FACTORY}`);
  console.log(`WBNB: ${wbnbAddress}`);
  console.log();

  // Step 1: Deploy TCGVaultToken
  console.log("1. Deploying TCGVaultToken...");
  const TCGVaultToken = await ethers.getContractFactory("TCGVaultToken");
  const token = await TCGVaultToken.deploy(
    PANCAKE_ROUTER,
    deployer.address, // vault
    deployer.address, // marketing
    deployer.address, // community
    ethers.ZeroAddress, // nexusToken (set later)
    ethers.ZeroAddress // stablecoin
  );
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log(`   ✓ TCGVaultToken deployed: ${tokenAddress}`);
  console.log(`   Total supply: ${ethers.formatEther(await token.totalSupply())} TCGV`);
  console.log();

  // Step 2: Deploy TCGNexusToken
  console.log("2. Deploying TCGNexusToken...");
  const TCGNexusToken = await ethers.getContractFactory("TCGNexusToken");
  const nexusToken = await TCGNexusToken.deploy(tokenAddress);
  await nexusToken.waitForDeployment();
  const nexusTokenAddress = await nexusToken.getAddress();
  console.log(`   ✓ TCGNexusToken deployed: ${nexusTokenAddress}`);
  console.log();

  // Step 3: Set Nexus token on TCGVaultToken
  console.log("3. Setting Nexus token on TCGVaultToken...");
  await token.setAddresses(
    deployer.address, // vault
    deployer.address, // marketing
    deployer.address, // community
    nexusTokenAddress,
    ethers.ZeroAddress // stablecoin
  );
  console.log("   ✓ Nexus token set");
  console.log();

  // Step 4: Deploy TCGVaultBuyRouter
  console.log("4. Deploying TCGVaultBuyRouter...");
  const TCGVaultBuyRouter = await ethers.getContractFactory("TCGVaultBuyRouter");
  const buyRouter = await TCGVaultBuyRouter.deploy(
    PANCAKE_ROUTER,
    tokenAddress,
    deployer.address, // vault
    deployer.address // marketing
  );
  await buyRouter.waitForDeployment();
  const buyRouterAddress = await buyRouter.getAddress();
  console.log(`   ✓ TCGVaultBuyRouter deployed: ${buyRouterAddress}`);
  
  // Set buy router on token
  await token.setBuyRouter(buyRouterAddress);
  console.log("   ✓ Buy router set on token");
  console.log();

  // Step 5: Deploy TCGVaultLiquidityWrapper
  console.log("5. Deploying TCGVaultLiquidityWrapper...");
  const TCGVaultLiquidityWrapper = await ethers.getContractFactory("TCGVaultLiquidityWrapper");
  const wrapper = await TCGVaultLiquidityWrapper.deploy(PANCAKE_ROUTER);
  await wrapper.waitForDeployment();
  const wrapperAddress = await wrapper.getAddress();
  console.log(`   ✓ TCGVaultLiquidityWrapper deployed: ${wrapperAddress}`);
  
  // Exclude wrapper from fees
  await token.setExcludedFromFees(wrapperAddress, true);
  console.log("   ✓ Wrapper excluded from fees");
  console.log();

  // Step 6: Create/get pair
  console.log("6. Creating/getting PancakeSwap pair...");
  let pairAddress = await pancakeFactory.getPair(tokenAddress, wbnbAddress);
  
  if (pairAddress === ethers.ZeroAddress) {
    console.log("   Pair doesn't exist, creating...");
    const createTx = await pancakeFactory.createPair(tokenAddress, wbnbAddress);
    await createTx.wait();
    pairAddress = await pancakeFactory.getPair(tokenAddress, wbnbAddress);
    console.log(`   ✓ Pair created: ${pairAddress}`);
  } else {
    console.log(`   ✓ Pair already exists: ${pairAddress}`);
  }
  
  // Set pair on token
  await token.setPair(pairAddress);
  console.log("   ✓ Pair set on token");
  console.log();

  // Step 7: Add liquidity via wrapper
  console.log("7. Adding liquidity via wrapper...");
  const tokenAmount = ethers.parseEther("1000000"); // 1M TCGV
  const ethAmount = ethers.parseEther("10"); // 10 BNB
  
  await token.approve(wrapperAddress, tokenAmount);
  const addLiqTx = await wrapper.addLiquidityETH(
    tokenAddress,
    tokenAmount,
    0,
    0,
    deployer.address,
    Math.floor(Date.now() / 1000) + 300,
    { value: ethAmount }
  );
  await addLiqTx.wait();
  console.log(`   ✓ Added liquidity: ${ethers.formatEther(tokenAmount)} TCGV + ${ethers.formatEther(ethAmount)} BNB`);
  
  // Check pair reserves
  const pair = await ethers.getContractAt(PANCAKE_PAIR_ABI, pairAddress);
  const [reserve0, reserve1] = await pair.getReserves();
  const token0 = await pair.token0();
  const isToken0TCGV = token0.toLowerCase() === tokenAddress.toLowerCase();
  const tcgvReserve = isToken0TCGV ? reserve0 : reserve1;
  const wbnbReserve = isToken0TCGV ? reserve1 : reserve0;
  console.log(`   Pair reserves: ${ethers.formatEther(tcgvReserve)} TCGV / ${ethers.formatEther(wbnbReserve)} WBNB`);
  console.log();

  // Step 8: Test buy through PancakeSwap router (regular swap)
  console.log("8. Testing buy through PancakeSwap router...");
  const buyAmountBNB = ethers.parseEther("0.1"); // 0.1 BNB
  
  const traderBalanceBefore = await token.balanceOf(trader.address);
  const vaultBalanceBefore = await token.balanceOf(deployer.address);
  const totalSupplyBefore = await token.totalSupply();
  
  const path = [wbnbAddress, tokenAddress];
  let minAmountOut: bigint;
  try {
    const amountsOut = await pancakeRouter.getAmountsOut(buyAmountBNB, path);
    // getAmountsOut does not account for fee-on-transfer (our 15% buy tax), so actual output is ~85%. Use 50% of raw to be safe.
    minAmountOut = amountsOut[1] > 0n ? (amountsOut[1] * 50n / 100n) : 0n;
  } catch {
    minAmountOut = 0n; // pair may not exist or view fails on fork
  }

  const deadline = Math.floor(Date.now() / 1000) + 300;
  const swapCalldata = pancakeRouter.interface.encodeFunctionData("swapExactETHForTokensSupportingFeeOnTransferTokens", [
    minAmountOut,
    path,
    trader.address,
    deadline,
  ]);
  const swapTx = await trader.sendTransaction({
    to: PANCAKE_ROUTER,
    data: swapCalldata,
    value: buyAmountBNB,
  });
  const swapReceipt = await swapTx.wait();
  if (!swapReceipt || swapReceipt.status === 0) {
    throw new Error(`Router swap reverted. Receipt: ${JSON.stringify(swapReceipt)}`);
  }
  
  const traderBalanceAfter = await token.balanceOf(trader.address);
  const vaultBalanceAfter = await token.balanceOf(deployer.address);
  const totalSupplyAfter = await token.totalSupply();
  const nexusBalance = await nexusToken.balanceOf(trader.address);
  
  console.log(`   ✓ Swap completed`);
  console.log(`   Trader received: ${ethers.formatEther(traderBalanceAfter - traderBalanceBefore)} TCGV`);
  console.log(`   Vault received: ${ethers.formatEther(vaultBalanceAfter - vaultBalanceBefore)} TCGV`);
  console.log(`   Total supply change: ${ethers.formatEther(totalSupplyBefore - totalSupplyAfter)} TCGV (burned)`);
  console.log(`   NEXUS cashback: ${ethers.formatEther(nexusBalance)} NEXUS`);
  console.log();

  // Step 9: Test buy through TCGVaultBuyRouter (BNB fee path)
  console.log("9. Testing buy through TCGVaultBuyRouter (BNB fee path)...");
  const buyRouterAmountBNB = ethers.parseEther("0.2"); // 0.2 BNB
  
  const traderBalanceBefore2 = await token.balanceOf(trader.address);
  const vaultBNBBefore = await ethers.provider.getBalance(deployer.address);
  const nexusBalanceBefore2 = await nexusToken.balanceOf(trader.address);
  
  const buyRouterTx = await buyRouter.connect(trader).buyTCGVWithBNB(
    minAmountOut,
    deadline,
    { value: buyRouterAmountBNB }
  );
  await buyRouterTx.wait();
  
  const traderBalanceAfter2 = await token.balanceOf(trader.address);
  const vaultBNBAfter = await ethers.provider.getBalance(deployer.address);
  const nexusBalanceAfter2 = await nexusToken.balanceOf(trader.address);
  
  console.log(`   ✓ Buy completed`);
  console.log(`   Trader received: ${ethers.formatEther(traderBalanceAfter2 - traderBalanceBefore2)} TCGV`);
  console.log(`   Vault received BNB: ${ethers.formatEther(vaultBNBAfter - vaultBNBBefore)} BNB`);
  console.log(`   NEXUS cashback: ${ethers.formatEther(nexusBalanceAfter2 - nexusBalanceBefore2)} NEXUS`);
  console.log();

  // Step 10: Test direct pair swap (non-router path)
  console.log("10. Testing direct pair swap (non-router path)...");
  
  // Get WBNB contract
  const WBNB_ABI = [
    "function deposit() external payable",
    "function transfer(address to, uint256 amount) external returns (bool)",
    "function balanceOf(address account) external view returns (uint256)",
    "function approve(address spender, uint256 amount) external returns (bool)"
  ];
  const wbnb = await ethers.getContractAt(WBNB_ABI, wbnbAddress);
  
  // Trader deposits BNB to get WBNB
  const directSwapBNB = ethers.parseEther("0.05");
  await wbnb.connect(trader).deposit({ value: directSwapBNB });
  
  const traderBalanceBefore3 = await token.balanceOf(trader.address);
  const totalSupplyBefore3 = await token.totalSupply();
  
  // Get current reserves
  const [reserve0After, reserve1After] = await pair.getReserves();
  const tcgvReserveAfter = isToken0TCGV ? reserve0After : reserve1After;
  const wbnbReserveAfter = isToken0TCGV ? reserve1After : reserve0After;
  
  // Calculate amount out using Uniswap V2 formula; request 99.5% to avoid INSUFFICIENT_LIQUIDITY from pair rounding
  const amountInWithFee = directSwapBNB * 997n;
  const numerator = amountInWithFee * tcgvReserveAfter;
  const denominator = wbnbReserveAfter * 1000n + amountInWithFee;
  const amountOutRaw = numerator / denominator;
  const amountOut = amountOutRaw > 0n ? (amountOutRaw * 995n / 1000n) : 0n;
  
  const amount0Out = isToken0TCGV ? 0n : amountOut;
  const amount1Out = isToken0TCGV ? amountOut : 0n;
  
  // Transfer WBNB to pair first
  await wbnb.connect(trader).transfer(pairAddress, directSwapBNB);
  
  // #region agent log
  const wbnbBalAfterTransfer = await wbnb.balanceOf(pairAddress);
  const tcgvBalAfterTransfer = await token.balanceOf(pairAddress);
  fetch('http://127.0.0.1:7242/ingest/96ab5b6d-b284-45a4-aa10-24fc455f9454',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'testOnBSCFork.ts:directPairSwap',message:'before pair swap',data:{pairAddress,amount0Out:amount0Out.toString(),amount1Out:amount1Out.toString(),isToken0TCGV,directSwapBNB:directSwapBNB.toString(),wbnbBalPair:wbnbBalAfterTransfer.toString(),tcgvBalPair:tcgvBalAfterTransfer.toString()},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
  // #endregion
  
  // Then swap: encode with standalone Interface so data is never stripped (ethers contract binding on fork can yield empty data)
  const pairInterface = new ethers.Interface(PANCAKE_PAIR_ABI);
  const pairSwapCalldata = pairInterface.encodeFunctionData("swap", [
    amount0Out,
    amount1Out,
    trader.address,
    "0x",
  ]);
  if (!pairSwapCalldata || pairSwapCalldata.length < 10) {
    throw new Error(`swap calldata invalid: length=${pairSwapCalldata?.length ?? 0}`);
  }
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/96ab5b6d-b284-45a4-aa10-24fc455f9454',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'testOnBSCFork.ts:directPairSwap',message:'swap calldata built',data:{calldataLength:pairSwapCalldata.length,calldataPrefix:pairSwapCalldata.substring(0,10)},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
  // #endregion

  const directSwapTx = await trader.sendTransaction({
    to: pairAddress,
    data: pairSwapCalldata as `0x${string}`,
    value: 0n,
  });
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/96ab5b6d-b284-45a4-aa10-24fc455f9454',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'testOnBSCFork.ts:directPairSwap',message:'tx sent',data:{hash:directSwapTx.hash,to:directSwapTx.to,dataLength:directSwapTx.data?.length||0},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
  // #endregion
  
  let receipt;
  try {
    receipt = await directSwapTx.wait();
  } catch (err: any) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/96ab5b6d-b284-45a4-aa10-24fc455f9454',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'testOnBSCFork.ts:directPairSwap',message:'tx wait failed',data:{error:err?.message||String(err),receipt:err?.receipt?{status:err.receipt.status,gasUsed:err.receipt.gasUsed?.toString()}:null},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
    // #endregion
    throw err;
  }
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/96ab5b6d-b284-45a4-aa10-24fc455f9454',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'testOnBSCFork.ts:directPairSwap',message:'tx confirmed',data:{status:receipt.status,gasUsed:receipt.gasUsed?.toString()},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
  // #endregion
  
  const traderBalanceAfter3 = await token.balanceOf(trader.address);
  const totalSupplyAfter3 = await token.totalSupply();
  
  console.log(`   ✓ Direct swap completed`);
  console.log(`   Trader received: ${ethers.formatEther(traderBalanceAfter3 - traderBalanceBefore3)} TCGV`);
  console.log(`   Total supply change: ${ethers.formatEther(totalSupplyBefore3 - totalSupplyAfter3)} TCGV (burned)`);
  console.log();

  // Step 11: Test sell through PancakeSwap router
  console.log("11. Testing sell through PancakeSwap router...");
  
  const sellAmount = ethers.parseEther("1000"); // 1000 TCGV
  await token.connect(trader).approve(PANCAKE_ROUTER, sellAmount);
  
  const traderBalanceBefore4 = await token.balanceOf(trader.address);
  const vaultBalanceBefore4 = await token.balanceOf(deployer.address);
  const totalSupplyBefore4 = await token.totalSupply();
  
  const sellPath = [tokenAddress, wbnbAddress];
  const sellDeadline = Math.floor(Date.now() / 1000) + 300;
  const sellCalldata = pancakeRouter.interface.encodeFunctionData("swapExactTokensForETHSupportingFeeOnTransferTokens", [
    sellAmount,
    0n,
    sellPath,
    trader.address,
    sellDeadline,
  ]);
  const sellTx = await trader.sendTransaction({
    to: PANCAKE_ROUTER,
    data: sellCalldata,
    value: 0n,
  });
  await sellTx.wait();
  
  const traderBalanceAfter4 = await token.balanceOf(trader.address);
  const vaultBalanceAfter4 = await token.balanceOf(deployer.address);
  const totalSupplyAfter4 = await token.totalSupply();
  const traderBNBAfter = await ethers.provider.getBalance(trader.address);
  
  console.log(`   ✓ Sell completed`);
  console.log(`   Trader sold: ${ethers.formatEther(traderBalanceBefore4 - traderBalanceAfter4)} TCGV`);
  console.log(`   Vault received: ${ethers.formatEther(vaultBalanceAfter4 - vaultBalanceBefore4)} TCGV`);
  console.log(`   Total supply change: ${ethers.formatEther(totalSupplyBefore4 - totalSupplyAfter4)} TCGV (burned)`);
  console.log();

  // Summary
  console.log("=".repeat(80));
  console.log("Test Summary");
  console.log("=".repeat(80));
  console.log(`TCGVaultToken: ${tokenAddress}`);
  console.log(`TCGNexusToken: ${nexusTokenAddress}`);
  console.log(`TCGVaultBuyRouter: ${buyRouterAddress}`);
  console.log(`TCGVaultLiquidityWrapper: ${wrapperAddress}`);
  console.log(`PancakeSwap Pair: ${pairAddress}`);
  console.log();
  console.log("All tests completed successfully! ✓");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
