// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SequencerFacet} from "../src/contracts/diamond/facets/SequencerFacet.sol";
import {BridgeFacet} from "../src/contracts/diamond/facets/BridgeFacet.sol";
import {LibDiamond} from "../src/contracts/diamond/libraries/LibDiamond.sol";

interface FraudVm {
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata revertData) external;
    function expectRevert() external;
    function prank(address msgSender) external;
    function deal(address who, uint256 newBalance) external;
    function warp(uint256 newTimestamp) external;
    function blobhashes(bytes32[] calldata hashes) external;
}

contract DiamondFraudProofHarness is SequencerFacet, BridgeFacet {
    function setOwnerForTest(address owner) external {
        LibDiamond.setContractOwner(owner);
    }
}

contract FixedChallengeOracle {
    uint256 public period;
    uint256 public submittedCount;

    constructor(uint256 period_) {
        period = period_;
    }

    function getChallengePeriod(uint256, uint256) external view returns (uint256) {
        return period;
    }

    function recordBatchSubmitted() external {
        submittedCount++;
    }
}

contract FraudProofDiamondIntegrationTest {
    FraudVm private constant vm = FraudVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    DiamondFraudProofHarness private diamond;

    address private owner = address(0xA11CE);
    address private sequencer = address(0x5E0);
    address private otherSequencer = address(0x5E1);
    address private disputeGame = address(0xD15A);
    address private recipient = address(0xBEEF);

    bytes32 private constant PRE_ROOT_0 = bytes32(uint256(0x1000));
    bytes32 private constant POST_ROOT_1 = bytes32(uint256(0x1001));
    bytes32 private constant POST_ROOT_2 = bytes32(uint256(0x1002));
    bytes32 private constant TX_ROOT_1 = bytes32(uint256(0x2001));
    bytes32 private constant TX_ROOT_2 = bytes32(uint256(0x2002));

    function setUp() public {
        vm.warp(1_800_000_000);
        diamond = new DiamondFraudProofHarness();
        diamond.setOwnerForTest(owner);

        vm.prank(owner);
        diamond.addSequencer(sequencer);
        vm.prank(owner);
        diamond.setChallengePeriod(1 days);
        vm.prank(owner);
        diamond.setDisputeGame(disputeGame);

        vm.deal(address(diamond), 100 ether);
    }

    function testSubmitStateBatchStoresCanonicalCommitment() public {
        bytes32 withdrawalsRoot = _leaf(bytes32(uint256(1)), address(0), recipient, 1 ether);

        vm.prank(sequencer);
        diamond.submitStateBatch(1, 1, 100, PRE_ROOT_0, POST_ROOT_1, TX_ROOT_1, withdrawalsRoot);

        (
            uint256 l2StartBlock,
            uint256 l2EndBlock,
            bytes32 preStateRoot,
            bytes32 postStateRoot,
            bytes32 transactionsRoot,
            bytes32 committedWithdrawalsRoot,,
            address batchSequencer,
            bool exists
        ) = diamond.getStateCommitment(1);

        require(exists, "commitment missing");
        require(l2StartBlock == 1, "wrong start");
        require(l2EndBlock == 100, "wrong end");
        require(preStateRoot == PRE_ROOT_0, "wrong pre root");
        require(postStateRoot == POST_ROOT_1, "wrong post root");
        require(transactionsRoot == TX_ROOT_1, "wrong tx root");
        require(committedWithdrawalsRoot == withdrawalsRoot, "wrong withdrawals root");
        require(batchSequencer == sequencer, "wrong sequencer");
        require(diamond.getLatestBatchNumber() == 1, "latest batch not updated");
        require(diamond.getLatestL2Block() == 100, "latest block not updated");
    }

    function testSubmitStateBatchWithCalldataStoresEthereumDACommitment() public {
        bytes32 withdrawalsRoot = _leaf(bytes32(uint256(3)), address(0), recipient, 3 ether);
        bytes memory batchData = abi.encodePacked(
            bytes4(0x54455101),
            uint256(1),
            uint256(1),
            uint256(100),
            PRE_ROOT_0,
            POST_ROOT_1,
            TX_ROOT_1,
            withdrawalsRoot
        );
        bytes32 dataHash = keccak256(batchData);

        vm.prank(sequencer);
        diamond.submitStateBatchWithCalldata(1, 1, 100, PRE_ROOT_0, POST_ROOT_1, TX_ROOT_1, withdrawalsRoot, batchData);

        (
            uint256 l2StartBlock,
            uint256 l2EndBlock,
            bytes32 preStateRoot,
            bytes32 postStateRoot,
            bytes32 transactionsRoot,
            bytes32 committedWithdrawalsRoot,,
            address batchSequencer,
            bool exists,
            uint8 daMode,
            bytes32 daCommitment,
            bytes32 daDataHash,
            uint256 daByteSize
        ) = diamond.getStateCommitmentV2(1);

        require(exists, "commitment missing");
        require(l2StartBlock == 1, "wrong start");
        require(l2EndBlock == 100, "wrong end");
        require(preStateRoot == PRE_ROOT_0, "wrong pre root");
        require(postStateRoot == POST_ROOT_1, "wrong post root");
        require(transactionsRoot == TX_ROOT_1, "wrong tx root");
        require(committedWithdrawalsRoot == withdrawalsRoot, "wrong withdrawals root");
        require(batchSequencer == sequencer, "wrong sequencer");
        require(daMode == 1, "wrong da mode");
        require(daCommitment == dataHash, "wrong da commitment");
        require(daDataHash == dataHash, "wrong da hash");
        require(daByteSize == batchData.length, "wrong da byte size");

        (uint8 mode2, bytes32 commitment2, bytes32 hash2, uint256 size2) = diamond.getBatchDACommitment(1);
        require(mode2 == daMode, "getter mode mismatch");
        require(commitment2 == daCommitment, "getter commitment mismatch");
        require(hash2 == daDataHash, "getter hash mismatch");
        require(size2 == daByteSize, "getter size mismatch");
    }

    function testSubmitStateBatchWithCalldataRejectsEmptyBatchData() public {
        bytes32 withdrawalsRoot = _leaf(bytes32(uint256(4)), address(0), recipient, 4 ether);
        bytes memory emptyBatchData = "";

        vm.prank(sequencer);
        vm.expectRevert(bytes("SequencerFacet: Empty batch data"));
        diamond.submitStateBatchWithCalldata(
            1, 1, 100, PRE_ROOT_0, POST_ROOT_1, TX_ROOT_1, withdrawalsRoot, emptyBatchData
        );
    }

    function testLegacySubmitStateBatchHasNoDAMode() public {
        bytes32 withdrawalsRoot = _leaf(bytes32(uint256(5)), address(0), recipient, 5 ether);

        vm.prank(sequencer);
        diamond.submitStateBatch(1, 1, 100, PRE_ROOT_0, POST_ROOT_1, TX_ROOT_1, withdrawalsRoot);

        (uint8 daMode, bytes32 daCommitment, bytes32 daDataHash, uint256 daByteSize) = diamond.getBatchDACommitment(1);
        require(daMode == 0, "legacy da mode should be none");
        require(daCommitment == bytes32(0), "legacy da commitment should be zero");
        require(daDataHash == bytes32(0), "legacy da hash should be zero");
        require(daByteSize == 0, "legacy da size should be zero");
    }

    function testSubmitStateBatchWithBlobStoresMultiBlobDACommitment() public {
        bytes32 withdrawalsRoot = _leaf(bytes32(uint256(6)), address(0), recipient, 6 ether);
        bytes32[] memory blobVersionedHashes = new bytes32[](3);
        blobVersionedHashes[0] = bytes32(uint256(0x0101));
        blobVersionedHashes[1] = bytes32(uint256(0x0102));
        blobVersionedHashes[2] = bytes32(uint256(0x0103));
        bytes32 expectedBlobCommitment = keccak256(abi.encodePacked(blobVersionedHashes));
        bytes32 batchDataHash = keccak256("canonical-batch-bytes");
        uint256 batchDataSize = 388045;
        vm.blobhashes(blobVersionedHashes);

        vm.prank(sequencer);
        diamond.submitStateBatchWithBlob(
            1,
            1,
            100,
            PRE_ROOT_0,
            POST_ROOT_1,
            TX_ROOT_1,
            withdrawalsRoot,
            blobVersionedHashes,
            batchDataHash,
            batchDataSize
        );

        (uint8 daMode, bytes32 daCommitment, bytes32 daDataHash, uint256 daByteSize) = diamond.getBatchDACommitment(1);
        require(daMode == 2, "wrong blob da mode");
        require(daCommitment == expectedBlobCommitment, "wrong blob commitment");
        require(daDataHash == batchDataHash, "wrong blob data hash");
        require(daByteSize == batchDataSize, "wrong blob byte size");
    }

    function testSubmitStateBatchWithBlobRejectsEmptyBlobHashes() public {
        bytes32 withdrawalsRoot = _leaf(bytes32(uint256(7)), address(0), recipient, 7 ether);
        bytes32[] memory emptyHashes = new bytes32[](0);

        vm.prank(sequencer);
        vm.expectRevert(bytes("SequencerFacet: Empty blob hashes"));
        diamond.submitStateBatchWithBlob(
            1,
            1,
            100,
            PRE_ROOT_0,
            POST_ROOT_1,
            TX_ROOT_1,
            withdrawalsRoot,
            emptyHashes,
            keccak256("canonical-batch-bytes"),
            1
        );
    }

    function testSubmitStateBatchWithBlobRejectsBlobHashMismatch() public {
        bytes32 withdrawalsRoot = _leaf(bytes32(uint256(8)), address(0), recipient, 8 ether);
        bytes32[] memory providedHashes = new bytes32[](1);
        providedHashes[0] = bytes32(uint256(0x0101));
        bytes32[] memory actualHashes = new bytes32[](1);
        actualHashes[0] = bytes32(uint256(0x0102));
        vm.blobhashes(actualHashes);

        vm.prank(sequencer);
        vm.expectRevert(bytes("SequencerFacet: Blob hash mismatch"));
        diamond.submitStateBatchWithBlob(
            1,
            1,
            100,
            PRE_ROOT_0,
            POST_ROOT_1,
            TX_ROOT_1,
            withdrawalsRoot,
            providedHashes,
            keccak256("canonical-batch-bytes"),
            1
        );
    }

    function testSubmitStateBatchWithBlobRejectsMissingBlob() public {
        bytes32 withdrawalsRoot = _leaf(bytes32(uint256(9)), address(0), recipient, 9 ether);
        bytes32[] memory providedHashes = new bytes32[](1);
        providedHashes[0] = bytes32(uint256(0x0101));
        bytes32[] memory noHashes = new bytes32[](0);
        vm.blobhashes(noHashes);

        vm.prank(sequencer);
        vm.expectRevert(bytes("SequencerFacet: Missing tx blob"));
        diamond.submitStateBatchWithBlob(
            1,
            1,
            100,
            PRE_ROOT_0,
            POST_ROOT_1,
            TX_ROOT_1,
            withdrawalsRoot,
            providedHashes,
            keccak256("canonical-batch-bytes"),
            1
        );
    }

    function testSubmitStateBatchWithBlobRejectsUnexpectedExtraBlob() public {
        bytes32 withdrawalsRoot = _leaf(bytes32(uint256(10)), address(0), recipient, 10 ether);
        bytes32[] memory providedHashes = new bytes32[](1);
        providedHashes[0] = bytes32(uint256(0x0101));
        bytes32[] memory actualHashes = new bytes32[](2);
        actualHashes[0] = providedHashes[0];
        actualHashes[1] = bytes32(uint256(0x0102));
        vm.blobhashes(actualHashes);

        vm.prank(sequencer);
        vm.expectRevert(bytes("SequencerFacet: Unexpected extra blob"));
        diamond.submitStateBatchWithBlob(
            1,
            1,
            100,
            PRE_ROOT_0,
            POST_ROOT_1,
            TX_ROOT_1,
            withdrawalsRoot,
            providedHashes,
            keccak256("canonical-batch-bytes"),
            1
        );
    }

    function testDANoneRejectedAfterActivationButPreActivationStillWorks() public {
        vm.prank(owner);
        diamond.setRequiredDAMode(1, 2);

        bytes32 root1 = _leaf(bytes32(uint256(11)), address(0), recipient, 11 ether);
        bytes32 root2 = _leaf(bytes32(uint256(12)), address(0), recipient, 12 ether);

        vm.prank(sequencer);
        diamond.submitStateBatch(1, 1, 100, PRE_ROOT_0, POST_ROOT_1, TX_ROOT_1, root1);

        vm.prank(sequencer);
        vm.expectRevert(bytes("SequencerFacet: DA required"));
        diamond.submitStateBatch(2, 101, 200, POST_ROOT_1, POST_ROOT_2, TX_ROOT_2, root2);
    }

    function testLegacySubmitBatchRejectedAfterActivationAndReadableBeforeActivation() public {
        vm.prank(owner);
        diamond.setRequiredDAMode(2, 2);

        bytes32 legacyWithdrawalRoot = _legacyLeaf(bytes32(uint256(13)), address(0), recipient, 13 ether);
        vm.prank(sequencer);
        diamond.submitBatch(100, POST_ROOT_1, TX_ROOT_1, legacyWithdrawalRoot);

        require(diamond.getBatchWithdrawalRoot(1) == legacyWithdrawalRoot, "legacy root unreadable");

        vm.prank(owner);
        diamond.anchorStateCommitment(1, 100, POST_ROOT_1);

        vm.prank(sequencer);
        vm.expectRevert(bytes("SequencerFacet: Blob DA required"));
        diamond.submitBatch(200, POST_ROOT_2, TX_ROOT_2, legacyWithdrawalRoot);
    }

    function testAnchorRejectedForPostActivationBatch() public {
        vm.prank(owner);
        diamond.setRequiredDAMode(1, 1);

        vm.prank(owner);
        vm.expectRevert(bytes("SequencerFacet: DA active for batch"));
        diamond.anchorStateCommitment(1, 100, POST_ROOT_1);
    }

    function testDARequiredAllowsCalldataExactlyAtActivationBatch() public {
        vm.prank(owner);
        diamond.setRequiredDAMode(1, 1);

        bytes32 withdrawalsRoot = _leaf(bytes32(uint256(14)), address(0), recipient, 14 ether);
        bytes memory batchData = abi.encodePacked("batch-1");

        vm.prank(sequencer);
        diamond.submitStateBatchWithCalldata(1, 1, 100, PRE_ROOT_0, POST_ROOT_1, TX_ROOT_1, withdrawalsRoot, batchData);

        (uint8 mode,,,) = diamond.getBatchDACommitment(1);
        require(mode == 1, "calldata not accepted at activation");
    }

    function testBlobRequiredRejectsCalldataExactlyAtActivationBatch() public {
        vm.prank(owner);
        diamond.setRequiredDAMode(2, 1);

        bytes32 withdrawalsRoot = _leaf(bytes32(uint256(15)), address(0), recipient, 15 ether);
        bytes memory batchData = abi.encodePacked("batch-1");

        vm.prank(sequencer);
        vm.expectRevert(bytes("SequencerFacet: Blob DA required"));
        diamond.submitStateBatchWithCalldata(1, 1, 100, PRE_ROOT_0, POST_ROOT_1, TX_ROOT_1, withdrawalsRoot, batchData);
    }

    function testBlobRequiredAllowsBlobExactlyAtActivationBatch() public {
        vm.prank(owner);
        diamond.setRequiredDAMode(2, 1);

        bytes32 withdrawalsRoot = _leaf(bytes32(uint256(16)), address(0), recipient, 16 ether);
        bytes32[] memory blobVersionedHashes = new bytes32[](1);
        blobVersionedHashes[0] = bytes32(uint256(0x0116));
        vm.blobhashes(blobVersionedHashes);

        vm.prank(sequencer);
        diamond.submitStateBatchWithBlob(
            1,
            1,
            100,
            PRE_ROOT_0,
            POST_ROOT_1,
            TX_ROOT_1,
            withdrawalsRoot,
            blobVersionedHashes,
            keccak256("canonical-batch-bytes"),
            1
        );

        (uint8 mode,,,) = diamond.getBatchDACommitment(1);
        require(mode == 2, "blob not accepted at activation");
    }

    function testOwnerCanDeactivateDAPolicyForEmergencyRollback() public {
        vm.prank(owner);
        diamond.setRequiredDAMode(2, 1);
        (uint8 requiredMode, uint256 activationBatch) = diamond.getRequiredDAPolicy();
        require(requiredMode == 2 && activationBatch == 1, "policy not set");

        vm.prank(owner);
        diamond.setRequiredDAMode(0, 0);
        (requiredMode, activationBatch) = diamond.getRequiredDAPolicy();
        require(requiredMode == 0 && activationBatch == 0, "policy not disabled");

        bytes32 withdrawalsRoot = _leaf(bytes32(uint256(17)), address(0), recipient, 17 ether);
        vm.prank(sequencer);
        diamond.submitStateBatch(1, 1, 100, PRE_ROOT_0, POST_ROOT_1, TX_ROOT_1, withdrawalsRoot);
    }

    function testNonOwnerCannotSetDAPolicyAndInvalidActivationRejected() public {
        vm.expectRevert();
        diamond.setRequiredDAMode(1, 1);

        vm.prank(owner);
        vm.expectRevert(bytes("SequencerFacet: Invalid activation batch"));
        diamond.setRequiredDAMode(1, 0);

        vm.prank(owner);
        vm.expectRevert(bytes("SequencerFacet: Invalid required DA mode"));
        diamond.setRequiredDAMode(3, 1);
    }

    function testSubmitStateBatchRejectsBlockGapAndWrongPreRoot() public {
        bytes32 root1 = _leaf(bytes32(uint256(1)), address(0), recipient, 1 ether);
        bytes32 root2 = _leaf(bytes32(uint256(2)), address(0), recipient, 2 ether);

        vm.prank(sequencer);
        diamond.submitStateBatch(1, 1, 100, PRE_ROOT_0, POST_ROOT_1, TX_ROOT_1, root1);

        vm.prank(sequencer);
        vm.expectRevert(bytes("SequencerFacet: Block range not continuous"));
        diamond.submitStateBatch(2, 102, 200, POST_ROOT_1, POST_ROOT_2, TX_ROOT_2, root2);

        vm.prank(sequencer);
        vm.expectRevert(bytes("SequencerFacet: State root not chained"));
        diamond.submitStateBatch(2, 101, 200, bytes32(uint256(0xDEAD)), POST_ROOT_2, TX_ROOT_2, root2);
    }

    function testAnchorLegacyBatchAllowsNextStateBatch() public {
        bytes32 legacyWithdrawalRoot = _legacyLeaf(bytes32(uint256(1)), address(0), recipient, 1 ether);

        vm.prank(sequencer);
        diamond.submitBatch(100, POST_ROOT_1, TX_ROOT_1, legacyWithdrawalRoot);

        vm.prank(owner);
        diamond.anchorStateCommitment(1, 100, POST_ROOT_1);

        bytes32 root2 = _leaf(bytes32(uint256(2)), address(0), recipient, 2 ether);
        vm.prank(sequencer);
        diamond.submitStateBatch(2, 101, 200, POST_ROOT_1, POST_ROOT_2, TX_ROOT_2, root2);

        (,, bytes32 preStateRoot, bytes32 postStateRoot,,,,, bool exists) = diamond.getStateCommitment(2);
        require(exists, "second commitment missing");
        require(preStateRoot == POST_ROOT_1, "anchor did not chain");
        require(postStateRoot == POST_ROOT_2, "wrong second post root");
    }

    function testWrongSequencerCannotSubmitStateBatchWhenRotationDiffers() public {
        vm.prank(owner);
        diamond.addSequencer(otherSequencer);

        bytes32 withdrawalsRoot = _leaf(bytes32(uint256(1)), address(0), recipient, 1 ether);

        // batch 1 / block 100 maps to sequencer index 1 when two sequencers are active.
        vm.prank(sequencer);
        vm.expectRevert(bytes("SequencerFacet: Not your turn"));
        diamond.submitStateBatch(1, 1, 100, PRE_ROOT_0, POST_ROOT_1, TX_ROOT_1, withdrawalsRoot);

        vm.prank(otherSequencer);
        diamond.submitStateBatch(1, 1, 100, PRE_ROOT_0, POST_ROOT_1, TX_ROOT_1, withdrawalsRoot);
    }

    function testWithdrawalMustUseItsCommittedBatchRoot() public {
        bytes32 withdrawalId = bytes32(uint256(0xABC));
        uint256 amount = 1 ether;
        bytes32 withdrawalsRoot = _leaf(withdrawalId, address(0), recipient, amount);
        bytes32 wrongRoot = _leaf(bytes32(uint256(0xBAD)), address(0), recipient, amount);

        vm.prank(sequencer);
        diamond.submitStateBatch(1, 1, 100, PRE_ROOT_0, POST_ROOT_1, TX_ROOT_1, withdrawalsRoot);

        vm.prank(sequencer);
        diamond.submitStateBatch(2, 101, 200, POST_ROOT_1, POST_ROOT_2, TX_ROOT_2, wrongRoot);

        bytes32[] memory emptyProof = new bytes32[](0);
        vm.expectRevert(BridgeFacet.InvalidProof.selector);
        diamond.queueWithdrawalV3(2, withdrawalId, address(0), recipient, amount, emptyProof);

        diamond.queueWithdrawalV3(1, withdrawalId, address(0), recipient, amount, emptyProof);

        (,,, uint256 batchNumber,,,) = diamond.getWithdrawalStatus(withdrawalId);
        require(batchNumber == 1, "withdrawal not tied to source batch");
    }

    function testInvalidatedBatchBlocksWithdrawalFinalization() public {
        bytes32 withdrawalId = bytes32(uint256(0xDEF));
        uint256 amount = 1 ether;
        bytes32 withdrawalsRoot = _leaf(withdrawalId, address(0), recipient, amount);

        vm.prank(sequencer);
        diamond.submitStateBatch(1, 1, 100, PRE_ROOT_0, POST_ROOT_1, TX_ROOT_1, withdrawalsRoot);

        bytes32[] memory emptyProof = new bytes32[](0);
        diamond.queueWithdrawalV3(1, withdrawalId, address(0), recipient, amount, emptyProof);

        vm.prank(disputeGame);
        diamond.invalidateBatch(1);

        vm.warp(block.timestamp + 1 days + 1);
        vm.expectRevert(BridgeFacet.WithdrawalBatchInvalidated.selector);
        diamond.finalizeWithdrawal(withdrawalId);
    }

    function testOnlyDisputeGameCanChallengeWithdrawalAndProofMustMatchBatch() public {
        bytes32 withdrawalId = bytes32(uint256(0x456));
        uint256 amount = 1 ether;
        bytes32 withdrawalsRoot = _leaf(withdrawalId, address(0), recipient, amount);

        vm.prank(sequencer);
        diamond.submitStateBatch(1, 1, 100, PRE_ROOT_0, POST_ROOT_1, TX_ROOT_1, withdrawalsRoot);

        bytes32[] memory emptyProof = new bytes32[](0);
        diamond.queueWithdrawalV3(1, withdrawalId, address(0), recipient, amount, emptyProof);

        vm.expectRevert(BridgeFacet.OnlyDisputeGame.selector);
        diamond.challengeWithdrawal(withdrawalId, abi.encode(uint256(1)));

        vm.prank(disputeGame);
        vm.expectRevert(BridgeFacet.ChallengeProofMismatch.selector);
        diamond.challengeWithdrawal(withdrawalId, abi.encode(uint256(2)));

        vm.prank(disputeGame);
        diamond.challengeWithdrawal(withdrawalId, abi.encode(uint256(1)));

        vm.warp(block.timestamp + 1 days + 1);
        vm.expectRevert(BridgeFacet.WithdrawalChallengedError.selector);
        diamond.finalizeWithdrawal(withdrawalId);
    }

    function testDynamicChallengeOracleExpiryIsStoredAtQueueTime() public {
        FixedChallengeOracle oracle = new FixedChallengeOracle(2 days);
        vm.prank(owner);
        diamond.setChallengePeriodOracle(address(oracle));

        bytes32 withdrawalId = bytes32(uint256(0x789));
        uint256 amount = 1 ether;
        bytes32 withdrawalsRoot = _leaf(withdrawalId, address(0), recipient, amount);

        vm.prank(sequencer);
        diamond.submitStateBatch(1, 1, 100, PRE_ROOT_0, POST_ROOT_1, TX_ROOT_1, withdrawalsRoot);
        require(oracle.submittedCount() == 1, "challenge recorder not updated");

        bytes32[] memory emptyProof = new bytes32[](0);
        uint256 queuedAt = block.timestamp;
        diamond.queueWithdrawalV3(1, withdrawalId, address(0), recipient, amount, emptyProof);

        (,, uint256 challengeExpiry,,,,) = diamond.getWithdrawalStatus(withdrawalId);
        require(challengeExpiry == queuedAt + 2 days, "oracle challenge expiry not stored");

        vm.warp(queuedAt + 1 days + 1);
        vm.expectRevert(BridgeFacet.ChallengePeriodNotExpired.selector);
        diamond.finalizeWithdrawal(withdrawalId);

        vm.warp(queuedAt + 2 days + 1);
        diamond.finalizeWithdrawal(withdrawalId);
    }

    function testFinalizesWithdrawalAfterChallengePeriodWhenBatchValid() public {
        bytes32 withdrawalId = bytes32(uint256(0x123));
        uint256 amount = 1 ether;
        bytes32 withdrawalsRoot = _leaf(withdrawalId, address(0), recipient, amount);

        vm.prank(sequencer);
        diamond.submitStateBatch(1, 1, 100, PRE_ROOT_0, POST_ROOT_1, TX_ROOT_1, withdrawalsRoot);

        bytes32[] memory emptyProof = new bytes32[](0);
        diamond.queueWithdrawalV3(1, withdrawalId, address(0), recipient, amount, emptyProof);

        uint256 beforeBalance = recipient.balance;
        vm.warp(block.timestamp + 1 days + 1);
        diamond.finalizeWithdrawal(withdrawalId);

        require(recipient.balance == beforeBalance + amount, "withdrawal not paid");
        require(diamond.isWithdrawalProcessed(withdrawalId), "withdrawal not marked processed");
    }

    function _leaf(bytes32 withdrawalId, address token, address to, uint256 amount) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(keccak256(abi.encodePacked(withdrawalId, token, to, amount))));
    }

    function _legacyLeaf(bytes32 withdrawalId, address token, address to, uint256 amount)
        private
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(withdrawalId, token, to, amount));
    }
}
