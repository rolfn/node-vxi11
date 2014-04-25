#!/usr/bin/env node

/*
  Rolf Niepraschk, Rolf.Niepraschk@gmx.de, 2014-04-25
*/

var vxiTransceiver = require('./lib/vxi11.js').vxiTransceiver
var util = require('util');

var HOST = '172.30.56.65';
var DEVICE = 'gpib0,10';

var CMD = 'DATA?';
var CMD = '*ESR?';
var CMD = '*RST;*OPC?\n';
//var CMD = '*IDN?\n';

// example call with default parameters (no logging)
vxiTransceiver(HOST, DEVICE, CMD, function(result) {
  console.log('*** result 1: »' + result + '«');
});

var options = {
  host: HOST,
  device: DEVICE,
  command: CMD,
  readTimeout: 1000, // default:  2000ms
  ioTimeout: 6000,   // default: 10000ms
  lockTimeout: 6000, // default: 10000ms
  lockDevice: true,
  //terminationChar: '\n',
  logger: { log: console.log, error: console.error }
}

// example call with an option object
vxiTransceiver(options, function(result) {
  console.log('*** result 2: »' + result + '«');
});




