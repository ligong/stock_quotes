var g_debug = {};

function debug()
{
    var i;
    for(i = 0; i < arguments.length; i++) {
        g_debug[arguments[i]] = true;
    }
}

function undebug()
{
    var i;
    if (arguments.length == 0) {
        g_debug = { };
    } else {
        for(i = 0; i < arguments.length; i++) {
            delete g_debug[arguments[i]];
        }
    }
}


function dbg(level,msg)
{
    if (level) {
        if (g_debug[level])
            console.log("[debug]"+msg);            
    } else
        console.log("[debug]"+msg);            
}

exports.debug = debug;
exports.undebug = undebug;
exports.dbg = dbg;