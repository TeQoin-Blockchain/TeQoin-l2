// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BondManager} from "../src/contracts/fraudproof/BondManager.sol";
import {ChallengePeriod} from "../src/contracts/fraudproof/ChallengePeriod.sol";
import {DisputeGame} from "../src/contracts/fraudproof/DisputeGame.sol";
import {FaultProofVM} from "../src/contracts/fraudproof/FaultProofVM.sol";
import {SequencerFacetV3} from "../src/contracts/fraudproof/SequencerFacetV3.sol";
import {LibAppStorage} from "../src/contracts/diamond/libraries/LibAppStorage.sol";
import {LibDiamond} from "../src/contracts/diamond/libraries/LibDiamond.sol";

interface Vm {
    function expectRevert() external;
    function expectRevert(bytes4 selector) external;
    function prank(address msgSender) external;
    function deal(address who, uint256 amount) external;
    function warp(uint256 newTimestamp) external;
}

contract CommitmentMock {
    struct Commitment {
        uint256 l2StartBlock;
        uint256 l2EndBlock;
        bytes32 preStateRoot;
        bytes32 postStateRoot;
        bytes32 transactionsRoot;
        bytes32 withdrawalsRoot;
        uint256 timestamp;
        address sequencer;
        bool exists;
    }

    mapping(uint256 => Commitment) public commitments;
    mapping(uint256 => bool) public invalidated;

    function setCommitment(
        uint256 batchNumber,
        uint256 l2StartBlock,
        uint256 l2EndBlock,
        bytes32 preStateRoot,
        bytes32 postStateRoot,
        address sequencer
    ) external {
        commitments[batchNumber] = Commitment({
            l2StartBlock: l2StartBlock,
            l2EndBlock: l2EndBlock,
            preStateRoot: preStateRoot,
            postStateRoot: postStateRoot,
            transactionsRoot: keccak256("tx-root"),
            withdrawalsRoot: keccak256("wd-root"),
            timestamp: block.timestamp,
            sequencer: sequencer,
            exists: true
        });
    }

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
    ) {
        Commitment memory c = commitments[batchNumber];
        return (
            c.l2StartBlock,
            c.l2EndBlock,
            c.preStateRoot,
            c.postStateRoot,
            c.transactionsRoot,
            c.withdrawalsRoot,
            c.timestamp,
            c.sequencer,
            c.exists
        );
    }

    function invalidateBatch(uint256 batchNumber) external {
        invalidated[batchNumber] = true;
    }
}

contract SequencerFacetV3Harness is SequencerFacetV3 {
    function harnessSetOwner(address owner) external {
        LibDiamond.setContractOwner(owner);
    }

    function harnessSetCursor(uint256 batchNumber, uint256 l2BlockNumber, bytes32 withdrawalRoot) external {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        s.latestBatchNumber = batchNumber;
        s.latestL2Block = l2BlockNumber;
        s.batchWithdrawalRoots[batchNumber] = withdrawalRoot;
    }

    function harnessSetSequencer(address sequencer, bool active) external {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        s.sequencers[sequencer].operator = sequencer;
        s.sequencers[sequencer].isActive = active;
    }
}

contract FraudProofAuditTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private owner = address(0xA11CE);
    address private challenger = address(0xC0FFEE);
    address private defender = address(0xD0D0);
    address private treasury = address(0x7E);

    uint256 private constant BOND = 1 ether;

    BondManager private bonds;
    FaultProofVM private fpvm;
    CommitmentMock private diamond;
    DisputeGame private disputes;

    function setUp() public {
        vm.deal(owner, 100 ether);
        vm.deal(challenger, 100 ether);
        vm.deal(defender, 100 ether);

        vm.prank(owner);
        bonds = new BondManager(BOND, treasury, 1_000);

        fpvm = new FaultProofVM();
        diamond = new CommitmentMock();

        disputes = new DisputeGame(address(bonds), address(fpvm), address(diamond), 1 days, 4);

        vm.prank(owner);
        bonds.setDisputeGame(address(disputes));
        fpvm.setDisputeGame(address(disputes));

        vm.prank(defender);
        bonds.depositSequencerStake{value: 3 ether}(defender);
    }

    function testBondManagerRejectsProtocolShareOver100Percent() public {
        vm.expectRevert(BondManager.InvalidProtocolShare.selector);
        new BondManager(BOND, treasury, 10_001);
    }

    function testDisputeRequiresDefenderStake() public {
        (bytes32 preHash, bytes32 postHash,) = _validEthTransferClaim();
        diamond.setCommitment(1, 1, 1, preHash, postHash, address(0xBADDEF));

        vm.prank(challenger);
        vm.expectRevert();
        disputes.startDispute{value: BOND}(1, keccak256("challenger-root"));
    }

    function testFalseChallengeDefenderWinsAndRewardAccrues() public {
        (bytes32 preHash, bytes32 postHash, FaultProofVM.TransitionClaim memory claim) = _validEthTransferClaim();
        diamond.setCommitment(1, 1, 1, preHash, postHash, defender);

        vm.prank(challenger);
        uint256 id = disputes.startDispute{value: BOND}(1, keccak256("wrong-challenger-root"));

        disputes.resolveDispute(id, claim);

        (, , , DisputeGame.DisputeStatus status, , , , ,) = disputes.getDispute(id);
        require(status == DisputeGame.DisputeStatus.RESOLVED_DEFENDER_WIN, "defender should win false challenge");
        require(!diamond.invalidated(1), "false challenge must not invalidate batch");
        require(bonds.claimableRewards(defender, id) == 0.9 ether, "defender reward mismatch");
    }

    function testValidChallengeInvalidatesBatchAndRewardsChallenger() public {
        (bytes32 preHash,, FaultProofVM.TransitionClaim memory claim) = _validEthTransferClaim();
        diamond.setCommitment(2, 2, 2, preHash, keccak256("bad-defender-post-root"), defender);

        vm.prank(challenger);
        uint256 id = disputes.startDispute{value: BOND}(2, keccak256("challenger-correct-root"));

        disputes.resolveDispute(id, claim);

        (, , , DisputeGame.DisputeStatus status, , , , ,) = disputes.getDispute(id);
        require(status == DisputeGame.DisputeStatus.RESOLVED_CHALLENGER_WIN, "challenger should win bad batch");
        require(diamond.invalidated(2), "bad batch must be invalidated");
        require(bonds.claimableRewards(challenger, id) == 0.9 ether, "challenger reward mismatch");
    }

    function testDefenderTimeoutInvalidatesBatch() public {
        (bytes32 preHash, bytes32 postHash,) = _validEthTransferClaim();
        diamond.setCommitment(3, 3, 3, preHash, postHash, defender);

        vm.prank(challenger);
        uint256 id = disputes.startDispute{value: BOND}(3, keccak256("wrong-challenger-root"));

        vm.warp(block.timestamp + 1 days + 1);
        disputes.timeout(id);

        (, , , DisputeGame.DisputeStatus status, , , , ,) = disputes.getDispute(id);
        require(status == DisputeGame.DisputeStatus.TIMEOUT_CHALLENGER_WIN, "challenger should win defender timeout");
        require(diamond.invalidated(3), "defender timeout must invalidate batch");
    }

    function testChallengerTimeoutDefenderWinsWithoutInvalidation() public {
        (bytes32 preHash, bytes32 postHash,) = _validEthTransferClaim();
        diamond.setCommitment(4, 4, 5, preHash, postHash, defender);

        vm.prank(challenger);
        uint256 id = disputes.startDispute{value: BOND}(4, keccak256("wrong-challenger-root"));

        vm.prank(defender);
        disputes.respondBisection(id, keccak256("midpoint-defender"));

        vm.warp(block.timestamp + 1 days + 1);
        disputes.timeout(id);

        (, , , DisputeGame.DisputeStatus status, , , , ,) = disputes.getDispute(id);
        require(status == DisputeGame.DisputeStatus.TIMEOUT_DEFENDER_WIN, "defender should win challenger timeout");
        require(!diamond.invalidated(4), "challenger timeout must not invalidate batch");
    }

    function testCannotStartDisputeWithSamePostRoot() public {
        (bytes32 preHash, bytes32 postHash,) = _validEthTransferClaim();
        diamond.setCommitment(5, 5, 5, preHash, postHash, defender);

        vm.prank(challenger);
        vm.expectRevert(DisputeGame.InvalidClaim.selector);
        disputes.startDispute{value: BOND}(5, postHash);
    }

    function testFaultProofVmRejectsPreStateHashMismatch() public {
        (, bytes32 postHash, FaultProofVM.TransitionClaim memory claim) = _validEthTransferClaim();

        vm.expectRevert(FaultProofVM.StateHashMismatch.selector);
        fpvm.verifyStep(keccak256("wrong-pre"), postHash, claim);
    }

    function testFaultProofVmRejectsGenericStorageWriteShortcut() public {
        FaultProofVM.StorageSlot[] memory preSlots = new FaultProofVM.StorageSlot[](1);
        FaultProofVM.StorageSlot[] memory postSlots = new FaultProofVM.StorageSlot[](1);
        preSlots[0] = FaultProofVM.StorageSlot(address(0xCAFE), bytes32(uint256(1)), bytes32(uint256(1)));
        postSlots[0] = FaultProofVM.StorageSlot(address(0xCAFE), bytes32(uint256(1)), bytes32(uint256(2)));

        FaultProofVM.AccountState[] memory emptyAccounts = new FaultProofVM.AccountState[](0);
        bytes32 preHash = keccak256(abi.encode(emptyAccounts, preSlots));
        bytes32 postHash = keccak256(abi.encode(emptyAccounts, postSlots));

        FaultProofVM.TransitionClaim memory claim = FaultProofVM.TransitionClaim({
            transitionType: FaultProofVM.TransitionType.STORAGE_WRITE,
            preAccounts: emptyAccounts,
            preStorage: preSlots,
            postAccounts: emptyAccounts,
            postStorage: postSlots,
            from: address(0),
            to: address(0),
            value: 0,
            data: ""
        });

        (bool valid,) = fpvm.verifyStep(preHash, postHash, claim);
        require(!valid, "generic storage write must fail closed");
    }

    function testFaultProofVmRejectsOversizedInputs() public {
        FaultProofVM.AccountState[] memory tooManyAccounts = new FaultProofVM.AccountState[](17);
        FaultProofVM.AccountState[] memory postAccounts = new FaultProofVM.AccountState[](0);
        FaultProofVM.StorageSlot[] memory emptyStorage = new FaultProofVM.StorageSlot[](0);

        bytes32 preHash = keccak256(abi.encode(tooManyAccounts, emptyStorage));
        bytes32 postHash = keccak256(abi.encode(postAccounts, emptyStorage));

        FaultProofVM.TransitionClaim memory claim = FaultProofVM.TransitionClaim({
            transitionType: FaultProofVM.TransitionType.ETH_TRANSFER,
            preAccounts: tooManyAccounts,
            preStorage: emptyStorage,
            postAccounts: postAccounts,
            postStorage: emptyStorage,
            from: address(0),
            to: address(0),
            value: 0,
            data: ""
        });

        vm.expectRevert(FaultProofVM.InputTooLarge.selector);
        fpvm.verifyStep(preHash, postHash, claim);
    }

    function testChallengePeriodStatsAreAuthenticated() public {
        ChallengePeriod cp = new ChallengePeriod();

        vm.expectRevert();
        cp.recordBatchSubmitted();

        vm.expectRevert();
        cp.recordBatchDisputed();

        vm.expectRevert();
        cp.confirmBatch(1);
    }

    function testSequencerFacetEnforcesChainingAndContinuity() public {
        SequencerFacetV3Harness facet = new SequencerFacetV3Harness();
        bytes32 rootA = keccak256("root-a");
        bytes32 rootB = keccak256("root-b");
        bytes32 txRoot = keccak256("tx");
        bytes32 wdRoot = keccak256("wd");

        facet.harnessSetOwner(owner);
        facet.harnessSetCursor(10, 1000, wdRoot);
        facet.harnessSetSequencer(defender, true);

        vm.prank(owner);
        facet.anchorStateCommitment(10, 1000, rootA);

        vm.prank(defender);
        facet.submitBatch(11, 1001, 1100, rootA, rootB, txRoot, wdRoot);

        vm.prank(defender);
        vm.expectRevert(SequencerFacetV3.BatchNumberNotSequential.selector);
        facet.submitBatch(13, 1101, 1200, rootB, keccak256("root-c"), txRoot, wdRoot);

        vm.prank(defender);
        vm.expectRevert(SequencerFacetV3.StateRootNotChained.selector);
        facet.submitBatch(12, 1101, 1200, keccak256("wrong-pre"), keccak256("root-c"), txRoot, wdRoot);

        vm.prank(challenger);
        vm.expectRevert(SequencerFacetV3.OnlySequencer.selector);
        facet.submitBatch(12, 1101, 1200, rootB, keccak256("root-c"), txRoot, wdRoot);
    }

    function _validEthTransferClaim()
        internal
        pure
        returns (bytes32 preHash, bytes32 postHash, FaultProofVM.TransitionClaim memory claim)
    {
        address from = address(0xF00);
        address to = address(0xB0B);
        uint256 value = 10;

        FaultProofVM.AccountState[] memory preAccounts = new FaultProofVM.AccountState[](2);
        FaultProofVM.AccountState[] memory postAccounts = new FaultProofVM.AccountState[](2);
        FaultProofVM.StorageSlot[] memory emptyStorage = new FaultProofVM.StorageSlot[](0);

        preAccounts[0] = FaultProofVM.AccountState(from, 100, 7);
        preAccounts[1] = FaultProofVM.AccountState(to, 5, 0);
        postAccounts[0] = FaultProofVM.AccountState(from, 90, 8);
        postAccounts[1] = FaultProofVM.AccountState(to, 15, 0);

        preHash = keccak256(abi.encode(preAccounts, emptyStorage));
        postHash = keccak256(abi.encode(postAccounts, emptyStorage));

        claim = FaultProofVM.TransitionClaim({
            transitionType: FaultProofVM.TransitionType.ETH_TRANSFER,
            preAccounts: preAccounts,
            preStorage: emptyStorage,
            postAccounts: postAccounts,
            postStorage: emptyStorage,
            from: from,
            to: to,
            value: value,
            data: ""
        });
    }
}
