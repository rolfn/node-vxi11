#!/usr/bin/env node

/*
  Rolf Niepraschk, Rolf.Niepraschk@ptb.de, 2014-04-24
*/

var vxi = require('./lib/vxi11.js');
var util = require('util');

var HOST = 'e75465';
var DEVICE = 'gpib0,10';

///var CMD = 'DATA?\n';
///var CMD = '*ESR?';
var CMD = '*RST;*OPC?';
var CMD = '*IDN?\n';

function vxiTransceiver(host, device, command, clbk) {
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

vxiTranceiver(HOST, DEVICE, CMD, function(result) {
  console.log('result: »' + result + '«');
});




