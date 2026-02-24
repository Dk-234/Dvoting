import pkg from "hardhat";
import { expect } from "chai";
import "@nomicfoundation/hardhat-chai-matchers";
const { ethers } = pkg;

// Note: ethers.js v6 returns BigInt values, so we need to compare with BigInt(1) or use .to.equal(1n)

describe("Voting Contract", function () {
  let voting;
  let owner, voter1, voter2, voter3;

  beforeEach(async function () {
    [owner, voter1, voter2, voter3] = await ethers.getSigners();

    const Voting = await ethers.getContractFactory("Voting");
    voting = await Voting.deploy("Test Election"); // no global duration — per-proposal now
    await voting.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await voting.owner()).to.equal(owner.address);
    });

    it("Should set the correct voting title", async function () {
      expect(await voting.votingTitle()).to.equal("Test Election");
    });

    it("Should initialize with no active voting", async function () {
      await voting.addProposal("P1", "Desc", "");
      expect(await voting.isProposalVotingActive(0)).to.be.false;
    });
  });

  describe("Proposals", function () {
    it("Should allow any user to add proposals", async function () {
      await voting.connect(voter1).addProposal("Proposal 1", "Description 1", "ipfs-hash-1");
      const proposals = await voting.getProposals();

      expect(proposals.length).to.equal(1);
      expect(proposals[0].name).to.equal("Proposal 1");
      expect(proposals[0].description).to.equal("Description 1");
      expect(proposals[0].creator).to.equal(voter1.address);
    });

    it("Should allow adding proposals even while others are voting", async function () {
      await voting.addProposal("Proposal 1", "Desc", "");
      await voting.addVotingOption(0, "Yes");
      await voting.startVoting(0, 60); // start voting on proposal 0

      // Adding a new proposal while proposal 0 is active should be allowed
      await expect(
        voting.connect(voter1).addProposal("Proposal 2", "Desc", "")
      ).to.not.be.reverted;
    });

    it("Should allow adding voting options to proposals", async function () {
      await voting.addProposal("Proposal 1", "Desc", "");
      await voting.addVotingOption(0, "Option A");
      await voting.addVotingOption(0, "Option B");

      const options = await voting.getProposalOptions(0);
      expect(options.length).to.equal(2);
      expect(options[0].name).to.equal("Option A");
      expect(options[1].name).to.equal("Option B");
    });

    it("Should not allow adding options after proposal voting starts", async function () {
      await voting.addProposal("Proposal 1", "Desc", "");
      await voting.addVotingOption(0, "Yes");
      await voting.startVoting(0, 60);

      await expect(
        voting.addVotingOption(0, "No")
      ).to.be.revertedWith("Cannot add options after voting has started for this proposal");
    });

    it("Should add For/Against options correctly", async function () {
      await voting.addProposal("Proposal 1", "Desc", "");
      await voting.addForAgainstOptions(0);

      const options = await voting.getProposalOptions(0);
      expect(options.length).to.equal(2);
      expect(options[0].name).to.equal("For");
      expect(options[1].name).to.equal("Against");
    });
  });

  describe("Voter Authorization", function () {
    it("Should authorize voters for specific proposals", async function () {
      await voting.addProposal("Proposal 1", "Desc", "");
      await voting.authorizeVoter(voter1.address, 0);

      expect(await voting.isAuthorizedForProposal(voter1.address, 0)).to.be.true;
      expect(await voting.isAuthorizedForProposal(voter1.address, 1)).to.be.false;
    });

    it("Should not authorize voters after they voted", async function () {
      await voting.addProposal("Proposal 1", "Desc", "");
      await voting.addVotingOption(0, "For");
      await voting.addProposal("Proposal 2", "Desc", "");
      await voting.addVotingOption(1, "Yes");

      await voting.authorizeVoter(voter1.address, 0);
      await voting.authorizeVoter(voter1.address, 1);

      await voting.startVoting(0, 60);
      await voting.startVoting(1, 60);

      // voter1 votes on proposal 0
      await voting.connect(voter1).vote(0, 0);

      // Cannot re-authorize for proposal 0 after they voted on it
      await expect(
        voting.authorizeVoter(voter1.address, 0)
      ).to.be.revertedWith("Cannot authorize for proposal already voted on");

      // voter1 can still vote on proposal 1
      await expect(
        voting.connect(voter1).vote(1, 0)
      ).to.not.be.reverted;
    });

    it("Should not allow non-creator to authorize voters", async function () {
      await voting.addProposal("Proposal 1", "Desc", "");
      await expect(
        voting.connect(voter1).authorizeVoter(voter2.address, 0)
      ).to.be.revertedWith("Only proposal creator can perform this action");
    });
  });

  describe("Per-proposal Voting", function () {
    beforeEach(async function () {
      await voting.addProposal("Proposal 1", "Description 1", "");
      await voting.addVotingOption(0, "For");
      await voting.addVotingOption(0, "Against");

      await voting.addProposal("Proposal 2", "Description 2", "");
      await voting.addVotingOption(1, "Option A");
      await voting.addVotingOption(1, "Option B");

      await voting.authorizeVoter(voter1.address, 0);
      await voting.authorizeVoter(voter1.address, 1);
      await voting.authorizeVoter(voter2.address, 0);
      await voting.authorizeVoter(voter2.address, 1);

      // Start per-proposal voting sessions (60 minutes each)
      await voting.startVoting(0, 60);
      await voting.startVoting(1, 60);
    });

    it("Should activate per-proposal voting", async function () {
      expect(await voting.isProposalVotingActive(0)).to.be.true;
      expect(await voting.isProposalVotingActive(1)).to.be.true;
    });

    it("Should allow authorized voters to vote", async function () {
      await voting.connect(voter1).vote(0, 0); // Vote For on Proposal 1
      const results = await voting.getProposalResults(0);

      expect(results[0]).to.equal(1n);
      expect(await voting.hasVoted(voter1.address)).to.be.true;
    });

    it("Should not allow unauthorized voters to vote", async function () {
      await expect(
        voting.connect(voter3).vote(0, 0)
      ).to.be.revertedWith("Not authorized to vote on this proposal");
    });

    it("Should not allow double voting on same proposal", async function () {
      await voting.connect(voter1).vote(0, 0);

      // voter1 can still vote on proposal 1
      await voting.connect(voter1).vote(1, 0);

      // voter1 tries to vote again on proposal 0
      await expect(
        voting.connect(voter1).vote(0, 1)
      ).to.be.revertedWith("Already voted on this proposal");
    });

    it("Should track total votes correctly", async function () {
      await voting.connect(voter1).vote(0, 0);
      await voting.connect(voter2).vote(1, 1);

      expect(await voting.totalVotes()).to.equal(2n);
    });

    it("Should track voter choices", async function () {
      await voting.connect(voter1).vote(0, 1); // Vote Against on Proposal 1

      const choice = await voting.getVoterChoice(voter1.address);
      expect(choice.proposalId).to.equal(0n);
      expect(choice.optionId).to.equal(1n);
      expect(choice.voted).to.be.true;
    });

    it("Should not allow starting a proposal voting session twice", async function () {
      await expect(
        voting.startVoting(0, 30)
      ).to.be.revertedWith("Voting already started for this proposal");
    });

    it("Should return correct per-proposal time remaining", async function () {
      const remaining = await voting.timeRemaining(0);
      expect(Number(remaining)).to.be.greaterThan(0);
      expect(Number(remaining)).to.be.lessThanOrEqual(60 * 60);
    });
  });

  describe("Results", function () {
    beforeEach(async function () {
      await voting.addProposal("A", "Desc A", "");
      await voting.addVotingOption(0, "Yes");
      await voting.addVotingOption(0, "No");

      await voting.addProposal("B", "Desc B", "");
      await voting.addVotingOption(1, "Option 1");
      await voting.addVotingOption(1, "Option 2");

      await voting.addProposal("C", "Desc C", "");
      await voting.addVotingOption(2, "Choice A");
      await voting.addVotingOption(2, "Choice B");

      await voting.authorizeVoter(voter1.address, 0);
      await voting.authorizeVoter(voter1.address, 1);
      await voting.authorizeVoter(voter2.address, 0);
      await voting.authorizeVoter(voter2.address, 1);
      await voting.authorizeVoter(voter3.address, 0);

      await voting.startVoting(0, 60);
      await voting.startVoting(1, 60);
      await voting.startVoting(2, 60);
    });

    it("Should return correct results", async function () {
      await voting.connect(voter1).vote(0, 0); // A - Yes
      await voting.connect(voter2).vote(1, 0); // B - Option 1
      await voting.connect(voter3).vote(0, 0); // A - Yes

      const resultsA = await voting.getProposalResults(0);
      const resultsB = await voting.getProposalResults(1);
      const resultsC = await voting.getProposalResults(2);

      expect(resultsA[0]).to.equal(2n);
      expect(resultsA[1]).to.equal(0n);
      expect(resultsB[0]).to.equal(1n);
      expect(resultsB[1]).to.equal(0n);
      expect(resultsC[0]).to.equal(0n);
      expect(resultsC[1]).to.equal(0n);
    });

    it("Should return all proposals", async function () {
      const proposals = await voting.getProposals();
      expect(proposals.length).to.equal(3);
    });

    it("Should return correct total votes per proposal", async function () {
      await voting.connect(voter1).vote(0, 0);
      await voting.connect(voter2).vote(0, 1);

      const proposals = await voting.getProposals();
      expect(proposals[0].totalVotes).to.equal(2n);
    });
  });
});
