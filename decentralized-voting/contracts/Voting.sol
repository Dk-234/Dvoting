// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Voting {
    struct Proposal {
        uint256 id;
        string name;
        string description;
        uint256 voteCount;
        string ipfsHash;
    }
    
    struct Voter {
        bool authorized;
        bool voted;
        uint256 vote;
    }
    
    address public owner;
    string public votingTitle;
    uint256 public votingDuration;
    uint256 public startTime;
    bool public votingActive;
    
    mapping(address => Voter) public voters;
    Proposal[] public proposals;
    uint256 public totalVotes;
    
    event VoteCast(address indexed voter, uint256 proposalId);
    event VotingStarted(uint256 startTime, uint256 duration);
    event VotingEnded(uint256 endTime, uint256 totalVotes);
    event ProposalAdded(uint256 proposalId, string name);
    event VoterAuthorized(address voter);
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can perform this action");
        _;
    }
    
    modifier duringVoting() {
        require(votingActive, "Voting is not active");
        require(block.timestamp < startTime + votingDuration, "Voting period has ended");
        _;
    }
    
    constructor(string memory _title, uint256 _durationInMinutes) {
        owner = msg.sender;
        votingTitle = _title;
        votingDuration = _durationInMinutes * 1 minutes;
        votingActive = false;
    }
    
    function addProposal(
        string memory _name, 
        string memory _description, 
        string memory _ipfsHash
    ) public onlyOwner {
        require(!votingActive, "Cannot add proposals after voting has started");
        
        uint256 proposalId = proposals.length;
        proposals.push(Proposal({
            id: proposalId,
            name: _name,
            description: _description,
            voteCount: 0,
            ipfsHash: _ipfsHash
        }));
        
        emit ProposalAdded(proposalId, _name);
    }
    
    function authorizeVoter(address _voter) public onlyOwner {
        require(!voters[_voter].voted, "Cannot authorize after voter has voted");
        voters[_voter].authorized = true;
        emit VoterAuthorized(_voter);
    }
    
    function startVoting() public onlyOwner {
        require(!votingActive, "Voting already started");
        require(proposals.length > 0, "No proposals added");
        
        startTime = block.timestamp;
        votingActive = true;
        
        emit VotingStarted(startTime, votingDuration);
    }
    
    function vote(uint256 _proposalId) public duringVoting {
        Voter storage sender = voters[msg.sender];
        require(sender.authorized, "Not authorized to vote");
        require(!sender.voted, "Already voted");
        require(_proposalId < proposals.length, "Invalid proposal");
        
        sender.voted = true;
        sender.vote = _proposalId;
        proposals[_proposalId].voteCount++;
        totalVotes++;
        
        emit VoteCast(msg.sender, _proposalId);
    }
    
    function endVoting() public onlyOwner {
        require(votingActive, "Voting is not active");
        require(block.timestamp >= startTime + votingDuration, "Voting period not yet ended");
        
        votingActive = false;
        
        emit VotingEnded(block.timestamp, totalVotes);
    }
    
    function getProposals() public view returns (Proposal[] memory) {
        return proposals;
    }
    
    function getProposal(uint256 _id) public view returns (Proposal memory) {
        require(_id < proposals.length, "Invalid proposal ID");
        return proposals[_id];
    }
    
    function getResults() public view returns (uint256[] memory) {
        uint256[] memory results = new uint256[](proposals.length);
        for (uint256 i = 0; i < proposals.length; i++) {
            results[i] = proposals[i].voteCount;
        }
        return results;
    }
    
    function timeRemaining() public view returns (uint256) {
        if (!votingActive) return 0;
        if (block.timestamp >= startTime + votingDuration) return 0;
        return (startTime + votingDuration) - block.timestamp;
    }
    
    function isAuthorized(address _voter) public view returns (bool) {
        return voters[_voter].authorized;
    }
    
    function hasVoted(address _voter) public view returns (bool) {
        return voters[_voter].voted;
    }
    
    function getProposalsCount() public view returns (uint256) {
        return proposals.length;
    }
}