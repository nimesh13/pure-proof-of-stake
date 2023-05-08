"use strict";

let { Client, utils: SGUtils } = require('spartan-gold');
let StakeBlockchain = require('./blockchain');
let utils = require('./utils');
const BigInteger = require('jsbn').BigInteger;

const elliptic = require('elliptic');
const EC = new elliptic.ec('secp256k1');

module.exports = class StakeClient extends Client {

    constructor(...args) {
        super(...args);

        this.keyPair = EC.genKeyPair();
        this.address = SGUtils.calcAddress(this.keyPair.getPublic().encode().toString());

        this.on(StakeBlockchain.PROPOSE_BLOCK, this.proposeBlock);
        this.on(StakeBlockchain.ANNOUNCE_PROOF, this.receiveProof);
        this.on(StakeBlockchain.ANNOUNCE_BLOCK, this.receiveBlock);
        this.on(StakeBlockchain.COMMITTEE_VOTE, this.committeeVote);
        this.on(StakeBlockchain.GOSSIP_VOTE, this.receiveVote);
        this.on(StakeBlockchain.TERMINATE_PROPOSAL, this.terminateProposal);

        this.proposals = {};
        this.ctx = null;
        this.incomingMsgs = new Map();
        this.timeouts = [];
    }

    /**
    * Starts listeners and begins mining.
    */
    initialize(stopAfter = 0) {
        this.timeouts.shift();

        this.proposals = {};
        this.currentBlock = StakeBlockchain.makeBlock(this.address, this.lastBlock);

        if (!this.stopAfter)
            this.stopAfter = stopAfter;
        if (stopAfter && this.currentBlock.chainLength === stopAfter) {
            delete this.stopAfter;
            return;
        }

        this.ctx = this.currentBlock.getContext(this.lastBlock.seed);
        this.hblockStar = null;

        if (!stopAfter)
            this.timeouts.push(setTimeout(() => this.emit(StakeBlockchain.PROPOSE_BLOCK), 1000));
        else this.addEmptyBlock();
    }

    proposeBlock() {
        this.timeouts.shift();

        let role = "proposer";
        let data = this.ctx.seed + role;
        let w = this.currentBlock.balanceOf(this.address);
        let W = this.currentBlock.getTotalCoins();
        let tau = StakeBlockchain.SORTITION_THRESHOLD;

        let [hash, proof, j, maxPriorityToken] = utils.getHighestPriorityToken(
            this.keyPair.getPrivate(),
            this.ctx.seed,
            tau,
            role,
            w,
            W,
        );

        if (maxPriorityToken !== null) {
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
            this.log("[ BLOCK_PROPOSAL ] Listening for other proposals.");
        }

        this.timeouts.push(setTimeout(() => this.findWinningProposal(), 2000));
    }

    receiveProof(o) {

        this.log("[ RECEIVE_PROOF ] Received a proposal.");
        let [j, maxPriorityToken] = utils.verifySort(o);
        if (j > 0)
            this.proposals[o.blockhash] = o;
    }

    findWinningProposal() {
        this.timeouts.shift();

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

        if (winningBlockhash === "&&&&&") {
            this.log("[ RECEIVE_PROOF ] No proposals received.");
            this.addEmptyBlock();
        } else {
            this.timeouts.push(setTimeout(() => this.reductionOne(
                this.currentBlock.chainLength,
                winningBlockhash
            ),
                3000
            ));
        }
    }

    reductionOne(round, hblock) {
        this.timeouts.shift();
        this.log("[ REDUCTION_ONE ] Voting..");
        this.committeeVote(
            round,
            StakeBlockchain.REDUCTION_ONE,
            StakeBlockchain.CommitteeSize,
            hblock
        );

        this.timeouts.push(setTimeout(() => {
            this.countReduceOne(
                round,
                StakeBlockchain.REDUCTION_ONE,
                StakeBlockchain.SORTITION_THRESHOLD_STEP,
                StakeBlockchain.CommitteeSize,
                3 + 2,
            );
        }, 3100));
    }

    countReduceOne(round, step, T, tau, lambda) {
        this.timeouts.shift();
        let hblock1 = this.countVotes(
            round,
            step,
            T,
            tau,
            lambda,
        );

        this.log("[ REDUCTION_ONE ] Hash: " + hblock1);

        this.timeouts.push(setTimeout(() => {
            this.reductionTwo(
                round,
                StakeBlockchain.REDUCTION_TWO,
                StakeBlockchain.CommitteeSize,
                hblock1,
            );
        }, 3100));

    }

    reductionTwo(round, step, tau, hblock1) {
        this.timeouts.shift();
        this.log("[ REDUCTION_TWO ] Voting..");
        let emptyHash = SGUtils.hash(round + this.currentBlock.prevBlockHash);
        if (hblock1 == StakeBlockchain.TIMEOUT) {
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

        this.timeouts.push(setTimeout(() => {
            this.countReduceTwo(
                round,
                StakeBlockchain.REDUCTION_TWO,
                StakeBlockchain.SORTITION_THRESHOLD_STEP,
                StakeBlockchain.CommitteeSize,
                3 + 2,
            );
        }, 3100));
    }

    countReduceTwo(round, step, T, tau, lambda) {
        this.timeouts.shift();
        let hblock2 = this.countVotes(
            round,
            step,
            T,
            tau,
            lambda,
        );

        let emptyHash = SGUtils.hash(round + this.currentBlock.prevBlockHash);

        if (hblock2 == StakeBlockchain.TIMEOUT) hblock2 = emptyHash;

        this.log(" REDUCTION_TWO ] Hash: " + hblock2);

        this.timeouts.push(setTimeout(() => {
            this.binaryBAStarStageOne(round, hblock2);
        }, 0));
    }

    binaryBAStarStageOne(round, hblock, step = 1) {
        this.timeouts.shift();
        let r = hblock;
        this.log("[ BINARYBA* ] [ STAGE-1 ] Step: " + step + " Voting...");

        this.committeeVote(
            round,
            step,
            StakeBlockchain.CommitteeSize,
            r
        );

        this.timeouts.push(setTimeout(() => {
            this.countBinaryBAStarStageOne(
                round,
                step,
                StakeBlockchain.SORTITION_THRESHOLD_STEP,
                StakeBlockchain.CommitteeSize,
                r,
                3 + 2,
            );
        },
            3100));
    }

    countBinaryBAStarStageOne(round, step, T, tau, hblock, lambda) {
        this.timeouts.shift();
        let emptyHash = SGUtils.hash(round + this.currentBlock.prevBlockHash);

        let r = this.countVotes(
            round,
            step,
            T,
            tau,
            lambda,
        );

        this.log("[ BINARYBA* ] [ STAGE-1 ] Step: " + step + " Hash: " + r);

        if (r == StakeBlockchain.TIMEOUT) {
            r = hblock;
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
                    StakeBlockchain.FINAL_CONSENSUS,
                    tau,
                    r
                );
                this.hblockStar = r;
                this.log("[ BINARYBA* ] [ STAGE-1 ] Step: " + step + " Quorum reached. Hash: " + this.hblockStar);
                this.timeouts.push(setTimeout(() => {
                    this.BAStar(round);
                }, 3100));
                return;
            }
        }
        step++;
        this.timeouts.push(setTimeout(() =>
            this.binaryBAStarStageTwo(round, r, hblock, step),
            3000
        ));
    }

    binaryBAStarStageTwo(round, r, hblock, step) {
        this.timeouts.shift();
        this.log("[ BINARYBA* ] [ STAGE-2 ] Step: " + step + " Voting...");

        this.committeeVote(
            round,
            step,
            StakeBlockchain.CommitteeSize,
            r,
        );

        this.timeouts.push(setTimeout(() => {
            this.countBinaryBAStarStageTwo(
                round,
                step,
                StakeBlockchain.SORTITION_THRESHOLD_STEP,
                StakeBlockchain.CommitteeSize,
                hblock,
                3 + 2)
        }, 3100));
    }

    countBinaryBAStarStageTwo(round, step, T, tau, hblock, lambda) {
        this.timeouts.shift();
        let emptyHash = SGUtils.hash(round + this.currentBlock.prevBlockHash);

        let r = this.countVotes(
            round,
            step,
            T,
            tau,
            lambda,
        );

        this.log("[ BINARYBA* ] [ STAGE-2 ] Step: " + step + " Hash: " + r);

        if (r == StakeBlockchain.TIMEOUT) {
            r = emptyHash;
        } else if (r == emptyHash) {
            for (let s = step + 1; s <= step + 3; s++) {
                this.committeeVote(
                    round,
                    s,
                    tau,
                    r
                );
                this.hblockStar = r;
                this.log("[ BINARYBA* ] [ STAGE-2 ] Step: " + step + " Quorum reached. Hash: " + this.hblockStar);
                this.timeouts.push(setTimeout(() => {
                    this.BAStar(round);
                }, 3100));
                return;
            }
        }
        step++;
        this.timeouts.push(setTimeout(() =>
            this.binaryBAStarStageThree(round, r, hblock, step),
            3000
        ));
    }

    binaryBAStarStageThree(round, r, hblock, step) {
        this.timeouts.shift();
        this.log("[ BINARYBA* ] [ STAGE-3 ] Step: " + step + " Voting...");

        this.committeeVote(
            round,
            step,
            StakeBlockchain.CommitteeSize,
            r,
        );

        this.timeouts.push(setTimeout(() => {
            this.countBinaryBAStarStageThree(
                round,
                step,
                StakeBlockchain.SORTITION_THRESHOLD_STEP,
                StakeBlockchain.CommitteeSize,
                hblock,
                3 + 2)
        }, 3100));
    }

    countBinaryBAStarStageThree(round, step, T, tau, hblock, lambda) {
        this.timeouts.shift();
        let emptyHash = SGUtils.hash(round + this.currentBlock.prevBlockHash);

        let r = this.countVotes(
            round,
            step,
            T,
            tau,
            lambda,
        );

        this.log("[ BINARYBA* ] [ STAGE-3 ] Step: " + step + " Hash: " + r);

        if (r == StakeBlockchain.TIMEOUT) {
            if (this.commonCoin(round, step, tau) == 0)
                r = hblock;
            else r = emptyHash;
        }
        step++;
        if (step < 13) {
            this.timeouts.push(setTimeout(() => {
                this.binaryBAStarStageOne(round, hblock, step);
            }, 3000));
        } else {
            this.log("HANG FOREVERR!!!!!!");
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
                    let hash = SGUtils.hash(sorthash + j);
                    let h = new BigInteger(hash, 16);
                    if (h < minHash)
                        minHash = h;
                }
            }
        }
        return minHash % 2;
    }

    BAStar(round) {
        this.timeouts.shift();
        let emptyHash = SGUtils.hash(round + this.currentBlock.prevBlockHash);

        let r = this.countVotes(
            round,
            StakeBlockchain.FINAL_CONSENSUS,
            StakeBlockchain.SORTITION_THRESHOLD_FINAL,
            StakeBlockchain.CommitteeSize,
            3 + 2,
        );

        if (this.hblockStar == r) {
            this.log("[ BA* ] FINAL Consensus reached! " + this.hblockStar);
            if (this.hblockStar === this.currentBlock.hashVal()) {
                this.currentBlock.blockStatus = StakeBlockchain.FINAL_CONSENSUS;
                this.announceBlock();
            }
        } else {
            this.log("[ BA* ] TENTATIVE Consensus reached! " + this.hblockStar);
            this.currentBlock.blockStatus = StakeBlockchain.TENATIVE_CONSENSUS;
            if (this.hblockStar === emptyHash) {
                this.addEmptyBlock();
            }
            else if (this.hblockStar === this.currentBlock.hashVal())
                this.announceBlock();
        }
        return;
    }

    committeeVote(round, step, tau, value) {

        // check if user is in committee using Sortition
        let role = "committee" + round + step;

        const [hash, proof, j, _] = utils.getHighestPriorityToken(
            this.keyPair.getPrivate(),
            this.ctx.seed,
            tau,
            role,
            this.ctx.w.get(this.address),
            this.ctx.W,
        );

        if (j > 0) {
            // this.log("I am a committee member!!");
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
                sig: utils.sign(this.keyPair.getPrivate(), msg),
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

        if (!utils.verifySignature(pk, msg, sig)) {
            this.log("Invalid signature!");
            return [0, null, null];
        }

        // The recevied Vote is valid.
        // this.log("Vote is valid!!");

        let { round, step, sorthash, proof, lastBlock, value, addr } = msg;

        // discard messages that do not extend this chain
        if (lastBlock != this.ctx.lastBlock) {
            throw new Error(`
                Possible fork detected.
                Received block that doesn't extend the chain:
                received -> ${JSON.stringify(lastBlock)}
                actual -> ${JSON.stringify(this.ctx.lastBlock)}`);
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

        let [j, _] = utils.verifySort(obj);

        return [j, value, sorthash];
    }

    countVotes(round, step, T, tau, lambda) {
        let counts = {};
        let voters = new Set();

        if (!this.incomingMsgs.has(round) || !this.incomingMsgs.get(round).has(step)) {
            return StakeBlockchain.TIMEOUT;
        } else {
            const msgs = this.incomingMsgs.get(round).get(step)[Symbol.iterator]();
            while (true) {
                let m = msgs.next().value;

                if (m === undefined) {
                    return StakeBlockchain.TIMEOUT;
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
        // this.log("Received vote from: " + voter + " " + round + " " + step);

        if (!this.incomingMsgs.has(round)) {
            this.incomingMsgs.set(round, new Map());
        }
        if (!this.incomingMsgs.get(round).has(step)) {
            this.incomingMsgs.get(round).set(step, []);
        }

        this.incomingMsgs.get(round).get(step).push(vote);
    }

    addEmptyBlock() {
        this.log("Adding empty block!");
        this.currentBlock.rewardAddr = null;
        this.currentBlock.seed = SGUtils.hash(Array.from(this.net.clients.keys()).join());
        this.timeouts.push(
            setTimeout(() => this.receiveBlock(this.currentBlock),
                0
            ));
    }

    announceBlock() {
        this.log("Announcing block!");
        let [newSeed, _] = utils.calcNewSeed(this.keyPair.getPrivate(), this.lastBlock.seed, this.currentBlock.chainLength);
        this.currentBlock.seed = Buffer.from(newSeed).toString('hex');
        this.timeouts.push(setTimeout(() => {
            this.net.broadcast(StakeBlockchain.ANNOUNCE_BLOCK, this.currentBlock);
        }, 3000));
    }

    receiveBlock(block) {
        this.timeouts.shift();
        block = StakeBlockchain.deserializeBlock(block);

        // Ignore the block if it has been received previously.
        if (this.blocks.has(block.id)) return null;

        // if (!block.isGenesisBlock()) {
        //     // Verify the block, and store it if everything looks good.
        //     // This code will trigger an exception if there are any invalid transactions.
        //     let success = block.rerun(prevBlock);
        //     if (!success) return null;
        // }

        if (block.blockStatus === StakeBlockchain.FINAL_CONSENSUS) {
            this.log('Recevied a FINAL block. Finalizing all TENTATIVE blocks!');
            for (let [id, block] of this.blocks.entries()) {
                if (block.blockStatus === StakeBlockchain.TENATIVE_CONSENSUS) {
                    block.blockStatus = StakeBlockchain.FINAL_CONSENSUS;
                    this.blocks.set(id, block);
                }
            }
        }

        this.blocks.set(block.id, block);

        // If it is a better block than the client currently has, set that
        // as the new currentBlock, and update the lastConfirmedBlock.
        if (this.lastBlock.chainLength < block.chainLength) {
            this.lastBlock = block;
            this.setLastConfirmed();
        }

        this.timeouts.push(setTimeout(() => {
            this.initialize(this.stopAfter);
        }, 0));

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

    endAll() {
        this.log('Initiating Termination.');
        this.net.broadcast(StakeBlockchain.TERMINATE_PROPOSAL, {});
    }

    terminateProposal() {
        this.log('Received Termination Request.');
        for (const timeoutId of this.timeouts) {
            clearTimeout(timeoutId);
        }
        this.timeouts.shift();
        return;
    }

    log(msg) {
        let name = this.name || this.address.substring(0, 10);

        console.log(`[ ${name} ] ${msg}`);
    }
}