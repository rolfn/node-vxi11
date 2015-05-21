/*
  Rolf Niepraschk, Rolf.Niepraschk@gmx.de, 2015-05-21
*/

var net = require('net');
require('buffer').INSPECT_MAX_BYTES = 500;

var VXI11_READ_TIMEOUT = 2000;  /* ms */
var VXI11_IO_TIMEOUT = 10000;   /* ms */
var VXI11_LOCK_TIMEOUT = 10000; /* ms */

var REQUEST_SIZE = 1000000;
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

var errors = {};
errors[0] = 'no error';
errors[1] = 'syntax error';
errors[3] = 'device not accessible';
errors[4] = 'invalid link identifier';
errors[5] = 'parameter error';
errors[6] = 'channel not established';
errors[8] = 'operation not supported';
errors[9] = 'out of resources';
errors[11] = 'device locked by another link';
errors[12] = 'no lock held by this link';
errors[15] = 'I/O timeout';
errors[17] = 'I/O error';
errors[21] = 'invalid address';
errors[23] = 'abort';
errors[29] = 'channel already established';

var IO_TIMEOUT = 15;

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

function getErrorMsg(proc, err) {
  var error = errors[err] ? errors[err] : err;
  return '[' + pnames[proc] + '] ' + error;
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

  var data = new Buffer(0), chunkCnt = 0;

  function reassemble(buf) {
    // remove possible rpc headers
    var a = [], flen = 0, len = 0, idx = buf.length - 4, mask = 1 << 31,
      prevIdx = buf.length - 1;
    clink.logger.log('[reassemble] buf.length: ' + buf.length);
    while (idx > -1) {
      flen = buf.readUInt32BE(idx) & ~mask;// clear the highest bit
      if (flen == len) {// most likely a size marker of a rpc fragment
        clink.logger.log('[reassemble] flen: %d  idx: %d', flen, idx);
        // prepend the fragment data to the array
        if (idx > 0) {
          // only the real data
          a.unshift(buf.slice(idx+4, idx+4+flen));
        } else {
          // the vxi header and the data
          a.unshift(buf.slice(0, prevIdx));
        }
        len = -4;
        prevIdx = idx;
      }
      idx -= 4;
      len += 4;
    }
    for (var i=0; i<a.length; i++) {
       clink.logger.log('a[%d].length=%d', i, a[i].length);
    }
    return Buffer.concat(a);
  }

  function onData(chunk) {
    var lastFragment = false, expected = 0;

    data = Buffer.concat([data,chunk]);
    chunkCnt++;

    if (procedure == DEVICE_READ) {
      expected = data.readUInt32BE(LEN_OFFS);
      lastFragment = data.length >= expected;
      clink.logger.log('expected: %d  actual: %d', expected, data.length);
    } else {
      lastFragment = data.readUInt8(0) >= 128;
    }

    inspectBuffer(clink, 'chunk', chunk);

    if (lastFragment) {
      clink.logger.log('*** last fragment ***');
      if (procedure == DEVICE_READ && chunkCnt > 1) data = reassemble(data);
      var xid = data.readUInt32BE(XID_OFFS);
      var error = data.readUInt32BE(ERROR_OFFS);
      clink.logger.log('XID[call]: %d      XID[reply]: %d', clink.xid, xid);
      inspectBuffer(clink, pnames[procedure] + ' reply', data);
      socket.removeListener('data', onData);
      if (typeof clbk == 'function') clbk(clink, data, error); return;
    }
  }

  socket.on('data', onData);

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
  var socket = clink.socket, proc = DESTROY_LINK;
  _rpc(clink, proc, function (clink, data, error) {
      clink.error = '';
      if (error) {
        clink.error = getErrorMsg(proc, error);
        clink.logger.error(clink.error);
      }
      clink.linkID = 0;
      socket.end();
      if (typeof clbk == 'function') clbk(clink); return;
    }, clink.linkID);
}

function vxiDeviceRead(clink, clbk) {
  var proc = DEVICE_READ;
  _rpc(clink, proc, function (clink, data, error) {
      clink.error = '';
      if (!error || error == IO_TIMEOUT && clink.readTimeout == 0) {
      // "readTimeout == 0" --> special case for buggy devices
        var len = data.readUInt32BE(LEN_OFFS);
        if (len > 0) {
          var b = data.slice(DATA_OFFS, DATA_OFFS + len);
          clink.logger.log('data-length: %d', len);
          if (clink.encoding == 'binary') {
            clink.result = b;
          } else if (clink.encoding == 'base64') {
            clink.result = b.toString('base64');
          } else {
            clink.result = b.toString('utf8');
          }
        } else {// force sending "null" if device response is missing (buggy device)
          clink.result = null;
          clink.logger.log('missing response');
        }
        if (typeof clink.result == 'string') {
          var l = clink.result.length <= 128 ? clink.result.length : 128;
          clink.logger.log('result (128 of ' + clink.result.length + '): ',
            clink.result.substr(0, l));
        } else if (clink.result instanceof Buffer) {
          inspectBuffer(clink, 'result', clink.result);
        } else {
          clink.logger.log('result: ', JSON.stringify(clink.result));
        }
      } else {
        clink.error = getErrorMsg(proc, error);
        clink.logger.error(clink.error);
      }
      if (typeof clbk == 'function') clbk(clink); return;
    }, clink.linkID, REQUEST_SIZE, clink.readTimeout, clink.readTimeout,
    clink.termChar ? 128 : 0, // Flags:
    // Bit0: Wait until locked, Bit3: Set EOI, Bit7: Termination character set
    clink.termChar);
}

function vxiDeviceWrite(clink, clbk) {
  var proc = DEVICE_WRITE;
  _rpc(clink, proc, function (clink, data, error) {
      clink.error = '';
      if (error) {
        clink.error = getErrorMsg(proc, error);
        clink.logger.error(clink.error);
      }
      if (typeof clbk == 'function') clbk(clink); return;
    }, clink.linkID, clink.ioTimeout, clink.lockTimeout, END_FLAG,
    clink.command.length, clink.command
  );
}

function vxiCreateLink(clink, clbk) {
  var socket = clink.socket = net.connect(clink.port, clink.host),
    proc = CREATE_LINK;
  socket.on('error', function(e) {
    clink.error = e.toString();
    clink.logger.error(clink.error);
    if (typeof clbk == 'function') clbk(clink); return;
  });
  socket.on('close', function() {
    clink.logger.log('disconnected (port: %d)', clink.port);
  });
  socket.on('connect', function() {
    clink.logger.log('connected (port: %d)', clink.port);
    _rpc(clink, proc, function (clink, data, error) {
        clink.error = '';
        if (error) {
          clink.error = getErrorMsg(proc, error);
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
  if (!clink.encoding) clink.encoding = 'utf8';

  var socket = clink.socket = net.connect(PMAP_PORT, clink.host),
    proc = PMAPPROC_GETPORT;

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
    _rpc(clink, proc, function (clink, data) {
      clink.port = getPort(data);
      clink.error = '';
      if (clink.port == -1) {
        clink.error = getErrorMsg(proc, error);
        clink.logger.error(clink.error);
      }
      socket.end();
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

  function error1(clink) {
    var msg = clink.error;
    function error2() {
      if (typeof error == 'function') error(msg); return;
    }
    try {
      if (clink.linkID) {
        try {
          vxiDestroyLink(clink, error2);
        } catch(e) {}
      } else {
        clink.socket.destroy();
        error2();
      }
    } catch(e) {
      error2();
    }
  }

  if (typeof clink.host != 'string' || typeof clink.device != 'string' ||
    typeof clink.command  != 'string') {
    clink.error = 'Invalid or missing parameter';
    error1(clink);
  } else {
    vxiGetPort(clink, function(clink) {
      if (clink.error) error1(clink);
      else {
        vxiCreateLink(clink, function(clink) {
          if (clink.error) error1(clink);
          else {
            vxiDeviceWrite(clink, function(clink) {
              if (clink.error) error1(clink);
              else {
                vxiDeviceRead(clink, function(clink) {
                  if (clink.error) error1(clink);
                  else {
                    vxiDestroyLink(clink, function(clink) {
                      if (clink.error) error1(clink);
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
}

exports.rpc = rpc;
exports.vxiGetPort = vxiGetPort;
exports.vxiCreateLink = vxiCreateLink;
exports.vxiDeviceWrite = vxiDeviceWrite;
exports.vxiDeviceRead = vxiDeviceRead;
exports.vxiDestroyLink = vxiDestroyLink;
exports.vxiTransceiver = vxiTransceiver;

