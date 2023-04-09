"use strict";

const { Block } = require("spartan-gold");

module.exports = class StakeBlock extends Block {

    constructor(rewardAddr, prevBlock, seed) {

        super(rewardAddr, prevBlock);

        this.genesisBlockHash = prevBlock ? prevBlock.genesisBlockHash : this.hashVal();
        this.seed = seed;
        this.blockhash = null;
        this.blockMaxToken = null;
        this.blockWinners = 0;
        this.blockProof = null;
        this.blockStatus = null;
    }

    serialize() {
        let o = {
            prevBlockHash: this.prevBlockHash,
            rewardAddr: this.rewardAddr,
            seed: this.seed,
            chainLength: this.chainLength,
            genesisBlockHash: this.genesisBlockHash,
            balances: Array.from(this.balances.entries()),
        }

        return JSON.stringify(o);
    }

    getTotalCoins() {
        let total = 0;
        for (const weight of this.balances.values()) {
            total += weight;
        }
        return total;
    }

    getContext(seed) {
        return {
            seed,
            lastBlock: this.prevBlockHash,
            w: this.balances,
            W: this.getTotalCoins(),
        };
    }
}
