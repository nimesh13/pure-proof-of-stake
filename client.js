"use strict";

let { Client, utils } = require('spartan-gold');
let StakeBlockchain = require('./blockchain');
let { getHighestPriorityToken, verifySort, sign, verifySignature } = require('./utils');
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
        this.on(StakeBlockchain.ANNOUNCE_PROOF, this.receiveProof);
        this.on(StakeBlockchain.ANNOUNCE_BLOCK, this.receiveBlock1);
        this.on(StakeBlockchain.COMMITTEE_VOTE, this.committeeVote);
        this.on(StakeBlockchain.GOSSIP_VOTE, this.receiveVote);

        this.proposals = {};
    }

    /**
    * Starts listeners and begins mining.
    */
    initialize() {
        this.proposals = {};
        this.currentBlock = StakeBlockchain.makeBlock(this.address, this.lastBlock);
        setTimeout(() => this.emit(StakeBlockchain.PROPOSE_BLOCK), 1000);
    }

    proposeBlock() {

        let seed = "seed";
        let role = "role";
        let data = seed + role;
        let w = this.currentBlock.balanceOf(this.address);
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
                blockhash: this.currentBlock.hashVal(),
                seed,
            };

            this.net.broadcast(StakeBlockchain.ANNOUNCE_PROOF, obj);
        } else {
            console.log(this.name, "I cannot propose blocks. Listening for other proposals!");
        }

        setTimeout(() => this.findWinningProposal(), 2000);
    }

    receiveProof(o) {

        console.log(this.name, "Collecting all proposals!");
        let [j, maxPriorityToken] = verifySort(o);
        if (j > 0)
            this.proposals[o.blockhash] = o;
    }

    findWinningProposal() {
        console.log(this.name, "Reached here after timeout!");
        let winningToken = new BigInteger("-1");
        let winningProp = {};
        let winningBlockhash = "&&&&&";

        for (const [bhash, prop_obj] of Object.entries(this.proposals)) {
            if (prop_obj.maxPriorityToken > winningToken) {
                winningToken = prop_obj.maxPriorityToken;
                winningProp = prop_obj;
                winningBlockhash = bhash;
            }
        }
        let ctx = this.currentBlock.getContext(this.address, winningProp.seed);

        setTimeout(() => this.baStar(
            ctx,
            this.currentBlock.chainLength,
            winningBlockhash
        ),
            0
        );
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
    baStar(ctx, round, hblock) {
        hblock = this.reduction(ctx, round, hblock);

        // Note: variable hblock returned from reduction is same as what 
        // BA Star was called with. For Binary BA* we use the hblock
        // returned from the Reduction step and not the original
        // argument.
        let hblockStar = this.binaryBAStar(ctx, round, hblock);
    }

    // TODO: the reduction algorithm to reach consensus on either block or empty hash
    reduction(ctx, round, hblock) {
        console.log("Reduction step!!!!");
        this.committeeVote(ctx,
            round,
            "REDUCTION_ONE",
            StakeBlockchain.CommitteeSize,
            hblock
        );

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
            ctx.w,
            ctx.W,
        )

        if (j > 0) {
            console.log(this.name, "I am a committee member!!");
            let msg = {
                round,
                step,
                hash,
                proof,
                lastBlock: ctx.lastBlock,
                value,
            }

            let obj = {
                pk: this.keyPair.getPublic(),
                msg,
                sig: sign(this.keyPair.getPrivate(), msg)
            }

            this.net.broadcast(StakeBlockchain.GOSSIP_VOTE, obj);
        }
    }

    // TODO: process the msgs or votes received
    processMsg(ctx, tau, m) {
        console.log(typeof m)
        let { pk, msg, sig } = m;
        if ( !verifySignature(pk, msg, sig) ) {
            console.log(this.name, "Invalid signature!");
            return [0, null, null];
        } else {
            console.log(this.name, "Vote is valid!!");
        }
        return null;
    }

    // TODO: count votes received for every block
    countVotes(ctx, round, step, T, tau, lambda) {
        return null;
    }

    // TODO: binary BA star algorithm to finish the consensus.
    binaryBAStar(ctx, round, hblock) {
        return null;
    }

    receiveVote(o) {
        console.log(this.name, "Received vote: ");
        return this.processMsg(o);
    }
}