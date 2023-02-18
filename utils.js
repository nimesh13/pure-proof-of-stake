"use strict"

const { Evaluate, ProofHoHash } = require('@idena/vrf-js');
const BigInteger = require('jsbn').BigInteger;
let crypto = require('crypto');
const elliptic = require('elliptic');
const EC = new elliptic.ec('secp256k1');

// CRYPTO settings
const HASH_ALG = 'sha256';

exports.getHighestPriorityToken = function HighestPriorityToken(
    privateKey,
    seed,
    tau,
    role,
    w,
    W,
) {

    const [hash, proof] = Evaluate(privateKey.toArray(), seed + role);

    const [j, maxPriorityToken] = sortition(
        hash,
        tau,
        W,
        w
    );

    return [hash, proof, j, maxPriorityToken];
}

exports.verifySort = function VerifySort(obj) {

    try {
        const index = ProofHoHash(obj.publicKey, obj.data, obj.proof);
    } catch (e) { return [-1, null]; }

    const [j, maxPriorityToken] = sortition(
        obj.hash,
        obj.tau,
        obj.W,
        obj.w,
    );

    return [j, maxPriorityToken];
}

function sortition(hash, tau, W, w) {

    let normalisedHash = normaliseHash(hash);

    const p = tau / W;
    let j = 0;
    let lb = 0;
    while (j <= w) {
        let ub = accB(w, j, p);
        if (normalisedHash >= lb && normalisedHash < ub) break;
        j += 1;
        lb = ub;
    }

    if (j == 0) return [0, null];

    let maxPriorityToken = new BigInteger("-1");
    for (const i in j) {
        let tokenHash = crypto.createHash(HASH_ALG).update(hash + i).digest('hex');
        let tokenNumber = new BigInteger(tokenHash, 16);
        if (tokenNumber > maxPriorityToken)
            maxPriorityToken = tokenNumber;
    }

    return [j, maxPriorityToken];
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

    let combination = binomialCoeff(w, k);
    let ans = combination * Math.pow(p, k) * Math.pow(1 - p, w - k);
    return ans;
}

function binomialCoeff(n, r) {
    if (r > n)
        return 0
    if (r == 0 || r == n)
        return 1

    // Recursive Call
    return binomialCoeff(n - 1, r - 1) + binomialCoeff(n - 1, r)
}

exports.sign = function (privKey, msg) {
    let keypairTemp = EC.keyFromPrivate(privKey);
    let str = (msg === Object(msg)) ? JSON.stringify(msg) : "" + msg;
    const buffferMsg = Buffer.from(str);
    return Buffer.from(keypairTemp.sign(buffferMsg).toDER()).toString('hex')
};

exports.verifySignature = function (pubKey, msg, sig) {
    let key = EC.keyFromPublic(pubKey, 'hex');
    let str = (msg === Object(msg)) ? JSON.stringify(msg) : "" + msg;
    let binaryMessage = Buffer.from(str);
    return key.verify(binaryMessage, sig);
};