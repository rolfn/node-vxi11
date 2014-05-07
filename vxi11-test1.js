#!/usr/bin/env node

/*
  Rolf Niepraschk, Rolf.Niepraschk@gmx.de, 2014-04-25
*/

var vxiTransceiver = require('vxi11').vxiTransceiver

var args = process.argv.slice(2);

if (args.length < 3) {
  console.error('Too few arguments!');
  console.error('Example: %s %s "172.30.56.65" "gpib0,10" "*IDN?\\n"',
    process.argv[0], require('path').basename(process.argv[1]));
  process.exit(1);
}

var host = args[0];
var device = args[1];
var tmp = '{ "cmd":"' + args[2] + '"}';
tmp = JSON.parse(tmp);
var cmd = tmp.cmd;

// example call with default parameters (no logging)
vxiTransceiver(host, device, cmd, function(result, error) {
  console.log('*** result 1: »' + result + '«');
});

var options = {
  host: host,
  device: device,
  command: cmd,
  readTimeout: 3000, // default:  2000ms
  ioTimeout: 6000,   // default: 10000ms
  lockTimeout: 6000, // default: 10000ms
  lockDevice: true,
  //termChar: '\n',
  logger: { log: console.log, error: console.error }
}

// example call with an option object
vxiTransceiver(options, function(result, error) {
  console.log('*** result 2: »' + result + '«' +
    (error ? ' (error: ' + error + ')': ''));
});





