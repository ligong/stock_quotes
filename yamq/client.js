var net = require("net");
var assert_true = require("assert").ok;
var dbg = require("./debug").dbg;
var g_channel_db = { };

// message format,
// length:string
function encode_message(obj)
{
    var s = JSON.stringify(obj);
    return s.length + ":" + s;
}

// return channel's unique id
function channel_id(chan)
{
    assert_true(chan);
    var s = chan.socket;
    return (s.remoteAddress + ":" + s.remotePort +
	    ":" + s.localAddress + ":" + s.localPort);
}

// add channel to db
function channel_db_add(chan)
{
    assert_true(chan);
    var id = channel_id(chan);
    g_channel_db[id] = chan;
}

// remove channel from db
function channel_db_remove(chan)
{
    assert_true(chan);
    var id = channel_id(chan);
    delete g_channel_db[id];
}

// return a connection with server
function make_connection(server_ip, server_port)
{
    return {host:server_ip,port:server_port};
}

// return a channel created in connection
function make_channel(connection)
{
    // [fixme]
    // mutex/demutex not implemented yet,poor performance
    // use a dedicated TCP for each channel

    var chan = {socket: null,
		   data:"",              // receive data buffer
		   inbox:{},             // inbox created
		   reply_callback:{},    // map msg_id to response callback
		   next_id:1,            // generate msg_id
		   pending:[],           // buffer for writing
		   connected: false};    // socket status

    var socket = net.connect({port:connection.port,
			      host:connection.host},
			     function() { //'connect' listener
				 var i;
				 dbg("mid",
                                     "client connected to:"
				     + connection.host + ":"
				     + connection.port);
				 chan.connected = true;
				 for(i = 0; i < chan.pending.length; i++) {
				     socket.write(chan.pending[i]);
				 }
				 chan.pending = [];
			     });

    chan.socket = socket;
    
    chan.socket.on('data', function(data) {
		       dbg("low","receive data:"+data);
		       chan.data += data;
		       channel_process_data(chan);
		   });
    
    chan.socket.on('end', function() {
			  dbg("mid",'client disconnected');
			  chan.connected = false;
		      });
    return chan;
}
                           

// log corrupted msg to console
function log_corrupt_msg(msg)
{
    console.log("[warn] Recv corrupted message:" + msg);
}

// decode and remove message from buffer obj[attr]
function remove_message(obj,attr)
{
    attr = attr || "data";
    
    var data = obj[attr];
    var size;
    var msg;
    var msg_str;
    var i = data.indexOf(":");
    var j;
    var inbox;
    
    if (i <= 0) {
	if(isNaN(parseInt(data)))
	    obj[attr] = "";
	return null;
    }
    size = parseInt(data.slice(0,i));
    if (typeof(size) != "number") {
	// message is corrupt
	log_corrupt_msg(data);
	obj[attr] = ""; // reset it
	return null;
    }
	
    if ((i+1+size) > data.length) // waiting for more data
	return null;
    
    msg_str = data.slice(i+1,i+1+size);
    obj[attr] = data.slice(i+1+size);
    try {
	msg = JSON.parse(msg_str);
    } catch (err) {
	log_corrupt_msg(msg_str);
	obj[attr] = "";
	return null;
    }

    return msg;
}

// process new received data

function channel_process_data(chan)
{
    while(channel_process_one_msg(chan))
	;
}

function is_array(x)
{
    return typeof(x) == "object" && typeof(x.length) == "number";
}

function channel_process_one_msg(chan)
{
    var msg = remove_message(chan,"data");
    var j;
    var inbox;

    if (!(msg && msg.body))
	return false;

    if (typeof(msg.id) == "number" &&
	typeof(chan.reply_callback[msg.id]) == "function") {
	chan.reply_callback[msg.id](msg.body);
	delete chan.reply_callback[msg.id];
    }
    if (typeof(msg.body) == "object" &&
	msg.body.method == "publish") {
	if (typeof(msg.body.inbox) == "string" &&
	    msg.body.body != undefined) {
	    inbox = chan.inbox[msg.body.inbox];
	    if (is_array(inbox)) {
		for(j = 0; j < inbox.length; j++)
		    inbox[j](msg.body.body);
	    }
	} else {
	    log_corrupt_msg(chan,msg_str);
	}
    }
    return true;
}

var MAX_ID = Math.floor(Number.MAX_VALUE / 10);
function channel_next_id(chan)
{
    chan.next_id = (chan.next_id + 1) % MAX_ID;
    return chan.next_id;
}

function channel_send_message(chan,msg_body,callback)
{
    var msg_id = callback? channel_next_id(chan):-1;
    var msg = encode_message({body:msg_body,
			    id:msg_id});
    if (callback) {
	chan.reply_callback[msg_id] = callback;
    }
    if (chan.connected) {
	chan.socket.write(msg);	
    } else {
	chan.pending.push(msg);
    }
}

// add default attribute if missing in object

function add_default(obj,defaults)
{
    var attr;
    obj = obj || {};
    for(attr in defaults) {
	if (defaults.hasOwnProperty(attr)) {
	    if (obj[attr] == undefined)
		obj[attr] = defaults[attr];
	    }
    }
    return obj;
}

// create outbox
// if the named outbox already exist, just return it and no new one is created
// optional options is: {type:"fanout"(default)|"direct"}
// callback(result) will be called
// result is {code: "ok"|failure_reason, name: outbox_name}
// [fixme] direct type is not support yet
function make_outbox(chan,name,callback,options)
{
    assert_true(chan && name && callback);
    options = add_default(options,{type:"fanout"});
				 
    channel_send_message(chan,
			 {method:"make_outbox",name:name,options:options},
			 callback);
}

// create inbox
// if the named inbox already exist, just return it and no new one is created
// optional options is: {del_when_no_connection: boolean(default is true)}
// if name is empty string, broker will create a unique one
// callback(result) will be called
// result is {code: "ok"|failure_reason, name: inbox_name}
function make_inbox(chan,name,callback,options)
{
    assert_true(chan && typeof(name)=="string" && callback);
    options = add_default(options,{del_when_no_connection: true,
                                   end_consumer_when_removed:false,
				   drop_policy:"drop_all",
				   max_queue:2000});

    // hold callback for this inbox
    if (chan.inbox[name] == undefined) chan.inbox[name] = []; 
    channel_send_message(chan,
			{method:"make_inbox",name:name,options:options},
			 callback);
}


// remove inbox
// callback(result) will be called
// result is {code: "ok"|"fail"}
function remove_inbox(chan,name,callback)
{
    assert_true(chan && typeof(name)=="string" && callback);
    channel_send_message(chan,
			{method:"remove_inbox",name:name},
                         function(result) {
                             callback(result);
                             console.log("foo");
                             delete chan.inbox[name];
                         });
}

function empty() {}

// subscribe outbox for inbox,
// message sent to outbox will be published to all inbox
// subscribed to it
// callback(result) will be called
// result is {code: "ok"|failure_reason}
function subscribe(chan,inbox,outbox,callback)
{
    assert_true(chan && inbox && outbox);
    callback = callback || empty;
    channel_send_message(chan,
			{method:"subscribe",inbox:inbox,outbox:outbox},
			 callback);
}


// unsubscribe inbox to outbox
// callback(result) will be called
// result is {code: "ok"|failure_reason}
function unsubscribe(chan,inbox,outbox,callback)
{
    assert_true(chan && inbox && outbox);
    callback = callback || empty;
    channel_send_message(chan,
			{method:"unsubscribe",inbox:inbox,outbox:outbox},
			 callback);
}


// bind inbox to outbox, create direct routing
// message sent to outbox will be published to all inbox according to route_key
// callback(result) will be called
// result is {code: "ok"|failure_reason}
function bind(chan,inbox,outbox,route_key,callback)
{
    // [fixme] not implement yet
    // assert_true(chan && inbox && outbox);
    // callback = callback || empty;
    // chan_send_message(chan,
    // 			{method:"subscribe",inbox:inbox,outbox:outbox},
    // 			 callback);
}

// [fixme] not implement some API yet
// delete_inbox, delete_outbox, unsubscribe, unbind

// send message with route_key to outbox
function publish(chan,outbox_name,route_key,message)
{
    assert_true(chan && outbox_name);
    route_key = route_key || "";
    message = message || "";
    channel_send_message(chan,
			{method:"publish",
			 outbox:outbox_name,
			 route_key:route_key,
			 body:message});
}

// bind a callback with the named inbox
// When a message is delivered to inbox,
// call callback(message_body)
function on_inbox_message(chan,name,callback)
{
    assert_true(chan && name && callback);
    assert_true(typeof(chan.inbox) == "object");

    chan.inbox[name].push(callback);
}

function sleep(milliSeconds)
{
    var startTime = new Date().getTime();
    while (new Date().getTime() < startTime + milliSeconds)	
	;
}

// make sure server is running in port 8124
function test()
{
    var conn = make_connection("127.0.0.1",8124);
    var chan = make_channel(conn);
    var output = null;

    make_inbox(chan,"inbox1",function(result) {
		   assert_true(result.code=="ok" && result.name=="inbox1");
		   console.log("success: inbox1 is created");
	       });

    make_inbox(chan,"inbox2",function(result) {
		   assert_true(result.code=="ok" && result.name=="inbox2");
		   console.log("success: inbox2 is created");
	       });
    
    make_outbox(chan,"outbox1",function(result) {
		   assert_true(result.code=="ok" && result.name=="outbox1");
		    console.log("success: outbox1 is created");
	       });

    subscribe(chan,"inbox1","outbox1",function(result){
		  assert_true(result.code=="ok");
		  console.log("success: subscribe inbox1 to outbox1");
	      });

    subscribe(chan,"inbox2","outbox1",function(result){
		  assert_true(result.code=="ok");
		  console.log("success: subscribe inbox2 to outbox1");
	      });
    
    on_inbox_message(chan,"inbox1",function(msg) {
			 assert_true(msg == "hello");
			 console.log("success: receive 'hello1' inbox1");
		     }
		    );
    on_inbox_message(chan,"inbox2",function(msg) {
			 assert_true(msg == "hello");
			 console.log("success: receive 'hello2' inbox2");
		     }
		    );
    publish(chan,"outbox1","foo","hello");
    unsubscribe(chan,"inbox2","outbox1",function(result) {
                    assert_true(result.code=="ok");
                    console.log("success: unsubscribe inbox2 to outbox1");
                });

    unsubscribe(chan,"inbox2","outbox1",function(result) {
                    assert_true(result.code=="ok");
                    console.log("success: unsubscribe inbox2 to outbox1 twice");
                });
    remove_inbox(chan,"inbox2",function(result) {
                     assert_true(result.code=="ok");
                     console.log("success: remove_inbox2");
                 });
}

exports.make_connection = make_connection;
exports.make_channel = make_channel;
exports.make_inbox = make_inbox;
exports.remove_inbox = remove_inbox;
exports.make_outbox = make_outbox;
exports.subscribe = subscribe;
exports.unsubscribe = unsubscribe;
exports.publish = publish;
exports.on_inbox = on_inbox_message;
exports.test = test;

                           

