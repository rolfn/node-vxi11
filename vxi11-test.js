#!/usr/bin/env node

/*
  Rolf Niepraschk, Rolf.Niepraschk@gmx.de, 2014-04-24
*/

var vxi = require('./lib/vxi11.js');
var util = require('util');

var HOST = 'e75465';
var DEVICE = 'gpib0,10';

///var CMD = 'DATA?\n';
///var CMD = '*ESR?';
var CMD = '*RST;*OPC?';
var CMD = '*IDN?';

function vxiTransceiver_1(host, device, command, clbk) {
  vxi.vxiOpenDevice(host, device, function(clink) {
    vxi.vxiSend(clink, command, function(clink) {
      vxi.vxiReceive(clink, function(clink, result) {
        vxi.vxiCloseDevice(clink, function() {
          if (typeof clbk == 'function') clbk(result);
        });
      });
    });
  });
}

// example call with default parameters (no logging)
vxiTransceiver_1(HOST, DEVICE, CMD, function(result) {
  console.log('result 1: »' + result + '«');
});

function vxiTransceiver_2(options, clbk) {
  vxi.vxiOpenDevice(options, function(clink) {
    vxi.vxiSend(clink, function(clink) {
      vxi.vxiReceive(clink, function(clink, result) {
        vxi.vxiCloseDevice(clink, function() {
          if (typeof clbk == 'function') clbk(result);
        });
      });
    });
  });
}

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
vxiTransceiver_2(options, function(result) {
  console.log('result 2: »' + result + '«');
});

