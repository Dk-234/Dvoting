import { ethers } from "hardhat";
import { expect } from "chai";

describe("Voting Contract", function () {
  let voting;
  let owner, voter1, voter2, voter3;

  beforeEach(async function () {
    [owner, voter1, voter2, voter3] = await ethers.getSigners();
    
    const Voting = await ethers.getContractFactory("Voting");
    voting = await Voting.deploy("Test Election", 10); // 10 minutes for testing
    await voting.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await voting.owner()).to.equal(owner.address);
    });

    it("Should set the correct voting title", async function () {
      expect(await voting.votingTitle()).to.equal("Test Election");
    });

    it("Should initialize with voting inactive", async function () {
      expect(await voting.votingActive()).to.be.false;
    });
  });

  describe("Proposals", function () {
    it("Should allow owner to add proposals", async function () {
      await voting.addProposal("Proposal 1", "Description 1", "ipfs-hash-1");
      const proposals = await voting.getProposals();
      
      expect(proposals.length).to.equal(1);
      expect(proposals[0].name).to.equal("Proposal 1");
      expect(proposals[0].description).to.equal("Description 1");
    });

    it("Should not allow non-owner to add proposals", async function () {
      await expect(
        voting.connect(voter1).addProposal("Proposal 1", "Desc", "")
      ).to.be.revertedWith("Only owner can perform this action");
    });

    it("Should not allow adding proposals after voting starts", async function () {
      await voting.addProposal("Proposal 1", "Desc", "");
      await voting.startVoting();
      
      await expect(
        voting.addProposal("Proposal 2", "Desc", "")
      ).to.be.revertedWith("Cannot add proposals after voting has started");
    });
  });

  describe("Voter Authorization", function () {
    it("Should authorize voters", async function () {
      await voting.authorizeVoter(voter1.address);
      expect(await voting.isAuthorized(voter1.address)).to.be.true;
    });

    it("Should not authorize voters after they voted", async function () {
      await voting.addProposal("Proposal 1", "Desc", "");
      await voting.authorizeVoter(voter1.address);
      await voting.startVoting();
      await voting.connect(voter1).vote(0);
      
      await expect(
        voting.authorizeVoter(voter2.address)
      ).to.not.be.reverted; // Can still authorize others
    });
  });

  describe("Voting Process", function () {
    beforeEach(async function () {
      await voting.addProposal("Proposal 1", "Description 1", "");
      await voting.addProposal("Proposal 2", "Description 2", "");
      await voting.authorizeVoter(voter1.address);
      await voting.authorizeVoter(voter2.address);
      await voting.startVoting();
    });

    it("Should allow authorized voters to vote", async function () {
      await voting.connect(voter1).vote(0);
      const results = await voting.getResults();
      
      expect(results[0]).to.equal(1);
      expect(await voting.hasVoted(voter1.address)).to.be.true;
    });

    it("Should not allow unauthorized voters to vote", async function () {
      await expect(
        voting.connect(voter3).vote(0)
      ).to.be.revertedWith("Not authorized to vote");
    });

    it("Should not allow double voting", async function () {
      await voting.connect(voter1).vote(0);
      
      await expect(
        voting.connect(voter1).vote(1)
      ).to.be.revertedWith("Already voted");
    });

    it("Should track total votes correctly", async function () {
      await voting.connect(voter1).vote(0);
      await voting.connect(voter2).vote(1);
      
      expect(await voting.totalVotes()).to.equal(2);
    });
  });

  describe("Results", function () {
    beforeEach(async function () {
      await voting.addProposal("A", "Desc A", "");
      await voting.addProposal("B", "Desc B", "");
      await voting.addProposal("C", "Desc C", "");
      
      await voting.authorizeVoter(voter1.address);
      await voting.authorizeVoter(voter2.address);
      await voting.authorizeVoter(voter3.address);
      await voting.startVoting();
    });

    it("Should return correct results", async function () {
      await voting.connect(voter1).vote(0); // A
      await voting.connect(voter2).vote(1); // B
      await voting.connect(voter3).vote(0); // A
      
      const results = await voting.getResults();
      
      expect(results[0]).to.equal(2); // A has 2 votes
      expect(results[1]).to.equal(1); // B has 1 vote
      expect(results[2]).to.equal(0); // C has 0 votes
    });

    it("Should return all proposals", async function () {
      const proposals = await voting.getProposals();
      expect(proposals.length).to.equal(3);
    });
  });
});