/*
  Rolf Niepraschk, Rolf.Niepraschk@gmx.de, 2014-05-12
*/

var net = require('net');
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

var ERROR_OFFS = 28;
var LEN_OFFS = 36;
var DATA_OFFS = LEN_OFFS + 4;

var messages = {};
messages[PMAPPROC_GETPORT] = 'GETPORT';
messages[CREATE_LINK] = 'CREATE_LINK';
messages[DEVICE_WRITE] = 'DEVICE_WRITE';
messages[DEVICE_READ] = 'DEVICE_READ';
messages[DESTROY_LINK] = 'DESTROY_LINK';

function inspectBuffer(clink, str, buf) {
  clink.logger.log(str + ' [%d]: %s', buf.length, buf.inspect());
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

function getPort(buf) {
  return buf.length >= PORT_OFFS + 3 ? buf.readUInt32BE(PORT_OFFS) : -1;
}

function rpc(clink, procedure, clbk) {
  var as = [], ab = [], d, b, buf;
  var socket = clink.socket;
  clink.xid = getNewXID();
  switch (procedure) {
    case PMAPPROC_GETPORT:
      as.push(0,clink.xid,CALL,RPC_VERSION,PMAP_PROG,PMAP_VERS,procedure,
        0,0,0,0, // credentials, verifier
      DEVICE_CORE_PROG,DEVICE_CORE_VERS,IPPROTO_TCP,0);
      break;
    case CREATE_LINK:
    case DEVICE_WRITE:
    case DEVICE_READ:
    case DESTROY_LINK:
      as.push(0,clink.xid,CALL,RPC_VERSION,DEVICE_CORE_PROG,DEVICE_CORE_VERS,
        procedure,0,0,0,0); // credentials, verifier
      break;
    default:
      clink.logger.error('unknown procedure');
      if (typeof clbk == 'function') clbk(clink, null, 1);
  }
  as = as.concat([].slice.call(arguments, 3));// add all the variable arguments
  for(var i=0; i<as.length; i++) {
    d = as[i];
    if (typeof d == 'number') {
      b = new Buffer(4);
      b.writeUInt32BE(d, 0, true);
      ab.push(b);
    } else if (typeof d == 'string') ab.push(getAlignedBuffer(d));
  }
  buf = Buffer.concat(ab);
  buf.writeUInt32BE(LAST_RECORD + buf.length - 4, 0, true);
  inspectBuffer(clink, messages[procedure] + ' call', buf);

  socket.once('data', function(data) {
    inspectBuffer(clink, messages[procedure] + ' reply', data);
    var xid = data.readUInt32BE(XID_OFFS);
    clink.logger.log('XID[call]: %d      XID[reply]: %d', clink.xid, xid);
    error = data.readInt32BE(ERROR_OFFS);
    if (typeof clbk == 'function') clbk(clink, data, error);
  });

  socket.write(buf);
}

function vxiDestroyLink(clink, clbk) {
  var socket = clink.socket;
  socket.on('end', function() {
    clink.logger.log('disconnected (port: %d)', clink.port);
    if (typeof clbk == 'function') clbk(clink);
  });
  rpc(clink, DESTROY_LINK, function (clink, data, error) {
      clink.error = '';
      if (error) {
        clink.error = messages[DESTROY_LINK] + ' (error: ' + error + ')';
        clink.logger.error(clink.error);
      }
      clink.socket.end();
    }, clink.linkID);
}

function vxiDeviceRead(clink, clbk) {
  var socket = clink.socket;
  rpc(clink, DEVICE_READ, function (clink, data, error) {
      clink.error = '';
      if (error) {
        clink.error = messages[DEVICE_READ] + ' (error: ' + error + ')';
        clink.logger.error(clink.error);
      } else {
        var len = data.readInt32BE(LEN_OFFS);
        clink.result = data.toString('ascii', DATA_OFFS, DATA_OFFS + len);
      }
      if (typeof clbk == 'function') clbk(clink);
    }, clink.linkID, REQUEST_SIZE, clink.readTimeout, clink.readTimeout,
    clink.termChar ? 128 : 0, // Flags:
    // Bit0: Wait until locked, Bit3: Set EOI, Bit7: Termination character set
    clink.termChar);
}

function vxiDeviceWrite(clink, clbk) {
  var socket = clink.socket;
  rpc(clink, DEVICE_WRITE, function (clink, data, error) {
      clink.error = '';
      if (error) {
        clink.error = messages[DEVICE_WRITE] + ' (error: ' + error + ')';
        clink.logger.error(clink.error);
      }
      if (typeof clbk == 'function') clbk(clink);
    }, clink.linkID, clink.ioTimeout, clink.lockTimeout, END_FLAG,
    clink.command.length, clink.command);
}

function vxiCreateLink(clink, clbk) {
  var socket = clink.socket = net.connect(clink.port, clink.host);
  socket.setNoDelay(true);
  socket.on('error', function(e) {
    clink.error = e.toString();
    clink.logger.error(clink.error);
    if (typeof clbk == 'function') clbk(clink);
  });
  socket.on('connect', function() {
    clink.logger.log('connected (port: %d)', clink.port);
    rpc(clink, CREATE_LINK, function (clink, data, error) {
        clink.error = '';
        if (error) {
          clink.error = messages[CREATE_LINK] + ' (error: ' + error + ')';
          clink.logger.error(clink.error);
        } else {
          clink.linkID = data.readUInt32BE(LINK_ID_OFFS);
        }
        if (typeof clbk == 'function') clbk(clink);
      }, 0, clink.lockDevice ? 1 : 0, clink.lockTimeout, clink.device.length,
      clink.device);
  });
}

function vxiGetPort(clink, clbk) {
  if (typeof clink.readTimeout != 'number') clink.readTimeout = VXI11_READ_TIMEOUT;
  if (typeof clink.ioTimeout != 'number') clink.ioTimeout = VXI11_IO_TIMEOUT;
  if (typeof clink.lockTimeout != 'number') clink.lockTimeout = VXI11_LOCK_TIMEOUT;
  if (!clink.logger) clink.logger =  { log:function(){}, error:function(){} };
  if (typeof clink.lockDevice != 'boolean') clink.lockDevice = true;
  if (!clink.termChar) clink.termChar = 0;
  if (typeof clink.termChar == 'string') clink.termChar = clink.termChar.charCodeAt();

  var socket = clink.socket = net.connect(PMAP_PORT, clink.host);
  socket.setNoDelay(true);

  socket.on('end', function() {
    clink.logger.log('disconnected (port: %d)', PMAP_PORT);
    if (typeof clbk == 'function') clbk(clink);
  });

  socket.on('error', function(e) {
    clink.error = e.toString();
    clink.logger.error(clink.error);
    if (typeof clbk == 'function') clbk(clink);
  });

  socket.on('connect', function() {
    clink.logger.log('connected (port: %d)', PMAP_PORT);
      rpc(clink, PMAPPROC_GETPORT, function (clink, data) {
        clink.port = getPort(data);
        clink.error = '';
        if (clink.port == -1) {
          clink.error = messages[PMAPPROC_GETPORT] + ' error';
          clink.logger.error(clink.error);
        }
        clink.socket.end();
      });
  });
}

function vxiTransceiver(p1, p2, p3, p4, p5) {
  var clink, ready, error;

  if (typeof p1 == 'object') {
    clink = p1;
    ready = p2;
    error = p3;
  } else {
    clink = { host:p1, device:p2, command:p3 };
    ready = p4;
    error = p5;
  }

  function _error(clink) {
    try {
      clink.socket.end();
    } catch(e) {}
    if (typeof error == 'function') error(clink.error);
  }

  vxiGetPort(clink, function(clink) {
    if (clink.error) _error(clink);
    else {
      vxiCreateLink(clink, function(clink) {
        if (clink.error) _error(clink);
        else {
          vxiDeviceWrite(clink, function(clink) {
            if (clink.error) _error(clink);
            else {
              vxiDeviceRead(clink, function(clink) {
                if (clink.error) _error(clink);
                else {
                  vxiDestroyLink(clink, function(clink) {
                    if (clink.error) _error(clink);
                    else if (typeof ready == 'function') ready(clink.result);
                  });
                }
              });
            }
          });
        }
      });
    }
  });

}

exports.vxiGetPort = vxiGetPort;
exports.vxiCreateLink = vxiCreateLink;
exports.vxiDeviceWrite = vxiDeviceWrite;
exports.vxiDeviceRead = vxiDeviceRead;
exports.vxiDestroyLink = vxiDestroyLink;
exports.vxiTransceiver = vxiTransceiver;

