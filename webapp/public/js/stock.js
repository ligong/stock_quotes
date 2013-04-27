var g_web_server = "http://localhost:3000";

var socket = io.connect(g_web_server);

var g_connected = false;

function on_connect()
{
    g_connected = true;

}

function on_disconnect()
{
    g_connected = false;
}


socket.on("connect",on_connect);
socket.on("disconnect", on_disconnect);
socket.on("quotes",function(data) {
              if (!data ||
                  g_stock.indexOf(data.code) == -1) {
                  console.log("receive invalid quotes:"+
                              JSON.stringify(data));
                  return;
              }

              var row = build_quotes_row(data);
              var old_row = $("#"+row.attr("id"));
              old_row.replaceWith(row);
          });
socket.on("error", function(msg) {
              alert("Error occurs:"+msg);
          });
socket.on("connect_failed", function(msg) {
              alert("connect_failed:"+msg);
          });

var g_stock = [];

function is_valid_stock_code(code)
{
    return /^[06]\d{5,5}/.exec(code);

}

function add_stock(stocks,code)
{
    var i;
    for(i = 0; i < stocks.length; i++) {
        if (stocks[i] == code)
            return false;
    }
    stocks.push(code);
    return true;
}


function mkarray(x)
{
    if (typeof(x) == "object" &&
        typeof(x.length) == "number")
        return x;
    else
        return [x];
}

function refresh_table(stocks,clear)
{
    if (clear)
        $("#stocks").empty();
    stocks = mkarray(stocks);
    stocks.forEach(function(stock) {
                       var row = build_quotes_row(stock);
                       if (row)
                           $("#stocks").append(row);
                   });
}

function add_code()
{
    var n = $("#input_code").val();
    var row;
    if (is_valid_stock_code(n)) {
        if (add_stock(g_stock,n)) {
            subscribe(g_stock);
            refresh_table({code:n});
        }
    } else {
        alert("请输入正确的股票代码。例如,600019");
    }
}

function subscribe(codes)
{
    if (g_connected) {
        socket.emit("subscribe",codes);        
    } else {
        alert("服务器链接断开，请稍后再试");
    }
}

function quotes_row_id(quotes)
{
    return "quotes_" + quotes.code;
}

function build_quotes_row(quotes)
{
    if (!quotes || !quotes.code) return null;

    var row = ["code","name",
               "price","highest",
               "lowest","volume"];
    
    var id = quotes_row_id(quotes);


    var tr = $("<tr>",{id:id});

    row.forEach(function(x) {
                    var td = $("<td>");
                    if (quotes[x] != undefined) {
                        td.text(quotes[x]);
                    } else {
                        td.text("N/A");
                    }
                    tr.append(td);
                });
    return tr;
}

$(function() {
      
      $("#input_code").keypress(
          function (event) {
              if (event.which == 13) {
                  add_code();
                  $("#input_code").val("");
                  event.preventDefault();
              }});

      $("#add_code").click(
          function(event){
              add_code();
              event.preventDefault();});
  
  });
  
  