/*
  Rolf Niepraschk, Rolf.Niepraschk@gmx.de, 2014-04-28
*/

var net = require('net');
var dgram = require('dgram');
var util = require('util');
require('buffer').INSPECT_MAX_BYTES = 500;

var VXI11_READ_TIMEOUT = 2000;  /* ms */
var VXI11_IO_TIMEOUT = 10000;   /* ms */
var VXI11_LOCK_TIMEOUT = 10000; /* ms */

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

function getBuffer(arr) {
  var buf = new Buffer(arr.length*4);
  for (var i=0; i<arr.length; i++) {
    buf.writeUInt32BE(arr[i], i*4, true);
  }
  return buf;
}

function getNewXID() {// 32bit unsigned
  return (Date.now() & 0x0ffffffff) >>> 0;
}

function vxiCloseDevice(clink, clbk) {
  var client = clink.socket;

  client.on('end', function(data) {
    clink.logger.log('client disconnected');
    if (typeof clbk == 'function') clbk();
  });

  client.once('data', function(data) {
    clink.logger.log('DESTROY_LINK reply [%d]: %s', data.length, util.inspect(data));
    var newXid = data.readUInt32BE(4);// TODO: XID check!
    clink.logger.log('call Xid:%d     reply Xid:%d', clink.xid, newXid);
    clink.socket.end();
  });

  clink.xid = getNewXID();
  var a = [];
  a.push(0,clink.xid,CALL,RPC_VERSION,DEVICE_CORE_PROG,DEVICE_CORE_VERS,
    DESTROY_LINK,0,0,0,0);// Credentials, Verfifier
  a.push(clink.linkId);
  var buf = getBuffer(a);
  buf.writeUInt32BE(LAST_RECORD + buf.length - 4, 0, true);

  clink.logger.log('DESTROY_LINK call [%d]: %s', buf.length, buf.inspect());
  client.write(buf);
}

function vxiReceive(clink, clbk) {
  var client = clink.socket;

  client.once('data', function(data) {
    clink.logger.log('clink: ' + util.inspect(clink, {depth:0}));
    clink.logger.log('DEVICE_READ reply [%d]: %s', data.length, util.inspect(data));
    var newXid = data.readUInt32BE(4);// TODO: XID check!
    clink.logger.log('call Xid:%d     reply Xid:%d', clink.xid, newXid);
    var len =  data.readInt32BE(36);
    var str = data.toString('ascii', 40, 40 + len);
    clink.logger.log('data length: ' + len);
    if (typeof clbk == 'function') clbk(clink, str);
  });

  clink.xid = getNewXID();
  var a = [];
  a.push(0,clink.xid,CALL,RPC_VERSION,DEVICE_CORE_PROG,DEVICE_CORE_VERS,
    DEVICE_READ,0,0,0,0);// Credentials, Verfifier
  a.push(clink.linkId,REQUEST_SIZE,clink.readTimeout,clink.readTimeout,
    clink.termChar ? 128 : 0);// Flags:
  // Bit0: Wait until locked -- Bit3: Set EOI -- Bit7: Termination character set
  a.push(clink.termChar);
  var buf = getBuffer(a);
  buf.writeUInt32BE(LAST_RECORD + buf.length - 4, 0, true);

  clink.logger.log('DEVICE_READ call [%d]: %s', buf.length, buf.inspect());

  client.write(buf);
}

function vxiSend(clink, clbk) {

  var client = clink.socket = net.connect(clink.port, clink.host);
  clink.socket.setNoDelay(true);

  client.once('data', function(data) {
    clink.logger.log('CREATE_LINK reply [%d]: %s', data.length, util.inspect(data));
    var newXid = data.readUInt32BE(4);// TODO: XID check!
    clink.logger.log('call Xid:%d     reply Xid:%d', clink.xid, newXid);
    clink.linkId = data.readUInt32BE(32);
    var mLength = clink.command.length + (4 - (clink.command.length % 4));
    // multiple of 4 Byte
    var tmpbuf = new Buffer(mLength);
    tmpbuf.fill(0);
    new Buffer(clink.command, 'ascii').copy(tmpbuf);

    clink.xid = getNewXID();
    var a = [];
    a.push(0,clink.xid,CALL,RPC_VERSION,DEVICE_CORE_PROG,DEVICE_CORE_VERS,
      DEVICE_WRITE,0,0,0,0);// Credentials, Verfifier
    a.push(clink.linkId,clink.ioTimeout,clink.lockTimeout,END_FLAG,
      clink.command.length);
    var buf = Buffer.concat([getBuffer(a), tmpbuf]);
    buf.writeUInt32BE(LAST_RECORD + buf.length - 4, 0, true);
    clink.logger.log('DEVICE_WRITE call [%d]: %s', buf.length, buf.inspect());

    client.once('data', function(data) {
      clink.logger.log('DEVICE_WRITE reply [%d]: %s', data.length, util.inspect(data));
      var newXid = data.readUInt32BE(4);// TODO: XID check!
      clink.logger.log('call Xid:%d     reply Xid:%d', clink.xid, newXid);
      if (typeof clbk == 'function') clbk(clink);
    });

    client.write(buf);
  });

  client.on('connect', function() {
    clink.logger.log('client connected');

    clink.xid = getNewXID();

    var a = [];
    a.push(0,clink.xid,CALL,RPC_VERSION,DEVICE_CORE_PROG,DEVICE_CORE_VERS,
      CREATE_LINK,0,0,0,0,0);// Credentials, Verfifier, client ID
    a.push(clink.lockDevice ? 1 : 0,clink.lockTimeout,clink.device.length);
    var buf = Buffer.concat([getBuffer(a), new Buffer(clink.device, 'ascii')]);
    buf.writeUInt32BE(LAST_RECORD + buf.length - 4, 0, true);
    clink.logger.log('CREATE_LINK call [%d]: %s', buf.length, buf.inspect());
    client.write(buf);
  });
}

vxiOpenDevice = function (clink, clbk) {

  if (!clink.readTimeout) clink.readTimeout = VXI11_READ_TIMEOUT;
  if (!clink.ioTimeout) clink.ioTimeout = VXI11_IO_TIMEOUT;
  if (!clink.lockTimeout) clink.lockTimeout = VXI11_LOCK_TIMEOUT;
  if (!clink.logger) clink.logger =  { log: function(){}, error: function(){} };
  if (typeof clink.lockDevice !== 'boolean') clink.lockDevice = true;
  if (!clink.termChar) clink.termChar = 0;
  if (typeof clink.termChar == 'string')
    clink.termChar = clink.termChar.charCodeAt();

  var socket = dgram.createSocket('udp4');

  socket.on('listening', function () {
    var a = socket.address();
    clink.logger.log('udp socket listening: %s:%d', a.address, a.port);
  });

  socket.on('close', function () {
    clink.logger.log('udp socket closed');
  });

  socket.on('message', function (data, rinfo) {
    clink.logger.log('GETPORT reply [%d]: %s', data.length, util.inspect(data));

    var newXid = data.readUInt32BE(0);// TODO: XID check!
    clink.logger.log('call Xid:%d     reply Xid:%d', clink.xid, newXid);

    clink.port = data.readUInt32BE(PORT_OFFS);

    socket.close();

    if (typeof clbk == 'function') clbk(clink);
  });

  clink.xid = getNewXID();

  var a = [];
  a.push(clink.xid,CALL,RPC_VERSION,PMAP_PROG,PMAP_VERS,PMAPPROC_GETPORT,
    0,0,0,0);// Credentials, Verfifier
  a.push(DEVICE_CORE_PROG,DEVICE_CORE_VERS,IPPROTO_TCP,0);

  var buf = getBuffer(a);
  clink.logger.log('GETPORT call [%d]: %s', buf.length, buf.inspect());
  socket.send(buf, 0, buf.length, PMAP_PORT, clink.host);
}

function vxiTransceiver(p1, p2, p3, p4) {
  var clink, clbk;

  if (typeof p1 == 'object') {
    clink = p1;
    clbk = p2;
  } else {
    clink = { host:p1, device:p2, command:p3 };
    clbk = p4;
  }

  vxiOpenDevice(clink, function(clink) {
    vxiSend(clink, function(clink) {
      vxiReceive(clink, function(clink, result) {
        if (typeof clbk == 'function') clbk(result);
        vxiCloseDevice(clink);
      });
    });
  });
}

exports.vxiOpenDevice = vxiOpenDevice;
exports.vxiSend = vxiSend;
exports.vxiReceive = vxiReceive;
exports.vxiCloseDevice = vxiCloseDevice;
exports.vxiTransceiver = vxiTransceiver;


