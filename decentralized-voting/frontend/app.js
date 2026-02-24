import { contractAddress } from './contractAddress.js';
import { contractABI } from './contractABI.js';

// Application state
let provider;
let signer;
let contract;
let account;
let isOwner = false;
let chartInstance = null;
let selectedProposalForResults = null; // Track selected proposal for results display
let proposalTimers = {};      // proposalId -> client-side countdown seconds
let timerSyncCounters = {};   // proposalId -> ticks since last chain sync
let timerIntervalId = null;   // Track setInterval ID to prevent stacking

// DOM Elements
const connectSection = document.getElementById('connectSection');
const appContent = document.getElementById('appContent');
const connectWalletBtn = document.getElementById('connectWallet');
const accountAddressEl = document.getElementById('accountAddress');
const votingStatusEl = document.getElementById('votingStatus');
const votingTitleEl = document.getElementById('votingTitle');
const totalVotesEl = document.getElementById('totalVotes');
const proposalsCountEl = document.getElementById('proposalsCount');
const activeProposalsCountEl = document.getElementById('activeProposalsCount');
const proposalsListEl = document.getElementById('proposalsList');
const adminPanel = document.getElementById('adminPanel');

// Initialize the application
async function init() {
    console.log('🚀 Initializing application...');
    
    // Check if MetaMask is installed
    if (typeof window.ethereum === 'undefined') {
        showNotification('Please install MetaMask to use this application', 'error');
        return;
    }
    
    // Auto-detect wallet connection: first try passive check, then request connection
    let connected = false;
    try {
        // Passive check — returns accounts if site is already authorized
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        if (accounts.length > 0) {
            await setupApplication(accounts[0]);
            connected = true;
        }
    } catch (error) {
        console.error('Error checking accounts:', error);
    }

    // If not already connected, automatically request wallet connection
    if (!connected) {
        try {
            const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
            if (accounts.length > 0) {
                await setupApplication(accounts[0]);
                showNotification('Wallet connected successfully!', 'success');
                connected = true;
            }
        } catch (error) {
            console.error('Auto-connect failed, user can connect manually:', error);
        }
    }
    
    // Set up event listeners
    connectWalletBtn.addEventListener('click', connectWallet);
    document.getElementById('addProposal').addEventListener('click', addProposal);
    document.getElementById('addVotingOption').addEventListener('click', addVotingOption);
    document.getElementById('addForAgainst').addEventListener('click', addForAgainstOptions);
    document.getElementById('authorizeVoter').addEventListener('click', authorizeVoter);
    document.getElementById('startVoting').addEventListener('click', startVoting);
    document.getElementById('endVoting').addEventListener('click', endVoting);
    document.getElementById('proposalResultsSelect').addEventListener('change', handleProposalResultsSelect);
    document.getElementById('adminToggle').addEventListener('click', toggleAdminPanel);
    
    // Listen for account changes — auto-redirect on new connection
    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', () => window.location.reload());
}

// Connect wallet
async function connectWallet() {
    try {
        showNotification('Connecting to MetaMask...', 'info');
        
        // Request account access
        const accounts = await window.ethereum.request({
            method: 'eth_requestAccounts'
        });
        
        await setupApplication(accounts[0]);
        showNotification('Wallet connected successfully!', 'success');
        
    } catch (error) {
        console.error('Error connecting wallet:', error);
        showNotification('Failed to connect wallet', 'error');
    }
}

// Set up application after wallet connection
async function setupApplication(userAccount) {
    account = userAccount;
    
    // Initialize Ethers provider and signer
    provider = new ethers.BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    
    // Check network
    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);
    
    if (chainId !== 1337) {
        showNotification('Please switch to Hardhat Local network (Chain ID: 1337)', 'error');
        connectSection.classList.remove('hidden');
        appContent.classList.add('hidden');
        return;
    }
    
    // Initialize contract
    contract = new ethers.Contract(contractAddress, contractABI, signer);
    
    // Verify contract exists
    try {
        const code = await provider.getCode(contractAddress);
        if (code === '0x') {
            showNotification('Contract not found. Please redeploy the contract.', 'error');
            connectSection.classList.remove('hidden');
            appContent.classList.add('hidden');
            return;
        }
    } catch (error) {
        console.error('Error checking contract:', error);
        showNotification('Failed to connect to contract', 'error');
        return;
    }
    
    // Check if user is contract owner
    try {
        const owner = await contract.owner();
        isOwner = (owner.toLowerCase() === account.toLowerCase());
    } catch (error) {
        console.error('Error checking owner:', error);
    }
    
    // Always show admin panel - users can manage their own proposals
    adminPanel.classList.remove('hidden');
    showNotification('Admin panel available - create and manage your proposals!', 'info');
    
    // Update UI
    connectSection.classList.add('hidden');
    appContent.classList.remove('hidden');
    accountAddressEl.textContent = `${account.substring(0, 6)}...${account.substring(account.length - 4)}`;
    
    // Load voting data once on connect
    await loadVotingData();
    
    // Tick per-proposal timers every second — clear any previous interval first
    if (timerIntervalId !== null) {
        clearInterval(timerIntervalId);
    }
    timerIntervalId = setInterval(refreshAllTimers, 1000);
    
    // Listen to VoteCast events from the contract for real-time chart updates
    contract.on('VoteCast', async (voter, proposalId, optionId) => {
        console.log(`VoteCast event: voter=${voter}, proposal=${proposalId}, option=${optionId}`);
        // Update totals and chart only
        await refreshResults();
    });
}

// Tick all active proposal timers every second (client-side countdown).
// Re-syncs each proposal timer with the chain every 60 s.
async function refreshAllTimers() {
    if (!contract) return;

    for (const proposalId of Object.keys(proposalTimers)) {
        const id = parseInt(proposalId);
        const current = proposalTimers[id] ?? 0;
        const newVal = Math.max(0, current - 1);
        proposalTimers[id] = newVal;

        // Update the DOM timer for this proposal card
        const timerEl = document.getElementById(`proposal-timer-${id}`);
        const statusEl = document.getElementById(`proposal-timer-status-${id}`);
        if (timerEl) timerEl.textContent = formatTime(newVal);
        if (statusEl && newVal === 0) {
            statusEl.textContent = '⏹ Voting period ended';
            timerEl.textContent = '00:00:00';
        }

        // Periodic chain re-sync (every 60 ticks per proposal)
        // Use on-chain startTime + duration and compute with client clock
        timerSyncCounters[id] = (timerSyncCounters[id] ?? 0) + 1;
        if (timerSyncCounters[id] >= 60) {
            timerSyncCounters[id] = 0;
            try {
                const proposal = await contract.getProposal(id);
                const startTime = Number(proposal.startTime);
                const duration = Number(proposal.duration);
                const nowSec = Math.floor(Date.now() / 1000);
                proposalTimers[id] = Math.max(0, (startTime + duration) - nowSec);
            } catch (e) { /* ignore drift-sync errors */ }
        }
    }

    // Keep the active-proposals count in the status bar current
    const activeCount = Object.values(proposalTimers).filter(t => t > 0).length;
    if (activeProposalsCountEl) activeProposalsCountEl.textContent = activeCount;
}

// Refresh only vote results (totals + chart) without re-rendering proposals
async function refreshResults() {
    if (!contract) return;
    try {
        const [totalVotes, proposals] = await Promise.all([
            contract.totalVotes(),
            contract.getProposals()
        ]);
        totalVotesEl.textContent = totalVotes.toString();
        if (selectedProposalForResults !== null && selectedProposalForResults < proposals.length) {
            const options = await contract.getProposalOptions(selectedProposalForResults);
            updateProposalResultsChart(proposals[selectedProposalForResults], options);
        }
    } catch (error) {
        console.error('Error refreshing results:', error);
    }
}

// Load voting data from contract
async function loadVotingData() {
    if (!contract) {
        return;
    }
    
    try {
        // Load basic contract info
        const [title, totalVotes, proposalsCount] = await Promise.all([
            contract.votingTitle(),
            contract.totalVotes(),
            contract.getProposalsCount()
        ]);
        
        // Update UI
        votingTitleEl.textContent = title;
        totalVotesEl.textContent = totalVotes.toString();
        proposalsCountEl.textContent = proposalsCount.toString();
        
        // Load proposals and results
        const proposals = await contract.getProposals();
        const results = await contract.getResults();

        // Count proposals with active voting and seed per-proposal timers
        let activeCount = 0;
        proposalTimers = {}; // reset on full reload
        timerSyncCounters = {};
        for (let i = 0; i < proposals.length; i++) {
            const p = proposals[i];
            const isActive = p.votingActive;
            if (isActive) {
                activeCount++;
                // Compute remaining time client-side using wall-clock time
                // This avoids Hardhat's frozen block.timestamp in view calls
                const startTime = Number(p.startTime);
                const duration = Number(p.duration);
                const nowSec = Math.floor(Date.now() / 1000);
                const endTime = startTime + duration;
                proposalTimers[i] = Math.max(0, endTime - nowSec);
            }
        }
        
        // Update status bar
        if (activeProposalsCountEl) activeProposalsCountEl.textContent = activeCount;
        if (activeCount > 0) {
            votingStatusEl.textContent = `${activeCount} Proposal${activeCount > 1 ? 's' : ''} Active`;
            votingStatusEl.className = 'voting-status active';
        } else {
            votingStatusEl.textContent = 'No Active Voting';
            votingStatusEl.className = 'voting-status inactive';
        }
        
        displayProposals(proposals);
        populateResultsProposalDropdown(proposals);
        
        // Populate admin dropdowns - show only user's proposals
        populateUserProposalsDropdown(proposals);
        
        // Show results if a proposal was previously selected and exists
        if (selectedProposalForResults !== null && selectedProposalForResults < proposals.length) {
            displayProposalResults(proposals, selectedProposalForResults);
        } else if (proposals.length > 0) {
            // Auto-select first proposal if none selected
            selectedProposalForResults = 0;
            document.getElementById('proposalResultsSelect').value = 0;
            displayProposalResults(proposals, 0);
        }
        
    } catch (error) {
        console.error('Error loading voting data:', error);
        // Only show notification once, not on every poll
        if (!window.votingDataErrorShown) {
            showNotification('Error loading data from contract. Check network and contract deployment.', 'error');
            window.votingDataErrorShown = true;
        }
    }
}

// Display proposals with voting options
async function displayProposals(proposals) {
    proposalsListEl.innerHTML = '';
    
    if (proposals.length === 0) {
        proposalsListEl.innerHTML = '<p class="no-proposals">No proposals added yet.</p>';
        return;
    }
    
    // Check voter status
    let voterInfo = { votedProposalIds: new Set() };
    try {
        // Check which proposals this voter has voted on
        for (let i = 0; i < proposals.length; i++) {
            try {
                const hasVoted = await contract.hasVotedOnProposal(account, i);
                if (hasVoted) {
                    voterInfo.votedProposalIds.add(i);
                }
            } catch (error) {
                console.error(`Error checking vote status for proposal ${i}:`, error);
            }
        }
    } catch (error) {
        console.error('Error fetching voter info:', error);
    }
    
    for (let index = 0; index < proposals.length; index++) {
        const proposal = proposals[index];
        
        // Check if current user is the creator of this proposal
        const isUserProposalCreator = proposal.creator && proposal.creator.toLowerCase() === account.toLowerCase();
        
        // Check if voter is authorized for THIS specific proposal
        let authorizedForThisProposal = false;
        try {
            authorizedForThisProposal = await contract.isAuthorizedForProposal(account, index);
        } catch (error) {
            console.error(`Error checking authorization for proposal ${index}:`, error);
        }
        
        const proposalCard = document.createElement('div');
        proposalCard.className = 'proposal-card';
        
        // Get voting options for this proposal
        let options = [];
        try {
            options = await contract.getProposalOptions(index);
        } catch (error) {
            console.error(`Error fetching options for proposal ${index}:`, error);
        }
        
        // Check if voter has already voted on THIS specific proposal
        const hasVotedOnThisProposal = voterInfo.votedProposalIds.has(index);

        // Per-proposal voting state from the contract struct
        const proposalVotingActive = Boolean(proposal.votingActive);
        const seededSeconds = proposalTimers[index] ?? 0;

        // Determine if voting buttons should be enabled
        const canVoteNow = authorizedForThisProposal && !hasVotedOnThisProposal && proposalVotingActive && seededSeconds > 0;
        
        // Create options HTML
        let optionsHTML = '';
        if (options.length > 0) {
            optionsHTML = '<div class="voting-options">';
            options.forEach((option, optionIndex) => {
                const disabled = !canVoteNow;
                
                optionsHTML += `
                    <button class="vote-option-btn ${hasVotedOnThisProposal ? 'voted' : ''}" 
                            data-proposal-id="${index}" 
                            data-option-id="${optionIndex}"
                            ${disabled ? 'disabled' : ''}>
                        <span class="option-name">${option.name}</span>
                        ${hasVotedOnThisProposal ? '<span class="voted-badge">&#10003; Your Vote</span>' : ''}
                    </button>
                `;
            });
            optionsHTML += '</div>';
        }

        // Timer HTML — shown inside every proposal card
        const timerStatusText = proposalVotingActive
            ? (seededSeconds > 0 ? '&#9654; Voting active — time remaining:' : '&#9209; Voting period ended')
            : '&#9675; Voting not started';
        const timerHTML = `
            <div class="proposal-timer-row">
                <span class="proposal-timer-status" id="proposal-timer-status-${index}">${timerStatusText}</span>
                <span class="proposal-timer" id="proposal-timer-${index}">${proposalVotingActive && seededSeconds > 0 ? formatTime(seededSeconds) : (proposalVotingActive ? '00:00:00' : '--:--:--')}</span>
            </div>
        `;
        
        const creatorDisplay = proposal.creator 
            ? `${proposal.creator.substring(0, 6)}...${proposal.creator.substring(proposal.creator.length - 4)}`
            : 'Unknown';
        
        proposalCard.innerHTML = `
            <div class="proposal-header">
                <span class="proposal-name">${proposal.name} ${isUserProposalCreator ? '<span class="creator-badge">&#128100; Your Proposal</span>' : ''}</span>
                <span class="proposal-id">#${index + 1}</span>
            </div>
            <div class="proposal-creator">Created by: ${creatorDisplay} ${isUserProposalCreator ? '(You)' : ''}</div>
            <div class="proposal-description">
                ${proposal.description || 'No description provided.'}
            </div>
            ${timerHTML}
            <div class="voter-status ${authorizedForThisProposal ? 'authorized' : 'not-authorized'}">
                ${authorizedForThisProposal ? '&#10003; You can vote on this proposal' : '&#10007; Not authorized to vote on this proposal'}
                ${hasVotedOnThisProposal ? ' | &#10003; Already voted on this proposal' : ''}
            </div>
            ${optionsHTML}
        `;
        
        proposalsListEl.appendChild(proposalCard);
        
        // Add event listeners to vote option buttons
        if (canVoteNow) {
            const optionButtons = proposalCard.querySelectorAll('.vote-option-btn');
            optionButtons.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const proposalId = parseInt(e.currentTarget.dataset.proposalId);
                    const optionId = parseInt(e.currentTarget.dataset.optionId);
                    vote(proposalId, optionId);
                });
            });
        }
    }
}

// Populate results proposal dropdown
function populateResultsProposalDropdown(proposals) {
    const dropdown = document.getElementById('proposalResultsSelect');
    
    // Clear existing options except the first one
    while (dropdown.options.length > 1) {
        dropdown.remove(1);
    }
    
    // Add proposal options
    proposals.forEach((proposal, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = `#${index + 1}: ${proposal.name}`;
        dropdown.appendChild(option);
    });
}

// Handle proposal selection for results
function handleProposalResultsSelect(event) {
    const selectedIndex = parseInt(event.target.value);
    
    if (selectedIndex === '') {
        document.getElementById('resultsContainer').style.display = 'none';
        selectedProposalForResults = null;
    } else {
        selectedProposalForResults = selectedIndex;
        // Find the proposals and display results
        displaySelectedProposalResults();
    }
}

// Display results for selected proposal - fetches current data
async function displaySelectedProposalResults() {
    try {
        const proposals = await contract.getProposals();
        if (selectedProposalForResults !== null && selectedProposalForResults < proposals.length) {
            displayProposalResults(proposals, selectedProposalForResults);
        }
    } catch (error) {
        console.error('Error fetching proposals for results:', error);
    }
}

// Display results for a specific proposal
async function displayProposalResults(proposals, proposalIndex) {
    const proposal = proposals[proposalIndex];
    const resultsContainer = document.getElementById('resultsContainer');
    
    try {
        // Get options for this proposal
        let options = [];
        try {
            options = await contract.getProposalOptions(proposalIndex);
        } catch (error) {
            console.error(`Error fetching options for proposal ${proposalIndex}:`, error);
        }
        
        // Update header
        document.getElementById('selectedProposalTitle').textContent = `${proposal.name}`;
        document.getElementById('selectedProposalDescription').textContent = proposal.description || 'No description provided';
        
        // Update chart
        updateProposalResultsChart(proposal, options);
        
        // Show results container
        resultsContainer.style.display = 'block';
        
    } catch (error) {
        console.error('Error displaying proposal results:', error);
    }
}

// Update chart for specific proposal
function updateProposalResultsChart(proposal, options) {
    const ctx = document.getElementById('resultsChart').getContext('2d');
    
    if (options.length === 0) {
        if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.font = '16px Arial';
        ctx.fillStyle = '#666';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No voting data available', ctx.canvas.width / 2, ctx.canvas.height / 2);
        return;
    }
    
    const labels = options.map(o => o.name);
    const data   = options.map(o => Number(o.voteCount));
    const backgroundColors = generateColors(options.length);
    
    // If chart already exists with the same number of segments, update data smoothly
    if (chartInstance && chartInstance.data.labels.length === labels.length) {
        chartInstance.data.datasets[0].data = data;
        chartInstance.update('active');   // animate the update
        return;
    }
    
    // Otherwise build a fresh chart
    if (chartInstance) { chartInstance.destroy(); }
    
    chartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: backgroundColors,
                borderColor: backgroundColors.map(color => color.replace('0.8', '1')),
                borderWidth: 2,
                hoverOffset: 15
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: { padding: 20, usePointStyle: true, pointStyle: 'circle' }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.raw || 0;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
                            return `${label}: ${value} votes (${percentage}%)`;
                        }
                    }
                }
            },
            animation: {
                duration: 600,
                easing: 'easeInOutQuart'
            }
        }
    });
}

// Generate colors for chart
function generateColors(count) {
    const colors = [];
    const hueStep = 360 / count;
    
    for (let i = 0; i < count; i++) {
        const hue = (i * hueStep) % 360;
        colors.push(`hsla(${hue}, 70%, 60%, 0.8)`);
    }
    
    return colors;
}

// Format seconds into HH:MM:SS string (replaces old updateTimer)
function formatTime(seconds) {
    const secondsNum = typeof seconds === 'bigint' ? Number(seconds) : seconds;
    const hours = Math.floor(secondsNum / 3600);
    const minutes = Math.floor((secondsNum % 3600) / 60);
    const secs = Math.floor(secondsNum % 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Vote for a proposal option
async function vote(proposalId, optionId) {
    try {
        showNotification('Processing your vote...', 'info');
        
        const tx = await contract.vote(proposalId, optionId);
        showNotification('Vote submitted! Waiting for confirmation...', 'info');
        
        await tx.wait();
        showNotification('🎉 Vote recorded successfully!', 'success');
        
        // Only refresh results + re-render this proposal card (not the full page)
        await refreshResults();
        // Re-render proposals to update the voted state on buttons
        const proposals = await contract.getProposals();
        displayProposals(proposals);
        
    } catch (error) {
        console.error('Error voting:', error);
        
        if (error.message.includes('user rejected')) {
            showNotification('Vote cancelled by user', 'warning');
        } else if (error.message.includes('Already voted')) {
            showNotification('You have already voted', 'error');
        } else if (error.message.includes('Not authorized')) {
            showNotification('You are not authorized to vote', 'error');
        } else if (error.message.includes('Invalid option')) {
            showNotification('Invalid voting option selected', 'error');
        } else {
            showNotification('Failed to submit vote', 'error');
        }
    }
}

// Toggle admin panel visibility
function toggleAdminPanel() {
    const panel = document.getElementById('adminPanel');
    const toggleBtn = document.getElementById('adminToggle');
    
    if (panel.classList.contains('admin-panel-collapsed')) {
        // Expand the panel
        panel.classList.remove('admin-panel-collapsed');
        panel.classList.add('admin-panel-expanded');
        toggleBtn.setAttribute('aria-expanded', 'true');
    } else {
        // Collapse the panel
        panel.classList.add('admin-panel-collapsed');
        panel.classList.remove('admin-panel-expanded');
        toggleBtn.setAttribute('aria-expanded', 'false');
    }
}

// Admin: Add proposal
async function addProposal() {
    const name = document.getElementById('proposalName').value.trim();
    const description = document.getElementById('proposalDescription').value.trim();
    
    if (!name) {
        showNotification('Please enter a proposal name', 'error');
        return;
    }
    
    try {
        showNotification('Adding proposal...', 'info');
        
        const tx = await contract.addProposal(name, description, '');
        await tx.wait();
        
        showNotification('✅ Proposal added successfully!', 'success');
        
        // Clear form
        document.getElementById('proposalName').value = '';
        document.getElementById('proposalDescription').value = '';
        
        await loadVotingData();
        
    } catch (error) {
        console.error('Error adding proposal:', error);
        showNotification('Failed to add proposal', 'error');
    }
}

// Admin: Add voting option to a proposal
async function addVotingOption() {
    const proposalId = document.getElementById('optionProposalSelect').value.trim();
    const optionName = document.getElementById('optionName').value.trim();
    
    if (!proposalId || !optionName) {
        showNotification('Please select a proposal and enter an option name', 'error');
        return;
    }
    
    try {
        showNotification('Adding voting option...', 'info');
        
        const tx = await contract.addVotingOption(parseInt(proposalId), optionName);
        await tx.wait();
        
        showNotification('✅ Voting option added successfully!', 'success');
        
        // Clear form
        document.getElementById('optionName').value = '';
        document.getElementById('optionProposalSelect').value = '';
        
        await loadVotingData();
        
    } catch (error) {
        console.error('Error adding voting option:', error);
        if (error.message.includes('Invalid proposal ID')) {
            showNotification('Invalid proposal ID', 'error');
        } else if (error.message.includes('Only proposal creator')) {
            showNotification('You can only add options to proposals you created', 'error');
        } else if (error.message.includes('Cannot add options after voting')) {
            showNotification('Cannot add options after voting has started', 'error');
        } else {
            showNotification('Failed to add voting option', 'error');
        }
    }
}

// Admin: Add For/Against options to a proposal
async function addForAgainstOptions() {
    const proposalId = document.getElementById('forAgainstProposalSelect').value.trim();
    
    if (!proposalId) {
        showNotification('Please select a proposal', 'error');
        return;
    }
    
    try {
        showNotification('Adding For/Against options...', 'info');
        
        const tx = await contract.addForAgainstOptions(parseInt(proposalId));
        await tx.wait();
        
        showNotification('✅ For/Against options added successfully!', 'success');
        
        // Clear form
        document.getElementById('forAgainstProposalSelect').value = '';
        
        await loadVotingData();
        
    } catch (error) {
        console.error('Error adding For/Against options:', error);
        if (error.message.includes('Invalid proposal ID')) {
            showNotification('Invalid proposal ID', 'error');
        } else if (error.message.includes('Only proposal creator')) {
            showNotification('You can only add options to proposals you created', 'error');
        } else if (error.message.includes('Cannot add options after voting')) {
            showNotification('Cannot add options after voting has started', 'error');
        } else {
            showNotification('Failed to add For/Against options', 'error');
        }
    }
}

// Admin: Authorize voter
async function authorizeVoter() {
    const address = document.getElementById('voterAddress').value.trim();
    const proposalId = document.getElementById('authProposalSelect').value.trim();
    
    if (!address || !ethers.isAddress(address)) {
        showNotification('Please enter a valid Ethereum address', 'error');
        return;
    }
    
    if (!proposalId) {
        showNotification('Please select a proposal', 'error');
        return;
    }
    
    try {
        showNotification('Authorizing voter for proposal...', 'info');
        
        const tx = await contract.authorizeVoter(address, parseInt(proposalId));
        await tx.wait();
        
        showNotification('✅ Voter authorized successfully for this proposal!', 'success');
        
        // Clear form
        document.getElementById('voterAddress').value = '';
        document.getElementById('authProposalSelect').value = '';
        
    } catch (error) {
        console.error('Error authorizing voter:', error);
        if (error.message.includes('Only proposal creator')) {
            showNotification('Only the proposal creator can authorize voters for this proposal', 'error');
        } else if (error.message.includes('Cannot authorize for proposal already voted on')) {
            showNotification('Cannot authorize: voter has already voted on this proposal', 'error');
        } else if (error.message.includes('user rejected')) {
            showNotification('Authorization cancelled by user', 'warning');
        } else {
            showNotification('Failed to authorize voter', 'error');
        }
    }
}

// Populate proposal dropdowns with only user's proposals
function populateUserProposalsDropdown(proposals) {
    // Get user's proposals only
    // ethers v6 returns Result objects (tuples) - must access named props explicitly OR by index
    const userProposals = proposals.map((proposal, index) => {
        const name        = proposal.name        ?? proposal[1] ?? '';
        const description = proposal.description ?? proposal[2] ?? '';
        const creator     = String(proposal.creator ?? proposal[6] ?? '').toLowerCase();

        return { name, description, creator, originalIndex: index };
    }).filter(proposal => proposal.creator && proposal.creator === account.toLowerCase());
    
    // Populate voting options dropdown
    const optionDropdown = document.getElementById('optionProposalSelect');
    if (optionDropdown) {
        while (optionDropdown.options.length > 1) {
            optionDropdown.remove(1);
        }
        
        if (userProposals.length > 0) {
            userProposals.forEach((proposal) => {
                const option = document.createElement('option');
                option.value = proposal.originalIndex;
                option.textContent = `#${proposal.originalIndex + 1}: ${proposal.name}`;
                optionDropdown.appendChild(option);
            });
        } else {
            const emptyOption = document.createElement('option');
            emptyOption.disabled = true;
            emptyOption.textContent = '-- Create a proposal first --';
            optionDropdown.appendChild(emptyOption);
        }
    }
    
    // Populate for/against dropdown
    const forAgainstDropdown = document.getElementById('forAgainstProposalSelect');
    if (forAgainstDropdown) {
        while (forAgainstDropdown.options.length > 1) {
            forAgainstDropdown.remove(1);
        }
        
        if (userProposals.length > 0) {
            userProposals.forEach((proposal) => {
                const option = document.createElement('option');
                option.value = proposal.originalIndex;
                option.textContent = `#${proposal.originalIndex + 1}: ${proposal.name}`;
                forAgainstDropdown.appendChild(option);
            });
        } else {
            const emptyOption = document.createElement('option');
            emptyOption.disabled = true;
            emptyOption.textContent = '-- Create a proposal first --';
            forAgainstDropdown.appendChild(emptyOption);
        }
    }
    
    // Populate authorization dropdown - only shows user's own proposals (proposal creators manage their own)
    const authDropdown = document.getElementById('authProposalSelect');
    if (authDropdown) {
        while (authDropdown.options.length > 1) {
            authDropdown.remove(1);
        }
        
        // Only proposal creators can authorize voters - always show user's own proposals only
        if (userProposals.length > 0) {
            userProposals.forEach((proposal) => {
                const option = document.createElement('option');
                option.value = proposal.originalIndex;
                option.textContent = `#${proposal.originalIndex + 1}: ${proposal.name}`;
                authDropdown.appendChild(option);
            });
        } else {
            const emptyOption = document.createElement('option');
            emptyOption.disabled = true;
            emptyOption.textContent = '-- Create a proposal first --';
            authDropdown.appendChild(emptyOption);
        }
    }

    // Populate Start Voting dropdown (user's own proposals that haven't started yet)
    const startDropdown = document.getElementById('startProposalSelect');
    if (startDropdown) {
        while (startDropdown.options.length > 1) {
            startDropdown.remove(1);
        }
        const notStarted = userProposals.filter(p => !proposals[p.originalIndex].votingActive);
        if (notStarted.length > 0) {
            notStarted.forEach((proposal) => {
                const option = document.createElement('option');
                option.value = proposal.originalIndex;
                option.textContent = `#${proposal.originalIndex + 1}: ${proposal.name}`;
                startDropdown.appendChild(option);
            });
        } else {
            const emptyOption = document.createElement('option');
            emptyOption.disabled = true;
            emptyOption.textContent = userProposals.length === 0 ? '-- Create a proposal first --' : '-- All your proposals are active --';
            startDropdown.appendChild(emptyOption);
        }
    }

    // Populate End Voting dropdown (user's own proposals with active voting)
    const endDropdown = document.getElementById('endProposalSelect');
    if (endDropdown) {
        while (endDropdown.options.length > 1) {
            endDropdown.remove(1);
        }
        const activeOwn = userProposals.filter(p => proposals[p.originalIndex].votingActive);
        if (activeOwn.length > 0) {
            activeOwn.forEach((proposal) => {
                const option = document.createElement('option');
                option.value = proposal.originalIndex;
                option.textContent = `#${proposal.originalIndex + 1}: ${proposal.name}`;
                endDropdown.appendChild(option);
            });
        } else {
            const emptyOption = document.createElement('option');
            emptyOption.disabled = true;
            emptyOption.textContent = '-- No active voting sessions --';
            endDropdown.appendChild(emptyOption);
        }
    }
}

// Admin: Start voting — per proposal with custom duration
async function startVoting() {
    const proposalId = document.getElementById('startProposalSelect').value.trim();
    const durationInput = document.getElementById('startDuration').value.trim();
    const duration = parseInt(durationInput);

    if (!proposalId) {
        showNotification('Please select a proposal', 'error');
        return;
    }
    if (!durationInput || isNaN(duration) || duration < 1) {
        showNotification('Please enter a valid duration (at least 1 minute)', 'error');
        return;
    }

    try {
        showNotification(`Starting voting for proposal #${parseInt(proposalId) + 1} (${duration} min)...`, 'info');

        const tx = await contract.startVoting(parseInt(proposalId), duration);
        await tx.wait();

        showNotification(`✅ Voting started for proposal #${parseInt(proposalId) + 1}!`, 'success');

        document.getElementById('startProposalSelect').value = '';
        document.getElementById('startDuration').value = '60';

        await loadVotingData();

    } catch (error) {
        console.error('Error starting voting:', error);
        if (error.message.includes('Only proposal creator')) {
            showNotification('Only the proposal creator can start voting for this proposal', 'error');
        } else if (error.message.includes('Voting already started')) {
            showNotification('Voting has already started for this proposal', 'error');
        } else if (error.message.includes('must have at least one voting option')) {
            showNotification('Add at least one voting option to this proposal first', 'error');
        } else if (error.message.includes('user rejected')) {
            showNotification('Cancelled by user', 'warning');
        } else {
            showNotification('Failed to start voting', 'error');
        }
    }
}

// Admin: End voting — per proposal
async function endVoting() {
    const proposalId = document.getElementById('endProposalSelect').value.trim();

    if (!proposalId) {
        showNotification('Please select a proposal', 'error');
        return;
    }

    const id = parseInt(proposalId);

    try {
        // Check if voting period has ended for this proposal
        const remaining = await contract.timeRemaining(id);
        if (Number(remaining) > 0) {
            const hh = Math.floor(Number(remaining) / 3600);
            const mm = Math.floor((Number(remaining) % 3600) / 60);
            showNotification(`Proposal #${id + 1} still has ${hh}h ${mm}m remaining. Wait until it ends.`, 'warning');
            return;
        }

        if (!confirm(`End voting for proposal #${id + 1}? This cannot be undone.`)) return;

        showNotification('Ending voting session...', 'info');

        const tx = await contract.endVoting(id);
        await tx.wait();

        showNotification(`✅ Voting ended for proposal #${id + 1}!`, 'success');

        document.getElementById('endProposalSelect').value = '';

        await loadVotingData();

    } catch (error) {
        console.error('Error ending voting:', error);
        if (error.message.includes('Voting period not yet ended')) {
            showNotification('Cannot end voting: the voting period must complete first', 'error');
        } else if (error.message.includes('Voting is not active')) {
            showNotification('Voting has not been started for this proposal', 'error');
        } else if (error.message.includes('Only proposal creator')) {
            showNotification('Only the proposal creator can end voting for this proposal', 'error');
        } else if (error.message.includes('user rejected')) {
            showNotification('Cancelled by user', 'warning');
        } else {
            showNotification('Failed to end voting', 'error');
        }
    }
}

// Handle account changes
function handleAccountsChanged(accounts) {
    if (accounts.length === 0) {
        // User disconnected their wallet
        appContent.classList.add('hidden');
        connectSection.classList.remove('hidden');
        showNotification('Wallet disconnected', 'info');
    } else {
        // User switched accounts
        setupApplication(accounts[0]);
    }
}

// Show notification
function showNotification(message, type = 'info') {
    const notification = document.getElementById('notification');
    
    notification.textContent = message;
    notification.className = `notification ${type} show`;
    
    // Auto-hide after 5 seconds for success/info, 8 seconds for errors
    const duration = type === 'error' ? 8000 : 5000;
    
    setTimeout(() => {
        notification.classList.remove('show');
    }, duration);
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', init);