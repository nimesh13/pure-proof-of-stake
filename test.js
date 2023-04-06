"use strict";

let EventEmitter = require('events');

class Test extends EventEmitter {

    constructor(name) {
        super();

        this.on('end', this.terminate);
        this.name = name;
        this.timeouts = [];
    }

    start() {
        this.timeouts.shift();
        console.log(this.name, 'Started')
        this.timeouts.push(setTimeout(() => this.A(), 4000));
    }

    A() {
        this.timeouts.shift();
        console.log(this.name, 'Started A')
        this.timeouts.push(setTimeout(() => this.B(), 14000));
    }

    B() {
        this.timeouts.shift();
        console.log(this.name, 'Started B')
        this.timeouts.push(setTimeout(() => this.C(), 4000));
    }

    C() {
        this.timeouts.shift();
        console.log(this.name, 'Started C')
        this.timeouts.push(setTimeout(() => this.start(), 4000));
    }

    end() {
        console.log(this.name, 'Terminate request')
        this.emit('end');
    }

    terminate() {
        console.log(this.name, 'Terminate request received');
        for (const timeoutId of this.timeouts) {
            clearTimeout(timeoutId);
        }
        return;
    }

}

let A = new Test('A');
let B = new Test('B');
let C = new Test('C');

async function startAll() {
    return startTask(A, 15000)
        .then(() => {
            A.end();
            return startTask(B, 15000);
        })
        .then(() => {
            B.end();
            return startTask(C, 15000);
        })
        .then(() => {
            process.exit(0);
        })
        .catch(e => {
            console.log(e);
        })
}

function startTask(task, time) {
    return new Promise((resolve) => {
        setTimeout(() => {
            return resolve();
        }, time);
        task.start();
    });
}

startAll();
