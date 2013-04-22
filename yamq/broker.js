var net = require('net');
var assert_true = require("assert").ok;


var g_inbox = {};
var g_outbox = {};

// index for N to N mapping, used for routing
var g_inbox_to_outbox = {}; // map from inbox name to outbox name list
var g_outbox_to_inbox = {}; // map from outbox name to inbox name list 

var g_socketid_to_inbox = {}; // map socketid to all connected inbox
                            // when all connection is dropped,
                            // delete inbox if required

var MAX_SOCKET_BUFFER_SIZE = 10000; // stop sending to socket if 
                                    // its buffer size >= it

function global_data_reset()
{
    g_inbox = {};
    g_outbox = {};
    g_inbox_to_outbox = {};
    g_outbox_to_inbox = {};
    g_socketid_to_inbox = {};
}

function dbg(msg)
{
    console.log("[debug]"+msg);
}


function check_consistency()
{
    //check above data structure's consistency
    return true;
}

// generate unique name
var gen_name = (function (next_id) {
		    var max_id = Math.floor(Number.MAX_VALUE/10);
		    return function() {
			next_id = (next_id+1) % max_id;
			return "_anonymous_" + next_id;
		    };})(0);

var gen_next_socket_id = (function (next_id) {
			  var max_id = Math.floor(Number.MAX_VALUE/10);
			  return function() {
			      next_id = (next_id+1) % max_id;
			      return next_id;
			  };})(0);

function log_corrupt_msg(msg)
{
    console.log("[warn]:message corrupt:"+msg);
}

// decode and remove message from buffer obj[attr]

function remove_message(obj,attr)
{
    attr = attr || "yamq_data";
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

// message format,
// length:string

function encode_message(obj)
{
    var s = JSON.stringify(obj);
    return s.length + ":" + s;
}

// build reply message
function make_reply(req_msg,reply_body)
{
    var reply = {body:reply_body};
    if (req_msg.id != undefined)
	reply.id = req_msg.id;
    return reply;
}

// process socket's data

function process_data(c)
{
    while(process_one_msg(c))
	;
}

function process_one_msg(c)
{
    var msg = remove_message(c,"yamq_data");
    var method;
    var x;
    var reply;

    if (!(msg && msg.body && msg.body.method))
	return false;

    method = msg.body.method;
    if (method == "make_inbox") {
	x = make_inbox(msg.body.name,msg.body.options);
	if (x) {
	    reply = make_reply(msg,{code: "ok", name: x.name});
	    inbox_add_consumer(x,c);
	} else {
	    reply = make_reply(msg,
			       {code:
				"fail:create with different attributes"});
	}
	c.write(encode_message(reply));
    } else if (method == "make_outbox") {
	x = make_outbox(msg.body.name,msg.body.options);
	if (x)
	    reply = make_reply(msg,{code: "ok", name: x.name});
	else
	    reply = make_reply(msg,
			       {code:
				"fail:create with different attributes"});
	c.write(encode_message(reply));
    } else if (method == "subscribe") {
	x = subscribe(msg.body.inbox,msg.body.outbox);
	if (x)
	    reply = make_reply(msg,{code: "ok"});
	else
	    reply = make_reply(msg,{code: "fail"});
	c.write(encode_message(reply));
    } else if (method == "publish") {
	publish_message(msg.body.outbox,msg.body.route_key,msg.body.body);
	// no reply needed
    } else {
	console.log("[warn]:process_data:unsupported msg:"+method);
    }
    return true;
}


function on_connect(c)
{
    assert_true(c.yamq_data == undefined);
    assert_true(c.yamq_socket_id == undefined);
    c.yamq_data = "";
    c.yamq_socket_id = gen_next_socket_id();

    dbg("connect");
    dbg(c.address().port+":"+c.address().address);
    c.on("data", function(data) {
	     dbg("data:"+data);
	     c.yamq_data += data;
	     process_data(c);
	 });
	 
    c.on("end", function() {
	     dbg("socket end:" + socket_id(c));
	     inbox_remove_consumer(c);
    	 });

    c.on("drain", function() {
	     dbg("socket drain:" + socket_id(c));
	     process_drain(c);
	 });
}


function process_drain(socket)
{
    var id = socket_id(socket);
    var inbox_names = g_socketid_to_inbox[id];
    var inboxs = [];  // inboxs with msg pending
    var i,inbox,inboxs2,x;

    for(i = 0; i < inbox_names.length; i++) {
	inbox = g_inbox[inbox_names[i]];
	assert_true(inbox);
	if (inbox.queue.length > 0)
	    inboxs.push(inbox);
    }

    // [fixme] a circulr list would be more effecient
    while (inboxs.length > 0 &&
	   socket.bufferSize < MAX_SOCKET_BUFFER_SIZE) {
	inboxs2 = [];
	for(i = 0; i < inboxs.length; i++) {
	    inbox = inboxs[i];
	    if (socket.bufferSize < MAX_SOCKET_BUFFER_SIZE) {
		x = inbox.queue.shift();
		socket.write(x);
		if (inbox.queue.length > 0)
		    inboxs2.push(inbox);
	    }
	}
	inboxs = inboxs2;
    }
}


// return true on equal, false otherwise

function deep_eaqual(obj1,obj2)
{
    var t1 = typeof(obj1);
    var t2 = typeof(obj2);
    var i;
    var attr;

    if (t1 != t2) return false;
    
    if (t1 != "object")
	return obj1 == obj2;
    
    if (obj1.length != undefined) { // array
	if (obj2.length != obj1.length)
	    return false;

	for(i = 0; i < obj1.length; i++) {
	    if (!deep_eaqual(obj1[i],obj2[i]))
		return false;
	}
	return true;
    } else if (obj2.length != undefined) {
	return false;
    } else {  // object
	for(attr in obj1) {
	    if (obj2[attr]==undefined || !deep_eaqual(obj1[attr],obj2[attr]))
		return false;
	}
	for(attr in obj2) {
	    if (obj1[attr]==undefined)
		return false;
	}
	return true;
    }
}

// return true,
// if obj1 and obj2 are object and all obj1's attribute are deep equal to obj2's
// return false otherwise;

function obj_cmp1(obj1,obj2)
{
    var attr;
    if (typeof(obj1)=="object" && obj1.length == undefined &&
	typeof(obj2)=="object" && obj2.length == undefined)  {
	for(attr in obj1) {
	    if (!deep_eaqual(obj1[attr],obj2[attr]))
		return false;
	}
	return true;
    }
    return false;
}

function make_inbox(name,options)
{
    var inbox;
    if (name != "") {
	if (g_inbox[name] != undefined)
	    if (obj_cmp1({name:name,options:options},g_inbox[name])) {
		return g_inbox[name];
	    } else { // already exist, but some attribute are different
		console.log("[warn]:make_inbox:create with different options");
		return null;
	    }

    } else {
	name = gen_name();
    }
    // [fixme] implement queue as a ring for effeciency
    inbox = {name:name,options:options,queue:[],consumer:[]};
    g_inbox[name] = inbox;
    return inbox;
}

function make_outbox(name,options)
{
    var outbox;
    if (name != "") {
	if (g_outbox[name] != undefined) {
	    if (obj_cmp1({name:name,options:options},g_outbox[name])) {
		return g_outbox[name];
	    } else { // already exist, but some attribute are different
		console.log("[warn]:make_outbox:create with different options");
		return null;
	    }
	}
    } else {
	name = gen_name();
    }

    outbox = {name:name,options:options};
    g_outbox[name] = outbox;
    return outbox;
}

// return channel's unique id

function socket_id(socket)
{
    assert_true(socket.yamq_socket_id);
    return socket.yamq_socket_id;
}

function inbox_add_consumer(inbox,socket)
{
    dbg("inbox_add_consumer");
    if (typeof(inbox) == "string")
	inbox = g_inbox[inbox];

    assert_true(inbox);
    
    var id = socket_id(socket);

    if (g_socketid_to_inbox[id] == undefined)
	g_socketid_to_inbox[id] = [];
    g_socketid_to_inbox[id].push(inbox.name);
    inbox.consumer.push(socket);
}

function make_fake_socket(ip,port)
{
    return {
	yamq_socket_id: gen_next_socket_id(),
	yamq_data:"",
	bufferSize: 0
    };
}

function remove_inbox(inbox)
{
    var outboxs;
    var i;
    
    if (typeof(inbox) == "string")
	inbox = g_inbox[inbox];
    assert_true(inbox);
    outboxs = g_inbox_to_outbox[inbox.name];
    if (outboxs == undefined) {
	;
    } else if (outboxs.length == 0) {
	delete g_inbox_to_outbox[inbox.name];
    } else {
	for(i = 0; i < outboxs.length; i++) {
	    unsubscribe(inbox,outboxs[i]);
	}
    }

    if (inbox.consumer) {
	for(i = 0; i < inbox.consumer.length; i++) {
	    inbox.consumer[i].end();
	}
    }

    delete g_inbox[inbox.name];
    
	
}

function inbox_remove_consumer(socket)
{
    var id = socket_id(socket);
    var inbox_names, name,inbox;
    var i,j;
    
    if ((inbox_names = g_socketid_to_inbox[id]) == undefined) {
	console.log("Error:inbox_remove_consumer: sock id missing in \
		    index g_socketid_to_inbox:" + id);
	return false;
    }

    for(i = 0; i < inbox_names.length; i++) {
	name = inbox_names[i];
	if ((inbox = g_inbox[name]) == undefined) {
	    console.log("Error:inbox_remove_consumer:key missing in g_inbox:"
			+ name );
	    continue;
	}
	for(j = 0; j < inbox.consumer.length; j++) {
	    if (inbox.consumer[j] === socket) {
		inbox.consumer.splice(j,1);
		break;
	    }
	}
	if (inbox.consumer.length == 0 &&
	    inbox.options.del_when_no_connection)
	    remove_inbox(name);
    }

    delete g_socketid_to_inbox[id];

    return true;
}

function subscribe(inbox,outbox)
{

    dbg("subscribe:"+inbox+":"+outbox);
    if (typeof(inbox) == "object")
	inbox = inbox.name;
    if (typeof(outbox) == "object")
	outbox = outbox.name;
    
    if (g_inbox[inbox] == undefined) {
	console.log("[warn]:subscribe: " + inbox + ":missing in g_inbox");
	return false;
    }

    if (g_outbox[outbox] == undefined) {
	console.log("[warn]:subscribe: " + outbox + ":missing in g_outbox");
	return false;
    }

    if (g_outbox[outbox].options.type != "fanout") {
	console.log("[warn]:subscribe:outbox is not fanout");
	return false;
    }

    if (g_inbox_to_outbox[inbox] == undefined)
	g_inbox_to_outbox[inbox] = [];
    g_inbox_to_outbox[inbox].push(outbox);
    
    if (g_outbox_to_inbox[outbox] == undefined)
	g_outbox_to_inbox[outbox] = [];
    g_outbox_to_inbox[outbox].push(inbox);

    return true;
}


function test_subscribe()
{
    global_data_reset();
    var inbox1 = make_inbox("inbox1",{});
    var outbox1 = make_outbox("outbox1",{type:"fanout"});
    subscribe(inbox1,outbox1);
    assert_true(deep_eaqual(g_inbox_to_outbox[inbox1.name],
			    ["outbox1"]));
    assert_true(deep_eaqual(g_outbox_to_inbox[outbox1.name],
			    ["inbox1"]));

    var inbox2 = make_inbox("inbox2",{});
    var outbox2 = make_outbox("outbox2",{type:"fanout"});

    subscribe(inbox2,outbox1);
    subscribe(inbox1,outbox2);
    
    assert_true(deep_eaqual(g_inbox_to_outbox[inbox1.name],
			    ["outbox1","outbox2"]));
    assert_true(deep_eaqual(g_outbox_to_inbox[outbox1.name],
			    ["inbox1","inbox2"]));
    
}


function is_array(x)
{
    return typeof(x) == "object" && typeof(x.length) == "number";
}

// delete x from arr
// if test(y,z) is not provide use ==
function array_del(arr, x, test)
{
    var i;
    test = test || function(y,z) {return y == z;};
    for(i = 0; i < arr.length; i++) {
	if (test(arr[i],x)) {
	    arr.splice(i,1);
	    break;
	}
    }    
}

// delete x obj's array arr_name, if arr becomes empty, delete it
function obj_array_del(obj,arr_name,x)
{
    var arr = obj[arr_name];
    if (!is_array(arr)) return;
    array_del(arr,x);
    if (arr.length == 0)
	delete obj[arr_name];
}

function unsubscribe(inbox,outbox)
{
    var arr;
    
    if (typeof(inbox) == "object")
	inbox = inbox.name;
    if (typeof(outbox) == "object")
	outbox = outbox.name;

    if (g_inbox[inbox] == undefined) {
	console.log("unsubscribe: " + inbox + ":missing in g_inbox");
	return false;
    }

    if (g_outbox[outbox] == undefined) {
	console.log("unsubscribe: " + outbox + ":missing in g_outbox");
	return false;
    }

    obj_array_del(g_inbox_to_outbox,inbox,outbox);
    obj_array_del(g_outbox_to_inbox,outbox,inbox);
    return true;
}


// encode publish message sent to consumer
function encode_publish_message(inbox_name, body)
{
    return encode_message({body:
			   {method:"publish",inbox:inbox_name,body:body}});
}

// [fixme] implement it to support direct route
function is_target(inbox,route_key)
{
    return true;
}

function publish_message(outbox,route_key,message)
{
    dbg("publish message:"+message);
    var ob = g_outbox[outbox];
    var inbox_names = g_outbox_to_inbox[outbox];
    var inbox,inbox_name,i,x;
    var type;   // outbox type
    var fanout; // is outbox fanout type
    
    if (ob == undefined) {
	console.log("Error:publish_message:"+outbox+":missing in g_outbox");
	return;
    }

    if (inbox_names == undefined) { // no inbox binded
	return;
    }

    type = ob.options.type;
    fanout = (type=="fanout");

    for(i = 0; i < inbox_names.length; i++) {
	inbox_name = inbox_names[i];
	inbox = g_inbox[inbox_name];
	if (inbox == undefined) {
	    console.log("Error:publish_message:"+inbox+":missing in g_inbox");
	} else if (fanout || is_target(inbox,route_key)) {
	    send_to_inbox(inbox,encode_publish_message(inbox_name,message));
	}
    }
}

// return a random int between start and end inclusively

function random_int(start,end)
{
    return start + Math.floor(Math.random()*(end-start+1));
}

function choose_consumer(inbox)
{
    var consumer = inbox.consumer;
    var candidate = -1;
    var n = 0;  // the number of qualified consumers so far
    var i,c;

    for(i = 0; i < consumer.length; i++) {
	c = consumer[i];
	if (c.bufferSize < MAX_SOCKET_BUFFER_SIZE) {
	    if (random_int(0,n) == 0)  // 1/n probability been chosen
		candidate = i;
	    n++;
	}
    }

    if (candidate >= 0)
	return consumer[candidate];
    else
	return null;
}

function send_to_inbox(inbox,message)
{
    dbg("send_to_inbox:" + message);
    var consumer;  // consumer socket
    var policy;

    if (typeof(inbox)=="string") {
	inbox = g_inbox[inbox];
    }
    
    assert_true(typeof(inbox)=="object");
    
    consumer = choose_consumer(inbox);
    if (consumer == null) { // either all busy or no available
	if (inbox.queue.length >= inbox.options.max_queue) {
	    policy = inbox.options.drop_policy;
	    if (policy == "drop_all") {
		inbox.queue = [];
		inbox.queue.push(message);
	    } else if (policy == "drop_old") {
		inbox.queue.shift();
		inbox.queue.push(message);
	    } {// else drop the new one
		dbg("drop message:" + message);
	    }
	} else { // buf is available
	    inbox.queue.push(message);
	}
    } else {
	consumer.write(message);
    }
}

function main()
{
    var server = net.createServer(on_connect);

    server.listen(8124, function() { //'listening' listener
		      console.log('server bound');
		  });
}

function test_remove_message()
{
    var c = {yamq_data:""};
    var msg = remove_message(c);
    var x;
    
    assert_true(msg == null && c.yamq_data=="");

    c.yamq_data = '5:"foo"';
    msg = remove_message(c);
    assert_true(msg == "foo" && c.yamq_data=="");

    c.yamq_data = '5:"foo"8:"foobar"';
    msg = remove_message(c);
    assert_true(msg == "foo" && c.yamq_data =='8:"foobar"');

    c.yamq_data = '5:"foo';
    msg = remove_message(c);
    assert_true(msg == null && c.yamq_data == '5:"foo');

    c.yamq_data = '5:"fooo';  // corrupt
    msg = remove_message(c);
    assert_true(msg == null && c.yamq_data == '');

    c.yamq_data = 'foo';  // corrupt
    msg = remove_message(c);
    assert_true(msg == null && c.yamq_data == '');

    x = {
	foo:123,
	bar:"4567",
	baz:{foo:123,bar:"你好"}
    };
    c.yamq_data = encode_message(x);
    msg = remove_message(c);
    assert_true(deep_eaqual(x,msg) && c.yamq_data == "");
    console.log("test_remove_message pass!");
}

function test_encode_message()
{
    var msg = encode_message("foo");
    assert_true(msg == '5:"foo"');
}

function test_make_reply()
{
    var req_msg = {
	id:3
    };
    var reply = make_reply(req_msg,{foo:"foo"});
    assert_true(reply.id==3 && reply.body.foo == "foo");
}

function test_deep_eaqual()
{
    assert_true(deep_eaqual(1,1));
    assert_true(deep_eaqual("foo","foo"));

    assert_true(!deep_eaqual(1,2));
    assert_true(!deep_eaqual("foo","foo1"));

    assert_true(deep_eaqual(true,true));
    assert_true(!deep_eaqual(true,false));

    assert_true(deep_eaqual({foo:"foo"},{foo:"foo"}));
    assert_true(!deep_eaqual({foo:"foo"},{foo:"foo1"}));

    assert_true(deep_eaqual({foo:"foo",bar:"bar"},{foo:"foo",bar:"bar"}));
    assert_true(!deep_eaqual({foo:"foo"},{foo:"foo",bar:"bar"}));
    assert_true(!deep_eaqual({foo:"foo",bar:"bar"},{foo:"foo"}));

    assert_true(deep_eaqual([1,2,3],[1,2,3]));
    assert_true(deep_eaqual([],[]));
    assert_true(!deep_eaqual([1,2,3],[1,2,3,4]));
    assert_true(!deep_eaqual([1,2,3,4],[1,2,3]));
}

function test_obj_cmp1()
{
    assert_true(obj_cmp1({foo:"foo"},{foo:"foo"}));
    assert_true(!obj_cmp1({foo:"foo",bar:"bar"},{foo:"foo",bar:"baz"}));
    assert_true(obj_cmp1({foo:"foo"},{foo:"foo",bar:"baz"}));
    assert_true(!obj_cmp1(1,1));
}


function test_make_inbox()
{
    global_data_reset();
    var inbox1 = make_inbox("foo",{});
    assert_true(inbox1.name == "foo",inbox1.options=={});
    
    var inbox2 = make_inbox("foo",{});
    assert_true(deep_eaqual(inbox1,inbox2));
    
    var inbox3 = make_inbox("foo",{bar:123});
    assert_true(inbox3 == null);

    var inbox4 = make_inbox("foo1",{bar:123});
    inbox4.queue = ["foo"];
    var inbox5 = make_inbox("foo1",{bar:123});
    assert_true(inbox4.name=="foo1" && inbox5.name=="foo1"
	       && deep_eaqual(inbox4,inbox5));
}


function test_make_outbox()
{
    global_data_reset();
    var outbox1 = make_outbox("foo",{});
    assert_true(outbox1.name == "foo",outbox1.options=={});
    
    var outbox2 = make_outbox("foo",{});
    assert_true(deep_eaqual(outbox1,outbox2));
    
    var outbox3 = make_outbox("foo",{bar:123});
    assert_true(outbox3 == null);

    var outbox4 = make_outbox("foo1",{bar:123});
    outbox4.queue = ["foo"];
    var outbox5 = make_outbox("foo1",{bar:123});
    assert_true(outbox4.name=="foo1" && outbox5.name=="foo1"
	       && deep_eaqual(outbox4,outbox5));
}

function test_inbox_add_consumer()
{
    global_data_reset();
    var inbox1 = make_inbox("inbox1",{});
    var inbox2 = make_inbox("inbox2",{});

    var socket1 = make_fake_socket("127.0.0.1","1");
    inbox_add_consumer(inbox1,socket1);

    var id = socket_id(socket1);
    assert_true(inbox1.consumer.length == 1 &&
		inbox1.consumer[0] == socket1);
    assert_true(deep_eaqual(g_socketid_to_inbox[id],["inbox1"]));

    inbox_add_consumer(inbox2,socket1);
    assert_true(inbox2.consumer.length == 1 &&
		inbox2.consumer[0] == socket1);
    assert_true(deep_eaqual(g_socketid_to_inbox[id],["inbox1","inbox2"]));

    var socket2 = make_fake_socket("127.0.0.1","2");
    var id2 = socket_id(socket2);
    inbox_add_consumer(inbox1,socket2);

    assert_true(inbox1.consumer.length == 2 &&
		inbox1.consumer[1] == socket2);

    assert_true(deep_eaqual(g_socketid_to_inbox[id2],["inbox1"]));

}

function test_inbox_remove_consumer()
{
    global_data_reset();
    var inbox1 = make_inbox("inbox1",{del_when_no_connection:true});
    var inbox2 = make_inbox("inbox2",{del_when_no_connection:false});

    var socket1 = make_fake_socket("127.0.0.1","1");
    inbox_add_consumer(inbox1,socket1);

    var id = socket_id(socket1);
    assert_true(inbox1.consumer.length == 1 &&
		inbox1.consumer[0] == socket1);
    assert_true(deep_eaqual(g_socketid_to_inbox[id],["inbox1"]));

    inbox_add_consumer(inbox2,socket1);
    assert_true(inbox2.consumer.length == 1 &&
		inbox2.consumer[0] == socket1);
    assert_true(deep_eaqual(g_socketid_to_inbox[id],["inbox1","inbox2"]));

    var socket2 = make_fake_socket("127.0.0.1","2");
    var id2 = socket_id(socket2);
    inbox_add_consumer(inbox1,socket2);

    assert_true(inbox1.consumer.length == 2 &&
		inbox1.consumer[1] == socket2);
    assert_true(deep_eaqual(g_socketid_to_inbox[id2],["inbox1"]));

    inbox_remove_consumer(socket1);
    assert_true(g_inbox["inbox1"] &&
		inbox1.consumer.length == 1 &&
		inbox1.consumer[0] == socket2);
    assert_true(g_socketid_to_inbox[id]==undefined);
    assert_true(inbox2.consumer.length == 0);

    inbox_remove_consumer(socket2);
    assert_true(g_inbox["inbox1"] == null);
    assert_true(g_socketid_to_inbox[id2]==undefined);
    assert_true(g_inbox["inbox2"] == inbox2 &&
		inbox2.consumer.length == 0);
    

}

function test_unsubscribe()
{
    global_data_reset();
    var inbox1 = make_inbox("inbox1",{});
    var outbox1 = make_outbox("outbox1",{type:"fanout"});
    subscribe(inbox1,outbox1);
    assert_true(deep_eaqual(g_inbox_to_outbox[inbox1.name],
			    ["outbox1"]));
    assert_true(deep_eaqual(g_outbox_to_inbox[outbox1.name],
			    ["inbox1"]));

    var inbox2 = make_inbox("inbox2",{});
    var outbox2 = make_outbox("outbox2",{type:"fanout"});

    subscribe(inbox2,outbox1);
    subscribe(inbox1,outbox2);
    
    assert_true(deep_eaqual(g_inbox_to_outbox[inbox1.name],
			    ["outbox1","outbox2"]));
    assert_true(deep_eaqual(g_outbox_to_inbox[outbox1.name],
			    ["inbox1","inbox2"]));

    assert_true(unsubscribe(inbox1,outbox1));
    assert_true(deep_eaqual(g_inbox_to_outbox[inbox1.name],
			    ["outbox2"]));
    assert_true(deep_eaqual(g_outbox_to_inbox[outbox1.name],
			    ["inbox2"]));

    assert_true(unsubscribe(inbox1,outbox2));
    assert_true(g_inbox_to_outbox[inbox1.name] == undefined);
    assert_true(deep_eaqual(g_outbox_to_inbox[outbox1.name],
			    ["inbox2"]));

    assert_true(unsubscribe(inbox2,outbox1));
    assert_true(g_inbox_to_outbox[inbox1.name] == undefined);
    assert_true(g_outbox_to_inbox[outbox1.name] == undefined);


}

function test_process_data()
{
    global_data_reset();
    
    var socket = make_fake_socket("127.0.0.1","2000");
    var output = "";
    var msg;
    socket.write = function(msg){output += msg;};
    

    msg = {id:123,body:{method:"make_inbox",
			name:"inbox1", options:{drop_policy:"drop_all",
						max_queue:1000}}};

    // test make_inbox success
    socket.yamq_data = encode_message(msg);
    process_data(socket);
    assert_true(output ==
		encode_message(make_reply(msg,{code: "ok",
					       name: "inbox1"})));
    assert_true(g_inbox["inbox1"].name == "inbox1");

    // test make_inbox fail
    output = "";
    msg = {id:123,body:{method:"make_inbox",
			name:"inbox1", options:{foo:"foo"}}};
    socket.yamq_data = encode_message(msg);
    process_data(socket);
    assert_true(output ==
		encode_message(make_reply(msg,
					  {code: "fail:create with different attributes"})));

    // test make_outbox success
    output = "";
    msg = {id:456,body:{method:"make_outbox",
			name:"outbox1", options:{type:"fanout"}}};
    socket.yamq_data = encode_message(msg);
    process_data(socket);
    assert_true(output ==
		encode_message(make_reply(msg,{code: "ok",
					       name: "outbox1"})));
    assert_true(g_outbox["outbox1"].name == "outbox1");

    // test make_outbox fail
    output = "";
    msg = {id:456,body:{method:"make_outbox",
			name:"outbox1", options:{type:"direct"}}};
    socket.yamq_data = encode_message(msg);
    process_data(socket);
    assert_true(output ==
		encode_message(make_reply(msg,
					  {code: "fail:create with different attributes"})));


    // test subscribe success
    output = "";
    msg = {id:789,body:{method:"subscribe",inbox:"inbox1",
			outbox:"outbox1"}};
    socket.yamq_data = encode_message(msg);
    process_data(socket);
    assert_true(output ==
	       encode_message(make_reply(msg,{code: "ok"})));
    assert_true(g_inbox_to_outbox["inbox1"][0] == "outbox1");
    assert_true(g_outbox_to_inbox["outbox1"][0] == "inbox1");


    // test subscribe fail
    output = "";
    msg = {id:791,body:{method:"subscribe",inbox:"inbox2",
			outbox:"outbox2"}};
    socket.yamq_data = encode_message(msg);
    process_data(socket);
    assert_true(output ==
	       encode_message(make_reply(msg,{code: "fail"})));

    // test publish
    output = "";
    msg = {body:{method:"publish",body:"foobar",
		 outbox:"outbox1",
		 route_key:"foo"}};
    socket.yamq_data = encode_message(msg);
    process_data(socket);
    assert_true(output ==
		(encode_message({method:"publish",
				 inbox:"inbox1",
				 body:"foobar"})));

    
}
function test_process_drain()
{
    global_data_reset();
    
    var msg;    
    var socket = make_fake_socket("127.0.0.1","2000");
    var output = "";

    socket.write = function(msg){output += msg;};

    make_inbox("inbox1",{drop_policy:"drop_all",max_queue:1000});
    make_outbox("outbox1",{type:"fanout"});
    subscribe("inbox1","outbox1");
    inbox_add_consumer("inbox1",socket);

    msg = {body:{method:"publish",body:"foobar",
		 outbox:"outbox1",
		 route_key:"foo"}};
    socket.yamq_data = encode_message(msg);
    socket.bufferSize = MAX_SOCKET_BUFFER_SIZE;
    process_data(socket);
    assert_true(output == "");
    process_drain(socket);
    assert_true(output == "");
    socket.bufferSize = 0;
    process_drain(socket);
    assert_true(output ==
	       encode_publish_message("inbox1","foobar"));
}

function test()
{
    test_encode_message();
    test_remove_message();
    test_make_reply();
    test_deep_eaqual();
    test_obj_cmp1();
    test_make_inbox();
    test_make_outbox();
    test_inbox_add_consumer();
    test_inbox_remove_consumer();
    test_subscribe();
    test_unsubscribe();
    test_process_data();
    test_process_drain();

}

main();
//test();


