// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title BondManager
 * @author TeQoin
 * @notice Manages ETH bonds for the dispute game system.
 *         Challengers and defenders post bonds. Winners claim losers' bonds.
 *
 * Bond flow:
 *   1. Challenger deposits bond via DisputeGame.startDispute()
 *   2. Defender's bond is their existing sequencer stake
 *   3. On resolution: winner gets loser's bond (90%), protocol gets 10%
 *   4. On timeout: responder gets non-responder's bond
 */
contract BondManager {

    // ═══════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════

    /// @notice Required bond amount to start or defend a dispute
    uint256 public bondAmount;

    /// @notice Address that receives protocol's share of slashed bonds
    address public treasury;

    /// @notice Only the DisputeGame contract can slash/refund
    address public disputeGame;

    /// @notice Owner for configuration
    address public owner;

    /// @notice Protocol's share of slashed bonds (basis points, 1000 = 10%)
    uint256 public protocolShareBps;

    /// @notice Bonds held per address per dispute
    mapping(address => mapping(uint256 => uint256)) public bonds;

    /// @notice Total bond balance per address (across all disputes)
    mapping(address => uint256) public totalBonded;

    /// @notice Sequencer/defender stake available to lock into disputes.
    mapping(address => uint256) public sequencerStake;

    /// @notice Explicit claimable rewards by winner and dispute.
    mapping(address => mapping(uint256 => uint256)) public claimableRewards;

    uint256 private unlocked = 1;

    // ═══════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════

    event BondDeposited(address indexed party, uint256 indexed disputeId, uint256 amount);
    event BondSlashed(address indexed loser, uint256 indexed disputeId, uint256 amount);
    event BondRefunded(address indexed party, uint256 indexed disputeId, uint256 amount);
    event RewardClaimed(address indexed winner, uint256 indexed disputeId, uint256 amount);
    event BondAmountUpdated(uint256 oldAmount, uint256 newAmount);
    event SequencerStakeDeposited(address indexed sequencer, uint256 amount);
    event SequencerStakeWithdrawn(address indexed sequencer, uint256 amount);
    event RewardAccrued(address indexed winner, uint256 indexed disputeId, uint256 amount);

    // ═══════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════

    error OnlyDisputeGame();
    error OnlyOwner();
    error InsufficientBond();
    error NoBondToRefund();
    error NoBondToSlash();
    error TransferFailed();
    error ZeroAddress();
    error AlreadyBonded();
    error InvalidProtocolShare();
    error InsufficientStake();

    // ═══════════════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════════════

    modifier onlyDisputeGame() {
        if (msg.sender != disputeGame) revert OnlyDisputeGame();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier nonReentrant() {
        require(unlocked == 1, "REENTRANCY");
        unlocked = 2;
        _;
        unlocked = 1;
    }

    // ═══════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════

    /**
     * @param _bondAmount      Required bond in wei (e.g., 1 ether for testnet)
     * @param _treasury        Address for protocol's share of slashed bonds
     * @param _protocolShareBps Protocol share in basis points (1000 = 10%)
     */
    constructor(uint256 _bondAmount, address _treasury, uint256 _protocolShareBps) {
        if (_treasury == address(0)) revert ZeroAddress();
        if (_protocolShareBps > 10_000) revert InvalidProtocolShare();
        bondAmount = _bondAmount;
        treasury = _treasury;
        protocolShareBps = _protocolShareBps;
        owner = msg.sender;
    }

    /// @notice Deposit defender stake. The dispute game can lock this into
    ///         individual disputes when a sequencer's batch is challenged.
    function depositSequencerStake(address _sequencer) external payable {
        if (_sequencer == address(0)) revert ZeroAddress();
        if (msg.value == 0) revert InsufficientStake();
        sequencerStake[_sequencer] += msg.value;
        totalBonded[_sequencer] += msg.value;
        emit SequencerStakeDeposited(_sequencer, msg.value);
    }

    function withdrawSequencerStake(uint256 _amount) external nonReentrant {
        if (sequencerStake[msg.sender] < _amount) revert InsufficientStake();
        sequencerStake[msg.sender] -= _amount;
        totalBonded[msg.sender] -= _amount;
        (bool ok, ) = msg.sender.call{value: _amount}("");
        if (!ok) revert TransferFailed();
        emit SequencerStakeWithdrawn(msg.sender, _amount);
    }

    // ═══════════════════════════════════════════════════════
    // BOND OPERATIONS (called by DisputeGame)
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Lock a bond for a dispute participant.
     *         Called by DisputeGame when a dispute is started or responded to.
     *         The caller must send exactly bondAmount in ETH.
     */
    function lockBond(address _party, uint256 _disputeId) external payable onlyDisputeGame {
        if (msg.value < bondAmount) revert InsufficientBond();
        if (bonds[_party][_disputeId] > 0) revert AlreadyBonded();

        bonds[_party][_disputeId] = msg.value;
        totalBonded[_party] += msg.value;

        emit BondDeposited(_party, _disputeId, msg.value);
    }

    /// @notice Lock an existing sequencer stake as defender bond.
    function lockStakeBond(address _party, uint256 _disputeId) external onlyDisputeGame {
        if (bonds[_party][_disputeId] > 0) revert AlreadyBonded();
        if (sequencerStake[_party] < bondAmount) revert InsufficientStake();

        sequencerStake[_party] -= bondAmount;
        bonds[_party][_disputeId] = bondAmount;

        emit BondDeposited(_party, _disputeId, bondAmount);
    }

    /**
     * @notice Slash a losing party's bond.
     *         Called by DisputeGame when dispute is resolved against a party.
     *         Bond is held until winner claims it.
     */
    function slashBond(address _loser, uint256 _disputeId) external onlyDisputeGame returns (uint256 winnerShare) {
        uint256 amount = bonds[_loser][_disputeId];
        if (amount == 0) revert NoBondToSlash();

        bonds[_loser][_disputeId] = 0;
        totalBonded[_loser] -= amount;

        emit BondSlashed(_loser, _disputeId, amount);

        // Protocol takes its share
        uint256 protocolShare = (amount * protocolShareBps) / 10_000;
        winnerShare = amount - protocolShare;

        if (protocolShare > 0) {
            (bool ok, ) = treasury.call{value: protocolShare}("");
            if (!ok) revert TransferFailed();
        }

        // Winner share stays in contract and is explicitly accounted by
        // rewardWinner() in the same dispute resolution flow.
    }

    /**
     * @notice Refund a bond to an honest party (e.g., honest defender after false challenge).
     */
    function refundBond(address _party, uint256 _disputeId) external onlyDisputeGame nonReentrant {
        uint256 amount = bonds[_party][_disputeId];
        if (amount == 0) revert NoBondToRefund();

        bonds[_party][_disputeId] = 0;
        totalBonded[_party] -= amount;

        (bool ok, ) = _party.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit BondRefunded(_party, _disputeId, amount);
    }

    /**
     * @notice Send reward to dispute winner.
     *         Called by DisputeGame after slashing the loser.
     */
    function rewardWinner(address _winner, uint256 _disputeId, uint256 _amount) external onlyDisputeGame {
        claimableRewards[_winner][_disputeId] += _amount;
        emit RewardAccrued(_winner, _disputeId, _amount);
    }

    function claimReward(uint256 _disputeId) external nonReentrant {
        uint256 amount = claimableRewards[msg.sender][_disputeId];
        if (amount == 0) revert TransferFailed();
        claimableRewards[msg.sender][_disputeId] = 0;

        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit RewardClaimed(msg.sender, _disputeId, amount);
    }

    // ═══════════════════════════════════════════════════════
    // ADMIN
    // ═══════════════════════════════════════════════════════

    function setDisputeGame(address _disputeGame) external onlyOwner {
        if (_disputeGame == address(0)) revert ZeroAddress();
        disputeGame = _disputeGame;
    }

    function setBondAmount(uint256 _newAmount) external onlyOwner {
        uint256 old = bondAmount;
        bondAmount = _newAmount;
        emit BondAmountUpdated(old, _newAmount);
    }

    function setProtocolShareBps(uint256 _newProtocolShareBps) external onlyOwner {
        if (_newProtocolShareBps > 10_000) revert InvalidProtocolShare();
        protocolShareBps = _newProtocolShareBps;
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
    }

    function transferOwnership(address _newOwner) external onlyOwner {
        if (_newOwner == address(0)) revert ZeroAddress();
        owner = _newOwner;
    }

    // ═══════════════════════════════════════════════════════
    // VIEWS
    // ═══════════════════════════════════════════════════════

    function getBond(address _party, uint256 _disputeId) external view returns (uint256) {
        return bonds[_party][_disputeId];
    }

    function getTotalBonded(address _party) external view returns (uint256) {
        return totalBonded[_party];
    }

    receive() external payable {}
}
