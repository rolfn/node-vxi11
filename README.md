# node-vxi11

[![NPM](https://nodei.co/npm/vxi11.png)](https://nodei.co/npm/vxi11/)

A nodejs module for VXI-11 communication.

## Install
```
npm install vxi11
```

## Use

### Simple call with default parameters

```javascript
var vxiTransceiver = require('vxi11').vxiTransceiver
...
vxiTransceiver('172.30.56.65', 'gpib0,10', '*IDN?', function(result) {
  console.log('result: »' + result + '«');
});
```

### Call with an options object

```javascript
var vxiTransceiver = require('vxi11').vxiTransceiver
...
var options = {
  host: '172.30.56.65',
  device: 'gpib0,10',
  command: '*IDN?',
  readTimeout: 3000,     // default:  2000ms
  ioTimeout: 6000,       // default: 10000ms
  lockTimeout: 6000,     // default: 10000ms
  lockDevice: true,      // default: true
  termChar: '\n', // string or number; default: 0 (no termination char)
  logger: { log: console.log, error: console.error }, // default: no logging
  encoding: 'utf8'       // 'binary' (Buffer), 'base64'; default: 'utf8'
}
...
vxiTransceiver(options, function(result) {
  console.log('*** result: »' + result + '«');
},function(error) {
  console.log('*** error: »' + error + '«');
});
```

Note for the special case 'readTimeout:0':
* Ignores I/O timeout in DEVICE_READ procedure for buggy devices.
* Sends null back if missing response from buggy devices.

## Possible improvements

* Split into a real onc rpc module and a vxi-11 module
* More vxi-11 functionality (e.g. SRQ)


