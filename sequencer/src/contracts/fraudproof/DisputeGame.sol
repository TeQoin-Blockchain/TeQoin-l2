// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {FaultProofVM} from "./FaultProofVM.sol";

interface IBondManager {
    function lockBond(address party, uint256 disputeId) external payable;
    function lockStakeBond(address party, uint256 disputeId) external;
    function slashBond(address loser, uint256 disputeId) external returns (uint256 winnerShare);
    function refundBond(address party, uint256 disputeId) external;
    function rewardWinner(address winner, uint256 disputeId, uint256 amount) external;
    function bondAmount() external view returns (uint256);
}

interface IFaultProofVM {
    function verifyStep(bytes32 preHash, bytes32 postHash, FaultProofVM.TransitionClaim calldata claim)
        external returns (bool valid, string memory reason);
}

interface IBridgeFacet {
    function invalidateBatch(uint256 batchNumber) external;
}

interface IStateCommitmentFacet {
    function getStateCommitment(uint256 batchNumber) external view returns (
        uint256 l2StartBlock,
        uint256 l2EndBlock,
        bytes32 preStateRoot,
        bytes32 postStateRoot,
        bytes32 transactionsRoot,
        bytes32 withdrawalsRoot,
        uint256 timestamp,
        address sequencer,
        bool exists
    );
}

interface IChallengePeriod {
    function recordBatchDisputed() external;
}

/**
 * @title DisputeGame
 * @author TeQoin
 * @notice Interactive bisection fraud proof protocol.
 *
 * Lifecycle:
 *   1. startDispute()    — challenger posts bond, dispute begins
 *   2. respondBisection() — parties alternate narrowing the range
 *   3. resolveDispute()   — single step verified by FaultProofVM
 *   4. timeout()          — forfeit if party doesn't respond in time
 *
 * The dispute narrows N transactions to 1 in log2(N) rounds.
 * Each round, the active party must claim a state root at the midpoint.
 * When range = 1, FaultProofVM verifies the single step.
 */
contract DisputeGame {

    // ═══════════════════════════════════════════════════════
    // TYPES
    // ═══════════════════════════════════════════════════════

    enum DisputeStatus {
        NONE,
        BISECTING,       // Parties are bisecting
        RESOLVED_CHALLENGER_WIN,
        RESOLVED_DEFENDER_WIN,
        TIMEOUT_CHALLENGER_WIN,
        TIMEOUT_DEFENDER_WIN
    }

    enum Turn {
        CHALLENGER,
        DEFENDER
    }

    struct Dispute {
        uint256 batchNumber;
        address challenger;
        address defender;          // sequencer who submitted the batch
        DisputeStatus status;
        Turn currentTurn;

        // Bisection range
        uint256 rangeStart;        // first step in dispute
        uint256 rangeEnd;          // last step in dispute
        uint256 agreedStep;        // highest step both parties agree on
        bytes32 agreedStateRoot;   // state root both agree on at agreedStep

        // Claims
        bytes32 challengerClaim;   // challenger's claimed state at disputed point
        bytes32 defenderClaim;     // defender's claimed state at disputed point
        uint256 disputedStep;      // the step currently being disputed

        // Timing
        uint256 createdAt;
        uint256 lastActionAt;
        uint256 roundCount;
    }

    // ═══════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════

    IBondManager public bondManager;
    IFaultProofVM public faultProofVM;
    address public diamond;         // Diamond proxy for state commitments and invalidation
    address public challengePeriod; // Optional authenticated stats sink
    address public owner;

    /// @notice Time limit per response (seconds)
    uint256 public responseTimeout;

    /// @notice Maximum concurrent disputes per batch
    uint256 public maxDisputesPerBatch;

    /// @notice Dispute counter
    uint256 public nextDisputeId;

    /// @notice All disputes
    mapping(uint256 => Dispute) public disputes;

    /// @notice Active dispute count per batch
    mapping(uint256 => uint256) public activeDisputeCount;

    /// @notice Whether a batch has been proven fraudulent
    mapping(uint256 => bool) public batchProvenFraudulent;

    // ═══════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════

    event DisputeStarted(
        uint256 indexed disputeId,
        uint256 indexed batchNumber,
        address indexed challenger,
        address defender
    );

    event BisectionStep(
        uint256 indexed disputeId,
        Turn turn,
        uint256 step,
        bytes32 claimedStateRoot,
        uint256 roundCount
    );

    event DisputeResolved(
        uint256 indexed disputeId,
        DisputeStatus status,
        address winner,
        address loser
    );

    event DisputeTimedOut(
        uint256 indexed disputeId,
        Turn timedOutParty
    );

    // ═══════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════

    error OnlyOwner();
    error DisputeNotFound();
    error DisputeNotActive();
    error NotYourTurn();
    error BatchNotFound();
    error BatchAlreadyFraudulent();
    error TooManyDisputes();
    error TimeoutNotReached();
    error TimeoutAlreadyPassed();
    error RangeNotNarrowedToOne();
    error InsufficientBond();
    error CannotDisputeOwnBatch();
    error ZeroAddress();
    error InvalidClaim();

    // ═══════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════

    constructor(
        address _bondManager,
        address _faultProofVM,
        address _diamond,
        uint256 _responseTimeout,
        uint256 _maxDisputesPerBatch
    ) {
        if (_bondManager == address(0) || _faultProofVM == address(0) || _diamond == address(0)) {
            revert ZeroAddress();
        }
        bondManager = IBondManager(_bondManager);
        faultProofVM = IFaultProofVM(_faultProofVM);
        diamond = _diamond;
        responseTimeout = _responseTimeout;
        maxDisputesPerBatch = _maxDisputesPerBatch;
        owner = msg.sender;
        nextDisputeId = 1;
    }

    // ═══════════════════════════════════════════════════════
    // START DISPUTE
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Start a dispute against a specific batch.
     *         Challenger must send exactly bondAmount in ETH.
     *         The challenger claims the postStateRoot is wrong.
     *
     * @param _batchNumber       Batch to dispute
     * @param _challengerPostRoot Challenger's claimed correct postStateRoot
     */
    function startDispute(
        uint256 _batchNumber,
        bytes32 _challengerPostRoot
    ) external payable returns (uint256 disputeId) {
        (
            uint256 startBlock,
            uint256 endBlock,
            bytes32 preStateRoot,
            bytes32 defenderPostRoot,
            ,
            ,
            ,
            address batchSequencer,
            bool exists
        ) = IStateCommitmentFacet(diamond).getStateCommitment(_batchNumber);

        if (!exists) revert BatchNotFound();
        if (batchProvenFraudulent[_batchNumber]) revert BatchAlreadyFraudulent();
        if (activeDisputeCount[_batchNumber] >= maxDisputesPerBatch) revert TooManyDisputes();
        if (_challengerPostRoot == bytes32(0) || _challengerPostRoot == defenderPostRoot) {
            revert InvalidClaim();
        }

        // Can't dispute your own batch
        if (msg.sender == batchSequencer) revert CannotDisputeOwnBatch();

        // Post bond
        uint256 requiredBond = bondManager.bondAmount();
        if (msg.value < requiredBond) revert InsufficientBond();

        disputeId = nextDisputeId++;

        bondManager.lockBond{value: msg.value}(msg.sender, disputeId);
        bondManager.lockStakeBond(batchSequencer, disputeId);

        // The total steps = number of L2 blocks in batch
        // (simplified: 1 step per block, real system would use transaction count)
        uint256 totalSteps = endBlock - startBlock + 1;

        disputes[disputeId] = Dispute({
            batchNumber: _batchNumber,
            challenger: msg.sender,
            defender: batchSequencer,
            status: DisputeStatus.BISECTING,
            currentTurn: Turn.DEFENDER,  // Defender responds first
            rangeStart: 0,
            rangeEnd: totalSteps,
            agreedStep: 0,
            agreedStateRoot: preStateRoot,
            challengerClaim: _challengerPostRoot,
            defenderClaim: defenderPostRoot,
            disputedStep: totalSteps,
            createdAt: block.timestamp,
            lastActionAt: block.timestamp,
            roundCount: 0
        });

        activeDisputeCount[_batchNumber]++;
        if (challengePeriod != address(0)) {
            IChallengePeriod(challengePeriod).recordBatchDisputed();
        }

        emit DisputeStarted(disputeId, _batchNumber, msg.sender, batchSequencer);
    }

    // ═══════════════════════════════════════════════════════
    // BISECTION
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Respond in a bisection round.
     *         The active party claims a state root at the midpoint.
     *         This narrows the disputed range by half each round.
     *
     * @param _disputeId         Dispute to respond to
     * @param _claimedStateRoot  State root claimed at the midpoint
     */
    function respondBisection(
        uint256 _disputeId,
        bytes32 _claimedStateRoot
    ) external {
        Dispute storage d = disputes[_disputeId];
        if (d.status != DisputeStatus.BISECTING) revert DisputeNotActive();

        // Check it's the caller's turn
        address expectedResponder = d.currentTurn == Turn.DEFENDER ? d.defender : d.challenger;
        if (msg.sender != expectedResponder) revert NotYourTurn();

        // Check timeout hasn't passed
        if (block.timestamp > d.lastActionAt + responseTimeout) revert TimeoutAlreadyPassed();

        // Calculate midpoint
        uint256 midStep = (d.rangeStart + d.rangeEnd) / 2;

        if (d.currentTurn == Turn.DEFENDER) {
            d.defenderClaim = _claimedStateRoot;
        } else {
            d.challengerClaim = _claimedStateRoot;
        }

        d.disputedStep = midStep;

        // If both parties have now responded for this range, narrow it
        // The responding party's claim for the midpoint determines agreement
        // If they agree at midpoint: dispute is in upper half
        // If they disagree at midpoint: dispute is in lower half

        // For simplicity in this version: alternate narrows range
        if (d.currentTurn == Turn.DEFENDER) {
            // Defender claimed midpoint state. Now challenger must respond.
            d.currentTurn = Turn.CHALLENGER;
        } else {
            // Challenger responded. Check if they agree at midpoint.
            if (d.challengerClaim == d.defenderClaim) {
                // Agree at midpoint → dispute in upper half
                d.rangeStart = midStep;
                d.agreedStep = midStep;
                d.agreedStateRoot = d.defenderClaim;
            } else {
                // Disagree at midpoint → dispute in lower half
                d.rangeEnd = midStep;
            }
            d.currentTurn = Turn.DEFENDER;
            d.roundCount++;
        }

        d.lastActionAt = block.timestamp;

        emit BisectionStep(_disputeId, d.currentTurn, midStep, _claimedStateRoot, d.roundCount);
    }

    // ═══════════════════════════════════════════════════════
    // RESOLUTION
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Resolve the dispute after bisection narrows to a single step.
     *         Calls FaultProofVM to verify the disputed step.
     *
     * @param _disputeId  Dispute to resolve
     * @param _claim      The state transition claim for the single disputed step
     */
    function resolveDispute(
        uint256 _disputeId,
        FaultProofVM.TransitionClaim calldata _claim
    ) external {
        Dispute storage d = disputes[_disputeId];
        if (d.status != DisputeStatus.BISECTING) revert DisputeNotActive();

        // Range must be narrowed to 1 step
        if (d.rangeEnd - d.rangeStart > 1) revert RangeNotNarrowedToOne();

        // Call FaultProofVM to verify
        (bool valid, ) = faultProofVM.verifyStep(
            d.agreedStateRoot,    // pre-state both parties agreed on
            d.defenderClaim,      // defender's claimed post-state
            _claim
        );

        if (valid) {
            // Defender (sequencer) was correct
            _resolveInFavorOf(d, _disputeId, d.defender, d.challenger, DisputeStatus.RESOLVED_DEFENDER_WIN);
        } else {
            // Challenger was correct — sequencer lied
            _resolveInFavorOf(d, _disputeId, d.challenger, d.defender, DisputeStatus.RESOLVED_CHALLENGER_WIN);
            // Invalidate the fraudulent batch
            _invalidateBatch(d.batchNumber);
        }
    }

    // ═══════════════════════════════════════════════════════
    // TIMEOUT
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Claim timeout if the other party didn't respond in time.
     *         Anyone can call this to enforce the timeout.
     */
    function timeout(uint256 _disputeId) external {
        Dispute storage d = disputes[_disputeId];
        if (d.status != DisputeStatus.BISECTING) revert DisputeNotActive();
        if (block.timestamp <= d.lastActionAt + responseTimeout) revert TimeoutNotReached();

        if (d.currentTurn == Turn.DEFENDER) {
            // Defender timed out → challenger wins
            _resolveInFavorOf(d, _disputeId, d.challenger, d.defender, DisputeStatus.TIMEOUT_CHALLENGER_WIN);
            _invalidateBatch(d.batchNumber);
            emit DisputeTimedOut(_disputeId, Turn.DEFENDER);
        } else {
            // Challenger timed out → defender wins
            _resolveInFavorOf(d, _disputeId, d.defender, d.challenger, DisputeStatus.TIMEOUT_DEFENDER_WIN);
            emit DisputeTimedOut(_disputeId, Turn.CHALLENGER);
        }
    }

    // ═══════════════════════════════════════════════════════
    // INTERNAL
    // ═══════════════════════════════════════════════════════

    function _resolveInFavorOf(
        Dispute storage d,
        uint256 _disputeId,
        address _winner,
        address _loser,
        DisputeStatus _status
    ) internal {
        d.status = _status;
        activeDisputeCount[d.batchNumber]--;

        // Slash loser's bond and reward winner
        uint256 reward = bondManager.slashBond(_loser, _disputeId);
        bondManager.refundBond(_winner, _disputeId);
        bondManager.rewardWinner(_winner, _disputeId, reward);

        emit DisputeResolved(_disputeId, _status, _winner, _loser);
    }

    function _invalidateBatch(uint256 _batchNumber) internal {
        if (!batchProvenFraudulent[_batchNumber]) {
            batchProvenFraudulent[_batchNumber] = true;
            // Call BridgeFacetV3.invalidateBatch to block all withdrawals from this batch
            IBridgeFacet(diamond).invalidateBatch(_batchNumber);
        }
    }

    // ═══════════════════════════════════════════════════════
    // VIEWS
    // ═══════════════════════════════════════════════════════

    function getDispute(uint256 _disputeId) external view returns (
        uint256 batchNumber, address challenger, address defender,
        DisputeStatus status, Turn currentTurn,
        uint256 rangeStart, uint256 rangeEnd,
        uint256 roundCount, uint256 lastActionAt
    ) {
        Dispute memory d = disputes[_disputeId];
        return (d.batchNumber, d.challenger, d.defender, d.status, d.currentTurn,
                d.rangeStart, d.rangeEnd, d.roundCount, d.lastActionAt);
    }

    function getDisputeCount() external view returns (uint256) {
        return nextDisputeId - 1;
    }

    function isDisputeActive(uint256 _disputeId) external view returns (bool) {
        return disputes[_disputeId].status == DisputeStatus.BISECTING;
    }

    function hasTimedOut(uint256 _disputeId) external view returns (bool) {
        Dispute memory d = disputes[_disputeId];
        return d.status == DisputeStatus.BISECTING &&
               block.timestamp > d.lastActionAt + responseTimeout;
    }

    // ═══════════════════════════════════════════════════════
    // ADMIN
    // ═══════════════════════════════════════════════════════

    function setResponseTimeout(uint256 _timeout) external {
        require(msg.sender == owner, "Only owner");
        responseTimeout = _timeout;
    }

    function setMaxDisputesPerBatch(uint256 _max) external {
        require(msg.sender == owner, "Only owner");
        maxDisputesPerBatch = _max;
    }

    function setChallengePeriod(address _challengePeriod) external {
        require(msg.sender == owner, "Only owner");
        challengePeriod = _challengePeriod;
    }

    function transferOwnership(address _newOwner) external {
        require(msg.sender == owner, "Only owner");
        if (_newOwner == address(0)) revert ZeroAddress();
        owner = _newOwner;
    }
}
