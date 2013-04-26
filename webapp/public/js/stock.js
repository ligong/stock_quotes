var socket = io.connect("http://localhost");

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
                  console.log("receive invalid quotes:"+data);
                  return;
              }

              var row = build_quotes_row(data);
              console.log(row);
              var old_row = $("#"+row.attr("id"));
              old_row.replaceWith(row);
              
              // var p = document.createElement("p");
              // var text = document.createTextNode(JSON.stringify(data));
              // p.appendChild(text);
              // document.body.appendChild(p);
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


function refresh_table(stocks)
{
    $("#stocks").empty();
    stocks.forEach(function(stock) {
                       var row = build_quotes_row(stock);
                       if (row)
                           $("#stocks").append(row);
                   });
}

function add_code()
{
    var n = $("#input_code").val();
    if (is_valid_stock_code(n)) {
        if (add_stock(g_stock,n)) {
            subscribe(g_stock);
            refresh_table(g_stock.map(function(code){return {code:code};}));
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
                  $("input_code").val("");
                  event.preventDefault();
              }});

      $("#add_code").click(
          function(event){
              add_code();
              event.preventDefault();});
  
  });
  
  