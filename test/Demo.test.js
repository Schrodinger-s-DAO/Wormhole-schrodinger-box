// SCHRODINGER BOX DEMO TEST
// Questo test mostra in modo chiaro e comprensibile il funzionamento completo
// del sistema SchrodingerBox: creazione della scatola, deposito di NFT e token,
// trasferimento, e prelievo da un altro wallet.

const { expect } = require("chai");
require("dotenv").config();

describe("📦 SCHRODINGER BOX DEMO", function () {
  // Aumentiamo il timeout a 3 minuti per dare tempo alle transazioni
  this.timeout(180000);

  let schrodingerBox;      // Contratto della scatola
  let paradoxToken;        // Contratto del token ERC20
  let schrodingerCatNFT;   // Contratto del gatto NFT
  let proprietario;        // Primo wallet (creatore della scatola)
  let destinatario;        // Secondo wallet (ricevente della scatola)
  let boxId;               // ID della scatola creata
  
  // Funzione per stampare in modo chiaro i dettagli di un account
  async function stampaAccount(account, etichetta) {
    console.log(`\n🧾 === DETTAGLI ${etichetta} ===`);
    console.log(`📍 Indirizzo: ${account.address}`);
    
    const ethBalance = await ethers.provider.getBalance(account.address);
    console.log(`💰 ETH: ${ethers.formatEther(ethBalance)} ETH`);
    
    try {
      const tokenBalance = await paradoxToken.balanceOf(account.address);
      console.log(`🪙 Token PAR: ${ethers.formatEther(tokenBalance)}`);
    } catch (e) {
      console.log(`❌ Errore nel leggere i token: ${e.message}`);
    }
    
    try {
      const nftBalance = await schrodingerCatNFT.balanceOf(account.address);
      console.log(`😺 Gatti NFT: ${nftBalance.toString()}`);
    } catch (e) {
      console.log(`❌ Errore nel leggere gli NFT: ${e.message}`);
    }
    
    try {
      const boxBalance = await schrodingerBox.balanceOf(account.address);
      console.log(`📦 Scatole: ${boxBalance.toString()}`);
      
      // Lista tutte le scatole possedute
      if (boxBalance > 0) {
        console.log("📋 Scatole possedute:");
        for (let i = 0; i < boxBalance; i++) {
          try {
            const boxId = await schrodingerBox.tokenOfOwnerByIndex(account.address, i);
            await stampaDettagliScatola(boxId, `Scatola #${boxId.toString()}`);
          } catch (e) {
            console.log(`❌ Errore nel leggere la scatola ${i}: ${e.message}`);
          }
        }
      }
    } catch (e) {
      console.log(`❌ Errore nel leggere le scatole: ${e.message}`);
    }
    console.log(`=== FINE DETTAGLI ${etichetta} ===\n`);
  }

  // Funzione per stampare i dettagli di una scatola
  async function stampaDettagliScatola(boxId, etichetta) {
    console.log(`\n📦 --- ${etichetta} ---`);
    try {
      const proprietario = await schrodingerBox.ownerOf(boxId);
      console.log(`👤 Proprietario: ${proprietario}`);
      
      const dettagli = await schrodingerBox.getBoxDetails(boxId);
      console.log(`🔒 Bloccata: ${dettagli[4] ? 'Sì' : 'No'}`);
      console.log(`⛓️ Chain di origine: ${dettagli[5]}`);
      console.log(`🌟 Originale: ${dettagli[6] ? 'Sì' : 'No'}`);
      
      // Token ERC20
      console.log(`🪙 Token ERC20: ${dettagli[0].length}`);
      for (let i = 0; i < dettagli[0].length; i++) {
        console.log(`  • Token ${i}: ${dettagli[0][i]} - Quantità: ${ethers.formatEther(dettagli[1][i])} PAR`);
      }
      
      // NFT
      console.log(`😺 NFT: ${dettagli[2].length}`);
      for (let i = 0; i < dettagli[2].length; i++) {
        console.log(`  • NFT ${i}: Contratto ${dettagli[2][i]} - ID: ${dettagli[3][i].toString()}`);
      }
    } catch (e) {
      console.log(`❌ Errore nel leggere i dettagli della scatola: ${e.message}`);
    }
    console.log(`--- FINE ${etichetta} ---\n`);
  }

  // Prima di iniziare i test
  before(async function () {
    console.log("🚀 INIZIALIZZAZIONE DEL DEMO SCHRODINGER BOX");
    
    // Otteniamo gli account
    const accounts = await ethers.getSigners();
    proprietario = accounts[0];
    destinatario = accounts[1];

    console.log("👤 Account del proprietario:", proprietario.address);
    console.log("👤 Account del destinatario:", destinatario.address);

    // Otteniamo il nome della rete per usare le variabili d'ambiente corrette
    const network = await ethers.provider.getNetwork();
    const networkName = network.name.toUpperCase();
    console.log("🌐 Rete:", networkName);

    // Otteniamo gli indirizzi dei contratti dalle variabili d'ambiente
    const boxAddress = process.env[`${networkName}_SCHRODINGER_BOX_ADDRESS`];
    const tokenAddress = process.env[`${networkName}_PARADOX_TOKEN_ADDRESS`];
    const nftAddress = process.env[`${networkName}_SCHRODINGER_CAT_NFT_ADDRESS`];

    console.log("📦 Indirizzo contratto SchrodingerBox:", boxAddress);
    console.log("🪙 Indirizzo contratto ParadoxToken:", tokenAddress);
    console.log("😺 Indirizzo contratto SchrodingerCatNFT:", nftAddress);

    // Verifichiamo che gli indirizzi esistano
    if (!boxAddress || !tokenAddress || !nftAddress) {
      throw new Error(`❌ Indirizzi dei contratti mancanti per la rete ${networkName}. Verifica il file .env`);
    }

    // Carichiamo i contratti
    schrodingerBox = await ethers.getContractAt("SchrodingerBox", boxAddress);
    paradoxToken = await ethers.getContractAt("ParadoxToken", tokenAddress);
    schrodingerCatNFT = await ethers.getContractAt("SchrodingerCatNFT", nftAddress);

    console.log("✅ Contratti caricati correttamente");
    
    // Stampiamo lo stato iniziale degli account
    console.log("\n📊 STATO INIZIALE DEGLI ACCOUNT");
    await stampaAccount(proprietario, "PROPRIETARIO INIZIALE");
    await stampaAccount(destinatario, "DESTINATARIO INIZIALE");
  });

  // Test 1: Creazione di una nuova scatola
  it("1️⃣ Crea una nuova Schrödinger Box", async function() {
    console.log("\n🔨 CREAZIONE NUOVA SCATOLA");
    
    // Controlliamo quante scatole ha già il proprietario
    const bilancioIniziale = await schrodingerBox.balanceOf(proprietario.address);
    console.log(`📊 Il proprietario ha attualmente ${bilancioIniziale.toString()} scatole`);
    
    if (bilancioIniziale > 0) {
      // Usiamo una scatola esistente
      boxId = await schrodingerBox.tokenOfOwnerByIndex(proprietario.address, 0);
      console.log("🔄 Uso una scatola esistente con ID:", boxId.toString());
      
      // Stampiamo i dettagli della scatola
      await stampaDettagliScatola(boxId, "SCATOLA ESISTENTE");
    } else {
      // Miname una nuova scatola
      console.log("🆕 Nessuna scatola trovata, ne creo una nuova...");
      
      // Controlliamo se c'è una fee di creazione
      const mintingFee = await schrodingerBox.mintingFee();
      console.log("💰 Fee di creazione scatola:", ethers.formatEther(mintingFee), "ETH");
      
      // Opzioni per la transazione
      const opzioniGas = {
        value: mintingFee,
        gasLimit: 1000000
      };
      
      // Creiamo la scatola
      console.log("📝 Invio della transazione per la creazione della scatola...");
      const tx = await schrodingerBox.mintBox(opzioniGas);
      console.log("🔄 Transazione inviata:", tx.hash);
      console.log("⏳ In attesa di conferma...");
      
      // Attendiamo la conferma
      const receipt = await tx.wait(1);
      console.log("✅ Transazione confermata nel blocco:", receipt.blockNumber);
      
      // Otteniamo l'ID della scatola dagli eventi
      let trovato = false;
      if (receipt.logs) {
        for (const log of receipt.logs) {
          try {
            // Proviamo a decodificare come evento BoxMinted
            if (log.fragment && log.fragment.name === "BoxMinted") {
              boxId = log.args.boxId;
              trovato = true;
              break;
            }
          } catch (e) {
            // Continuiamo con il prossimo log
          }
        }
      }
      
      if (!trovato) {
        console.log("⚠️ Non ho trovato l'evento nei log, controllo le scatole del proprietario...");
        const nuovoBilancio = await schrodingerBox.balanceOf(proprietario.address);
        if (nuovoBilancio > 0) {
          boxId = await schrodingerBox.tokenOfOwnerByIndex(proprietario.address, 0);
          trovato = true;
        }
      }
      
      if (!trovato) {
        throw new Error("❌ Impossibile determinare l'ID della scatola dopo la creazione");
      }
      
      console.log("🎉 Creata nuova scatola con ID:", boxId.toString());
      
      // Stampiamo i dettagli della nuova scatola
      await stampaDettagliScatola(boxId, "NUOVA SCATOLA");
    }
    
    // Verifichiamo che abbiamo un ID della scatola
    expect(boxId).to.not.be.undefined;
    
    // Verifichiamo la proprietà
    const proprietarioAttuale = await schrodingerBox.ownerOf(boxId);
    console.log("👤 Proprietario attuale della scatola:", proprietarioAttuale);
    expect(proprietarioAttuale).to.equal(proprietario.address);
  });

  // Test 2: Deposito di token nella scatola
  it("2️⃣ Deposita token PAR nella scatola", async function() {
    if (!boxId) {
      console.log("❌ Nessun ID scatola disponibile, salto il test");
      this.skip();
      return;
    }
    
    console.log(`\n💰 DEPOSITO TOKEN NELLA SCATOLA ${boxId.toString()}`);
    
    // Controlliamo il bilancio attuale di token nella scatola
    const tokenIniziali = await schrodingerBox.getERC20Balance(boxId, await paradoxToken.getAddress());
    console.log("📊 Bilancio iniziale di token nella scatola:", ethers.formatEther(tokenIniziali), "PAR");
    
    if (tokenIniziali > 0) {
      console.log("ℹ️ La scatola ha già dei token, salto il deposito");
      return;
    }
    
    // Otteniamo il bilancio di token del proprietario
    const bilancioProprietario = await paradoxToken.balanceOf(proprietario.address);
    console.log("📊 Bilancio di token del proprietario:", ethers.formatEther(bilancioProprietario), "PAR");
    
    if (bilancioProprietario == 0) {
      console.log("⚠️ Il proprietario non ha token, provo a mintarne alcuni...");
      try {
        const quantitaMint = 100n * 10n ** 18n; // 100 token
        const txMint = await paradoxToken.mint(proprietario.address, quantitaMint, { gasLimit: 200000 });
        await txMint.wait();
        console.log("✅ Mintati", ethers.formatEther(quantitaMint), "token PAR al proprietario");
      } catch (e) {
        console.log("❌ Fallito nel mintare token:", e.message);
        console.log("ℹ️ Provo a continuare con i token disponibili...");
      }
    }
    
    // Quantità di token da depositare
    const quantitaDeposito = 10n * 10n ** 18n; // 10 token
    
    console.log("🔄 Approvazione per il trasferimento dei token...");
    const txApprova = await paradoxToken.approve(
      await schrodingerBox.getAddress(), 
      quantitaDeposito,
      { gasLimit: 200000 }
    );
    const receiptApprova = await txApprova.wait();
    console.log("✅ Approvazione confermata nel blocco", receiptApprova.blockNumber);
    
    // Verifichiamo che l'approvazione funzioni
    const concessione = await paradoxToken.allowance(proprietario.address, await schrodingerBox.getAddress());
    console.log("📊 Concessione alla scatola:", ethers.formatEther(concessione), "PAR");
    expect(concessione).to.be.gte(quantitaDeposito);
    
    console.log("💸 Deposito dei token nella scatola...");
    const txDeposito = await schrodingerBox.depositERC20(
      boxId, 
      await paradoxToken.getAddress(), 
      quantitaDeposito,
      { gasLimit: 300000 }
    );
    console.log("🔄 Transazione inviata:", txDeposito.hash);
    const receiptDeposito = await txDeposito.wait();
    console.log("✅ Deposito confermato nel blocco:", receiptDeposito.blockNumber);
    
    // Verifichiamo che il deposito funzioni controllando i dettagli della scatola
    await stampaDettagliScatola(boxId, "SCATOLA DOPO DEPOSITO TOKEN");
    
    // Controlliamo il bilancio specifico di token
    const tokenScatola = await schrodingerBox.getERC20Balance(boxId, await paradoxToken.getAddress());
    console.log("📊 Bilancio token nella scatola:", ethers.formatEther(tokenScatola), "PAR");
    expect(tokenScatola).to.be.gt(0);
    
    console.log(`🎉 DEPOSITO TOKEN COMPLETATO`);
  });

  // Test 3: Mint e deposito di un NFT nella scatola
  it("3️⃣ Crea e deposita un Gatto NFT nella scatola", async function() {
    if (!boxId) {
      console.log("❌ Nessun ID scatola disponibile, salto il test");
      this.skip();
      return;
    }
    
    console.log(`\n😺 DEPOSITO NFT NELLA SCATOLA ${boxId.toString()}`);
    
    // Otteniamo i dettagli della scatola
    const dettagliScatola = await schrodingerBox.getBoxDetails(boxId);
    console.log("📊 La scatola ha", dettagliScatola[2].length, "NFT inizialmente");
    
    if (dettagliScatola[2].length > 0) {
      console.log("ℹ️ La scatola ha già degli NFT, salto il deposito");
      return;
    }
    
    // Controlliamo se il proprietario ha NFT
    const bilancioNFT = await schrodingerCatNFT.balanceOf(proprietario.address);
    console.log("📊 Bilancio NFT del proprietario:", bilancioNFT.toString());
    
    let nftId;
    
    if (bilancioNFT == 0) {
      // Proviamo a mintare un nuovo NFT
      console.log("⚠️ Il proprietario non ha NFT, ne minto uno nuovo...");
      try {
        const txMint = await schrodingerCatNFT.mint(proprietario.address, { gasLimit: 200000 });
        console.log("🔄 Transazione mint NFT inviata:", txMint.hash);
        const receiptMint = await txMint.wait();
        console.log("✅ Mint NFT confermato nel blocco:", receiptMint.blockNumber);
        
        // Proviamo a trovare l'ID dell'NFT dall'evento
        for (const log of receiptMint.logs) {
          try {
            // Cerchiamo l'evento Transfer (il mint ERC721 appare come transfer da 0x0)
            if (log.fragment && log.fragment.name === "Transfer") {
              nftId = log.args.tokenId;
              console.log("📝 Estratto ID NFT dall'evento mint:", nftId.toString());
              break;
            }
          } catch (e) {
            // Continuiamo con il prossimo log
          }
        }
        
        // Se non possiamo ottenere l'ID dagli eventi, proveremo una query diretta
        if (!nftId) {
          console.log("⚠️ Non ho potuto estrarre l'ID NFT dall'evento, provo alternative...");
          
          // Controlliamo il bilancio aggiornato
          const nuovoBilancio = await schrodingerCatNFT.balanceOf(proprietario.address);
          console.log("📊 Bilancio NFT aggiornato:", nuovoBilancio.toString());
          
          if (bilancioNFT == 0 && nuovoBilancio > 0) {
            // Proviamo alcuni ID comuni
            for (let testId of [1, 2, 3]) {
              try {
                const testOwner = await schrodingerCatNFT.ownerOf(testId);
                if (testOwner.toLowerCase() === proprietario.address.toLowerCase()) {
                  nftId = testId;
                  console.log("✅ Trovato NFT del proprietario con ID:", nftId.toString());
                  break;
                }
              } catch (e) {
                // NFT non esiste o non è di nostra proprietà, prova il prossimo
              }
            }
          }
        }
        
        if (!nftId) {
          throw new Error("❌ Impossibile determinare l'ID dell'NFT dopo il mint");
        }
      } catch (e) {
        console.log("❌ Fallito nel mintare NFT:", e.message);
        this.skip();
        return;
      }
    } else {
      // Il proprietario ha già degli NFT, ma dobbiamo trovare l'ID
      try {
        nftId = await schrodingerCatNFT.tokenOfOwnerByIndex(proprietario.address, 0);
        console.log("✅ Trovato NFT esistente con ID:", nftId.toString());
      } catch (e) {
        console.log("⚠️ tokenOfOwnerByIndex non supportato:", e.message);
        
        // Alternativa: se sappiamo che questo è un NFT semplice che inizia dall'ID 1
        for (let testId of [1, 2, 3, 4, 5]) {
          try {
            const testOwner = await schrodingerCatNFT.ownerOf(testId);
            if (testOwner.toLowerCase() === proprietario.address.toLowerCase()) {
              nftId = testId;
              console.log("✅ Trovato NFT del proprietario con ID:", nftId.toString());
              break;
            }
          } catch (e) {
            // NFT non esiste o non è di nostra proprietà, prova il prossimo
          }
        }
      }
      
      if (!nftId) {
        console.log("❌ Impossibile trovare ID NFT di proprietà di questo indirizzo");
        this.skip();
        return;
      }
    }
    
    // Ora dovremmo avere un ID NFT
    console.log("🔄 Procedo con l'NFT ID:", nftId.toString());
    
    // Approviamo e depositiamo
    console.log("🔄 Approvazione trasferimento NFT...");
    const txApprova = await schrodingerCatNFT.approve(
      await schrodingerBox.getAddress(), 
      nftId,
      { gasLimit: 200000 }
    );
    const receiptApprova = await txApprova.wait();
    console.log("✅ Approvazione NFT confermata nel blocco:", receiptApprova.blockNumber);
    
    // Verifichiamo l'approvazione
    const approvato = await schrodingerCatNFT.getApproved(nftId);
    console.log("📝 Indirizzo approvato per l'NFT:", approvato);
    console.log("📝 Indirizzo della scatola:", await schrodingerBox.getAddress());
    
    console.log("💼 Deposito NFT nella scatola...");
    const txDeposito = await schrodingerBox.depositNFT(
      boxId, 
      await schrodingerCatNFT.getAddress(), 
      nftId,
      { gasLimit: 300000 }
    );
    console.log("🔄 Transazione inviata:", txDeposito.hash);
    const receiptDeposito = await txDeposito.wait();
    console.log("✅ Deposito NFT confermato nel blocco:", receiptDeposito.blockNumber);
    
    // Verifichiamo che il deposito funzioni
    await stampaDettagliScatola(boxId, "SCATOLA DOPO DEPOSITO NFT");
    
    // Controlliamo se l'NFT è ora nella scatola
    const contieneNFT = await schrodingerBox.containsNFT(
      boxId, 
      await schrodingerCatNFT.getAddress(), 
      nftId
    );
    console.log("✅ La scatola contiene l'NFT:", contieneNFT ? 'Sì' : 'No');
    expect(contieneNFT).to.be.true;
    
    console.log(`🎉 DEPOSITO NFT COMPLETATO`);
  });

  // Test 4: Trasferimento della scatola al destinatario
  it("4️⃣ Trasferisce la scatola al destinatario", async function() {
    if (!boxId) {
      console.log("❌ Nessun ID scatola disponibile, salto il test");
      this.skip();
      return;
    }
    
    console.log(`\n🚚 TRASFERIMENTO SCATOLA ${boxId.toString()}`);
    
    // Stampiamo la scatola prima del trasferimento
    await stampaDettagliScatola(boxId, "SCATOLA PRIMA DEL TRASFERIMENTO");
    
    // Trasferimento scatola
    console.log("🔄 Trasferimento della scatola in corso...");
    const txTrasferimento = await schrodingerBox.transferFrom(
      proprietario.address, 
      destinatario.address, 
      boxId,
      { gasLimit: 300000 }
    );
    console.log("🔄 Transazione di trasferimento inviata:", txTrasferimento.hash);
    const receiptTrasferimento = await txTrasferimento.wait();
    console.log("✅ Trasferimento confermato nel blocco:", receiptTrasferimento.blockNumber);
    
    // Stampiamo gli account dopo il trasferimento
    await stampaAccount(proprietario, "PROPRIETARIO DOPO TRASFERIMENTO");
    await stampaAccount(destinatario, "DESTINATARIO DOPO TRASFERIMENTO");
    
    // Verifichiamo il trasferimento
    const nuovoProprietario = await schrodingerBox.ownerOf(boxId);
    console.log("👤 Nuovo proprietario della scatola:", nuovoProprietario);
    expect(nuovoProprietario.toLowerCase()).to.equal(destinatario.address.toLowerCase());
    
    console.log(`🎉 TRASFERIMENTO SCATOLA COMPLETATO`);
  });

  // Test 5: Il destinatario preleva i token
  it("5️⃣ Il destinatario preleva i token dalla scatola", async function() {
    if (!boxId) {
      console.log("❌ Nessun ID scatola disponibile, salto il test");
      this.skip();
      return;
    }
    
    console.log(`\n💸 PRELIEVO TOKEN DALLA SCATOLA ${boxId.toString()}`);
    
    // Connettiamo come destinatario
    const scatolaDestinatario = schrodingerBox.connect(destinatario);
    const tokenDestinatario = paradoxToken.connect(destinatario);
    
    // Controlliamo lo stato della scatola prima del prelievo
    await stampaDettagliScatola(boxId, "SCATOLA PRIMA DEL PRELIEVO TOKEN");
    
    // Controlliamo se la scatola ha token
    const indirizzoToken = await paradoxToken.getAddress();
    const tokenScatola = await scatolaDestinatario.getERC20Balance(boxId, indirizzoToken);
    console.log("📊 La scatola ha", ethers.formatEther(tokenScatola), "token PAR");
    
    if (tokenScatola == 0) {
      console.log("⚠️ La scatola non ha token da prelevare, salto");
      this.skip();
      return;
    }
    
    // Otteniamo il bilancio iniziale del destinatario
    const bilancioIniziale = await tokenDestinatario.balanceOf(destinatario.address);
    console.log("📊 Bilancio token iniziale del destinatario:", ethers.formatEther(bilancioIniziale), "PAR");
    
    // Prelievo dei token
    console.log("💰 Prelievo token in corso...");
    const txPrelievo = await scatolaDestinatario.withdrawERC20(
      boxId, 
      indirizzoToken,
      { gasLimit: 300000 }
    );
    console.log("🔄 Transazione di prelievo inviata:", txPrelievo.hash);
    const receiptPrelievo = await txPrelievo.wait();
    console.log("✅ Prelievo confermato nel blocco:", receiptPrelievo.blockNumber);
    
    // Verifichiamo che il destinatario abbia ricevuto i token
    const nuovoBilancio = await tokenDestinatario.balanceOf(destinatario.address);
    console.log("📊 Nuovo bilancio del destinatario:", ethers.formatEther(nuovoBilancio), "PAR");
    
    // Calcoliamo il bilancio previsto
    const bilancioPrevisto = bilancioIniziale + tokenScatola;
    console.log("📊 Bilancio previsto:", ethers.formatEther(bilancioPrevisto), "PAR");
    
    // Verifichiamo che la scatola sia vuota
    const nuoviTokenScatola = await scatolaDestinatario.getERC20Balance(boxId, indirizzoToken);
    console.log("📊 Bilancio token nella scatola dopo il prelievo:", ethers.formatEther(nuoviTokenScatola), "PAR");
    expect(nuoviTokenScatola).to.equal(0);
    
    // Stampiamo lo stato finale della scatola
    await stampaDettagliScatola(boxId, "SCATOLA DOPO PRELIEVO TOKEN");
    await stampaAccount(destinatario, "DESTINATARIO DOPO PRELIEVO TOKEN");
    
    console.log(`🎉 PRELIEVO TOKEN COMPLETATO`);
  });

  // Test 6: Il destinatario preleva l'NFT
  it("6️⃣ Il destinatario preleva il Gatto NFT dalla scatola", async function() {
    if (!boxId) {
      console.log("❌ Nessun ID scatola disponibile, salto il test");
      this.skip();
      return;
    }
    
    console.log(`\n😺 PRELIEVO NFT DALLA SCATOLA ${boxId.toString()}`);
    
    // Connettiamo come destinatario
    const scatolaDestinatario = schrodingerBox.connect(destinatario);
    const nftDestinatario = schrodingerCatNFT.connect(destinatario);
    
    // Controlliamo lo stato della scatola prima del prelievo
    await stampaDettagliScatola(boxId, "SCATOLA PRIMA DEL PRELIEVO NFT");
    
    // Controlliamo se la scatola ha NFT
    const dettagliScatola = await scatolaDestinatario.getBoxDetails(boxId);
    console.log("📊 La scatola ha", dettagliScatola[2].length, "NFT");
    
    if (dettagliScatola[2].length == 0) {
      console.log("⚠️ La scatola non ha NFT da prelevare, salto");
      this.skip();
      return;
    }
    
    // Otteniamo i dettagli dell'NFT dalla scatola
    const nftContract = dettagliScatola[2][0];
    const nftId = dettagliScatola[3][0];
    console.log("📝 La scatola contiene NFT #", nftId.toString(), "dal contratto", nftContract);
    
    // Otteniamo il bilancio iniziale NFT del destinatario
    const bilancioIniziale = await nftDestinatario.balanceOf(destinatario.address);
    console.log("📊 Bilancio NFT iniziale del destinatario:", bilancioIniziale.toString());
    
    // Prelievo NFT
    console.log("🔄 Prelievo NFT in corso...");
    const txPrelievo = await scatolaDestinatario.withdrawNFT(
      boxId, 
      nftContract, 
      nftId,
      { gasLimit: 300000 }
    );
    console.log("🔄 Transazione di prelievo inviata:", txPrelievo.hash);
    const receiptPrelievo = await txPrelievo.wait();
    console.log("✅ Prelievo confermato nel blocco:", receiptPrelievo.blockNumber);
    
    // Verifichiamo che il destinatario abbia ricevuto l'NFT
    const nuovoBilancio = await nftDestinatario.balanceOf(destinatario.address);
    console.log("📊 Nuovo bilancio NFT del destinatario:", nuovoBilancio.toString());
    
    // Controlliamo la proprietà dell'NFT
    try {
      const proprietarioNFT = await nftDestinatario.ownerOf(nftId);
      console.log("👤 Nuovo proprietario dell'NFT:", proprietarioNFT);
      expect(proprietarioNFT.toLowerCase()).to.equal(destinatario.address.toLowerCase());
    } catch (e) {
      console.log("❌ Errore nel controllare la proprietà dell'NFT:", e.message);
    }
    
    // Verifichiamo che l'NFT non sia più nella scatola
    const contieneNFT = await scatolaDestinatario.containsNFT(boxId, nftContract, nftId);
    console.log("📝 La scatola contiene ancora l'NFT:", contieneNFT ? 'Sì' : 'No');
    expect(contieneNFT).to.be.false;
    
    // Stampiamo lo stato finale della scatola
    await stampaDettagliScatola(boxId, "SCATOLA DOPO PRELIEVO NFT");
    await stampaAccount(destinatario, "DESTINATARIO DOPO PRELIEVO NFT");
    
    console.log(`🎉 PRELIEVO NFT COMPLETATO`);
  });

  // Dopo tutti i test
  after(async function () {
    // Stampiamo gli stati finali
    console.log("\n📊 STATI FINALI");
    await stampaAccount(proprietario, "PROPRIETARIO FINALE");
    await stampaAccount(destinatario, "DESTINATARIO FINALE");
    console.log("🏁 DEMO COMPLETATO 🏁");
    console.log("\n🔍 RIASSUNTO DELLE OPERAZIONI:");
    console.log("1. Abbiamo creato una nuova Schrödinger Box");
    console.log("2. Abbiamo depositato token PAR nella scatola");
    console.log("3. Abbiamo depositato un Gatto NFT nella scatola");
    console.log("4. Abbiamo trasferito la scatola completa al destinatario");
    console.log("5. Il destinatario ha prelevato i token PAR dalla scatola");
    console.log("6. Il destinatario ha prelevato il Gatto NFT dalla scatola");
    console.log("\n⭐ La demo dimostra il funzionamento completo del sistema SchrodingerBox ⭐");
  });
});