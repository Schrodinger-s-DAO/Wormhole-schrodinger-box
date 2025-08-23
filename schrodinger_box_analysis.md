# Spiegazione Dettagliata del Contratto Schrodinger Box

## Intestazione e Licenza

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
```

- **SPDX-License-Identifier**: Specifica la licenza MIT per il contratto
- **pragma solidity**: Definisce la versione del compilatore (0.8.24 o superiore)

## Import delle Dipendenze

```solidity
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
```

### Spiegazione degli Import:
- **ERC721Enumerable**: Estende ERC721 con funzionalità di enumerazione (conteggio token)
- **IERC20**: Interfaccia standard per interagire con token ERC20
- **IERC721**: Interfaccia standard per interagire con NFT
- **Ownable**: Fornisce controllo di accesso con un proprietario
- **ReentrancyGuard**: Protegge dalle vulnerabilità di reentrancy

## Interfacce Wormhole

### IWormholeRelayer

```solidity
interface IWormholeRelayer {
    function sendPayloadToEvm(
        uint16 targetChain,
        address targetAddress,
        bytes memory payload,
        uint256 receiverValue,
        uint256 gasLimit
    ) external payable returns (uint64 sequence);

    function quoteEVMDeliveryPrice(
        uint16 targetChain, 
        uint256 receiverValue, 
        uint256 gasLimit
    ) external view returns (uint256 deliveryPrice, uint256 wormholeFee);
}
```

**Funzioni:**
- `sendPayloadToEvm`: Invia un messaggio a un'altra chain EVM
  - `targetChain`: ID della chain di destinazione
  - `targetAddress`: Indirizzo del contratto destinatario
  - `payload`: Dati da inviare
  - `receiverValue`: ETH da inviare al ricevente
  - `gasLimit`: Limite di gas per l'esecuzione
- `quoteEVMDeliveryPrice`: Calcola il costo di invio del messaggio

### IWormholeReceiver

```solidity
interface IWormholeReceiver {
    function receiveWormholeMessages(
        bytes memory payload,
        bytes[] memory additionalVaas,
        bytes32 sourceAddress,
        uint16 sourceChain,
        bytes32 deliveryHash
    ) external payable;
}
```

**Parametri:**
- `payload`: Dati ricevuti
- `additionalVaas`: VAA aggiuntivi (non utilizzati in questo contratto)
- `sourceAddress`: Indirizzo del mittente (formato bytes32)
- `sourceChain`: ID della chain mittente
- `deliveryHash`: Hash di consegna (non utilizzato)

## Dichiarazione del Contratto

```solidity
contract SchrodingerBox is ERC721Enumerable, Ownable, ReentrancyGuard, IWormholeReceiver {
```

**Ereditarietà:**
- **ERC721Enumerable**: Funzionalità NFT con enumerazione
- **Ownable**: Controllo amministrativo
- **ReentrancyGuard**: Protezione reentrancy
- **IWormholeReceiver**: Capacità di ricevere messaggi Wormhole

## Struttura Dati Box

```solidity
struct Box {
    address[] erc20Tokens;      // Array di indirizzi token ERC20
    uint256[] erc20Amounts;     // Array di quantità corrispondenti
    address[] erc721Contracts;  // Array di contratti NFT
    uint256[] erc721TokenIds;   // Array di ID token NFT
    bool isLocked;              // Stato di blocco
    uint16 originChain;         // Chain di origine
    bool isOriginal;            // True se originale, false se shadow
    uint256 creationTime;       // Timestamp di creazione
    bytes32 messageNonce;       // Nonce per prevenzione replay
}
```

**Campi Spiegati:**
- **erc20Tokens/erc20Amounts**: Coppie parallele per gestire token ERC20
- **erc721Contracts/erc721TokenIds**: Coppie parallele per gestire NFT
- **isLocked**: Previene modifiche durante il bridge
- **originChain**: Traccia la chain dove è stata creata
- **isOriginal**: Distingue originali da copie shadow
- **messageNonce**: Previene attacchi replay

## Variabili di Stato

### Sicurezza e Wormhole

```solidity
mapping(bytes32 => bool) public processedMessages;
IWormholeRelayer public immutable wormholeRelayer;
mapping(uint16 => bytes32) public trustedContracts;
uint16 public immutable chainId;
```

- **processedMessages**: Previene replay attacks tracciando messaggi processati
- **wormholeRelayer**: Riferimento immutabile al relayer Wormhole
- **trustedContracts**: Mapping dei contratti fidati su altre chain
- **chainId**: ID della chain corrente (immutabile)

### Gestione Box e Fee

```solidity
mapping(uint256 => Box) public boxes;
address public feeCollector;
uint256 public mintingFee;
uint256 private _tokenIdCounter;
```

- **boxes**: Mapping principale che associa ID box ai dati
- **feeCollector**: Indirizzo che riceve le fee
- **mintingFee**: Costo per creare una nuova box
- **_tokenIdCounter**: Contatore privato per generare ID univoci

### Costanti

```solidity
uint256 public constant GAS_LIMIT = 500000;
uint256 public constant DEFAULT_WORMHOLE_FEE = 0.01 ether;
```

- **GAS_LIMIT**: Limite gas fisso per messaggi cross-chain
- **DEFAULT_WORMHOLE_FEE**: Fee di fallback per testnet

## Eventi

```solidity
event BoxMinted(address indexed owner, uint256 indexed boxId);
event ERC20Deposited(uint256 indexed boxId, address indexed token, uint256 amount);
event ERC20Withdrawn(uint256 indexed boxId, address indexed token, uint256 amount);
event NFTDeposited(uint256 indexed boxId, address indexed nftContract, uint256 nftTokenId);
event NFTWithdrawn(uint256 indexed boxId, address indexed nftContract, uint256 nftTokenId);
event BoxBridged(uint256 indexed boxId, uint16 indexed dstChainId, bytes32 indexed targetContract);
event BoxReceived(uint256 indexed boxId, address indexed receiver);
event ShadowBoxReturned(uint256 indexed boxId, uint16 indexed originalChain);
event MintingFeeUpdated(uint256 newFee);
event FeeCollectorUpdated(address newFeeCollector);
event TrustedContractUpdated(uint16 chainId, bytes32 contractAddress);
event BridgeError(string reason);
event DebugLog(string action, uint16 targetChain, bytes32 targetContract, uint256 value);
```

**Categorie di Eventi:**
1. **Box Operations**: Mint, deposit, withdraw
2. **Bridge Operations**: Bridge, receive, return
3. **Administrative**: Fee updates, trusted contracts
4. **Debug**: Error logging e troubleshooting

## Errori Personalizzati

```solidity
error NotBoxOwner();
error BoxLocked();
error BoxNotLocked();
error InsufficientBalance();
error InsufficientMintingFee();
error InsufficientWormholeFee();
error FeeSendFailed();
error UntrustedSource();
error NotOriginalBox();
error NotShadowBox();
error InvalidTargetChain();
error InvalidAddress();
error NotWormholeRelayer();
error MessageAlreadyProcessed();
error ArrayLengthMismatch();
error BridgeFailed(string reason);
```

**Vantaggi degli Errori Personalizzati:**
- Più efficienti in gas rispetto a require con stringa
- Codice più leggibile
- Migliore debugging

## Constructor

```solidity
constructor(
    address _wormholeRelayer,
    uint16 _chainId,
    address initialOwner
) ERC721("Schrodinger Box", "SBOX") Ownable(initialOwner) {
    require(_wormholeRelayer != address(0), "Invalid relayer address");
    wormholeRelayer = IWormholeRelayer(_wormholeRelayer);
    chainId = _chainId;
    feeCollector = initialOwner;
    _tokenIdCounter = 0;
}
```

**Inizializzazione:**
1. Chiama constructor di ERC721 con nome e simbolo
2. Imposta owner iniziale
3. Valida e salva indirizzo Wormhole Relayer
4. Imposta chain ID
5. Inizializza fee collector
6. Reset contatore token ID

## Modificatori

```solidity
modifier onlyWormholeRelayer() {
    if (msg.sender != address(wormholeRelayer)) revert NotWormholeRelayer();
    _;
}
```

**Scopo:** Garantisce che solo il Wormhole Relayer possa chiamare certe funzioni

## Funzioni Interne

### _nextTokenId

```solidity
function _nextTokenId() internal returns (uint256) {
    unchecked {
        _tokenIdCounter++;
    }
    return _tokenIdCounter;
}
```

**Funzione:** Incrementa e restituisce il prossimo ID token
**unchecked:** Ottimizzazione gas (overflow impossibile in pratica)

## Funzioni Amministrative

### setFeeCollector

```solidity
function setFeeCollector(address _feeCollector) external onlyOwner {
    if (_feeCollector == address(0)) revert InvalidAddress();
    feeCollector = _feeCollector;
    emit FeeCollectorUpdated(_feeCollector);
}
```

**Scopo:** Aggiorna l'indirizzo che riceve le fee
**Validazione:** Previene impostazione di indirizzo zero

### setMintingFee

```solidity
function setMintingFee(uint256 _fee) external onlyOwner {
    mintingFee = _fee;
    emit MintingFeeUpdated(_fee);
}
```

**Scopo:** Aggiorna la fee per creare nuove box

### setTrustedContract

```solidity
function setTrustedContract(uint16 _chainId, bytes32 _contractAddress) external onlyOwner {
    trustedContracts[_chainId] = _contractAddress;
    emit TrustedContractUpdated(_chainId, _contractAddress);
}
```

**Scopo:** Configura contratti fidati su altre chain per comunicazione

## Funzione mintBox

```solidity
function mintBox() external payable returns (uint256) {
    // Check minting fee
    if (mintingFee > 0) {
        if (msg.value < mintingFee) revert InsufficientMintingFee();
        
        // Transfer fee to fee collector
        (bool success, ) = payable(feeCollector).call{value: mintingFee}("");
        if (!success) revert FeeSendFailed();
        
        // Refund excess
        if (msg.value > mintingFee) {
            payable(msg.sender).transfer(msg.value - mintingFee);
        }
    }

    uint256 boxId = _nextTokenId();
    
    boxes[boxId] = Box({
        erc20Tokens: new address[](0),
        erc20Amounts: new uint256[](0),
        erc721Contracts: new address[](0),
        erc721TokenIds: new uint256[](0),
        isLocked: false,
        originChain: chainId,
        isOriginal: true,
        creationTime: block.timestamp,
        messageNonce: bytes32(0)
    });

    _safeMint(msg.sender, boxId);
    emit BoxMinted(msg.sender, boxId);
    return boxId;
}
```

**Flusso di Esecuzione:**
1. **Controllo Fee**: Verifica pagamento corretto
2. **Trasferimento Fee**: Invia al collector con gestione errori
3. **Rimborso**: Restituisce eccesso automaticamente
4. **Creazione Box**: Inizializza struttura vuota
5. **Minting NFT**: Crea e assegna token
6. **Eventi**: Emette evento di creazione

## Gestione ERC20

### depositERC20

```solidity
function depositERC20(
    uint256 boxId, 
    address token, 
    uint256 amount
) external nonReentrant {
    if (ownerOf(boxId) != msg.sender) revert NotBoxOwner();
    if (boxes[boxId].isLocked) revert BoxLocked();

    // Verifica se il token è già presente
    for (uint i = 0; i < boxes[boxId].erc20Tokens.length; i++) {
        if (boxes[boxId].erc20Tokens[i] == token) {
            // Aggiorna l'importo esistente invece di aggiungere un nuovo token
            IERC20(token).transferFrom(msg.sender, address(this), amount);
            boxes[boxId].erc20Amounts[i] += amount;
            emit ERC20Deposited(boxId, token, amount);
            return;
        }
    }

    // Aggiungi nuovo token
    IERC20(token).transferFrom(msg.sender, address(this), amount);
    
    boxes[boxId].erc20Tokens.push(token);
    boxes[boxId].erc20Amounts.push(amount);
    
    emit ERC20Deposited(boxId, token, amount);
}
```

**Logica:**
1. **Validazioni**: Owner e stato unlocked
2. **Ricerca Token**: Controlla se già presente
3. **Token Esistente**: Somma all'importo corrente
4. **Nuovo Token**: Aggiunge agli array
5. **Trasferimento**: Sposta token alla box
6. **Eventi**: Log dell'operazione

### withdrawERC20

```solidity
function withdrawERC20(
    uint256 boxId, 
    address token
) external nonReentrant {
    if (ownerOf(boxId) != msg.sender) revert NotBoxOwner();
    if (boxes[boxId].isLocked) revert BoxLocked();

    for (uint i = 0; i < boxes[boxId].erc20Tokens.length; i++) {
        if (boxes[boxId].erc20Tokens[i] == token) {
            uint256 amount = boxes[boxId].erc20Amounts[i];
            
            // Remove token from arrays using last element swap method
            boxes[boxId].erc20Tokens[i] = boxes[boxId].erc20Tokens[boxes[boxId].erc20Tokens.length - 1];
            boxes[boxId].erc20Amounts[i] = boxes[boxId].erc20Amounts[boxes[boxId].erc20Amounts.length - 1];
            
            boxes[boxId].erc20Tokens.pop();
            boxes[boxId].erc20Amounts.pop();

            IERC20(token).transfer(msg.sender, amount);
            emit ERC20Withdrawn(boxId, token, amount);
            return;
        }
    }
    
    revert InsufficientBalance();
}
```

**Tecnica Swap-and-Pop:**
1. **Trova Token**: Cerca nell'array
2. **Swap**: Sostituisce con ultimo elemento
3. **Pop**: Rimuove ultimo elemento
4. **Trasferimento**: Invia token al proprietario

**Vantaggio:** O(1) invece di O(n) per rimozione

## Gestione NFT

### depositNFT

```solidity
function depositNFT(
    uint256 boxId, 
    address nftContract, 
    uint256 tokenId
) external nonReentrant {
    if (ownerOf(boxId) != msg.sender) revert NotBoxOwner();
    if (boxes[boxId].isLocked) revert BoxLocked();

    IERC721(nftContract).transferFrom(msg.sender, address(this), tokenId);
    
    boxes[boxId].erc721Contracts.push(nftContract);
    boxes[boxId].erc721TokenIds.push(tokenId);
    
    emit NFTDeposited(boxId, nftContract, tokenId);
}
```

**Processo:**
1. **Validazioni**: Owner e unlock state
2. **Trasferimento**: Sposta NFT alla box
3. **Storage**: Aggiunge ai rispettivi array
4. **Eventi**: Log dell'operazione

### withdrawNFT

```solidity
function withdrawNFT(
    uint256 boxId, 
    address nftContract, 
    uint256 tokenId
) external nonReentrant {
    if (ownerOf(boxId) != msg.sender) revert NotBoxOwner();
    if (boxes[boxId].isLocked) revert BoxLocked();

    for (uint i = 0; i < boxes[boxId].erc721Contracts.length; i++) {
        if (boxes[boxId].erc721Contracts[i] == nftContract && 
            boxes[boxId].erc721TokenIds[i] == tokenId) {
            
            // Remove NFT from arrays using last element swap method
            boxes[boxId].erc721Contracts[i] = boxes[boxId].erc721Contracts[boxes[boxId].erc721Contracts.length - 1];
            boxes[boxId].erc721TokenIds[i] = boxes[boxId].erc721TokenIds[boxes[boxId].erc721TokenIds.length - 1];
            
            boxes[boxId].erc721Contracts.pop();
            boxes[boxId].erc721TokenIds.pop();

            IERC721(nftContract).transferFrom(address(this), msg.sender, tokenId);
            emit NFTWithdrawn(boxId, nftContract, tokenId);
            return;
        }
    }
    
    revert InsufficientBalance();
}
```

**Simile a withdrawERC20** ma con ricerca su entrambi i parametri (contratto + tokenId)

## Calcolo Fee Wormhole

```solidity
function getWormholeFee(uint16 targetChain) public view returns (uint256) {
    // Improved fee calculation with fallback
    try wormholeRelayer.quoteEVMDeliveryPrice(
        targetChain, 
        0, // No receiver value 
        GAS_LIMIT
    ) returns (uint256 deliveryPrice, uint256) {
        return deliveryPrice;
    } catch {
        // Fallback for unsupported testnets
        return DEFAULT_WORMHOLE_FEE;
    }
}
```

**Strategia:**
1. **Try**: Usa quote ufficiale
2. **Catch**: Fallback per testnet non supportate

## Generazione Nonce

```solidity
function generateMessageNonce(uint256 boxId) internal view returns (bytes32) {
    return keccak256(abi.encodePacked(
        address(this),
        boxId,
        block.timestamp,
        block.number,
        msg.sender
    ));
}
```

**Entropia:** Combina multipli fattori per unicità garantita

## Bridge Box Function

```solidity
function bridgeBox(
    uint16 targetChain,
    address receiver,
    uint256 boxId
) external payable nonReentrant {
    if (ownerOf(boxId) != msg.sender) revert NotBoxOwner();
    if (boxes[boxId].isLocked) revert BoxLocked();
    if (targetChain == chainId) revert InvalidTargetChain();
    
    bytes32 targetContract = trustedContracts[targetChain];
    if (targetContract == bytes32(0)) revert InvalidTargetChain();

    // Verifica integrità della box
    if (boxes[boxId].erc20Tokens.length != boxes[boxId].erc20Amounts.length) revert ArrayLengthMismatch();
    if (boxes[boxId].erc721Contracts.length != boxes[boxId].erc721TokenIds.length) revert ArrayLengthMismatch();

    // Genera un nonce univoco per questo messaggio
    bytes32 messageNonce = generateMessageNonce(boxId);
    boxes[boxId].messageNonce = messageNonce;
    
    // Prepare message for the target
    bytes memory payload = abi.encode(
        uint8(1), // action: 1 = bridge
        boxId,
        boxes[boxId],
        receiver,
        messageNonce
    );

    // Send message with Wormhole - improved error handling
    uint256 wormholeFee = getWormholeFee(targetChain);
    if (msg.value < wormholeFee) revert InsufficientWormholeFee();
    
    // Debug log for troubleshooting
    emit DebugLog("Bridging", targetChain, targetContract, msg.value);
    
    try wormholeRelayer.sendPayloadToEvm{value: wormholeFee}(
        targetChain,
        address(uint160(uint256(targetContract))), // Converte bytes32 in address
        payload,
        0, // No additional fee
        GAS_LIMIT
    ) returns (uint64) {
        // Only lock the box if the bridging was successful
        boxes[boxId].isLocked = true;
        
        // Refund excess fee
        if (msg.value > wormholeFee) {
            payable(msg.sender).transfer(msg.value - wormholeFee);
        }
        
        emit BoxBridged(boxId, targetChain, targetContract);
    } catch Error(string memory reason) {
        // Log and rethrow specific errors
        emit BridgeError(reason);
        revert BridgeFailed(reason);
    } catch {
        // Handle unknown errors
        emit BridgeError("Unknown error");
        revert BridgeFailed("Unknown error");
    }
}
```

**Flusso Complesso:**
1. **Validazioni Multiple**: Owner, stato, chain, contratti
2. **Integrità Dati**: Verifica consistenza array
3. **Nonce Generation**: Crea identificatore univoco
4. **Payload Encoding**: Prepara messaggio strutturato
5. **Fee Management**: Calcolo e verifica
6. **Wormhole Call**: Invio con try-catch robusto
7. **State Update**: Lock box solo se successo
8. **Cleanup**: Rimborso eccesso fee

## Return Shadow Box

```solidity
function returnShadowBox(uint256 boxId) external payable nonReentrant {
    if (ownerOf(boxId) != msg.sender) revert NotBoxOwner();
    if (boxes[boxId].isOriginal) revert NotShadowBox();
    
    uint16 targetChain = boxes[boxId].originChain;
    bytes32 targetContract = trustedContracts[targetChain];
    if (targetContract == bytes32(0)) revert InvalidTargetChain();

    // Verifica integrità della box
    if (boxes[boxId].erc20Tokens.length != boxes[boxId].erc20Amounts.length) revert ArrayLengthMismatch();
    if (boxes[boxId].erc721Contracts.length != boxes[boxId].erc721TokenIds.length) revert ArrayLengthMismatch();
    
    // Genera un nonce univoco per questo messaggio
    bytes32 messageNonce = generateMessageNonce(boxId);
    
    // Prepare message for the target
    bytes memory payload = abi.encode(
        uint8(2), // action: 2 = return
        boxId,
        boxes[boxId],
        msg.sender,
        messageNonce
    );

    // Send message with Wormhole - improved error handling
    uint256 wormholeFee = getWormholeFee(targetChain);
    if (msg.value < wormholeFee) revert InsufficientWormholeFee();
    
    // Debug log for troubleshooting
    emit DebugLog("Returning", targetChain, targetContract, msg.value);
    
    try wormholeRelayer.sendPayloadToEvm{value: wormholeFee}(
        targetChain,
        address(uint160(uint256(targetContract))), // Converte bytes32 in address
        payload,
        0, // No additional fee
        GAS_LIMIT
    ) returns (uint64) {
        // Burn the shadow box
        _burn(boxId);
        
        // Refund excess fee
        if (msg.value > wormholeFee) {
            payable(msg.sender).transfer(msg.value - wormholeFee);
        }
        
        emit ShadowBoxReturned(boxId, targetChain);
    } catch Error(string memory reason) {
        // Log and rethrow specific errors
        emit BridgeError(reason);
        revert BridgeFailed(reason);
    } catch {
        // Handle unknown errors
        emit BridgeError("Unknown error");
        revert BridgeFailed("Unknown error");
    }
}
```

**Differenze da bridgeBox:**
- **Validazione**: Solo shadow box
- **Target**: Chain di origine
- **Action**: 2 invece di 1
- **Finale**: Burn invece di lock

## Receive Wormhole Messages

```solidity
function receiveWormholeMessages(
    bytes memory payload,
    bytes[] memory, // additionalVaas non utilizzato
    bytes32 sourceAddress,
    uint16 sourceChain,
    bytes32 // deliveryHash non utilizzato
) external payable override onlyWormholeRelayer {
    // Verifica che il mittente sia un contratto fidato
    bytes32 expectedSourceAddress = trustedContracts[sourceChain];
    if (expectedSourceAddress != sourceAddress) revert UntrustedSource();
    
    // Decodifica il payload
    (uint8 action, uint256 boxId, Box memory boxData, address receiver, bytes32 messageNonce) = abi.decode(
        payload,
        (uint8, uint256, Box, address, bytes32)
    );
    
    // Verifica che questo messaggio non sia già stato processato (prevenzione replay)
    if (processedMessages[messageNonce]) revert MessageAlreadyProcessed();
    processedMessages[messageNonce] = true;
    
    // Verifica integrità dei dati della box
    if (boxData.erc20Tokens.length != boxData.erc20Amounts.length) revert ArrayLengthMismatch();
    if (boxData.erc721Contracts.length != boxData.erc721TokenIds.length) revert ArrayLengthMismatch();
    
    if (action == 1) {
        // Bridge action: Create shadow box
        if (_tokenIdCounter < boxId) {
            _tokenIdCounter = boxId; // Assicura che il contatore sia aggiornato
        }
        
        boxData.isOriginal = false;
        boxData.messageNonce = messageNonce;
        boxes[boxId] = boxData;
        _safeMint(receiver, boxId);
        
        emit BoxReceived(boxId, receiver);
    } else if (action == 2) {
        // Return action: Unlock original box
        if (!boxData.isOriginal || boxData.originChain != chainId) revert NotOriginalBox();
        if (!boxes[boxId].isLocked) revert BoxNotLocked();
        
        boxes[boxId].isLocked = false;
        
        emit BoxReceived(boxId, receiver);
    }
}
```

**Flusso di Ricezione:**
1. **Security**: Solo Wormhole Relayer
2. **Trust**: Verifica mittente fidato
3. **Decoding**: Estrae dati strutturati
4. **Replay Protection**: Controlla nonce
5. **Integrity**: Valida consistenza dati
6. **Action Routing**:
   - **Action 1**: Crea shadow box
   - **Action 2**: Sblocca originale

## Funzioni di Query

### getBoxDetails

```solidity
function getBoxDetails(uint256 boxId) external view returns (
    address[] memory erc20Tokens,
    uint256[] memory erc20Amounts,
    address[] memory erc721Contracts,
    uint256[] memory erc721TokenIds,
    bool isLocked,
    uint16 originChain,
    bool isOriginal
) {
    Box storage box = boxes[boxId];
    return (
        box.erc20Tokens,
        box.erc20Amounts,
        box.erc721Contracts,
        box.erc721TokenIds,
        box.isLocked,
        box.originChain,
        box.isOriginal
    );
}
```

**Scopo:** Fornisce vista completa della box

### getERC20Balance

```solidity
function getERC20Balance(uint256 boxId, address token) external view returns (uint256 amount) {
    Box storage box = boxes[boxId];
    for (uint i = 0; i < box.erc20Tokens.length; i++) {
        if (box.erc20Tokens[i] == token) {
            return box.erc20Amounts[i];
        }
    }
    return 0;
}
```

**Scopo:** Controlla quantità specifica di token ERC20

### containsNFT

```solidity
function containsNFT(uint256 boxId, address nftContract, uint256 tokenId) external view returns (bool exists) {
    Box storage box = boxes[boxId];
    for (uint i = 0; i < box.erc721Contracts.length; i++) {
        if (box.erc721Contracts[i] == nftContract && box.erc721TokenIds[i] == tokenId) {
            return true;
        }
    }
    return false;
}
```

**Scopo:** Verifica presenza di NFT specifico