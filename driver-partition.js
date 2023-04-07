"use strict";

let { Transaction, FakeNet } = require('spartan-gold');
let StakeClient = require('./client');
let StakeBlock = require('./block');
let StakeBlockchain = require('./blockchain');

console.log("Starting simulation.  This may take a moment...");

let fakeNet1 = new FakeNet();
let fakeNet2 = new FakeNet();

// Clients
let alice = new StakeClient({ name: "Alice", net: fakeNet1, identity: 1 });
let bob = new StakeClient({ name: "Bob", net: fakeNet1, identity: 2 });
let charlie = new StakeClient({ name: "Charlie", net: fakeNet1, identity: 3 });

// Byzantine Client
let mickie = new StakeClient({ name: "Mickie", net: fakeNet2, identity: 4 });
let minnie = new StakeClient({ name: "Minnie", net: fakeNet2, identity: 5 });
let trudy = new StakeClient({ name: "Trudy", net: fakeNet2, identity: 6 });

let genesisSeed = "########## THIS IS GENESIS BLOCK SEED FOR CS298 ##########";

// Creating genesis block
let genesis = StakeBlockchain.makeGenesis({
    blockClass: StakeBlock,
    transactionClass: Transaction,
    clientBalanceMap: new Map([
        [alice, 15],
        [bob, 10],
        [charlie, 20],
        [mickie, 10],
        [minnie, 20],
        [trudy, 30],
    ]),
    seed: genesisSeed,
});

function showBalances(client) {
    console.log(`Alice has ${client.lastBlock.balanceOf(alice.address)} gold.`);
    console.log(`Bob has ${client.lastBlock.balanceOf(bob.address)} gold.`);
    console.log(`Charlie has ${client.lastBlock.balanceOf(charlie.address)} gold.`);
    console.log(`Minnie has ${client.lastBlock.balanceOf(minnie.address)} gold.`);
    console.log(`Mickie has ${client.lastBlock.balanceOf(mickie.address)} gold.`);
    console.log(`Trudy has ${client.lastBlock.balanceOf(trudy.address)} gold.`);
}

// Showing the initial balances from Alice's perspective, for no particular reason.
// console.log("Initial balances:");
// showBalances(alice);

async function startAllClients() {
    fakeNet1.register(alice, bob, charlie);
    let clientArray = [alice, bob, charlie];

    console.log('Starting clients set - 1');
    showBalances(alice);
    return initClientsWithInterval(clientArray, alice, 15000, 2)
        .then(() => {
            console.log('Starting clients set - 2');
            showBalances(alice);
            stopClients([alice, bob, charlie]);
            fakeNet2.register(minnie, mickie, trudy);
            let clientArray = [minnie, mickie, trudy];
            return initClientsWithInterval(clientArray, trudy, 15000, 2);
        })
        .then(() => {
            console.log('Starting all the clients together.');
            showBalances(alice);
            stopClients([minnie, mickie, trudy]);
            fakeNet1.register(minnie, mickie, trudy);
            fakeNet2.register(alice, bob, charlie);
            let clientArray = [alice, bob, charlie, minnie, mickie, trudy];
            return initClientsWithInterval(clientArray, minnie, 30000, 0);
        })
        .then(() => {
            process.exit(0);
        })
        .catch(e => {
            console.log('Error: ', e);
        });
}

function initClients(clients, stop) {
    clients.forEach(client => {
        client.initialize(stop);
    });
}

function stopClients(clients) {
    clients.forEach(client => {
        client.terminateProposal();
    })
}

function initClientsWithInterval(clients, client, time, stop) {
    return new Promise((resolve) => {
        setTimeout(() => {
            return resolve();
        }, time);
        initClients(clients, stop);
    });
}

startAllClients();
