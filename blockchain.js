"use strict";

let { Blockchain } = require('spartan-gold');

const PROPOSE_BLOCK = 'PROPOSE_BLOCK';
const ANNOUNCE_BLOCK = 'ANNOUNCE_BLOCK';
const ANNOUNCE_PROOF = 'ANNOUNCE_PROOF';
const COMMITTEE_VOTE = 'COMMITTEE_VOTE';
const GOSSIP_VOTE = 'GOSSIP_VOTE';
const SortitionThreshold = 2;

module.exports = class StakeBlockchain extends Blockchain {
    static get PROPOSE_BLOCK() { return PROPOSE_BLOCK; }
    static get ANNOUNCE_BLOCK() { return ANNOUNCE_BLOCK; }
    static get ANNOUNCE_PROOF() { return ANNOUNCE_PROOF; }
    static get CONFIRMED_DEPTH() { return Blockchain.cfg.confirmedDepth; }
    static get COMMITTEE_VOTE() { return COMMITTEE_VOTE; }
    static get GOSSIP_VOTE() { return GOSSIP_VOTE; }
    static get SortitionThreshold() { return SortitionThreshold; }

    static makeGenesis(...args) {
        let g = super.makeGenesis(...args);
        g.seed = args[0]["seed"];
        return g;
    }

    static makeBlock(...args) {
        return new StakeBlockchain.cfg.blockClass(...args);
    }

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
            b.winner = o.winner;
            b.genesisBlockHash = o.genesisBlockHash;
            b.seed = o.seed;
            // Likewise, transactions need to be recreated and restored in a map.
            b.transactions = new Map();
            if (o.transactions) o.transactions.forEach(([txID, txJson]) => {
                let tx = new StakeBlockchain.cfg.transactionClass(txJson);
                b.transactions.set(txID, tx);
            });
        }

        return b;
    }
}