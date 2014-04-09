#!/usr/bin/env node

/*
  Rolf Niepraschk, Rolf.Niepraschk@ptb.de, 2014-04-09
*/

// XDR = External Data Representation

var net = require('net');
var dgram = require("dgram");
var util = require('util');
var crypto = require('crypto');
var buffer = require('buffer');

var HOST = '172.30.56.65';
var DEVICE = 'gpib0,10';

var CMD = '*IDN?\n';
///var CMD = 'DATA?\n';
var READ_TIMEOUT = 2047;
var VXI11_DEFAULT_TIMEOUT = 10000; /* in ms */
var VXI11_READ_TIMEOUT = 2000; /* in ms */

var RPC_VERSION = 2;

// Device async
var DEVICE_ASYNC_PROG = 0x0607b0;
var DEVICE_ASYNC_VERS = 1;
var DEVICE_ABORT = 1;

// Device intr
var DEVICE_INTR = 0x0607b1;

// Device core
var DEVICE_CORE_PROG = 0x0607af;
var DEVICE_CORE_VERS = 1;
var CREATE_LINK = 10;
var DEVICE_WRITE = 11;
var DEVICE_READ = 12;
var DEVICE_READSTB = 13;
var DEVICE_TRIGGER = 14;
var DEVICE_CLEAR = 15;
var DEVICE_REMOTE = 16;
var DEVICE_LOCAL = 17;
var DEVICE_LOCK = 18;
var DEVICE_UNLOCK = 19;
var DEVICE_ENABLE_SRQ = 20;
var DEVICE_DOCMD = 22;
var DESTROY_LINK = 23;
var CREATE_INTR_CHAN = 25;
var DESTROY_INTR_CHAN = 26;
var DEVICE_INTR_SRQ = 30;

// Program number, version and port number
var PMAP_PROG = 100000;
var PMAP_VERS = 2;
var PMAP_PORT = 111;

// Procedure numbers
var PMAPPROC_NULL = 0;
var PMAPPROC_SET = 1;
var PMAPPROC_UNSET = 2;
var PMAPPROC_GETPORT = 3;
var PMAPPROC_DUMP = 4;
var PMAPPROC_CALLIT = 5;

var IPPROTO_TCP = 6;
var IPPROTO_UDP = 17;

function createClient(clnt, clbk) {

  var socket = dgram.createSocket("udp4");

  var xid = crypto.randomBytes(4);

  var buf = new Buffer(56);
  xid.copy(buf, 0);
  buf.writeUInt32BE(0x00000000, 4);   //MessageTyp festlegen  0=Call
  buf.writeUInt32BE(RPC_VERSION, 8);   //RPC Version festlegen
  buf.writeUInt32BE(PMAP_PROG,  12);  //Programm Portmap festlegen
  buf.writeUInt32BE(PMAP_VERS,  16);  //Program Version festlegen
  buf.writeUInt32BE(PMAPPROC_GETPORT, 20);  //GETPort 3
  buf.writeUInt32BE(0x00000000, 24);  //Credentials
  buf.writeUInt32BE(0x00000000, 28);  //Credentials
  buf.writeUInt32BE(0x00000000, 32);  //Verfifier
  buf.writeUInt32BE(0x00000000, 36);  //Verfifier
  buf.writeUInt32BE(DEVICE_CORE_PROG, 40);  //Portmap Getportcall/Program Unknow
  buf.writeUInt32BE(DEVICE_CORE_VERS, 44);  //Portmap Getportcall Version
  buf.writeUInt32BE(IPPROTO_TCP, 48); //Portmap Getport TCP
  buf.writeUInt32BE(0x00000000, 52);  //Portmap Getpor Port
  // TODO: Alles nachprüfen; auch Benennung.
  console.log('LinkParms: ' + util.inspect(buf));

  socket.on('listening', function () {
    var a = socket.address();
    console.log('udp socket listening: '  + a.address + ' :'  + a.port);
  });

  socket.on('close', function () {
    console.log('udp socket closed');
  });

  socket.on('message', function (msg, rinfo) {
    console.log('udp socket message: ' + util.inspect(msg));
    console.log('udp socket message.length: ' + msg.length);

    var xid1 = xid.readUInt32BE(0);
    var xid2 = msg.readUInt32BE(0);

    console.log('xid1=%s    xid2=%s', xid1, xid2);

    clnt.port = msg.readUInt32BE(24); // Besser von vorn zählen?

    clnt.socket = net.connect(clnt.port, clnt.host);

    socket.close();
    if (typeof clbk == 'function') clbk(clnt);
  });

  socket.send(buf, 0, buf.length, PMAP_PORT, HOST, function(err, bytes) {
    if (err) {
      console.log('udp socket send error: ' +  err);
    } else {
      console.log('udp socket sended: ' +  bytes);
    }
  });

}

function vxiReceive(clbk) {
  if (typeof clbk == 'function') clbk('Fridolin');
}

function vxiSend(clink, str, clbk) {
  var nb;
  if (typeof clbk == 'function') clbk(nb);
}

function vxiCloseDevice(clink, clbk) {
  clink.socket.end();
  if (typeof clbk == 'function') clbk();
}

function vxiOpenDevice(host, device, clbk) {
  var clink = {};
  clink.host = host;
  clink.device = device;
  createClient(clink, clbk);
}

vxiOpenDevice(HOST, DEVICE, function(clink) {
  console.log('clink: ' + util.inspect(clink, { depth: 0 }));
  vxiSend(clink, CMD, function() {
    vxiReceive(function(result) {
      console.log('result: ' +  result);
      vxiCloseDevice(clink);
    });
  });
});


