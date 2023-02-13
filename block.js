"use strict";

const { Block, utils } = require("spartan-gold");

module.exports = class StakeBlock extends Block {

    constructor(rewardAddr, prevBlock, seed) {

        super(rewardAddr, prevBlock);

        if (prevBlock && prevBlock.winner) {
            // Add the previous block's rewards to the miner who published the block.
            let winnerBalance = this.balanceOf(prevBlock.winner) || 0;
            this.balances.set(prevBlock.winner, winnerBalance + prevBlock.totalRewards());
        }

        this.genesisBlockHash = prevBlock ? prevBlock.genesisBlockHash : this.hashVal();
        this.winner = '';
        this.seed = seed;
    }

    toJSON() {
        let o = {
            chainLength: this.chainLength,
            timestamp: this.timestamp,
        };
        if (this.isGenesisBlock()) {
            // The genesis block does not contain a proof or transactions,
            // but is the only block than can specify balances.
            o.balances = Array.from(this.balances.entries());
        } else {
            // Other blocks must specify transactions and proof details.
            o.transactions = Array.from(this.transactions.entries());
            o.prevBlockHash = this.prevBlockHash;
            o.proof = this.proof;
            o.rewardAddr = this.rewardAddr;
            o.winner = this.winner;
            o.genesisBlockHash = this.genesisBlockHash;
        }
        return o;
    }

    serialize() {
        return JSON.stringify(this);
    }

    /**
     * Returns the cryptographic hash of the current block.
     * The block is first converted to its serial form, so
     * any unimportant fields are ignored.
     * 
     * @returns {String} - cryptographic hash of the block.
     */
    hashVal() {
        return utils.hash(this.serialize());
    }

    /**
     * Gets the available gold of a user identified by an address.
     * Note that this amount is a snapshot in time - IF the block is
     * accepted by the network, ignoring any pending transactions,
     * this is the amount of funds available to the client.
     * 
     * @param {String} addr - Address of a client.
     * 
     * @returns {Number} - The available gold for the specified user.
     */
    balanceOf(addr) {
        return this.balances.get(addr) || 0;
    }

    /**
     * The total amount of gold paid to the miner who produced this block,
     * if the block is accepted.  This includes both the coinbase transaction
     * and any transaction fees.
     * 
     * @returns {Number} Total reward in gold for the user.
     * 
     */
    totalRewards() {
        return this.coinbaseReward;
    }
}
