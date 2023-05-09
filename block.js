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

    /**
     * Converts the block into a string to generate a hash from it.
     * 
     * @returns {String} - the serialized value of the block.
     */
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

    /**
     * Calculates the total amount of coins in the system
     * by adding everyone's balance.
     * 
     * @returns {Number} - the total coins in circulation.
     */
    getTotalCoins() {
        let total = 0;
        for (const weight of this.balances.values()) {
            total += weight;
        }
        return total;
    }

    /**
     * Generates the context ctx required by the clients in
     * different stages of the BA protocol.
     * 
     * @param {String} seed - the seed being used in the current round.
     * 
     * @returns {Object} - the ctx for the stages of BA.
     */
    getContext(seed) {
        return {
            seed,
            lastBlock: this.prevBlockHash,
            w: this.balances,
            W: this.getTotalCoins(),
        };
    }
}
