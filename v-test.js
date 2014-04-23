#!/usr/bin/env node

/*
  Rolf Niepraschk, Rolf.Niepraschk@ptb.de, 2014-04-09
*/

// XDR = External Data Representation

var net = require('net');
var dgram = require("dgram");
var util = require('util');
var crypto = require('crypto');

var HOST = '172.30.56.65';
var DEVICE = 'gpib0,10';
var INITIAL_PORT = 111;

var CMD = '*IDN?';
//var CMD = 'DATA?';
//var CMD = '*RST;*OPC?';
//var CMD = '*OPC?';
//var CMD = 'DATA?;DATA?';
//var CMD = 'DATA?';

var READ_TIMEOUT = 2047;

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

var LAST_RECORD = 0x80000000;
var DATA_SIZE = 64; //

/*

http://blog.tompawlak.org/2013/12/how-to-generate-random-values-nodejs-javascript.html

function randomValueHex (len) {
    return crypto.randomBytes(Math.ceil(len/2))
        .toString('hex') // convert to hexadecimal format
        .slice(0,len);   // return required number of characters
}

var value1 = randomValueHex(12) // value 'd5be8583137b'
var value2 = randomValueHex(2)  // value 'd9'
var value3 = randomValueHex(7)  // value 'ad0fc8c'
*/

// open device

udp = dgram.createSocket("udp4");

function next2(host, port, client, link_ID) {
  ///VXI_receive.vxi11_receive(receiveReady, link, empfang, read_timeout);

  buf = new Buffer(68);
  buf.writeUInt32BE(0x80000044, 0);	// Fragment haeder und len
  //vxi_ID.copy(buf,4,0,4);				// XID  Copy aus Zufallszahl!!!!!!!!!!!!!!!!!!!!!!!!!!!
  crypto.randomBytes(4).copy(buf, 4); // ???
  buf.writeUInt32BE(0x00000000, 8);	// Messagetyp call   0=Call
  buf.writeUInt32BE(0x00000002, 12);	// RPC version 2
  buf.writeUInt32BE(DEVICE_CORE_PROG, 16);  // Device core
  buf.writeUInt32BE(DEVICE_CORE_VERS, 20);	// Device core version
  buf.writeUInt32BE(DEVICE_READ, 24);	// device read
  buf.writeUInt32BE(0x00000000, 28);	// credentials
  buf.writeUInt32BE(0x00000000, 32);	// credentials
  buf.writeUInt32BE(0x00000000, 36);	// verifier
  buf.writeUInt32BE(0x00000000, 40);	// verifier

  //buf.writeUInt32BE(link[5], 44);	// link ID
  link_ID.copy(buf, 44);

  buf.writeUInt32BE(0x00000400, 48);  	// size

  console.log('receive request: ' + util.inspect(buf));

  var time_out = READ_TIMEOUT;//.toString(16);
  var hex;
  var Testtt= "0000";
  hex = Number(time_out).toString(16).toUpperCase();
  hex = Testtt.substr(0,4 -hex.length)+hex;
  console.log('VXI_receive time_out (hex): ' + hex);
  console.log('VXI_receive time_out: ' + time_out);

  //buf.writeUInt32BE(time_out, 52);		// I/O Time out
  //buf.writeUInt32BE(time_out, 56);		// lock Time out
  buf.writeUInt32BE(0x00000001, 60);  	// Flags    ???
  buf.writeUInt32BE(0x00000000, 60);  	// Flags    ???
  buf.writeUInt32BE(0x0000000a, 64);  	// termination character

  client.setNoDelay(true); // Früher?
  client.write(buf, function () {
    console.log('receive request sended');
  });

  client.on('data', function(data) {

    if (data.length > 36) {
      console.log('receive request data (2): ' + util.inspect(data));
      var len =  data.readInt32BE(36);
      console.log('Länge des empfangenden buffers: '+ len);
      console.log('Test empfang in Function: ' + data.toString('ascii', 40, len + 40));
      client.end();
    } else {
      console.log('receive request data (1): ' + util.inspect(data));
      ///client.end();
    }
  });

}

function next1(host, port) {
  console.log('--- +++ ---');
  var name = new Buffer(DEVICE, 'ascii');

  var buf = new Buffer (68);

  ///buf.writeUInt32BE(0x80000040, 0); //Fragment header and data size
  buf.writeUInt32BE(LAST_RECORD + DATA_SIZE, 0); //Fragment header and data size
  crypto.randomBytes(4).copy(buf, 4); // ???
  buf.writeUInt32BE(0x00000000, 8); //	Message type call    0=Call
  buf.writeUInt32BE(0x00000002, 12);//	RPC Version 2
  buf.writeUInt32BE(DEVICE_CORE_PROG, 16);//	Device core
  buf.writeUInt32BE(DEVICE_CORE_VERS, 20);//	Device core version
  buf.writeUInt32BE(CREATE_LINK, 24);//	create link/oder oder
  buf.writeUInt32BE(0x00000000, 28);//	credentials
  buf.writeUInt32BE(0x00000000, 32);//	credentials
  buf.writeUInt32BE(0x00000000, 36);//	verifier
  buf.writeUInt32BE(0x00000000, 40);//	verifier
  buf.writeUInt32BE(0x00000000, 44);//	client ID
  buf.writeUInt32BE(0x00000000, 48);//	no lock device
  buf.writeUInt32BE(0x00000000, 52);//	lock time out
  buf.writeUInt32BE(name.length, 56);//	device name len
  name.copy(buf, 60, 0, name.length);

  var client = net.connect(port, host);

  client.on('connect', function() {
    console.log('client connected');
    client.write(buf);
  });

/*
  client.on('data', function(data) {
    /// ???
  });
*/
  client.once('data', function(data) {
    console.log('client data: ' + util.inspect(data));
    /// ID-Check!
    /// VXI_send.vxi11_send(sendReady, link, cmd);

    var xid = data.readUInt32BE(4);
    var client_id = data.readUInt32BE(32);
    console.log('xid: ' +  xid);
    console.log('client_id: ' +  client_id.toString(16));

   var cmd = new Buffer(CMD, 'ascii');
   var message_length = cmd.length;
   console.log('*** message_length: ' + message_length);

   var buf_link_ID = new Buffer(4);
   data.copy(buf_link_ID, 0, 32, 36);

   console.log('CMD: >>' + CMD + '<<');

   var cmd = new Buffer(CMD, 'ascii');
   var message_length = cmd.length + (4 - (cmd.length % 4)); // Vielfache von 4 Byte
   //var message_length = cmd.length + (8 - (cmd.length % 8)); // Vielfache von 8 Byte

   var tmpbuf = new Buffer (message_length);
   tmpbuf.fill(0);
   cmd.copy(tmpbuf);
   console.log('message_length: ' + message_length);

   console.log('tmpbuf: ' + util.inspect(tmpbuf));

   var buf = new Buffer(64 + message_length);			//Sende Buffer anlegen

   console.log('0x80000000: ', 0x80000000);
   console.log('0x80000044: ', 0x80000044);
   console.log('0x80000000 + 68: ', 0x80000000 + 68);
   console.log('0x80000000 + buf.length: ', 0x80000000 + buf.length);

    buf.writeUInt32BE(0x80000044, 0);	//Fragment header and data size  (first bit 1=last fragment)
    //buf.writeUInt32BE(0x80000000 | buf.length, 0);
    //Fragment header and data size  (first bit 1=last fragment)
    buf.writeUInt32BE(0x80000000 + buf.length - 4, 0); // !!!
    crypto.randomBytes(4).copy(buf, 4); // ???
    buf.writeUInt32BE(0x00000000, 8);	//Message type call 0=Call
    buf.writeUInt32BE(0x00000002, 12);	//RPC Version
    buf.writeUInt32BE(DEVICE_CORE_PROG, 16);  	//Device core
    buf.writeUInt32BE(DEVICE_CORE_VERS, 20);	//Device core version
    buf.writeUInt32BE(DEVICE_WRITE, 24);	//device write

    buf.writeUInt32BE(0x00000000, 28);  //credentials
    buf.writeUInt32BE(0x00000000, 32);  //credentials
    buf.writeUInt32BE(0x00000000, 36);  //verifier
    buf.writeUInt32BE(0x00000000, 40);  //verifier

    //buf.writeUInt32BE(link[5],44);
    //buf_link_ID.copy(buf, 44);




    ///data.copy(buf, 44, 32, 36);
    buf.writeUInt32BE(client_id, 44);


    //var CLIENT_ID = 0x63890750;

    //buf.writeUInt32BE(CLIENT_ID, 44);

    buf.writeUInt32BE(0x000007d0, 48);  //I/O Time out
    buf.writeUInt32BE(0x000007d0, 52);  //lock Time out
    buf.writeUInt32BE(0x00000008, 56);  //flag END

    //MEssage size----------------------------------------------
      buf.writeUInt32BE(0x00000006, 60);  //data len
      buf.writeUInt32BE(message_length, 60);  //data len
      buf.writeUInt32BE(CMD.length, 60);  //data len  !!!
      //--------------------------------------
      //tmpbuf.copy(buf,64,0,message_length);		//Message in Send Buffer copy
      tmpbuf.copy(buf,64);		//Message in Send Buffer copy
    //-----------------------------------------------------------
    require('buffer').INSPECT_MAX_BYTES = 500; // ???
    ///buf.INSPECT_MAX_BYTES = 500;
    console.log('VXI_send buf: ' +  util.inspect(buf));

    client.write(buf, function () {
      next2(host, port, client, buf_link_ID);
    });

    ///client.end();
  });

  client.on('end', function() {
    console.log('client disconnected');
  });

  client.on('error', function(e) {
    console.log('client error: ' + e);
  });

  client.on('timeout', function() {
    console.log('client timeout');
  });

  client.once('data', function(data) {
    ///console.log('client data: ' + util.inspect(data));
  });

}

udp.on('listening', function () {
  var a = udp.address();
  console.log('udp socket listening: '  + a.address + ' :'  + a.port);
});

udp.on('close', function () {
  console.log('udp socket closed');
});

udp.on('message', function (msg, rinfo) {
  console.log('udp socket message: ' + (typeof msg));
  console.log('udp socket message: ' + msg.length);
  console.log('udp socket message: ' + util.inspect(msg));
  console.log('udp socket rinfo: ' + util.inspect(rinfo));
  var ip = rinfo.address;
  var port1 = rinfo.port;
  var port2 = msg.readUInt32BE(msg.length-4);
  console.log('port1: ' + port1 + '    port2: ' + port2 + '    ip: ' + ip);

  udp.close();
  next1(ip, port2);
});

///var buf2 = new Buffer(XID_rand.xid_gen());
//getport sende buffer---------------------------------------------------------
var buf = new Buffer(56);           //Sende Buffer anlegen
//buf2.copy(buf,0,0,4);               //xid Copy aus Zufallszahl
///buf.writeUInt32BE(0x303b6352, 0);       // provisorisch
crypto.randomBytes(4).copy(buf, 0); // ???
buf.writeUInt32BE(0x00000000, 4);   //MessageTyp festlegen  0=Call
buf.writeUInt32BE(0x00000002, 8);   //RPC Version festlegen
buf.writeUInt32BE(0x000186a0, 12);  //Programm Portmap festlegen
buf.writeUInt32BE(0x00000002, 16);  //Program Version festlegen
buf.writeUInt32BE(0x00000003, 20);  //GETPort 3
buf.writeUInt32BE(0x00000000, 24);  //Credentials
buf.writeUInt32BE(0x00000000, 28);  //Credentials
buf.writeUInt32BE(0x00000000, 32);  //Verfifier
buf.writeUInt32BE(0x00000000, 36);  //Verfifier
buf.writeUInt32BE(DEVICE_CORE_PROG, 40);  //Portmap Getportcall/Program Unknow
buf.writeUInt32BE(DEVICE_CORE_VERS, 44);  //Portmap Getportcall Version
buf.writeUInt32BE(0x00000006, 48);  //Portmap Getport TCP
buf.writeUInt32BE(0x00000000, 52);  //Portmap Getpor Port
//getport sende buffer---------------------------------------------------------
udp.send(buf, 0, buf.length, INITIAL_PORT, HOST, function(err, bytes) {
  if (err) {
    console.log('udp socket send error: ' +  err);
  } else {
    console.log('udp socket sended: ' +  bytes);
  }
});

/*
XID          = 0x00004673 = RPC message transaction identifier
MSG_TYPE     = 0x00000000 = RPC CALL message
RPCVERS      = 0x00000002 = RFC 1831,1057 RPC version #
PROG         = 0x000186A0 = RFC 1833 PMAP program #
VERS         = 0x00000002 = RFC 1833 PMAP version #
PROC         = 0x00000003 = PMAP_GETPORT
CRED.FLAVOR  = 0x00000000 = AUTH_NULL
CRED.BODY_SZ = 0x00000000 = 0 bytes in body
VERF.FLAVOR  = 0x00000000 = AUTH_NULL
VERF.BODY_SZ = 0x00000000 = 0 bytes in body
/ END OF RPC HEADER /
/ PORTMAPPER MAPPING /
PROG         = 0x000670AF = Server program #
VERS         = 0x00000001 = Server version #
PROT         = 0x00000006 = TCP
PORT         = 0x00000000 = ignored
*
*
*
program DEVICE_CORE {
 version DEVICE_CORE_VERSION {
   Create_LinkResp create_link (Create_LinkParms) = 10;
   Device_WriteResp device_write (Device_WriteParms) = 11;
   Device_ReadResp device_read (Device_ReadParms) = 12;
   Device_Error destroy_link (Device_Link) = 23;
 } = 1;
} = 0x0607AF;

  http://cp.literature.agilent.com/litweb/pdf/5989-6716EN.pdf   Wichtig: Seite 7 !!!
  http://epics-doc.desy.de/ioc/javaIOC/2008_09_23/doc/org/epics/ioc/pdrv/vxi11/vxi-11.pdf
  *
*/
