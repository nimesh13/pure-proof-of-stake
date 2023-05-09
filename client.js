"use strict";

let { Client, utils: SGUtils } = require('spartan-gold');
let StakeBlockchain = require('./blockchain');
let utils = require('./utils');
const BigInteger = require('jsbn').BigInteger;

const elliptic = require('elliptic');
const EC = new elliptic.ec('secp256k1');

/**
 * A client has a public/private keypair and an address.
 * It can send and receive messages on the Blockchain network.
 */
module.exports = class StakeClient extends Client {

    /**
     * Sets up the event listeners for the clients and 
     * initialises a few parameters for them:
     * 
     * 1. proposals - object to store all the block proposals.
     * 2. ctx - to store the context of the blockchain.
     * 3. incomingMsgs - message buffer to store all votes for
     * a given round and step.
     * 4. timeouts - this tracks all setTimeouts so they can be cleared
     * and removed when the client needs to be terminated.
     * 
     * @param  {...any} args - for the base class.
     */
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

    /**
     * Proposes block by running the cryptographic sortition to
     * check if the client is selected or not. If they are selected,
     * they broadcast the hash and proof else they wait for 
     * receiving all proposals and finding the winner.
     */
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

    /**
     * Stores the proofs of all the client broadcasts from the block proposal
     * stage. Runs the cryptographic sortition again to verify them.
     * 
     * @param {Object} o - Takes in the proof broadcasted by the proposers. 
     */
    receiveProof(o) {

        this.log("[ RECEIVE_PROOF ] Received a proposal.");
        let [j, maxPriorityToken] = utils.verifySort(o);
        if (j > 0)
            this.proposals[o.blockhash] = o;
    }

    /**
     * Finds the winning block proposals from all the stored
     * block proposals or proofs. Starts reduction if at least
     * one proposal was received else starts adding an empty
     * block.
     */
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

    /**
     * This is the first step of BA*. Reduction in the original
     * algorithm is broken into two separate components.
     * reductionOne votes for the first step,
     * REDUCTION_ONE 
     * 
     * @param {Number} round - the current round number.
     * @param {String} hblock - the block hash BA* is initialised with.
     */
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

    /**
     * Counts votes for the first step of Reduction, REDUCTION_ONE. 
     * Passes the block hash to the second step.
     * 
     * @param {Number} round - the current round number.
     * @param {String} step - the step in the current round.
     * @param {Number} T - the sortition threshold for the current step.
     * @param {Number} tau - committee size for the given step to declare majority.
     * @param {Number} lambda - the time clients should wait to receive all votes before counting.
     */
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

    /**
     * Second step of Reduction, REDUCTION_TWO, where clients 
     * vote for either empty_hash or block_hash based on the votes
     * counted in the first step.
     * 
     * @param {Number} round - the current round number.
     * @param {String} step - the current step in the given round.
     * @param {Number} tau - committee size for the given step to declare majority.
     * @param {String} hblock1 - the block hash realised in REDUCTION_ONE
     */
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

    /**
     * Counts votes for the second step, REDUCTION_TWO.
     * Passes either empty_hash or block_hash to the next stage,
     * BinaryBA*.
     * 
     * @param {Number} round - the current round number.
     * @param {String} step - the current step in the given round.
     * @param {Number} T - the sortition threshold for the current step.
     * @param {Number} tau - committee size for the given step to declare majority.
     * @param {Number} lambda - the time clients should wait to receive all votes before counting.
     */
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

    /**
     * Performs the first stage of Binary BA* algorithm.
     * Clients vote for the block hash.
     * 
     * @param {Number} round - the current round number.
     * @param {String} hblock - the block hash passed on from reduction.
     * @param {Number} step - the current step of the given round.
     */
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

    /**
     * Count the votes in the first stage of BinaryBA*.
     * Resets the block hash to original value or votes FINAL and exits.
     * 
     * @param {Number} round - the current round number.
     * @param {Number} step - the current step for the given round.
     * @param {Number} T - the sortition threshold for the current step.
     * @param {Number} tau - committee size for the given step to declare majority.
     * @param {String} hblock - block hash passed on from reduction.
     * @param {Number} lambda - the time clients should wait to receive all votes before counting. 
     */
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

    /**
     * The second stage of BinaryBA* where the clients vote again
     * for the block hash.
     * 
     * @param {Number} round - the current round number.
     * @param {String} r - the block hash from stage-2 of BinaryBA*.
     * @param {String} hblock - the original block hash from reduction phase.
     * @param {Number} step - the current step for the given round.
     */
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

    /**
     * Counts the votes from the second stage of BinaryBA*.
     * Sets the block hash to empty hash for the next stage or votes three times 
     * before exiting.
     * 
     * @param {Number} round - the current round number.
     * @param {Number} step - the current step for the given round.
     * @param {Number} T - the sortition threshold for the current step.
     * @param {Number} tau - committee size for the given step to declare majority.
     * @param {String} hblock - the original block hash from reduction phase.
     * @param {Number} lambda - the time clients should wait to receive all votes before counting.
     */
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

    /**
     * Clients vote in the third stage of BinaryBA* for the 
     * hash realised from the second stage. 
     * 
     * @param {Number} round - the current round number.
     * @param {String} r - the hash from the second stage of BinaryBA*.
     * @param {String} hblock - the original block hash from reduction phase.
     * @param {Number} step - the current step for the given round. 
     */
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

    /**
     * Count votes in the third stage of BinaryBA*.
     * Reset the block hash for the next stage based on the 
     * common coin algorithm. If step has reached MAXSTEPS,
     * client hangs forever.
     * 
     * @param {Number} round - the current round number.
     * @param {Number} step - the current step for the given round.
     * @param {Number} T - the sortition threshold for the current step.
     * @param {Number} tau - committee size for the given step to declare majority.
     * @param {String} hblock - the original block hash from reduction phase.
     * @param {Number} lambda - the time clients should wait to receive all votes before counting.
     */
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

    /**
     * Implements the CommonCoin algorithm in the original
     * paper. Finds the minimum block hash and returns its LSB.
     * 
     * @param {Number} round - the current round number.
     * @param {Number} step - the current step for the given round.
     * @param {Number} tau - committee size for the given step to declare majority.
     * 
     * @returns {Number} - the least significant bit of the minimum hash.
     */
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

    /**
     * The main method for deciding consensus - tentative or final.
     * Counts votes for the FINAL step and decides to publish a block
     * or an empty block.
     * 
     * @param {Number} round - the current round number.
     */
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

    /**
     * Implements the voting logic used by clients in all 
     * the stages and steps of the BA consensus protocol. 
     * Sortition is used to determine if the client is
     * selected as the committee member to vote. If else, 
     * client broadcasts a vote.
     * 
     * @param {Number} round - the current round number.
     * @param {Number} step - the current step for the given round.
     * @param {Number} tau - committee size for the given step to declare majority.
     * @param {String} value - the block hash for which the vote is being cast.
     */
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

    /**
     * Verifies all the receives votes from the network.
     * Also detects fork where the last block is not same as the
     * current client and throws an error.
     * 
     * @param {Number} tau - committee size for the given step to declare majority.
     * @param {Object} m - the vote broadcast by the committee members. 
     * 
     * @returns {Array} - the winning tokens, the sortition hash and the block hash.
     */
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

    /**
     * The main method which counts the votes received for
     * a hash value in a given step and round number. Either 
     * results into a TIMEOUT if no value has a clear majority 
     * else returns that block hash.
     * 
     * @param {Number} round - the current round number.
     * @param {Number} step - the current step for the given round.
     * @param {Number} T - the sortition threshold for the current step.
     * @param {Number} tau - committee size for the given step to declare majority.
     * @param {Number} lambda - the time clients should wait to receive all votes before counting.
     * 
     * @returns {String} - either TIMEOUT or the block hash that has the majority.
     */
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

    /**
     * Stores the votes for a given step and round number in a 
     * message buffer, incomingMsgs.
     * 
     * @param {Object} vote - the vote object received from the network.
     */
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

    /**
     * Adds an empty block to the blockchain.
     */
    addEmptyBlock() {
        this.log("Adding empty block!");
        this.currentBlock.rewardAddr = null;
        this.currentBlock.seed = SGUtils.hash(Array.from(this.net.clients.keys()).join());
        this.timeouts.push(
            setTimeout(() => this.receiveBlock(this.currentBlock),
                0
            ));
    }

    /**
     * The block proposer announces their block in case a 
     * final or tentative consensus is reached. They calculate the 
     * seed for the next round too.
     */
    announceBlock() {
        this.log("Announcing block!");
        let [newSeed, _] = utils.calcNewSeed(this.keyPair.getPrivate(), this.lastBlock.seed, this.currentBlock.chainLength);
        this.currentBlock.seed = Buffer.from(newSeed).toString('hex');
        this.timeouts.push(setTimeout(() => {
            this.net.broadcast(StakeBlockchain.ANNOUNCE_BLOCK, this.currentBlock);
        }, 3000));
    }

    /**
     * Receives the block from the proposer and verifies it 
     * and adds to the blockchain. If it's a final block, all
     * previous tentative blocks are finalised.
     * 
     * @param {Block} block - the block received from the proposer.
     */
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

    /**
     * Initiate request to terminate all clients who are working.
     * Broadcasts a termination request.
     */
    endAll() {
        this.log('Initiating Termination.');
        this.net.broadcast(StakeBlockchain.TERMINATE_PROPOSAL, {});
    }

    /**
     * The termination request clears all timeouts for all
     * clients making them stop.
     */
    terminateProposal() {
        this.log('Received Termination Request.');
        for (const timeoutId of this.timeouts) {
            clearTimeout(timeoutId);
        }
        this.timeouts.shift();
        return;
    }

    /**
     * Custom logger for the clients which also prints 
     * their name.
     * 
     * @param {String} msg - the message string to be logged.
     */
    log(msg) {
        let name = this.name || this.address.substring(0, 10);

        console.log(`[ ${name} ] ${msg}`);
    }
}