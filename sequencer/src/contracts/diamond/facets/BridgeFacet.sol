// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {LibAppStorage} from "../libraries/LibAppStorage.sol";
import {LibDiamond} from "../libraries/LibDiamond.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

interface IChallengePeriodOracle {
    function getChallengePeriod(uint256 amount, uint256 batchNumber) external view returns (uint256 period);
}

/**
 * @title BridgeFacet
 * @notice L1 bridge facet for deposits, V3 batch-specific withdrawal queueing, and finalization.
 * @dev Compatibility goals:
 *      - Keep legacy deposit/finalized events for existing listeners.
 *      - Keep old queued withdrawals finalizable from s.withdrawals.
 *      - Add V3 batch-specific withdrawal roots to avoid stale latest-root proofs.
 */
contract BridgeFacet {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_BATCH_QUEUE_SIZE = 50;
    uint256 private constant BLOCKS_PER_ROTATION = 100;
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;

    // ═══════════════════════════════════════════════════════
    // LEGACY EVENTS - keep signatures stable for listeners
    // ═══════════════════════════════════════════════════════

    event Deposited(
        bytes32 indexed depositId,
        address indexed token,
        address indexed from,
        address to,
        uint256 amount,
        uint256 nonce
    );

    event WithdrawalQueued(
        bytes32 indexed withdrawalId,
        address indexed token,
        address indexed to,
        uint256 amount,
        uint256 timestamp
    );

    event WithdrawalFinalized(
        bytes32 indexed withdrawalId,
        address indexed to,
        uint256 amount
    );

    event WithdrawalChallenged(
        bytes32 indexed withdrawalId,
        address indexed challenger
    );

    // ═══════════════════════════════════════════════════════
    // V3 EVENTS
    // ═══════════════════════════════════════════════════════

    event WithdrawalQueuedV3(
        bytes32 indexed withdrawalId,
        uint256 indexed batchNumber,
        address indexed token,
        address to,
        uint256 amount,
        uint256 challengeExpiry
    );

    event WithdrawalFinalizedV3(
        bytes32 indexed withdrawalId,
        uint256 indexed batchNumber,
        address indexed token,
        address to,
        uint256 amount
    );

    event WithdrawalSkipped(bytes32 indexed withdrawalId, string reason);
    event WithdrawalBatchQueued(uint256 indexed batchNumber, uint256 attempted, uint256 succeeded);
    event BatchInvalidated(uint256 indexed batchNumber);
    event DisputeGameUpdated(address indexed oldDisputeGame, address indexed newDisputeGame);
    event ChallengePeriodOracleUpdated(address indexed oldOracle, address indexed newOracle);

    // ═══════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════

    error OnlySequencer();
    error OnlyDisputeGame();
    error InvalidProof();
    error BatchRootNotFound();
    error BatchAlreadyInvalidated();
    error WithdrawalAlreadyQueued();
    error WithdrawalNotQueued();
    error WithdrawalBatchInvalidated();
    error ChallengePeriodNotExpired();
    error WithdrawalAlreadyFinalized();
    error WithdrawalChallengedError();
    error TransferFailed();
    error ZeroAmount();
    error ZeroAddress();
    error ArrayLengthMismatch();
    error MaxBatchSizeExceeded();
    error ContractPaused();
    error ReentrancyGuardReentered();
    error ChallengeProofMismatch();
    error UseDisputeGame();

    // ═══════════════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════════════

    modifier onlySequencer() {
        if (!_isRegisteredSequencer(msg.sender)) revert OnlySequencer();
        _;
    }

    modifier whenNotPaused() {
        if (LibAppStorage.appStorage().paused) revert ContractPaused();
        _;
    }

    modifier nonReentrant() {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        if (s.reentrancyStatus == ENTERED) revert ReentrancyGuardReentered();
        s.reentrancyStatus = ENTERED;
        _;
        s.reentrancyStatus = NOT_ENTERED;
    }

    modifier onlyDisputeGame() {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        if (msg.sender != s.disputeGameAddress || msg.sender == address(0)) revert OnlyDisputeGame();
        _;
    }

    // ═══════════════════════════════════════════════════════
    // DEPOSIT FUNCTIONS (L1 → L2)
    // ═══════════════════════════════════════════════════════

    function depositETH(address to) external payable whenNotPaused {
        if (msg.value == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();

        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        uint256 nonce = s.depositNonce++;
        bytes32 depositId = keccak256(abi.encodePacked(msg.sender, to, msg.value, nonce, block.timestamp));

        emit Deposited(depositId, address(0), msg.sender, to, msg.value, nonce);
    }

    function depositERC20(address token, address to, uint256 amount) external whenNotPaused {
        if (token == address(0)) revert ZeroAddress();
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - balanceBefore;
        if (received == 0) revert ZeroAmount();

        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        uint256 nonce = s.depositNonce++;
        bytes32 depositId = keccak256(abi.encodePacked(token, msg.sender, to, received, nonce, block.timestamp));

        emit Deposited(depositId, token, msg.sender, to, received, nonce);
    }

    // ═══════════════════════════════════════════════════════
    // WITHDRAWAL QUEUEING V3
    // ═══════════════════════════════════════════════════════

    function queueWithdrawalV3(
        uint256 batchNumber,
        bytes32 withdrawalId,
        address token,
        address to,
        uint256 amount,
        bytes32[] calldata proof
    ) external {
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();

        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        _validateBatchRoot(s, batchNumber);
        if (_isQueued(s, withdrawalId)) revert WithdrawalAlreadyQueued();

        bytes32 leaf = _computeLeafForBatch(s, batchNumber, withdrawalId, token, to, amount);
        if (!MerkleProof.verify(proof, _batchWithdrawalRoot(s, batchNumber), leaf)) revert InvalidProof();

        _storeWithdrawal(s, batchNumber, withdrawalId, token, to, amount);
    }

    function queueWithdrawalBatch(
        uint256 batchNumber,
        bytes32[] calldata withdrawalIds,
        address[] calldata tokens,
        address[] calldata tos,
        uint256[] calldata amounts,
        bytes32[][] calldata proofs
    ) external onlySequencer {
        uint256 len = withdrawalIds.length;
        if (tokens.length != len || tos.length != len || amounts.length != len || proofs.length != len) {
            revert ArrayLengthMismatch();
        }
        if (len > MAX_BATCH_QUEUE_SIZE) revert MaxBatchSizeExceeded();

        uint256 successCount = _queueWithdrawalBatch(batchNumber, withdrawalIds, tokens, tos, amounts, proofs);
        emit WithdrawalBatchQueued(batchNumber, len, successCount);
    }

    /**
     * @notice Legacy queue function kept for ABI compatibility only.
     * @dev It cannot fix stale proofs because it has no batch number. New services must use V3 functions.
     */
    function queueWithdrawal(
        bytes32,
        address,
        address,
        uint256,
        bytes memory
    ) external pure {
        revert("BridgeFacet: use queueWithdrawalV3");
    }

    // ═══════════════════════════════════════════════════════
    // WITHDRAWAL FINALIZATION
    // ═══════════════════════════════════════════════════════

    function finalizeWithdrawal(bytes32 withdrawalId) external whenNotPaused nonReentrant {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        LibAppStorage.Withdrawal storage withdrawal = s.withdrawals[withdrawalId];

        if (withdrawal.timestamp == 0) revert WithdrawalNotQueued();
        if (withdrawal.finalized || s.processedWithdrawals[withdrawalId]) revert WithdrawalAlreadyFinalized();
        if (withdrawal.challenged) revert WithdrawalChallengedError();
        if (block.timestamp < _challengeExpiry(s, withdrawal, withdrawalId)) revert ChallengePeriodNotExpired();

        uint256 batchNumber = s.withdrawalBatch[withdrawalId];
        if (batchNumber != 0 && s.batchInvalidated[batchNumber]) revert WithdrawalBatchInvalidated();

        withdrawal.finalized = true;
        s.processedWithdrawals[withdrawalId] = true;

        if (withdrawal.token == address(0)) {
            (bool success, ) = withdrawal.to.call{value: withdrawal.amount}("");
            if (!success) revert TransferFailed();
        } else {
            IERC20(withdrawal.token).safeTransfer(withdrawal.to, withdrawal.amount);
        }

        emit WithdrawalFinalized(withdrawalId, withdrawal.to, withdrawal.amount);
        emit WithdrawalFinalizedV3(withdrawalId, batchNumber, withdrawal.token, withdrawal.to, withdrawal.amount);
    }

    function challengeWithdrawal(bytes32 withdrawalId, bytes memory proof) external whenNotPaused {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        if (msg.sender != s.disputeGameAddress || msg.sender == address(0)) revert OnlyDisputeGame();

        LibAppStorage.Withdrawal storage withdrawal = s.withdrawals[withdrawalId];
        if (withdrawal.timestamp == 0) revert WithdrawalNotQueued();
        if (withdrawal.finalized) revert WithdrawalAlreadyFinalized();
        if (withdrawal.challenged) revert WithdrawalChallengedError();
        if (block.timestamp >= _challengeExpiry(s, withdrawal, withdrawalId)) revert ChallengePeriodNotExpired();

        uint256 batchNumber = s.withdrawalBatch[withdrawalId];
        if (batchNumber == 0) revert BatchRootNotFound();
        if (proof.length != 32 || abi.decode(proof, (uint256)) != batchNumber) revert ChallengeProofMismatch();
        if (s.batchInvalidated[batchNumber]) revert WithdrawalBatchInvalidated();

        withdrawal.challenged = true;
        emit WithdrawalChallenged(withdrawalId, msg.sender);
    }

    // ═══════════════════════════════════════════════════════
    // DISPUTE / ADMIN
    // ═══════════════════════════════════════════════════════

    function invalidateBatch(uint256 batchNumber) external onlyDisputeGame {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        if (s.batchInvalidated[batchNumber]) revert BatchAlreadyInvalidated();
        s.batchInvalidated[batchNumber] = true;
        emit BatchInvalidated(batchNumber);
    }

    function setDisputeGame(address disputeGame) external {
        LibDiamond.enforceIsContractOwner();
        if (disputeGame == address(0)) revert ZeroAddress();
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        address old = s.disputeGameAddress;
        s.disputeGameAddress = disputeGame;
        emit DisputeGameUpdated(old, disputeGame);
    }

    function setChallengePeriod(uint256 period) external {
        LibDiamond.enforceIsContractOwner();
        require(period >= 1 days && period <= 30 days, "BridgeFacet: Invalid period");
        LibAppStorage.appStorage().challengePeriod = period;
    }

    function setChallengePeriodOracle(address oracle) external {
        LibDiamond.enforceIsContractOwner();
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        address old = s.challengePeriodAddress;
        s.challengePeriodAddress = oracle;
        emit ChallengePeriodOracleUpdated(old, oracle);
    }

    function pause() external {
        LibDiamond.enforceIsContractOwner();
        LibAppStorage.appStorage().paused = true;
    }

    function unpause() external {
        LibDiamond.enforceIsContractOwner();
        LibAppStorage.appStorage().paused = false;
    }

    // ═══════════════════════════════════════════════════════
    // VIEWS
    // ═══════════════════════════════════════════════════════

    function getWithdrawal(bytes32 withdrawalId)
        external
        view
        returns (address token, address to, uint256 amount, uint256 timestamp, bool finalized, bool challenged)
    {
        LibAppStorage.Withdrawal memory w = LibAppStorage.appStorage().withdrawals[withdrawalId];
        return (w.token, w.to, w.amount, w.timestamp, w.finalized, w.challenged);
    }

    function getWithdrawalStatus(bytes32 withdrawalId)
        external
        view
        returns (
            bool queued,
            bool finalized,
            uint256 challengeExpiry,
            uint256 batchNumber,
            address token,
            address recipient,
            uint256 amount
        )
    {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        LibAppStorage.Withdrawal memory w = s.withdrawals[withdrawalId];
        batchNumber = s.withdrawalBatch[withdrawalId];
        return (w.timestamp != 0, w.finalized || s.processedWithdrawals[withdrawalId], _challengeExpiry(s, w, withdrawalId), batchNumber, w.token, w.to, w.amount);
    }

    function isWithdrawalProcessed(bytes32 withdrawalId) external view returns (bool) {
        return LibAppStorage.appStorage().processedWithdrawals[withdrawalId];
    }

    function getChallengePeriod() external view returns (uint256) {
        return LibAppStorage.appStorage().challengePeriod;
    }

    function getChallengePeriodOracle() external view returns (address) {
        return LibAppStorage.appStorage().challengePeriodAddress;
    }

    function isBatchInvalidated(uint256 batchNumber) external view returns (bool) {
        return LibAppStorage.appStorage().batchInvalidated[batchNumber];
    }

    function getDisputeGame() external view returns (address) {
        return LibAppStorage.appStorage().disputeGameAddress;
    }

    // ═══════════════════════════════════════════════════════
    // INTERNAL
    // ═══════════════════════════════════════════════════════


    function _challengePeriodFor(
        LibAppStorage.AppStorage storage s,
        uint256 batchNumber,
        uint256 amount
    ) internal view returns (uint256) {
        address oracle = s.challengePeriodAddress;
        if (oracle != address(0)) {
            try IChallengePeriodOracle(oracle).getChallengePeriod(amount, batchNumber) returns (uint256 period) {
                if (period >= 1 days && period <= 30 days) return period;
            } catch {}
        }
        return s.challengePeriod;
    }

    function _challengeExpiry(
        LibAppStorage.AppStorage storage s,
        LibAppStorage.Withdrawal memory withdrawal,
        bytes32 withdrawalId
    ) internal view returns (uint256) {
        if (withdrawal.challengeExpiry != 0) return withdrawal.challengeExpiry;
        return withdrawal.timestamp + _challengePeriodFor(s, s.withdrawalBatch[withdrawalId], withdrawal.amount);
    }

    function _validateBatchRoot(LibAppStorage.AppStorage storage s, uint256 batchNumber) internal view {
        if (_batchWithdrawalRoot(s, batchNumber) == bytes32(0)) revert BatchRootNotFound();
        if (s.batchInvalidated[batchNumber]) revert BatchAlreadyInvalidated();
    }

    function _batchWithdrawalRoot(LibAppStorage.AppStorage storage s, uint256 batchNumber) internal view returns (bytes32) {
        if (s.batchRootSet[batchNumber]) {
            return s.batchWithdrawalRoots[batchNumber];
        }

        // Legacy batches submitted before the V3 storage fields existed only
        // stored their withdrawal root in Batch.stateRoot at the rotation end block.
        uint256 l2BlockNumber = batchNumber * BLOCKS_PER_ROTATION;
        return s.batches[l2BlockNumber].stateRoot;
    }

    function _isQueued(LibAppStorage.AppStorage storage s, bytes32 withdrawalId) internal view returns (bool) {
        return s.withdrawals[withdrawalId].timestamp != 0;
    }

    function _storeWithdrawal(
        LibAppStorage.AppStorage storage s,
        uint256 batchNumber,
        bytes32 withdrawalId,
        address token,
        address to,
        uint256 amount
    ) internal {
        uint256 timestamp = block.timestamp;
        uint256 expiry = timestamp + _challengePeriodFor(s, batchNumber, amount);

        s.withdrawals[withdrawalId] = LibAppStorage.Withdrawal({
            token: token,
            to: to,
            amount: amount,
            timestamp: timestamp,
            finalized: false,
            challenged: false,
            challengeExpiry: expiry
        });
        s.withdrawalBatch[withdrawalId] = batchNumber;

        emit WithdrawalQueued(withdrawalId, token, to, amount, timestamp);
        emit WithdrawalQueuedV3(withdrawalId, batchNumber, token, to, amount, expiry);
    }

    function _queueOneFromBatch(
        LibAppStorage.AppStorage storage s,
        uint256 batchNumber,
        bytes32 batchRoot,
        bytes32 withdrawalId,
        address token,
        address to,
        uint256 amount,
        bytes32[] calldata proof
    ) internal returns (bool) {
        if (_isQueued(s, withdrawalId)) {
            emit WithdrawalSkipped(withdrawalId, "already queued");
            return false;
        }
        if (amount == 0) {
            emit WithdrawalSkipped(withdrawalId, "zero amount");
            return false;
        }
        if (to == address(0)) {
            emit WithdrawalSkipped(withdrawalId, "zero address");
            return false;
        }

        bytes32 leaf = _computeLeafForBatch(s, batchNumber, withdrawalId, token, to, amount);
        if (!MerkleProof.verify(proof, batchRoot, leaf)) {
            emit WithdrawalSkipped(withdrawalId, "invalid proof");
            return false;
        }

        _storeWithdrawal(s, batchNumber, withdrawalId, token, to, amount);
        return true;
    }

    function _queueWithdrawalBatch(
        uint256 batchNumber,
        bytes32[] calldata withdrawalIds,
        address[] calldata tokens,
        address[] calldata tos,
        uint256[] calldata amounts,
        bytes32[][] calldata proofs
    ) internal returns (uint256 successCount) {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        _validateBatchRoot(s, batchNumber);
        bytes32 batchRoot = _batchWithdrawalRoot(s, batchNumber);

        for (uint256 i = 0; i < withdrawalIds.length; i++) {
            if (_queueOneFromBatch(s, batchNumber, batchRoot, withdrawalIds[i], tokens[i], tos[i], amounts[i], proofs[i])) {
                successCount++;
            }
        }
    }

    function _computeLeaf(bytes32 withdrawalId, address token, address to, uint256 amount) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(keccak256(abi.encodePacked(withdrawalId, token, to, amount))));
    }

    function _computeLegacyLeaf(bytes32 withdrawalId, address token, address to, uint256 amount) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(withdrawalId, token, to, amount));
    }

    function _computeLeafForBatch(
        LibAppStorage.AppStorage storage s,
        uint256 batchNumber,
        bytes32 withdrawalId,
        address token,
        address to,
        uint256 amount
    ) internal view returns (bytes32) {
        if (s.batchRootSet[batchNumber]) {
            return _computeLeaf(withdrawalId, token, to, amount);
        }
        return _computeLegacyLeaf(withdrawalId, token, to, amount);
    }

    function _isRegisteredSequencer(address sequencer) internal view returns (bool) {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        for (uint256 i = 0; i < s.activeSequencers.length; i++) {
            if (s.activeSequencers[i] == sequencer) return true;
        }
        return false;
    }

    receive() external payable {}
}
