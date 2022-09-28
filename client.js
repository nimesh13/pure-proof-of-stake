"use strict";

let { Client } = require('spartan-gold');
let StakeBlockchain = require('./blockchain');
let { getWeightedRandom } = require('./rand');

let identityCount = 0;

module.exports = class StakeClient extends Client {

    constructor(...args) {
        super(...args);

        this.identity = identityCount;
        identityCount += 1;

        this.on(StakeBlockchain.ELECT_WINNER, this.electWinner);
        this.on(StakeBlockchain.ANNOUNCE_BLOCK, this.receiveBlock);
    }

    /**
    * Starts listeners and begins mining.
    */
    initialize() {
        this.currentBlock = StakeBlockchain.makeBlock(this.address, this.lastBlock);
        setTimeout(() => this.emit(StakeBlockchain.ELECT_WINNER), 1000);
    }

    electWinner() {

        this.currentBlock.winner = getWeightedRandom(this.currentBlock);
        if (this.currentBlock.winner === this.address) {
            this.announceProof();
        }
    }

    announceProof() {
        this.net.broadcast(StakeBlockchain.ANNOUNCE_BLOCK, this.currentBlock);
    }

    receiveBlock(block) {

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
}