"use strict";

let StakeClient = require('./client');
let StakeBlockchain = require('./blockchain');

module.exports = class StakeByzantineClient extends StakeClient {

    reductionOne(round, hblock) {

        console.log(this.name, "Reduction step!!!!");
        // console.log(this.name, 'WInning hash is: ', hblock)
        for (const bhash of Object.keys(this.proposals)) {
            // console.log(this.name, 'Hash: ', bhash);
            // if (bhash !== hblock) {
            // console.log(this.name, 'Voting for: ', bhash);
            this.committeeVote(
                round,
                "REDUCTION_ONE",
                StakeBlockchain.CommitteeSize,
                bhash
            );
            // break;
            // }

        }

        setTimeout(() => {
            this.countReduceOne(
                round,
                "REDUCTION_ONE",
                0.685,
                StakeBlockchain.CommitteeSize,
                3 + 2,
            );
        }, 6000);
    }

    reductionTwo(round, step, tau, hblock1) {
        let emptyHash = " THIS IS EMPTY HASH!!!!";
        if (hblock1 == "TIMEOUT") {
            this.committeeVote(
                round,
                step,
                tau,
                emptyHash
            );
        } else {
            for (const bhash of Object.keys(this.proposals)) {
                this.committeeVote(
                    round,
                    step,
                    tau,
                    bhash
                );
            }

        }

        setTimeout(() => {
            this.countReduceTwo(
                round,
                "REDUCTION_TWO",
                0.685,
                StakeBlockchain.CommitteeSize,
                3 + 2,
            );
        }, 6000);
    }

    // countVotes(round, step, T, tau, lambda) {
    //     console.log('BYZANTINE OVERRIDEN FUNCTION REACHED!!');
    //     process.exit(0);
    // }
}