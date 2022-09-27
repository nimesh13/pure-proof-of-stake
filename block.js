"use strict";

const { Block, utils } = require("spartan-gold");

module.exports = class StakeBlock extends Block {

    constructor(address, prevBlock) {
        super(address, prevBlock);

        this.genesisBlockHash = this.genesisBlockHash ?? this.prevBlockHash;
        this.leader = ''
    }
}
