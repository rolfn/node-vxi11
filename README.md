# node-vxi11

A nodejs module for VXI-11 communication.

## To Install:
```
npm install vxi11
```

## To Use:

### Simple call with default parameters

```javascript
var vxiTransceiver = require('vxi11').vxiTransceiver
...
vxiTransceiver('172.30.56.65', 'gpib0,10', '*IDN?\n', function(result) {
  console.log('result: »' + result + '«');
});
...
```

### Call with an options object

```javascript
var vxiTransceiver = require('vxi11').vxiTransceiver
...
var options = {
  host: '172.30.56.65',
  device: 'gpib0,10',
  command: '*IDN?\n',
  readTimeout: 1000,     // default:  2000ms
  ioTimeout: 6000,       // default: 10000ms
  lockTimeout: 6000,     // default: 10000ms
  lockDevice: true,      // default: true
  termChar: '\n', // string or number; default: 0 (no termination char)
  logger: { log: console.log, error: console.error } // default: no logging
}
...
vxiTransceiver(options, function(result) {
  console.log('result: »' + result + '«');
});
```

## Possible improvements

* Split into a real onc rpc module and a vxi-11 module
* More vxi-11 functionality (e.g. SRQ)
