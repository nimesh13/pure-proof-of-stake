"use strict";

let { Blockchain } = require('spartan-gold');

const PROPOSE_BLOCK = 'PROPOSE_BLOCK';
const ANNOUNCE_BLOCK = 'ANNOUNCE_BLOCK';
const ANNOUNCE_PROOF = 'ANNOUNCE_PROOF';
const COMMITTEE_VOTE = 'COMMITTEE_VOTE';
const GOSSIP_VOTE = 'GOSSIP_VOTE';
const TERMINATE_PROPOSAL = 'TERMINATE_PROPOSAL';

const SORTITION_THRESHOLD = 2;
const SORTITION_THRESHOLD_STEP = 0.685;
const SORTITION_THRESHOLD_FINAL = 0.74;

const REDUCTION_ONE = 'REDUCTION_ONE';
const REDUCTION_TWO = 'REDUCTION_TWO';

const FINAL_CONSENSUS = 'FINAL';
const TENATIVE_CONSENSUS = 'TENTATIVE';
const TIMEOUT = 'TIMEOUT';

const CommitteeSize = 2;

module.exports = class StakeBlockchain extends Blockchain {
    static get PROPOSE_BLOCK() { return PROPOSE_BLOCK; }
    static get ANNOUNCE_BLOCK() { return ANNOUNCE_BLOCK; }
    static get ANNOUNCE_PROOF() { return ANNOUNCE_PROOF; }
    static get CONFIRMED_DEPTH() { return Blockchain.cfg.confirmedDepth; }
    static get COMMITTEE_VOTE() { return COMMITTEE_VOTE; }
    static get GOSSIP_VOTE() { return GOSSIP_VOTE; }
    static get TERMINATE_PROPOSAL() { return TERMINATE_PROPOSAL; }

    static get REDUCTION_ONE() { return REDUCTION_ONE; }
    static get REDUCTION_TWO() { return REDUCTION_TWO; }

    static get SORTITION_THRESHOLD() { return SORTITION_THRESHOLD; }
    static get SORTITION_THRESHOLD_STEP() { return SORTITION_THRESHOLD_STEP; }
    static get SORTITION_THRESHOLD_FINAL() { return SORTITION_THRESHOLD_FINAL; }
    static get CommitteeSize() { return CommitteeSize; }

    static get FINAL_CONSENSUS() { return FINAL_CONSENSUS; }
    static get TENATIVE_CONSENSUS() { return TENATIVE_CONSENSUS; }
    static get TIMEOUT() { return TIMEOUT; }

    /**
     * Extends the base class to produce a genesis block 
     * and inserts the seed into it. 
     * 
     * @param  {...any} args - stores the seed in the block.
     * 
     * @returns {Block} - The genesis block.
     */
    static makeGenesis(...args) {
        let g = super.makeGenesis(...args);
        g.seed = args[0]["seed"];
        return g;
    }

    static makeBlock(...args) {
        return new StakeBlockchain.cfg.blockClass(...args);
    }

    /**
     * Converts a string representation of a block to a new Block instance.
     * 
     * @param {Object} o - An object representing a block, but not necessarily an instance of Block.
     * 
     * @returns {Block}
     */
    static deserializeBlock(o) {
        if (o instanceof StakeBlockchain.cfg.blockClass) {
            return o;
        }

        let b = new StakeBlockchain.cfg.blockClass();
        b.chainLength = parseInt(o.chainLength, 10);
        b.timestamp = o.timestamp;

        if (b.isGenesisBlock()) {
            // Balances need to be recreated and restored in a map.
            o.balances.forEach(([clientID, amount]) => {
                b.balances.set(clientID, amount);
            });
        } else {
            b.prevBlockHash = o.prevBlockHash;
            b.proof = o.proof;
            b.rewardAddr = o.rewardAddr;
            b.genesisBlockHash = o.genesisBlockHash;
            b.winner = o.winner;
            b.seed = o.seed;
            b.blockhash = o.blockhash;
            b.blockMaxToken = o.blockMaxToken;
            b.blockWinners = o.blockWinners;
            b.blockProof = o.blockProof;
            b.blockStatus = o.blockStatus;
        }

        return b;
    }
}