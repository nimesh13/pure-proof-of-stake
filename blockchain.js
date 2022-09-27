"use strict";

let { Blockchain } = require('spartan-gold');

const ELECT_WINNER = 'ELECT_WINNER';

module.exports = class StakeBlockchain extends Blockchain {
    static get ELECT_WINNER() { return ELECT_WINNER; }
}