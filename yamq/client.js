var net = require("net");
var assert_true = require("assert").ok;

var g_channel_db = { };

// message format,
// length:string
function encode_message(obj)
{
    var s = JSON.stringify(obj);
    return s.length + ":" + s;
}

// return channel's unique id
function socket_id(channel)
{
    assert_true(channel);
    var s = channel.socket;
    return (s.remoteAddress + ":" + s.remotePort +
	    ":" + s.localAddress + ":" + s.localPort);
}

// add channel to db
function channel_db_add(channel)
{
    assert_true(channel);
    var id = socket_id(channel);
    g_channel_db[id] = channel;
}

// remove channel from db
function channel_db_remove(channel)
{
    assert_true(channel);
    var id = socket_id(channel);
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

    var channel = {socket: null,
		   buf:"",             // receive data buffer
		   inbox:{},           // inbox created
		   reply_callback:{},    // map msg_id to response callback
		   next_id:1,          // generate msg_id
		   pending:[],         // buffer for writing
		   connected: false};  // socket status
    
    var socket = net.connect({
				 host:connection.host,
				 port:connection.port
			     },
			     function() { //'connect' listener
				 var i;
				 console.log("client connected to:"
					     + connection.host + ":"
					     + connection.port
					    );
				 channel.connected = true;
				 for(i = 0; i < channel.pending.length; i++) {
				     socket.write(channel.pending[i]);
				 }
			     });

    channel.socket = socket;
    
//    channel_db_add(conn);

    channel.socket.on('data', function(data) {
		       channel.buf += data;
		       channel_process_data(channel);
		   });
    
    channel.socket.on('end', function() {
			  console.log('client disconnected');
			  channel.connected = false;
		      });
    
    return channel;
}

// log corrupted msg to console
function log_corrupt_msg(channel,msg)
{
    console.log("Recv corrupted message: server:" + channel.socket.remoteAddr + " port:" + channel.socket.remotePort + ":" + msg);
}

// process new received data
function channel_process_data(channel)
{
    var size;
    var msg;
    var msg_str;
    var i = channel.data.indexOf(":");
    var j;
    var inbox;
    
    if (i <= 0) return;
    size = parseint(channel.data.slice(0,i));
    if (typeof(size) != "number") {
	// message is corrupt
	log_corrupt_msg(channel,channel.data);
	channel.data = ""; // reset it
    }
	
    if ((i+1+size) > channel.data.length) // waiting for more data
	return;
    
    msg_str = channel.data.slice(i+1,i+1+size);
    channel.data = channel.data.slice(i+1+size);
    try {
	msg = JSON.parse(msg_str);
    } catch (err) {
	log_corrupt_msg(channel,msg_str);
	return;
    }

    if (typeof(msg.id) == "number" &&
	typeof(channel.reply_callback[msg.id]) == "function") {
	channel.reply_callback[msg.id](msg.body);
	delete channel.reply_callback[msg.id];
    }

    if (typeof(msg.body) == "object" &&
	msg.body.method == "publish") {
	if (typeof(msg.body.name) == "string" &&
	    msg.body.body != undefined) {
	    
	    inbox = channel.inbox[msg.body.name];
	    if (is_array(inbox)) {
		for(j = 0; j < inbox.length; j++)
		    inbox[j](msg.body.body);
	    }
	} else {
	    log_corrupt_msg(channel,msg_str);
	}
    }
}

 function channel_next_id(channel)
{
    channel.next_id += 1;
    if (channel.next_id < 1)
	channel.next_id = 1;
    return channel.next_id;
}

function channel_send_message(channel,msg_body,callback)
{
    var msg_id = callback? channel_next_id(channel):-1;
    var msg = encode_message({body:msg_body,
			    id:msg_id});
    if (callback) {
	channel.reply_callback[msg_id] = callback;
    }
    if (channel.connected) {
	channel.socket.write(msg);	
    } else {
	channel.pending.push(msg);
    }
}

function default_options(options,defaults)
{
    var attr;
    options = options || {};
    for(attr in defaults) {
	if (defaults.hasOwnProperty(attr)) {
	    if (options[attr] == undefined)
		options[attr] = defaults[attr];
	    }
    }
    return options;
}

// create outbox
// if the named outbox already exist, just return it and no new one is created
// optional options is: {type:"fanout"(default)|"direct",del_when_no_connection: boolean(default is true)}
// callback(result) will be called
// result is {code: "ok"|failure_reason, name: outbox_name}
// [fixme] direct type is not support yet
function make_outbox(channel,name,callback,options)
{
    assert_true(channel && name && callback);
    options = default_options(options,{type:"fanout",
				       del_when_no_connection: true});
    channel_send_message(channel,
			 {method:"make_outbox",name:name,options:options},
			 callback);
}

// create inbox
// if the named inbox already exist, just return it and no new one is created
// optional options is: {del_when_no_connection: boolean(default is true)}
// if name is empty string, broker will create a unique one
// callback(result) will be called
// result is {code: "ok"|failure_reason, name: inbox_name}
function make_inbox(channel,name,callback,options)
{
    assert_true(channel && typeof(name)=="string" && callback);
    options = default_options(options,{del_when_no_connection: true,
				       drop_policy:"drop_all",
				       max_queue:2000,
				       max_socket_size:10000});
    
    if (channel[inbox] == undefined) channel[inbox] = [];
    channel_send_message(channel,
			{method:"make_inbox",name:name,options:options},
			 callback);
}



function empty() {}

// subscribe outbox for inbox,
// message sent to outbox will be published to all inbox
// subscribed to it
// callback(result) will be called
// result is {code: "ok"|failure_reason}
function subscribe(channel,inbox,outbox,callback)
{
    assert_true(channel && inbox && outbox);
    callback = callback || empty;
    channel_send_message(channel,
			{method:"subscribe",inbox:inbox,outbox:outbox},
			 callback);
}

// bind inbox to outbox, create direct routing
// message sent to outbox will be published to all inbox according to route_key
// callback(result) will be called
// result is {code: "ok"|failure_reason}
function bind(channel,inbox,outbox,route_key,callback)
{
    // [fixme] not implement yet
    // assert_true(channel && inbox && outbox);
    // callback = callback || empty;
    // channel_send_message(channel,
    // 			{method:"subscribe",inbox:inbox,outbox:outbox},
    // 			 callback);
}

// [fixme] not implement some API yet
// delete_inbox, delete_outbox, unsubscribe, unbind

// send message with route_key to outbox
function publish_message(channel,outbox_name,route_key,message)
{
    assert_true(channel && outbox);
    route_key = route_key || "";
    message = message || "";
    channel_send_message(channel,
			{method:"publish",
			 outbox_name:outbox_name,
			 route_key:route_key,
			 body:message});
}

// bind a callback with the named inbox
// When a message is delivered to inbox,
// call callback(message_body)
function on_inbox_message(channel,name,callback)
{
    assert_true(channel && name && callback);
    assert_true(typeof(channel.inbox) == "object");

    channel.inbox[name].push(callback);
}

