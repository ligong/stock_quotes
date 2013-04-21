var net = require("net");
var assert_true = require("assert").ok;

var g_channel_db = { };

// message format,
// length:string
function make_message(obj)
{
    var s = JSON.stringify(obj);
    return s.length + ":" + s;
}

function socket_id(channel)
{
    var s = channel.socket;
    return (s.remoteAddress + ":" + s.remotePort +
	    ":" + s.localAddress + ":" + s.localPort);
}

function channel_db_add(channel)
{
    var id = socket_id(channel);
    g_channel_db[id] = channel;
}

function channel_db_remove(channel)
{
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
		   msg_callback:{},    // map msg_id to response callback
		   next_id:0,          // generate msg_id
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
    
    add_channel_db(conn);

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

function channel_next_id(channel)
{
    channel.next_id += 1;
    if (channel.next_id < 0)
	channel.next_id = 0;
    return channel.next_id;
}

function channel_send_message(channel,msg_obj,callback)
{
    var msg_id = callback? channel_next_id(channel):-1;
    var msg = make_message({body:"make_outbox",
			    id:msg_id});
    if (callback) {
	channel.reply_callback[msg_id] = function(reply_body) {
	    callback(reply_body);
	    delete channel.reply_callback[msg_id];
	};
    }
    if (channel.connected) {
	channel.socket.write(msg);	
    } else {
	channel.pending.push(msg);
    }
}

// create outbox
// if the named outbox already exist, just return it and no new one is created
// optional parameter options is Object: {type:"direct"(default)|"fanout", route_key: string}
// callback(result) will be called
// result is true on success, false on failure
function make_outbox(channel,name,callback,options)
{
    assert_true(channel && name && callback);
    options = options || { };
    channel_send_message(channel,
			 {method:"make_outbox",name:name,options:options},
			 callback);
}

// create inbox
// if the named inbox already exist, just return it and no new one is created
// callback(result) will be called
// result is true on success, false on failure
function make_inbox(channel,name,callback)
{
    assert_true(channel && name && callback);
    channel_send_message(channel,
			{method:"make_inbox",name:name},
			 function(result) {callback(result);});
}

// bind inbox and outbox with route_key
// callback(result) will be called
// result is true on success, false on failure
function bind(channel,inbox,outbox,route_key,callback)
{
    assert_true(channel && inbox && outbox);
    route_key = route_key || "";
    channel_send_message(channel,
			{method:"bind",inbox:inbox,outbox:outbox,route_key:route_key},
			function(result) {callback(result);});
}

// send message with route_key to outbox
function send_message(channel,outbox_name,route_key,message)
{
    assert_true(channel && outbox);
    route_key = route_key || "";
    message = message || "";
    channel_send_message(channel,
			{method:"publish",body:message});
}

// bind a callback with the named inbox
// if a message is delivered to inbox,
// call callback(message_body)
function on_inbox_message(channel,name,callback)
{
    assert_true(channel && name && callback);

    if (channel)
    channel.inbox[name] = callback;
    
}

