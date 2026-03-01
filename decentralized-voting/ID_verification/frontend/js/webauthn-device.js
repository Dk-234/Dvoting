/**
 * WebAuthn Device Registration & Authentication Module
 * (Browser global — exposes window.WebAuthnDevice)
 * 
 * Uses the WebAuthn API (built into modern browsers) to generate a
 * device-bound key pair. The private key never leaves the device;
 * only the credential ID and public key are exported.
 * 
 * Requirements:
 * - HTTPS or localhost (WebAuthn restriction)
 * - Browser with WebAuthn support (Chrome 67+, Firefox 60+, Safari 14+)
 */

// IIFE to avoid polluting global scope except for window.WebAuthnDevice
(function(global) {
'use strict';

class WebAuthnDevice {
    constructor() {
        /** @type {string|null} Relying party name shown to user */
        this.rpName = 'Decentralized Voting';
        /** @type {string|null} Relying party ID (domain) */
        this.rpId = window.location.hostname;
        /** @type {PublicKeyCredential|null} Last registered credential */
        this._credential = null;
        /** @type {string|null} Stored credential ID (base64url) */
        this._credentialId = null;
        /** @type {string|null} Stored public key (base64) */
        this._publicKey = null;
    }

    /**
     * Check if WebAuthn is supported on this device/browser.
     * @returns {boolean}
     */
    static isSupported() {
        return !!(
            window.PublicKeyCredential &&
            navigator.credentials &&
            navigator.credentials.create &&
            navigator.credentials.get
        );
    }

    /**
     * Register a new device credential (key pair).
     * Prompts the user for biometric/PIN verification if available.
     * 
     * @param {string} [userId] - Optional unique user identifier (e.g. wallet address)
     * @returns {Promise<{credentialId: string, publicKey: string, rawId: string}>}
     * @throws {Error} If WebAuthn is not supported or registration fails
     */
    async register(userId) {
        if (!WebAuthnDevice.isSupported()) {
            throw new Error('WebAuthn is not supported on this device/browser.');
        }

        // Generate a cryptographic challenge
        const challenge = crypto.getRandomValues(new Uint8Array(32));

        // Generate a random user handle if none provided
        const userHandle = userId
            ? new TextEncoder().encode(userId)
            : crypto.getRandomValues(new Uint8Array(16));

        const displayName = userId
            ? `Voter-${userId.substring(0, 8)}`
            : 'Voter';

        const publicKeyCredentialCreationOptions = {
            challenge,
            rp: {
                name: this.rpName,
                id: this.rpId
            },
            user: {
                id: userHandle,
                name: displayName,
                displayName: displayName
            },
            // Supported algorithms: ES256 (-7) and RS256 (-257)
            pubKeyCredParams: [
                { alg: -7, type: 'public-key' },   // ES256 (ECDSA w/ P-256)
                { alg: -257, type: 'public-key' }   // RS256 (RSASSA-PKCS1-v1_5)
            ],
            authenticatorSelection: {
                // Prefer platform authenticator (fingerprint, face ID, Windows Hello)
                authenticatorAttachment: 'platform',
                // Require user verification (biometric/PIN)
                userVerification: 'required',
                // Discoverable credential for easier re-authentication
                residentKey: 'preferred',
                requireResidentKey: false
            },
            timeout: 60000, // 60 seconds
            attestation: 'none' // Privacy-preserving: no attestation needed
        };

        try {
            const credential = await navigator.credentials.create({
                publicKey: publicKeyCredentialCreationOptions
            });

            if (!credential) {
                throw new Error('No credential returned from authenticator.');
            }

            this._credential = credential;
            this._credentialId = this._arrayBufferToBase64Url(credential.rawId);

            // Extract the public key from the attestation response
            const publicKeyBytes = credential.response.getPublicKey
                ? credential.response.getPublicKey()
                : null;

            this._publicKey = publicKeyBytes
                ? this._arrayBufferToBase64(publicKeyBytes)
                : this._arrayBufferToBase64(credential.response.attestationObject);

            const result = {
                credentialId: credential.id,
                rawId: this._credentialId,
                publicKey: this._publicKey,
                algorithm: credential.response.getPublicKeyAlgorithm
                    ? credential.response.getPublicKeyAlgorithm()
                    : -7,
                clientDataJSON: this._arrayBufferToBase64(credential.response.clientDataJSON),
                attestationObject: this._arrayBufferToBase64(credential.response.attestationObject)
            };

            // Persist credential ID in sessionStorage for re-authentication
            sessionStorage.setItem('webauthn_credential_id', result.credentialId);
            sessionStorage.setItem('webauthn_raw_id', result.rawId);

            console.log('[WebAuthn] Device registered successfully:', result.credentialId);
            return result;
        } catch (error) {
            if (error.name === 'NotAllowedError') {
                throw new Error('Device registration was cancelled or timed out. Please try again.');
            }
            if (error.name === 'SecurityError') {
                throw new Error('WebAuthn requires a secure context (HTTPS or localhost).');
            }
            throw new Error(`Device registration failed: ${error.message}`);
        }
    }

    /**
     * Authenticate with a previously registered device credential.
     * Proves the user has access to the private key on this device.
     * 
     * @param {string} [credentialId] - Previously stored credential ID (base64url rawId)
     * @returns {Promise<{credentialId: string, signature: string, authenticatorData: string, clientDataJSON: string}>}
     * @throws {Error} If authentication fails
     */
    async authenticate(credentialId) {
        if (!WebAuthnDevice.isSupported()) {
            throw new Error('WebAuthn is not supported on this device/browser.');
        }

        // Use provided credential or retrieve from session
        const storedRawId = credentialId
            || sessionStorage.getItem('webauthn_raw_id')
            || this._credentialId;

        const challenge = crypto.getRandomValues(new Uint8Array(32));

        const publicKeyCredentialRequestOptions = {
            challenge,
            timeout: 60000,
            rpId: this.rpId,
            userVerification: 'required'
        };

        // If we have a specific credential ID, constrain the request
        if (storedRawId) {
            publicKeyCredentialRequestOptions.allowCredentials = [{
                id: this._base64UrlToArrayBuffer(storedRawId),
                type: 'public-key',
                transports: ['internal'] // Platform authenticator
            }];
        }

        try {
            const assertion = await navigator.credentials.get({
                publicKey: publicKeyCredentialRequestOptions
            });

            if (!assertion) {
                throw new Error('No assertion returned from authenticator.');
            }

            const result = {
                credentialId: assertion.id,
                rawId: this._arrayBufferToBase64Url(assertion.rawId),
                signature: this._arrayBufferToBase64(assertion.response.signature),
                authenticatorData: this._arrayBufferToBase64(assertion.response.authenticatorData),
                clientDataJSON: this._arrayBufferToBase64(assertion.response.clientDataJSON)
            };

            console.log('[WebAuthn] Device authenticated successfully:', result.credentialId);
            return result;
        } catch (error) {
            if (error.name === 'NotAllowedError') {
                throw new Error('Authentication was cancelled or timed out. Please try again.');
            }
            throw new Error(`Device authentication failed: ${error.message}`);
        }
    }

    /**
     * Generate a device ID hash suitable for blockchain storage.
     * Hashes the credential ID + public key using SHA-256.
     * 
     * @returns {Promise<string>} Hex-encoded SHA-256 hash
     */
    async getDeviceIdHash() {
        if (!this._credentialId || !this._publicKey) {
            throw new Error('No device credential available. Register first.');
        }

        const data = new TextEncoder().encode(this._credentialId + this._publicKey);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        return this._arrayBufferToHex(hashBuffer);
    }

    /**
     * Get the stored credential data.
     * @returns {{credentialId: string|null, publicKey: string|null}}
     */
    getCredentialData() {
        return {
            credentialId: this._credentialId || sessionStorage.getItem('webauthn_raw_id'),
            publicKey: this._publicKey
        };
    }

    /**
     * Clear stored credential data.
     */
    clear() {
        this._credential = null;
        this._credentialId = null;
        this._publicKey = null;
        sessionStorage.removeItem('webauthn_credential_id');
        sessionStorage.removeItem('webauthn_raw_id');
    }

    // ─── Private Utility Methods ──────────────────────────

    /**
     * Convert ArrayBuffer to Base64 string.
     * @param {ArrayBuffer} buffer
     * @returns {string}
     */
    _arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    /**
     * Convert ArrayBuffer to Base64URL string (no padding, URL-safe).
     * @param {ArrayBuffer} buffer
     * @returns {string}
     */
    _arrayBufferToBase64Url(buffer) {
        return this._arrayBufferToBase64(buffer)
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    }

    /**
     * Convert Base64URL string to ArrayBuffer.
     * @param {string} base64url
     * @returns {ArrayBuffer}
     */
    _base64UrlToArrayBuffer(base64url) {
        const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
        const padding = '='.repeat((4 - (base64.length % 4)) % 4);
        const binary = atob(base64 + padding);
        const buffer = new ArrayBuffer(binary.length);
        const view = new Uint8Array(buffer);
        for (let i = 0; i < binary.length; i++) {
            view[i] = binary.charCodeAt(i);
        }
        return buffer;
    }

    /**
     * Convert ArrayBuffer to hexadecimal string.
     * @param {ArrayBuffer} buffer
     * @returns {string}
     */
    _arrayBufferToHex(buffer) {
        const bytes = new Uint8Array(buffer);
        return Array.from(bytes)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }
}

// Expose as a global
global.WebAuthnDevice = WebAuthnDevice;

})(window);
