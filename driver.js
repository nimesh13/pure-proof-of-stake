"use strict";

let { BlockChain, Transaction, FakeNet } = require('spartan-gold');
let StakeClient = require('./client');
let StakeBlock = require('./block');
let StakeBlockchain = require('./blockchain')

console.log("Starting simulation.  This may take a moment...");

let fakeNet = new FakeNet();

// Clients
let alice = new StakeClient({ name: "Alice", net: fakeNet });
let bob = new StakeClient({ name: "Bob", net: fakeNet });
let charlie = new StakeClient({ name: "Charlie", net: fakeNet });

let clientArray = [alice, bob, charlie];

let genesisSeed = "########## THIS IS GENESIS BLOCK SEED FOR CS298 ##########";

// Creating genesis block
let genesis = StakeBlockchain.makeGenesis({
    blockClass: StakeBlock,
    transactionClass: Transaction,
    clientBalanceMap: new Map([
        [alice, 233],
        [bob, 99],
        [charlie, 67],
    ]),
    seed: genesisSeed,
});

function showBalances(client) {
    console.log(`Alice has ${client.lastBlock.balanceOf(alice.address)} gold.`);
    console.log(`Bob has ${client.lastBlock.balanceOf(bob.address)} gold.`);
    console.log(`Charlie has ${client.lastBlock.balanceOf(charlie.address)} gold.`);
}

// Showing the initial balances from Alice's perspective, for no particular reason.
console.log("Initial balances:");
showBalances(alice);

fakeNet.register(alice, bob, charlie);

clientArray.forEach(client => {
    client.initialize();
});

// Print out the final balances after it has been running for some time.
setTimeout(() => {
    console.log();
    showBalances(alice);

    process.exit(0);
}, 15000);