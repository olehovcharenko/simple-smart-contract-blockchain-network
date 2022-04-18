# simple-smart-contract-blockchain-network
Simple smart contact blockhain training project

How to start 

1. Install all packages: npm install;
2.If you haven't had your keys, goto terminal and type node keygen, it will generate key;
3.If you want start a node, open the terminal, configure it first:
 set PORT=Your port;
 set PEERS=Address 1, Address 2, Address 3;
 set MY_ADDRES=ws://your.ip.and:port;
 set PRIVATE_KEY=your key;
 set ENABLE_MINING=true;

node .

4. You can mine block: mine();
5. You can broadcast a transaction: sendTransaction(yourTransaction);
6. You can request for a chain and chain's info with function: requestChain();
7. You can set up a node that mines continously: loopMine(optional_delay_time);
8. You can manually connect to a node: connect("address");
