"use strict";

let { Client, utils } = require('spartan-gold');
let StakeBlockchain = require('./blockchain');
let { getHighestPriorityToken, verifySort } = require('./utils');
const BigInteger = require('jsbn').BigInteger;

const elliptic = require('elliptic');
const EC = new elliptic.ec('secp256k1');
let identityCount = 0;

module.exports = class StakeClient extends Client {

    constructor(...args) {
        super(...args);

        this.keyPair = EC.genKeyPair();

        this.address = utils.calcAddress(this.keyPair.getPublic().encode().toString());

        this.identity = identityCount;
        identityCount += 1;

        this.on(StakeBlockchain.PROPOSE_BLOCK, this.proposeBlock);
        this.on(StakeBlockchain.ANNOUNCE_PROOF, this.receiveBlock);
        this.on(StakeBlockchain.ANNOUNCE_BLOCK, this.receiveBlock1);
        this.on(StakeBlockchain.COMMITTEE_VOTE, this.committeeVote);
        this.on(StakeBlockchain.GOSSIP_VOTE, this.gossipVote);

        this.proposals = {};
    }

    /**
    * Starts listeners and begins mining.
    */
    initialize() {
        this.currentBlock = StakeBlockchain.makeBlock(this.address, this.lastBlock);
        setTimeout(() => this.emit(StakeBlockchain.PROPOSE_BLOCK), 1000);
    }

    proposeBlock() {

        let seed = "seed";
        let role = "role";
        let data = seed + role;
        let w = this.lastBlock.balanceOf(this.address);
        let W = this.currentBlock.getTotalCoins();
        let tau = StakeBlockchain.SortitionThreshold;

        let [hash, proof, j, maxPriorityToken] = getHighestPriorityToken(
            this.keyPair.getPrivate(),
            seed,
            tau,
            role,
            w,
            W,
        );

        if (maxPriorityToken !== null) {
            let obj = {
                data,
                hash,
                proof,
                j,
                maxPriorityToken,
                address: this.address,
                publicKey: this.keyPair.getPublic(),
                w,
                W,
                tau,
            };

            this.net.broadcast(StakeBlockchain.ANNOUNCE_PROOF, obj);
        } else {
            console.log(this.name, "I cannot propose blocks. Listening for other proposals!");
        }
    }

    receiveBlock(o) {

        console.log(this.name, "Collecting all proposals!");
        let [j, maxPriorityToken] = verifySort(o);
        if (j > 0) {
            this.proposals[o.address] = maxPriorityToken;
        }

        setTimeout(() => this.findWinningProposal(), 10);
    }

    findWinningProposal() {
        console.log(this.name, "Reached here after timeout!");
    }

    receiveBlock1(block) {

        block = StakeBlockchain.deserializeBlock(block);
        let currentBlock = this.currentBlock;

        if (currentBlock.winner === block.winner) {

            // Storing the block.

            // Make sure that we have the previous blocks, unless it is the genesis block.
            // If we don't have the previous blocks, request the missing blocks and exit.
            let prevBlock = this.blocks.get(block.prevBlockHash);
            if (!prevBlock && !block.isGenesisBlock()) {
                let stuckBlocks = this.pendingBlocks.get(block.prevBlockHash);

                // If this is the first time that we have identified this block as missing,
                // send out a request for the block.
                if (stuckBlocks === undefined) {
                    this.requestMissingBlock(block);
                    stuckBlocks = new Set();
                }
                stuckBlocks.add(block);

                this.pendingBlocks.set(block.prevBlockHash, stuckBlocks);
                return null;
            }

            if (!block.isGenesisBlock()) {
                // Verify the block, and store it if everything looks good.
                // This code will trigger an exception if there are any invalid transactions.
                let success = block.rerun(prevBlock);
                if (!success) return null;
            }

            this.blocks.set(block.id, block);

            // If it is a better block than the client currently has, set that
            // as the new currentBlock, and update the lastConfirmedBlock.
            if (this.lastBlock.chainLength < block.chainLength) {
                this.lastBlock = block;
                this.setLastConfirmed();
            }

            this.initialize();
        }
    }

    setLastConfirmed() {
        let block = this.lastBlock;

        let confirmedBlockHeight = block.chainLength - StakeBlockchain.CONFIRMED_DEPTH;
        if (confirmedBlockHeight < 0) {
            confirmedBlockHeight = 0;
        }
        while (block.chainLength > confirmedBlockHeight) {
            block = this.blocks.get(block.prevBlockHash);
        }
        this.lastConfirmedBlock = block;
    }

    // TODO: main byzantine agreement algorithm
    baStar(ctx, round, block) {
        return null;
    }

    // TODO: the committee vote
    committeeVote(ctx, round, step, tau, value) {

        // check if user is in committee using Sortition
        let role = "committee" + round + step;

        const [hash, proof, j, maxPriorityToken] = getHighestPriorityToken(
            this.keyPair.getPrivate(),
            ctx.seed,
            tau,
            role,
            ctx.weight[this.address],
            ctx.W,
        )

        if (j > 0) {
            this.net.broadcast(StakeBlockchain.GOSSIP_VOTE, obj);
        }
    }

    // TODO: process the msgs or votes received
    processMsg(ctx, tau, m) {
        return null;
    }

    // TODO: count votes received for every block
    countVotes(ctx, round, step, T, tau, lambda) {
        return null;
    }

    // TODO: the reduction algorithm to reach consensus on either block or empty hash
    reduction(ctx, round, hblock) {
        return null;
    }

    gossipVote() {
        return null;
    }
}