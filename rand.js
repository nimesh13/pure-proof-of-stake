"use strict"

exports.getWeightedRandom = function getWeightedRandom(coinbalances) {
    let weights = Array.from(coinbalances.values());

    weights.sort().reverse();
    let arr = [];
    let total = 0;
    for (const weight of weights) {
        total += weight;
        arr.push(total);
    }

    let target = getRandomInt(arr[arr.length - 1]);
    let left = 0;
    let right = weights.length;

    while (left < right) {
        const mid = Math.floor(left + (right - left) / 2);
        if (target > arr[mid])
            left = mid + 1;
        else
            right = mid;
    }

    console.log(arr[left]);
    for (const [key, value] of coinbalances) {
        if (value === weights[left])
            return key;
    }

    return null;
}

function getRandomInt(max) {
    return Math.floor(Math.random() * max);
}