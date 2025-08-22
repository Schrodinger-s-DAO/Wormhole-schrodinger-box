// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @notice Interface for Wormhole Relayer
 */
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

/**
 * @notice Interface for a contract which can receive Wormhole messages.
 */
interface IWormholeReceiver {
    function receiveWormholeMessages(
        bytes memory payload,
        bytes[] memory additionalVaas,
        bytes32 sourceAddress,
        uint16 sourceChain,
        bytes32 deliveryHash
    ) external payable;
}

contract SchrodingerBox is ERC721Enumerable, Ownable, ReentrancyGuard, IWormholeReceiver {
    struct Box {
        address[] erc20Tokens;
        uint256[] erc20Amounts;
        address[] erc721Contracts;
        uint256[] erc721TokenIds;
        bool isLocked;
        uint16 originChain;
        bool isOriginal;
        uint256 creationTime;
        bytes32 messageNonce; // Per prevenire replay attack
    }

    // Prevenzione replay attack
    mapping(bytes32 => bool) public processedMessages;
    
    // Wormhole specifico
    IWormholeRelayer public immutable wormholeRelayer;
    
    // Mappings di configurazione
    mapping(uint16 => bytes32) public trustedContracts;
    uint16 public immutable chainId;
    
    // Boxes
    mapping(uint256 => Box) public boxes;

    // Fee management
    address public feeCollector;
    uint256 public mintingFee;
    uint256 private _tokenIdCounter;

    // Variabili di sicurezza
    uint256 public constant GAS_LIMIT = 500000;
    uint256 public constant DEFAULT_WORMHOLE_FEE = 0.01 ether; // Default fee for testnets

    // Events
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

    // Errors
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

    /**
     * @dev Verifica che il mittente sia il Wormhole Relayer
     */
    modifier onlyWormholeRelayer() {
        if (msg.sender != address(wormholeRelayer)) revert NotWormholeRelayer();
        _;
    }

    /**
     * @dev Incrementa e restituisce il prossimo token ID
     */
    function _nextTokenId() internal returns (uint256) {
        unchecked {
            _tokenIdCounter++;
        }
        return _tokenIdCounter;
    }

    /**
     * @dev Aggiorna l'indirizzo del fee collector
     * @param _feeCollector Nuovo indirizzo del fee collector
     */
    function setFeeCollector(address _feeCollector) external onlyOwner {
        if (_feeCollector == address(0)) revert InvalidAddress();
        feeCollector = _feeCollector;
        emit FeeCollectorUpdated(_feeCollector);
    }

    /**
     * @dev Aggiorna la fee di minting
     * @param _fee Nuova fee di minting
     */
    function setMintingFee(uint256 _fee) external onlyOwner {
        mintingFee = _fee;
        emit MintingFeeUpdated(_fee);
    }

    /**
     * @dev Configura un contratto fidato su un'altra chain
     * @param _chainId ID della chain di destinazione
     * @param _contractAddress Indirizzo del contratto (in formato bytes32)
     */
    function setTrustedContract(uint16 _chainId, bytes32 _contractAddress) external onlyOwner {
        trustedContracts[_chainId] = _contractAddress;
        emit TrustedContractUpdated(_chainId, _contractAddress);
    }

    /**
     * @dev Crea una nuova Box
     * @return ID della nuova Box
     */
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

    /**
     * @dev Deposita token ERC20 nella Box
     * @param boxId ID della Box
     * @param token Indirizzo del token ERC20
     * @param amount Quantità da depositare
     */
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

    /**
     * @dev Ritira token ERC20 dalla Box
     * @param boxId ID della Box
     * @param token Indirizzo del token ERC20 da ritirare
     */
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

    /**
     * @dev Deposita un NFT nella Box
     * @param boxId ID della Box
     * @param nftContract Indirizzo del contratto NFT
     * @param tokenId ID del token NFT da depositare
     */
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

    /**
     * @dev Ritira un NFT dalla Box
     * @param boxId ID della Box
     * @param nftContract Indirizzo del contratto NFT
     * @param tokenId ID del token NFT da ritirare
     */
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

    /**
     * @dev Calcola la fee di Wormhole per inviare messaggi ad un'altra chain
     * @param targetChain ID della chain di destinazione
     * @return Quantità di ETH necessaria per la fee
     */
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

    /**
     * @dev Genera un nonce univoco per i messaggi
     */
    function generateMessageNonce(uint256 boxId) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(
            address(this),
            boxId,
            block.timestamp,
            block.number,
            msg.sender
        ));
    }

    /**
     * @dev Invia la Box a un'altra chain
     * @param targetChain ID della chain di destinazione
     * @param receiver Indirizzo del ricevente sulla chain di destinazione
     * @param boxId ID della Box da inviare
     */
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

    /**
     * @dev Restituisce una shadow box alla chain originale
     * @param boxId ID della shadow box
     */
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

    /**
     * @dev Implementazione dell'interfaccia IWormholeReceiver
     * Riceve messaggi da Wormhole e gestisce la creazione/sblocco delle box
     */
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

    /**
     * @dev Ottiene dettagli della Box
     * @param boxId ID della Box
     * @return erc20Tokens Array di indirizzi dei token ERC20
     * @return erc20Amounts Array delle quantità dei token ERC20
     * @return erc721Contracts Array degli indirizzi dei contratti NFT
     * @return erc721TokenIds Array degli ID dei token NFT
     * @return isLocked Stato di blocco della Box
     * @return originChain Chain di origine della Box
     * @return isOriginal Indica se la Box è originale o shadow
     */
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

    /**
     * @dev Controlla se la Box contiene un determinato token ERC20
     * @param boxId ID della Box
     * @param token Indirizzo del token ERC20
     * @return amount Quantità del token nella Box
     */
    function getERC20Balance(uint256 boxId, address token) external view returns (uint256 amount) {
        Box storage box = boxes[boxId];
        for (uint i = 0; i < box.erc20Tokens.length; i++) {
            if (box.erc20Tokens[i] == token) {
                return box.erc20Amounts[i];
            }
        }
        return 0;
    }

    /**
     * @dev Controlla se la Box contiene un determinato NFT
     * @param boxId ID della Box
     * @param nftContract Indirizzo del contratto NFT
     * @param tokenId ID del token NFT
     * @return exists True se l'NFT è nella Box
     */
    function containsNFT(uint256 boxId, address nftContract, uint256 tokenId) external view returns (bool exists) {
        Box storage box = boxes[boxId];
        for (uint i = 0; i < box.erc721Contracts.length; i++) {
            if (box.erc721Contracts[i] == nftContract && box.erc721TokenIds[i] == tokenId) {
                return true;
            }
        }
        return false;
    }
}