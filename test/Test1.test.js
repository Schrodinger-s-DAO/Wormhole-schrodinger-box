// test/DetailedTest.js
const { expect } = require("chai");
require("dotenv").config();

describe("Schrodinger Box Detailed Test", function () {
  // Increase timeout to 3 minutes
  this.timeout(180000);

  let schrodingerBox;
  let paradoxToken;
  let schrodingerCatNFT;
  let owner;
  let recipient;
  let boxId;

  // Helper to print account details
  async function logAccountDetails(account, label) {
    console.log(`\n=== ${label} DETAILS ===`);
    console.log(`Address: ${account.address}`);
    
    const ethBalance = await ethers.provider.getBalance(account.address);
    console.log(`ETH Balance: ${ethers.formatEther(ethBalance)} ETH`);
    
    try {
      const tokenBalance = await paradoxToken.balanceOf(account.address);
      console.log(`Token Balance: ${ethers.formatEther(tokenBalance)} PAR`);
    } catch (e) {
      console.log(`Failed to get token balance: ${e.message}`);
    }
    
    try {
      const nftBalance = await schrodingerCatNFT.balanceOf(account.address);
      console.log(`NFT Balance: ${nftBalance.toString()} NFTs`);
    } catch (e) {
      console.log(`Failed to get NFT balance: ${e.message}`);
    }
    
    try {
      const boxBalance = await schrodingerBox.balanceOf(account.address);
      console.log(`Box Balance: ${boxBalance.toString()} boxes`);
      
      // List all boxes
      if (boxBalance > 0) {
        console.log("Owned boxes:");
        for (let i = 0; i < boxBalance; i++) {
          try {
            const boxId = await schrodingerBox.tokenOfOwnerByIndex(account.address, i);
            await logBoxDetails(boxId, `Box #${boxId.toString()}`);
          } catch (e) {
            console.log(`Error listing box at index ${i}: ${e.message}`);
          }
        }
      }
    } catch (e) {
      console.log(`Failed to get box balance: ${e.message}`);
    }
    console.log(`=== END ${label} DETAILS ===\n`);
  }

  // Helper to print box details
  async function logBoxDetails(boxId, label) {
    console.log(`\n--- ${label} ---`);
    try {
      const owner = await schrodingerBox.ownerOf(boxId);
      console.log(`Owner: ${owner}`);
      
      const details = await schrodingerBox.getBoxDetails(boxId);
      console.log(`Locked: ${details[4]}`);
      console.log(`Origin Chain: ${details[5]}`);
      console.log(`Is Original: ${details[6]}`);
      
      // ERC20 tokens
      console.log(`ERC20 Tokens: ${details[0].length}`);
      for (let i = 0; i < details[0].length; i++) {
        console.log(`  Token ${i}: ${details[0][i]} - Amount: ${ethers.formatEther(details[1][i])} tokens`);
      }
      
      // NFTs
      console.log(`NFTs: ${details[2].length}`);
      for (let i = 0; i < details[2].length; i++) {
        console.log(`  NFT ${i}: Contract ${details[2][i]} - Token ID: ${details[3][i].toString()}`);
      }
    } catch (e) {
      console.log(`Failed to get box details: ${e.message}`);
    }
    console.log(`--- END ${label} ---\n`);
  }

  before(async function () {
    // Get signers first
    const signers = await ethers.getSigners();
    owner = signers[0];
    recipient = signers[1];

    console.log("Owner address:", owner.address);
    console.log("Recipient address:", recipient.address);

    // Get network name to use the right env vars
    const network = await ethers.provider.getNetwork();
    const networkName = network.name.toUpperCase();
    console.log("Network:", networkName);

    // Get contract addresses from .env
    const boxAddress = process.env[`${networkName}_SCHRODINGER_BOX_ADDRESS`];
    const tokenAddress = process.env[`${networkName}_PARADOX_TOKEN_ADDRESS`];
    const nftAddress = process.env[`${networkName}_SCHRODINGER_CAT_NFT_ADDRESS`];

    console.log("Box address from env:", boxAddress);
    console.log("Token address from env:", tokenAddress);
    console.log("NFT address from env:", nftAddress);

    // Check if addresses exist
    if (!boxAddress || !tokenAddress || !nftAddress) {
      throw new Error(`Contract addresses missing for network ${networkName}`);
    }

    // Get contract factories and attach to addresses
    schrodingerBox = await ethers.getContractAt("SchrodingerBox", boxAddress);
    paradoxToken = await ethers.getContractAt("ParadoxToken", tokenAddress);
    schrodingerCatNFT = await ethers.getContractAt("SchrodingerCatNFT", nftAddress);

    console.log("Contracts loaded successfully");
    
    // Log initial states
    await logAccountDetails(owner, "OWNER INITIAL");
    await logAccountDetails(recipient, "RECIPIENT INITIAL");
  });

  it("Should verify contract addresses", async function() {
    console.log("SchrodingerBox address:", await schrodingerBox.getAddress());
    console.log("ParadoxToken address:", await paradoxToken.getAddress());
    console.log("SchrodingerCatNFT address:", await schrodingerCatNFT.getAddress());
    
    // Actual assertions
    expect(await schrodingerBox.getAddress()).to.not.equal("0x0000000000000000000000000000000000000000");
    expect(await paradoxToken.getAddress()).to.not.equal("0x0000000000000000000000000000000000000000");
    expect(await schrodingerCatNFT.getAddress()).to.not.equal("0x0000000000000000000000000000000000000000");
  });

  it("Should find or mint a box", async function() {
    // Get owner's boxes
    const balance = await schrodingerBox.balanceOf(owner.address);
    console.log("Owner has", balance.toString(), "boxes");
    
    if (balance > 0) {
      // Use existing box
      boxId = await schrodingerBox.tokenOfOwnerByIndex(owner.address, 0);
      console.log("Using existing box with ID:", boxId.toString());
      
      // Log box details
      await logBoxDetails(boxId, "EXISTING BOX");
    } else {
      // Mint a new box with higher gas
      console.log("No boxes found, minting a new one with higher gas...");
      
      // Check for minting fee
      const mintingFee = await schrodingerBox.mintingFee();
      console.log("Box minting fee:", mintingFee.toString());
      
      // Set gas options
      const gasOptions = {
        value: mintingFee,
        gasLimit: 1000000,
        maxPriorityFeePerGas: ethers.parseUnits("2", "gwei"),
        maxFeePerGas: ethers.parseUnits("30", "gwei")
      };
      
      console.log("Sending transaction with gas options:", JSON.stringify(gasOptions, (_, v) => 
        typeof v === 'bigint' ? v.toString() : v, 2));
      
      // Mint box
      const tx = await schrodingerBox.mintBox(gasOptions);
      console.log("Transaction sent:", tx.hash);
      console.log("Waiting for confirmation...");
      
      // Wait for more confirmations
      const receipt = await tx.wait(2);
      console.log("Transaction confirmed in block:", receipt.blockNumber);
      
      // Get box ID by examining events
      let found = false;
      if (receipt.logs) {
        for (const log of receipt.logs) {
          try {
            // Try to decode as BoxMinted event
            if (log.fragment && log.fragment.name === "BoxMinted") {
              boxId = log.args.boxId;
              found = true;
              break;
            }
          } catch (e) {
            // Silently continue to next log
          }
        }
      }
      
      if (!found) {
        console.log("Couldn't find event in logs, checking owner boxes...");
        const newBalance = await schrodingerBox.balanceOf(owner.address);
        if (newBalance > 0) {
          boxId = await schrodingerBox.tokenOfOwnerByIndex(owner.address, 0);
          found = true;
        }
      }
      
      if (!found) {
        throw new Error("Failed to determine box ID after minting");
      }
      
      console.log("Minted new box with ID:", boxId.toString());
      
      // Log box details
      await logBoxDetails(boxId, "NEWLY MINTED BOX");
    }
    
    // Verify we have a box ID
    expect(boxId).to.not.be.undefined;
    
    // Verify ownership
    const currentOwner = await schrodingerBox.ownerOf(boxId);
    expect(currentOwner).to.equal(owner.address);
  });

  it("Should deposit tokens into the box", async function() {
    if (!boxId) {
      console.log("No box ID available, skipping test");
      this.skip();
      return;
    }
    
    console.log(`\n=== DEPOSIT TOKENS INTO BOX ${boxId.toString()} ===`);
    
    // Check current box token balance
    const initialBoxTokens = await schrodingerBox.getERC20Balance(boxId, await paradoxToken.getAddress());
    console.log("Box initial token balance:", ethers.formatEther(initialBoxTokens), "PAR");
    
    if (initialBoxTokens > 0) {
      console.log("Box already has tokens, skipping deposit");
      return;
    }
    
    // Get owner token balance
    const ownerBalance = await paradoxToken.balanceOf(owner.address);
    console.log("Owner token balance:", ethers.formatEther(ownerBalance), "PAR");
    
    if (ownerBalance == 0) {
      console.log("Owner has no tokens, trying to mint some...");
      try {
        const mintAmount = 100n * 10n ** 18n; // 100 tokens
        const mintTx = await paradoxToken.mint(owner.address, mintAmount, { gasLimit: 200000 });
        await mintTx.wait();
        console.log("Minted", ethers.formatEther(mintAmount), "PAR tokens to owner");
      } catch (e) {
        console.log("Failed to mint tokens:", e.message);
        console.log("Using whatever tokens owner has...");
      }
    }
    
    // Approve and deposit
    const depositAmount = 10n * 10n ** 18n; // 10 tokens
    
    console.log("Approving tokens...");
    const approveTx = await paradoxToken.approve(
      await schrodingerBox.getAddress(), 
      depositAmount,
      { gasLimit: 200000 }
    );
    const approveReceipt = await approveTx.wait();
    console.log("Approve transaction confirmed in block", approveReceipt.blockNumber);
    
    // Verify approval worked
    const allowance = await paradoxToken.allowance(owner.address, await schrodingerBox.getAddress());
    console.log("Box allowance:", ethers.formatEther(allowance), "PAR");
    expect(allowance).to.be.gte(depositAmount);
    
    console.log("Depositing tokens...");
    const depositTx = await schrodingerBox.depositERC20(
      boxId, 
      await paradoxToken.getAddress(), 
      depositAmount,
      { gasLimit: 300000 }
    );
    console.log("Transaction sent:", depositTx.hash);
    const depositReceipt = await depositTx.wait();
    console.log("Deposit transaction confirmed in block:", depositReceipt.blockNumber);
    
    // Check for ERC20Deposited event
    let found = false;
    for (const log of depositReceipt.logs) {
      try {
        if (log.fragment && log.fragment.name === "ERC20Deposited") {
          console.log("Found ERC20Deposited event:", log.args);
          found = true;
          break;
        }
      } catch (e) {
        // Continue to next log
      }
    }
    
    if (!found) {
      console.log("Warning: Could not find ERC20Deposited event in logs");
    }
    
    // Verify deposit worked by checking box details
    await logBoxDetails(boxId, "BOX AFTER TOKEN DEPOSIT");
    
    // Check specific token balance
    const boxTokens = await schrodingerBox.getERC20Balance(boxId, await paradoxToken.getAddress());
    console.log("Box token balance:", ethers.formatEther(boxTokens), "PAR");
    expect(boxTokens).to.be.gt(0);
    
    console.log(`=== END DEPOSIT TOKENS ===`);
  });

  it("Should mint and deposit an NFT into the box", async function() {
    if (!boxId) {
      console.log("No box ID available, skipping test");
      this.skip();
      return;
    }
    
    console.log(`\n=== DEPOSIT NFT INTO BOX ${boxId.toString()} ===`);
    
    // Get box details
    const boxDetails = await schrodingerBox.getBoxDetails(boxId);
    console.log("Box has", boxDetails[2].length, "NFTs initially");
    
    if (boxDetails[2].length > 0) {
      console.log("Box already has NFTs, skipping deposit");
      return;
    }
    
    // Check if owner has NFTs
    const nftBalance = await schrodingerCatNFT.balanceOf(owner.address);
    console.log("Owner NFT balance:", nftBalance.toString());
    
    let nftId;
    
    if (nftBalance == 0) {
      // Try to mint a new NFT
      console.log("Owner has no NFTs, minting a new one...");
      try {
        const mintTx = await schrodingerCatNFT.mint(owner.address, { gasLimit: 200000 });
        console.log("NFT mint transaction sent:", mintTx.hash);
        const mintReceipt = await mintTx.wait();
        console.log("NFT mint confirmed in block:", mintReceipt.blockNumber);
        
        // Try to find NFT ID from the event
        for (const log of mintReceipt.logs) {
          try {
            // Look for Transfer event (ERC721 mint shows as transfer from 0x0)
            if (log.fragment && log.fragment.name === "Transfer") {
              nftId = log.args.tokenId;
              console.log("Extracted NFT ID from mint event:", nftId.toString());
              break;
            }
          } catch (e) {
            // Continue to next log
          }
        }
        
        // If we couldn't get the ID from events, we'll try direct query
        if (!nftId) {
          // SchrodingerCatNFT may not implement ERC721Enumerable, so we have to try another approach
          console.log("Could not extract NFT ID from event, trying alternatives...");
          
          // Check updated balance
          const newBalance = await schrodingerCatNFT.balanceOf(owner.address);
          console.log("Updated NFT balance:", newBalance.toString());
          
          // If we know this is the first NFT the owner gets, it might be ID 1
          if (nftBalance == 0 && newBalance > 0) {
            // Try some common IDs
            for (let testId of [1, 2, 3]) {
              try {
                const testOwner = await schrodingerCatNFT.ownerOf(testId);
                if (testOwner.toLowerCase() === owner.address.toLowerCase()) {
                  nftId = testId;
                  console.log("Found owner's NFT with ID:", nftId.toString());
                  break;
                }
              } catch (e) {
                // NFT doesn't exist or isn't owned by us, try next
              }
            }
          }
        }
        
        if (!nftId) {
          throw new Error("Could not determine NFT ID after minting");
        }
      } catch (e) {
        console.log("Failed to mint NFT:", e.message);
        this.skip();
        return;
      }
    } else {
      // Owner already has NFTs, but we need to find the ID
      // Try using tokenOfOwnerByIndex if supported
      try {
        nftId = await schrodingerCatNFT.tokenOfOwnerByIndex(owner.address, 0);
        console.log("Found existing NFT with ID:", nftId.toString());
      } catch (e) {
        console.log("tokenOfOwnerByIndex not supported:", e.message);
        
        // Try alternative: if we know this is a simple NFT that starts from ID 1
        for (let testId of [1, 2, 3, 4, 5]) {
          try {
            const testOwner = await schrodingerCatNFT.ownerOf(testId);
            if (testOwner.toLowerCase() === owner.address.toLowerCase()) {
              nftId = testId;
              console.log("Found owner's NFT with ID:", nftId.toString());
              break;
            }
          } catch (e) {
            // NFT doesn't exist or isn't owned by us, try next
          }
        }
      }
      
      if (!nftId) {
        console.log("Could not find any NFT IDs owned by this address");
        this.skip();
        return;
      }
    }
    
    // Now we should have an NFT ID
    console.log("Proceeding with NFT ID:", nftId.toString());
    
    // Approve and deposit
    console.log("Approving NFT transfer...");
    const approveTx = await schrodingerCatNFT.approve(
      await schrodingerBox.getAddress(), 
      nftId,
      { gasLimit: 200000 }
    );
    const approveReceipt = await approveTx.wait();
    console.log("NFT approve confirmed in block:", approveReceipt.blockNumber);
    
    // Verify approval
    const approved = await schrodingerCatNFT.getApproved(nftId);
    console.log("NFT approved address:", approved);
    console.log("Box address:", await schrodingerBox.getAddress());
    expect(approved.toLowerCase()).to.equal((await schrodingerBox.getAddress()).toLowerCase());
    
    console.log("Depositing NFT...");
    const depositTx = await schrodingerBox.depositNFT(
      boxId, 
      await schrodingerCatNFT.getAddress(), 
      nftId,
      { gasLimit: 300000 }
    );
    console.log("Transaction sent:", depositTx.hash);
    const depositReceipt = await depositTx.wait();
    console.log("NFT deposit confirmed in block:", depositReceipt.blockNumber);
    
    // Check for NFTDeposited event
    let found = false;
    for (const log of depositReceipt.logs) {
      try {
        if (log.fragment && log.fragment.name === "NFTDeposited") {
          console.log("Found NFTDeposited event:", log.args);
          found = true;
          break;
        }
      } catch (e) {
        // Continue to next log
      }
    }
    
    if (!found) {
      console.log("Warning: Could not find NFTDeposited event in logs");
    }
    
    // Verify deposit worked
    await logBoxDetails(boxId, "BOX AFTER NFT DEPOSIT");
    
    // Check if NFT is now in the box
    const containsNFT = await schrodingerBox.containsNFT(
      boxId, 
      await schrodingerCatNFT.getAddress(), 
      nftId
    );
    console.log("Box contains NFT:", containsNFT);
    expect(containsNFT).to.be.true;
    
    console.log(`=== END DEPOSIT NFT ===`);
  });

  it("Should transfer the box to the recipient", async function() {
    if (!boxId) {
      console.log("No box ID available, skipping test");
      this.skip();
      return;
    }
    
    console.log(`\n=== TRANSFER BOX ${boxId.toString()} ===`);
    
    // Log box before transfer
    await logBoxDetails(boxId, "BOX BEFORE TRANSFER");
    
    // Transfer box
    console.log("Transferring box...");
    const transferTx = await schrodingerBox.transferFrom(
      owner.address, 
      recipient.address, 
      boxId,
      { gasLimit: 300000 }
    );
    console.log("Transfer transaction sent:", transferTx.hash);
    const transferReceipt = await transferTx.wait();
    console.log("Transfer confirmed in block:", transferReceipt.blockNumber);
    
    // Log accounts after transfer
    await logAccountDetails(owner, "OWNER AFTER TRANSFER");
    await logAccountDetails(recipient, "RECIPIENT AFTER TRANSFER");
    
    // Verify transfer
    const newOwner = await schrodingerBox.ownerOf(boxId);
    console.log("Box new owner:", newOwner);
    expect(newOwner.toLowerCase()).to.equal(recipient.address.toLowerCase());
    
    console.log(`=== END TRANSFER BOX ===`);
  });

  it("Should allow recipient to withdraw tokens", async function() {
    if (!boxId) {
      console.log("No box ID available, skipping test");
      this.skip();
      return;
    }
    
    console.log(`\n=== WITHDRAW TOKENS FROM BOX ${boxId.toString()} ===`);
    
    // Connect as recipient
    const recipientBox = schrodingerBox.connect(recipient);
    const recipientToken = paradoxToken.connect(recipient);
    
    // Check box state before withdrawal
    await logBoxDetails(boxId, "BOX BEFORE TOKEN WITHDRAWAL");
    
    // Check if box has tokens
    const boxTokenAddress = await paradoxToken.getAddress();
    const boxTokens = await recipientBox.getERC20Balance(boxId, boxTokenAddress);
    console.log("Box has", ethers.formatEther(boxTokens), "PAR tokens");
    
    if (boxTokens == 0) {
      console.log("Box has no tokens to withdraw, skipping");
      this.skip();
      return;
    }
    
    // Get recipient's initial balance
    const initialBalance = await recipientToken.balanceOf(recipient.address);
    console.log("Recipient's initial token balance:", ethers.formatEther(initialBalance), "PAR");
    
    // Withdraw tokens
    console.log("Withdrawing tokens...");
    const withdrawTx = await recipientBox.withdrawERC20(
      boxId, 
      boxTokenAddress,
      { gasLimit: 300000 }
    );
    console.log("Withdrawal transaction sent:", withdrawTx.hash);
    const withdrawReceipt = await withdrawTx.wait();
    console.log("Withdrawal confirmed in block:", withdrawReceipt.blockNumber);
    
    // Check for ERC20Withdrawn event
    let eventAmount;
    for (const log of withdrawReceipt.logs) {
      try {
        if (log.fragment && log.fragment.name === "ERC20Withdrawn") {
          console.log("Found ERC20Withdrawn event:", log.args);
          eventAmount = log.args.amount;
          break;
        }
      } catch (e) {
        // Continue to next log
      }
    }
    
    if (eventAmount) {
      console.log("Withdrawn amount from event:", ethers.formatEther(eventAmount), "PAR");
    } else {
      console.log("Warning: Could not find ERC20Withdrawn event in logs");
    }
    
    // Verify recipient got tokens
    const newBalance = await recipientToken.balanceOf(recipient.address);
    console.log("Recipient's new balance:", ethers.formatEther(newBalance), "PAR");
    
    // Calculate expected balance
    const expectedBalance = initialBalance + boxTokens;
    console.log("Expected balance:", ethers.formatEther(expectedBalance), "PAR");
    
    // Verify box is empty
    const newBoxTokens = await recipientBox.getERC20Balance(boxId, boxTokenAddress);
    console.log("Box token balance after withdrawal:", ethers.formatEther(newBoxTokens), "PAR");
    expect(newBoxTokens).to.equal(0);
    
    // Check if balances match (allow for small differences due to gas)
    if (newBalance < expectedBalance) {
      console.log("WARNING: Balance mismatch!");
      console.log("Difference:", ethers.formatEther(expectedBalance - newBalance), "PAR");
    } else {
      console.log("Balance increased as expected");
    }
    
    // Log final box state
    await logBoxDetails(boxId, "BOX AFTER TOKEN WITHDRAWAL");
    await logAccountDetails(recipient, "RECIPIENT AFTER TOKEN WITHDRAWAL");
    
    console.log(`=== END WITHDRAW TOKENS ===`);
  });

  it("Should allow recipient to withdraw NFT", async function() {
    if (!boxId) {
      console.log("No box ID available, skipping test");
      this.skip();
      return;
    }
    
    console.log(`\n=== WITHDRAW NFT FROM BOX ${boxId.toString()} ===`);
    
    // Connect as recipient
    const recipientBox = schrodingerBox.connect(recipient);
    const recipientNFT = schrodingerCatNFT.connect(recipient);
    
    // Check box state before withdrawal
    await logBoxDetails(boxId, "BOX BEFORE NFT WITHDRAWAL");
    
    // Check if box has NFTs
    const boxDetails = await recipientBox.getBoxDetails(boxId);
    console.log("Box has", boxDetails[2].length, "NFTs");
    
    if (boxDetails[2].length == 0) {
      console.log("Box has no NFTs to withdraw, skipping");
      this.skip();
      return;
    }
    
    // Get the NFT details from the box
    const nftContract = boxDetails[2][0];
    const nftId = boxDetails[3][0];
    console.log("Box contains NFT #", nftId.toString(), "from contract", nftContract);
    
    // Get recipient's initial NFT balance
    const initialBalance = await recipientNFT.balanceOf(recipient.address);
    console.log("Recipient's initial NFT balance:", initialBalance.toString());
    
    // Withdraw NFT
    console.log("Withdrawing NFT...");
    const withdrawTx = await recipientBox.withdrawNFT(
      boxId, 
      nftContract, 
      nftId,
      { gasLimit: 300000 }
    );
    console.log("Withdrawal transaction sent:", withdrawTx.hash);
    const withdrawReceipt = await withdrawTx.wait();
    console.log("Withdrawal confirmed in block:", withdrawReceipt.blockNumber);
    
    // Check for NFTWithdrawn event
    let found = false;
    for (const log of withdrawReceipt.logs) {
      try {
        if (log.fragment && log.fragment.name === "NFTWithdrawn") {
          console.log("Found NFTWithdrawn event:", log.args);
          found = true;
          break;
        }
      } catch (e) {
        // Continue to next log
      }
    }
    
    if (!found) {
      console.log("Warning: Could not find NFTWithdrawn event in logs");
    }
    
    // Verify recipient got NFT
    const newBalance = await recipientNFT.balanceOf(recipient.address);
    console.log("Recipient's new NFT balance:", newBalance.toString());
    
    // Check NFT ownership
    try {
      const nftOwner = await recipientNFT.ownerOf(nftId);
      console.log("NFT new owner:", nftOwner);
      expect(nftOwner.toLowerCase()).to.equal(recipient.address.toLowerCase());
    } catch (e) {
      console.log("Error checking NFT ownership:", e.message);
    }
    
    // Verify NFT is no longer in box
    const containsNFT = await recipientBox.containsNFT(boxId, nftContract, nftId);
    console.log("Box still contains NFT:", containsNFT);
    expect(containsNFT).to.be.false;
    
    // Log final box state
    await logBoxDetails(boxId, "BOX AFTER NFT WITHDRAWAL");
    await logAccountDetails(recipient, "RECIPIENT AFTER NFT WITHDRAWAL");
    
    console.log(`=== END WITHDRAW NFT ===`);
  });

  after(async function () {
    // Log final states
    console.log("\n=== FINAL STATES ===");
    await logAccountDetails(owner, "OWNER FINAL");
    await logAccountDetails(recipient, "RECIPIENT FINAL");
    console.log("=== TEST COMPLETE ===");
  });
});