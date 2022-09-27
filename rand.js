"use strict"

let crypto =  require('crypto');

// CRYPTO settings
const HASH_ALG = 'sha256';
const SIG_ALG = 'RSA-SHA256';

const BigInteger = require('jsbn').BigInteger;

exports.getWeightedRandom = function getWeightedRandom(lastConfirmedBlock) {

    let coinbalances = lastConfirmedBlock.balances;
    let genesisBlockHash = lastConfirmedBlock.genesisBlockHash;
    let chainLength = lastConfirmedBlock.chainLength.toString();
    let weights = Array.from(coinbalances.values());

    weights.sort().reverse();
    let arr = [];
    let total = 0;
    for (const weight of weights) {
        total += weight;
        arr.push(total);
    }

    let target = getRandomInt(genesisBlockHash, chainLength, arr[arr.length - 1]);
    let left = 0;
    let right = weights.length;

    while (left < right) {
        const mid = Math.floor(left + (right - left) / 2);
        if (target > arr[mid])
            left = mid + 1;
        else
            right = mid;
    }

    for (const [key, value] of coinbalances) {
        if (value === weights[left])
            return key;
    }

    return null;
}

function getRandomInt(genesisHash, chainLength, maxRange) {

    const digest = crypto.createHash(HASH_ALG).update(genesisHash + chainLength).digest('hex');
    const dividend = new BigInteger(digest, 16)
    const divisor = new BigInteger(maxRange.toString(), 10)

    return dividend.remainder(divisor).intValue()
}