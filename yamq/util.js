exports.remove_message = remove_message;
exports.deep_eaqual = deep_eaqual;
exports.test = test;


function log_corrupt_msg(msg)
{
    console.log("[warn]:message corrupt:"+msg);
}

// Given a buffer begins with a corrupted message
// try to remove the corrupted part

function recover_message(msg)
{

    var i = msg.search(/(\d)+:/);
    if (i == 0) {
        msg = msg.slice(msg.indexOf(":")+1);
        i = msg.search(/(\d)+:/);
    }

    if (i >=0 ) { // new hope
        return msg.slice(i);
    } else {
        return "";
    }
    
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
	    obj[attr] = recover_message(data);
	return null;
    }
    size = parseInt(data.slice(0,i));
    if (typeof(size) != "number") {
	// message is corrupt
	log_corrupt_msg(data);
	obj[attr] = recover_message(data); // reset it
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
	obj[attr] = recover_message(data);
	return null;
    }

    return msg;
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

    c.yamq_data = 'foo7:"hello"';  // corrupt
    msg = remove_message(c);
    assert_true(msg == null && c.yamq_data == '7:"hello"');

    c.yamq_data = '7:"helloo8:"hellow"';       // corrupt
    msg = remove_message(c);
    assert_true(msg == null && c.yamq_data == '8:"hellow"');
        
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

function test()
{
    test_remove_message();
    test_deep_eaqual();
                       
}