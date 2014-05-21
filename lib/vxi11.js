/*
  Rolf Niepraschk, Rolf.Niepraschk@gmx.de, 2014-05-21
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
var PROC_OFFS = 24;
var LINK_ID_OFFS = 32;
var PORT_OFFS = 28;

var ERROR_OFFS = 28;
var LEN_OFFS = 36;
var DATA_OFFS = LEN_OFFS + 4;

var pnames = {};
pnames[PMAPPROC_GETPORT] = 'GETPORT';
pnames[CREATE_LINK] = 'CREATE_LINK';
pnames[DEVICE_WRITE] = 'DEVICE_WRITE';
pnames[DEVICE_READ] = 'DEVICE_READ';
pnames[DESTROY_LINK] = 'DESTROY_LINK';

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
  return buf.length >= PORT_OFFS + 4 ? buf.readUInt32BE(PORT_OFFS) : -1;
}

function rpc(clink, clbk) {
  var a = [], b, buf, d;
  var socket = clink.socket;
  for(var i=2; i<arguments.length; i++) {// variable arguments (buffer content)
    d = arguments[i];
    if (typeof d == 'number') {
      b = new Buffer(4);
      b.writeUInt32BE(d, 0, true);
      a.push(b);
    } else if (typeof d == 'string') a.push(getAlignedBuffer(d));
  }
  buf = Buffer.concat(a);
  if (!buf.length) {
    var e = 'no data';
    clink.logger.error(e);
    if (typeof clbk == 'function') clbk(clink, null, e); return;
  }
  buf.writeUInt32BE(LAST_RECORD + buf.length - 4, 0, true);
  var procedure = buf.readUInt32BE(PROC_OFFS);
  inspectBuffer(clink, pnames[procedure] + ' call', buf);

  socket.once('data', function(data) {
    inspectBuffer(clink, pnames[procedure] + ' reply', data);
    var xid = data.readUInt32BE(XID_OFFS);
    var error = data.readUInt32BE(ERROR_OFFS);
    clink.logger.log('XID[call]: %d      XID[reply]: %d', clink.xid, xid);
    if (typeof clbk == 'function') clbk(clink, data, error); return;
  });

  socket.write(buf);
}

function _rpc(clink, procedure, clbk) {
  var args = [clink, clbk];
  clink.xid = getNewXID();
  switch (procedure) {
    case PMAPPROC_GETPORT:
      args.push(0,clink.xid,CALL,RPC_VERSION,PMAP_PROG,PMAP_VERS,procedure,
        0,0,0,0, // credentials, verifier
      DEVICE_CORE_PROG,DEVICE_CORE_VERS,IPPROTO_TCP,0);
      break;
    case CREATE_LINK:
    case DEVICE_WRITE:
    case DEVICE_READ:
    case DESTROY_LINK:
      args.push(0,clink.xid,CALL,RPC_VERSION,DEVICE_CORE_PROG,DEVICE_CORE_VERS,
        procedure,0,0,0,0); // credentials, verifier
      break;
    default:
  }
  args = args.concat([].slice.call(arguments, 3));// add the variable arguments
  rpc.apply(this, args);
}

function vxiDestroyLink(clink, clbk) {
  var socket = clink.socket;
  socket.on('close', function() {
    clink.logger.log('disconnected (port: %d)', clink.port);
    if (typeof clbk == 'function') clbk(clink); return;
  });
  _rpc(clink, DESTROY_LINK, function (clink, data, error) {
      clink.error = '';
      if (error) {
        clink.error = pnames[DESTROY_LINK] + ' (error: ' + error + ')';
        clink.logger.error(clink.error);
      }
      socket.destroy();
    }, clink.linkID);
}

function vxiDeviceRead(clink, clbk) {
  var socket = clink.socket;
  _rpc(clink, DEVICE_READ, function (clink, data, error) {
      clink.error = '';
      if (error) {
        clink.error = pnames[DEVICE_READ] + ' (error: ' + error + ')';
        clink.logger.error(clink.error);
      } else {
        var len = data.readUInt32BE(LEN_OFFS);
        clink.result = data.slice(DATA_OFFS, DATA_OFFS + len);
        var str = clink.result.toString('ascii');
        var l = str.length <= 128 ? str.length : 128;
        clink.logger.log('result: ', str.substr(0, l));
      }
      if (typeof clbk == 'function') clbk(clink); return;
    }, clink.linkID, REQUEST_SIZE, clink.readTimeout, clink.readTimeout,
    clink.termChar ? 128 : 0, // Flags:
    // Bit0: Wait until locked, Bit3: Set EOI, Bit7: Termination character set
    clink.termChar);
}

function vxiDeviceWrite(clink, clbk) {
  var socket = clink.socket;
  _rpc(clink, DEVICE_WRITE, function (clink, data, error) {
      clink.error = '';
      if (error) {
        clink.error = pnames[DEVICE_WRITE] + ' (error: ' + error + ')';
        clink.logger.error(clink.error);
      }
      if (typeof clbk == 'function') clbk(clink); return;
    }, clink.linkID, clink.ioTimeout, clink.lockTimeout, END_FLAG,
    clink.command.length, clink.command);
}

function vxiCreateLink(clink, clbk) {
  var socket = clink.socket = net.connect(clink.port, clink.host);
  socket.setNoDelay(true);
  socket.on('error', function(e) {
    clink.error = e.toString();
    clink.logger.error(clink.error);
    if (typeof clbk == 'function') clbk(clink); return;
  });
  socket.on('connect', function() {
    clink.logger.log('connected (port: %d)', clink.port);
    _rpc(clink, CREATE_LINK, function (clink, data, error) {
        clink.error = '';
        if (error) {
          clink.error = pnames[CREATE_LINK] + ' (error: ' + error + ')';
          clink.logger.error(clink.error);
        } else {
          clink.linkID = data.readUInt32BE(LINK_ID_OFFS);
        }
        if (typeof clbk == 'function') clbk(clink); return;
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

  socket.on('close', function() {
    clink.logger.log('disconnected (port: %d)', PMAP_PORT);
    if (typeof clbk == 'function') clbk(clink); return;
  });

  socket.on('error', function(e) {
    clink.error = e.toString();
    clink.logger.error(clink.error);
    if (typeof clbk == 'function') clbk(clink); return;
  });

  socket.on('connect', function() {
    clink.logger.log('connected (port: %d)', PMAP_PORT);
    _rpc(clink, PMAPPROC_GETPORT, function (clink, data) {
      clink.port = getPort(data);
      clink.error = '';
      if (clink.port == -1) {
        clink.error = pnames[PMAPPROC_GETPORT] + ' error';
        clink.logger.error(clink.error);
      }
      socket.destroy();
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
      socket.destroy();
    } catch(e) {}
    if (typeof error == 'function') error(clink.error); return;
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
                    return;
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

exports.rpc = rpc;
exports.vxiGetPort = vxiGetPort;
exports.vxiCreateLink = vxiCreateLink;
exports.vxiDeviceWrite = vxiDeviceWrite;
exports.vxiDeviceRead = vxiDeviceRead;
exports.vxiDestroyLink = vxiDestroyLink;
exports.vxiTransceiver = vxiTransceiver;

