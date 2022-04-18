const EC = require("./node_modules/elliptic/lib/elliptic").ec, ec = new EC("secp256k1");

const keyPair = ec.genKeyPair();

console.log("Public key:", keyPair.getPublic("hex"));
console.log("Private key:", keyPair.getPrivate("hex"));