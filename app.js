"use strict"

const crypto = require("crypto"), SHA256 = message => crypto.createHash("sha256").update(message).digest("hex");
const WS = require("./node_modules/ws/index");
const EC = require("./node_modules/elliptic/lib/elliptic").ec, ec = new EC("secp256k1");
const { fork } = require("child_process");
const Block = require("./block");
const Transaction = require("./transaction");
const Blockchain = require("./blockchain");
const zhozscript = require("./zhozscript");

const ZhozyChain = new Blockchain();

const privateKey = process.env.PRIVATE_KEY || ec.genKeyPair().getPrivate("hex");
const keyPair = ec.keyFromPrivate(privateKey, "hex");
const publicKey = keyPair.getPublic("hex");

const MINT_PRIVATE_ADDRESS = "0700a1ad28a20e5b2a517c00242d3e25a88d84bf54dce9e1733e6096e6d6495e";
const MINT_KEY_PAIR = ec.keyFromPrivate(MINT_PRIVATE_ADDRESS, "hex");
const MINT_PUBLIC_ADDRESS = MINT_KEY_PAIR.getPublic("hex");

const PORT = process.env.PORT || 3000;
const PEERS = process.env.PEERS ? process.env.PEERS.split(".") : [];
const MY_ADDRESS = process.env.MY_ADDRESS || "ws://localhost:3000";
const ENABLE_MINING = process.env.ENABLE_MINING === "true" ? true : false;
const server = new WS.Server({port: PORT});

const opened = [];
const connected = [];

let tempChain = new Blockchain();
let worker = fork(`${__dirname}/worker.js`);
let mined = false;

console.log("Listening on PORT", PORT);

server.on("connection", async (socket, req) => {
    socket.on("message", message => {
        const _message = JSON.parse(message);

        switch(_message.type) {
            case "TYPE_REPLACE_CHAIN":
                const [ newBlock, newDiff ] = _message.data;

                const ourTx = [...ZhozyChain.transaction.map(tx => JSON.stringify(tx))];
                const theirTx = [...newBlock.data.filter(tx => tx.from !== MINT_PRIVATE_ADDRESS).map(tx => JSON.stringify(tx))];

                if (newBlock.prevHash !== ZhozyChain.getLastBlock().prevHash) {
                    for (;;) {
                        const index = ourTx.indexOf(theirTx[0]);
                        
                        if (index === -1) break;

                        ourTx.splice(index, 1);
                        theirTx.splice(0, 1);
                    }
                    if (
                        theirTx.length === 0 &&
                        SHA256(ZhozyChain.getLastBlock().hash + newBlock.timestamp + JSON.stringify(newBlock.data) + newBlock.nonce) === newBlock.hash &&
                        newBlock.hash.startWith("0000" + Array(ZhozyChain.difficulty + 1).join("0")) &&
                        Block.hasValidTransactions(newBlock, ZhozyChain) &&
                        (parseInt(newBlock.timestamp) > parseInt(ZhozyChain.getLastBlock().timestamp) || ZhozyChain.getLastBlock().timestamp === "") &&
                        parseInt(newBlock.timestamp) < Date.now() &&
                        ZhozyChain.getLastBlock().hash === newBlock.prevHash &&
                        (newDiff + 1 === ZhozyChain.difficulty || newDiff - 1 === ZhozyChain.difficulty)
                        

                        
                    ){
                        ZhozyChain.chain.push(newBlock);
                        ZhozyChain.difficulty = newDiff;
                        ZhozyChain.transaction = [...ourTx.map(tx => JSON.parse(tx))];

                        changeState(newBlock);

                        triggerContract(newBlock);

                        if (ENABLE_MINING) {
                            mined = true;

                            worker.kill();

                            worker = fork(`${__dirname}/worker.js`);
                        }
                    }
                }
                break;
            
            case "TYPE_CREATE_TRANSACTION":
                const transaction = _message.data;

                ZhozyChain.addTransaction(transaction);

                break;
            
            case "TYPE_REQUEST_CHAIN":
                const socket = opened.find(node => node.address === _message.data).socket;

                for (let i = 1; i < ZhozyChain.chain.length; i++) {
                    socket.send(produceMessage(
                        "TYPE_SEND_CHAIN",
                        {
                            block: ZhozyChain.chain[i],
                            finished: i === ZhozyChain.chain.length - 1
                        }
                    ));
                
        }
        break;

        case "TYPE_SEND_CHAIN":
            const { block, finished } = _message.data;

            if (!finished) {
                tempChain.chain.push(block);
            } else {
                tempChain.chain.push(block);

                if (Blockchain.isValid(tempChain)) {
                    ZhozyChain.chain = tempChain.chain;
                }

                tempChain = new Blockchain();
            }
            break;
        case "TYPE_REQUEST_INFO":
            [   ZhozyChain.difficulty, ZhozyChain.transaction, ZhozyChain.state ] = _message.data;

            break;
        
        case "TYPE_HANDSHAKE":
            connected(_message.data);
        }
    });
})

async function connect(address) {
    if (!connected.find(peerAddress => peerAddress === address) && address !== MY_ADDRESS) {
        const socket = new WS(address);
        socket.on("open", () => {
            [MY_ADDRESS, ...connected].forEach(_address => socket.send(produceMessage("TYPE_HANDSHAKE", _address)));

            opened.forEach(node => node.socket.send(produceMessage("TYPE_HANDSHAKE", address)));

            if (!opened.find(peer => peer.address === address) && address !== MY_ADDRESS) {
                connected.push(address);
            }
        });
        socket.on("close", () => {
            opened.splice(connected.indexOf(address), 1);
            connected.splice(connected.indexOf(address), 1);
        });
    }
}

function produceMessage(type, data) {
    return JSON.stringify({ type, data });
}

function sendMessage(message) {
    opened.forEach(node => node.socket.send(message));
}

function changeState(newBlock) {
    newBlock.data.forEach(tx => {
        if (!ZhozyChain.state[tx.to]) {
            ZhozyChain.state[tx.to] = {
                balance: 0,
                body: "",
                storage: {}
            };
        }
        if (!ZhozyChain.state[tx.from]) {
            ZhozyChain.state[tx.from] = {
                balance: 0,
                body: "",
                storage: {}
            };
        
            if (tx.to.startWith("SC")) {
                ZhozyChain.state[tx.from].body = tx.to;
            }
        }
        ZhozyChain.state[tx.to].balance += tx.amount;
        ZhozyChain.state[tx.from].balance -= tx.amount;
        ZhozyChain.state[tx.from].balance -= tx.gas;
    });


function triggerContract(newBlock) {
    newBlock.data.forEach( tx => {
        if (ZhozyChain.state[tx.to].body && tx.amount >= calculateGasFee(tx.to, tx.args)) {
            try {
                [ZhozyChain.state[tx.to].storage, ZhozyChain.state[tx.to].balance] = zhozscript(
                    ZhozyChain.state[tx.to].body.replace("SC", ""),
                    ZhozyChain.state[tx.to].storage,
                    ZhozyChain.state[tx.to].balance,
                    tx.args,
                    tx.from,
                    { difficulty: ZhozyChain.difficulty, timestamp: ZhozyChain.getLastBlock().timestamp },
                    tx.to,
                    false
                );
            
            } catch (error) {
                console.log("Error at contract", tx.to, error);
            }
        }
    })
}


function calculateGasFee(contract, args, from = publicKey) {
    const originalBalance = 100000000000000;
    const [, balance] = zhozscript(
        ZhozyChain.state[contract].body.replace("SC", ""),
        ZhozyChain.state[contract].storage,
        originalBalance,
        args,
        from,
        { difficulty: ZhozyChain.difficulty, timestamp: ZhozyChain.getLastBlock().timestamp },
        contract,
        true
    );
    return originalBalance - balance;
}

function mine() {
    function mine(block, difficulty) {
        return new Promise((resolve, reject) => {
            worker.addListener("message", message => resolve(message.result));

            worker.send({
                type: "MINE",
                data: [block, difficulty]
            });
        });
    }
    let gas = 0;

    ZhozyChain.transaction.forEach(transaction => {
        gas += transaction.gas;
    });
    const rewardTransaction = new Transaction(MINT_PUBLIC_ADDRESS, publicKey, ZhozyChain.reward + gas);
    rewardTransaction.sign(MINT_KEY_PAIR);

    const block = new Block(Date.now().toString(), [rewardTransaction, ...ZhozyChain.transaction]);
    block.prevHash = ZhozyChain.getLastBlock().hash;
    block.hash = Block.getHash(block);

    mine(block, ZhozyChain.difficulty)
    .then(result => {
        if (!mined) {
            ZhozyChain.chain.push(Object.freeze(result));

            ZhozyChain.difficulty += Date.now() - parseInt(ZhozyChain.getLastBlock().timestamp) < ZhozyChain.blockTime ? 1 :-1;
            
            if (ZhozyChain.difficulty < 1) {
                ZhozyChain.difficulty = 1;
            }

            ZhozyChain.transaction = [];

            changeState(ZhozyChain.getLastBlock());

            sendMessage(produceMessage("TYPE_REPLACE_CHAIN", [
                ZhozyChain.getLastBlock(),
                ZhozyChain.difficulty
            ]));
        } else {
            mined = false;
        }
        worker.kill();
        worker = fork(`${__dirname}/worker.js`);
    })
    .catch(err => console.log(err));
}

function loopMine(time = 1000) {
    let length = ZhozyChain.chain.length;
    let mining = true;

    setInterval(() => {
        if (mining || length !== ZhozyChain.chain.length) {
            mining = false;
            length = ZhozyChain.chain.length;
            mine();
        }

    }, time);
}
function sendTransaction(transaction) {
    sendMessage(produceMessage("TYPE_CREATE_TRANSACTION", transaction));

    ZhozyChain.addTransaction(transaction);
}

function requestChain(address) {
    const socket = opened.find(node => node.address === address).socket;

    socket.send(produceMessage("TYPE_REQUEST_CHAIN", MY_ADDRESS));
    socket.send(produceMessage("TYPE_REQUEST_INFO", MY_ADDRESS));
}
PEERS.forEach(per => connect(peer));

process.on("uncaughtException", err => console.log(err));
}
