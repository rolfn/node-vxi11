/*
  Rolf Niepraschk, Rolf.Niepraschk@gmx.de, 2014-04-30
*/

var net = require('net');
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

var LAST_RECORD = 0x80000000;
var XID_OFFS = 4;
var LINK_ID_OFFS = 32;
var PORT_OFFS = 28;
var LEN_OFFS = 36;
var DATA_OFFS = LEN_OFFS + 4;

function inspectBuffer(clink, str, buf) {
  if (str) clink.logger.log(str + ' [%d]: %s',
    buf.length, buf.inspect());
}

function getBuffer(clink, str, arr, addBuf) {
  var buf = new Buffer(arr.length*4);
  for (var i=1; i<arr.length; i++) {
    buf.writeUInt32BE(arr[i], i*4, true);
  }
  if (addBuf) buf = Buffer.concat([buf, addBuf]);
  buf.writeUInt32BE(LAST_RECORD + buf.length - 4, 0, true);
  inspectBuffer(clink, str, buf);
  return buf;
}

function getAlignedBuffer(str) {
  var l =  str.length;
  var len = l % 4 ? l + 4 - l % 4 : l;// multiple of 4 Bytes
  var buf = new Buffer(len);
  buf.fill(0);
  new Buffer(str, 'ascii').copy(buf);
  return buf;
}

function getNewXID() {// 32bit unsigned
  return (Date.now() & 0x0ffffffff) >>> 0;
}

function vxiCloseDevice(clink, clbk) {
  var socket = clink.socket;

  socket.on('end', function() {
    clink.logger.log('disconnected (port: %d)', clink.port);
    if (typeof clbk == 'function') clbk();
  });

  socket.once('data', function(data) {
    inspectBuffer(clink, 'DESTROY_LINK reply', data);
    var xid = data.readUInt32BE(XID_OFFS);// TODO: XID check!
    clink.logger.log('XID (call):%d   XID (reply):%d', clink.xid, xid);
    clink.socket.end();
  });

  clink.xid = getNewXID();
  var a = [];
  a.push(0,clink.xid,CALL,RPC_VERSION,DEVICE_CORE_PROG,DEVICE_CORE_VERS,
    DESTROY_LINK,0,0,0,0);// Credentials, Verfifier
  a.push(clink.linkId);
  socket.write(getBuffer(clink, 'DESTROY_LINK call', a));
}

function vxiReceive(clink, clbk) {
  var socket = clink.socket;

  socket.once('data', function(data) {
    clink.logger.log('clink: ' + util.inspect(clink, {depth:0}));
    inspectBuffer(clink, 'DEVICE_READ reply', data);
    var xid = data.readUInt32BE(XID_OFFS);// TODO: XID check!
    clink.logger.log('XID (call):%d   XID (reply):%d', clink.xid, xid);
    var len =  data.readInt32BE(LEN_OFFS);
    var str = data.toString('ascii', DATA_OFFS, DATA_OFFS + len);
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
  socket.write(getBuffer(clink, 'DEVICE_READ call', a));
}

function vxiSend(clink, clbk) {

  var socket = clink.socket = net.connect(clink.port, clink.host);
  clink.socket.setNoDelay(true);

  socket.once('data', function(data) {
    inspectBuffer(clink, 'CREATE_LINK reply', data);
    var xid = data.readUInt32BE(XID_OFFS);// TODO: XID check!
    clink.logger.log('XID (call):%d   XID (reply):%d', clink.xid, xid);
    clink.linkId = data.readUInt32BE(LINK_ID_OFFS);

    socket.once('data', function(data) {
      inspectBuffer(clink, 'DEVICE_WRITE reply', data);
      var xid = data.readUInt32BE(XID_OFFS);// TODO: XID check!
      clink.logger.log('XID (call):%d   XID (reply):%d', clink.xid, xid);
      if (typeof clbk == 'function') clbk(clink);
    });

    clink.xid = getNewXID();
    var a = [];
    a.push(0,clink.xid,CALL,RPC_VERSION,DEVICE_CORE_PROG,DEVICE_CORE_VERS,
      DEVICE_WRITE,0,0,0,0);// Credentials, Verfifier
    a.push(clink.linkId,clink.ioTimeout,clink.lockTimeout,END_FLAG,
      clink.command.length);
    socket.write(getBuffer(clink, 'DEVICE_WRITE call', a,
      getAlignedBuffer(clink.command)));
  });

  socket.on('connect', function() {
    clink.logger.log('connected (port: %d)', clink.port);

    clink.xid = getNewXID();
    var a = [];
    a.push(0,clink.xid,CALL,RPC_VERSION,DEVICE_CORE_PROG,DEVICE_CORE_VERS,
      CREATE_LINK,0,0,0,0,0);// Credentials, Verfifier, client ID
    a.push(clink.lockDevice ? 1 : 0,clink.lockTimeout,clink.device.length);
    socket.write(getBuffer(clink, 'CREATE_LINK call', a,
      getAlignedBuffer(clink.device)));
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

  var socket = net.connect(PMAP_PORT, clink.host);
  socket.setNoDelay(true);

  socket.on('end', function() {
    clink.logger.log('disconnected (port: %d)', PMAP_PORT);
    if (typeof clbk == 'function') clbk(clink);
  });

  socket.once('data', function(data) {
    inspectBuffer(clink, 'GETPORT reply', data);
    var xid = data.readUInt32BE(XID_OFFS);// TODO: XID check!
    clink.logger.log('XID (call):%d   XID (reply):%d', clink.xid, xid);

    clink.port = data.readUInt32BE(PORT_OFFS);
    socket.end();
  });

  socket.on('connect', function() {
    clink.logger.log('connected (port: %d)', PMAP_PORT);

    clink.xid = getNewXID();
    var a = [];
    a.push(0,clink.xid,CALL,RPC_VERSION,PMAP_PROG,PMAP_VERS,PMAPPROC_GETPORT,
      0,0,0,0);// Credentials, Verfifier
    a.push(DEVICE_CORE_PROG,DEVICE_CORE_VERS,IPPROTO_TCP,0);
    socket.write(getBuffer(clink, 'GETPORT call', a));
  });
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


