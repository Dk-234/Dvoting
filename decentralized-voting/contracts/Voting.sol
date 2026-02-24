// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Voting {
    struct VotingOption {
        uint256 id;
        string name;
        uint256 voteCount;
    }

    struct Proposal {
        uint256 id;
        string name;
        string description;
        string ipfsHash;
        uint256 totalVotes;
        uint256 optionsCount;
        address creator;
        uint256 startTime;   // per-proposal start time (unix timestamp)
        uint256 duration;    // per-proposal duration in seconds
        bool votingActive;   // per-proposal active flag
    }

    struct Voter {
        bool voted;
        uint256 votedProposalId;
        uint256 votedOptionId;
    }

    // ── Identity Verification ──
    struct VerifiedVoter {
        address walletAddress;
        string idHash;        // SHA-256 hash of ID details (privacy-preserving)
        string name;          // voter's name from ID verification
        string idType;        // type of ID used (e.g., "Aadhaar Card", "PAN Card")
        uint256 verifiedAt;   // timestamp of verification
        bool isVerified;      // whether this voter is verified
    }

    address public owner;
    string public votingTitle;

    mapping(address => Voter) public voters;
    Proposal[] public proposals;
    // proposalId => optionId => VotingOption
    mapping(uint256 => mapping(uint256 => VotingOption)) public proposalOptions;
    // voter => proposalId => authorized
    mapping(address => mapping(uint256 => bool)) public voterProposalAuthorization;
    // voter => proposalId => has voted on this proposal
    mapping(address => mapping(uint256 => bool)) public proposalVoted;
    uint256 public totalVotes;

    // ── Identity Verification State ──
    mapping(address => VerifiedVoter) public verifiedVoters;
    address[] public verifiedVoterAddresses;  // for enumeration
    mapping(string => bool) public usedIdHashes; // prevent same ID registering with multiple wallets

    event VoteCast(address indexed voter, uint256 proposalId, uint256 optionId);
    event VotingStarted(uint256 indexed proposalId, uint256 startTime, uint256 duration);
    event VotingEnded(uint256 indexed proposalId, uint256 endTime, uint256 proposalTotalVotes);
    event ProposalAdded(uint256 proposalId, string name);
    event VotingOptionAdded(uint256 proposalId, uint256 optionId, string optionName);
    event VoterAuthorized(address indexed voter, uint256 proposalId);
    event VoterIdentityRegistered(address indexed voter, string name, string idType, uint256 timestamp);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can perform this action");
        _;
    }

    modifier onlyProposalCreator(uint256 _proposalId) {
        require(_proposalId < proposals.length, "Invalid proposal ID");
        require(msg.sender == proposals[_proposalId].creator, "Only proposal creator can perform this action");
        _;
    }

    constructor(string memory _title) {
        owner = msg.sender;
        votingTitle = _title;
    }

    // ════════════════════════════════════════════════
    //  IDENTITY VERIFICATION FUNCTIONS
    // ════════════════════════════════════════════════

    /// @notice Register a verified voter identity on-chain (called after ID verification)
    /// @param _idHash SHA-256 hash of the voter's ID details (never stores raw ID)
    /// @param _name Voter's name as verified from their ID document
    /// @param _idType Type of ID document used for verification
    function registerVerifiedVoter(
        string memory _idHash,
        string memory _name,
        string memory _idType
    ) public {
        require(bytes(_idHash).length > 0, "ID hash cannot be empty");
        require(bytes(_name).length > 0, "Name cannot be empty");
        require(bytes(_idType).length > 0, "ID type cannot be empty");
        require(!verifiedVoters[msg.sender].isVerified, "Wallet already verified");
        require(!usedIdHashes[_idHash], "This ID has already been registered with another wallet");

        verifiedVoters[msg.sender] = VerifiedVoter({
            walletAddress: msg.sender,
            idHash: _idHash,
            name: _name,
            idType: _idType,
            verifiedAt: block.timestamp,
            isVerified: true
        });

        verifiedVoterAddresses.push(msg.sender);
        usedIdHashes[_idHash] = true;

        emit VoterIdentityRegistered(msg.sender, _name, _idType, block.timestamp);
    }

    /// @notice Check if a voter's identity is verified
    function isVoterVerified(address _voter) public view returns (bool) {
        return verifiedVoters[_voter].isVerified;
    }

    /// @notice Get details of a verified voter
    function getVerifiedVoter(address _voter) public view returns (VerifiedVoter memory) {
        return verifiedVoters[_voter];
    }

    /// @notice Get all verified voter addresses
    function getVerifiedVoterAddresses() public view returns (address[] memory) {
        return verifiedVoterAddresses;
    }

    /// @notice Get all verified voters with their details
    function getAllVerifiedVoters() public view returns (VerifiedVoter[] memory) {
        VerifiedVoter[] memory allVoters = new VerifiedVoter[](verifiedVoterAddresses.length);
        for (uint256 i = 0; i < verifiedVoterAddresses.length; i++) {
            allVoters[i] = verifiedVoters[verifiedVoterAddresses[i]];
        }
        return allVoters;
    }

    /// @notice Get count of verified voters
    function getVerifiedVoterCount() public view returns (uint256) {
        return verifiedVoterAddresses.length;
    }

    // Any user can add a proposal at any time
    function addProposal(
        string memory _name,
        string memory _description,
        string memory _ipfsHash
    ) public {
        uint256 proposalId = proposals.length;
        proposals.push(Proposal({
            id: proposalId,
            name: _name,
            description: _description,
            ipfsHash: _ipfsHash,
            totalVotes: 0,
            optionsCount: 0,
            creator: msg.sender,
            startTime: 0,
            duration: 0,
            votingActive: false
        }));

        emit ProposalAdded(proposalId, _name);
    }

    function addVotingOption(uint256 _proposalId, string memory _optionName) public onlyProposalCreator(_proposalId) {
        require(!proposals[_proposalId].votingActive, "Cannot add options after voting has started for this proposal");

        Proposal storage proposal = proposals[_proposalId];
        uint256 optionId = proposal.optionsCount;

        proposalOptions[_proposalId][optionId] = VotingOption({
            id: optionId,
            name: _optionName,
            voteCount: 0
        });

        proposal.optionsCount++;

        emit VotingOptionAdded(_proposalId, optionId, _optionName);
    }

    function addForAgainstOptions(uint256 _proposalId) public onlyProposalCreator(_proposalId) {
        require(!proposals[_proposalId].votingActive, "Cannot add options after voting has started for this proposal");

        addVotingOption(_proposalId, "For");
        addVotingOption(_proposalId, "Against");
    }

    // Only the proposal creator can authorize voters for their proposal
    // Voter must have completed identity verification before being authorized
    function authorizeVoter(address _voter, uint256 _proposalId) public onlyProposalCreator(_proposalId) {
        require(verifiedVoters[_voter].isVerified, "Voter must complete identity verification first");
        require(!proposalVoted[_voter][_proposalId], "Cannot authorize for proposal already voted on");

        voterProposalAuthorization[_voter][_proposalId] = true;

        emit VoterAuthorized(_voter, _proposalId);
    }

    // Only the proposal creator can start voting for their proposal, with a custom duration
    function startVoting(uint256 _proposalId, uint256 _durationInMinutes) public onlyProposalCreator(_proposalId) {
        Proposal storage proposal = proposals[_proposalId];
        require(!proposal.votingActive, "Voting already started for this proposal");
        require(proposal.optionsCount > 0, "Proposal must have at least one voting option");
        require(_durationInMinutes > 0, "Duration must be greater than 0");

        proposal.startTime = block.timestamp;
        proposal.duration = _durationInMinutes * 1 minutes;
        proposal.votingActive = true;

        emit VotingStarted(_proposalId, proposal.startTime, proposal.duration);
    }

    function vote(uint256 _proposalId, uint256 _optionId) public {
        require(_proposalId < proposals.length, "Invalid proposal");
        require(verifiedVoters[msg.sender].isVerified, "Must complete identity verification before voting");
        Proposal storage proposal = proposals[_proposalId];
        require(proposal.votingActive, "Voting is not active for this proposal");
        require(block.timestamp < proposal.startTime + proposal.duration, "Voting period has ended for this proposal");
        require(voterProposalAuthorization[msg.sender][_proposalId], "Not authorized to vote on this proposal");
        require(!proposalVoted[msg.sender][_proposalId], "Already voted on this proposal");
        require(_optionId < proposal.optionsCount, "Invalid option");

        proposalVoted[msg.sender][_proposalId] = true;
        Voter storage sender = voters[msg.sender];
        sender.voted = true;
        sender.votedProposalId = _proposalId;
        sender.votedOptionId = _optionId;

        proposalOptions[_proposalId][_optionId].voteCount++;
        proposal.totalVotes++;
        totalVotes++;

        emit VoteCast(msg.sender, _proposalId, _optionId);
    }

    // Only the proposal creator can end voting for their proposal (after duration elapses)
    function endVoting(uint256 _proposalId) public onlyProposalCreator(_proposalId) {
        Proposal storage proposal = proposals[_proposalId];
        require(proposal.votingActive, "Voting is not active for this proposal");
        require(block.timestamp >= proposal.startTime + proposal.duration, "Voting period not yet ended");

        proposal.votingActive = false;

        emit VotingEnded(_proposalId, block.timestamp, proposal.totalVotes);
    }

    function getProposals() public view returns (Proposal[] memory) {
        return proposals;
    }

    function getProposal(uint256 _id) public view returns (Proposal memory) {
        require(_id < proposals.length, "Invalid proposal ID");
        return proposals[_id];
    }

    function getProposalOptions(uint256 _proposalId) public view returns (VotingOption[] memory) {
        require(_proposalId < proposals.length, "Invalid proposal ID");

        uint256 optionsCount = proposals[_proposalId].optionsCount;
        VotingOption[] memory options = new VotingOption[](optionsCount);

        for (uint256 i = 0; i < optionsCount; i++) {
            options[i] = proposalOptions[_proposalId][i];
        }

        return options;
    }

    function getProposalOption(uint256 _proposalId, uint256 _optionId) public view returns (VotingOption memory) {
        require(_proposalId < proposals.length, "Invalid proposal ID");
        require(_optionId < proposals[_proposalId].optionsCount, "Invalid option ID");
        return proposalOptions[_proposalId][_optionId];
    }

    function getResults() public view returns (uint256[] memory) {
        uint256[] memory results = new uint256[](proposals.length);
        for (uint256 i = 0; i < proposals.length; i++) {
            results[i] = proposals[i].totalVotes;
        }
        return results;
    }

    function getProposalResults(uint256 _proposalId) public view returns (uint256[] memory) {
        require(_proposalId < proposals.length, "Invalid proposal ID");

        uint256 optionsCount = proposals[_proposalId].optionsCount;
        uint256[] memory results = new uint256[](optionsCount);

        for (uint256 i = 0; i < optionsCount; i++) {
            results[i] = proposalOptions[_proposalId][i].voteCount;
        }

        return results;
    }

    // Returns seconds remaining for a specific proposal's voting session
    function timeRemaining(uint256 _proposalId) public view returns (uint256) {
        require(_proposalId < proposals.length, "Invalid proposal ID");
        Proposal storage proposal = proposals[_proposalId];
        if (!proposal.votingActive) return 0;
        if (block.timestamp >= proposal.startTime + proposal.duration) return 0;
        return (proposal.startTime + proposal.duration) - block.timestamp;
    }

    // Returns true if the proposal's voting session is currently open and within its time window
    function isProposalVotingActive(uint256 _proposalId) public view returns (bool) {
        if (_proposalId >= proposals.length) return false;
        Proposal storage proposal = proposals[_proposalId];
        return proposal.votingActive && block.timestamp < proposal.startTime + proposal.duration;
    }

    function hasVoted(address _voter) public view returns (bool) {
        return voters[_voter].voted;
    }

    // Check if voter has voted on a specific proposal
    function hasVotedOnProposal(address _voter, uint256 _proposalId) public view returns (bool) {
        return proposalVoted[_voter][_proposalId];
    }

    function getProposalsCount() public view returns (uint256) {
        return proposals.length;
    }

    function getVoterChoice(address _voter) public view returns (uint256 proposalId, uint256 optionId, bool voted) {
        Voter memory voter = voters[_voter];
        return (voter.votedProposalId, voter.votedOptionId, voter.voted);
    }

    // Check if voter is authorized for a specific proposal
    function isAuthorizedForProposal(address _voter, uint256 _proposalId) public view returns (bool) {
        return voterProposalAuthorization[_voter][_proposalId];
    }
}