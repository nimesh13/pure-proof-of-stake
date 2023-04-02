"use strict";

let StakeClient = require('./client');

module.exports = class StakeByzantineClient extends StakeClient {

    countVotes(round, step, T, tau, lambda) {
        console.log('BYZANTINE OVERRIDEN FUNCTION REACHED!!');
        process.exit(0);
    }
}