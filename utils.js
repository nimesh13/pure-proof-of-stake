"use strict"

const { Evaluate, ProofHoHash } = require('@idena/vrf-js');
const { hash } = require('spartan-gold/utils');
const BigInteger = require('jsbn').BigInteger;
let crypto = require('crypto');

// CRYPTO settings
const HASH_ALG = 'sha256';

const SortitionThreshold = 2;

exports.getHighestPriorityToken = function getHighestPriorityToken(
    lastConfirmedBlock,
    keyPair,
    balance) {

    let coinbalances = lastConfirmedBlock.balances;
    // let genesisBlockHash = lastConfirmedBlock.genesisBlockHash;
    // let chainLength = lastConfirmedBlock.chainLength.toString();

    let weights = Array.from(coinbalances.values());
    let arr = [];
    let total = 0;
    for (const weight of weights) {
        total += weight;
        arr.push(total);
    }

    const [hash, proof, j] = sortition(keyPair, total, balance);
    if (j == 0) return null;

    let maxPriorityToken = new BigInteger("-1");

    for (const i in j) {
        let tokenHash = crypto.createHash(HASH_ALG).update(hash + i).digest('hex');
        let tokenNumber = new BigInteger(tokenHash, 16);
        if (tokenNumber > maxPriorityToken)
            maxPriorityToken = tokenNumber;
    }

    return [hash, proof, j, maxPriorityToken];

}

function sortition(keyPair, W, w) {

    var data = "hello";

    const [hash, proof] = Evaluate(keyPair.private, data);
    let normalisedHash = normaliseHash(hash)

    // let genesisBlockHash = lastConfirmedBlock.genesisBlockHash;
    // let chainLength = lastConfirmedBlock.chainLength.toString();

    const p = SortitionThreshold / W;

    let j = 0;
    let lb = 0;
    while (j <= w) {
        let ub = accB(w, j, p);
        if (normalisedHash >= lb && normalisedHash < ub) break;
        j += 1;
        lb = ub;
    }

    return [hash, proof, j];
}

function normaliseHash(hash) {
    const hashInHex = Buffer.from(hash).toString('hex');

    const dividend = new BigInteger(hashInHex, 16);
    const divisor = new BigInteger("2").pow(hash.length * 8);

    return dividend / divisor;
}

function accB(w, j, p) {
    let sum = 0;
    for (let k = 0; k <= j; k++) {
        sum += binomial(k, w, p);
    }
    return sum;
}

function binomial(k, w, p) {

    // let combination = factorial(w) / (factorial(k) * factorial(w - k));
    let combination = binomialCoeff(w, k);
    let ans = combination * Math.pow(p, k) * Math.pow(1 - p, w - k);
    return ans;
}

function probability(k, tau) {
    let sum = 0;
    for (let i = 1; i <= k; i++) {
        sum = sum + Math.pow(tau, k) * Math.pow(Math.E, -tau) / factorial(k)
    }

    return sum;
}

function factorial(n) {
    let fact = 1;
    for (let i = 1; i <= n; i++) {
        fact *= i;
    }

    return fact;
}

function binomialCoeff(n, r) {
    if (r > n)
        return 0
    if (r == 0 || r == n)
        return 1

    // Recursive Call
    return binomialCoeff(n - 1, r - 1) + binomialCoeff(n - 1, r)
}