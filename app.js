var app = require('express')()
  , server = require('http').createServer(app)
  , timers = require("timers")
  , io = require('socket.io').listen(server);

var yamq = require("yamq/client");

server.listen(8080);

app.get('/', function (req, res) {
  res.sendfile(__dirname + '/index.html');
});

io.sockets.on('connection', function (socket) {
		  timers.setInterval(function() {
				     socket.emit("news",{hello:"world"});
				     },1000);
		  socket.emit('news', {hello: 'world'});
		  socket.on('my other event', function (data) {
				console.log(data);
			    });
});
