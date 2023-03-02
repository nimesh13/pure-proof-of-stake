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
        this.ctx = null;
    }

    /**
    * Starts listeners and begins mining.
    */
    initialize() {
        this.proposals = {};
        this.currentBlock = StakeBlockchain.makeBlock(this.address, this.lastBlock);
        let seed = "seed";
        this.ctx = this.currentBlock.getContext(seed);

        setTimeout(() => this.emit(StakeBlockchain.PROPOSE_BLOCK), 1000);
    }

    proposeBlock() {

        let role = "proposer";
        let data = this.ctx.seed + role;
        let w = this.currentBlock.balanceOf(this.address);
        let W = this.currentBlock.getTotalCoins();
        let tau = StakeBlockchain.SortitionThreshold;

        let [hash, proof, j, maxPriorityToken] = getHighestPriorityToken(
            this.keyPair.getPrivate(),
            this.ctx.seed,
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
                seed: this.ctx.seed,
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

        setTimeout(() => this.baStar(
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
    baStar(round, hblock) {
        hblock = this.reduction(round, hblock);

        // Note: variable hblock returned from reduction is same as what 
        // BA Star was called with. For Binary BA* we use the hblock
        // returned from the Reduction step and not the original
        // argument.
        let hblockStar = this.binaryBAStar(round, hblock);
    }

    // TODO: the reduction algorithm to reach consensus on either block or empty hash
    reduction(round, hblock) {
        console.log("Reduction step!!!!");
        this.committeeVote(
            round,
            "REDUCTION_ONE",
            StakeBlockchain.CommitteeSize,
            hblock
        );

        return null;
    }

    // TODO: the committee vote
    committeeVote(round, step, tau, value) {

        // check if user is in committee using Sortition
        let role = "committee" + round + step;

        const [hash, proof, j, _] = getHighestPriorityToken(
            this.keyPair.getPrivate(),
            this.ctx.seed,
            tau,
            role,
            this.ctx.w.get(this.address),
            this.ctx.W,
        )

        console.log("Voting role: ", role)

        if (j > 0) {
            console.log(this.name, "I am a committee member!!");
            let msg = {
                round,
                step,
                sorthash: hash,
                proof,
                lastBlock: this.ctx.lastBlock,
                value,
                addr: this.address,
                name: this.name,
            }

            let obj = {
                pk: this.keyPair.getPublic(),
                msg,
                sig: sign(this.keyPair.getPrivate(), msg)
            };

            this.net.broadcast(StakeBlockchain.GOSSIP_VOTE, obj);
        }
    }

    // TODO: process the msgs or votes received
    processMsg(tau, m) {
        let { pk, msg, sig } = m;

        // console.log("Message: ", msg)
        if (!verifySignature(pk, msg, sig)) {
            console.log(this.name, "Invalid signature!");
            return [0, null, null];
        }
        console.log(this.name, "Vote is valid!!");

        let { round, step, sorthash, proof, lastBlock, value, addr } = msg;

        // discard messages that do not extend this chain
        if (lastBlock != this.ctx.lastBlock) {
            console.log(this.name, "Message doesn't extend this chain!");
            return [0, null, null];
        }

        // check if user is in committee using Sortition
        let role = "committee" + round + step;

        let obj = {
            hash: sorthash,
            proof,
            publicKey: pk,
            tau,
            w: this.ctx.w.get(addr),
            W: this.ctx.W,
            data: this.ctx.seed + role,
        };

        let [j, _] = verifySort(obj);

        return [j, value, sorthash];
    }

    // TODO: count votes received for every block
    countVotes(round, step, T, tau, lambda) {
        return null;
    }

    // TODO: binary BA star algorithm to finish the consensus.
    binaryBAStar(round, hblock) {
        return null;
    }

    receiveVote(o) {
        // console.log(this.name, "Received vote: ", o);
        let [votes, value, hash] = this.processMsg(
            StakeBlockchain.CommitteeSize,
            o
        );
        console.log(this.name, "VoteS: ", votes)
    }
}