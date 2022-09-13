"use strict";

let { Client } = require('spartan-gold');
let StakeBlockchain = require('./blockchain.js');
let { getWeightedRandom } = require('./rand');

let identityCount = 0;

module.exports = class StakeClient extends Client {

    constructor(...args) {
        super(...args);

        this.identity = identityCount;
        identityCount += 1;

        this.on(StakeBlockchain.ELECT_LEADER, this.electLeader);
    }

    /**
    * Starts listeners and begins mining.
    */
    initialize() {
        this.currentBlock = StakeBlockchain.makeBlock(this.address, this.lastConfirmedBlock);
        setTimeout(() => this.emit(StakeBlockchain.ELECT_LEADER), 1000);
    }

    electLeader() {
        // TODO - random pick with weight
        // coinbase reward
        
        const winner = getWeightedRandom(this.lastConfirmedBlock.balances);
        console.log('Winner:', test);
        
    }
}