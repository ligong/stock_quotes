// return a connection with server
function make_connection(server_ip, server_port)
{
    
}

// return a channel created in connection
function make_channel(connection)
{
    
}

// create outbox, return true on success, false on failure
// if the named outbox already exist, just return it and no new one is created
// optional parameter attrs is Object: {type:"direct"(default)|"fanout", route_key: string}
function make_outbox(channel,name,attrs)
{
    
}

// create inbox, return true on success, false on failure
// if the named inbox already exist, just return it and no new one is created
function make_inbox(channel,name)
{
    
}

// bind inbox and outbox with route_key
function bind(channel,inbox,outbox,route_key)
{
    
}

// send message with route_key to outbox
function send_message(channel,outbox_name,route_key,message)
{
    
}

// bind a callback with the named inbox
// if a message is delivered to inbox,
// call callback(body)
function on_inbox_message(connection,name,callback)
{
    
}
