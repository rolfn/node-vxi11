/*
  Rolf Niepraschk, Rolf.Niepraschk@gmx.de, 2014-04-25
*/

var net = require('net');
var dgram = require('dgram');
var util = require('util');
var crypto = require('crypto');
var buffer = require('buffer');
buffer.INSPECT_MAX_BYTES = 500;

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

function vxiCloseDevice(clink, clbk) {
  var client = clink.socket;

  client.on('end', function(data) {
    clink.logger.log('client disconnected');
    if (typeof clbk == 'function') clbk();
  });

  client.once('data', function(data) {
    clink.logger.log('DESTROY_LINK reply [%d]: %s', data.length, util.inspect(data));
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
  buf.writeUInt32BE(0, 28);// credentials
  buf.writeUInt32BE(0, 32);// credentials
  buf.writeUInt32BE(0, 36);// verifier
  buf.writeUInt32BE(0, 40);// verifier
  buf.writeUInt32BE(clink.linkId, 44);

  clink.logger.log('DESTROY_LINK call [%d]: %s', buf.length, util.inspect(buf));
  client.write(buf);
}

function vxiReceive(clink, clbk) {
  var client = clink.socket;
  clink.xid = crypto.randomBytes(4);

  client.once('data', function(data) {
    clink.logger.log('clink: ' + util.inspect(clink, {depth:0}));
    var oldXid = clink.xid.readUInt32BE(0);// TODO: XID check!
    var newXid = data.readUInt32BE(4);
    clink.logger.log('DEVICE_READ reply [%d]: %s', data.length, util.inspect(data));
    var len =  data.readInt32BE(36);
    var str = data.toString('ascii', 40, 40 + len);
    clink.logger.log('data length: ' + len);
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
  buf.writeUInt32BE(0, 28); // credentials
  buf.writeUInt32BE(0, 32); // credentials
  buf.writeUInt32BE(0, 36); // verifier
  buf.writeUInt32BE(0, 40); // verifier
  buf.writeUInt32BE(clink.linkId, 44);
  buf.writeUInt32BE(REQUEST_SIZE, 48);
  buf.writeUInt32BE(clink.readTimeout, 52);
  buf.writeUInt32BE(clink.readTimeout, 56);
  buf.writeUInt32BE(clink.terminationChar ? 128 : 0, 60); // Flags:
  // Bit0: Wait until locked -- Bit3: Set EOI -- Bit7: Termination character set
  buf.writeUInt32BE(clink.terminationChar, 64); // termination character

  clink.logger.log('DEVICE_READ call [%d]: %s', buf.length, util.inspect(buf));

  client.write(buf);
}

function vxiSend(clink, clbk) {

  var client = clink.socket = net.connect(clink.port, clink.host);
  clink.socket.setNoDelay(true);

  client.once('data', function(data) {
    clink.logger.log('CREATE_LINK reply [%d]: %s', data.length, util.inspect(data));
    var oldXid = clink.xid.readUInt32BE(0);// TODO: XID check!
    var newXid = data.readUInt32BE(4);
    clink.linkId = data.readUInt32BE(32);
    var mLength = clink.command.length + (4 - (clink.command.length % 4));
    // multiple of 4 Byte
    var tmpbuf = new Buffer(mLength);
    tmpbuf.fill(0);
    clink.xid = crypto.randomBytes(4);
    new Buffer(clink.command, 'ascii').copy(tmpbuf);
    var buf = new Buffer(64 + mLength);
    buf.writeUInt32BE(LAST_RECORD + buf.length - 4, 0);
    clink.xid.copy(buf, 4);
    buf.writeUInt32BE(CALL, 8);
    buf.writeUInt32BE(RPC_VERSION, 12);
    buf.writeUInt32BE(DEVICE_CORE_PROG, 16);
    buf.writeUInt32BE(DEVICE_CORE_VERS, 20);
    buf.writeUInt32BE(DEVICE_WRITE, 24);
    buf.writeUInt32BE(0, 28); //credentials
    buf.writeUInt32BE(0, 32); //credentials
    buf.writeUInt32BE(0, 36); //verifier
    buf.writeUInt32BE(0, 40); //verifier
    buf.writeUInt32BE(clink.linkId, 44);
    buf.writeUInt32BE(clink.ioTimeout, 48);
    buf.writeUInt32BE(clink.lockTimeout, 52);
    buf.writeUInt32BE(END_FLAG, 56);
    buf.writeUInt32BE(clink.command.length, 60);
    tmpbuf.copy(buf,64);

    clink.logger.log('DEVICE_WRITE call [%d]: %s', buf.length, util.inspect(buf));

    client.once('data', function(data) {
      clink.logger.log('DEVICE_WRITE reply [%d]: %s', data.length, util.inspect(data));
      var oldXid = clink.xid.readUInt32BE(0);
      var newXid = data.readUInt32BE(4);
      if (typeof clbk == 'function') clbk(clink);
    });

    client.write(buf);
  });

  client.on('connect', function() {
    clink.logger.log('client connected');

    clink.xid = crypto.randomBytes(4);
    var buf = new Buffer (68);

    buf.writeUInt32BE(LAST_RECORD + buf.length - 4, 0);
    clink.xid.copy(buf, 4);
    buf.writeUInt32BE(CALL, 8);
    buf.writeUInt32BE(RPC_VERSION, 12);
    buf.writeUInt32BE(DEVICE_CORE_PROG, 16);
    buf.writeUInt32BE(DEVICE_CORE_VERS, 20);
    buf.writeUInt32BE(CREATE_LINK, 24);
    buf.writeUInt32BE(0, 28); // credentials
    buf.writeUInt32BE(0, 32); // credentials
    buf.writeUInt32BE(0, 36); // verifier
    buf.writeUInt32BE(0, 40); // verifier
    buf.writeUInt32BE(0, 44); // client ID
    buf.writeUInt32BE(clink.lockDevice ? 1 : 0, 48);
    buf.writeUInt32BE(clink.lockTimeout, 52);
    buf.writeUInt32BE(clink.device.length, 56);
    new Buffer(clink.device, 'ascii').copy(buf, 60);
    clink.logger.log('CREATE_LINK call [%d]: %s', buf.length, util.inspect(buf));
    client.write(buf);
  });
}

vxiOpenDevice = function (clink, clbk) {

  if (!clink.readTimeout) clink.readTimeout = VXI11_READ_TIMEOUT;
  if (!clink.ioTimeout) clink.ioTimeout = VXI11_IO_TIMEOUT;
  if (!clink.lockTimeout) clink.lockTimeout = VXI11_LOCK_TIMEOUT;
  if (!clink.logger) clink.logger =  { log: function(){}, error: function(){} };
  if (typeof clink.lockDevice !== 'boolean') clink.lockDevice = true;
  if (!clink.terminationChar) clink.terminationChar = 0;
  if (typeof clink.terminationChar == 'string')
    clink.terminationChar = clink.terminationChar.charCodeAt();

  var socket = dgram.createSocket('udp4');

  clink.xid = crypto.randomBytes(4);

  var buf = new Buffer(56);
  clink.xid.copy(buf, 0);
  buf.writeUInt32BE(CALL, 4);
  buf.writeUInt32BE(RPC_VERSION, 8);
  buf.writeUInt32BE(PMAP_PROG,  12);
  buf.writeUInt32BE(PMAP_VERS,  16);
  buf.writeUInt32BE(PMAPPROC_GETPORT, 20);
  buf.writeUInt32BE(0, 24); //Credentials
  buf.writeUInt32BE(0, 28); //Credentials
  buf.writeUInt32BE(0, 32); //Verfifier
  buf.writeUInt32BE(0, 36); //Verfifier
  buf.writeUInt32BE(DEVICE_CORE_PROG, 40);
  buf.writeUInt32BE(DEVICE_CORE_VERS, 44);
  buf.writeUInt32BE(IPPROTO_TCP, 48);
  buf.writeUInt32BE(0, 52); // Port

  socket.on('listening', function () {
    var a = socket.address();
    clink.logger.log('udp socket listening: %s:%d', a.address, a.port);
  });

  socket.on('close', function () {
    clink.logger.log('udp socket closed');
  });

  socket.on('message', function (data, rinfo) {
    clink.logger.log('GETPORT reply [%d]: %s', data.length, util.inspect(data));

    var oldXid = clink.xid.readUInt32BE(0);// TODO: XID check!
    var newXid = data.readUInt32BE(0);

    clink.port = data.readUInt32BE(PORT_OFFS);

    socket.close();

    if (typeof clbk == 'function') clbk(clink);
  });

  clink.logger.log('GETPORT call [%d]: %s', buf.length, util.inspect(buf));
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
        vxiCloseDevice(clink, function() {
          if (typeof clbk == 'function') clbk(result);
        });
      });
    });
  });
}

exports.vxiOpenDevice = vxiOpenDevice;
exports.vxiSend = vxiSend;
exports.vxiReceive = vxiReceive;
exports.vxiCloseDevice = vxiCloseDevice;
exports.vxiTransceiver = vxiTransceiver;


