"use strict";

const { Block, utils } = require("spartan-gold");

module.exports = class StakeBlock extends Block {

    constructor(address, prevBlock) {
        super(address, prevBlock);

        this.prevBlockHash = prevBlock ? prevBlock.hashVal() : null;

        this.leader = ''
    }
}
