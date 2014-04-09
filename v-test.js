#!/usr/bin/env node

/*
  Rolf Niepraschk, Rolf.Niepraschk@ptb.de, 2014-04-08
*/

var net = require('net');
var dgram = require("dgram");
var util = require('util');

var HOST = '172.30.56.65';
var DEVICE = 'gpib0,10';
var INITIAL_PORT = 111;

var crypto = require('crypto');

/*

http://blog.tompawlak.org/2013/12/how-to-generate-random-values-nodejs-javascript.html

function randomValueHex (len) {
    return crypto.randomBytes(Math.ceil(len/2))
        .toString('hex') // convert to hexadecimal format
        .slice(0,len);   // return required number of characters
}

var value1 = randomValueHex(12) // value 'd5be8583137b'
var value2 = randomValueHex(2)  // value 'd9'
var value3 = randomValueHex(7)  // value 'ad0fc8c'
*/

// open device

var client = net.connect(INITIAL_PORT, HOST);

client.on('data', function(data) {
  console.log('client data: ' + data.toString());
  client.end();
});

client.on('end', function() {
  console.log('client disconnected');
});

client.on('error', function(e) {
  console.log('error: ' + e);
});

client.on('connect', function() {
  console.log('client connected');
  udp = dgram.createSocket("udp4");

  udp.on('listening', function () {
    var a = udp.address();
    console.log('udp socket listening: '  + a.address + ' :'  + a.port);
  });

  udp.on('close', function () {
    console.log('udp socket closed');
  });

  udp.on('message', function (msg, rinfo) {
    console.log('udp socket message: ' + (typeof msg));
    console.log('udp socket message: ' + msg.length);
    console.log('udp socket message: ' + util.inspect(msg));
    console.log('udp socket rinfo: ' + util.inspect(rinfo));
    var ip = rinfo.address;
    var port1 = rinfo.port;
    var port2 = msg.readUInt32BE(msg.length-4);
    console.log('port1: ' + port1 + '    port2: ' + port2 + '    ip: ' + ip);

    udp.close();
    client.end();
  });

  ///var buf2 = new Buffer(XID_rand.xid_gen());
  //getport sende buffer---------------------------------------------------------
  var buf = new Buffer(56);           //Sende Buffer anlegen
  //buf2.copy(buf,0,0,4);               //xid Copy aus Zufallszahl
  ///buf.writeUInt32BE(0x303b6352, 0);       // provisorisch
  crypto.randomBytes(4).copy(buf,0,0,4); // ???
  buf.writeUInt32BE(0x00000000, 4);   //MessageTyp festlegen
  buf.writeUInt32BE(0x00000002, 8);   //RPC Version festlegen
  buf.writeUInt32BE(0x000186a0, 12);  //Programm Portmap festlegen
  buf.writeUInt32BE(0x00000002, 16);  //Program Version festlegen
  buf.writeUInt32BE(0x00000003, 20);  //GETPort 3
  buf.writeUInt32BE(0x00000000, 24);  //Credentials
  buf.writeUInt32BE(0x00000000, 28);  //Credentials
  buf.writeUInt32BE(0x00000000, 32);  //Verfifier
  buf.writeUInt32BE(0x00000000, 36);  //Verfifier
  buf.writeUInt32BE(0x000607af, 40);  //Portmap Getportcall/Program Unknow
  buf.writeUInt32BE(0x00000001, 44);  //Portmap Getportcall Version
  buf.writeUInt32BE(0x00000006, 48);  //Portmap Getport TCP
  buf.writeUInt32BE(0x00000000, 52);  //Portmap Getpor Port
  //getport sende buffer---------------------------------------------------------
  udp.send(buf, 0, buf.length, INITIAL_PORT, HOST, function(err, bytes) {
    if (err) {
      console.log('udp socket send error: ' +  err);
    } else {
      console.log('udp socket sended: ' +  bytes);
    }
  });

});





