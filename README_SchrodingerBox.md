# Schrödinger Box – Deployment & Testing Manual

## 1. Deployment

### Prerequisiti

* Node.js e npm installati
* Hardhat installato localmente (`npm install --save-dev hardhat`)
* Un wallet con ETH su Holesky e Sepolia (tramite faucet)
* Chiavi private di almeno un account di test

### Compilazione

```bash
npx hardhat compile
```
Assicurarsi di avere il .env con le informazioni base mostrate nel punto 2

### Deploy su Holesky

```bash
npx hardhat run scripts/deploy.js --network holesky
```

### Deploy su Sepolia

```bash
npx hardhat run scripts/deploy.js --network sepolia
```

Gli indirizzi generati vanno salvati nel file `.env` per essere usato nei test.

### Configurazione Trusted Contracts

Dopo il deploy, è necessario collegare i due contratti Box come trusted:

Su Holesky:

```js
const box = await ethers.getContractAt("SchrodingerBox", process.env.HOLESKY_SCHRODINGER_BOX_ADDRESS);
await box.setTrustedContract(
  10002, // Wormhole chainId di Sepolia
  ethers.zeroPadValue(process.env.SEPOLIA_SCHRODINGER_BOX_ADDRESS, 32)
);
```

Su Sepolia:

```js
const box = await ethers.getContractAt("SchrodingerBox", process.env.SEPOLIA_SCHRODINGER_BOX_ADDRESS);
await box.setTrustedContract(
  10004, // Wormhole chainId di Holesky
  ethers.zeroPadValue(process.env.HOLESKY_SCHRODINGER_BOX_ADDRESS, 32)
);
```

---

## 2. File `.env`

Esempio di file `.env` completo:

```ini
# RPC URLs
HOLESKY_RPC_URL=https://ethereum-holesky-rpc.publicnode.com
SEPOLIA_RPC_URL=https://ethereum-sepolia.rpc.subquery.network/public

# Wormhole Relayer endpoints
WORMHOLE_RELAYER_SEPOLIA=0x4a8bc80Ed5a4067f1CCf107057b8270E0cC11A78
WORMHOLE_RELAYER_HOLESKY=0xa10f2eF61dE1f19f586ab8B6F2EbA89bACE63F7a

# Test accounts
TEST_PRIVATE_KEY1=
TEST_PRIVATE_KEY2=

# Etherscan API key (per verifiche e deploy verificato)
ETHERSCAN_API_KEY=YFJTEZB235381EXJYEVHIYX8S6Y4GDFWKQ

# --- ADDRESSES --- Questa parte va compilata con gli indirizzi deployati nuovi

# HOLESKY
HOLESKY_SCHRODINGER_BOX_ADDRESS=0x4BC2a52fBD1f1807083A89BF7DCC248B443219d8
HOLESKY_FEE_COLLECTOR_ADDRESS=0x2a9eEc5e51d7494a5A03de8dC36Ac008dBA54Ed8
HOLESKY_PARADOX_TOKEN_ADDRESS=0xa7dd70dA59140F01f20C5A8385e249656506f202
HOLESKY_SCHRODINGER_CAT_NFT_ADDRESS=0x982F426516383DAD072CFe96DFD7eC9719f381e6

# SEPOLIA (da compilare dopo il deploy)
SEPOLIA_SCHRODINGER_BOX_ADDRESS=
SEPOLIA_FEE_COLLECTOR_ADDRESS=
SEPOLIA_PARADOX_TOKEN_ADDRESS=
SEPOLIA_SCHRODINGER_CAT_NFT_ADDRESS=
```

---

## 3. Testing

### Test single-chain (deposito e prelievo)

```bash
npx hardhat test --network holesky test/demo.test.js
```

Copre:

* Creazione box
* Deposito ERC20 e NFT
* Trasferimento box
* Prelievo asset dal nuovo owner

### Test cross-chain (bridge con Wormhole)

1. Esecuzione su Holesky:

   ```bash
   npx hardhat test --network holesky test/test2.test.js
   ```

   La box viene bridgiata e bloccata.

2. Esecuzione su Sepolia:

   ```bash
   npx hardhat test --network sepolia test/test2.test.js
   ```

   Viene ricevuta una shadow box con stesso `boxId` e contenuti.

---

## 4. Problemi comuni e diagnostica

### Errore `.env` mancante

```
Error: Contract addresses missing for network HOLESKY
```

Causa: mancano le righe `SEPOLIA_*` nel `.env`.

---

### Trusted contract non impostato

```
Error: InvalidTargetChain
```

Causa: non è stato chiamato `setTrustedContract` per collegare Holesky e Sepolia.

---

### Box non ricreata su target chain

Causa: il messaggio Wormhole non è stato inoltrato o non è stato riconosciuto. Verificare che i trusted contracts siano correttamente configurati e che gli indirizzi siano presenti nel `.env`.

---

### Problemi di gas su testnet

```
transaction underpriced
```

Causa: le fee impostate sono troppo basse rispetto alla congestione. Serve aumentare `maxPriorityFeePerGas` e `maxFeePerGas` durante i test.

---

### Replay o box bloccata

Causa: la box resta nello stato `locked` e non viene sbloccata. Occorre eseguire correttamente il flusso di ritorno (`returnShadowBox`) per consentire l'unfreeze.

---

## 5. Stato attuale

* Tutte le operazioni **single-chain** (mint, deposito, prelievo, trasferimento box) funzionano.
* Il bridge cross-chain richiede:

  * Deploy su entrambe le reti
  * Configurazione `.env` completa
  * Impostazione reciproca dei `trustedContracts`

I test falliscono anche se nessuno di questi passaggi manca.
