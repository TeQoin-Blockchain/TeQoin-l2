// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IStateCommitmentReader {
    function getStateCommitment(uint256 batchNumber) external view returns (
        uint256, uint256, bytes32, bytes32, bytes32, bytes32, uint256, address, bool exists
    );
}

/**
 * @title ChallengePeriod
 * @author TeQoin
 * @notice Calculates dynamic challenge periods for withdrawals.
 *         Reduces wait time based on network security indicators.
 *
 * Factors:
 *   1. Watchtower confirmations (more independent verifiers = shorter)
 *   2. Sequencer trust score (dispute-free history = shorter)
 *   3. Withdrawal size (smaller amount = less risk = shorter)
 *   4. Network maturity (longer without fraud = shorter)
 *
 * Range: 24 hours (minimum floor) to 7 days (base maximum)
 */
contract ChallengePeriod {

    // ═══════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════

    uint256 public constant BASE_PERIOD = 7 days;
    uint256 public constant MIN_PERIOD = 24 hours;
    uint256 public constant BPS = 10_000; // basis points

    // ═══════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════

    address public owner;
    address public sequencerFacet;
    address public disputeGame;
    uint256 public chainLaunchTimestamp;

    /// @notice Registered watchtower addresses (must confirm batches)
    mapping(address => bool) public registeredWatchtowers;
    uint256 public watchtowerCount;

    /// @notice Watchtower confirmations per batch
    mapping(uint256 => mapping(address => bool)) public watchtowerConfirmed;
    mapping(uint256 => uint256) public batchConfirmationCount;

    /// @notice Sequencer stats for trust calculation
    uint256 public totalBatchesSubmitted;
    uint256 public totalBatchesDisputed;

    /// @notice Size tier thresholds (in wei)
    uint256 public tierSmall;    // < this = small withdrawal
    uint256 public tierMedium;   // < this = medium, >= this = large

    /// @notice Factor weights (in BPS)
    /// Each factor is a multiplier: 10000 = 1.0 (no reduction), 5000 = 0.5 (50% reduction)
    uint256 public watchtowerFactor0;    // 0 watchtowers confirmed
    uint256 public watchtowerFactor1_2;  // 1-2 confirmed
    uint256 public watchtowerFactor3_4;  // 3-4 confirmed
    uint256 public watchtowerFactor5;    // 5+ confirmed

    uint256 public trustFactorHigh;      // trust > 99.9%
    uint256 public trustFactorMedium;    // trust > 99%
    uint256 public trustFactorLow;       // trust <= 99%

    uint256 public sizeFactorSmall;
    uint256 public sizeFactorMedium;
    uint256 public sizeFactorLarge;

    uint256 public maturityFactor30;     // 30-90 days
    uint256 public maturityFactor90;     // 90+ days
    uint256 public maturityFactorYoung;  // < 30 days

    // ═══════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════

    event WatchtowerRegistered(address indexed watchtower);
    event WatchtowerRemoved(address indexed watchtower);
    event BatchConfirmed(uint256 indexed batchNumber, address indexed watchtower, uint256 totalConfirmations);
    event AuthorizedContractsUpdated(address indexed sequencerFacet, address indexed disputeGame);

    error ZeroAddress();
    error InvalidFactor();

    // ═══════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════

    constructor() {
        owner = msg.sender;
        chainLaunchTimestamp = block.timestamp;

        // Default size tiers
        tierSmall = 1 ether;
        tierMedium = 100 ether;

        // Default watchtower factors (BPS)
        watchtowerFactor0 = 10_000;    // 1.0x (no reduction)
        watchtowerFactor1_2 = 8_500;   // 0.85x
        watchtowerFactor3_4 = 7_000;   // 0.70x
        watchtowerFactor5 = 5_000;     // 0.50x

        // Default trust factors
        trustFactorHigh = 8_000;       // 0.80x
        trustFactorMedium = 9_000;     // 0.90x
        trustFactorLow = 10_000;       // 1.0x

        // Default size factors
        sizeFactorSmall = 3_000;       // 0.30x
        sizeFactorMedium = 5_000;      // 0.50x
        sizeFactorLarge = 10_000;      // 1.0x

        // Default maturity factors
        maturityFactorYoung = 10_000;  // 1.0x
        maturityFactor30 = 9_000;      // 0.90x
        maturityFactor90 = 8_000;      // 0.80x
    }

    // ═══════════════════════════════════════════════════════
    // MAIN CALCULATION
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Calculate challenge period for a withdrawal.
     *
     * @param _amount       Withdrawal amount in wei
     * @param _batchNumber  Batch containing the withdrawal
     * @return period       Challenge period in seconds
     */
    function getChallengePeriod(
        uint256 _amount,
        uint256 _batchNumber
    ) external view returns (uint256 period) {
        uint256 wFactor = _getWatchtowerFactor(_batchNumber);
        uint256 tFactor = _getTrustFactor();
        uint256 sFactor = _getSizeFactor(_amount);
        uint256 mFactor = _getMaturityFactor();

        // period = BASE × w × t × s × m / BPS^4
        // Using intermediate products to avoid overflow
        uint256 product = BASE_PERIOD;
        product = (product * wFactor) / BPS;
        product = (product * tFactor) / BPS;
        product = (product * sFactor) / BPS;
        product = (product * mFactor) / BPS;

        // Enforce minimum
        period = product < MIN_PERIOD ? MIN_PERIOD : product;
    }

    /**
     * @notice Get a breakdown of all factors for debugging/display.
     */
    function getFactorBreakdown(
        uint256 _amount,
        uint256 _batchNumber
    ) external view returns (
        uint256 watchtower,
        uint256 trust,
        uint256 size,
        uint256 maturity,
        uint256 finalPeriod
    ) {
        watchtower = _getWatchtowerFactor(_batchNumber);
        trust = _getTrustFactor();
        size = _getSizeFactor(_amount);
        maturity = _getMaturityFactor();

        uint256 product = BASE_PERIOD;
        product = (product * watchtower) / BPS;
        product = (product * trust) / BPS;
        product = (product * size) / BPS;
        product = (product * maturity) / BPS;

        finalPeriod = product < MIN_PERIOD ? MIN_PERIOD : product;
    }

    // ═══════════════════════════════════════════════════════
    // WATCHTOWER MANAGEMENT
    // ═══════════════════════════════════════════════════════

    function registerWatchtower(address _watchtower) external {
        require(msg.sender == owner, "Only owner");
        if (_watchtower == address(0)) revert ZeroAddress();
        require(!registeredWatchtowers[_watchtower], "Already registered");
        registeredWatchtowers[_watchtower] = true;
        watchtowerCount++;
        emit WatchtowerRegistered(_watchtower);
    }

    function removeWatchtower(address _watchtower) external {
        require(msg.sender == owner, "Only owner");
        require(registeredWatchtowers[_watchtower], "Not registered");
        registeredWatchtowers[_watchtower] = false;
        watchtowerCount--;
        emit WatchtowerRemoved(_watchtower);
    }

    /**
     * @notice Watchtower confirms a batch is valid (they re-executed and verified).
     */
    function confirmBatch(uint256 _batchNumber) external {
        require(registeredWatchtowers[msg.sender], "Not a registered watchtower");
        require(!watchtowerConfirmed[_batchNumber][msg.sender], "Already confirmed");
        if (sequencerFacet != address(0)) {
            (,,,,,,,, bool exists) = IStateCommitmentReader(sequencerFacet).getStateCommitment(_batchNumber);
            require(exists, "Batch not found");
        }

        watchtowerConfirmed[_batchNumber][msg.sender] = true;
        batchConfirmationCount[_batchNumber]++;

        emit BatchConfirmed(_batchNumber, msg.sender, batchConfirmationCount[_batchNumber]);
    }

    // ═══════════════════════════════════════════════════════
    // SEQUENCER STATS (called by SequencerFacet)
    // ═══════════════════════════════════════════════════════

    function recordBatchSubmitted() external {
        require(msg.sender == sequencerFacet, "Only sequencer facet");
        totalBatchesSubmitted++;
    }

    function recordBatchDisputed() external {
        require(msg.sender == disputeGame, "Only dispute game");
        totalBatchesDisputed++;
    }

    // ═══════════════════════════════════════════════════════
    // INTERNAL FACTOR CALCULATIONS
    // ═══════════════════════════════════════════════════════

    function _getWatchtowerFactor(uint256 _batchNumber) internal view returns (uint256) {
        uint256 confirmations = batchConfirmationCount[_batchNumber];
        if (confirmations >= 5) return watchtowerFactor5;
        if (confirmations >= 3) return watchtowerFactor3_4;
        if (confirmations >= 1) return watchtowerFactor1_2;
        return watchtowerFactor0;
    }

    function _getTrustFactor() internal view returns (uint256) {
        if (totalBatchesSubmitted == 0) return trustFactorLow;

        uint256 chainAge = block.timestamp - chainLaunchTimestamp;
        uint256 cleanBatches = totalBatchesSubmitted - totalBatchesDisputed;
        // Trust = cleanBatches / totalBatches (in BPS)
        uint256 trustBps = (cleanBatches * BPS) / totalBatchesSubmitted;

        // > 99.9% trust AND chain > 30 days
        if (trustBps > 9_990 && chainAge > 30 days) return trustFactorHigh;
        // > 99% trust AND chain > 14 days
        if (trustBps > 9_900 && chainAge > 14 days) return trustFactorMedium;
        return trustFactorLow;
    }

    function _getSizeFactor(uint256 _amount) internal view returns (uint256) {
        if (_amount < tierSmall) return sizeFactorSmall;
        if (_amount < tierMedium) return sizeFactorMedium;
        return sizeFactorLarge;
    }

    function _getMaturityFactor() internal view returns (uint256) {
        uint256 age = block.timestamp - chainLaunchTimestamp;
        if (age > 90 days) return maturityFactor90;
        if (age > 30 days) return maturityFactor30;
        return maturityFactorYoung;
    }

    // ═══════════════════════════════════════════════════════
    // ADMIN
    // ═══════════════════════════════════════════════════════

    function setSizeTiers(uint256 _small, uint256 _medium) external {
        require(msg.sender == owner, "Only owner");
        require(_small < _medium, "Invalid tiers");
        tierSmall = _small;
        tierMedium = _medium;
    }

    function setWatchtowerFactors(uint256 _f0, uint256 _f12, uint256 _f34, uint256 _f5) external {
        require(msg.sender == owner, "Only owner");
        if (_f0 > BPS || _f12 > BPS || _f34 > BPS || _f5 > BPS) revert InvalidFactor();
        watchtowerFactor0 = _f0;
        watchtowerFactor1_2 = _f12;
        watchtowerFactor3_4 = _f34;
        watchtowerFactor5 = _f5;
    }

    function setAuthorizedContracts(address _sequencerFacet, address _disputeGame) external {
        require(msg.sender == owner, "Only owner");
        sequencerFacet = _sequencerFacet;
        disputeGame = _disputeGame;
        emit AuthorizedContractsUpdated(_sequencerFacet, _disputeGame);
    }

    function transferOwnership(address _newOwner) external {
        require(msg.sender == owner, "Only owner");
        if (_newOwner == address(0)) revert ZeroAddress();
        owner = _newOwner;
    }
}
