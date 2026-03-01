// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title EnhancedIdentity
 * @notice Stores multi-factor identity proofs on-chain for the decentralized voting system.
 * @dev Stores only cryptographic hashes — no raw biometric data is ever on-chain.
 *
 * Identity factors:
 *   1. SSN/ID document hash (from OCR verification)
 *   2. Device ID hash (from WebAuthn device binding)
 *   3. Face descriptor hash (from facial verification + liveness)
 *   4. Combined hash = SHA-256(ssnHash + deviceIdHash + faceHash + nonce)
 */
contract EnhancedIdentity {

    // ── Structs ──────────────────────────────────────────

    struct VerifiedIdentity {
        bytes32 ssnHash;         // SHA-256 hash of ID document details
        bytes32 deviceIdHash;    // SHA-256 hash of WebAuthn credential + public key
        bytes32 faceHash;        // SHA-256 hash of face descriptor
        bytes32 combinedHash;    // Combined multi-factor proof hash
        uint256 verifiedAt;      // Timestamp of verification
        bool isActive;           // Whether this identity is currently active
        uint8 factorsVerified;   // Number of factors verified (1-4)
    }

    // ── State Variables ──────────────────────────────────

    address public owner;

    /// @notice Maps wallet address to their verified identity
    mapping(address => VerifiedIdentity) public identities;

    /// @notice List of all registered identity addresses (for enumeration)
    address[] public registeredAddresses;

    /// @notice Tracks used combined hashes to prevent duplicate registrations
    mapping(bytes32 => bool) public usedCombinedHashes;

    /// @notice Tracks used SSN hashes (one identity per person)
    mapping(bytes32 => bool) public usedSsnHashes;

    // ── Events ───────────────────────────────────────────

    event IdentityRegistered(
        address indexed user,
        bytes32 combinedHash,
        uint8 factorsVerified,
        uint256 timestamp
    );

    event IdentityRevoked(
        address indexed user,
        uint256 timestamp
    );

    event IdentityUpdated(
        address indexed user,
        bytes32 newCombinedHash,
        uint8 newFactorsVerified,
        uint256 timestamp
    );

    // ── Modifiers ────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "EnhancedIdentity: caller is not the owner");
        _;
    }

    // ── Constructor ──────────────────────────────────────

    constructor() {
        owner = msg.sender;
    }

    // ── Core Functions ───────────────────────────────────

    /**
     * @notice Register a new multi-factor verified identity on-chain.
     * @dev Called by the user after completing the full verification flow.
     *      Only hashes are stored — no raw biometric data.
     *
     * @param _ssnHash SHA-256 hash of the ID document data
     * @param _deviceIdHash SHA-256 hash of the WebAuthn device credential
     * @param _faceHash SHA-256 hash of the facial descriptor
     * @param _combinedHash Combined multi-factor proof hash
     * @param _factorsVerified Number of verification factors completed (1-4)
     */
    function registerIdentity(
        bytes32 _ssnHash,
        bytes32 _deviceIdHash,
        bytes32 _faceHash,
        bytes32 _combinedHash,
        uint8 _factorsVerified
    ) external {
        require(_combinedHash != bytes32(0), "EnhancedIdentity: combined hash cannot be zero");
        require(_factorsVerified >= 1 && _factorsVerified <= 4, "EnhancedIdentity: invalid factor count");
        require(!identities[msg.sender].isActive, "EnhancedIdentity: identity already registered");
        require(!usedCombinedHashes[_combinedHash], "EnhancedIdentity: combined hash already used");

        // If SSN hash is provided, ensure it hasn't been used by another wallet
        if (_ssnHash != bytes32(0)) {
            require(!usedSsnHashes[_ssnHash], "EnhancedIdentity: this ID document is already registered with another wallet");
            usedSsnHashes[_ssnHash] = true;
        }

        identities[msg.sender] = VerifiedIdentity({
            ssnHash: _ssnHash,
            deviceIdHash: _deviceIdHash,
            faceHash: _faceHash,
            combinedHash: _combinedHash,
            verifiedAt: block.timestamp,
            isActive: true,
            factorsVerified: _factorsVerified
        });

        registeredAddresses.push(msg.sender);
        usedCombinedHashes[_combinedHash] = true;

        emit IdentityRegistered(msg.sender, _combinedHash, _factorsVerified, block.timestamp);
    }

    /**
     * @notice Register identity on behalf of a user (owner-only, for backend integration).
     * @param _user The wallet address of the user to register
     * @param _ssnHash SHA-256 hash of the ID document data
     * @param _deviceIdHash SHA-256 hash of the WebAuthn device credential
     * @param _faceHash SHA-256 hash of the facial descriptor
     * @param _combinedHash Combined multi-factor proof hash
     * @param _factorsVerified Number of verification factors completed
     */
    function registerIdentityFor(
        address _user,
        bytes32 _ssnHash,
        bytes32 _deviceIdHash,
        bytes32 _faceHash,
        bytes32 _combinedHash,
        uint8 _factorsVerified
    ) external onlyOwner {
        require(_user != address(0), "EnhancedIdentity: user address cannot be zero");
        require(_combinedHash != bytes32(0), "EnhancedIdentity: combined hash cannot be zero");
        require(_factorsVerified >= 1 && _factorsVerified <= 4, "EnhancedIdentity: invalid factor count");
        require(!identities[_user].isActive, "EnhancedIdentity: identity already registered");
        require(!usedCombinedHashes[_combinedHash], "EnhancedIdentity: combined hash already used");

        if (_ssnHash != bytes32(0)) {
            require(!usedSsnHashes[_ssnHash], "EnhancedIdentity: this ID document is already registered");
            usedSsnHashes[_ssnHash] = true;
        }

        identities[_user] = VerifiedIdentity({
            ssnHash: _ssnHash,
            deviceIdHash: _deviceIdHash,
            faceHash: _faceHash,
            combinedHash: _combinedHash,
            verifiedAt: block.timestamp,
            isActive: true,
            factorsVerified: _factorsVerified
        });

        registeredAddresses.push(_user);
        usedCombinedHashes[_combinedHash] = true;

        emit IdentityRegistered(_user, _combinedHash, _factorsVerified, block.timestamp);
    }

    /**
     * @notice Revoke a user's identity (owner-only).
     * @param _user Address whose identity should be revoked
     */
    function revokeIdentity(address _user) external onlyOwner {
        require(identities[_user].isActive, "EnhancedIdentity: identity not active");

        identities[_user].isActive = false;

        emit IdentityRevoked(_user, block.timestamp);
    }

    /**
     * @notice Allow a user to voluntarily deactivate their own identity.
     */
    function deactivateMyIdentity() external {
        require(identities[msg.sender].isActive, "EnhancedIdentity: identity not active");

        identities[msg.sender].isActive = false;

        emit IdentityRevoked(msg.sender, block.timestamp);
    }

    // ── View Functions ───────────────────────────────────

    /**
     * @notice Check if a user has an active verified identity.
     * @param _user Address to check
     * @return bool True if the user is verified and active
     */
    function isVerified(address _user) external view returns (bool) {
        return identities[_user].isActive;
    }

    /**
     * @notice Check if a user is verified with at least N factors.
     * @param _user Address to check
     * @param _minFactors Minimum number of required factors
     * @return bool True if verified with >= _minFactors
     */
    function isVerifiedWithFactors(address _user, uint8 _minFactors) external view returns (bool) {
        VerifiedIdentity storage id = identities[_user];
        return id.isActive && id.factorsVerified >= _minFactors;
    }

    /**
     * @notice Get the full identity record for a user.
     * @param _user Address to look up
     * @return VerifiedIdentity struct
     */
    function getIdentity(address _user) external view returns (VerifiedIdentity memory) {
        return identities[_user];
    }

    /**
     * @notice Get all registered identity addresses.
     * @return Array of addresses
     */
    function getRegisteredAddresses() external view returns (address[] memory) {
        return registeredAddresses;
    }

    /**
     * @notice Get the count of registered identities.
     * @return Number of registered addresses
     */
    function getRegisteredCount() external view returns (uint256) {
        return registeredAddresses.length;
    }

    /**
     * @notice Verify that a given combined hash matches the stored identity.
     * @param _user Address to check
     * @param _combinedHash Hash to verify
     * @return bool True if the hash matches and identity is active
     */
    function verifyCombinedHash(address _user, bytes32 _combinedHash) external view returns (bool) {
        VerifiedIdentity storage id = identities[_user];
        return id.isActive && id.combinedHash == _combinedHash;
    }

    /**
     * @notice Transfer ownership to a new address.
     * @param _newOwner The new owner address
     */
    function transferOwnership(address _newOwner) external onlyOwner {
        require(_newOwner != address(0), "EnhancedIdentity: new owner cannot be zero");
        owner = _newOwner;
    }
}
