import pkg from "hardhat";
import { expect } from "chai";
import "@nomicfoundation/hardhat-chai-matchers";
const { ethers } = pkg;

// Note: ethers.js v6 returns BigInt values — compare with 1n, 0n, etc.

describe("EnhancedIdentity", function () {
    let enhancedIdentity;
    let owner, user1, user2;

    // Sample hashes (bytes32)
    const ssnHash      = ethers.id("ssn-hash-test-1");
    const deviceIdHash = ethers.id("device-id-hash-test-1");
    const faceHash     = ethers.id("face-hash-test-1");
    const combinedHash = ethers.id("combined-hash-test-1");

    const ssnHash2      = ethers.id("ssn-hash-test-2");
    const deviceIdHash2 = ethers.id("device-id-hash-test-2");
    const faceHash2     = ethers.id("face-hash-test-2");
    const combinedHash2 = ethers.id("combined-hash-test-2");

    beforeEach(async function () {
        [owner, user1, user2] = await ethers.getSigners();

        const EnhancedIdentity = await ethers.getContractFactory("EnhancedIdentity");
        enhancedIdentity = await EnhancedIdentity.deploy();
        await enhancedIdentity.waitForDeployment();
    });

    describe("Deployment", function () {
        it("should set the deployer as owner", async function () {
            expect(await enhancedIdentity.owner()).to.equal(owner.address);
        });

        it("should start with zero registered addresses", async function () {
            expect(await enhancedIdentity.getRegisteredCount()).to.equal(0n);
        });
    });

    describe("registerIdentity", function () {
        it("should register a new identity with all 4 factors", async function () {
            await enhancedIdentity.connect(user1).registerIdentity(
                ssnHash, deviceIdHash, faceHash, combinedHash, 4
            );

            const identity = await enhancedIdentity.getIdentity(user1.address);
            expect(identity.ssnHash).to.equal(ssnHash);
            expect(identity.deviceIdHash).to.equal(deviceIdHash);
            expect(identity.faceHash).to.equal(faceHash);
            expect(identity.combinedHash).to.equal(combinedHash);
            expect(identity.isActive).to.be.true;
            expect(identity.factorsVerified).to.equal(4n);
        });

        it("should emit IdentityRegistered event", async function () {
            await expect(
                enhancedIdentity.connect(user1).registerIdentity(
                    ssnHash, deviceIdHash, faceHash, combinedHash, 4
                )
            ).to.emit(enhancedIdentity, "IdentityRegistered");
        });

        it("should register with 1 factor (OCR only)", async function () {
            await enhancedIdentity.connect(user1).registerIdentity(
                ssnHash, ethers.ZeroHash, ethers.ZeroHash, combinedHash, 1
            );

            const identity = await enhancedIdentity.getIdentity(user1.address);
            expect(identity.factorsVerified).to.equal(1n);
            expect(identity.isActive).to.be.true;
        });

        it("should reject zero combined hash", async function () {
            await expect(
                enhancedIdentity.connect(user1).registerIdentity(
                    ssnHash, deviceIdHash, faceHash, ethers.ZeroHash, 4
                )
            ).to.be.revertedWith("EnhancedIdentity: combined hash cannot be zero");
        });

        it("should reject invalid factor count (0)", async function () {
            await expect(
                enhancedIdentity.connect(user1).registerIdentity(
                    ssnHash, deviceIdHash, faceHash, combinedHash, 0
                )
            ).to.be.revertedWith("EnhancedIdentity: invalid factor count");
        });

        it("should reject invalid factor count (5)", async function () {
            await expect(
                enhancedIdentity.connect(user1).registerIdentity(
                    ssnHash, deviceIdHash, faceHash, combinedHash, 5
                )
            ).to.be.revertedWith("EnhancedIdentity: invalid factor count");
        });

        it("should reject duplicate registration (same wallet)", async function () {
            await enhancedIdentity.connect(user1).registerIdentity(
                ssnHash, deviceIdHash, faceHash, combinedHash, 4
            );

            await expect(
                enhancedIdentity.connect(user1).registerIdentity(
                    ssnHash2, deviceIdHash2, faceHash2, combinedHash2, 4
                )
            ).to.be.revertedWith("EnhancedIdentity: identity already registered");
        });

        it("should reject duplicate combined hash", async function () {
            await enhancedIdentity.connect(user1).registerIdentity(
                ssnHash, deviceIdHash, faceHash, combinedHash, 4
            );

            await expect(
                enhancedIdentity.connect(user2).registerIdentity(
                    ssnHash2, deviceIdHash2, faceHash2, combinedHash, 4
                )
            ).to.be.revertedWith("EnhancedIdentity: combined hash already used");
        });

        it("should reject duplicate SSN hash (different wallet)", async function () {
            await enhancedIdentity.connect(user1).registerIdentity(
                ssnHash, deviceIdHash, faceHash, combinedHash, 4
            );

            await expect(
                enhancedIdentity.connect(user2).registerIdentity(
                    ssnHash, deviceIdHash2, faceHash2, combinedHash2, 4
                )
            ).to.be.revertedWith("EnhancedIdentity: this ID document is already registered with another wallet");
        });
    });

    describe("registerIdentityFor (owner-only)", function () {
        it("should allow owner to register for a user", async function () {
            await enhancedIdentity.registerIdentityFor(
                user1.address, ssnHash, deviceIdHash, faceHash, combinedHash, 4
            );

            expect(await enhancedIdentity.isVerified(user1.address)).to.be.true;
        });

        it("should reject non-owner calling registerIdentityFor", async function () {
            await expect(
                enhancedIdentity.connect(user1).registerIdentityFor(
                    user2.address, ssnHash, deviceIdHash, faceHash, combinedHash, 4
                )
            ).to.be.revertedWith("EnhancedIdentity: caller is not the owner");
        });
    });

    describe("View functions", function () {
        beforeEach(async function () {
            await enhancedIdentity.connect(user1).registerIdentity(
                ssnHash, deviceIdHash, faceHash, combinedHash, 4
            );
        });

        it("isVerified should return true for registered user", async function () {
            expect(await enhancedIdentity.isVerified(user1.address)).to.be.true;
        });

        it("isVerified should return false for unregistered user", async function () {
            expect(await enhancedIdentity.isVerified(user2.address)).to.be.false;
        });

        it("isVerifiedWithFactors should check minimum factors", async function () {
            expect(await enhancedIdentity.isVerifiedWithFactors(user1.address, 4)).to.be.true;
            expect(await enhancedIdentity.isVerifiedWithFactors(user1.address, 3)).to.be.true;
            expect(await enhancedIdentity.isVerifiedWithFactors(user1.address, 1)).to.be.true;
        });

        it("verifyCombinedHash should validate the stored hash", async function () {
            expect(await enhancedIdentity.verifyCombinedHash(user1.address, combinedHash)).to.be.true;
            expect(await enhancedIdentity.verifyCombinedHash(user1.address, combinedHash2)).to.be.false;
        });

        it("getRegisteredAddresses should include registered users", async function () {
            const addresses = await enhancedIdentity.getRegisteredAddresses();
            expect(addresses).to.include(user1.address);
        });

        it("getRegisteredCount should return correct count", async function () {
            expect(await enhancedIdentity.getRegisteredCount()).to.equal(1n);
        });
    });

    describe("revokeIdentity", function () {
        beforeEach(async function () {
            await enhancedIdentity.connect(user1).registerIdentity(
                ssnHash, deviceIdHash, faceHash, combinedHash, 4
            );
        });

        it("owner should be able to revoke an identity", async function () {
            await enhancedIdentity.revokeIdentity(user1.address);
            expect(await enhancedIdentity.isVerified(user1.address)).to.be.false;
        });

        it("should emit IdentityRevoked event", async function () {
            await expect(
                enhancedIdentity.revokeIdentity(user1.address)
            ).to.emit(enhancedIdentity, "IdentityRevoked");
        });

        it("non-owner should not be able to revoke", async function () {
            await expect(
                enhancedIdentity.connect(user1).revokeIdentity(user1.address)
            ).to.be.revertedWith("EnhancedIdentity: caller is not the owner");
        });
    });

    describe("deactivateMyIdentity", function () {
        beforeEach(async function () {
            await enhancedIdentity.connect(user1).registerIdentity(
                ssnHash, deviceIdHash, faceHash, combinedHash, 4
            );
        });

        it("user should be able to deactivate their own identity", async function () {
            await enhancedIdentity.connect(user1).deactivateMyIdentity();
            expect(await enhancedIdentity.isVerified(user1.address)).to.be.false;
        });

        it("should fail if identity is not active", async function () {
            await enhancedIdentity.connect(user1).deactivateMyIdentity();
            await expect(
                enhancedIdentity.connect(user1).deactivateMyIdentity()
            ).to.be.revertedWith("EnhancedIdentity: identity not active");
        });
    });

    describe("transferOwnership", function () {
        it("owner should transfer ownership", async function () {
            await enhancedIdentity.transferOwnership(user1.address);
            expect(await enhancedIdentity.owner()).to.equal(user1.address);
        });

        it("should reject transfer to zero address", async function () {
            await expect(
                enhancedIdentity.transferOwnership(ethers.ZeroAddress)
            ).to.be.revertedWith("EnhancedIdentity: new owner cannot be zero");
        });

        it("non-owner should not transfer ownership", async function () {
            await expect(
                enhancedIdentity.connect(user1).transferOwnership(user2.address)
            ).to.be.revertedWith("EnhancedIdentity: caller is not the owner");
        });
    });
});
