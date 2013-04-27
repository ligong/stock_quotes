var assert_true = require("assert").ok;
var yamq = require("../yamq/client");
var dbg = require("../yamq/debug").dbg;


// setup message queue
var g_conn = yamq.make_connection("localhost",8124);
var g_chan = yamq.make_channel(g_conn);

var g_outbox = "stock_quotes";
var g_inbox = "webapp_all_inbox";

var g_stock_db = { };  // code -> latest stock quotes

// return a callback checker for yamq API
function make_result_checker(prompt)
{
    return function(result) {
        if (typeof(result) == "object" &&
            result.code != "ok") {
            console.log("Error: " + prompt);
        }
    };
}

function empty() {}

// generate a uniqe id
var gen_next_id = (function(next) {
                   var max_id = Number.MAX_VALUE/10;
                   return function() {
                       next = (next+1) % max_id;
                       return next;};
               })(0);

function on_disconnect()
{
    var socket = this;
    yamq.remove_inbox(g_chan,
                      socket.inbox_name,
                      make_result_checker("remove_inbox:"+
                                          socket.inbox_name));
}

// return elements in a but not in b
// a,b are array

function set_difference(a,b)
{
    var result = [];
    var i,j;

    for(i = 0; i < a.length; i++) {
        var x = a[i];
        for(j = 0; j < b.length; j++) {
            if (x == b[j])
                break;
        }
        if (j >= b.length)
            result.push(x);
    }
    return result;
}

function get_outbox_name(code)
{
    return "stock_quotes_"+ code;
}

function on_subscribe(data)
{
    var socket = this;
    var remove, add;

    remove = set_difference(socket.subscribe, data);
    add = set_difference(data, socket.subscribe);

    remove.forEach(function(x) {
                       var outbox_name = get_outbox_name(x);
                       var p = ("unsubscribe:"+
                                socket.inbox_name+
                                ":"+
                                outbox_name);
                       yamq.unsubscribe(g_chan,socket.inbox_name,
                                        outbox_name,
                                        make_result_checker(p));
                   });
    add.forEach(function(x) {
                    var outbox_name = get_outbox_name(x);
                    var p1 = "make_outbox:"+outbox_name;
                    yamq.make_outbox(g_chan,outbox_name,
                                    make_result_checker(p1));
                    
                    var p2 = ("subscribe:"+socket.inbox_name+
                              ":"+outbox_name);
                    yamq.subscribe(g_chan,socket.inbox_name,
                                   outbox_name,
                                  make_result_checker(p2));
                });

    socket.subscribe = data;
    socket.subscribe.forEach(function(x) {
                                 var quotes = g_stock_db[x];
                                 if (quotes)
                                     socket.emit("quotes",quotes);
                                 });
}

function get_inbox_name(id)
{
    return "webapp_inbox_"+id;
}

function on_connection(socket)
{
    dbg("mid","connect to socket");
    assert_true(socket.subscribe == undefined);
    assert_true(socket.inbox_id == undefined);
    assert_true(socket.inbox_name == undefined);
    
    socket.subscribe = []; // subscribed stock code
    socket.inbox_id = gen_next_id();
    socket.inbox_name = get_inbox_name(socket.inbox_id);

    yamq.make_inbox(g_chan,socket.inbox_name,
                    make_result_checker("make_inbox:"+
                                        socket.inbox_name));
    yamq.on_inbox(g_chan,socket.inbox_name,function(data) {
                  socket.emit("quotes",data);
                  });
                    
    socket.on("subscribe", on_subscribe);
    socket.on('disconnect',on_disconnect);
}


yamq.make_outbox(g_chan,g_outbox,
                 make_result_checker("make_outbox:"+g_outbox));
yamq.make_inbox(g_chan,g_inbox,
               make_result_checker("make_inbox:"+g_inbox));
yamq.subscribe(g_chan,g_inbox,g_outbox);
yamq.on_inbox(g_chan,g_inbox,function(msg) {
                  g_stock_db[msg.code] = msg;
              });

exports.init = function(io){
    var sockets = io.sockets;
    sockets.on('connection', on_connection);
};

exports.stock_db = g_stock_db;



