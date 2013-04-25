#!/usr/bin/env node

var fs = require('fs'),
    readline = require('readline'),
    yamq = require('../yamq/client.js');

var rd = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
});

var host;
var port;

if (process.argv.length >= 3)
    host = process.argv[2];
else
    host = "localhost";

if (process.argv.length >= 4)
    port = process.argv[3];
else
    port = 8124;

var g_inbox = {};


function run() {
    rd.on('line', function(line) {
	  var msg = null;
	  try {
	      msg = JSON.parse(line);
	  } catch (x) {	      
	  }
	  if (msg) {
	      var outbox = "stock_quotes_" + msg.code;
	      if (g_inbox[outbox] == undefined) {
		  yamq.make_outbox(chan,outbox,function(result){
				       g_inbox[outbox] = result.code;
				   });
		  g_inbox[outbox] = "waiting";
	      }
	      yamq.publish(chan,outbox,"",msg);
	      yamq.publish(chan,"stock_quotes","",msg);
	  }
      });

}
var conn = yamq.make_connection(host,port);
var chan = yamq.make_channel(conn);
var outbox = yamq.make_outbox(chan,"stock_quotes",function(result) {
				  if (result.code == "ok") {
				      console.log("run...");
				      run();
				  };
			      });

