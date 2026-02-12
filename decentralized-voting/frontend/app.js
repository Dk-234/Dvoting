import { contractAddress } from './contractAddress.js';
import { contractABI } from './contractABI.js';

// Application state
let provider;
let signer;
let contract;
let account;
let isOwner = false;
let chartInstance = null;

// DOM Elements
const connectSection = document.getElementById('connectSection');
const appContent = document.getElementById('appContent');
const connectWalletBtn = document.getElementById('connectWallet');
const accountAddressEl = document.getElementById('accountAddress');
const votingStatusEl = document.getElementById('votingStatus');
const votingTitleEl = document.getElementById('votingTitle');
const totalVotesEl = document.getElementById('totalVotes');
const proposalsCountEl = document.getElementById('proposalsCount');
const timeRemainingEl = document.getElementById('timeRemaining');
const proposalsListEl = document.getElementById('proposalsList');
const resultsTableEl = document.getElementById('resultsTable');
const adminPanel = document.getElementById('adminPanel');

// Initialize the application
async function init() {
    console.log('🚀 Initializing application...');
    
    // Check if MetaMask is installed
    if (typeof window.ethereum === 'undefined') {
        showNotification('Please install MetaMask to use this application', 'error');
        return;
    }
    
    // Check if we're already connected
    try {
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        if (accounts.length > 0) {
            await setupApplication(accounts[0]);
        }
    } catch (error) {
        console.error('Error checking accounts:', error);
    }
    
    // Set up event listeners
    connectWalletBtn.addEventListener('click', connectWallet);
    document.getElementById('addProposal').addEventListener('click', addProposal);
    document.getElementById('authorizeVoter').addEventListener('click', authorizeVoter);
    document.getElementById('startVoting').addEventListener('click', startVoting);
    document.getElementById('endVoting').addEventListener('click', endVoting);
    
    // Listen for account changes
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
        
        if (isOwner) {
            adminPanel.classList.remove('hidden');
            showNotification('Admin privileges detected', 'info');
        }
    } catch (error) {
        console.error('Error checking owner:', error);
    }
    
    // Update UI
    connectSection.classList.add('hidden');
    appContent.classList.remove('hidden');
    accountAddressEl.textContent = `${account.substring(0, 6)}...${account.substring(account.length - 4)}`;
    
    // Load voting data
    await loadVotingData();
    
    // Set up periodic updates
    setInterval(loadVotingData, 3000);
}

// Load voting data from contract
async function loadVotingData() {
    if (!contract) {
        return;
    }
    
    try {
        // Load basic contract info
        const [title, isActive, totalVotes, proposalsCount] = await Promise.all([
            contract.votingTitle(),
            contract.votingActive(),
            contract.totalVotes(),
            contract.getProposalsCount()
        ]);
        
        // Update UI
        votingTitleEl.textContent = title;
        totalVotesEl.textContent = totalVotes.toString();
        proposalsCountEl.textContent = proposalsCount.toString();
        
        // Update voting status
        if (isActive) {
            votingStatusEl.textContent = 'Voting Active';
            votingStatusEl.className = 'voting-status active';
            
            // Update timer - Convert BigInt to Number
            const timeRemaining = await contract.timeRemaining();
            updateTimer(Number(timeRemaining));
        } else {
            votingStatusEl.textContent = 'Voting Inactive';
            votingStatusEl.className = 'voting-status inactive';
            timeRemainingEl.textContent = '00:00:00';
        }
        
        // Load proposals and results
        const proposals = await contract.getProposals();
        const results = await contract.getResults();
        
        displayProposals(proposals);
        updateResults(proposals, results);
        
    } catch (error) {
        console.error('Error loading voting data:', error);
        // Only show notification once, not on every poll
        if (!window.votingDataErrorShown) {
            showNotification('Error loading data from contract. Check network and contract deployment.', 'error');
            window.votingDataErrorShown = true;
        }
    }
}

// Display proposals
async function displayProposals(proposals) {
    proposalsListEl.innerHTML = '';
    
    if (proposals.length === 0) {
        proposalsListEl.innerHTML = '<p class="no-proposals">No proposals added yet.</p>';
        return;
    }
    
    // Check voter status
    let voterInfo = { authorized: false, voted: false };
    try {
        const voter = await contract.voters(account);
        voterInfo = {
            authorized: voter.authorized,
            voted: voter.voted
        };
    } catch (error) {
        console.error('Error fetching voter info:', error);
    }
    
    proposals.forEach((proposal, index) => {
        const proposalCard = document.createElement('div');
        proposalCard.className = 'proposal-card';
        
        proposalCard.innerHTML = `
            <div class="proposal-header">
                <span class="proposal-name">${proposal.name}</span>
                <span class="proposal-id">#${index + 1}</span>
            </div>
            <div class="proposal-description">
                ${proposal.description || 'No description provided.'}
            </div>
            <div class="voter-status ${voterInfo.authorized ? 'authorized' : 'not-authorized'}">
                ${voterInfo.authorized ? '✓ Authorized to vote' : '✗ Not authorized to vote'}
                ${voterInfo.voted ? ' | ✓ Already voted' : ''}
            </div>
            <button class="vote-btn" data-id="${index}" 
                    ${!voterInfo.authorized || voterInfo.voted ? 'disabled' : ''}>
                ${voterInfo.voted ? 'Voted ✓' : 'Vote Now'}
            </button>
        `;
        
        proposalsListEl.appendChild(proposalCard);
        
        // Add event listener to vote button
        if (voterInfo.authorized && !voterInfo.voted) {
            proposalCard.querySelector('.vote-btn').addEventListener('click', () => vote(index));
        }
    });
}

// Update results chart and table
function updateResults(proposals, results) {
    updateResultsTable(proposals, results);
    updateResultsChart(proposals, results);
}

// Update results table
function updateResultsTable(proposals, results) {
    resultsTableEl.innerHTML = '';
    
    const totalVotes = results.reduce((sum, count) => sum + Number(count), 0);
    
    proposals.forEach((proposal, index) => {
        const voteCount = Number(results[index]);
        const percentage = totalVotes > 0 ? ((voteCount / totalVotes) * 100).toFixed(1) : '0.0';
        
        const resultRow = document.createElement('div');
        resultRow.className = `result-row ${voteCount > 0 && voteCount === Math.max(...results.map(r => Number(r))) ? 'winner' : ''}`;
        
        resultRow.innerHTML = `
            <div>
                <div class="result-name">${proposal.name}</div>
                <div class="result-description">${proposal.description || 'No description'}</div>
            </div>
            <div class="result-votes">
                <div class="vote-count">${voteCount} votes</div>
                <div class="vote-percentage">${percentage}%</div>
            </div>
        `;
        
        resultsTableEl.appendChild(resultRow);
    });
}

// Update results chart
function updateResultsChart(proposals, results) {
    const ctx = document.getElementById('resultsChart').getContext('2d');
    
    // Destroy previous chart if exists
    if (chartInstance) {
        chartInstance.destroy();
    }
    
    // Check if we have data
    if (proposals.length === 0) {
        // Show a message for no data
        ctx.font = '16px Arial';
        ctx.fillStyle = '#666';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No proposals to display', ctx.canvas.width / 2, ctx.canvas.height / 2);
        return;
    }
    
    // Prepare data
    const labels = proposals.map(p => p.name);
    const data = results.map(r => Number(r));
    const backgroundColors = generateColors(proposals.length);
    
    // Create new chart
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
                    labels: {
                        padding: 20,
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
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
                animateScale: true,
                animateRotate: true
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

// Update timer display
function updateTimer(seconds) {
    // Ensure seconds is a regular number, not BigInt
    const secondsNum = typeof seconds === 'bigint' ? Number(seconds) : seconds;
    
    const hours = Math.floor(secondsNum / 3600);
    const minutes = Math.floor((secondsNum % 3600) / 60);
    const secs = secondsNum % 60;
    
    timeRemainingEl.textContent = 
        `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${Math.floor(secs).toString().padStart(2, '0')}`;
}

// Vote for a proposal
async function vote(proposalId) {
    try {
        showNotification('Processing your vote...', 'info');
        
        const tx = await contract.vote(proposalId);
        showNotification('Vote submitted! Waiting for confirmation...', 'info');
        
        await tx.wait();
        showNotification('🎉 Vote recorded successfully!', 'success');
        
        await loadVotingData();
        
    } catch (error) {
        console.error('Error voting:', error);
        
        if (error.message.includes('user rejected')) {
            showNotification('Vote cancelled by user', 'warning');
        } else if (error.message.includes('Already voted')) {
            showNotification('You have already voted', 'error');
        } else if (error.message.includes('Not authorized')) {
            showNotification('You are not authorized to vote', 'error');
        } else {
            showNotification('Failed to submit vote', 'error');
        }
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

// Admin: Authorize voter
async function authorizeVoter() {
    const address = document.getElementById('voterAddress').value.trim();
    
    if (!address || !ethers.isAddress(address)) {
        showNotification('Please enter a valid Ethereum address', 'error');
        return;
    }
    
    try {
        showNotification('Authorizing voter...', 'info');
        
        const tx = await contract.authorizeVoter(address);
        await tx.wait();
        
        showNotification('✅ Voter authorized successfully!', 'success');
        
        // Clear form
        document.getElementById('voterAddress').value = '';
        
    } catch (error) {
        console.error('Error authorizing voter:', error);
        showNotification('Failed to authorize voter', 'error');
    }
}

// Admin: Start voting
async function startVoting() {
    try {
        showNotification('Starting voting session...', 'info');
        
        const tx = await contract.startVoting();
        await tx.wait();
        
        showNotification('✅ Voting started!', 'success');
        await loadVotingData();
        
    } catch (error) {
        console.error('Error starting voting:', error);
        showNotification('Failed to start voting', 'error');
    }
}

// Admin: End voting
async function endVoting() {
    try {
        // Check if voting period has ended
        const timeRemaining = await contract.timeRemaining();
        if (Number(timeRemaining) > 0) {
            const hours = Math.floor(Number(timeRemaining) / 3600);
            const minutes = Math.floor((Number(timeRemaining) % 3600) / 60);
            showNotification(`Voting period has ${hours}h ${minutes}m remaining. Please wait until it ends.`, 'warning');
            return;
        }
        
        if (!confirm('Are you sure you want to end the voting? This action cannot be undone.')) {
            return;
        }
        
        showNotification('Ending voting session...', 'info');
        
        const tx = await contract.endVoting();
        await tx.wait();
        
        showNotification('✅ Voting ended!', 'success');
        await loadVotingData();
        
    } catch (error) {
        console.error('Error ending voting:', error);
        
        if (error.message.includes('Voting period not yet ended')) {
            showNotification('Cannot end voting: The voting period must complete first', 'error');
        } else if (error.message.includes('Voting is not active')) {
            showNotification('Voting is not currently active', 'error');
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