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
        this.on(StakeBlockchain.ANNOUNCE_BLOCK, this.receiveBlock);
        this.on(StakeBlockchain.COMMITTEE_VOTE, this.committeeVote);
        this.on(StakeBlockchain.GOSSIP_VOTE, this.receiveVote);

        this.proposals = {};
        this.ctx = null;
        this.incomingMsgs = new Map();
    }

    /**
    * Starts listeners and begins mining.
    */
    initialize() {
        this.proposals = {};
        this.currentBlock = StakeBlockchain.makeBlock(this.address, this.lastBlock);

        // calculate this seed from last Block.
        let seed = "seed";
        this.currentBlock.seed = seed;

        this.ctx = this.currentBlock.getContext(seed);
        this.hblockStar = null;

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
            this.currentBlock.winner = this.address;
            this.currentBlock.blockhash = hash;
            this.currentBlock.blockMaxToken = maxPriorityToken;
            this.currentBlock.blockWinners = j;
            this.currentBlock.blockProof = proof;

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

        setTimeout(() => this.reductionOne(
            this.currentBlock.chainLength,
            winningBlockhash
        ),
            3000
        );
    }

    reductionOne(round, hblock) {
        console.log(this.name, "Reduction step!!!!");
        this.committeeVote(
            round,
            "REDUCTION_ONE",
            StakeBlockchain.CommitteeSize,
            hblock
        );

        setTimeout(() => {
            this.countReduceOne(
                round,
                "REDUCTION_ONE",
                0.685,
                StakeBlockchain.CommitteeSize,
                3 + 2,
            );
        }, 6000);
    }

    countReduceOne(round, step, T, tau, lambda) {
        let hblock1 = this.countVotes(
            round,
            step,
            T,
            tau,
            lambda,
        );

        console.log(this.name, "REDUCTION ONE:", hblock1);

        setTimeout(() => {
            this.reductionTwo(
                round,
                "REDUCTION_TWO",
                StakeBlockchain.CommitteeSize,
                hblock1,
            );
        }, 6000);

    }

    reductionTwo(round, step, tau, hblock1) {
        let emptyHash = " THIS IS EMPTY HASH!!!!";
        if (hblock1 == "TIMEOUT") {
            this.committeeVote(
                round,
                step,
                tau,
                emptyHash
            );
        } else {
            this.committeeVote(
                round,
                step,
                tau,
                hblock1
            );
        }

        setTimeout(() => {
            this.countReduceTwo(
                round,
                "REDUCTION_TWO",
                0.685,
                StakeBlockchain.CommitteeSize,
                3 + 2,
            );
        }, 6000);
    }

    countReduceTwo(round, step, T, tau, lambda) {
        let hblock2 = this.countVotes(
            round,
            step,
            T,
            tau,
            lambda,
        );

        let emptyHash = " THIS IS EMPTY HASH!!!!";

        if (hblock2 == "TIMEOUT") hblock2 = emptyHash;

        console.log(this.name, "REDUCTION TWO:", hblock2);

        setTimeout(() => {
            this.binaryBAStarStageOne(round, hblock2);
        }, 0)
    }

    binaryBAStarStageOne(round, hblock, step = 1) {
        let r = hblock;
        console.log(this.name, "STARTING BINARY BA STAR STAGE", step);

        this.committeeVote(
            round,
            step,
            StakeBlockchain.CommitteeSize,
            r
        );

        setTimeout(() => {
            this.binaryBAStarCountStageOne(
                round,
                step,
                0.685,
                StakeBlockchain.CommitteeSize,
                r,
                3 + 2,
            );
        },
            6000);
    }

    binaryBAStarCountStageOne(round, step, T, tau, hblock, lambda) {
        let emptyHash = " THIS IS EMPTY HASH!!!!";

        let r = this.countVotes(
            round,
            step,
            T,
            tau,
            lambda,
        );

        console.log(this.name, "[1] Votes:", r);

        if (r == "TIMEOUT") {
            r = hblock;
            console.log(this.name, "TIMED OUT STAGE:", step);
        } else if (r != emptyHash) {
            for (let s = step + 1; s <= step + 3; s++) {
                this.committeeVote(
                    round,
                    s,
                    tau,
                    r
                );
            }

            if (step == 1) {
                this.committeeVote(
                    round,
                    'FINAL',
                    tau,
                    r
                );
                this.hblockStar = r;
                console.log(this.name, "[1] Quorum reached. Returning with hash: ", this.hblockStar);
                setTimeout(() => {
                    this.BAStar(round);
                }, 6000);
                return;
            }
        }
        step++;
        setTimeout(() =>
            this.binaryBAStarStageTwo(round, r, hblock, step),
            3000
        );
    }

    binaryBAStarStageTwo(round, r, hblock, step) {
        console.log(this.name, "STARTING BINARY BA STAR STAGE", step);

        this.committeeVote(
            round,
            step,
            StakeBlockchain.CommitteeSize,
            r,
        );

        setTimeout(() => {
            this.binaryBAStarCountStageTwo(
                round,
                step,
                0.685,
                StakeBlockchain.CommitteeSize,
                hblock,
                3 + 2)
        }, 6000);
    }

    binaryBAStarCountStageTwo(round, step, T, tau, hblock, lambda) {
        let emptyHash = " THIS IS EMPTY HASH!!!!";

        let r = this.countVotes(
            round,
            step,
            T,
            tau,
            lambda,
        );

        console.log(this.name, "[2] Votes:", r);

        if (r == "TIMEOUT") {
            r = emptyHash;
            console.log(this.name, "TIMED OUT STAGE:", step);
        } else if (r == emptyHash) {
            for (let s = step + 1; s <= step + 3; s++) {
                this.committeeVote(
                    round,
                    s,
                    tau,
                    r
                );
                this.hblockStar = r;
                console.log(this.name, "[2] Quorum reached. Returning with hash: ", this.hblockStar);
                setTimeout(() => {
                    this.BAStar(round);
                }, 6000);
                return;
            }
        }
        step++;
        setTimeout(() =>
            this.binaryBAStarStageThree(round, r, hblock, step),
            3000
        );
    }

    binaryBAStarStageThree(round, r, hblock, step) {
        console.log(this.name, "STARTING BINARY BA STAR STAGE", step);

        this.committeeVote(
            round,
            step,
            StakeBlockchain.CommitteeSize,
            r,
        );

        setTimeout(() => {
            this.binaryBAStarCountStageThree(
                round,
                step,
                0.685,
                StakeBlockchain.CommitteeSize,
                hblock,
                3 + 2)
        }, 6000);
    }

    binaryBAStarCountStageThree(round, step, T, tau, hblock, lambda) {
        let emptyHash = " THIS IS EMPTY HASH!!!!";

        let r = this.countVotes(
            round,
            step,
            T,
            tau,
            lambda,
        );

        console.log(this.name, "[3] Votes:", r);

        if (r == 'TIMEOUT') {
            console.log(this.name, "TIMED OUT STAGE:", step);
            if (this.commonCoin(round, step, tau) == 0)
                r = hblock;
            else r = emptyHash;
        }
        step++;
        if (step < 13) {
            setTimeout(() => {
                this.binaryBAStarStageOne(round, hblock, step);
            }, 3000)
        } else {
            console.log(this.name, "HANG FOREVERR!!!!!!");
            return;
        }
    }

    commonCoin(round, step, tau) {
        let minHash = new BigInteger("2").pow(32 * 8);
        if (this.incomingMsgs.has(round) && this.incomingMsgs.get(round).has(step)) {
            const msgs = this.incomingMsgs.get(round).get(step)[Symbol.iterator]();
            while (true) {
                let m = msgs.next().value;
                if (m == undefined) break;
                let [votes, value, sorthash] = this.processMsg(tau, m);
                for (let j = 0; j < votes; j++) {
                    let hash = utils.hash(sorthash + j);
                    let h = new BigInteger(hash, 16);
                    if (h < minHash)
                        minHash = h;
                }
            }
        }
        return minHash % 2;
    }

    BAStar(round) {
        let r = this.countVotes(
            round,
            'FINAL',
            0.685,
            StakeBlockchain.CommitteeSize,
            3 + 2,
        );

        if (this.hblockStar == r) {
            console.log(this.name, "FINAL CONSENSUS REACHED!!!");
            this.announceBlock();
        } else {
            console.log(this.name, "TENTATIVE CONSENSUS REACHED!!!");
            console.log(this.name, "FINAL votes: ", this.hblockStar);
            console.log(this.name, "R: ", r);
        }
        return;
    }

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
        );

        if (j > 0) {
            // console.log(this.name, "I am a committee member!!");
            let msg = {
                round,
                step,
                sorthash: hash,
                proof,
                lastBlock: this.ctx.lastBlock,
                value,
                addr: this.address,
            }

            let obj = {
                pk: this.keyPair.getPublic(),
                msg,
                sig: sign(this.keyPair.getPrivate(), msg),
                addr: this.address,
                voter: this.name,
                round,
                step,
            };

            this.net.broadcast(StakeBlockchain.GOSSIP_VOTE, obj);
        }
    }

    processMsg(tau, m) {
        let { pk, msg, sig } = m;

        // console.log("Message: ", msg)
        if (!verifySignature(pk, msg, sig)) {
            console.log(this.name, "Invalid signature!");
            return [0, null, null];
        }
        // console.log(this.name, "Vote is valid!!");

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

    countVotes(round, step, T, tau, lambda) {
        let counts = {};
        let voters = new Set();

        // return "TIMEOUT";

        if (!this.incomingMsgs.has(round) || !this.incomingMsgs.get(round).has(step)) {
            return "TIMEOUT";
        } else {
            const msgs = this.incomingMsgs.get(round).get(step)[Symbol.iterator]();

            while (true) {
                let m = msgs.next().value;

                if (m === undefined) {
                    return "TIMEOUT";
                } else {
                    let { addr } = m;
                    let [votes, value, sorthash] = this.processMsg(tau, m);
                    if (voters.has(addr) || votes < 1)
                        continue;
                    voters.add(addr);
                    counts[value] = (counts[value] + votes) || votes;
                    if (counts[value] > T * tau) {
                        return value;
                    }
                }
            }
        }
    }

    receiveVote(vote) {
        let { voter, round, step } = vote;
        // console.log(this.name, "Received vote from: ", voter);

        if (!this.incomingMsgs.has(round)) {
            this.incomingMsgs.set(round, new Map());
        }
        if (!this.incomingMsgs.get(round).has(step)) {
            this.incomingMsgs.get(round).set(step, []);
        }

        this.incomingMsgs.get(round).get(step).push(vote);
    }

    announceBlock() {
        this.net.broadcast(StakeBlockchain.ANNOUNCE_BLOCK, this.currentBlock);
    }

    receiveBlock(block) {

        block = StakeBlockchain.deserializeBlock(block);

        // Ignore the block if it has been received previously.
        if (this.blocks.has(block.id)) return null;

        // if (!block.isGenesisBlock()) {
        //     // Verify the block, and store it if everything looks good.
        //     // This code will trigger an exception if there are any invalid transactions.
        //     let success = block.rerun(prevBlock);
        //     if (!success) return null;
        // }

        this.blocks.set(block.id, block);

        // If it is a better block than the client currently has, set that
        // as the new currentBlock, and update the lastConfirmedBlock.
        if (this.lastBlock.chainLength < block.chainLength) {
            this.lastBlock = block;
            this.setLastConfirmed();
        }

        setTimeout(() => {
            this.initialize();
        }, 0);

    }

    setLastConfirmed() {
        // let block = this.lastBlock;

        // let confirmedBlockHeight = block.chainLength - StakeBlockchain.CONFIRMED_DEPTH;
        // if (confirmedBlockHeight < 0) {
        //     confirmedBlockHeight = 0;
        // }
        // while (block.chainLength > confirmedBlockHeight) {
        //     block = this.blocks.get(block.prevBlockHash);
        // }
        this.lastConfirmedBlock = this.lastBlock;
    }
}