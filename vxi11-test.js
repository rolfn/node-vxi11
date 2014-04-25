#!/usr/bin/env node

/*
  Rolf Niepraschk, Rolf.Niepraschk@gmx.de, 2014-04-25
*/

//var vxi = require('./lib/vxi11.js');
var vxiTransceiver = require('./lib/vxi11.js').vxiTransceiver
var util = require('util');

var HOST = 'e75465';
var DEVICE = 'gpib0,10';

///var CMD = 'DATA?\n';
///var CMD = '*ESR?';
var CMD = '*RST;*OPC?';
var CMD = '*IDN?';

// example call with default parameters (no logging)
vxiTransceiver(HOST, DEVICE, CMD, function(result) {
  console.log('*** result 1: »' + result + '«');
});

var options = {
  host: HOST,
  device: DEVICE,
  command: CMD,
  readTimeout: 1000,
  ioTimeout: 6000,
  lockTimeout: 6000,
  lockDevice: true,
  //terminationChar: '\n',
  logger: { log: console.log, error: console.error }
}

// example call with an option object
vxiTransceiver(options, function(result) {
  console.log('*** result 2: »' + result + '«');
});

