"use strict";

let { Blockchain } = require('spartan-gold');

const ELECT_LEADER = 'ELECT_LEADER';

module.exports = class StakeBlockchain extends Blockchain {
    static get ELECT_LEADER() { return ELECT_LEADER; }
}