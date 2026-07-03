// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IWrappedToken {
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
}

/**
 * @title L2Bridge V3
 * @notice Handles deposits from L1 and initiates withdrawals to L1.
 * @dev V3 preserves V2 bridge signatures/events and adds owner-controlled
 *      withdrawal rate limiting plus withdrawal nonce migration support.
 */
contract L2BridgeV3 is Ownable, ReentrancyGuard {
    // Sequencer address that can process L1 deposits.
    address public sequencer;

    // Withdrawal nonce for unique withdrawal IDs.
    uint256 public withdrawalNonce;

    // Mapping of processed L1 deposits to prevent replay.
    mapping(bytes32 => bool) public processedDeposits;

    // Mapping of pending withdrawals.
    mapping(bytes32 => Withdrawal) public withdrawals;

    // L1 token address -> L2 wrapped token address.
    mapping(address => address) public l1ToL2Tokens;

    // L2 wrapped token address -> L1 token address.
    mapping(address => address) public l2ToL1Tokens;

    // V3 withdrawal anti-spam controls.
    bool public withdrawalRateLimitEnabled = true;
    uint256 public withdrawalRateLimitWindow = 30 seconds;
    uint256 public maxWithdrawalsPerWindow = 10;

    // User address -> current withdrawal window start timestamp.
    mapping(address => uint256) public withdrawalWindowStart;

    // User address -> withdrawal count inside current window.
    mapping(address => uint256) public withdrawalCountInWindow;

    struct Withdrawal {
        address token;
        address from;
        address to;
        uint256 amount;
        uint256 timestamp;
        bool processed;
    }

    // Events preserved from V2. Do not change fields/order.
    event DepositProcessed(
        bytes32 indexed depositId,
        address indexed token,
        address indexed recipient,
        uint256 amount
    );

    event WithdrawalInitiated(
        bytes32 indexed withdrawalId,
        address indexed token,
        address indexed from,
        address to,
        uint256 amount,
        uint256 nonce
    );

    event WithdrawalCancelled(
        bytes32 indexed withdrawalId,
        address indexed user,
        uint256 amount
    );

    event SequencerUpdated(
        address indexed oldSequencer,
        address indexed newSequencer
    );

    event TokenPairAdded(
        address indexed l1Token,
        address indexed l2Token
    );

    event TokenPairRemoved(
        address indexed l1Token,
        address indexed l2Token
    );

    // V3 events.
    event WithdrawalRateLimitUpdated(
        bool enabled,
        uint256 windowSeconds,
        uint256 maxWithdrawals
    );

    event WithdrawalNonceInitialized(
        uint256 oldNonce,
        uint256 newNonce
    );

    constructor(address _sequencer) Ownable(msg.sender) {
        require(_sequencer != address(0), "Invalid sequencer");
        sequencer = _sequencer;
    }

    function addTokenPair(address l1Token, address l2Token) external onlyOwner {
        require(l1Token != address(0), "Invalid L1 token");
        require(l2Token != address(0), "Invalid L2 token");
        require(l1ToL2Tokens[l1Token] == address(0), "L1 token already mapped");
        require(l2ToL1Tokens[l2Token] == address(0), "L2 token already mapped");

        l1ToL2Tokens[l1Token] = l2Token;
        l2ToL1Tokens[l2Token] = l1Token;

        emit TokenPairAdded(l1Token, l2Token);
    }

    function removeTokenPair(address l1Token) external onlyOwner {
        address l2Token = l1ToL2Tokens[l1Token];
        require(l2Token != address(0), "Pair not found");

        delete l1ToL2Tokens[l1Token];
        delete l2ToL1Tokens[l2Token];

        emit TokenPairRemoved(l1Token, l2Token);
    }

    /**
     * @notice Process a deposit that originated from L1.
     * @dev Same signature and behavior as V2 so sequencer deposit processing
     *      does not need to change.
     */
    function processDeposit(
        address token,
        address recipient,
        uint256 amount,
        bytes32 depositId
    ) external {
        require(msg.sender == sequencer, "Only sequencer");
        require(!processedDeposits[depositId], "Already processed");
        require(recipient != address(0), "Invalid recipient");
        require(amount > 0, "Invalid amount");

        processedDeposits[depositId] = true;

        if (token == address(0)) {
            (bool success, ) = payable(recipient).call{value: amount}("");
            require(success, "L2Bridge: ETH transfer failed");
        } else {
            address l2Token = l1ToL2Tokens[token];
            require(l2Token != address(0), "L2Bridge: Token pair not registered");
            IWrappedToken(l2Token).mint(recipient, amount);
        }

        emit DepositProcessed(depositId, token, recipient, amount);
    }

    /**
     * @notice Initiate withdrawal from L2 to L1.
     * @dev Same signature/event as V2. V3 rate limiting happens before ETH is
     *      accepted or wrapped tokens are burned.
     */
    function initiateWithdrawal(
        address token,
        address to,
        uint256 amount
    ) external payable nonReentrant returns (bytes32) {
        require(to != address(0), "Invalid recipient");
        require(amount > 0, "Invalid amount");

        _consumeWithdrawalQuota(msg.sender);

        address l1Token;

        if (token == address(0)) {
            require(msg.value == amount, "Incorrect ETH amount");
            l1Token = address(0);
        } else {
            l1Token = l2ToL1Tokens[token];
            require(l1Token != address(0), "L2Bridge: Token pair not registered");
            IWrappedToken(token).burn(msg.sender, amount);
        }

        uint256 nonce = withdrawalNonce++;
        bytes32 withdrawalId = keccak256(
            abi.encodePacked(l1Token, msg.sender, to, amount, nonce, block.timestamp)
        );

        withdrawals[withdrawalId] = Withdrawal({
            token: l1Token,
            from: msg.sender,
            to: to,
            amount: amount,
            timestamp: block.timestamp,
            processed: false
        });

        emit WithdrawalInitiated(withdrawalId, l1Token, msg.sender, to, amount, nonce);

        return withdrawalId;
    }

    function cancelWithdrawal(bytes32 withdrawalId) external nonReentrant {
        Withdrawal storage withdrawal = withdrawals[withdrawalId];

        require(withdrawal.from != address(0), "Withdrawal not found");
        require(withdrawal.from == msg.sender, "Not withdrawal owner");
        require(!withdrawal.processed, "Already processed");
        require(
            block.timestamp < withdrawal.timestamp + 1 hours,
            "Cancellation period expired"
        );

        uint256 amount = withdrawal.amount;
        address token = withdrawal.token;

        withdrawal.processed = true;

        if (token == address(0)) {
            (bool success, ) = payable(msg.sender).call{value: amount}("");
            require(success, "L2Bridge: ETH refund failed");
        } else {
            address l2Token = l1ToL2Tokens[token];
            require(l2Token != address(0), "L2Bridge: Token pair not found");
            IWrappedToken(l2Token).mint(msg.sender, amount);
        }

        emit WithdrawalCancelled(withdrawalId, msg.sender, amount);
    }

    function markWithdrawalProcessed(bytes32 withdrawalId) external {
        require(msg.sender == sequencer, "Only sequencer");

        Withdrawal storage withdrawal = withdrawals[withdrawalId];
        require(withdrawal.from != address(0), "Withdrawal not found");
        require(!withdrawal.processed, "Already processed");

        withdrawal.processed = true;
    }

    function updateSequencer(address newSequencer) external onlyOwner {
        require(newSequencer != address(0), "Invalid sequencer");
        address oldSequencer = sequencer;
        sequencer = newSequencer;
        emit SequencerUpdated(oldSequencer, newSequencer);
    }

    /**
     * @notice Set the initial nonce during migration to keep new withdrawal IDs
     *         monotonic with the old bridge history.
     * @dev Can only increase or keep the current nonce; it can never decrease.
     */
    function initializeWithdrawalNonce(uint256 newNonce) external onlyOwner {
        require(newNonce >= withdrawalNonce, "Cannot decrease nonce");
        uint256 oldNonce = withdrawalNonce;
        withdrawalNonce = newNonce;
        emit WithdrawalNonceInitialized(oldNonce, newNonce);
    }

    /**
     * @notice Configure per-address withdrawal rate limiting.
     * @dev Set enabled=false to bypass the limiter. If enabled=true, both
     *      windowSeconds and maxWithdrawals must be greater than zero.
     */
    function setWithdrawalRateLimit(
        bool enabled,
        uint256 windowSeconds,
        uint256 maxWithdrawals
    ) external onlyOwner {
        if (enabled) {
            require(windowSeconds > 0, "Invalid window");
            require(maxWithdrawals > 0, "Invalid max withdrawals");
        }

        withdrawalRateLimitEnabled = enabled;
        withdrawalRateLimitWindow = windowSeconds;
        maxWithdrawalsPerWindow = maxWithdrawals;

        emit WithdrawalRateLimitUpdated(enabled, windowSeconds, maxWithdrawals);
    }

    function getWithdrawal(bytes32 withdrawalId)
        external
        view
        returns (
            address token,
            address from,
            address to,
            uint256 amount,
            uint256 timestamp,
            bool processed
        )
    {
        Withdrawal memory w = withdrawals[withdrawalId];
        return (w.token, w.from, w.to, w.amount, w.timestamp, w.processed);
    }

    function getWithdrawalRateLimit(address user)
        external
        view
        returns (
            bool enabled,
            uint256 windowSeconds,
            uint256 maxWithdrawals,
            uint256 windowStart,
            uint256 countInWindow,
            uint256 remaining,
            uint256 resetTimestamp
        )
    {
        enabled = withdrawalRateLimitEnabled;
        windowSeconds = withdrawalRateLimitWindow;
        maxWithdrawals = maxWithdrawalsPerWindow;
        windowStart = withdrawalWindowStart[user];
        countInWindow = withdrawalCountInWindow[user];

        if (!enabled || block.timestamp >= windowStart + windowSeconds) {
            remaining = maxWithdrawals;
            resetTimestamp = block.timestamp;
        } else {
            remaining = countInWindow >= maxWithdrawals ? 0 : maxWithdrawals - countInWindow;
            resetTimestamp = windowStart + windowSeconds;
        }
    }

    function isDepositProcessed(bytes32 depositId) external view returns (bool) {
        return processedDeposits[depositId];
    }

    function _consumeWithdrawalQuota(address user) internal {
        if (!withdrawalRateLimitEnabled) {
            return;
        }

        uint256 windowStart = withdrawalWindowStart[user];
        if (windowStart == 0 || block.timestamp >= windowStart + withdrawalRateLimitWindow) {
            withdrawalWindowStart[user] = block.timestamp;
            withdrawalCountInWindow[user] = 1;
            return;
        }

        uint256 nextCount = withdrawalCountInWindow[user] + 1;
        require(nextCount <= maxWithdrawalsPerWindow, "Withdrawal rate limit exceeded");
        withdrawalCountInWindow[user] = nextCount;
    }

    receive() external payable {}
}
