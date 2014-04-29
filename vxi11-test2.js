#!/usr/bin/env node

/*
  Rolf Niepraschk, Rolf.Niepraschk@gmx.de, 2014-04-29
*/

var vxiTransceiver = require('vxi11').vxiTransceiver
var http = require('http');
var url = require('url');
var util = require('util');

var PORT = 44444;

http.createServer(function (req, res) {
  var query = url.parse(req.url, true).query;
  console.log(util.inspect(query));
  var headers = {'Content-Type':'text/plain','Access-Control-Allow-Origin':'*'};
  if (query.host && query.device && query.command) {
    vxiTransceiver(query, function(result) {
      res.writeHead(200, headers);
      res.write(result);
      res.end();
    });
  } else {
    res.writeHead(500, headers);
    res.write("Wrong parameter!\n");
    res.end();
  }
}).listen(PORT);

console.log('Server running at http://127.0.0.1:' + PORT + '/');
