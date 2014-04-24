#!/usr/bin/env node

/*
  Rolf Niepraschk, Rolf.Niepraschk@ptb.de, 2014-04-24
*/

var net = require('net');
var dgram = require("dgram");
var util = require('util');
var crypto = require('crypto');
var buffer = require('buffer');
buffer.INSPECT_MAX_BYTES = 500;

var HOST = 'e75465';
var DEVICE = 'gpib0,10';

///var CMD = 'DATA?\n';
///var CMD = '*ESR?';
var CMD = '*RST;*OPC?';
var CMD = '*IDN?\n';

var READ_TIMEOUT = 2047;
var VXI11_DEFAULT_TIMEOUT = 10000; /* in ms */
var VXI11_IO_TIMEOUT = 2000; /* in ms */
var VXI11_LOCK_TIMEOUT = 2000; /* in ms */
var REQUEST_SIZE = 1024;
var END_FLAG = 8;

var CALL = 0;
var REPLY = 1;

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

var LAST_RECORD = 0x80000000;

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

var PORT_OFFS = 24;

function vxiOpenDevice(host, device, clbk) {
  var clink = {};
  clink.host = host;
  clink.device = device;

  var socket = dgram.createSocket("udp4");

  clink.xid = crypto.randomBytes(4);

  var buf = new Buffer(56);
  clink.xid.copy(buf, 0);
  buf.writeUInt32BE(CALL, 4);
  buf.writeUInt32BE(RPC_VERSION, 8);
  buf.writeUInt32BE(PMAP_PROG,  12);
  buf.writeUInt32BE(PMAP_VERS,  16);
  buf.writeUInt32BE(PMAPPROC_GETPORT, 20);
  buf.writeUInt32BE(0, 24);  //Credentials
  buf.writeUInt32BE(0, 28);  //Credentials
  buf.writeUInt32BE(0, 32);  //Verfifier
  buf.writeUInt32BE(0, 36);  //Verfifier
  buf.writeUInt32BE(DEVICE_CORE_PROG, 40);
  buf.writeUInt32BE(DEVICE_CORE_VERS, 44);
  buf.writeUInt32BE(IPPROTO_TCP, 48);
  buf.writeUInt32BE(0, 52);  // Port

  socket.on('message', function (data, rinfo) {
    console.log('GETPORT reply');
    console.log('buf[%d]: %s', data.length, util.inspect(data));

    /// TODO: ID-Check!
    var oldXid = clink.xid.readUInt32BE(0);
    var newXid = data.readUInt32BE(0);

    clink.port = data.readUInt32BE(PORT_OFFS);

    socket.close();

    if (typeof clbk == 'function') clbk(clink);
  });

  console.log('GETPORT call');
  console.log('buf[%d]: %s', buf.length, util.inspect(buf));
  socket.send(buf, 0, buf.length, PMAP_PORT, host);
}

function vxiReceive(clink, clbk) {
  var client = clink.socket;
  clink.xid = crypto.randomBytes(4);

  client.once('data', function(data) {
    /// TODO: ID-Check!
    var oldXid = clink.xid.readUInt32BE(0);
    var newXid = data.readUInt32BE(4);
    console.log('DEVICE_READ reply');
    console.log('buf[%d]: %s', data.length, util.inspect(data));
    var len =  data.readInt32BE(36);
    var str = data.toString('ascii', 40, 40 + len);
    console.log('data length: ' + len);
    if (typeof clbk == 'function') clbk(clink, str);
  });

  buf = new Buffer(68);
  buf.writeUInt32BE(LAST_RECORD + buf.length - 4, 0);
  clink.xid.copy(buf, 4);
  buf.writeUInt32BE(CALL, 8);
  buf.writeUInt32BE(RPC_VERSION, 12);
  buf.writeUInt32BE(DEVICE_CORE_PROG, 16);
  buf.writeUInt32BE(DEVICE_CORE_VERS, 20);
  buf.writeUInt32BE(DEVICE_READ, 24);
  buf.writeUInt32BE(0, 28);  // credentials
  buf.writeUInt32BE(0, 32);  // credentials
  buf.writeUInt32BE(0, 36);  // verifier
  buf.writeUInt32BE(0, 40);  // verifier
  buf.writeUInt32BE(clink.link_id, 44);
  buf.writeUInt32BE(REQUEST_SIZE, 48);
  buf.writeUInt32BE(VXI11_IO_TIMEOUT, 52);
  buf.writeUInt32BE(VXI11_LOCK_TIMEOUT, 56);
  buf.writeUInt32BE(0x00000000, 60);  // Flags:
  // Bit0: Wait until locked -- Bit3: Set EOI -- Bit7: Termination character set
  buf.writeUInt32BE(0x00000000, 64);  // termination character

  console.log('DEVICE_READ call');
  console.log('buf[%d]: %s', buf.length, util.inspect(buf));

  client.write(buf);
}

function vxiSend(clink, cmd, clbk) {
  var client = clink.socket = net.connect(clink.port, clink.host);
  clink.socket.setNoDelay(true);

  client.once('data', function(data) {
    console.log('CREATE_LINK reply');
    console.log('buf[%d]: %s', data.length, util.inspect(data));
    /// TODO: ID-Check!
    var oldXid = clink.xid.readUInt32BE(0);
    var newXid = data.readUInt32BE(4);
    clink.link_id = data.readUInt32BE(32);
    var mLength = cmd.length + (4 - (cmd.length % 4)); // multiple 4 Byte
    var tmpbuf = new Buffer(mLength);
    tmpbuf.fill(0);
    clink.xid = crypto.randomBytes(4);
    new Buffer(cmd, 'ascii').copy(tmpbuf);
    var buf = new Buffer(64 + mLength);
    buf.writeUInt32BE(LAST_RECORD + buf.length - 4, 0);
    clink.xid.copy(buf, 4);
    buf.writeUInt32BE(CALL, 8);
    buf.writeUInt32BE(RPC_VERSION, 12);
    buf.writeUInt32BE(DEVICE_CORE_PROG, 16);
    buf.writeUInt32BE(DEVICE_CORE_VERS, 20);
    buf.writeUInt32BE(DEVICE_WRITE, 24);
    buf.writeUInt32BE(0, 28);  //credentials
    buf.writeUInt32BE(0, 32);  //credentials
    buf.writeUInt32BE(0, 36);  //verifier
    buf.writeUInt32BE(0, 40);  //verifier
    buf.writeUInt32BE(clink.link_id, 44);
    buf.writeUInt32BE(VXI11_IO_TIMEOUT, 48);
    buf.writeUInt32BE(VXI11_LOCK_TIMEOUT, 52);
    buf.writeUInt32BE(END_FLAG, 56);
    buf.writeUInt32BE(cmd.length, 60);
    tmpbuf.copy(buf,64);
    console.log('DEVICE_WRITE call');
    console.log('buf[%d]: %s', buf.length, util.inspect(buf));

    client.once('data', function(data) {
      console.log('DEVICE_WRITE reply');
      console.log('buf[%d]: %s', data.length, util.inspect(data));
      var oldXid = clink.xid.readUInt32BE(0);
      var newXid = data.readUInt32BE(4);
      if (typeof clbk == 'function') clbk(clink);
    });

    client.write(buf);
  });

  client.on('connect', function() {
    console.log('client connected');

    clink.xid = crypto.randomBytes(4);
    var buf = new Buffer (68);

    buf.writeUInt32BE(LAST_RECORD + buf.length - 4, 0);
    clink.xid.copy(buf, 4);
    buf.writeUInt32BE(CALL, 8);
    buf.writeUInt32BE(RPC_VERSION, 12);
    buf.writeUInt32BE(DEVICE_CORE_PROG, 16);
    buf.writeUInt32BE(DEVICE_CORE_VERS, 20);
    buf.writeUInt32BE(CREATE_LINK, 24);
    buf.writeUInt32BE(0, 28);//  credentials
    buf.writeUInt32BE(0, 32);//  credentials
    buf.writeUInt32BE(0, 36);//  verifier
    buf.writeUInt32BE(0, 40);//  verifier
    buf.writeUInt32BE(0, 44);//  client ID
    buf.writeUInt32BE(0, 48);//  no lock device
    buf.writeUInt32BE(0, 52);//  lock time out
    buf.writeUInt32BE(DEVICE.length, 56);
    new Buffer(DEVICE, 'ascii').copy(buf, 60, 0, DEVICE.length);
    console.log('CREATE_LINK call');
    console.log('buf[%d]: %s', buf.length, util.inspect(buf));
    client.write(buf);
  });
}

function vxiCloseDevice(clink, clbk) {
  var client = clink.socket;

  client.on('end', function(data) {
    console.log('client disconnected');
    if (typeof clbk == 'function') clbk();
  });

  client.once('data', function(data) {
    console.log('DESTROY_LINK reply');
    console.log('buf[%d]: %s', data.length, util.inspect(data));
    var oldXid = clink.xid.readUInt32BE(0);
    var newXid = data.readUInt32BE(4);
    clink.socket.end();
  });

  clink.xid = crypto.randomBytes(4);
  var buf = new Buffer (48);

  buf.writeUInt32BE(LAST_RECORD + buf.length - 4, 0);
  clink.xid.copy(buf, 4);
  buf.writeUInt32BE(CALL, 8);
  buf.writeUInt32BE(RPC_VERSION, 12);
  buf.writeUInt32BE(DEVICE_CORE_PROG, 16);
  buf.writeUInt32BE(DEVICE_CORE_VERS, 20);
  buf.writeUInt32BE(DESTROY_LINK, 24);
  buf.writeUInt32BE(0, 28);//  credentials
  buf.writeUInt32BE(0, 32);//  credentials
  buf.writeUInt32BE(0, 36);//  verifier
  buf.writeUInt32BE(0, 40);//  verifier
  buf.writeUInt32BE(clink.link_id, 44);

  console.log('DESTROY_LINK call');
  console.log('buf[%d]: %s', buf.length, util.inspect(buf));
  client.write(buf);
}

vxiOpenDevice(HOST, DEVICE, function(clink) {
  vxiSend(clink, CMD, function(clink) {
    vxiReceive(clink, function(clink, result) {
      vxiCloseDevice(clink, function() {
        console.log('result: »' + result + '«');
      });
    });
  });
});


