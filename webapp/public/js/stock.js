var socket = io.connect("http://localhost");

var g_connected = false;

function on_connect()
{
    g_connected = true;
    socket.emit("subscribe",[600036,600016,600019]);
}

function on_disconnect()
{
    g_connected = false;
}

socket.on("connect",on_connect);
socket.on("disconnect", on_disconnect);
socket.on("quotes",function(data) {
              var p = document.createElement("p");
              var text = document.createTextNode(JSON.stringify(data));
              p.appendChild(text);
              document.body.appendChild(p);
          });

